import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCS_LIMITS, extensionDocsIssue, parseInline, parseMarkdown, sanitizeMarkdown } from "../plugin/shared/markdown";
import { extensionSchema, packSchema, type CanvasCatalog } from "../plugin/shared/model";
import { downloadEntry, loadIndex, cachedIndex, marketplaceIndexSchema, marketplaceUrls, MarketplaceError, MARKETPLACE_MESSAGES, submission, type MarketplaceDeps } from "../plugin/shared/marketplace";
import { EXAMPLE_FILE } from "../plugin/shared/wiki";
import { entryStatus, exportOne, extensionActions, filterEntries, publishPlan } from "../plugin/client/screens";
import type { CatalogExtension } from "../plugin/shared/model";
import type { CanvasService } from "../plugin/server/service";
import { setup } from "./helpers";

const root = join(import.meta.dirname, "..");
const base = { id: "kit.tool", kind: "tool", api: 1, name: "Tool", html: "<p>x</p>", permissions: [] } as const;

test("extension docs: the Markdown dialect, drawn as data, never as HTML", () => {
  const blocks = parseMarkdown("# Title\n\nSome *soft* and **strong** `code` with [a link](https://example.com/a?b=1) and [bad](javascript:alert) <b>tags</b>.\n\n- one\n- two\n  continued\n\n1. first\n2. second\n\n```html\n<script>kept as code</script>\n```\n\n> A note.");
  assert.deepEqual(blocks.map(b => b.kind), ["heading", "paragraph", "list", "list", "code", "note"]);
  const paragraph = blocks[1] as { inlines: { kind: string; text: string; href?: string }[] };
  assert.deepEqual(paragraph.inlines.map(i => i.kind), ["text", "italic", "text", "bold", "text", "code", "text", "link", "text"]);
  assert.equal(paragraph.inlines.find(i => i.kind === "link")!.href, "https://example.com/a?b=1");
  assert.ok(!paragraph.inlines.some(i => i.text.includes("<") || i.href?.startsWith("javascript")), "tags removed, unsafe link shown as text");
  assert.match(paragraph.inlines.map(i => i.text).join(""), /bad tags/);
  assert.deepEqual((blocks[2] as { items: unknown[][] }).items.length, 2);
  assert.equal((blocks[4] as { text: string }).text, "<script>kept as code</script>", "code is kept verbatim, as text");
  assert.equal(sanitizeMarkdown("a\u0000b<i>c</i>‮d `<i>`"), "abcd `<i>`");
  assert.deepEqual(parseInline("[x](help:make.overview)"), [{ kind: "link", text: "x", href: "help:make.overview" }]);
  assert.deepEqual(parseInline("[x](mailto:a@b.co)")[0], { kind: "link", text: "x", href: "mailto:a@b.co" });
  assert.deepEqual(parseInline("[x](file:///etc/passwd)"), [{ kind: "text", text: "x" }]);
});

test("extension docs: validated for size, sections, HTML and link targets", () => {
  assert.equal(extensionDocsIssue("# Use it\n\nPress `<b>` in a code span.\n\n```html\n<div></div>\n```"), null);
  assert.match(extensionDocsIssue("x".repeat(DOCS_LIMITS.chars + 1))!, /at most/);
  assert.match(extensionDocsIssue(Array.from({ length: DOCS_LIMITS.sections + 1 }, (_, i) => ({ title: `S${i}`, body: "b" })))!, /sections/);
  assert.match(extensionDocsIssue("Hello <img src=x onerror=alert(1)>")!, /HTML/);
  assert.match(extensionDocsIssue("<script>alert(1)</script>")!, /HTML/);
  assert.match(extensionDocsIssue("[go](javascript:alert(1))")!, /Links/);
  assert.match(extensionDocsIssue("[go](data:text/html,hi)")!, /Links/);
  assert.ok(extensionSchema.safeParse({ ...base, docs: "Fine." }).success);
  assert.ok(extensionSchema.safeParse({ ...base, docs: [{ title: "Use", body: "Fine." }] }).success);
  assert.ok(!extensionSchema.safeParse({ ...base, docs: "" }).success);
  assert.ok(!extensionSchema.safeParse({ ...base, docs: "<iframe src=x>" }).success);
  assert.ok(!extensionSchema.safeParse({ ...base, docs: [{ title: "Use", body: "ok", extra: 1 }] }).success);
  assert.ok(extensionSchema.safeParse(base).success, "docs is optional: API 1 files without it still load");
});

test("extension docs: imported with the file, kept through export, refused when unsafe", async t => {
  const { service } = await setup(t), catalog = await service.catalog();
  const file = { format: "paseo-canvas-pack", version: 1, id: "kit", name: "Kit", description: "", blockTypes: [], templates: [], documents: [], extensions: [{ ...base, docs: "# Tool\n\nUse it." }] };
  const imported = await service.importPack({ pack: file, expectedRevision: catalog.revision, replace: false, dryRun: false });
  const installed = imported.catalog.extensions.find(e => e.id === "kit.tool")!;
  assert.equal(installed.docs, "# Tool\n\nUse it.");
  assert.equal(exportOne(installed).extensions[0].docs, "# Tool\n\nUse it.", "export keeps the docs");
  const unsafe = { ...file, id: "bad", extensions: [{ ...base, id: "bad.tool", docs: "<script>alert(1)</script>" }] };
  assert.equal((await service.validatePack({ pack: unsafe })).valid, false);
});

test("single export: one extension, its own file id, nothing installed-only", () => {
  const extension = { ...base, id: "my-tool", name: "My Tool", description: "Does one thing.", docs: "Help.", source: "local", granted: true } as unknown as CatalogExtension;
  const file = exportOne(extension);
  assert.equal(file.id, "my-tool"); assert.equal(file.extensions.length, 1); assert.equal(file.extensions[0].id, "my-tool.my-tool");
  assert.ok(!("source" in file.extensions[0]) && !("granted" in file.extensions[0]));
  assert.ok(packSchema.safeParse(file).success);
});

async function builtIndex(t: { after(fn: () => Promise<void>): void }, extra?: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "lienzo-catalog-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "extensions/title-case"), { recursive: true });
  await writeFile(join(dir, "extensions/title-case/extension.json"), await readFile(join(root, "marketplace/extensions/title-case/extension.json")));
  await extra?.(dir);
  const run = (...args: string[]) => execFileSync(process.execPath, [join(root, "marketplace/scripts/build-index.mjs"), "--root", dir, "--repository", "owner/catalog", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { dir, run };
}

test("catalog: CI's index builder writes an index the app accepts, and refuses bad folders", async t => {
  const { dir, run } = await builtIndex(t);
  assert.match(run("--check"), /valid: 1 file/);
  run();
  const text = await readFile(join(dir, "index.json"), "utf8"), index = marketplaceIndexSchema.parse(JSON.parse(text));
  assert.equal(index.repository, "owner/catalog");
  const entry = index.entries[0], bytes = await readFile(join(dir, entry.path));
  assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex")); assert.equal(entry.bytes, bytes.length);
  assert.deepEqual(entry.extensions[0], { id: "title-case.title-case", name: "Title Case", description: EXAMPLE_FILE.description, icon: "CaseSensitive", permissions: ["edit"], docs: true, actions: ["titleCase"] });
  run(); assert.equal(await readFile(join(dir, "index.json"), "utf8"), text, "an unchanged catalog writes the same index");
  // The committed example index is valid too.
  marketplaceIndexSchema.parse(JSON.parse(await readFile(join(root, "marketplace/index.json"), "utf8")));
  const bad = async (name: string, file: unknown, pattern: RegExp, extraFile?: string) => {
    const { run } = await builtIndex(t, async d => { await mkdir(join(d, "extensions", name), { recursive: true }); await writeFile(join(d, "extensions", name, "extension.json"), JSON.stringify(file)); if (extraFile) await writeFile(join(d, "extensions", name, extraFile), "x"); });
    assert.throws(() => run("--check"), (e: { stderr?: string }) => pattern.test(e.stderr ?? ""), name);
  };
  const good = (id: string, patch: object = {}) => ({ ...EXAMPLE_FILE, id, extensions: [{ ...EXAMPLE_FILE.extensions[0], id: `${id}.tool`, ...patch }] });
  await bad("wrong-folder", good("other"), /id must be "wrong-folder"/);
  await bad("ns", { ...good("ns"), extensions: [{ ...EXAMPLE_FILE.extensions[0], id: "elsewhere.tool" }] }, /must start with "ns\."/);
  await bad("html-docs", good("html-docs", { docs: "<script>x</script>" }), /no HTML/);
  await bad("perm", good("perm", { permissions: ["agent"] }), /permissions/);
  await bad("legacy", { ...good("legacy"), blockTypes: [{}] }, /extensions only/);
  await bad("stray", good("stray"), /only extension\.json/, "run.sh");
  await bad("dupe", { ...good("dupe"), extensions: [{ ...EXAMPLE_FILE.extensions[0], id: "title-case.title-case" }] }, /must start with "dupe\."/);
});

function fakeDeps(routes: Record<string, string | Error>, kept: { value: string | null } = { value: null }) {
  const calls: string[] = [];
  const deps: MarketplaceDeps = {
    fetchText: async (url, limit) => { calls.push(url); const answer = routes[url]; if (answer === undefined || answer instanceof Error) throw answer ?? new Error("404"); if (answer.length > limit) throw new Error("The file is larger than 1 MB."); return answer; },
    cache: { read: () => kept.value, write: text => { kept.value = text; } },
    sha256: async text => createHash("sha256").update(text).digest("hex"), now: () => 1_000_000,
  };
  return { deps, calls, kept };
}

test("Discover: the index from the network, kept for offline use, with a clear offline state", async () => {
  const fileText = JSON.stringify(EXAMPLE_FILE, null, 2), urls = marketplaceUrls();
  const index = { format: "lienzo-extension-index", version: 1, repository: "Gabsplat/lienzo-extensions", generatedAt: "2026-10-18T00:00:00.000Z",
    entries: [{ id: "title-case", name: "Title Case", description: "d", extensions: [{ id: "title-case.title-case", name: "Title Case", description: EXAMPLE_FILE.description, permissions: ["edit"], docs: true }], path: "extensions/title-case/extension.json", sha256: createHash("sha256").update(fileText).digest("hex"), bytes: fileText.length }] };
  const online = fakeDeps({ [urls.index]: JSON.stringify(index), [urls.raw(index.entries[0].path)]: fileText });
  assert.equal(cachedIndex(online.deps), null);
  const first = await loadIndex(online.deps);
  assert.equal(first.source, "network"); assert.equal(first.index.entries.length, 1); assert.ok(online.kept.value, "kept");
  assert.equal(online.calls[0], "https://raw.githubusercontent.com/Gabsplat/lienzo-extensions/main/index.json");
  // Offline: the kept list, saying why it is stale.
  const offline = fakeDeps({ [urls.index]: new Error("network down") }, online.kept);
  const stale = await loadIndex(offline.deps);
  assert.equal(stale.source, "cache"); assert.equal(stale.stale, MARKETPLACE_MESSAGES.offline); assert.equal(stale.fetchedAt, 1_000_000);
  // A broken index never replaces the kept one.
  const broken = fakeDeps({ [urls.index]: "{\"format\":\"nope\"}" }, online.kept);
  assert.equal((await loadIndex(broken.deps)).stale, MARKETPLACE_MESSAGES.invalid);
  assert.equal(JSON.parse(online.kept.value!).text, JSON.stringify(index));
  // Nothing kept and no network: a MarketplaceError with words for the screen.
  await assert.rejects(loadIndex(fakeDeps({}).deps), (e: unknown) => e instanceof MarketplaceError && e.message === MARKETPLACE_MESSAGES.offline);
  // Another repository is one config away.
  const other = fakeDeps({ "https://raw.githubusercontent.com/someone/catalog/dev/index.json": JSON.stringify(index) });
  assert.equal((await loadIndex(other.deps, { repository: "someone/catalog", branch: "dev" })).source, "network");
  // Search and status.
  assert.equal(filterEntries(first.index.entries, "title").length, 1); assert.equal(filterEntries(first.index.entries, "zzz").length, 0);
  assert.equal(entryStatus(first.index.entries[0], { packs: [] }), "new");
});

test("Discover: installing downloads the file, checks it against the index, then goes through the usual review", async t => {
  const { service } = await setup(t), fileText = JSON.stringify(EXAMPLE_FILE, null, 2), urls = marketplaceUrls(), path = "extensions/title-case/extension.json";
  const entry = { id: "title-case", name: "Title Case", description: "d", extensions: [{ id: "title-case.title-case", name: "Title Case", description: EXAMPLE_FILE.description, permissions: ["edit" as const], docs: true, actions: ["titleCase"] }], path, sha256: createHash("sha256").update(fileText).digest("hex"), bytes: fileText.length };
  const { deps } = fakeDeps({ [urls.raw(path)]: fileText });
  let shown: CanvasCatalog | null = null;
  const host = { api: { catalog: () => service.catalog(), validate: (input: { pack: unknown }) => service.validatePack(input), import: (input: { pack: unknown; expectedRevision: number; replace: boolean; dryRun: boolean }) => service.importPack(input), catalogMutate: (input: Parameters<CanvasService["catalogMutate"]>[0]) => service.catalogMutate(input) }, setCatalog: (c: CanvasCatalog) => { shown = c; } };
  const actions = extensionActions(host as never);
  const review = await actions.review(await downloadEntry(deps, entry));
  assert.deepEqual(review.diff.added, ["title-case.title-case"]); assert.equal(review.installed, false);
  assert.equal((await service.catalog()).extensions.length, 0, "the review saves nothing");
  assert.ok(await actions.install(review, false));
  const installed = shown!.extensions.find(e => e.id === "title-case.title-case")!;
  assert.equal(installed.source, "title-case"); assert.equal(installed.granted, false, "from the catalog it holds no permission until allowed");
  assert.equal(entryStatus(entry, shown), "installed");
  assert.equal(entryStatus({ ...entry, extensions: [{ ...entry.extensions[0], description: "New words" }] }, shown), "update");
  // A file that differs from the index, or names another id, is refused before any review.
  await assert.rejects(downloadEntry(fakeDeps({ [urls.raw(path)]: fileText + " " }).deps, entry), (e: unknown) => e instanceof MarketplaceError && e.reason === "changed");
  const other = JSON.stringify({ ...EXAMPLE_FILE, id: "other" });
  await assert.rejects(downloadEntry({ ...fakeDeps({ [urls.raw(path)]: other }).deps, sha256: undefined }, entry), (e: unknown) => e instanceof MarketplaceError && e.reason === "changed");
  await assert.rejects(downloadEntry(fakeDeps({}).deps, entry), (e: unknown) => e instanceof MarketplaceError && e.reason === "file");
  await assert.rejects(downloadEntry(fakeDeps({ [urls.raw(path)]: "x".repeat(1024 * 1024 + 1) }).deps, entry), (e: unknown) => e instanceof MarketplaceError && e.reason === "large");
});

test("Publish: checks the extension, saves extension.json, and opens GitHub's web flow without a token", () => {
  const mine = { ...EXAMPLE_FILE.extensions[0], id: "title-case", source: "local", granted: true } as unknown as CatalogExtension;
  const plan = publishPlan(mine);
  assert.deepEqual(plan.issues, []); assert.deepEqual(plan.warnings, []);
  assert.equal(plan.fileName, "extension.json"); assert.equal(plan.path, "extensions/title-case/extension.json");
  assert.deepEqual(JSON.parse(plan.text), EXAMPLE_FILE, "the file is what the catalog holds");
  assert.equal(plan.method, "prefilled", "a 2 KB file fits in GitHub's new-file link");
  assert.ok(plan.url.startsWith("https://github.com/Gabsplat/lienzo-extensions/new/main?filename=extensions%2Ftitle-case%2Fextension.json&value=%7B"));
  assert.deepEqual(JSON.parse(decodeURIComponent(new URL(plan.url).searchParams.get("value")!)), EXAMPLE_FILE);
  const long = publishPlan({ ...mine, html: "<p>" + "x".repeat(20000) + "</p>" } as CatalogExtension);
  assert.equal(long.method, "upload", "a longer file goes to the folder's upload page");
  assert.equal(long.url, "https://github.com/Gabsplat/lienzo-extensions/upload/main/extensions/title-case");
  const small = submission({ id: "tiny" }, "{\"a\":1}");
  assert.equal(small.method, "prefilled");
  assert.equal(small.url, "https://github.com/Gabsplat/lienzo-extensions/new/main?filename=extensions%2Ftiny%2Fextension.json&value=%7B%22a%22%3A1%7D");
  const bare = publishPlan({ ...mine, description: "", docs: undefined, permissions: ["network"] } as CatalogExtension);
  assert.equal(bare.issues.length, 0); assert.equal(bare.warnings.length, 3);
  const imported = publishPlan({ ...mine, source: "someone" } as CatalogExtension);
  assert.match(imported.issues[0], /Only extensions made here/);
  assert.ok(!/token|Authorization/i.test(plan.url));
});
