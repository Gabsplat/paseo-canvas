import { z } from "zod";

export const idSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).refine(id => !["__proto__", "constructor", "prototype"].includes(id));
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const jsonObjectSchema = z.record(z.string().max(100), z.json());
export const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
// Optional presentation size. Old documents stay automatic; null explicitly returns a resized block to automatic.
export const blockSizeSchema = z.object({ width: z.number().finite().min(160).max(4096), height: z.number().finite().min(104).max(4096) }).strict();
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
}).strict();
// Like groupPatchSchema, omitted fields must not acquire their creation defaults.
export const linkPatchSchema = z.object({
  from: idSchema.optional(), to: idSchema.optional(), label: z.string().max(200).optional(),
  kind: z.enum(["flow", "depends", "reference"]).optional(),
  tone: linkSchema.shape.tone,
}).strict();
export const diagramNodeSchema = z.object({ id: idSchema, label: z.string().min(1).max(200), description: z.string().max(1000).optional(), position: positionSchema.optional() }).strict();
export const diagramEdgeSchema = z.object({ id: idSchema, from: idSchema, to: idSchema, label: z.string().max(200).optional() }).strict();
export const diagramDataSchema = z.object({ nodes: z.array(diagramNodeSchema).max(100), edges: z.array(diagramEdgeSchema).max(200), caption: z.string().max(2000).optional() }).strict().superRefine((data, context) => {
  const ids = new Set(data.nodes.map(node => node.id));
  if (ids.size !== data.nodes.length) context.addIssue({ code: "custom", path: ["nodes"], message: "Node IDs must be unique." });
  if (new Set(data.edges.map(edge => edge.id)).size !== data.edges.length) context.addIssue({ code: "custom", path: ["edges"], message: "Edge IDs must be unique." });
  data.edges.forEach((edge, index) => { if (!ids.has(edge.from) || !ids.has(edge.to)) context.addIssue({ code: "custom", path: ["edges", index], message: "Both edge endpoints must exist." }); });
});
export type DiagramNode = z.infer<typeof diagramNodeSchema>;
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;
export type DiagramData = z.infer<typeof diagramDataSchema>;
export const checklistItemSchema = z.union([z.string().max(2000), z.object({ label: z.string().max(2000), done: z.boolean() }).strict()]);
export const checklistDataSchema = z.object({ items: z.array(checklistItemSchema).max(200) }).strict();
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export const blockSchema = z.object({
  id: idSchema, typeId: idSchema, title: z.string().max(300),
  data: jsonObjectSchema, position: positionSchema.optional(), size: blockSizeSchema.nullable().optional(),
  parentGroupId: idSchema.nullable().optional(), communication: communicationSchema.optional(),
}).strict();
export const groupSchema = z.object({
  id: idSchema, title: z.string().max(300), description: z.string().max(4000).default(""),
  blockIds: z.array(idSchema).max(1000), groupIds: z.array(idSchema).max(200).default([]),
  templateId: idSchema.optional(),
  parentGroupId: idSchema.nullable().optional(), position: positionSchema.optional(),
  collapsed: z.boolean().optional(), layout: layoutSchema.optional(),
  communication: communicationSchema.optional(),
}).strict();
// Zod 4 partial() retains inner defaults. Updates must preserve omitted fields.
export const groupPatchSchema = z.object({
  title: z.string().max(300).optional(), description: z.string().max(4000).optional(),
  blockIds: z.array(idSchema).max(1000).optional(), groupIds: z.array(idSchema).max(200).optional(),
  templateId: idSchema.optional(), parentGroupId: idSchema.nullable().optional(),
  position: positionSchema.optional(), collapsed: z.boolean().optional(),
  layout: layoutSchema.optional(), communication: communicationSchema.optional(),
}).strict();
export const documentContentSchema = z.object({
  title: z.string().min(1).max(300), description: z.string().max(4000).default(""),
  example: z.boolean().default(false),
  blocks: z.array(blockSchema).max(1000), groups: z.array(groupSchema).max(200),
  links: z.array(linkSchema).max(2000).default([]), layout: layoutSchema.optional(),
  selectedIds: z.array(idSchema).max(1200).default([]),
  communication: communicationSchema,
}).strict();
export const documentSchema = documentContentSchema.extend({
  id: idSchema, workspaceId: z.string().min(1).max(200), revision: revisionSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});

// Portable packs contain declarative data only. No code, file paths, or executable hooks.
export const propertySchema = z.object({
  key: idSchema, label: z.string().min(1).max(200),
  kind: z.enum(["text", "number", "boolean", "json"]), required: z.boolean().default(false),
}).strict();
export const blockTypeSchema = z.object({
  id: idSchema, name: z.string().min(1).max(200), description: z.string().max(2000),
  properties: z.array(propertySchema).max(50), defaults: jsonObjectSchema,
  renderer: z.enum(["text", "note", "code", "checklist", "choice", "form", "metric", "image-ref", "step", "callout", "preview-frame", "quiz", "progress", "diagram", "node"]).optional(),
}).strict();
export const templateSchema = z.object({
  id: idSchema, name: z.string().min(1).max(200), description: z.string().max(2000),
  blocks: z.array(blockSchema).max(1000), groups: z.array(groupSchema).max(200),
  links: z.array(linkSchema).max(2000).default([]),
}).strict();
export const packSchema = z.object({
  format: z.literal("paseo-canvas-pack"), version: z.literal(1),
  id: idSchema, name: z.string().min(1).max(200), description: z.string().max(2000),
  blockTypes: z.array(blockTypeSchema).max(100), templates: z.array(templateSchema).max(100),
  documents: z.array(documentContentSchema).max(20),
}).strict();
export const catalogSchema = z.object({
  revision: revisionSchema, blockTypes: z.array(blockTypeSchema),
  templates: z.array(templateSchema), packs: z.array(packSchema),
}).strict();
export const connectionSchema = z.object({
  agentId: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200),
  // Set when the user picks the recipient by hand. Automatic connection never replaces a pinned one.
  pinned: z.boolean().optional(),
}).strict();
export const sharingModeSchema = z.enum(["shared", "agent"]);
export type SharingMode = z.infer<typeof sharingModeSchema>;
export const documentViewSchema = z.object({
  document: documentSchema, connection: connectionSchema.nullable(),
  canUndo: z.boolean(), canRedo: z.boolean(),
  selectionVersion: revisionSchema, runtimeVersion: revisionSchema,
}).strict();
export const documentSummarySchema = documentSchema.pick({
  id: true, workspaceId: true, title: true, description: true, example: true, revision: true, updatedAt: true,
});

export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("document.update"), title: z.string().min(1).max(300).optional(), description: z.string().max(4000).optional(), layout: layoutSchema.optional() }).strict(),
  z.object({ type: z.literal("link.create"), link: linkSchema }).strict(),
  z.object({ type: z.literal("link.update"), id: idSchema, patch: linkPatchSchema }).strict(),
  z.object({ type: z.literal("link.delete"), id: idSchema }).strict(),
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
  z.object({ type: z.literal("template.insert"), templateId: idSchema, idPrefix: idSchema }).strict(),
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
  z.object({ type: z.literal("template.put"), template: templateSchema }).strict(),
  z.object({ type: z.literal("pack.import"), pack: packSchema, replace: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("pack.remove"), id: idSchema }).strict(),
]);
export const catalogMutateInputSchema = z.object({
  expectedRevision: revisionSchema, action: catalogMutationSchema,
}).strict();
export const agentActionInputSchema = revisionInputSchema.extend({
  eventId: idSchema,
  action: z.object({ kind: idSchema, label: z.string().min(1).max(300), payload: jsonObjectSchema, targetIds: z.array(idSchema).max(100).optional(), delivery: z.enum(["immediate", "batched"]).default("immediate") }).strict(),
});
export const agentEventSchema = z.object({
  id: idSchema, documentId: idSchema, agentId: z.string().nullable(), workspaceId: z.string(),
  createdAt: z.iso.datetime(), revision: revisionSchema,
  action: agentActionInputSchema.shape.action,
  context: documentContentSchema,
  status: z.enum(["pending", "sent", "failed", "acked"]), error: z.string().optional(),
}).strict();

export type CanvasBlock = z.infer<typeof blockSchema>;
export type CanvasLink = z.infer<typeof linkSchema>;
export type CanvasGroup = z.infer<typeof groupSchema>;
export type CanvasDocument = z.infer<typeof documentSchema>;
export type DocumentContent = z.infer<typeof documentContentSchema>;
export type DocumentView = z.infer<typeof documentViewSchema>;
export type CanvasOperation = z.infer<typeof operationSchema>;
export type CanvasCatalog = z.infer<typeof catalogSchema>;
export type CanvasPack = z.infer<typeof packSchema>;
export type BlockType = z.infer<typeof blockTypeSchema>;
export type GroupTemplate = z.infer<typeof templateSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentConnection = z.infer<typeof connectionSchema>;
