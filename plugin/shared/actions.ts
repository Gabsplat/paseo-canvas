import { z } from "zod";

/**
 * Extension actions: what an extension offers an agent. The manifest declares each one (name, description, the shape
 * of its input); the code that does the work is a script in the extension's own page, marked
 * `<script data-lienzo="actions">`, that registers handlers with `lienzo.action(name, fn)`. The same script runs in
 * the person's frame (where the page's buttons can call `lienzo.run(name, input)`) and, for the agent, headless on the
 * server in a QuickJS interpreter (server/actions.ts). One file, one implementation. docs/extensions.md, "Actions".
 *
 * Inputs are described with a small subset of JSON Schema, validated here before any code runs.
 */
export const ACTION_LIMITS = {
  /** Actions per extension. */
  actions: 20,
  /** Wall-clock budget of one run, which is CPU time: the interpreter runs synchronously. */
  timeMs: 2000,
  memoryBytes: 64 * 1024 * 1024,
  /**
   * The interpreter's own stack. Small on purpose: QuickJS must stop deep recursion before the host's stack does
   * (about 370 plain nested calls). The host stack is also caught as a last resort.
   */
  stackBytes: 64 * 1024,
  /** Promise jobs in one run: an async flood ends here or at the time limit. */
  jobs: 100_000,
  /** JSON sizes, in characters. */
  input: 16 * 1024, result: 16 * 1024, payload: 1024 * 1024,
  /** Calls a run may make to edit and select, and console lines it may leave. */
  edits: 20, selects: 20, logs: 10, logChars: 300,
  /** Nesting of an input schema. */
  schemaDepth: 6,
} as const;

export const actionNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, "An action name is a letter, then up to 39 letters, digits or _.");
const propertyName = z.string().regex(/^[a-zA-Z_$][a-zA-Z0-9_$-]{0,59}$/).refine(key => !["__proto__", "constructor", "prototype"].includes(key), "Unsafe property name.");
const scalar = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

/** The JSON Schema subset an action's input (and, for documentation, its result) is described with. */
export type ActionSchema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string; enum?: (string | number | boolean)[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  items?: ActionSchema; minItems?: number; maxItems?: number;
  properties?: Record<string, ActionSchema>; required?: string[]; additionalProperties?: boolean;
};
export const actionSchemaSchema: z.ZodType<ActionSchema> = z.lazy(() => z.object({
  type: z.enum(["object", "array", "string", "number", "integer", "boolean"]),
  description: z.string().max(400).optional(), enum: z.array(scalar).min(1).max(50).optional(),
  minimum: z.number().finite().optional(), maximum: z.number().finite().optional(),
  minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().nonnegative().optional(),
  items: actionSchemaSchema.optional(), minItems: z.number().int().nonnegative().optional(), maxItems: z.number().int().nonnegative().optional(),
  properties: z.record(propertyName, actionSchemaSchema).refine(p => Object.keys(p).length <= 40, "At most 40 properties.").optional(),
  required: z.array(propertyName).max(40).optional(), additionalProperties: z.boolean().optional(),
}).strict());

export const actionDefinitionSchema = z.object({
  name: actionNameSchema,
  description: z.string().min(1).max(600).refine(text => !/<\/?[a-zA-Z!][^>]*>/.test(text), "An action's description is plain text: no HTML."),
  /** Always an object schema: an action takes named arguments. Omitted: it takes none. */
  input: actionSchemaSchema.optional(),
  /** What it returns, for the agent's and the person's documentation only. */
  returns: actionSchemaSchema.optional(),
}).strict().superRefine((action, ctx) => {
  if (action.input && action.input.type !== "object") ctx.addIssue({ code: "custom", path: ["input"], message: "An action's input is an object schema (type \"object\")." });
  for (const [key, schema] of [["input", action.input], ["returns", action.returns]] as const) {
    const issue = schema && schemaIssue(schema);
    if (issue) ctx.addIssue({ code: "custom", path: [key], message: issue });
  }
});
export const actionListSchema = z.array(actionDefinitionSchema).min(1).max(ACTION_LIMITS.actions)
  .superRefine((actions, ctx) => { if (new Set(actions.map(a => a.name)).size !== actions.length) ctx.addIssue({ code: "custom", message: "Two actions share a name." }); });
export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;

/** Rules a schema must follow beyond its shape: depth, required keys that exist, keywords that fit its type. */
function schemaIssue(schema: ActionSchema, depth = 1): string | null {
  if (depth > ACTION_LIMITS.schemaDepth) return `A schema nests at most ${ACTION_LIMITS.schemaDepth} levels.`;
  const { type } = schema;
  if (schema.properties || schema.required || schema.additionalProperties !== undefined) if (type !== "object") return "properties, required and additionalProperties belong to an object schema.";
  if (schema.items || schema.minItems !== undefined || schema.maxItems !== undefined) if (type !== "array") return "items, minItems and maxItems belong to an array schema.";
  if ((schema.minLength !== undefined || schema.maxLength !== undefined) && type !== "string") return "minLength and maxLength belong to a string schema.";
  if ((schema.minimum !== undefined || schema.maximum !== undefined) && type !== "number" && type !== "integer") return "minimum and maximum belong to a number schema.";
  for (const key of schema.required ?? []) if (!schema.properties || !Object.hasOwn(schema.properties, key)) return `required names ${key}, which is not among the properties.`;
  for (const child of [...Object.values(schema.properties ?? {}), ...(schema.items ? [schema.items] : [])]) { const issue = schemaIssue(child, depth + 1); if (issue) return issue; }
  return null;
}

const kind = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
/**
 * Checks a value against a schema. Objects are closed unless the schema says `additionalProperties: true`, so a
 * misspelt argument is an error rather than silently ignored. Returns the problems, at most 10, empty when valid.
 */
export function validateActionInput(schema: ActionSchema | undefined, value: unknown): string[] {
  const issues: string[] = [];
  const check = (s: ActionSchema, v: unknown, path: string) => {
    if (issues.length >= 10) return;
    const at = path || "input", got = kind(v);
    const fits = s.type === "integer" ? typeof v === "number" && Number.isInteger(v) : s.type === "number" ? typeof v === "number" && Number.isFinite(v) : got === s.type;
    if (!fits) { issues.push(`${at} should be ${s.type === "integer" ? "an integer" : s.type === "array" || s.type === "object" ? `an ${s.type}` : `a ${s.type}`}, not ${got}.`); return; }
    if (s.enum && !s.enum.includes(v as string | number | boolean)) issues.push(`${at} should be one of ${s.enum.map(e => JSON.stringify(e)).join(", ")}.`);
    if (typeof v === "number") {
      if (s.minimum !== undefined && v < s.minimum) issues.push(`${at} should be at least ${s.minimum}.`);
      if (s.maximum !== undefined && v > s.maximum) issues.push(`${at} should be at most ${s.maximum}.`);
    } else if (typeof v === "string") {
      if (s.minLength !== undefined && v.length < s.minLength) issues.push(`${at} should have at least ${s.minLength} characters.`);
      if (s.maxLength !== undefined && v.length > s.maxLength) issues.push(`${at} should have at most ${s.maxLength} characters.`);
    } else if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) issues.push(`${at} should have at least ${s.minItems} items.`);
      if (s.maxItems !== undefined && v.length > s.maxItems) issues.push(`${at} should have at most ${s.maxItems} items.`);
      if (s.items) v.forEach((item, i) => check(s.items!, item, `${at}[${i}]`));
    } else if (got === "object") {
      const object = v as Record<string, unknown>, properties = s.properties ?? {};
      for (const key of s.required ?? []) if (!Object.hasOwn(object, key)) issues.push(`${at}.${key} is required.`);
      for (const [key, child] of Object.entries(object)) {
        if (Object.hasOwn(properties, key)) check(properties[key], child, `${at}.${key}`);
        else if (!s.additionalProperties) issues.push(`${at}.${key} is not an argument of this action${Object.keys(properties).length ? ` (it takes ${Object.keys(properties).join(", ")})` : " (it takes none)"}.`);
      }
    }
  };
  check(schema ?? { type: "object", properties: {} }, value, "");
  return issues.slice(0, 10);
}

/**
 * The scripts of a page that hold its actions: every `<script data-lienzo="actions">`. They are found the way the
 * browser ends a script, at the first `</script`. Plain JavaScript that uses `lienzo` and no page (no DOM).
 */
export function actionScripts(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi))
    if (/\bdata-lienzo\s*=\s*(["']?)actions\1(?=[\s>]|$)/i.test(match[1])) found.push(match[2]);
  return found;
}
