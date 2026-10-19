import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { startDesktop } from "../apps/desktop/src/main/core";
import { interfacePreferences } from "../plugin/shared/preferences";
import { LIENZO_THEMES, adoptAppearance, chooseAppearance, getAppearance, nextAppearance, resolveDark, subscribeAppearance, themeFor } from "../plugin/client/appearance";
import { attentionSection, createSectionMemory, sectionScope } from "../plugin/client/property-model";
import { MediaStore } from "../plugin/server/media";
import { MEDIA_LIMITS, fromBase64, inlineImage, isLocalImage, parseMediaRef, prepareImage, sniffImage, toBase64 } from "../plugin/shared/media";
import { imageFiles, imageTitle, storeImage, type MediaHost } from "../plugin/client/media-store";
import { mediaSource } from "../plugin/client/media";
import { validateBlockData } from "../plugin/server/reducer";
import { builtinTypes } from "../plugin/shared/builtins";
import type { BlockType, CanvasBlock, CanvasDocument } from "../plugin/shared/model";

async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "lienzo-ui-prefs-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
// A 1×1 PNG, a JPEG header, a GIF header, a WebP header: what the sniffer reads.
const PNG = fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const GIF = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000");
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const SVG = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- drawn by hand -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c33"/></svg>';
const file = (name: string, bytes: Uint8Array, type = "") => ({ name, type, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer });

// ---- Appearance ------------------------------------------------------------------------------------------------------

test("appearance: System follows the host, Light and Dark use Papel and Tinta, and applying twice changes nothing", () => {
  const paseo = { colors: { ...LIENZO_THEMES.light.colors, accent: "#123456" } };
  assert.equal(themeFor("system", paseo), paseo);
  assert.equal(themeFor("light", paseo), LIENZO_THEMES.light);
  assert.equal(themeFor("dark", paseo), LIENZO_THEMES.dark);
  assert.equal(themeFor("dark", themeFor("dark", paseo)), LIENZO_THEMES.dark);
  assert.equal(LIENZO_THEMES.dark.colors.surface0, "#141311");
  assert.equal(resolveDark("system", true), true); assert.equal(resolveDark("system", false), false);
  assert.equal(resolveDark("light", true), false); assert.equal(resolveDark("dark", false), true);
  assert.deepEqual(["system", "light", "dark"].map(a => nextAppearance(a as never)), ["light", "dark", "system"]);
});

test("appearance: a choice applies at once and wins over a stale saved value until its save settles", () => {
  let heard = 0; const stop = subscribeAppearance(() => heard++);
  try {
    adoptAppearance("dark", true); assert.equal(getAppearance(), "dark");
    chooseAppearance("light"); assert.equal(getAppearance(), "light");
    adoptAppearance("dark"); assert.equal(getAppearance(), "light", "the old saved value does not undo a fresh choice");
    adoptAppearance("light", true); adoptAppearance("dark"); assert.equal(getAppearance(), "dark", "after the save settles, another client's change applies");
    adoptAppearance("sepia", true); assert.equal(getAppearance(), "system", "unknown values read as System");
    assert.ok(heard >= 4);
  } finally { stop(); adoptAppearance("system", true); }
});

test("appearance persists in the interface settings and the desktop window opens in it after a restart", async t => {
  assert.equal(interfacePreferences.schema.parse({}).appearance, "system");
  assert.equal(interfacePreferences.schema.parse({ appearance: "dark" }).appearance, "dark");
  assert.equal(interfacePreferences.schema.safeParse({ appearance: "sepia" }).success, false);
  const directory = await scratch(t);
  let applied: string[] = [];
  const shell = { openExternal: async () => false, writeClipboard: async () => false, setAppearance: (a: string) => { applied.push(a); } };
  const first = await startDesktop({ dataDirectory: directory, version: "test", mcpPort: 0, shell });
  try {
    assert.equal(await first.appearance(), "system");
    const saved = await first.settle("settings.interface.write", { revision: "0", values: { pinned: [], shortcuts: {}, appearance: "dark" } }) as { ok: boolean };
    assert.ok(saved.ok);
    const told = await first.settle("desktop.appearance", { appearance: "dark" }) as { ok: boolean; value: { applied: boolean } };
    assert.deepEqual(told.value, { applied: true }); assert.deepEqual(applied, ["dark"]);
    assert.equal((await first.settle("desktop.appearance", { appearance: "sepia" }) as { ok: boolean }).ok, false);
  } finally { await first.close(); }
  applied = [];
  const second = await startDesktop({ dataDirectory: directory, version: "test", mcpPort: 0 });
  try {
    assert.equal(await second.appearance(), "dark");
    // Without a shell (the browser preview) the page still switches; the window has nothing to follow.
    assert.deepEqual((await second.settle("desktop.appearance", { appearance: "light" }) as { value: unknown }).value, { applied: false });
  } finally { await second.close(); }
});

// ---- Properties sections ---------------------------------------------------------------------------------------------

test("sections start collapsed, remember what the person opened, and open for one selection when a flow asks", () => {
  const memory = createSectionMemory(), a = sectionScope(["note"]), b = sectionScope(["shader"]);
  assert.equal(memory.isOpen("Content", false, a), false);
  assert.equal(memory.isOpen("This Lienzo", true, a), true, "a panel's only section may start open");
  memory.toggle("Content", false, a);
  assert.equal(memory.isOpen("Content", false, b), true, "kept open on the next selection");
  memory.toggle("Content", false, b); assert.equal(memory.isOpen("Content", false, a), false);
  memory.force("Instructions for the agent", a);
  assert.equal(memory.isOpen("Instructions for the agent", false, a), true);
  assert.equal(memory.isOpen("Instructions for the agent", false, b), false, "a forced section is for its selection only");
  memory.toggle("Instructions for the agent", false, a);
  assert.equal(memory.isOpen("Instructions for the agent", false, a), false, "closing a forced section closes it");
  const before = memory.version(); memory.force("Content", a); memory.force("Content", a); assert.equal(memory.version(), before + 1);
  assert.notEqual(sectionScope(["x"], "link"), sectionScope(["x"]));
});

test("Properties opens Content by itself only when the block has a problem there", () => {
  const type = (renderer: string) => builtinTypes.find(t => t.renderer === renderer)! as BlockType;
  const block = (typeId: string, data: Record<string, unknown>, parentGroupId: string | null = null) => ({ id: "b", typeId, title: "t", data, parentGroupId }) as unknown as CanvasBlock;
  const media = builtinTypes.find(t => t.id === "media")! as BlockType, note = type("note");
  const doc = { blocks: [], groups: [], variables: [{ name: "speed", label: "Speed", min: 0, max: 1, step: .1, initial: 0 }] } as unknown as CanvasDocument;
  assert.equal(attentionSection(note, block(note.id, { ...note.defaults, text: "Hola" })), null);
  assert.equal(attentionSection(media, block("media", { ...media.defaults, url: "" })), "Content");
  assert.equal(attentionSection(media, block("media", { ...media.defaults, url: "https://example.com/a.png" })), null);
  const shader = type("glsl-shader");
  assert.equal(attentionSection(shader, block(shader.id, { ...shader.defaults, question: "Which colour?", fragmentSource: "precision mediump float;\nvoid main(){gl_FragColor=vec4(1.0);}", uniforms: [], builtins: { resolution: false, time: false } })), null, "an empty list is a valid start");
  const controls = type("controls");
  assert.equal(attentionSection(controls, block(controls.id, { ...controls.defaults, variables: [] }), doc), "Content");
  assert.equal(attentionSection(controls, block(controls.id, { ...controls.defaults, variables: ["missing"] }), { ...doc, blocks: [block(controls.id, {})] } as CanvasDocument), "Content");
  assert.equal(attentionSection(undefined, undefined), null);
});

// ---- Images from the computer ----------------------------------------------------------------------------------------

test("images are sniffed by their bytes, never their names, and SVG goes through the sanitizer", () => {
  assert.equal(sniffImage(PNG), "png"); assert.equal(sniffImage(JPEG), "jpg"); assert.equal(sniffImage(GIF), "gif"); assert.equal(sniffImage(WEBP), "webp");
  assert.equal(sniffImage(new TextEncoder().encode("﻿" + SVG)), "svg");
  assert.equal(sniffImage(new TextEncoder().encode("<html><svg></svg></html>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("hello")), null);
  const clean = prepareImage(new TextEncoder().encode(SVG));
  assert.equal(clean.mime, "image/svg+xml"); assert.doesNotMatch(new TextDecoder().decode(clean.bytes), /drawn by hand|<\?xml/);
  assert.throws(() => prepareImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), /scripts/);
  assert.throws(() => prepareImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x/y.png"/></svg>')), /scripts, links/);
  assert.throws(() => prepareImage(new Uint8Array(MEDIA_LIMITS.bytes + 1).fill(0x89)), (e: { code?: string }) => e.code === "TOO_LARGE");
  assert.throws(() => prepareImage(new Uint8Array()), /empty/);
  for (const bytes of [PNG, JPEG, new Uint8Array([1]), new Uint8Array([1, 2]), new Uint8Array(1000).map((_, i) => i * 7)]) assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  assert.equal(toBase64(PNG), Buffer.from(PNG).toString("base64"));
  assert.equal(fromBase64("not base64!"), null);
});

test("the media store keeps one file per picture, caps size, survives a restart and refuses damaged files", async t => {
  const directory = await scratch(t), store = new MediaStore(directory);
  const first = await store.put(toBase64(PNG));
  assert.match(first.url, /^lienzo-media:[a-f0-9]{64}\.png$/); assert.equal(first.mime, "image/png"); assert.equal(first.existed, false);
  const again = await store.put(toBase64(PNG));
  assert.equal(again.url, first.url); assert.equal(again.existed, true, "the same bytes are stored once");
  assert.deepEqual(await readdir(join(directory, "media")), [first.url.slice("lienzo-media:".length)]);
  const svg = await store.put(toBase64(new TextEncoder().encode(SVG)));
  assert.match(svg.url, /\.svg$/);
  assert.doesNotMatch(await readFile(join(directory, "media", svg.url.slice(13)), "utf8"), /drawn by hand/, "the stored SVG is the sanitized one");
  await assert.rejects(store.put(toBase64(new TextEncoder().encode("plain text"))), /VALIDATION|not a PNG/);
  await assert.rejects(store.put("@@@@"), /VALIDATION/);
  await assert.rejects(store.put("A".repeat(Math.ceil(MEDIA_LIMITS.bytes * 4 / 3) + 8)), (e: { code?: string }) => e.code === "TOO_LARGE");
  // A new store on the same directory: what the app sees after a restart.
  const reopened = new MediaStore(directory), read = await reopened.read(first.url);
  assert.equal(read.mime, "image/png"); assert.deepEqual(new Uint8Array(Buffer.from(read.data, "base64")), PNG);
  await assert.rejects(reopened.read("lienzo-media:" + "0".repeat(64) + ".png"), (e: { code?: string }) => e.code === "NOT_FOUND");
  await assert.rejects(reopened.read("https://example.com/a.png"), /VALIDATION/);
  await writeFile(join(directory, "media", first.url.slice(13)), "tampered");
  await assert.rejects(reopened.read(first.url), /damaged/);
});

test("both hosts store images over RPC; the desktop keeps them in userData/canvas/media", async t => {
  const directory = await scratch(t), app = await startDesktop({ dataDirectory: directory, version: "test", mcpPort: 0 });
  t.after(() => app.close());
  const put = await app.settle("canvas.media.put", { workspaceId: "desktop", data: toBase64(PNG), name: "dot.png" }) as { ok: boolean; value: { url: string } };
  assert.ok(put.ok);
  assert.equal((await readdir(join(directory, "canvas", "media"))).length, 1);
  const read = await app.settle("canvas.media.read", { workspaceId: "desktop", url: put.value.url }) as { ok: boolean; value: { data: string } };
  assert.equal(read.value.data, toBase64(PNG));
  const refused = await app.settle("canvas.media.put", { workspaceId: "desktop", data: toBase64(new TextEncoder().encode("<html></html>")) }) as { ok: boolean; message: string };
  assert.equal(refused.ok, false); assert.match(refused.message, /VALIDATION/);
});

test("image blocks accept stored and small inline images; everything else still needs http(s)", () => {
  const media = builtinTypes.find(t => t.id === "media")! as BlockType, preview = builtinTypes.find(t => t.renderer === "preview-frame")! as BlockType;
  const block = (typeId: string, url: string) => ({ id: "b", typeId, title: "t", data: { ...(typeId === "media" ? media : preview).defaults, url }, parentGroupId: null }) as unknown as CanvasBlock;
  const ref = "lienzo-media:" + "a".repeat(64) + ".webp", inline = `data:image/png;base64,${toBase64(PNG)}`;
  assert.doesNotThrow(() => validateBlockData(block("media", ref), media));
  assert.doesNotThrow(() => validateBlockData(block("media", inline), media));
  assert.throws(() => validateBlockData(block(preview.id, ref), preview), /HTTP or HTTPS/);
  assert.throws(() => validateBlockData(block("media", "data:text/html;base64,PGgxPg=="), media), /HTTP or HTTPS/);
  assert.throws(() => validateBlockData(block("media", "data:image/png;base64," + toBase64(JPEG)), media), /HTTP or HTTPS/, "the bytes must be what the URL claims");
  assert.throws(() => validateBlockData(block("media", "lienzo-media:../../etc/passwd.png"), media), /HTTP or HTTPS/);
  assert.equal(isLocalImage(`data:image/png;base64,${toBase64(new Uint8Array(MEDIA_LIMITS.inlineBytes + 8).fill(0x89))}`), false, "inline images stay small");
  assert.deepEqual(parseMediaRef(ref), { hash: "a".repeat(64), extension: "webp", mime: "image/webp" });
  assert.ok(inlineImage(`data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(SVG))}`));
  assert.equal(inlineImage(`data:image/svg+xml;base64,${toBase64(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))}`), null);
  assert.deepEqual(mediaSource(ref), { kind: "image", url: ref, local: true });
  assert.equal(mediaSource("lienzo-media:nope.png"), null);
});

test("adding an image stores it with the host, falls back inline when the host cannot, and says why it refuses", async () => {
  const calls: unknown[] = [];
  const host: MediaHost = { put: async input => { calls.push(input); return { url: "lienzo-media:" + "b".repeat(64) + ".png", mime: "image/png", bytes: PNG.length, existed: false }; }, read: async () => ({ mime: "image/png", data: "" }) };
  const stored = await storeImage(file("dot.png", PNG, "image/png"), host);
  assert.equal(stored.inline, false); assert.match(stored.url, /^lienzo-media:/); assert.deepEqual(calls, [{ data: toBase64(PNG), name: "dot.png" }]);
  const old: MediaHost = { ...host, put: async () => { throw new Error("NOT_FOUND: Unknown method canvas.media.put."); } };
  const inline = await storeImage(file("dot.png", PNG), old);
  assert.equal(inline.inline, true); assert.ok(isLocalImage(inline.url));
  const big = new Uint8Array(MEDIA_LIMITS.inlineBytes + 10); big.set(PNG);
  await assert.rejects(storeImage(file("big.png", big), old), /cannot store image files/);
  await assert.rejects(storeImage(file("big.png", big), { ...host, put: async () => { throw new Error("TOO_LARGE: x"); } }), /TOO_LARGE/, "real refusals are not hidden by the fallback");
  await assert.rejects(storeImage(file("notes.png", new TextEncoder().encode("hello")), host), /“notes.png”: That file is not a PNG/);
  await assert.rejects(storeImage({ ...file("huge.png", PNG), size: MEDIA_LIMITS.bytes + 1 }, host), /over 10 MB/);
  assert.deepEqual(imageFiles([{ name: "a.PNG" }, { name: "b.txt" }, { name: "shot", type: "image/png" }, { name: "c.svg" }, { name: "d.heic", type: "image/heic" }]).map(f => f.name), ["a.PNG", "shot", "c.svg"]);
  assert.equal(imageTitle("Screen_Shot-2026.png"), "Screen Shot 2026"); assert.equal(imageTitle(".png"), "Image");
});
