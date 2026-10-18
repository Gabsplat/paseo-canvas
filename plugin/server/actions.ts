import { z } from "zod";
import { ACTION_LIMITS, actionScripts, validateActionInput, type ActionDefinition } from "../shared/actions";
import { EXTENSION_API, EXTENSION_FORBIDDEN_OPERATIONS, EXTENSION_LIMITS } from "../shared/extensions";
import { CanvasError } from "../shared/errors";
import { operationSchema, type CanvasCatalog, type CanvasDocument, type CanvasOperation, type CatalogExtension } from "../shared/model";
import { reduce, safeJson } from "./reducer";
import { runSandboxed, SandboxError } from "./sandbox";

/**
 * An extension's action, run for an agent: the extension's `<script data-lienzo="actions">` in QuickJS, with the
 * headless `lienzo` (context, edit, select, action, run; no page, theme or layout). Its edits are checked one call at a
 * time against a working copy of the document and returned together, to be committed as one transaction by the
 * service. A run that fails changes nothing.
 */
export type ActionOutcome = {
  result: unknown;
  operations: CanvasOperation[];
  label: string | null;
  /** The selection it asked for (the last lienzo.select), or null. */
  selection: string[] | null;
  logs: string[];
};

/** What runs inside before the extension's script. It receives the bridge as an argument; no global ever holds it. */
const PRELUDE = String.raw`(function (host) {
'use strict';
var parse = JSON.parse, stringify = JSON.stringify, P = Promise, keys = Object.keys, isArray = Array.isArray, Err = Error, Str = String;
function call(method, payload) {
  var text = stringify(payload === undefined ? null : payload);
  var answer = parse(host(method, typeof text === 'string' ? text : 'null'));
  if (answer && answer.error) throw new Err(answer.error);
  return answer ? answer.value : undefined;
}
var handlers = Object.create(null), ctx = call('context', null);
function line(kind) {
  return function () {
    var parts = [];
    for (var i = 0; i < arguments.length && i < 20; i++) { var a = arguments[i]; try { parts.push(typeof a === 'string' ? a : stringify(a)); } catch (e) { parts.push('[value]'); } }
    try { host('log', stringify({ kind: kind, text: parts.join(' ').slice(0, 1000) })); } catch (e) {}
  };
}
globalThis.lienzo = {
  api: 1, headless: true,
  get context() { return ctx; },
  onContext: function (fn) { if (typeof fn === 'function') fn(ctx); return function () {}; },
  action: function (name, fn) { if (typeof fn !== 'function') throw new TypeError('lienzo.action(name, fn) needs a function.'); handlers[Str(name)] = fn; return fn; },
  run: function (name, input) { return new P(function (ok) { var fn = handlers[Str(name)]; if (!fn) throw new Err('This extension has no action ' + Str(name) + '.'); ok(fn(input === undefined ? {} : input, ctx)); }); },
  select: function (ids) { return new P(function (ok) { ok(call('select', { ids: isArray(ids) ? ids : [ids] })); }); },
  edit: function (operations, label) { return new P(function (ok) { var r = call('edit', { operations: operations, label: label === undefined ? null : label }); ctx = r.context; ok({ revision: r.revision }); }); }
};
globalThis.console = { log: line('log'), info: line('log'), debug: line('log'), warn: line('warn'), error: line('error') };
return {
  start: function (name, input) {
    var fn = handlers[name];
    if (typeof fn !== 'function') return stringify({ missing: true, registered: keys(handlers) });
    return new P(function (ok) { ok(fn(parse(input), ctx)); }).then(function (value) {
      var out = stringify({ ok: true, value: value === undefined ? null : value });
      return typeof out === 'string' ? out : '{"ok":true,"value":null}';
    });
  }
};
})`;

/** The context an action sees: the frame's, without the theme and the layout, which belong to a screen. */
export function headlessContext(extension: CatalogExtension, document: CanvasDocument, catalog: CanvasCatalog) {
  return {
    api: EXTENSION_API, headless: true,
    extension: { id: extension.id, kind: extension.kind, name: extension.name, permissions: extension.granted ? extension.permissions : [] },
    document: { id: document.id, title: document.title, description: document.description, revision: document.revision,
      blocks: document.blocks.map(b => ({ id: b.id, title: b.title, typeId: b.typeId, renderer: catalog.blockTypes.find(t => t.id === b.typeId)?.renderer ?? null, data: b.data, parentGroupId: b.parentGroupId ?? null })),
      groups: document.groups.map(g => ({ id: g.id, title: g.title, description: g.description, blockIds: g.blockIds, groupIds: g.groupIds, parentGroupId: g.parentGroupId ?? null })),
      links: document.links.map(l => ({ id: l.id, from: l.from, to: l.to, kind: l.kind, label: l.label ?? "" })) },
    selection: [...document.selectedIds],
  };
}

const answer = (value: unknown) => JSON.stringify({ value: value ?? null });
const refuse = (error: string) => JSON.stringify({ error });
/** A refusal in words: a schema error as its first issues, a CanvasError without its code. */
const reason = (error: unknown) => error instanceof z.ZodError ? error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ")
  : error instanceof Error ? error.message.replace(/^[A-Z_]+: /, "") : "The canvas refused these operations.";
const parsed = (json: string): unknown => { const value: unknown = JSON.parse(json); safeJson(value); return value; };

/** Checks the input, runs the action, and returns what it asked for. Throws a CanvasError a person can act on. */
export async function runExtensionAction(options: { extension: CatalogExtension; action: string; input: unknown; document: CanvasDocument; catalog: CanvasCatalog }): Promise<ActionOutcome> {
  const { extension, catalog } = options;
  const declared = extension.actions ?? [];
  const action: ActionDefinition | undefined = declared.find(a => a.name === options.action);
  if (!action) throw new CanvasError("NOT_FOUND", declared.length ? `${extension.name} has no action ${options.action}. Its actions: ${declared.map(a => a.name).join(", ")}.` : `${extension.name} offers no actions to agents.`);
  const input = options.input ?? {};
  const inputText = JSON.stringify(input);
  if (inputText.length > ACTION_LIMITS.input) throw new CanvasError("TOO_LARGE", `The input is over ${ACTION_LIMITS.input} characters.`);
  try { safeJson(input); } catch (error) { throw new CanvasError("VALIDATION", `Invalid input: ${error instanceof Error ? error.message.replace(/^\w+: /, "") : "unsafe JSON"}`); }
  const issues = validateActionInput(action.input, input);
  if (issues.length) throw new CanvasError("VALIDATION", `Invalid input for ${options.action}: ${issues.join(" ")}`, { issues });
  const scripts = actionScripts(extension.html);
  if (!scripts.length) throw new CanvasError("NOT_FOUND", `${extension.name} declares ${options.action}, but its page has no <script data-lienzo="actions">.`);

  const held = extension.granted ? extension.permissions : [];
  let working = options.document, label: string | null = null, selection: string[] | null = null, denied = "", edits = 0, selects = 0;
  const operations: CanvasOperation[] = [], logs: string[] = [];
  const known = (id: unknown): id is string => typeof id === "string" && [...working.blocks, ...working.groups].some(entity => entity.id === id);

  const host = (method: string, json: string): string => {
    switch (method) {
      case "context": return answer(headlessContext(extension, working, catalog));
      case "log": {
        if (logs.length < ACTION_LIMITS.logs) { const line = parsed(json) as { kind?: unknown; text?: unknown }; logs.push(`${line?.kind === "log" ? "" : `${String(line?.kind)}: `}${String(line?.text ?? "")}`.slice(0, ACTION_LIMITS.logChars)); }
        return answer(null);
      }
      case "select": {
        if (++selects > ACTION_LIMITS.selects) return refuse(`lienzo.select may be called at most ${ACTION_LIMITS.selects} times in one run.`);
        const ids = (parsed(json) as { ids?: unknown })?.ids;
        if (!Array.isArray(ids)) return refuse("lienzo.select takes a list of ids.");
        selection = [...new Set(ids.filter(known))].slice(0, EXTENSION_LIMITS.selection);
        return answer({ ids: selection });
      }
      case "edit": {
        if (!held.includes("edit")) {
          denied = extension.permissions.includes("edit")
            ? `${extension.name} may not change the canvas yet: it came in a file and the person has not allowed it. Ask the person to allow it in Extensions.`
            : `${extension.name} does not declare the "edit" permission, so it cannot change the canvas.`;
          return refuse(denied);
        }
        if (++edits > ACTION_LIMITS.edits) return refuse(`lienzo.edit may be called at most ${ACTION_LIMITS.edits} times in one run.`);
        const payload = parsed(json) as { operations?: unknown; label?: unknown } | null;
        const list = payload?.operations;
        if (!Array.isArray(list) || !list.length) return refuse("lienzo.edit takes a non-empty list of operations.");
        if (operations.length + list.length > EXTENSION_LIMITS.operations) return refuse(`One run may send at most ${EXTENSION_LIMITS.operations} operations in all.`);
        const checked: CanvasOperation[] = [];
        for (const [index, raw] of list.entries()) {
          const type = raw && typeof raw === "object" ? (raw as { type?: unknown }).type : undefined;
          if ((EXTENSION_FORBIDDEN_OPERATIONS as readonly unknown[]).includes(type)) return refuse(`operations[${index}]: an extension cannot change the saved selection or the agent instructions with edit (use lienzo.select).`);
          const result = operationSchema.safeParse(raw);
          if (!result.success) return refuse(`operations[${index}]: ${result.error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "operation"}: ${issue.message}`).join("; ")}`);
          checked.push(result.data);
        }
        try { working = reduce(working, checked, catalog, "agent"); }
        catch (error) { return refuse(reason(error)); }
        operations.push(...checked);
        if (label === null) label = typeof payload?.label === "string" && payload.label.trim() ? payload.label.trim().slice(0, 200) : action.name;
        return answer({ revision: options.document.revision + 1, context: headlessContext(extension, working, catalog) });
      }
    }
    return refuse(`lienzo.${method} does not exist headless.`);
  };

  let text: string;
  try {
    text = await runSandboxed({
      prelude: PRELUDE, scripts: scripts.map((code, i) => ({ name: `${extension.id}.actions${scripts.length > 1 ? `.${i + 1}` : ""}.js`, code })),
      args: [action.name, inputText], host, bridgeChars: ACTION_LIMITS.payload,
      limits: { timeMs: ACTION_LIMITS.timeMs, memoryBytes: ACTION_LIMITS.memoryBytes, stackBytes: ACTION_LIMITS.stackBytes, jobs: ACTION_LIMITS.jobs, resultChars: ACTION_LIMITS.result + 32 },
    });
  } catch (error) {
    if (denied) throw new CanvasError("FORBIDDEN", denied, { logs });
    if (error instanceof SandboxError) throw new CanvasError("EXTENSION_FAILED", `${extension.name} → ${action.name} failed and changed nothing. ${error.reason === "error" ? `${error.errorName}: ${error.message}` : error.message}`, { reason: error.reason, logs });
    throw error;
  }
  let outcome: { ok?: boolean; value?: unknown; missing?: boolean; registered?: unknown };
  try { outcome = parsed(text) as typeof outcome; }
  catch (error) { throw new CanvasError("EXTENSION_FAILED", `${extension.name} → ${action.name} returned something that is not plain JSON data (${error instanceof Error ? error.message.replace(/^[A-Z_]+: /, "") : "invalid"}). Nothing changed.`, { reason: "output", logs }); }
  if (outcome?.missing) throw new CanvasError("NOT_FOUND", `${extension.name} declares ${action.name}, but its actions script does not register it with lienzo.action. Registered: ${Array.isArray(outcome.registered) && outcome.registered.length ? outcome.registered.join(", ") : "none"}.`);
  if (JSON.stringify(outcome?.value ?? null).length > ACTION_LIMITS.result) throw new CanvasError("EXTENSION_FAILED", `${extension.name} → ${action.name} returned more than ${ACTION_LIMITS.result} characters. Nothing changed.`, { reason: "output", logs });
  return { result: outcome?.value ?? null, operations, label, selection, logs };
}
