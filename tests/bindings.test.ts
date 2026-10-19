import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  BINDING_LIMITS, bindingOutput, bindingStates, bindingsSchema, bindableFor, bindablesFor, boundOf, evaluateExpression, expressionIssue, expressionValue, formatTemplate, parseExpression, transformValue,
} from "../plugin/shared/bindings";
import { blockSchema, documentContentSchema, type CanvasDocument, type CanvasCatalog } from "../plugin/shared/model";
import { canvasPresentation } from "../plugin/client/presentation";
import { boundLook, layoutCanvas, linkRoutes, sizeBoundTo } from "../plugin/client/logic";
import { variableOperations } from "../plugin/client/property-model";
import { EXTENSION_GUIDE, EXTENSION_RUNTIME, extensionVariables, extensionVariableTarget } from "../plugin/shared/extensions";
import { CanvasError } from "../plugin/shared/errors";
import { ToolRouter, drawingGuide, integrationInstructions } from "../plugin/server/tools";
import { setup, workspaceId, mutation } from "./helpers";

// Example data only: a made-up speed slider driving a rectangle and a label.
const speed = { name: "speed", label: "Speed", value: 5, min: 0, max: 10, step: 1 };
const shapeBindings = {
  "size.width": { variable: "speed", map: { from: [0, 10] as [number, number], to: [40, 400] as [number, number] } },
  "fill.color": { variable: "speed", steps: [{ at: 0, color: "verde" as const }, { at: 7, color: "rojo" as const }] },
};
function demo() {
  return documentContentSchema.parse({
    title: "Bindings (example data)", description: "Example data.", communication: { instructions: "Example data." }, variables: [speed],
    blocks: [
      { id: "ctl", typeId: "controls", title: "Speed", data: { variables: ["speed"] } },
      { id: "box", typeId: "wb-shape", title: "", position: { x: 0, y: 0 }, size: { width: 160, height: 104 }, data: { shape: "rect" }, bindings: shapeBindings },
      { id: "label", typeId: "wb-text", title: "", position: { x: 0, y: 200 }, data: { text: "Speed" }, bindings: { "text.template": { variable: "speed", template: "Speed: {v}" } } },
      { id: "card", typeId: "node", title: "Card", data: { summary: "x" } },
    ],
    groups: [], links: [{ id: "l", from: "box", to: "card" }],
  });
}

test("schema: bindable paths, kinds and limits", () => {
  assert.ok(bindingsSchema.safeParse(shapeBindings).success);
  const issue = (value: unknown) => { const r = bindingsSchema.safeParse(value); return r.success ? "" : r.error.issues.map(i => i.message).join(" | "); };
  assert.match(issue({ "size.wdth": { variable: "speed" } }), /size\.wdth cannot be bound\. Bindable: size\.width/);
  assert.match(issue({ opacity: { variable: "speed", map: { from: [0, 1], to: [0, 1] }, expr: "v" } }), /map or expr, not both/);
  assert.match(issue({ "fill.color": { variable: "speed" } }), /needs hue \{from,to\} or steps/);
  assert.match(issue({ opacity: { variable: "speed", steps: [{ at: 0, color: "rojo" }] } }), /only for stroke\.color and fill\.color/);
  assert.match(issue({ opacity: { variable: "speed", template: "{v}" } }), /only for text\.template/);
  assert.match(issue({ "fill.color": { variable: "speed", steps: [{ at: 5, color: "rojo" }, { at: 2, color: "verde" }] } }), /each above the one before/);
  assert.match(issue({ "fill.color": { variable: "speed", steps: [{ at: 0, color: "pink" }] } }), /whiteboard colour name or #rrggbb/);
  assert.match(issue({ opacity: { variable: "speed", map: { from: [3, 3], to: [0, 1] } } }), /two different numbers/);
  assert.match(issue({ opacity: { variable: "speed", expr: "v +" } }), /ends too early/);
  assert.match(issue({ opacity: { variable: "__proto__" } }), /Reserved variable name|Invalid/);
  assert.match(issue({ opacity: { variable: "speed", extra: 1 } }), /Unrecognized key/);
  const many = Object.fromEntries(["size.width", "size.height", "offset.x", "offset.y", "rotation", "opacity", "stroke.width", "corner.radius", "text.size", "text.template", "stroke.color", "fill.color"].map(p => [p, p.endsWith("color") ? { variable: "v", hue: { from: [0, 1], to: [0, 1] } } : { variable: "v" }]));
  assert.ok(bindingsSchema.safeParse(many).success, "the twelve bindable properties fit");
  assert.equal(Object.keys(many).length, BINDING_LIMITS.perBlock);
  assert.ok(blockSchema.safeParse({ id: "x", typeId: "note", title: "", data: {}, bindings: null }).success, "null removes them in a patch");
  assert.equal(bindableFor("size.width", "wb-text"), false); assert.equal(bindableFor("stroke.color", "node"), false); assert.equal(bindableFor("text.template", "note"), true);
  assert.deepEqual(bindablesFor("wb-shape").map(b => b.path).length, 12);
});

test("expressions: a small safe grammar, never code", () => {
  const value = (source: string, v = 3) => evaluateExpression(parseExpression(source), v);
  assert.equal(value("v * 20 + 40"), 100); assert.equal(value("2 + 3 * 4"), 14); assert.equal(value("(2 + 3) * 4"), 20);
  assert.equal(value("-v"), -3); assert.equal(value("--v"), 3); assert.equal(value("v % 2"), 1); assert.equal(value("1e2 + .5"), 100.5);
  assert.equal(value("clamp(v * 10, 0, 20)"), 20); assert.equal(value("min(4, v, 9)"), 3); assert.equal(value("max(1, 2, 3, v * 2)"), 6);
  assert.equal(value("round(v / 2)"), 2); assert.equal(value("abs(v - 10)"), 7); assert.ok(Math.abs(value("sin(pi / 2)") - 1) < 1e-9); assert.equal(value("cos(0)"), 1);
  assert.equal(value("SQRT(16)"), 4, "names are case-insensitive");
  for (const bad of ["constructor", "__proto__", "this", "alert(1)", "v[0]", "'a'", "v; 1", "v = 2", "toString()", "process.exit()", "v ** 2", "() => 1", "min(1)", "clamp(1, 2)", "round()", "", "  "])
    assert.ok(expressionIssue(bad), `refused: ${JSON.stringify(bad)}`);
  assert.match(expressionIssue("t * 2")!, /Time \(t\) is not available/);
  assert.match(expressionIssue("foo(v)")!, /Unknown name “foo”/);
  assert.match(expressionIssue("(".repeat(17) + "v" + ")".repeat(17))!, /nests too deeply/);
  assert.equal(expressionIssue("(".repeat(10) + "v" + ")".repeat(10)), null);
  assert.match(expressionIssue("v+".repeat(81) + "v")!, /At most 160 characters|too long/);
  assert.match(expressionIssue("1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1")!, /too long/);
  assert.ok(Number.isNaN(expressionValue("v / 0", 3)), "division by zero gives nothing rather than Infinity");
  assert.ok(Number.isNaN(expressionValue("sqrt(v)", -1)));
  assert.ok(Number.isNaN(expressionValue("nope(", 1)), "a broken stored expression never throws at render");
});

test("mapping math: linear, clamped, reversed, limited, coloured and written", () => {
  const map = { from: [0, 10] as [number, number], to: [40, 400] as [number, number] };
  assert.equal(transformValue({ map }, 5), 220); assert.equal(transformValue({ map }, 20), 400); assert.equal(transformValue({ map }, -5), 40);
  assert.equal(transformValue({ map: { ...map, clamp: false } }, 20), 760, "clamp:false extrapolates");
  assert.equal(transformValue({ map: { from: [10, 0], to: [0, 1] } }, 2.5), .75, "a reversed range runs backwards");
  assert.equal(transformValue({}, 7), 7, "without map or expr the value itself");
  assert.equal(bindingOutput("size.width", { variable: "s", expr: "v - 100" }, 5), 8, "outputs stay inside the property's limits");
  assert.equal(bindingOutput("opacity", { variable: "s", expr: "v" }, 4), 1);
  assert.equal(bindingOutput("size.width", { variable: "s", expr: "v / 0" }, 4), undefined);
  assert.equal(bindingOutput("fill.color", { variable: "s", hue: { from: [0, 10], to: [200, 0] } }, 5), "hue:100");
  assert.equal(bindingOutput("fill.color", { variable: "s", hue: { from: [0, 10], to: [-40, 40] } }, 0), "hue:320", "hues wrap into 0..360");
  const steps = { variable: "s", steps: [{ at: 2, color: "verde" as const }, { at: 5, color: "naranja" as const }, { at: 8, color: "#ff0000" }] };
  assert.deepEqual([0, 2, 4.9, 5, 9].map(v => bindingOutput("stroke.color", steps, v)), ["verde", "verde", "verde", "naranja", "#ff0000"]);
  assert.equal(bindingOutput("text.template", { variable: "s", template: "Speed: {v} km/h" }, 5), "Speed: 5 km/h");
  assert.equal(bindingOutput("text.template", { variable: "s", template: "{v:2} · {v:0}", map: { from: [0, 1], to: [0, 100] } }, .333), "33.30 · 33");
  assert.equal(bindingOutput("text.template", { variable: "s" }, 1 / 3), "0.333333");
  assert.equal(formatTemplate("{v}{w}{v:9}", 2), "2{w}{v:9}", "only {v} and {v:0-4} are replaced");
});

test("rename follows bindings through their scope; deletion leaves them inert with a reason", () => {
  const content = demo(), doc = { ...content, id: "d", workspaceId, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as CanvasDocument;
  doc.groups = [{ id: "frame", title: "Frame", description: "", blockIds: ["inner"], groupIds: [], variables: [{ ...speed, value: 1 }] }];
  doc.blocks = [...doc.blocks, { id: "inner", typeId: "wb-shape", title: "", parentGroupId: "frame", position: { x: 0, y: 0 }, data: { shape: "rect" }, bindings: { opacity: { variable: "speed" } } }];
  const ops = variableOperations(doc, "$document", [{ ...speed, name: "pace" }], { speed: "pace" }, new Set(["controls"]));
  const updates = ops.filter(o => o.type === "block.update" && "bindings" in o.patch) as { id: string; patch: { bindings: Record<string, { variable: string }> } }[];
  assert.deepEqual(updates.map(u => u.id).sort(), ["box", "label"], "the Frame's own speed shadows the Lienzo's for inner");
  assert.deepEqual(Object.values(updates.find(u => u.id === "box")!.patch.bindings).map(b => b.variable), ["pace", "pace"]);
  const removed = variableOperations(doc, "$document", [], { speed: null }, new Set(["controls"]));
  assert.ok(!removed.some(o => o.type === "block.update" && "bindings" in o.patch), "a removal does not touch bindings");
  const after = { ...doc, variables: [] }, states = bindingStates(after, after.blocks.find(b => b.id === "box")!, { blocks: {}, scopes: {} }, "wb-shape");
  assert.deepEqual(states.map(s => [s.path, s.output, s.issue]), [["size.width", undefined, "speed is not declared on its Frames or the Lienzo."], ["fill.color", undefined, "speed is not declared on its Frames or the Lienzo."]]);
});

test("server: bindings round-trip through MCP, fail clearly, and never revise while a variable moves", async t => {
  const { service } = await setup(t);
  const router = new ToolRouter(service, async () => ({ workspaceId, agentId: "test-agent" }));
  await router.call("canvas_create", { id: "bind", content: demo() }, "owner");
  const read = await router.call("canvas_read", { documentId: "bind", ids: ["box"] }, "owner") as { entities: { entity: { bindings: unknown } }[] };
  assert.deepEqual(read.entities[0].entity.bindings, shapeBindings);
  const apply = (expectedRevision: number, operations: unknown[]) => router.call("canvas_apply", { documentId: "bind", expectedRevision, operations }, "owner");
  const rejects = (code: string, message: RegExp) => (error: unknown) => error instanceof CanvasError && error.code === code && message.test(error.message);
  await assert.rejects(apply(0, [{ type: "block.update", id: "card", patch: { bindings: { "stroke.color": { variable: "speed", hue: { from: [0, 10], to: [0, 120] } } } } }]), rejects("VALIDATION", /card bindings\.stroke\.color: a Node block \(node\) cannot bind stroke\.color/));
  await assert.rejects(apply(0, [{ type: "block.update", id: "card", patch: { bindings: { opacity: { variable: "gravity" } } } }]), rejects("VALIDATION", /no variable gravity on its Frames or the Lienzo\. Declare it first/));
  await assert.rejects(apply(0, [{ type: "block.update", id: "label", patch: { bindings: { "size.width": { variable: "speed" } } } }]), rejects("VALIDATION", /cannot bind size\.width/));
  await assert.rejects(apply(0, [{ type: "block.update", id: "card", patch: { bindings: { "size.wide": { variable: "speed" } } } }]), (error: unknown) => error instanceof Error && /size\.wide cannot be bound/.test(JSON.stringify((error as { issues?: unknown }).issues ?? error.message)));
  // Declaring the variable in the same transaction is enough; null removes all of them.
  const declared = await apply(0, [{ type: "document.update", variables: [speed, { name: "gravity", value: 1, min: 0, max: 2 }] }, { type: "block.update", id: "card", patch: { bindings: { opacity: { variable: "gravity", expr: "v / 2" } } } }]) as { revision: number };
  assert.equal(declared.revision, 1);
  const cleared = await apply(1, [{ type: "block.update", id: "card", patch: { bindings: null } }]) as { revision: number };
  assert.equal((await service.read({ documentId: "bind", workspaceId })).document.blocks.find(b => b.id === "card")!.bindings, undefined);
  // Deleting the variable later leaves the stored binding as it is (inert), and other edits of that block still pass.
  await service.mutate(mutation(cleared.revision, [{ type: "document.update", variables: [{ name: "gravity", value: 1, min: 0, max: 2 }] }], "bind"));
  const now = await service.read({ documentId: "bind", workspaceId });
  assert.deepEqual(now.document.blocks.find(b => b.id === "box")!.bindings, shapeBindings);
  const retitled = await service.mutate(mutation(now.document.revision, [{ type: "block.update", id: "box", patch: { title: "Box", bindings: shapeBindings } }], "bind"));
  // Moving a variable: runtime only, the revision does not change, and what the canvas draws follows.
  await service.mutate(mutation(retitled.document.revision, [{ type: "document.update", variables: [speed] }], "bind"));
  const before = await service.read({ documentId: "bind", workspaceId });
  for (const value of [0, 3, 7, 10]) await service.runtimeSet({ workspaceId, documentId: "bind", blocks: [], scopes: [{ id: "$document", values: { speed: value } }] });
  const after = await service.read({ documentId: "bind", workspaceId });
  assert.equal(after.document.revision, before.document.revision);
  assert.equal(after.document.updatedAt, before.document.updatedAt);
  assert.deepEqual(after.runtime.scopes.$document, { speed: 10 });
  const box = after.document.blocks.find(b => b.id === "box")!;
  assert.deepEqual(bindingStates(after.document, box, after.runtime, "wb-shape").map(s => s.output), [400, "rojo"]);
  assert.match(drawingGuide, /bindings: \{ "size\.width": \{ variable: "speed", map: \{ from:\[0,10\], to:\[40,400\] \} \} \}/);
  assert.ok(integrationInstructions.length < 1500, `integrationInstructions is ${integrationInstructions.length} characters`);
});

test("layout uses the bound size, so links and frames follow; the look nudges without moving them", () => {
  const content = demo(), doc = { ...content, id: "d", workspaceId, revision: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" } as CanvasDocument;
  doc.groups = [{ id: "frame", title: "Frame", description: "", blockIds: ["box"], groupIds: [], layout: { mode: "free" } }];
  doc.blocks = doc.blocks.map(b => b.id === "box" ? { ...b, parentGroupId: "frame", bindings: { ...shapeBindings, "offset.x": { variable: "speed", expr: "v * 2" }, rotation: { variable: "speed", map: { from: [0, 10], to: [0, 90] } }, opacity: { variable: "speed", map: { from: [0, 10], to: [.2, 1] } } } } : b);
  const types = ["controls", "wb-shape", "wb-text", "node"].map(id => ({ id, name: id, description: "", renderer: id, properties: [], defaults: {} }));
  const catalog = { revision: 0, blockTypes: types, packs: [], extensions: [] } as unknown as CanvasCatalog;
  const at = (value: number) => {
    const p = canvasPresentation(doc, catalog, { blocks: {}, scopes: { $document: { speed: value } } });
    const layout = layoutCanvas(p.document, {}, catalog), box = p.document.blocks.find(b => b.id === "box")!;
    return { p, box, rect: layout.rects.get("box")!, frame: layout.rects.get("frame")!, route: linkRoutes(p.document, layout)[0] };
  };
  const low = at(1), high = at(9);
  assert.equal(low.rect.width, 76); assert.equal(high.rect.width, 364); assert.equal(high.rect.height, 104, "the unbound height keeps the stored one");
  assert.ok(high.frame.width > low.frame.width && high.frame.width >= high.rect.width + 16, `the Frame grows with what it holds: ${low.frame.width} → ${high.frame.width}`);
  assert.notDeepEqual(JSON.stringify(high.route), JSON.stringify(low.route), "the link leaves from the bound edge");
  const look = boundLook(high.box);
  assert.deepEqual(look.transform, [{ translateX: 18 }, { rotate: "81deg" }]); assert.ok(Math.abs(look.opacity - .92) < 1e-9);
  assert.equal(high.p.bound.get("label")!["text.template"], "Speed: 9");
  assert.equal(boundOf(doc.blocks.find(b => b.id === "box")), undefined, "the stored block carries nothing");
  assert.equal(JSON.stringify(high.box), JSON.stringify(doc.blocks.find(b => b.id === "box")), "the projected copy serializes as the stored block");
  assert.equal(sizeBoundTo(high.p.document, high.box), "Speed");
  assert.equal(sizeBoundTo(doc, doc.blocks.find(b => b.id === "box")!), null, "only a live binding takes the resize handles");
});

test("extensions: lienzo.variables reads, follows and sets runtime values", () => {
  const doc = { ...demo(), id: "d", workspaceId, revision: 1, createdAt: "", updatedAt: "" } as CanvasDocument;
  doc.groups = [{ id: "f1", title: "One", description: "", blockIds: ["card"], groupIds: [], variables: [{ name: "mode", type: "choice", options: ["Slow", "Fast"], value: 0, min: 0, max: 1 }, { ...speed, value: 2 }] }, { id: "f2", title: "Two", description: "", blockIds: [], groupIds: [], variables: [{ name: "mode", type: "boolean", value: 0, min: 0, max: 1 }] }];
  doc.blocks = doc.blocks.map(b => b.id === "card" ? { ...b, parentGroupId: "f1" } : b);
  const list = extensionVariables(doc, { blocks: {}, scopes: { $document: { speed: 8 }, f1: { speed: 99 } } });
  assert.deepEqual(list.map(v => [v.scope, v.name, v.value, v.initial]), [["$document", "speed", 8, 5], ["f1", "mode", 0, 0], ["f1", "speed", 10, 2], ["f2", "mode", 0, 0]]);
  assert.deepEqual(list[1].options, ["Slow", "Fast"]); assert.equal(list[1].scopeTitle, "One");
  assert.deepEqual(extensionVariableTarget(doc, "speed", 4, undefined, []), { scope: "$document", value: 4 });
  assert.deepEqual(extensionVariableTarget(doc, "speed", 4, undefined, ["card"]), { scope: "f1", value: 4 }, "the selection's nearest scope");
  assert.deepEqual(extensionVariableTarget(doc, "speed", 40, "$document", ["card"]), { scope: "$document", value: 10 }, "clamped to the range");
  assert.deepEqual(extensionVariableTarget(doc, "mode", .6, "f1", []), { scope: "f1", value: 1 }, "whole for choices");
  assert.deepEqual(extensionVariableTarget(doc, "speed", null, undefined, []), { scope: "$document", value: null });
  assert.match((extensionVariableTarget(doc, "mode", 1, undefined, []) as { error: string }).error, /declared in 2 Frames; pass \{ scope: frameId \}/);
  assert.match((extensionVariableTarget(doc, "nope", 1, undefined, []) as { error: string }).error, /No variable nope/);
  assert.match((extensionVariableTarget(doc, "speed", "fast", undefined, []) as { error: string }).error, /finite number/);
  assert.match((extensionVariableTarget(doc, "speed", 1, "f2", []) as { error: string }).error, /No variable speed is declared in f2/);
  // The frame side: the same channel as the rest of API 1.
  type Sent = { type: string; method?: string; args?: Record<string, unknown> };
  const sent: Sent[] = [], listeners: Record<string, ((e: unknown) => void)[]> = {};
  const parent = { postMessage: (m: never) => { sent.push(m); } }, window = { parent, addEventListener: (type: string, f: never) => { (listeners[type] ??= []).push(f); } } as Record<string, unknown>;
  vm.runInNewContext(EXTENSION_RUNTIME, { window, parent, console, Promise });
  const lienzo = window.lienzo as any, last = () => JSON.parse(JSON.stringify(sent.at(-1)));
  const deliver = (data: unknown) => listeners.message.forEach(f => f({ source: parent, data: { lienzo: 1, ...(data as object) } }));
  void lienzo.variables.get(); assert.equal(last().method, "variables.get");
  void lienzo.variables.set("speed", "7", { scope: "f1" }); assert.deepEqual([last().method, last().args], ["variables.set", { name: "speed", value: 7, scope: "f1" }]);
  void lienzo.variables.set("speed", null); assert.deepEqual(last().args, { name: "speed", value: null, scope: null });
  assert.throws(() => lienzo.variables.onChange(1), /needs a function/);
  const seen: unknown[] = [], stop = lienzo.variables.onChange((v: unknown) => seen.push(v));
  assert.deepEqual([last().method, last().args], ["variables.watch", { on: true }]);
  deliver({ type: "variables", variables: [{ name: "speed", value: 3 }] });
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [[{ name: "speed", value: 3 }]]);
  stop(); assert.deepEqual([last().method, last().args], ["variables.watch", { on: false }]);
  deliver({ type: "variables", variables: [] }); assert.equal(seen.length, 1);
  assert.match(EXTENSION_GUIDE, /lienzo\.variables\.set\(name, value, \{ scope\? \}\)/);
});
