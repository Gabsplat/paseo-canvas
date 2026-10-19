import { runtimeJsonSchema, runtimeStateSchema, runtimeBlockStateSchema, variableNameSchema } from "./learning";
import { defineRpc } from "./contract";
import { MEDIA_LIMITS } from "./media";
import { commentAnchorSchema, commentTextSchema, commentsViewSchema, COMMENT_LIMITS } from "./comments";
import { z } from "zod";
import {
  idSchema, revisionInputSchema, revisionSchema, createInputSchema, mutateInputSchema,
  documentViewSchema, documentSummarySchema, catalogSchema, catalogMutateInputSchema,
  connectionSchema, sharingModeSchema,
  copilotCadenceSchema, copilotSettingsSchema, latestAgentSchema, layoutSchema,
} from "./model";

export const scopeSchema = z.object({ workspaceId: z.string().min(1).max(200) }).strict();
export const readInputSchema = scopeSchema.extend({ documentId: idSchema });
export const listDocuments = defineRpc({ name: "canvas.list", input: scopeSchema, output: z.object({ documents: z.array(documentSummarySchema) }) });
export const readDocument = defineRpc({ name: "canvas.read", input: readInputSchema, output: documentViewSchema });
export const createDocument = defineRpc({ name: "canvas.create", input: createInputSchema, output: documentViewSchema });
export const deleteDocument = defineRpc({ name: "canvas.delete", input: readInputSchema, output: z.object({ deleted: z.boolean() }) });
export const mutateDocument = defineRpc({ name: "canvas.mutate", input: mutateInputSchema, output: documentViewSchema });
export const undoDocument = defineRpc({ name: "canvas.undo", input: revisionInputSchema, output: documentViewSchema });
export const redoDocument = defineRpc({ name: "canvas.redo", input: revisionInputSchema, output: documentViewSchema });
export const readCatalog = defineRpc({ name: "canvas.catalog.read", input: z.object({}).strict(), output: catalogSchema });
export const mutateCatalog = defineRpc({ name: "canvas.catalog.mutate", input: catalogMutateInputSchema, output: catalogSchema });
// An extension file is the pack format holding only extensions. Validate, then import (dryRun first for the review).
export const validatePack = defineRpc({ name: "canvas.pack.validate", input: z.object({ pack: z.unknown() }).strict(), output: z.object({ valid: z.boolean(), issues: z.array(z.string()) }) });
export const connectAgent = defineRpc({
  name: "canvas.connect", input: revisionInputSchema.extend({ connection: connectionSchema.nullable() }),
  output: z.object({ view: documentViewSchema, requiresReload: z.boolean() }),
});
export const watchDocument = defineRpc({ name: "canvas.watch", input: readInputSchema.extend({ knownRevision: revisionSchema, knownRuntimeVersion: revisionSchema, knownCommentsVersion: revisionSchema.optional() }), output: z.object({ revision: revisionSchema, runtimeVersion: revisionSchema, commentsVersion: revisionSchema.optional(), view: documentViewSchema.optional() }) });
export const setSelection = defineRpc({ name: "canvas.selection.set", input: readInputSchema.extend({ expectedSelectionVersion: revisionSchema, ids: z.array(idSchema).max(1200) }), output: documentViewSchema });
export const importPack = defineRpc({ name: "canvas.pack.import", input: z.object({ expectedRevision: revisionSchema, pack: z.unknown(), replace: z.boolean().default(false), dryRun: z.boolean().default(false) }).strict(), output: z.object({ catalog: catalogSchema, diff: z.object({ added: z.array(z.string()), replaced: z.array(z.string()), unchanged: z.array(z.string()) }), committed: z.boolean() }) });
export const readHistory = defineRpc({ name: "canvas.history", input: readInputSchema, output: z.object({ revision: revisionSchema, transactions: z.array(z.object({ id: idSchema, revision: revisionSchema, actor: z.enum(["user", "agent", "system"]), agentId: z.string().optional(), label: z.string(), at: z.iso.datetime(), changed: z.array(z.string()), removed: z.array(idSchema), kind: z.enum(["edit", "undo", "redo"]) })) }) });
export const agentSetup = defineRpc({ name: "canvas.agent.setup", input: scopeSchema.extend({ agentId: z.string().min(1).max(200), provider: z.enum(["codex", "claude", "opencode"]) }), output: z.object({ configuration: z.string(), instructions: z.string(), requiresReload: z.boolean() }) });
// Legacy: every new agent now gets the Lienzo tools at creation, whatever this says. Kept so older panels keep working.
export const configureInjection = defineRpc({ name: "canvas.injection", input: z.object({ workspaceId: z.string().min(1).max(200), enabled: z.boolean(), expectedRevision: revisionSchema }).strict(), output: z.object({ revision: revisionSchema, workspaceIds: z.array(z.string()) }) });
// One canvas set per workspace ("shared") or documents private to the agent that created or received them ("agent").
export const readSharing = defineRpc({ name: "canvas.sharing.read", input: scopeSchema, output: z.object({ mode: sharingModeSchema }) });
export const configureSharing = defineRpc({ name: "canvas.sharing", input: scopeSchema.extend({ mode: sharingModeSchema }), output: readSharing.output });
export const readInjection = defineRpc({ name: "canvas.injection.read", input: z.object({}).strict(), output: configureInjection.output });
// Images from the person's computer (shared/media.ts): stored by content hash beside the Lienzo data, read back as base64.
export const putMedia = defineRpc({ name: "canvas.media.put", input: scopeSchema.extend({ data: z.string().max(Math.ceil(MEDIA_LIMITS.bytes * 4 / 3) + 4), name: z.string().max(300).optional() }), output: z.object({ url: z.string(), mime: z.string(), bytes: z.number().int().nonnegative(), existed: z.boolean() }) });
export const readMedia = defineRpc({ name: "canvas.media.read", input: scopeSchema.extend({ url: z.string().max(200) }), output: z.object({ mime: z.string(), data: z.string(), bytes: z.number().int().nonnegative() }) });

export const runtimeReadInputSchema = readInputSchema.extend({ blockIds: z.array(idSchema).max(4).default([]), scopeIds: z.array(z.union([idSchema, z.literal('$document')])).max(4).default([]) });
export const runtimeSetInputSchema = readInputSchema.extend({
  blocks: z.array(z.object({ id: idSchema, state: runtimeBlockStateSchema.nullable() }).strict()).max(4).default([]),
  scopes: z.array(z.object({ id: z.union([idSchema, z.literal('$document')]), values: z.record(variableNameSchema, z.number().finite().nullable()) }).strict()).max(4).default([]),
});
export const runtimeOutputSchema = z.object({ runtimeVersion: revisionSchema, runtime: runtimeStateSchema });
export const readRuntime = defineRpc({ name: 'canvas.runtime.read', input: runtimeReadInputSchema, output: runtimeOutputSchema });
export const setRuntime = defineRpc({ name: 'canvas.runtime.set', input: runtimeSetInputSchema, output: runtimeOutputSchema });
// lienzo.storage: one small JSON value per extension and document. Like runtime it has no revision or history; unlike
// runtime it is not in the document view, canvas_read or canvas_runtime: only the extension reads it back.
export const extensionStorageInputSchema = readInputSchema.extend({ extensionId: idSchema, action: z.enum(['get', 'set']), value: runtimeJsonSchema.nullable().default(null) });
export const extensionStorage = defineRpc({ name: 'canvas.extension.storage', input: extensionStorageInputSchema, output: z.object({ value: runtimeJsonSchema.nullable() }) });

// Copilot: per agent (one conversation). Every new agent has the Lienzo tools; the copilot decides whether it draws.
const agentScopeSchema = scopeSchema.extend({ agentId: z.string().min(1).max(200) });
export const copilotLatestSchema = latestAgentSchema.extend({ documentId: idSchema, titles: z.array(z.string()).max(3) });
export const copilotViewSchema = z.object({
  agentId: z.string(), copilot: copilotSettingsSchema,
  // False for agents created before the plugin gave every agent its tools: the copilot cannot draw for them.
  hasTools: z.boolean(),
  // A Lienzo tool call is in flight, or ended less than 3 s ago.
  drawing: z.boolean(), lastToolAt: z.iso.datetime().nullable(),
  // openComments: open comment threads on it, a reminder for the person in the popover; never sent to the agent.
  document: z.object({ id: idSchema, title: z.string(), openComments: z.number().int().nonnegative().optional() }).nullable(),
  latest: copilotLatestSchema.nullable(),
});
export const readCopilot = defineRpc({ name: "canvas.copilot.read", input: agentScopeSchema, output: copilotViewSchema });
export const setCopilot = defineRpc({
  name: "canvas.copilot.set",
  input: agentScopeSchema.extend({
    patch: z.object({ enabled: z.boolean().optional(), cadence: copilotCadenceSchema.optional(), rule: z.string().max(500).optional(), remind: z.boolean().optional(), documentId: idSchema.nullable().optional() }).strict(),
    // Title for the conversation's Lienzo when turning on creates it.
    title: z.string().min(1).max(300).optional(),
  }),
  output: copilotViewSchema,
});
// Cheap status for composer pills: one call for every agent the client shows.
export const listCopilot = defineRpc({
  name: "canvas.copilot.list", input: z.object({ agentIds: z.array(z.string().min(1).max(200)).max(500) }).strict(),
  output: z.object({ agents: z.record(z.string(), z.object({ enabled: z.boolean(), drawing: z.boolean(), hasTools: z.boolean() })) }),
});
export const sheetSummarySchema = z.object({ id: idSchema, number: z.number().int(), title: z.string(), description: z.string(), createdAt: z.iso.datetime(), source: z.enum(["agent", "user"]), position: z.object({ x: z.number(), y: z.number() }), blockCount: z.number().int(), groupCount: z.number().int() });
export const createSheetInputSchema = revisionInputSchema.extend({ id: idSchema.optional(), title: z.string().min(1).max(300), description: z.string().max(4000).optional(), layout: layoutSchema.optional() });
export const createSheet = defineRpc({ name: "canvas.sheet.create", input: createSheetInputSchema, output: z.object({ view: documentViewSchema, id: idSchema, number: z.number().int() }) });
export const listSheets = defineRpc({ name: "canvas.sheet.list", input: readInputSchema, output: z.object({ revision: revisionSchema, sheets: z.array(sheetSummarySchema) }) });

// Settings → About: the version and the file that holds every Lienzo on this host. Nothing secret.
export const readAbout = defineRpc({ name: "canvas.about", input: z.object({}).strict(), output: z.object({ version: z.string(), dataFile: z.string(), host: z.string() }) });

// Comments (shared/comments.ts): the person's notes pinned on the canvas. No expectedRevision and no history: a comment
// never conflicts with a drawing edit. Every call answers the document's whole set and its commentsVersion; the watch
// above carries commentsVersion, so a client reads them again only when they changed.
const threadInputSchema = readInputSchema.extend({ threadId: idSchema });
export const listComments = defineRpc({ name: "canvas.comments.list", input: readInputSchema, output: commentsViewSchema });
export const createComment = defineRpc({ name: "canvas.comments.create", input: readInputSchema.extend({ anchor: commentAnchorSchema, text: commentTextSchema, via: z.string().min(1).max(COMMENT_LIMITS.label).optional() }), output: commentsViewSchema });
export const replyComment = defineRpc({ name: "canvas.comments.reply", input: threadInputSchema.extend({ text: commentTextSchema, via: z.string().min(1).max(COMMENT_LIMITS.label).optional() }), output: commentsViewSchema });
export const resolveComment = defineRpc({ name: "canvas.comments.resolve", input: threadInputSchema, output: commentsViewSchema });
export const reopenComment = defineRpc({ name: "canvas.comments.reopen", input: threadInputSchema, output: commentsViewSchema });
export const deleteComment = defineRpc({ name: "canvas.comments.delete", input: threadInputSchema, output: commentsViewSchema });
// Where pins on blocks and groups were last drawn (world units), so a thread keeps its place if its entity is deleted.
// A hint: it changes no counter and is never shown while the entity exists.
export const locateComments = defineRpc({ name: "canvas.comments.locate", input: readInputSchema.extend({ points: z.array(z.object({ threadId: idSchema, x: z.number().finite(), y: z.number().finite() }).strict()).max(COMMENT_LIMITS.threads) }), output: z.object({ updated: z.number().int() }) });
