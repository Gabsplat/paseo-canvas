import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinTypes } from "../plugin/shared/builtins";
import { rendererSpecs } from "../plugin/shared/renderers";
import { packSchema, extensionSchema, type CanvasCatalog } from "../plugin/shared/model";
import { parsePack } from "../plugin/server/catalog";
import { ToolRouter } from "../plugin/server/tools";
import { EXTENSION_GUIDE } from "../plugin/shared/extensions";
import { ART, EXAMPLE_EXTENSION, EXAMPLE_FILE, EXAMPLE_HTML, WIKI_SECTIONS, allWikiPages, extensionPage, getWikiPage, pageForBlockType, pageForSelection, pageText, searchWiki, wikiContents, wikiOutline, wikiPageMarkdown, wikiPages } from "../plugin/shared/wiki";
import { parseMarkdown } from "../plugin/shared/markdown";
import { DEFAULT_SHORTCUTS } from "../plugin/client/shortcuts";
import { generated } from "../scripts/help-docs";
import { setup, workspaceId } from "./helpers";

const root = join(import.meta.dirname, "..");

test("Help: every built-in block type has exactly one page, and every renderer is covered", () => {
  for (const type of builtinTypes) {
    const pages = wikiPages.filter(page => page.blockTypes?.includes(type.id));
    assert.equal(pages.length, 1, `block type ${type.id} has ${pages.length} pages`);
    assert.equal(pageForBlockType(type.id)?.id, pages[0].id);
  }
  for (const spec of rendererSpecs) assert.ok(pageForBlockType(spec.blockType.id), `renderer ${spec.id}`);
  const known = new Set(builtinTypes.map(type => type.id));
  for (const page of wikiPages) for (const id of page.blockTypes ?? []) assert.ok(known.has(id), `${page.id} names unknown type ${id}`);
});

test("Help: the sections asked for, unique ids, and every reference resolves", () => {
  assert.deepEqual(WIKI_SECTIONS.map(s => s.title), ["Start here", "Drawing", "Shapes", "Text", "Frames", "Sheets", "Windows & media", "Interactive blocks", "Mini apps", "Lenses", "Shortcuts", "Agents", "Extensions", "Make your own"]);
  assert.equal(new Set(wikiPages.map(p => p.id)).size, wikiPages.length, "page ids are unique");
  for (const section of wikiOutline(wikiPages)) assert.ok(section.pages.length, section.title);
  assert.equal(wikiOutline(wikiPages).length, WIKI_SECTIONS.length, "no empty section");
  const shortcuts = new Set(DEFAULT_SHORTCUTS.map(s => s.id));
  for (const page of wikiPages) {
    assert.ok(page.title && page.summary && page.purpose && page.icon, page.id);
    assert.ok(page.art in ART, `${page.id} art ${page.art}`);
    if (page.shortcut) assert.ok(shortcuts.has(page.shortcut), `${page.id} shortcut ${page.shortcut}`);
    for (const id of page.related ?? []) assert.ok(getWikiPage(id), `${page.id} links to missing ${id}`);
    for (const block of parseMarkdown(page.body ?? "")) if (block.kind !== "code") for (const inline of block.kind === "list" ? block.items.flat() : block.inlines) if (inline.kind === "link" && inline.href.startsWith("help:")) assert.ok(getWikiPage(inline.href.slice(5)), `${page.id} links to missing ${inline.href}`);
  }
  // Every tool of the toolbar and every lens has a page.
  for (const id of ["tool.select", "tool.hand", "tool.pencil", "tool.rectangle", "tool.text", "tool.arrow", "tool.eraser", "tool.marco", "tool.ventana", "lens.cycle", "palette.open", "help.shortcuts"]) assert.ok(wikiPages.some(p => p.shortcut === id), id);
  assert.equal(wikiPages.filter(p => p.section === "lenses").length, 4, "one page per lens and the overview");
  assert.ok(wikiPages.filter(p => p.section === "make").length >= 6, "the tutorial walks through its steps");
});

test("Help: written in English, with Lienzo the only Spanish word", () => {
  for (const page of wikiPages) {
    const text = pageText(page).replace(/[a-z0-9-]+\.[a-z-]+\(|`[^`]*`/g, "");
    assert.doesNotMatch(text, /\b(Marco|Marcos|Hoja|Hojas|Lente|Lentes|Ventana|Ventanas|mirá|esto|Dale|Listo)\b/, page.id);
  }
});

test("Help: search across every page, ignoring accents and case, titles first", () => {
  assert.equal(searchWiki(wikiPages, "frame")[0].id, "frames.frame");
  assert.equal(searchWiki(wikiPages, "FRÁME layout")[0].id, "frames.layout");
  assert.ok(searchWiki(wikiPages, "youtube").some(p => p.id === "windows.media"), "keywords");
  assert.ok(searchWiki(wikiPages, "setState").some(p => p.id === "mini.state"), "words from the page body too");
  assert.ok(searchWiki(wikiPages, "pull request").some(p => p.id === "ext.publish"));
  assert.deepEqual(searchWiki(wikiPages, "zzz nothing"), []);
  assert.deepEqual(searchWiki(wikiPages, "  "), []);
});

test("Help: the ? of Properties opens the page of what is selected", () => {
  assert.equal(pageForSelection({ kind: "block", typeId: "wb-shape" }), "shapes.shapes");
  assert.equal(pageForSelection({ kind: "block", typeId: "html" }), "mini.app");
  assert.equal(pageForSelection({ kind: "block", typeId: "unknown-type" }), "text.card");
  assert.equal(pageForSelection({ kind: "frame", sheet: false }), "frames.frame");
  assert.equal(pageForSelection({ kind: "frame", sheet: true }), "sheets.sheets");
  assert.equal(pageForSelection({ kind: "link" }), "drawing.links");
  assert.equal(pageForSelection({ kind: "many" }), "drawing.select");
  assert.equal(pageForSelection({ kind: "extension", id: "x.y" }), "ext:x.y");
});

test("Help: installed extensions bring their own pages under Extensions, before Make your own", () => {
  const documented = { id: "kit.timer", name: "Timer", description: "Counts down.", permissions: ["edit"], docs: [{ title: "Start it", body: "Press **Start**." }] };
  const bare = { id: "kit.bare", name: "Bare", permissions: [] };
  const pages = allWikiPages([documented, bare]), at = (id: string) => pages.findIndex(p => p.id === id);
  assert.ok(at("ext:kit.timer") > at("ext.publish") && at("ext:kit.timer") < at("make.overview"));
  assert.equal(getWikiPage("ext:kit.timer", pages)?.section, "extensions");
  assert.match(getWikiPage("ext:kit.timer", pages)!.body!, /## Start it\n\nPress \*\*Start\*\*/);
  assert.equal(getWikiPage("ext:kit.bare", pages)?.body, undefined, "a page without a guide still exists");
  assert.match(extensionPage(bare).purpose, /only reads/);
  assert.equal(searchWiki(pages, "start timer")[0].id, "ext:kit.timer");
});

test("Help: one source for the agent, the docs and the catalog example", async t => {
  // The extension guide the agent reads ends with the tutorial's own example.
  assert.ok(EXTENSION_GUIDE.includes(EXAMPLE_HTML) && EXTENSION_GUIDE.includes("docs"));
  // The example is a valid extension and a valid file, and the catalog ships exactly it.
  assert.ok(extensionSchema.safeParse(EXAMPLE_EXTENSION).success);
  const empty: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, packs: [], extensions: [] };
  assert.equal(parsePack(packSchema.parse(EXAMPLE_FILE), empty).id, "title-case");
  assert.deepEqual(JSON.parse(readFileSync(join(root, "marketplace/extensions/title-case/extension.json"), "utf8")), EXAMPLE_FILE);
  // Generated files are up to date (pnpm help:docs).
  for (const [path, text] of generated(root)) assert.equal(readFileSync(path, "utf8"), text, `${path} is out of date: run pnpm help:docs`);
  assert.match(wikiPageMarkdown(getWikiPage("drawing.pencil")!, { keysOf: id => id === "tool.pencil" ? "P" : undefined }), /^# Pencil[\s\S]*Shortcut: P[\s\S]*## By hand\n\n1\. Press P\./);
  // canvas_catalog help: contents, a search, one page, and the page each block type names.
  const { service } = await setup(t), router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  const contents = await router.call("canvas_catalog", { action: "help" }, "owner") as { contents: ReturnType<typeof wikiContents> };
  assert.deepEqual(contents.contents.map(s => s.section), WIKI_SECTIONS.map(s => s.title));
  const found = await router.call("canvas_catalog", { action: "help", query: "lens" }, "owner") as { results: { id: string }[] };
  assert.equal(found.results[0].id, "lenses.lens");
  const page = await router.call("canvas_catalog", { action: "help", page: "frames.frame" }, "owner") as { markdown: string };
  assert.equal(page.markdown, wikiPageMarkdown(getWikiPage("frames.frame")!));
  await assert.rejects(router.call("canvas_catalog", { action: "help", page: "nope" }, "owner"), /No Help page/);
  const listed = await router.call("canvas_catalog", { action: "list" }, "owner") as { blockTypes: { id: string; help?: string }[] };
  for (const type of listed.blockTypes) assert.equal(type.help, pageForBlockType(type.id)?.id, type.id);
});
