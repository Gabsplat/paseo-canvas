import { storedRendererNames } from "./renderers";
import { variablesSchema, runtimeStateSchema } from "./learning";
import { z } from "zod";
import { DOCS_LIMITS, extensionDocsIssue } from "./markdown";
import { presentationSchema } from "./presentation";
import { CONTEXT_DOCUMENT_MODES } from "./extension-context";
import { actionListSchema } from "./actions";
import { bindingsSchema } from "./bindings";

export const idSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).refine(id => !["__proto__", "constructor", "prototype"].includes(id));
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const jsonObjectSchema = z.record(z.string().max(100), z.json());
export const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
// Optional presentation size. Old documents stay automatic; null explicitly returns a resized block to automatic.
// The wire envelope admits small whiteboard objects. Server validation enforces renderer-specific minima.
export const blockSizeSchema = z.object({ width: z.number().finite().min(8).max(4096), height: z.number().finite().min(8).max(4096) }).strict();
export const communicationSchema = z.object({
  instructions: z.string().max(8000),
  intent: z.string().max(1000).default(""),
  audience: z.string().max(500).default(""),
}).strict();
export const layoutSchema = z.object({ mode: z.enum(["free", "stack", "grid", "flow", "graph"]), direction: z.enum(["down", "right"]).optional(), gap: z.number().nonnegative().max(1000).optional(), columns: z.number().int().min(1).max(20).optional() }).strict();
export const linkSchema = z.object({
  id: idSchema, from: idSchema, to: idSchema, label: z.string().max(200).optional(),
  kind: z.enum(["flow", "depends", "reference"]).default("flow"),
  tone: z.enum(["neutro", "acento", "violeta", "turquesa", "aviso", "peligro"]).optional(),
  // The bundle it travels in (bundleSchema): drawn as one lane of a strand of parallel wires between the bundle's clips.
  bundleId: idSchema.optional(),
}).strict();
/**
 * A link bundle gathers links that run between the same two areas into one strand of parallel lanes. `points` are the
 * clips the strand runs between (2), or a spine through up to 8 points, in world coordinates; with parentGroupId they are
 * relative to that Frame's top-left corner, so the strand moves with it. A bundle holds its links by their bundleId and
 * is removed with its last link. Old documents have none.
 */
export const LINK_BUNDLE_LIMITS = { links: 64, bundles: 200, points: 8, extent: 100_000 } as const;
export const bundleSchema = z.object({
  id: idSchema, points: z.array(positionSchema).min(2).max(LINK_BUNDLE_LIMITS.points), parentGroupId: idSchema.nullable().optional(),
}).strict();
export const bundlePatchSchema = z.object({ points: bundleSchema.shape.points.optional(), parentGroupId: idSchema.nullable().optional() }).strict();
// Like groupPatchSchema, omitted fields must not acquire their creation defaults.
export const linkPatchSchema = z.object({
  from: idSchema.optional(), to: idSchema.optional(), label: z.string().max(200).optional(),
  kind: z.enum(["flow", "depends", "reference"]).optional(),
  tone: linkSchema.shape.tone,
  // null takes the link out of its bundle.
  bundleId: idSchema.nullable().optional(),
}).strict();
export const checklistItemSchema = z.union([z.string().max(2000), z.object({ label: z.string().max(2000), done: z.boolean() }).strict()]);
export const checklistDataSchema = z.object({ items: z.array(checklistItemSchema).max(200) }).strict();
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export const blockSchema = z.object({
  id: idSchema, typeId: idSchema, title: z.string().max(300),
  data: jsonObjectSchema, position: positionSchema.optional(), size: blockSizeSchema.nullable().optional(),
  parentGroupId: idSchema.nullable().optional(), communication: communicationSchema.optional(),
  // Properties that follow a variable at render time (shared/bindings.ts). A patch replaces the whole map; null removes it.
  bindings: bindingsSchema.nullable().optional(),
}).strict();
// A Sheet is a chapter the agent adds while explaining: a top-level group that carries this mark. Numbers are unique
// within a document and never reused; new Sheets sit to the right of the last one on one horizontal strip.
export const sheetSchema = z.object({
  number: z.number().int().min(1).max(10_000), createdAt: z.iso.datetime(), source: z.enum(["agent", "user"]),
}).strict();
export const groupSchema = z.object({
  id: idSchema, title: z.string().max(300), description: z.string().max(4000).default(""),
  blockIds: z.array(idSchema).max(1000), groupIds: z.array(idSchema).max(200).default([]),
  templateId: idSchema.optional(),
  parentGroupId: idSchema.nullable().optional(), position: positionSchema.optional(),
  collapsed: z.boolean().optional(), layout: layoutSchema.optional(),
  // Lock position: the Frame does not move by hand (header drag, arrow keys, align). Its children stay editable.
  locked: z.boolean().optional(),
  communication: communicationSchema.optional(), variables: variablesSchema.optional(),
  sheet: sheetSchema.optional(),
}).strict();
// Zod 4 partial() retains inner defaults. Updates must preserve omitted fields.
export const groupPatchSchema = z.object({
  title: z.string().max(300).optional(), description: z.string().max(4000).optional(),
  blockIds: z.array(idSchema).max(1000).optional(), groupIds: z.array(idSchema).max(200).optional(),
  templateId: idSchema.optional(), parentGroupId: idSchema.nullable().optional(),
  position: positionSchema.optional(), collapsed: z.boolean().optional(), locked: z.boolean().optional(),
  layout: layoutSchema.optional(), communication: communicationSchema.optional(), variables: variablesSchema.optional(),
}).strict();
export const documentContentSchema = z.object({
  title: z.string().min(1).max(300), description: z.string().max(4000).default(""),
  example: z.boolean().default(false),
  blocks: z.array(blockSchema).max(1000), groups: z.array(groupSchema).max(200),
  links: z.array(linkSchema).max(2000).default([]), layout: layoutSchema.optional(),
  bundles: z.array(bundleSchema).max(LINK_BUNDLE_LIMITS.bundles).optional(),
  variables: variablesSchema.optional(),
  selectedIds: z.array(idSchema).max(1200).default([]),
  communication: communicationSchema,
}).strict();
export const documentSchema = documentContentSchema.extend({
  id: idSchema, workspaceId: z.string().min(1).max(200), revision: revisionSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});

// Portable packs are declarative data, with one exception: extensions (below) carry a page that runs only sandboxed.
// No file paths and no hooks into the plugin or the host.
export const propertySchema = z.object({
  key: idSchema, label: z.string().min(1).max(200),
  kind: z.enum(["text", "number", "boolean", "json"]), required: z.boolean().default(false),
  // Hints for the Properties panel; the stored value is the same. options: suggested values for a text property
  // (the person picks one or types another). advanced: shown under "More options" until it holds a value.
  // help: one short line under the field.
  options: z.array(z.string().min(1).max(80)).max(24).optional(), advanced: z.boolean().optional(), help: z.string().max(200).optional(),
}).strict();
export const blockTypeSchema = z.object({
  id: idSchema, name: z.string().min(1).max(200), description: z.string().max(2000),
  properties: z.array(propertySchema).max(50), defaults: jsonObjectSchema,
  // Includes retired renderer names: stored catalogs and packs that still carry them must keep loading.
  renderer: z.enum(storedRendererNames).optional(),
}).strict();
export const templateSchema = z.object({
  id: idSchema, name: z.string().min(1).max(200), description: z.string().max(2000),
  blocks: z.array(blockSchema).max(1000), groups: z.array(groupSchema).max(200),
  links: z.array(linkSchema).max(2000).default([]),
}).strict();
// An extension is the one kind of pack entry that carries code: a self-contained page that runs sandboxed in its own
// frame and reaches the canvas only through the versioned `lienzo` API (docs/extensions.md). It never imports plugin code.
// The canvas never sends anything to the agent, so there is no "agent" permission: a new extension that asks for it is
// refused, and a stored or imported one that carried it loads without it (extensionListSchema).
// "view" (added to API 1): read and move the canvas camera (lienzo.view), and lienzo.open also frames what it opens.
// "variables" (added to API 1): set the runtime values of variables (lienzo.variables.set). Never a revision; "edit"
// allows it too, since it can change the declarations themselves.
export const extensionPermissionSchema = z.enum(["edit", "network", "view", "variables"]);
// Only tools remain: the canvas is the one way to look at a document. Stored entries of the retired kind "view" are
// dropped on read (extensionListSchema), so catalogs and packs written before keep loading.
// `docs` (optional, added to API 1): the extension's own Help page, short Markdown or a few titled sections. It is
// shown in Help → Extensions, drawn as native text, never as HTML (shared/markdown.ts).
export const extensionDocsSchema = z.union([
  z.string().min(1).max(DOCS_LIMITS.chars),
  z.array(z.object({ title: z.string().min(1).max(DOCS_LIMITS.title), body: z.string().max(DOCS_LIMITS.chars) }).strict()).min(1).max(DOCS_LIMITS.sections),
]).superRefine((docs, ctx) => { const issue = extensionDocsIssue(docs); if (issue) ctx.addIssue({ code: "custom", message: issue }); });
export const extensionSchema = z.object({
  id: idSchema, kind: z.literal("tool"), api: z.literal(1),
  name: z.string().min(1).max(80), description: z.string().max(600).default(""), icon: z.string().regex(/^[A-Za-z0-9]{1,40}$/).optional(),
  html: z.string().min(1).max(300_000), permissions: z.array(extensionPermissionSchema).max(4).default([]),
  docs: extensionDocsSchema.optional(),
  // `actions` (optional, added to API 1): what the extension offers an agent through canvas_extension_run. Each is
  // declared here and registered by the page's `<script data-lienzo="actions">` with lienzo.action (shared/actions.ts).
  actions: actionListSchema.optional(),
  // `presentation` (optional, added to API 1): how it appears (a panel, an overlay over the canvas, a popover at the
  // selection, fullscreen), its size, chrome and accent (shared/presentation.ts). Sizes are clamped, not refused.
  presentation: presentationSchema.optional(),
  // `context` (optional, added to API 1): how much of the document the page is told (shared/extension-context.ts).
  // "outline" and "none" keep a heavy extension's messages small; lienzo.read(ids) brings whole entities when needed.
  context: z.object({ document: z.enum(CONTEXT_DOCUMENT_MODES).default("full") }).strict().optional(),
}).strict();
const isRetiredExtension = (entry: unknown) => !!entry && typeof entry === "object" && (entry as { kind?: unknown }).kind === "view";
/** Drops the retired "agent" permission from a stored or imported extension; everything else is left to validation. */
const withoutRetiredPermissions = (entry: unknown) => {
  if (!entry || typeof entry !== "object" || !Array.isArray((entry as { permissions?: unknown }).permissions)) return entry;
  const permissions = (entry as { permissions: unknown[] }).permissions;
  return permissions.includes("agent") ? { ...entry, permissions: permissions.filter(permission => permission !== "agent") } : entry;
};
/** A list of extensions that silently drops entries of a retired kind and retired permissions. */
export const extensionListSchema = (max: number) => z.preprocess(value => Array.isArray(value) ? value.filter(entry => !isRetiredExtension(entry)).map(withoutRetiredPermissions) : value, z.array(extensionSchema).max(max));
export const packSchema = z.object({
  format: z.literal("paseo-canvas-pack"), version: z.literal(1),
  id: idSchema, name: z.string().min(1).max(200), description: z.string().max(2000),
  blockTypes: z.array(blockTypeSchema).max(100), templates: z.array(templateSchema).max(100),
  documents: z.array(documentContentSchema).max(20), extensions: extensionListSchema(50).default([]),
}).strict();
// `source` is "local", "builtin" or the ID of the pack that brought it. An imported extension holds no permission
// until the person grants them; local and shipped ones are trusted.
export const catalogExtensionSchema = extensionSchema.extend({ source: z.string().min(1).max(200), granted: z.boolean() });
export const catalogSchema = z.object({
  // packs are the extension files the person imported. Templates left the app: stored ones load but are not listed.
  revision: revisionSchema, blockTypes: z.array(blockTypeSchema),
  packs: z.array(packSchema), extensions: z.array(catalogExtensionSchema).default([]),
  // SHA-256 of each installed file's extensions (server/catalog.ts, extensionsHash), by file id: Discover compares it
  // with the index to see a change in code, not only in name or description.
  packHashes: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)).optional(),
}).strict();
export const connectionSchema = z.object({
  agentId: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200),
  // Set when the person picks the agent by hand. Automatic connection never replaces a pinned one.
  pinned: z.boolean().optional(),
}).strict();
export const sharingModeSchema = z.enum(["shared", "agent"]);
// Copilot mode is per agent (one conversation). thinking: after reasoning or each tool use; step: after each step worth
// showing (default); task: once at the end of a task; custom: follow `rule`.
export const copilotCadenceSchema = z.enum(["thinking", "step", "task", "custom"]);
export const copilotSettingsSchema = z.object({
  enabled: z.boolean().default(false), cadence: copilotCadenceSchema.default("step"), rule: z.string().max(500).default(""),
  remind: z.boolean().default(false), documentId: idSchema.nullable().default(null),
}).strict();
export type CopilotCadence = z.infer<typeof copilotCadenceSchema>;
export type CopilotSettings = z.infer<typeof copilotSettingsSchema>;
export type SharingMode = z.infer<typeof sharingModeSchema>;
// The agent's most recent transaction on a document, from history: where "go to latest" flies. ids are the changed
// entities that still exist; removed lists what that transaction deleted.
export const latestAgentSchema = z.object({
  transactionId: z.string(), revision: revisionSchema, at: z.iso.datetime(), agentId: z.string().optional(),
  label: z.string(), kind: z.enum(["edit", "undo", "redo"]), ids: z.array(z.string()), removed: z.array(z.string()),
}).strict();
export const documentViewSchema = z.object({
  document: documentSchema, connection: connectionSchema.nullable(),
  canUndo: z.boolean(), canRedo: z.boolean(),
  selectionVersion: revisionSchema, runtimeVersion: revisionSchema, runtime: runtimeStateSchema.default({ blocks: {}, scopes: {} }),
  latestAgent: latestAgentSchema.nullable().optional(),
  // Counter of the document's comments (shared/comments.ts): changes when a thread changes, never with the revision.
  commentsVersion: revisionSchema.optional(),
}).strict();
export const documentSummarySchema = documentSchema.pick({
  id: true, workspaceId: true, title: true, description: true, example: true, revision: true, updatedAt: true,
}).extend({
  // For the Lienzos screen. Optional: a summary written by an older server has none.
  blockCount: z.number().int().nonnegative().optional(), groupCount: z.number().int().nonnegative().optional(),
  hojaCount: z.number().int().nonnegative().optional(), agentId: z.string().nullable().optional(),
});

export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("document.update"), title: z.string().min(1).max(300).optional(), description: z.string().max(4000).optional(), layout: layoutSchema.optional(), variables: variablesSchema.optional() }).strict(),
  z.object({ type: z.literal("link.create"), link: linkSchema }).strict(),
  z.object({ type: z.literal("link.update"), id: idSchema, patch: linkPatchSchema }).strict(),
  z.object({ type: z.literal("link.delete"), id: idSchema }).strict(),
  z.object({ type: z.literal("bundle.create"), bundle: bundleSchema, linkIds: z.array(idSchema).min(1).max(LINK_BUNDLE_LIMITS.links) }).strict(),
  z.object({ type: z.literal("bundle.update"), id: idSchema, patch: bundlePatchSchema }).strict(),
  z.object({ type: z.literal("bundle.delete"), id: idSchema }).strict(),
  z.object({ type: z.literal("block.create"), block: blockSchema }).strict(),
  z.object({ type: z.literal("block.update"), id: idSchema, patch: blockSchema.omit({ id: true }).partial() }).strict(),
  z.object({ type: z.literal("block.delete"), id: idSchema }).strict(),
  z.object({ type: z.literal("group.create"), group: groupSchema }).strict(),
  z.object({ type: z.literal("group.update"), id: idSchema, patch: groupPatchSchema }).strict(),
  z.object({ type: z.literal("group.delete"), id: idSchema, ungroup: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("entity.move"), id: idSchema, parentGroupId: idSchema.nullable(), position: positionSchema.optional() }).strict(),
  z.object({ type: z.literal("entity.duplicate"), id: idSchema, idPrefix: idSchema }).strict(),
  z.object({ type: z.literal("selection.set"), ids: z.array(idSchema).max(1200) }).strict(),
  z.object({ type: z.literal("communication.set"), communication: communicationSchema }).strict(),
]);
export const mutateInputSchema = z.object({
  documentId: idSchema, expectedRevision: revisionSchema,
  operations: z.array(operationSchema).min(1).max(200),
  workspaceId: z.string().min(1).max(200), label: z.string().min(1).max(300).default("Edit canvas"),
}).strict();
export const revisionInputSchema = z.object({ documentId: idSchema, workspaceId: z.string().min(1).max(200), expectedRevision: revisionSchema }).strict();
export const createInputSchema = z.object({
  id: idSchema.optional(), workspaceId: z.string().min(1).max(200), content: documentContentSchema,
}).strict();
export const catalogMutationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("type.put"), blockType: blockTypeSchema }).strict(),
  z.object({ type: z.literal("pack.remove"), id: idSchema }).strict(),
  z.object({ type: z.literal("extension.put"), extension: extensionSchema }).strict(),
  z.object({ type: z.literal("extension.remove"), id: idSchema }).strict(),
  z.object({ type: z.literal("extension.grant"), id: idSchema, granted: z.boolean() }).strict(),
]);
export const catalogMutateInputSchema = z.object({
  expectedRevision: revisionSchema, action: catalogMutationSchema,
}).strict();

export type CanvasBlock = z.infer<typeof blockSchema>;
export type CanvasLink = z.infer<typeof linkSchema>;
export type CanvasBundle = z.infer<typeof bundleSchema>;
export type CanvasGroup = z.infer<typeof groupSchema>;
export type CanvasSheet = z.infer<typeof sheetSchema>;
export type LatestAgent = z.infer<typeof latestAgentSchema>;
export type CanvasDocument = z.infer<typeof documentSchema>;
export type DocumentContent = z.infer<typeof documentContentSchema>;
export type DocumentView = z.infer<typeof documentViewSchema>;
export type CanvasOperation = z.infer<typeof operationSchema>;
export type CanvasCatalog = z.infer<typeof catalogSchema>;
export type CanvasPack = z.infer<typeof packSchema>;
export type CanvasExtension = z.infer<typeof extensionSchema>;
export type CatalogExtension = z.infer<typeof catalogExtensionSchema>;
export type ExtensionPermission = z.infer<typeof extensionPermissionSchema>;
export type BlockType = z.infer<typeof blockTypeSchema>;
export type GroupTemplate = z.infer<typeof templateSchema>;
export type AgentConnection = z.infer<typeof connectionSchema>;
