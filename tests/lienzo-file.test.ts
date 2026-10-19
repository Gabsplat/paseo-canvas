import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { MediaStore } from "../plugin/server/media";
import { exportLienzo, importLienzo } from "../plugin/server/lienzo-file";
import { startDesktop } from "../apps/desktop/src/main/core";
import { LIENZO_FILE, importedTitle, lienzoFileName, lienzoFileSchema, mediaRefsIn } from "../plugin/shared/lienzo-file";
import { fromBase64, toBase64 } from "../plugin/shared/media";
import { documentContentSchema, type BlockType } from "../plugin/shared/model";
import * as rpc from "../plugin/shared/rpc";
import { LIENZO_FILE_MAX_BYTES, isLienzoPath } from "../apps/desktop/src/shared/files";

const W = "workspace-a", APP = { name: "Lienzo", version: "test" };
const PNG = fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const recipe: BlockType = { id: "recipe", name: "Recipe", description: "A dish.", properties: [{ key: "text", label: "Text", kind: "text", required: false }], defaults: { text: "" } };
const tool = (id: string, name: string) => ({ id, kind: "tool" as const, api: 1 as const, name, description: "", html: "<p>Example tool for tests.</p>", permissions: ["edit" as const] });

async function host(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "lienzo-file-"));
  const store = new CanvasStore(directory), service = new CanvasService(store), media = new MediaStore(directory);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, service, media };
}
/** A Lienzo with a stored image, a custom type, a Sheet, a link, a comment, runtime and storage of two extensions. */
async function source(t: TestContext) {
  const h = await host(t), image = await h.media.put(toBase64(PNG));
  let catalog = await h.service.catalogMutate({ expectedRevision: 0, action: { type: "type.put", blockType: recipe } });
  catalog = await h.service.catalogMutate({ expectedRevision: catalog.revision, action: { type: "extension.put", extension: tool("timer", "Timer") } });
  await h.service.importPack({ expectedRevision: catalog.revision, pack: { format: "paseo-canvas-pack", version: 1, id: "acme", name: "Acme tools", description: "Example file.", blockTypes: [], templates: [], documents: [], extensions: [tool("acme.clock", "Clock")] }, replace: false, dryRun: false });
  const content = documentContentSchema.parse({
    title: "Kitchen", description: "Example data for tests.", communication: { instructions: "Explain dishes." },
    blocks: [
      { id: "photo", typeId: "media", title: "Photo", data: { url: image.url, caption: "", mediaKind: "image" }, parentGroupId: "sheet-1" },
      { id: "soup", typeId: "recipe", title: "Soup", data: { text: "Boil." } },
      { id: "steps", typeId: "checklist", title: "Steps", data: { items: ["Cut", "Cook"] } },
    ],
    groups: [{ id: "sheet-1", title: "First", blockIds: ["photo"], position: { x: 0, y: 0 }, sheet: { number: 1, createdAt: "2026-10-01T00:00:00.000Z", source: "user" } }],
    links: [{ id: "l1", from: "soup", to: "steps" }],
  });
  const view = await h.service.create({ workspaceId: W, content });
  const documentId = view.document.id;
  await h.service.selection({ workspaceId: W, documentId, expectedSelectionVersion: view.selectionVersion, ids: ["soup"] });
  await h.service.createComment({ workspaceId: W, documentId, anchor: { kind: "block", id: "soup", dx: 0, dy: 0 }, text: "Needs salt." }, { kind: "agent", agentId: "a", label: "Codex" });
  await h.service.runtimeSet({ workspaceId: W, documentId, blocks: [{ id: "steps", state: { done: [0] } }], scopes: [] });
  await h.service.extensionStorage({ workspaceId: W, documentId, extensionId: "timer", action: "set", value: { seconds: 30 } });
  await h.service.extensionStorage({ workspaceId: W, documentId, extensionId: "acme.clock", action: "set", value: { zone: "UTC" } });
  return { ...h, documentId, image };
}

test("export writes the format: the document without history or selection, images, custom types and extensions", async t => {
  const s = await source(t), out = await exportLienzo(s.store, s.media, { workspaceId: W, documentId: s.documentId, comments: false, runtime: false }, APP);
  assert.equal(out.fileName, "Kitchen.lienzo"); assert.equal(out.mime, "application/vnd.lienzo+json"); assert.equal(out.images, 1); assert.equal(out.missingImages, 0);
  const file = lienzoFileSchema.parse(JSON.parse(out.text));
  assert.equal(file.format, "lienzo"); assert.equal(file.version, 1); assert.deepEqual(file.app, APP);
  for (const key of ["id", "workspaceId", "revision", "createdAt", "updatedAt", "history", "connection"]) assert.ok(!(key in file.document), `${key} is not exported`);
  assert.deepEqual(file.document.selectedIds, [], "the selection stays home");
  assert.deepEqual(Object.keys(file.media), [`${sha(PNG)}.png`]); assert.equal(file.media[`${sha(PNG)}.png`].type, "image/png");
  assert.deepEqual(file.catalog.blockTypes.map(type => type.id), ["recipe"], "only custom types the document uses");
  assert.deepEqual(file.catalog.extensions.map(e => [e.id, e.pack?.id]).sort(), [["acme.clock", "acme"], ["timer", undefined]]);
  assert.equal(file.comments, undefined); assert.equal(file.runtime, undefined, "comments and runtime are off by default");
  const full = lienzoFileSchema.parse(JSON.parse((await exportLienzo(s.store, s.media, { workspaceId: W, documentId: s.documentId, comments: true, runtime: true }, APP)).text));
  assert.equal(full.comments?.length, 1); assert.deepEqual(full.runtime?.blocks.steps, { done: [0] }); assert.deepEqual(full.runtime?.extensionStorage, { timer: { seconds: 30 }, "acme.clock": { zone: "UTC" } });
});

test("import on a fresh computer: a new Lienzo, images restored once, types and extensions installed but not granted", async t => {
  const s = await source(t), fresh = await host(t);
  const text = (await exportLienzo(s.store, s.media, { workspaceId: W, documentId: s.documentId, comments: true, runtime: true }, APP)).text;
  const review = await importLienzo(fresh.store, fresh.media, { workspaceId: W, text, dryRun: true });
  assert.equal(review.committed, false); assert.equal(review.importTitle, "Kitchen"); assert.equal(review.blocks, 3); assert.equal(review.sheets, 1); assert.equal(review.links, 1);
  assert.deepEqual(review.images, { count: 1, bytes: PNG.length, missing: 0 }); assert.equal(review.comments, 1); assert.equal(review.runtime, true);
  assert.deepEqual(review.blockTypes, [{ id: "recipe", name: "Recipe", status: "new" }]);
  assert.deepEqual(review.extensions.map(e => [e.id, e.status]).sort(), [["acme.clock", "new"], ["timer", "new"]]);
  assert.ok(review.preview, "the dry run carries the content for the thumbnail");
  assert.equal((await fresh.store.read()).commit, 0, "the review writes nothing");
  await assert.rejects(readdir(join(fresh.directory, "media")), "and no image");

  const done = await importLienzo(fresh.store, fresh.media, { workspaceId: W, text, dryRun: false });
  assert.equal(done.committed, true); assert.ok(done.documentId && done.documentId !== s.documentId, "always a new id");
  const original = await s.service.read({ workspaceId: W, documentId: s.documentId }), copy = await fresh.service.read({ workspaceId: W, documentId: done.documentId! });
  const strip = ({ id: _i, revision: _r, createdAt: _c, updatedAt: _u, selectedIds: _s, ...rest }: typeof original.document) => rest;
  assert.deepEqual(strip(copy.document), strip(original.document), "an equivalent document");
  assert.equal(copy.document.revision, 0); assert.equal(copy.connection, null); assert.deepEqual((await fresh.service.history({ workspaceId: W, documentId: done.documentId! })).transactions, [], "no history");
  assert.equal((await fresh.media.read(s.image.url)).data, toBase64(PNG), "the image is kept under the same name");
  const catalog = await fresh.service.catalog();
  assert.ok(catalog.blockTypes.some(type => type.id === "recipe"));
  const timer = catalog.extensions.find(e => e.id === "timer"), clock = catalog.extensions.find(e => e.id === "acme.clock");
  assert.equal(timer?.granted, false); assert.equal(clock?.granted, false, "imported extensions hold no permission");
  assert.equal(clock?.source, "acme", "an extension from a file returns to a file of that name"); assert.match(timer!.source, /^lienzo-file_/);
  const comments = await fresh.service.comments({ workspaceId: W, documentId: done.documentId! });
  assert.equal(comments.threads.length, 1); assert.equal(comments.threads[0].imported, true);
  assert.deepEqual(comments.threads[0].messages[0].author, { kind: "agent", agentId: "a", label: "Codex" }, "authors are kept");
  assert.deepEqual(copy.runtime.blocks.steps, { done: [0] });
  assert.deepEqual((await fresh.service.extensionStorage({ workspaceId: W, documentId: done.documentId!, extensionId: "timer", action: "get", value: null })).value, { seconds: 30 });

  // Again: a second Lienzo with " (imported)", the image not written twice, the catalog unchanged.
  const revision = catalog.revision, again = await importLienzo(fresh.store, fresh.media, { workspaceId: W, text, dryRun: false });
  assert.equal(again.importTitle, "Kitchen (imported)"); assert.notEqual(again.documentId, done.documentId);
  assert.deepEqual(again.blockTypes.map(type => type.status), ["installed"]); assert.ok(again.extensions.every(e => e.status === "installed"));
  assert.equal((await readdir(join(fresh.directory, "media"))).length, 1, "images are deduplicated by hash");
  assert.equal((await fresh.service.catalog()).revision, revision);
  assert.equal((await fresh.service.list({ workspaceId: W })).documents.length, 2, "nothing is overwritten");
});

test("comments and runtime travel only when included; a different installed type or extension is kept and warned", async t => {
  const s = await source(t), fresh = await host(t);
  let catalog = await fresh.service.catalogMutate({ expectedRevision: 0, action: { type: "type.put", blockType: { ...recipe, name: "Their recipe" } } });
  catalog = await fresh.service.catalogMutate({ expectedRevision: catalog.revision, action: { type: "extension.put", extension: { ...tool("timer", "Timer"), html: "<p>Another timer.</p>" } } });
  const text = (await exportLienzo(s.store, s.media, { workspaceId: W, documentId: s.documentId, comments: false, runtime: false }, APP)).text;
  const done = await importLienzo(fresh.store, fresh.media, { workspaceId: W, text, dryRun: false });
  assert.equal(done.comments, null); assert.equal(done.runtime, false);
  assert.deepEqual(done.blockTypes.map(type => type.status), ["conflict"]); assert.equal(done.extensions.find(e => e.id === "timer")?.status, "conflict");
  assert.equal(done.warnings.length, 2);
  const after = await fresh.service.catalog();
  assert.equal(after.blockTypes.find(type => type.id === "recipe")?.name, "Their recipe", "the installed type is kept");
  assert.equal(after.extensions.find(e => e.id === "timer")?.html, "<p>Another timer.</p>"); assert.equal(after.extensions.find(e => e.id === "timer")?.granted, true);
  assert.deepEqual((await fresh.service.comments({ workspaceId: W, documentId: done.documentId! })).threads, []);
  const view = await fresh.service.read({ workspaceId: W, documentId: done.documentId! });
  assert.deepEqual(view.runtime, { blocks: {}, scopes: {} });
  assert.deepEqual((await fresh.service.extensionStorage({ workspaceId: W, documentId: done.documentId!, extensionId: "timer", action: "get", value: null })).value, null);
});

test("malformed and hostile files are refused with a reason, and leave nothing behind", async t => {
  const s = await source(t), fresh = await host(t);
  const good = JSON.parse((await exportLienzo(s.store, s.media, { workspaceId: W, documentId: s.documentId, comments: false, runtime: false }, APP)).text);
  const attempt = (value: unknown) => importLienzo(fresh.store, fresh.media, { workspaceId: W, text: typeof value === "string" ? value : JSON.stringify(value), dryRun: false });
  await assert.rejects(attempt("{not json"), /VALIDATION: This file is not a Lienzo file: it is not valid JSON/);
  await assert.rejects(attempt({ ...good, format: "paseo-canvas-pack" }), /not a Lienzo file/);
  await assert.rejects(attempt({ ...good, version: 2 }), /newer Lienzo/);
  await assert.rejects(attempt({ ...good, surprise: true }), /damaged or was changed/, "unknown fields are refused");
  await assert.rejects(attempt({ ...good, document: { ...good.document, blocks: [{ ...good.document.blocks[0], script: "x" }] } }), /damaged or was changed/);
  await assert.rejects(attempt(JSON.stringify(good).replace('"catalog":{', '"catalog":{"__proto__":{"polluted":true},')), /VALIDATION|reserved|prototype/i);
  const key = `${sha(PNG)}.png`;
  await assert.rejects(attempt({ ...good, media: { [key]: { type: "image/png", data: toBase64(new Uint8Array([1, 2, 3])) } } }), /does not match its name/);
  await assert.rejects(attempt({ ...good, media: { [key]: { type: "image/png", data: "A".repeat(Math.ceil(10 * 1024 * 1024 * 4 / 3) + 8) } } }), /up to 10 MB/, "oversized media");
  // An SVG with a script is refused even when its name matches its bytes.
  const evil = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), evilKey = `${sha(evil)}.svg`;
  await assert.rejects(attempt({ ...good, document: { ...good.document, blocks: [{ ...good.document.blocks[0], data: { ...good.document.blocks[0].data, url: `lienzo-media:${evilKey}` } }, ...good.document.blocks.slice(1)] }, media: { [evilKey]: { type: "image/svg+xml", data: toBase64(evil) } } }), /refused|scripts/);
  // A block type the file does not bring.
  await assert.rejects(attempt({ ...good, catalog: { blockTypes: [], extensions: [] } }), /UNKNOWN_TYPE/);
  assert.equal((await fresh.service.list({ workspaceId: W })).documents.length, 0);
  assert.deepEqual(await readdir(join(fresh.directory, "media")).catch(() => []), [], "no image was left behind");
  assert.equal((await fresh.service.catalog()).revision, 0);
});

test("an SVG is cleaned again on import and its reference follows; a missing image is a warning, not a failure", async t => {
  const fresh = await host(t);
  const raw = new TextEncoder().encode('<?xml version="1.0"?>\n<!-- hand drawn -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#123"/></svg>'), key = `${sha(raw)}.svg`;
  const lost = `lienzo-media:${"0".repeat(64)}.png`;
  const file = { format: "lienzo", version: 1, exportedAt: "2026-10-19T00:00:00.000Z", app: APP, media: { [key]: { type: "image/svg+xml", data: toBase64(raw) } },
    document: { title: "Shapes", communication: { instructions: "" }, groups: [], blocks: [
      { id: "s", typeId: "media", title: "Square", data: { url: `lienzo-media:${key}`, caption: "", mediaKind: "image" } },
      { id: "m", typeId: "media", title: "Lost", data: { url: lost, caption: "", mediaKind: "image" } }] } };
  const done = await importLienzo(fresh.store, fresh.media, { workspaceId: W, text: JSON.stringify(file), dryRun: false });
  assert.equal(done.images.missing, 1); assert.match(done.warnings.join(" "), /One image was not in the file/);
  const view = await fresh.service.read({ workspaceId: W, documentId: done.documentId! }), url = view.document.blocks[0].data.url as string;
  assert.notEqual(url, `lienzo-media:${key}`, "the cleaned SVG has its own name"); assert.equal(view.document.blocks[1].data.url, lost);
  assert.doesNotMatch(Buffer.from((await fresh.media.read(url)).data, "base64").toString(), /hand drawn/);
});

test("size cap: a file over 50 MB is refused on both sides", async t => {
  const fresh = await host(t);
  await assert.rejects(importLienzo(fresh.store, fresh.media, { workspaceId: W, text: " ".repeat(LIENZO_FILE.maxBytes + 1), dryRun: true }), (e: Error) => /TOO_LARGE: A \.lienzo file can be up to 50 MB/.test(e.message));
  assert.equal(rpc.importLienzo.input.safeParse({ workspaceId: W, text: "x".repeat(LIENZO_FILE.maxBytes + 1) }).success, false);
  // Six 9 MB images: each fine on its own, too much together. The media store is a stand-in that holds nothing on disk.
  const s = await host(t), refs = Array.from({ length: 6 }, (_, i) => `lienzo-media:${String(i).repeat(64)}.png`), big = "A".repeat(12 * 1024 * 1024);
  await s.service.create({ workspaceId: W, id: "heavy", content: documentContentSchema.parse({ title: "Heavy", communication: { instructions: "" }, groups: [], blocks: refs.map((url, i) => ({ id: `i${i}`, typeId: "media", title: "Image", data: { url, caption: "", mediaKind: "image" } })) }) });
  const media = { read: async () => ({ mime: "image/png", data: big, bytes: 9 * 1024 * 1024 }) } as unknown as MediaStore;
  await assert.rejects(exportLienzo(s.store, media, { workspaceId: W, documentId: "heavy", comments: false, runtime: false }, APP), /TOO_LARGE: This Lienzo is .* MB with its images; a \.lienzo file can be up to 50 MB/);
});

test("names: file names keep the title's words, titles get (imported) only on a collision", () => {
  assert.equal(lienzoFileName("Mi Lienzo: v2 / final?"), "Mi Lienzo v2 final.lienzo"); assert.equal(lienzoFileName("..."), "Lienzo.lienzo");
  assert.equal(importedTitle("A", ["B"]), "A"); assert.equal(importedTitle("A", ["A", "A (imported)"]), "A (imported 2)");
  assert.equal(importedTitle("x".repeat(300), ["x".repeat(300)]).length, 300);
  assert.equal(LIENZO_FILE_MAX_BYTES, LIENZO_FILE.maxBytes, "the desktop shell reads files up to the same cap");
  assert.ok(isLienzoPath("/home/a/Kitchen.LIENZO")); assert.ok(!isLienzoPath("--flag.lienzo")); assert.ok(!isLienzoPath("notes.json"));
  assert.deepEqual([...mediaRefsIn({ a: [`lienzo-media:${"a".repeat(64)}.png`, "lienzo-media:nope"], b: { c: `lienzo-media:${"b".repeat(64)}.svg` } })].length, 2);
});

test("the desktop host serves both RPCs", async t => {
  const directory = await mkdtemp(join(tmpdir(), "lienzo-file-desktop-")), app = await startDesktop({ dataDirectory: directory, version: "test", mcpPort: 0 });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const created = await app.settle("canvas.create", { workspaceId: "desktop", content: { title: "Desk", communication: { instructions: "" }, groups: [], blocks: [{ id: "n", typeId: "note", title: "N", data: { text: "Hi" } }] } }) as { ok: true; value: { document: { id: string } } };
  const exported = await app.settle("canvas.lienzo.export", { workspaceId: "desktop", documentId: created.value.document.id }) as { ok: true; value: { text: string; fileName: string } };
  assert.equal(exported.ok, true); assert.equal(exported.value.fileName, "Desk.lienzo");
  const review = await app.settle("canvas.lienzo.import", { workspaceId: "desktop", text: exported.value.text, dryRun: true }) as { ok: true; value: { importTitle: string; committed: boolean } };
  assert.equal(review.value.importTitle, "Desk (imported)"); assert.equal(review.value.committed, false);
  const bad = await app.settle("canvas.lienzo.import", { workspaceId: "desktop", text: "[]" }) as { ok: false; message: string };
  assert.equal(bad.ok, false); assert.match(bad.message, /not a Lienzo file/);
});
