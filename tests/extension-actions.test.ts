import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRouter, toolDefinitions } from "../plugin/server/tools";
import { extensionsHash } from "../plugin/server/catalog";
import { CanvasError } from "../plugin/shared/errors";
import { ACTION_LIMITS, actionScripts, validateActionInput } from "../plugin/shared/actions";
import { EXTENSION_RUNTIME } from "../plugin/shared/extensions";
import { extensionSchema } from "../plugin/shared/model";
import { marketplaceIndexSchema } from "../plugin/shared/marketplace";
import { EXAMPLE_ACTIONS, EXAMPLE_EXTENSION, EXAMPLE_FILE, EXAMPLE_HTML, extensionPage, wikiPageMarkdown } from "../plugin/shared/wiki";
import { entryStatus } from "../plugin/client/screens";
import type { CanvasService } from "../plugin/server/service";
import { setup, workspaceId } from "./helpers";

const root = join(import.meta.dirname, "..");
type Run = { documentId: string; revision: number; committed: boolean; result: unknown; label?: string; changed?: string[]; selection?: string[]; logs?: string[]; transactionId?: string };
const go = [{ name: "go", description: "Test action (example data)." }];
/** A local extension whose actions script is `script` and whose one action is "go". */
const tool = (id: string, script: string, permissions: string[] = ["edit"], actions: unknown[] = go) => extensionSchema.parse({ id, kind: "tool", api: 1, name: `Prueba ${id}`, description: "Dato de ejemplo.", permissions, html: `<p>x</p><script data-lienzo="actions">${script}</script>`, actions });
async function install(service: CanvasService, ...extensions: ReturnType<typeof tool>[]) {
  for (const extension of extensions) await service.catalogMutate({ expectedRevision: (await service.catalog()).revision, action: { type: "extension.put", extension } });
}
async function harness(t: test.TestContext) {
  const context = await setup(t), router = new ToolRouter(context.service, async () => ({ agentId: "a", workspaceId }));
  const run = (extension: string, input?: Record<string, unknown>, extra: Record<string, unknown> = {}) => router.call("canvas_extension_run", { extension, action: "go", documentId: "d", ...(input ? { input } : {}), ...extra }, "owner") as Promise<Run>;
  const snapshot = async () => { const view = await context.service.read({ documentId: "d", workspaceId }); return JSON.stringify({ document: view.document, history: (await context.service.history({ documentId: "d", workspaceId })).transactions }); };
  return { ...context, router, run, snapshot };
}
/** Asserts the run fails with `code` (and `reason`, for EXTENSION_FAILED) and leaves the document and history as they were. */
async function refused(h: Awaited<ReturnType<typeof harness>>, extension: string, code: string, pattern: RegExp, reason?: string, input?: Record<string, unknown>) {
  const before = await h.snapshot();
  await assert.rejects(h.run(extension, input), (error: unknown) => {
    assert.ok(error instanceof CanvasError, String(error)); assert.equal(error.code, code, error.message); assert.match(error.message, pattern);
    if (reason) assert.equal(error.details.reason, reason, error.message);
    return true;
  });
  assert.equal(await h.snapshot(), before, `${extension}: a failing action changes nothing`);
}

test("Title Case through MCP: the agent runs the example's action, the person sees it in History and it undoes", async t => {
  const h = await harness(t);
  const listed = await h.router.call("canvas_catalog", { action: "list" }, "owner") as { revision: number };
  await h.router.call("canvas_catalog", { action: "save_extension", expectedRevision: listed.revision, extension: EXAMPLE_EXTENSION }, "owner");
  await h.service.mutate({ documentId: "d", workspaceId, expectedRevision: 0, label: "Datos", operations: [{ type: "block.update", id: "b", patch: { title: "hello big world" } }, { type: "block.update", id: "c", patch: { title: "second card" } }] });
  const view = await h.service.read({ documentId: "d", workspaceId });
  await h.service.selection({ documentId: "d", workspaceId, expectedSelectionVersion: view.selectionVersion, ids: ["b"] });
  // Without ids it works on the selection; without documentId on the Lienzo the person selected in last.
  const first = await h.router.call("canvas_extension_run", { extension: "title-case", action: "titleCase" }, "owner") as Run;
  assert.deepEqual([first.documentId, first.committed, first.result, first.revision, first.label, first.changed], ["d", true, { changed: 1 }, 2, "Title Case (agent): Title Case", ["b"]]);
  let doc = (await h.service.read({ documentId: "d", workspaceId })).document;
  assert.deepEqual(doc.blocks.map(b => b.title), ["Hello Big World", "second card"]);
  const history = await h.service.history({ documentId: "d", workspaceId });
  assert.deepEqual(history.transactions.at(-1)!.label, "Title Case (agent): Title Case"); assert.equal(history.transactions.at(-1)!.actor, "agent"); assert.equal(history.transactions.at(-1)!.agentId, "a");
  // With ids; nothing to change is a result, not a transaction.
  const second = await h.router.call("canvas_extension_run", { extension: "title-case", action: "titleCase", input: { ids: ["b", "c"] }, documentId: "d" }, "owner") as Run;
  assert.deepEqual([second.result, second.revision], [{ changed: 1 }, 3]);
  const none = await h.router.call("canvas_extension_run", { extension: "title-case", action: "titleCase", input: { ids: ["b"] }, documentId: "d" }, "owner") as Run;
  assert.deepEqual([none.result, none.committed, none.revision], [{ changed: 0 }, false, 3]);
  // The agent's undo takes back its own run.
  await h.router.call("canvas_undo", { documentId: "d", expectedRevision: 3 }, "owner");
  doc = (await h.service.read({ documentId: "d", workspaceId })).document;
  assert.deepEqual(doc.blocks.map(b => b.title), ["Hello Big World", "second card"]);
  // The tool is offered to the agent with an input schema, and preapproved like canvas_apply.
  const definition = toolDefinitions.find(d => d.name === "canvas_extension_run")!;
  assert.deepEqual(Object.keys((definition.inputSchema as { properties: object }).properties).sort(), ["action", "documentId", "extension", "input"]);
});

test("canvas_catalog list shows each extension's actions and whether it holds what it needs", async t => {
  const h = await harness(t);
  await install(h.service, extensionSchema.parse(EXAMPLE_EXTENSION));
  const catalog = await h.service.catalog();
  await h.service.importPack({ expectedRevision: catalog.revision, replace: false, dryRun: false, pack: EXAMPLE_FILE });
  const listed = await h.router.call("canvas_catalog", { action: "list" }, "owner") as { extensions: { id: string; allowed: boolean; missingPermissions?: string[]; note?: string; actions?: { name: string; description: string; input: unknown }[] }[]; extensionGuide: string };
  const local = listed.extensions.find(e => e.id === "title-case")!, imported = listed.extensions.find(e => e.id === "title-case.title-case")!;
  assert.deepEqual(local.actions, [{ name: "titleCase", description: EXAMPLE_ACTIONS[0].description, input: EXAMPLE_ACTIONS[0].input, returns: EXAMPLE_ACTIONS[0].returns }]);
  assert.equal(local.allowed, true); assert.equal(local.missingPermissions, undefined);
  assert.deepEqual([imported.allowed, imported.missingPermissions], [false, ["edit"]]); assert.match(imported.note!, /allow it in Extensions/);
  for (const word of ["data-lienzo=\"actions\"", "lienzo.action", "lienzo.run", "canvas_extension_run", "(agent)"]) assert.ok(listed.extensionGuide.includes(word), word);
  // Help: the action is on the extension's page, and Make your own shows how to add one.
  const page = wikiPageMarkdown(extensionPage(local as never as Parameters<typeof extensionPage>[0] & { actions: typeof EXAMPLE_ACTIONS }));
  assert.match(page, /## For your agent/); assert.match(page, /\*\*titleCase\*\*: Rewrites card titles/); assert.match(page, /`ids` \(optional\)/);
  const help = await h.router.call("canvas_catalog", { action: "help", page: "ext:title-case" }, "owner") as { markdown: string };
  assert.match(help.markdown, /For your agent[\s\S]*titleCase/);
  const make = await h.router.call("canvas_catalog", { action: "help", page: "make.actions" }, "owner") as { markdown: string };
  assert.match(make.markdown, /data-lienzo="actions"/); assert.match(make.markdown, /"titleCase"/);
});

test("permissions: an imported extension edits only once allowed, and none edits without declaring edit", async t => {
  const h = await harness(t);
  const script = "lienzo.action('go', function () { return lienzo.edit([{ type: 'block.update', id: 'b', patch: { title: 'Changed' } }], 'Rename').then(function () { return 'ok'; }); });";
  const file = { format: "paseo-canvas-pack", version: 1, id: "ajeno", name: "Colección de prueba", description: "Datos de ejemplo.", blockTypes: [], templates: [], documents: [], extensions: [tool("ajeno.edita", script)] };
  const imported = await h.service.importPack({ expectedRevision: 0, pack: file, replace: false, dryRun: false });
  await refused(h, "ajeno.edita", "FORBIDDEN", /has not allowed it\. Ask the person to allow it in Extensions/);
  // A read-only action of the same extension runs before the grant.
  await install(h.service, tool("lee", "lienzo.action('go', function (input, c) { return { blocks: c.document.blocks.length, held: c.extension.permissions, headless: lienzo.headless }; });", ["edit"]));
  assert.deepEqual((await h.run("lee")).result, { blocks: 2, held: ["edit"], headless: true });
  await h.service.catalogMutate({ expectedRevision: (await h.service.catalog()).revision, action: { type: "extension.grant", id: "ajeno.edita", granted: true } });
  const allowed = await h.run("ajeno.edita");
  assert.deepEqual([allowed.result, allowed.label], ["ok", "Prueba ajeno.edita (agent): Rename"]);
  void imported;
  // Local, but without the edit permission: refused, with the reason.
  await install(h.service, tool("sin-permiso", script, []));
  await refused(h, "sin-permiso", "FORBIDDEN", /does not declare the "edit" permission/);
  // Even if the action catches the refusal, nothing is written and it says what happened.
  await install(h.service, tool("traga", "lienzo.action('go', function () { return lienzo.edit([{ type: 'block.delete', id: 'b' }]).then(null, function (e) { return 'caught: ' + e.message; }); });", []));
  const swallowed = await h.run("traga");
  assert.equal(swallowed.committed, false); assert.match(String(swallowed.result), /caught: .*does not declare/);
});

test("input is validated before any code runs; unknown extensions and actions are named", async t => {
  const h = await harness(t);
  const actions = [{ name: "go", description: "Test action (example data).", input: { type: "object", required: ["count"], properties: { count: { type: "integer", minimum: 1, maximum: 5 }, mode: { type: "string", enum: ["a", "b"] }, ids: { type: "array", items: { type: "string" }, maxItems: 2 } } } }];
  await install(h.service, tool("valida", "globalThis.ran = true; lienzo.action('go', function (input) { return input; });", [], actions));
  assert.deepEqual((await h.run("valida", { count: 2, mode: "a" })).result, { count: 2, mode: "a" });
  await refused(h, "valida", "VALIDATION", /input\.count is required/, undefined, {});
  await refused(h, "valida", "VALIDATION", /input\.count should be an integer/, undefined, { count: 1.5 });
  await refused(h, "valida", "VALIDATION", /input\.count should be at most 5/, undefined, { count: 9 });
  await refused(h, "valida", "VALIDATION", /input\.mode should be one of "a", "b"/, undefined, { count: 1, mode: "c" });
  await refused(h, "valida", "VALIDATION", /input\.ids\[1\] should be a string/, undefined, { count: 1, ids: ["x", 2] });
  await refused(h, "valida", "VALIDATION", /input\.colour is not an argument of this action \(it takes count, mode, ids\)/, undefined, { count: 1, colour: "red" });
  await refused(h, "valida", "TOO_LARGE", /input is over/, undefined, { count: 1, ids: ["x".repeat(ACTION_LIMITS.input)] });
  await assert.rejects(h.router.call("canvas_extension_run", { extension: "valida", action: "nope", documentId: "d" }, "owner"), /has no action nope\. Its actions: go/);
  await assert.rejects(h.router.call("canvas_extension_run", { extension: "nadie", action: "go", documentId: "d" }, "owner"), /No extension nadie is installed/);
  await install(h.service, tool("olvida", "lienzo.action('otra', function () {});"));
  await refused(h, "olvida", "NOT_FOUND", /does not register it with lienzo\.action\. Registered: otra/);
  // The manifest itself: an action needs its script, a valid name and an object input schema.
  await assert.rejects(install(h.service, extensionSchema.parse({ ...tool("sin-script", ""), html: "<p>no script</p>" })), /no <script data-lienzo="actions">/);
  assert.throws(() => tool("mal", "", [], [{ name: "2go", description: "x" }]));
  assert.throws(() => tool("mal", "", [], [{ name: "go", description: "x", input: { type: "string" } }]), /object schema/);
  assert.throws(() => tool("mal", "", [], [{ name: "go", description: "x" }, { name: "go", description: "y" }]), /share a name/);
  assert.throws(() => tool("mal", "", [], [{ name: "go", description: "<b>x</b>" }]), /no HTML/);
  assert.throws(() => tool("mal", "", [], [{ name: "go", description: "x", input: { type: "object", required: ["a"], properties: {} } }]), /required names a/);
  const sneaky = extensionSchema.safeParse({ ...tool("ok", ""), actions: [JSON.parse('{"name":"go","description":"x","input":{"type":"object","properties":{"__proto__":{"type":"string"}}}}')] });
  assert.ok(!sneaky.success || !Object.hasOwn(sneaky.data.actions![0].input!.properties!, "__proto__"), "a __proto__ argument is refused or dropped, never kept");
  assert.deepEqual(validateActionInput(undefined, {}), []); assert.match(validateActionInput(undefined, { a: 1 })[0], /takes none/);
  assert.deepEqual(actionScripts(`<script>a</script><SCRIPT data-lienzo=actions >b</SCRIPT><script data-lienzo="actions-not">c</script><script type="text/javascript" data-lienzo='actions'>d</script >`), ["b", "d"]);
});

test("sandbox: no host objects, no way out through globals or constructor chains", async t => {
  const h = await harness(t);
  await install(h.service, tool("mira", `lienzo.action('go', function () {
    var g = (function () { return this; })() || globalThis, out = {};
    ['process', 'require', 'module', 'Buffer', 'fetch', 'XMLHttpRequest', 'WebSocket', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'WebAssembly', 'std', 'os', 'document', 'window', 'navigator', 'host', 'importScripts', 'Deno', 'Bun'].forEach(function (k) { out[k] = typeof g[k]; });
    out.viaConstructor = lienzo.edit.constructor('return typeof process + typeof require')();
    out.viaFunction = (function () {}).constructor.constructor('return typeof globalThis.process')();
    out.globals = Object.getOwnPropertyNames(g).filter(function (k) { return /host|bridge|call/i.test(k); });
    try { out.caller = String(arguments.callee.caller); } catch (e) { out.caller = 'refused'; }
    out.imports = (function () { try { return typeof eval('import("fs")'); } catch (e) { return 'refused'; } })();
    return out;
  });`, []));
  const result = (await h.run("mira")).result as Record<string, string | string[]>;
  for (const key of ["process", "require", "module", "Buffer", "fetch", "XMLHttpRequest", "WebSocket", "setInterval", "setImmediate", "queueMicrotask", "WebAssembly", "std", "os", "document", "window", "navigator", "host", "importScripts", "Deno", "Bun"]) assert.equal(result[key], "undefined", key);
  assert.equal(result.viaConstructor, "undefinedundefined"); assert.equal(result.viaFunction, "undefined");
  assert.deepEqual(result.globals, [], "the bridge is never a global");
  assert.ok(!String(result.caller).includes("host("), "the prelude's bridge does not leak through callers");
  // A dynamic import resolves to a rejected promise: there is no module loader.
  await install(h.service, tool("importa", "lienzo.action('go', function () { return import('node:fs').then(function () { return 'loaded'; }); });", []));
  await refused(h, "importa", "EXTENSION_FAILED", /failed and changed nothing/, "error");
});

test("sandbox: prototype pollution stays inside, and unsafe data never reaches the host", async t => {
  const h = await harness(t);
  await install(h.service, tool("ensucia", `Object.prototype.polluted = 'yes'; Array.prototype.injected = 1; JSON.parse = function () { return { ok: true, value: 'forged' }; };
    lienzo.action('go', function () { return lienzo.edit([{ type: 'block.update', id: 'b', patch: { title: 'Kept' } }], 'Clean').then(function () { return { polluted: ({}).polluted }; }); });`));
  const run = await h.run("ensucia");
  assert.deepEqual(run.result, { polluted: "yes" }, "inside, the extension's own world is polluted");
  assert.equal(({} as Record<string, unknown>).polluted, undefined); assert.equal(([] as unknown as Record<string, unknown>).injected, undefined);
  assert.equal((await h.service.read({ documentId: "d", workspaceId })).document.blocks[0].title, "Kept", "the prelude kept its own JSON");
  await install(h.service, tool("proto", "lienzo.action('go', function () { return JSON.parse('{\"__proto__\": {\"admin\": true}}'); });", []));
  await refused(h, "proto", "EXTENSION_FAILED", /not plain JSON data \(Unsafe JSON key: __proto__\)/, "output");
  await install(h.service, tool("proto-edit", "lienzo.action('go', function () { return lienzo.edit([JSON.parse('{\"type\":\"block.update\",\"id\":\"b\",\"patch\":{\"data\":{\"__proto__\":{\"admin\":true}}}}')]); });"));
  await refused(h, "proto-edit", "EXTENSION_FAILED", /Unsafe JSON key/, "error");
  assert.equal(({} as Record<string, unknown>).admin, undefined);
  // Getters and toJSON tricks on what is returned are evaluated inside; the host only ever parses a string.
  await install(h.service, tool("tojson", "lienzo.action('go', function () { return { toJSON: function () { return { safe: true }; } }; });", []));
  assert.deepEqual((await h.run("tojson")).result, { safe: true });
});

test("sandbox: time, memory, output, recursion and promise floods are bounded and change nothing", async t => {
  const h = await harness(t);
  const cases: [string, string, string, RegExp][] = [
    ["bucle", "lienzo.action('go', function () { for (;;) {} });", "timeout", /longer than 2 s/],
    ["bucle-arriba", "for (;;) {}", "timeout", /longer than 2 s/],
    ["regex", "lienzo.action('go', function () { return /(a+)+b/.test('a'.repeat(40)); });", "timeout", /longer than 2 s/],
    // Growth in 1 MB steps reaches the limit in milliseconds; many small objects can take longer than 2 s on a busy machine.
    ["memoria", "lienzo.action('go', function () { var a = []; for (;;) a.push(new Uint8Array(1024 * 1024).fill(1)); });", "memory", /more than 64 MB/],
    ["buffer", "lienzo.action('go', function () { return new ArrayBuffer(512 * 1024 * 1024).byteLength; });", "memory", /more than 64 MB/],
    ["salida", "lienzo.action('go', function () { return 'x'.repeat(1000000); });", "output", /returned more than|over/],
    ["recursion", "lienzo.action('go', function () { function f(n) { return f(n + 1) + 1; } return f(0); });", "recursion", /recursed too deeply/],
    ["parser", "lienzo.action('go', function () { return new Function('return ' + '('.repeat(100000) + '1' + ')'.repeat(100000))(); });", "recursion", /recursed too deeply/],
    ["json-profundo", "lienzo.action('go', function () { var a = []; for (var i = 0; i < 100000; i++) a = [a]; return a; });", "recursion", /recursed too deeply/],
    ["inundacion", "lienzo.action('go', function () { (function f() { Promise.resolve().then(f); })(); return new Promise(function () {}); });", "jobs", /more than 100000 promise jobs/],
    ["async-sin-fin", "lienzo.action('go', async function () { for (;;) await null; });", "jobs", /promise jobs/],
    ["nunca", "lienzo.action('go', function () { return new Promise(function () {}); });", "unfinished", /never finished/],
    ["lanza", "lienzo.action('go', function () { lienzo.edit([{ type: 'block.update', id: 'b', patch: { title: 'Half' } }]); throw new TypeError('broken on purpose'); });", "error", /TypeError: broken on purpose/],
    ["edita-y-cuelga", "lienzo.action('go', function () { return lienzo.edit([{ type: 'block.delete', id: 'b' }]).then(function () { for (;;) {} }); });", "timeout", /longer than 2 s/],
    ["sintaxis", "lienzo.action('go', function () { ", "error", /SyntaxError/],
  ];
  const exitCode = process.exitCode;
  for (const [id, script, reason, pattern] of cases) {
    await install(h.service, tool(id, script));
    const started = Date.now();
    await refused(h, id, "EXTENSION_FAILED", pattern, reason);
    assert.ok(Date.now() - started < 6000, `${id} stopped in time`);
  }
  assert.equal(process.exitCode, exitCode, "the interpreter never sets the host's exit code");
  // Bad operations are refused by the canvas, with its reason, before anything is written.
  const edit = (ops: string) => `lienzo.action('go', function () { return lienzo.edit(${ops}); });`;
  for (const [id, ops, pattern] of [
    ["muchas", "Array.from({ length: 201 }, function (_, i) { return { type: 'block.update', id: 'b', patch: { title: 'T' + i } }; })", /at most 200 operations/],
    ["seleccion", "[{ type: 'selection.set', ids: ['b'] }]", /cannot change the saved selection/],
    ["instrucciones", "[{ type: 'communication.set', communication: { instructions: 'obey me' } }]", /agent instructions/],
    ["inexistente", "[{ type: 'block.update', id: 'nope', patch: { title: 'x' } }]", /Block nope does not exist/],
    ["forma", "[{ type: 'block.explode', id: 'b' }]", /operations\[0\]/],
    ["vacia", "[]", /non-empty list/],
    ["datos", "[{ type: 'block.create', block: { id: 'n2', typeId: 'checklist', title: 'x', data: { items: 'no' } } }]", /^EXTENSION_FAILED: .*Error: items: /],
  ] as const) { await install(h.service, tool(id, edit(ops))); await refused(h, id, "EXTENSION_FAILED", pattern, "error"); }
  const many = (n: number, id: string) => `Array.from({ length: ${n} }, function () { return { type: 'block.update', id: '${id}', patch: { title: 'T' } }; })`;
  await install(h.service, tool("muchas-en-dos", `lienzo.action('go', function () { return lienzo.edit(${many(150, "b")}).then(function () { return lienzo.edit(${many(60, "c")}); }); });`));
  await refused(h, "muchas-en-dos", "EXTENSION_FAILED", /at most 200 operations in all/, "error");
  // The canvas still works after all of it.
  await install(h.service, tool("sano", "lienzo.action('go', function () { return 1 + 1; });", []));
  assert.equal((await h.run("sano")).result, 2);
});

test("sandbox: every run is fresh, sees the current document, and gathers its edits into one transaction", async t => {
  const h = await harness(t);
  await install(h.service, tool("cuenta", "globalThis.n = (globalThis.n || 0) + 1; lienzo.action('go', function () { return globalThis.n; });", []));
  assert.equal((await h.run("cuenta")).result, 1); assert.equal((await h.run("cuenta")).result, 1, "nothing persists between runs");
  await install(h.service, tool("pasos", `lienzo.action('go', function (input, c) {
      console.log('start', c.document.revision, { n: c.document.blocks.length });
      return lienzo.edit([{ type: 'block.create', block: { id: 'nuevo', typeId: 'note', title: 'Nuevo', data: { text: 'Dato de ejemplo.' } } }], 'Create')
        .then(function (r) { return lienzo.edit([{ type: 'block.update', id: 'nuevo', patch: { title: 'Renamed' } }], 'Rename').then(function () { return r; }); })
        .then(function (r) { return lienzo.select(['nuevo', 'ghost']).then(function (s) { return { revision: r.revision, seen: lienzo.context.document.blocks.length, before: c.document.blocks.length, selected: s.ids }; }); });
    });`));
  const run = await h.run("pasos");
  assert.deepEqual(run.result, { revision: 1, seen: 3, before: 2, selected: ["nuevo"] });
  assert.deepEqual([run.revision, run.label, run.selection, run.logs], [1, "Prueba pasos (agent): Create", ["nuevo"], ['start 0 {"n":2}']]);
  const after = await h.service.read({ documentId: "d", workspaceId });
  assert.equal(after.document.blocks.find(b => b.id === "nuevo")!.title, "Renamed"); assert.deepEqual(after.document.selectedIds, ["nuevo"]);
  assert.equal((await h.service.history({ documentId: "d", workspaceId })).transactions.length, 1, "two edit calls, one transaction");
  // A person's edit while it runs is not overwritten: the run is refused as a conflict. (Simulated with a stale base.)
  await install(h.service, tool("lento", "lienzo.action('go', function () { return lienzo.edit([{ type: 'block.update', id: 'c', patch: { title: 'Agent' } }]); });"));
  const original = h.service.store.read.bind(h.service.store);
  let once = true;
  h.service.store.read = async () => { const state = structuredClone(await original()); if (once) { once = false; await h.service.mutate({ documentId: "d", workspaceId, expectedRevision: 1, label: "Person", operations: [{ type: "block.update", id: "c", patch: { title: "Person" } }] }); } return state; };
  await assert.rejects(h.service.runExtension({ workspaceId, documentId: "d", extension: "lento", action: "go" }, "a"), /changed while the action ran/);
  h.service.store.read = original;
  assert.equal((await h.service.read({ documentId: "d", workspaceId })).document.blocks.find(b => b.id === "c")!.title, "Person");
});

test("the frame runs the same actions script: lienzo.action registers, lienzo.run calls it", async () => {
  const sent: { type: string; id?: number; method?: string; args?: { operations?: { patch: { title: string } }[]; label?: string } }[] = [], listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const parent = { postMessage: (m: never) => { sent.push(m); } };
  const window = { parent, addEventListener: (type: string, f: never) => { if (type === "message") listeners.push(f); } } as Record<string, unknown>;
  const context = vm.createContext({ window, parent, console, Promise });
  vm.runInContext(EXTENSION_RUNTIME, context);
  context.lienzo = window.lienzo;
  vm.runInContext(actionScripts(EXAMPLE_HTML)[0], context);
  const lienzo = window.lienzo as { headless: boolean; run(name: string, input?: unknown): Promise<unknown> };
  const deliver = (data: unknown) => listeners.forEach(f => f({ source: parent, data }));
  assert.equal(lienzo.headless, false);
  await assert.rejects(lienzo.run("nope"), /has no action nope/);
  deliver({ lienzo: 1, type: "context", context: { api: 1, document: { blocks: [{ id: "a", title: "hello world" }, { id: "z", title: "other" }] }, selection: ["a"] } });
  const pending = lienzo.run("titleCase", {});
  await new Promise(resolve => setImmediate(resolve));
  const call = sent.at(-1)!;
  assert.equal(call.method, "edit"); assert.equal(call.args!.label, "Title Case");
  assert.deepEqual(JSON.parse(JSON.stringify(call.args!.operations)), [{ type: "block.update", id: "a", patch: { title: "Hello World" } }]);
  deliver({ lienzo: 1, type: "result", id: call.id, ok: true, value: { revision: 4 } });
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), { changed: 1 });
});

test("Discover: a code-only change in the catalog says Update…, by content hash", async t => {
  const { service } = await setup(t);
  const dir = await mkdtemp(join(tmpdir(), "lienzo-catalog-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "extensions/title-case"), { recursive: true });
  const write = (file: unknown) => writeFile(join(dir, "extensions/title-case/extension.json"), JSON.stringify(file, null, 2));
  const build = async () => { execFileSync(process.execPath, [join(root, "marketplace/scripts/build-index.mjs"), "--root", dir, "--repository", "owner/catalog"], { stdio: "ignore" }); return marketplaceIndexSchema.parse(JSON.parse(await readFile(join(dir, "index.json"), "utf8"))).entries[0]; };
  await write(EXAMPLE_FILE);
  const entry = await build();
  assert.deepEqual(entry.extensions[0].actions, ["titleCase"]);
  const installed = await service.importPack({ expectedRevision: 0, pack: JSON.parse(JSON.stringify(EXAMPLE_FILE)), replace: false, dryRun: false });
  assert.equal(installed.catalog.packHashes!["title-case"], entry.contentHash, "the app and the CI builder hash the same content the same way");
  assert.equal(installed.catalog.packHashes!["title-case"], extensionsHash(installed.catalog.packs[0].extensions));
  assert.equal(entryStatus(entry, installed.catalog), "installed");
  // Same names, description, permissions and docs; only the code changed.
  await write({ ...EXAMPLE_FILE, extensions: [{ ...EXAMPLE_FILE.extensions[0], html: EXAMPLE_FILE.extensions[0].html.replace("Done.", "Done!") }] });
  const changed = await build();
  assert.equal(entryStatus({ ...changed, contentHash: undefined }, installed.catalog), "installed", "metadata alone cannot see it");
  assert.equal(entryStatus(changed, installed.catalog), "update");
  // Formatting alone is not a change.
  await writeFile(join(dir, "extensions/title-case/extension.json"), JSON.stringify(EXAMPLE_FILE));
  assert.equal(entryStatus(await build(), installed.catalog), "installed");
  // A pack installed before hashes were stored gets one computed; removing the file forgets it.
  const removed = await service.catalogMutate({ expectedRevision: installed.catalog.revision, action: { type: "pack.remove", id: "title-case" } });
  assert.deepEqual(removed.packHashes, {});
});
