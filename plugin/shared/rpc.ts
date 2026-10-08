import { runtimeStateSchema, runtimeBlockStateSchema, variableNameSchema } from "./learning";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  idSchema, revisionInputSchema, revisionSchema, createInputSchema, mutateInputSchema,
  documentViewSchema, documentSummarySchema, catalogSchema, catalogMutateInputSchema,
  packSchema, templateSchema, agentActionInputSchema, agentEventSchema, connectionSchema, sharingModeSchema,
} from "./model";

export const scopeSchema = z.object({ workspaceId: z.string().min(1).max(200) }).strict();
export const readInputSchema = scopeSchema.extend({ documentId: idSchema });
export const listDocuments = defineRpc({ name: "canvas.list", input: scopeSchema, output: z.object({ documents: z.array(documentSummarySchema) }) });
export const readDocument = defineRpc({ name: "canvas.read", input: readInputSchema, output: documentViewSchema });
export const createDocument = defineRpc({ name: "canvas.create", input: createInputSchema, output: documentViewSchema });
export const mutateDocument = defineRpc({ name: "canvas.mutate", input: mutateInputSchema, output: documentViewSchema });
export const undoDocument = defineRpc({ name: "canvas.undo", input: revisionInputSchema, output: documentViewSchema });
export const redoDocument = defineRpc({ name: "canvas.redo", input: revisionInputSchema, output: documentViewSchema });
export const readCatalog = defineRpc({ name: "canvas.catalog.read", input: z.object({}).strict(), output: catalogSchema });
export const mutateCatalog = defineRpc({ name: "canvas.catalog.mutate", input: catalogMutateInputSchema, output: catalogSchema });
export const validatePack = defineRpc({ name: "canvas.pack.validate", input: z.object({ pack: z.unknown() }).strict(), output: z.object({ valid: z.boolean(), issues: z.array(z.string()) }) });
export const exportPack = defineRpc({ name: "canvas.pack.export", input: z.object({ id: idSchema }).strict(), output: packSchema });
export const instantiatePack = defineRpc({ name: "canvas.pack.instantiate", input: scopeSchema.extend({ packId: idSchema, documentIndex: z.number().int().nonnegative(), id: idSchema.optional() }), output: documentViewSchema });
export const connectAgent = defineRpc({
  name: "canvas.connect", input: revisionInputSchema.extend({ connection: connectionSchema.nullable() }),
  output: z.object({ view: documentViewSchema, requiresReload: z.boolean() }),
});
export const agentAction = defineRpc({ name: "canvas.agent.action", input: agentActionInputSchema, output: agentEventSchema });
export const readAgentEvents = defineRpc({ name: "canvas.agent.events", input: readInputSchema, output: z.object({ events: z.array(agentEventSchema) }) });
export const watchDocument = defineRpc({ name: "canvas.watch", input: readInputSchema.extend({ knownRevision: revisionSchema, knownRuntimeVersion: revisionSchema }), output: z.object({ revision: revisionSchema, runtimeVersion: revisionSchema, view: documentViewSchema.optional() }) });
export const setSelection = defineRpc({ name: "canvas.selection.set", input: readInputSchema.extend({ expectedSelectionVersion: revisionSchema, ids: z.array(idSchema).max(1200) }), output: documentViewSchema });
export const exportGroup = defineRpc({ name: "canvas.group.export", input: readInputSchema.extend({ groupId: idSchema, templateId: idSchema, name: z.string().min(1).max(200) }), output: z.object({ template: z.lazy(() => templateSchema) }) });
export const importPack = defineRpc({ name: "canvas.pack.import", input: z.object({ expectedRevision: revisionSchema, pack: z.unknown(), replace: z.boolean().default(false), dryRun: z.boolean().default(false) }).strict(), output: z.object({ catalog: catalogSchema, diff: z.object({ added: z.array(z.string()), replaced: z.array(z.string()), unchanged: z.array(z.string()) }), committed: z.boolean() }) });
export const readHistory = defineRpc({ name: "canvas.history", input: readInputSchema, output: z.object({ revision: revisionSchema, transactions: z.array(z.object({ id: idSchema, revision: revisionSchema, actor: z.enum(["user", "agent", "system"]), agentId: z.string().optional(), label: z.string(), at: z.iso.datetime(), changed: z.array(z.string()), removed: z.array(idSchema), kind: z.enum(["edit", "undo", "redo"]) })) }) });
export const agentSetup = defineRpc({ name: "canvas.agent.setup", input: scopeSchema.extend({ agentId: z.string().min(1).max(200), provider: z.enum(["codex", "claude", "opencode"]) }), output: z.object({ configuration: z.string(), instructions: z.string(), requiresReload: z.boolean() }) });
export const flushAgentEvents = defineRpc({ name: "canvas.agent.events.flush", input: readInputSchema, output: readAgentEvents.output });
// On for every workspace ("*") until the user turns it off. Affects agents created afterwards.
export const configureInjection = defineRpc({ name: "canvas.injection", input: z.object({ workspaceId: z.string().min(1).max(200), enabled: z.boolean(), expectedRevision: revisionSchema }).strict(), output: z.object({ revision: revisionSchema, workspaceIds: z.array(z.string()) }) });
// One canvas set per workspace ("shared") or documents private to the agent that created or received them ("agent").
export const readSharing = defineRpc({ name: "canvas.sharing.read", input: scopeSchema, output: z.object({ mode: sharingModeSchema }) });
export const configureSharing = defineRpc({ name: "canvas.sharing", input: scopeSchema.extend({ mode: sharingModeSchema }), output: readSharing.output });
export const readInjection = defineRpc({ name: "canvas.injection.read", input: z.object({}).strict(), output: configureInjection.output });

export const runtimeReadInputSchema = readInputSchema.extend({ blockIds: z.array(idSchema).max(4).default([]), scopeIds: z.array(z.union([idSchema, z.literal('$document')])).max(4).default([]) });
export const runtimeSetInputSchema = readInputSchema.extend({
  blocks: z.array(z.object({ id: idSchema, state: runtimeBlockStateSchema.nullable() }).strict()).max(4).default([]),
  scopes: z.array(z.object({ id: z.union([idSchema, z.literal('$document')]), values: z.record(variableNameSchema, z.number().finite().nullable()) }).strict()).max(4).default([]),
});
export const runtimeOutputSchema = z.object({ runtimeVersion: revisionSchema, runtime: runtimeStateSchema });
export const readRuntime = defineRpc({ name: 'canvas.runtime.read', input: runtimeReadInputSchema, output: runtimeOutputSchema });
export const setRuntime = defineRpc({ name: 'canvas.runtime.set', input: runtimeSetInputSchema, output: runtimeOutputSchema });
