import { cleanRuntime, DOCUMENT_SCOPE, RUNTIME_BLOCK_BYTES, RUNTIME_DOCUMENT_BYTES } from "../shared/learning";
import { safeJson } from "./reducer";
import type { RpcInput } from "@getpaseo/plugin";
import * as rpc from "../shared/rpc";
import {
  documentContentSchema, documentSchema, catalogMutateInputSchema,
  type CanvasDocument, type DocumentView, type AgentEvent,
} from "../shared/model";
import { CanvasError } from "../shared/errors";
import { CanvasStore, documentRecord, assertRevision, changedEntities, type RuntimeRecord, type DocumentRecord, type Actor, type HistoryEntry } from "./store";
import { catalogView, packDiff, packIssues, parsePack, validateTemplate, validateType } from "./catalog";
import { clone, newId, reduce, validateDocument, normalizeBlock, exportGroup as groupTemplate, effectiveInstructions } from "./reducer";

const timestamp = () => new Date().toISOString();
type State = Parameters<Parameters<CanvasStore["transaction"]>[0]>[0];
// Untouched preferences mean "every workspace": installing the plugin is enough for new agents to get the tools.
// The user turns this off from the agent dialog; any explicit choice is stored and respected.
const injectionOf = (state: State) => state.injection.revision === 0 && !state.injection.workspaceIds.length ? { revision: 0, workspaceIds: ["*"] } : state.injection;
/** With one canvas per agent, a document is reachable by its creator, its recipient, or anyone while it is unclaimed. */
const reachable = (state: State, record: DocumentRecord, agentId: string) => state.sharing[record.document.workspaceId] !== "agent"
  || record.ownerAgentId === agentId || record.connection?.agentId === agentId || !record.ownerAgentId && !record.connection;
const view = (record: DocumentRecord, actor: Actor = "user", agentId?: string): DocumentView => ({
  document: clone(record.document), connection: clone(record.connection),
  canUndo: record.history.some(entry => entry.kind === "edit" && entry.actor === actor && (actor !== "agent" || entry.agentId === agentId) && !entry.undone),
  canRedo: record.history.some(entry => entry.kind === "edit" && entry.actor === actor && (actor !== "agent" || entry.agentId === agentId) && entry.undone),
  selectionVersion: record.selectionVersion, runtimeVersion: record.runtimeVersion, runtime: clone(record.runtime),
});
const touchRuntime = (record: RuntimeRecord) => { record.runtimeVersion++; };
function recordEdit(record: DocumentRecord, next: CanvasDocument, actor: Actor, label: string, kind: HistoryEntry["kind"] = "edit", target?: string, agentId?: string): void {
  const before = clone(record.document);
  next.revision = before.revision + 1;
  next.updatedAt = timestamp();
  const delta = changedEntities(before, next);
  if (JSON.stringify(before.selectedIds) !== JSON.stringify(next.selectedIds)) { record.selectionVersion++; touchRuntime(record); }
  const entry: HistoryEntry = { id: newId("txn"), revision: next.revision, actor, label, at: next.updatedAt, ...delta, kind, before, after: clone(next), undone: false, ...(target ? { target } : {}), ...(agentId ? { agentId } : {}) };
  if (kind === "edit") record.history = record.history.filter(entry => !(entry.actor === actor && (actor !== "agent" || entry.agentId === agentId) && entry.kind === "edit" && entry.undone));
  record.history.push(entry);
  record.history = record.history.slice(-50);
  while (record.history.length > 1 && Buffer.byteLength(JSON.stringify(record.history)) > 8 * 1024 * 1024) record.history.shift();
  record.document = next;
  const oldRuntime = JSON.stringify(record.runtime); cleanRuntime(next, record.runtime);
  if (oldRuntime !== JSON.stringify(record.runtime)) touchRuntime(record);
}

export class CanvasService {
  constructor(readonly store: CanvasStore) {}
  async list(input: RpcInput<typeof rpc.listDocuments>, agentId?: string) {
    const state = await this.store.read();
    return { documents: Object.values(state.documents).filter(record => record.document.workspaceId === input.workspaceId && (!agentId || reachable(state, record, agentId))).map(({ document }) => ({ id: document.id, workspaceId: document.workspaceId, title: document.title, description: document.description, example: document.example, revision: document.revision, updatedAt: document.updatedAt })) };
  }
  async read(input: RpcInput<typeof rpc.readDocument>, actor: Actor = "user", agentId?: string) { return view(documentRecord(await this.store.read(), input.documentId, input.workspaceId), actor, agentId); }
  async watch(input: RpcInput<typeof rpc.watchDocument>) {
    const record = documentRecord(await this.store.read(), input.documentId, input.workspaceId);
    return { revision: record.document.revision, runtimeVersion: record.runtimeVersion, ...(input.knownRevision !== record.document.revision || input.knownRuntimeVersion !== record.runtimeVersion ? { view: view(record) } : {}) };
  }
  create(input: RpcInput<typeof rpc.createDocument>, actor: Actor = "user", connection: DocumentRecord["connection"] = null) {
    return this.store.transaction(state => {
      const id = input.id ?? newId("doc");
      if (Object.hasOwn(state.documents, id)) throw new CanvasError("VALIDATION", "Document ID already exists.");
      const now = timestamp();
      const document = documentSchema.parse({ ...input.content, id, workspaceId: input.workspaceId, revision: 0, createdAt: now, updatedAt: now });
      const catalog = catalogView(state.catalog);
      for (const block of document.blocks) if (!catalog.blockTypes.some(type => type.id === block.typeId)) throw new CanvasError("UNKNOWN_TYPE", `Unknown block type ${block.typeId}.`);
      for (const block of document.blocks) normalizeBlock(block, catalog.blockTypes.find(type => type.id === block.typeId)!);
      validateDocument(document, catalog);
      if (Buffer.byteLength(JSON.stringify(document)) > 1024 * 1024) throw new CanvasError("TOO_LARGE", "A document cannot exceed 1 MiB.");
      state.documents[id] = { document, history: [], connection, selectionVersion: 0, runtimeVersion: 0, runtime: { blocks: {}, scopes: {} }, events: [], outboundBatches: [], ...(actor === "agent" && connection ? { ownerAgentId: connection.agentId } : {}) };
      return view(state.documents[id], actor);
    });
  }
  mutate(input: RpcInput<typeof rpc.mutateDocument>, actor: Actor = "user", agentId?: string) {
    return this.store.transaction(state => {
      const record = documentRecord(state, input.documentId, input.workspaceId);
      assertRevision(record, input.expectedRevision);
      const next = reduce(record.document, input.operations, catalogView(state.catalog), actor);
      if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024) throw new CanvasError("TOO_LARGE", "A document cannot exceed 1 MiB.");
      recordEdit(record, next, actor, input.label, "edit", undefined, agentId);
      return view(record, actor, agentId);
    });
  }
  undo(input: RpcInput<typeof rpc.undoDocument>, actor: Actor = "user", redo = false, agentId?: string) {
    return this.store.transaction(state => {
      const record = documentRecord(state, input.documentId, input.workspaceId);
      assertRevision(record, input.expectedRevision);
      let target: HistoryEntry | undefined;
      if (redo) {
        const latestUndo = [...record.history].reverse().find(entry => entry.kind === "undo" && entry.actor === actor && (actor !== "agent" || entry.agentId === agentId) && record.history.some(edit => edit.id === entry.target && edit.undone));
        target = record.history.find(entry => entry.id === latestUndo?.target);
      } else target = [...record.history].reverse().find(entry => entry.kind === "edit" && entry.actor === actor && (actor !== "agent" || entry.agentId === agentId) && !entry.undone);
      if (!target) throw new CanvasError("UNDO_BLOCKED", redo ? "No redo is available for this actor." : "No undo is available for this actor.");
      const affected = new Set([...target.changed, ...target.removed]);
      const since = redo ? record.history.filter(entry => entry.target === target!.id && entry.kind === "undo").at(-1)!.revision : target.revision;
      const blockers = record.history.filter(entry => entry.revision > since && entry.kind === "edit" && !entry.undone && [...entry.changed, ...entry.removed].some(id => affected.has(id)));
      if (blockers.length) throw new CanvasError("UNDO_BLOCKED", "A later edit touched the same entities. Read history before undoing.", { transactions: blockers.map(entry => entry.id) });
      const snapshot = redo ? target.after : target.before;
      const next = clone(record.document);
      const restore = <T extends { id: string }>(current: T[], saved: T[]) => {
        const desired = new Map([...current.filter(entity => !affected.has(entity.id)), ...saved.filter(entity => affected.has(entity.id)).map(clone)].map(entity => [entity.id, entity]));
        return [...saved.map(entity => desired.get(entity.id)).filter((entity): entity is T => !!entity), ...current.filter(entity => !saved.some(savedEntity => savedEntity.id === entity.id)).map(entity => desired.get(entity.id)).filter((entity): entity is T => !!entity)];
      };
      next.blocks = restore(next.blocks, snapshot.blocks);
      next.groups = restore(next.groups, snapshot.groups);
      next.links = restore(next.links, snapshot.links);
      if (affected.has("$document")) { next.title = snapshot.title; next.description = snapshot.description; next.example = snapshot.example; next.communication = clone(snapshot.communication); next.variables = clone(snapshot.variables); if (snapshot.layout) next.layout = clone(snapshot.layout); else delete next.layout; }
      const ids = new Set([...next.blocks, ...next.groups].map(entity => entity.id));
      next.selectedIds = next.selectedIds.filter(id => ids.has(id));
      try { validateDocument(next); }
      catch (error) {
        if (error instanceof CanvasError && error.code === "INVARIANT") throw new CanvasError("UNDO_BLOCKED", "Later edits depend on the entities being restored or removed.");
        throw error;
      }
      target.undone = !redo;
      recordEdit(record, next, actor, `${redo ? "Redo" : "Undo"}: ${target.label}`, redo ? "redo" : "undo", target.id, agentId);
      return view(record, actor, agentId);
    });
  }
  async history(input: RpcInput<typeof rpc.readHistory>) {
    const record = documentRecord(await this.store.read(), input.documentId, input.workspaceId);
    return { revision: record.document.revision, transactions: record.history.map(({ id, revision, actor, agentId, label, at, changed, removed, kind }) => ({ id, revision, actor, agentId, label, at, changed, removed, kind })) };
  }
  selection(input: RpcInput<typeof rpc.setSelection>) {
    return this.store.transaction(state => {
      const record = documentRecord(state, input.documentId, input.workspaceId);
      if (record.selectionVersion !== input.expectedSelectionVersion) throw new CanvasError("REVISION_CONFLICT", "Selection changed. Read current selection and retry.", { currentSelectionVersion: record.selectionVersion });
      const next = clone(record.document); next.selectedIds = [...input.ids]; validateDocument(next);
      record.document.selectedIds = next.selectedIds; record.selectionVersion++; touchRuntime(record);
      return view(record);
    });
  }
  async runtimeRead(raw: RpcInput<typeof rpc.readRuntime>) {
    const input = rpc.runtimeReadInputSchema.parse(raw);
    const record = documentRecord(await this.store.read(), input.documentId, input.workspaceId);
    return this.runtimeSubset(record, input.blockIds, input.scopeIds);
  }
  private runtimeSubset(record: RuntimeRecord, blockIds: string[], scopeIds: string[]) {
    return { runtimeVersion: record.runtimeVersion, runtime: {
      blocks: Object.fromEntries(blockIds.filter(id => Object.hasOwn(record.runtime.blocks, id)).map(id => [id, clone(record.runtime.blocks[id])])),
      scopes: Object.fromEntries(scopeIds.filter(id => Object.hasOwn(record.runtime.scopes, id)).map(id => [id, clone(record.runtime.scopes[id])])),
    } };
  }
  runtimeSet(raw: RpcInput<typeof rpc.setRuntime>) {
    safeJson(raw);
    const input = rpc.runtimeSetInputSchema.parse(raw);
    return this.store.runtimeTransaction(input.documentId, input.workspaceId, record => {
      const before = JSON.stringify(record.runtime);
      for (const entry of input.blocks) {
        if (!record.document.blocks.some(b => b.id === entry.id)) throw new CanvasError('NOT_FOUND', `Block ${entry.id} was not found.`);
        if (entry.state === null) delete record.runtime.blocks[entry.id];
        else {
          safeJson(entry.state);
          if (Buffer.byteLength(JSON.stringify(entry.state)) > RUNTIME_BLOCK_BYTES) throw new CanvasError('TOO_LARGE', 'Block runtime exceeds 4 KiB.');
          record.runtime.blocks[entry.id] = clone(entry.state);
        }
      }
      for (const entry of input.scopes) {
        const declarations = entry.id === DOCUMENT_SCOPE ? record.document.variables : record.document.groups.find(g => g.id === entry.id)?.variables;
        if (!declarations) throw new CanvasError('NOT_FOUND', 'Scope has no variable declarations.');
        const values = record.runtime.scopes[entry.id] ?? {};
        for (const [name, value] of Object.entries(entry.values)) {
          const variable = declarations.find(v => v.name === name);
          if (!variable) throw new CanvasError('NOT_FOUND', `Variable ${name} is not declared in ${entry.id}.`);
          if (value === null) delete values[name];
          else {
            if (value < variable.min || value > variable.max) throw new CanvasError('VALIDATION', `Variable ${name} is outside its declared range.`);
            values[name] = value;
          }
        }
        if (Object.keys(values).length) record.runtime.scopes[entry.id] = values; else delete record.runtime.scopes[entry.id];
      }
      if (Buffer.byteLength(JSON.stringify(record.runtime)) > RUNTIME_DOCUMENT_BYTES) throw new CanvasError('TOO_LARGE', 'Document runtime exceeds 256 KiB.');
      if (before !== JSON.stringify(record.runtime)) touchRuntime(record);
      return this.runtimeSubset(record, input.blocks.map(b => b.id), input.scopes.map(s => s.id));
    });
  }
  async selected(input: RpcInput<typeof rpc.readDocument>) {
    const current = await this.read(input);
    return { revision: current.document.revision, selectionVersion: current.selectionVersion, ids: current.document.selectedIds, entities: current.document.selectedIds.map(id => ({ entity: [...current.document.blocks, ...current.document.groups].find(entity => entity.id === id), effectiveInstructions: effectiveInstructions(current.document, id) })) };
  }
  async catalog() { return catalogView((await this.store.read()).catalog); }
  async validatePack(input: RpcInput<typeof rpc.validatePack>) { return packIssues(input.pack, await this.catalog()); }
  catalogMutate(input: RpcInput<typeof rpc.mutateCatalog>) {
    catalogMutateInputSchema.parse(input);
    return this.store.transaction(state => {
      if (state.catalog.revision !== input.expectedRevision) throw new CanvasError("REVISION_CONFLICT", "Catalog changed. Read it and retry.", { currentRevision: state.catalog.revision });
      const current = catalogView(state.catalog), action = input.action;
      switch (action.type) {
        case "type.put":
          if (current.blockTypes.some(type => type.id === action.blockType.id) && !state.catalog.localTypes.some(type => type.id === action.blockType.id)) throw new CanvasError("VALIDATION", "Local types cannot replace a built-in or pack type.");
          validateType(action.blockType);
          state.catalog.localTypes = [...state.catalog.localTypes.filter(type => type.id !== action.blockType.id), clone(action.blockType)]; break;
        case "template.put":
          if (current.templates.some(template => template.id === action.template.id) && !state.catalog.localTemplates.some(template => template.id === action.template.id)) throw new CanvasError("VALIDATION", "Local templates cannot replace a built-in or pack template.");
          validateTemplate(action.template, current);
          state.catalog.localTemplates = [...state.catalog.localTemplates.filter(template => template.id !== action.template.id), clone(action.template)]; break;
        case "pack.import": {
          const pack = parsePack(action.pack, current);
          const old = state.catalog.packs.find(pack => pack.id === action.pack.id);
          if (old && !action.replace) throw new CanvasError("VALIDATION", "Pack already exists; pass replace:true explicitly.");
          state.catalog.packs = [...state.catalog.packs.filter(item => item.id !== pack.id), pack]; break;
        }
        case "pack.remove":
          if (!state.catalog.packs.some(pack => pack.id === action.id)) throw new CanvasError("NOT_FOUND", "User pack was not found.");
          state.catalog.packs = state.catalog.packs.filter(pack => pack.id !== action.id); break;
      }
      state.catalog.revision++;
      return catalogView(state.catalog);
    });
  }
  importPack(input: RpcInput<typeof rpc.importPack>) {
    return this.store.transaction(state => {
      if (state.catalog.revision !== input.expectedRevision) throw new CanvasError("REVISION_CONFLICT", "Catalog changed. Read it and retry.", { currentRevision: state.catalog.revision });
      const catalog = catalogView(state.catalog), pack = parsePack(input.pack, catalog), old = state.catalog.packs.find(item => item.id === pack.id);
      if (old && !input.replace) throw new CanvasError("VALIDATION", "Pack already exists; pass replace:true explicitly.");
      const diff = packDiff(old, pack);
      if (!input.dryRun) { state.catalog.packs = [...state.catalog.packs.filter(item => item.id !== pack.id), pack]; state.catalog.revision++; }
      return { catalog: catalogView(state.catalog), diff, committed: !input.dryRun };
    });
  }
  async exportPack(input: RpcInput<typeof rpc.exportPack>) {
    const pack = (await this.catalog()).packs.find(pack => pack.id === input.id);
    if (!pack) throw new CanvasError("NOT_FOUND", "Pack was not found.");
    return pack;
  }
  async instantiatePack(input: RpcInput<typeof rpc.instantiatePack>, actor: Actor = "user", connection: DocumentRecord["connection"] = null) {
    const pack = await this.exportPack({ id: input.packId });
    const content = pack.documents[input.documentIndex];
    if (!content) throw new CanvasError("NOT_FOUND", "Pack document was not found.");
    return this.create({ workspaceId: input.workspaceId, id: input.id, content: { ...content, example: true } }, actor, connection);
  }
  async exportGroup(input: RpcInput<typeof rpc.exportGroup>) {
    return { template: groupTemplate((await this.read(input)).document, input.groupId, input.templateId, input.name) };
  }
  connect(input: RpcInput<typeof rpc.connectAgent>) {
    return this.store.transaction(state => {
      const record = documentRecord(state, input.documentId, input.workspaceId); assertRevision(record, input.expectedRevision);
      if (input.connection && input.connection.workspaceId !== input.workspaceId) throw new CanvasError("FORBIDDEN", "Connected agent must belong to the document workspace.");
      record.connection = clone(input.connection); touchRuntime(record);
      record.document.revision++; record.document.updatedAt = timestamp();
      return { view: view(record), requiresReload: false };
    });
  }
  action(input: RpcInput<typeof rpc.agentAction>) {
    return this.store.transaction(state => {
      const record = documentRecord(state, input.documentId, input.workspaceId);
      const existing = record.events.find(event => event.id === input.eventId);
      if (existing) {
        if (JSON.stringify(existing.action) !== JSON.stringify(input.action)) throw new CanvasError("VALIDATION", "Event ID was reused with a different action.");
        return existing;
      }
      if (!input.action.settled) assertRevision(record, input.expectedRevision);
      const ids = new Set([...record.document.blocks, ...record.document.groups].map(entity => entity.id));
      if (input.action.targetIds?.some(id => !ids.has(id))) throw new CanvasError("NOT_FOUND", "Action target was not found.");
      if (input.action.settled) {
        if (input.action.delivery !== 'batched' || input.action.targetIds?.length !== 1) throw new CanvasError('VALIDATION', 'Settled events need batched delivery and one block target.');
        if (!record.document.blocks.some(b => b.id === input.action.targetIds![0])) throw new CanvasError('NOT_FOUND', 'Settled target must be a block.');
        if (Buffer.byteLength(JSON.stringify(input.action.payload)) > 4096) throw new CanvasError('TOO_LARGE', 'Settled payload exceeds 4 KiB.');
        const protectedIds = new Set(record.outboundBatches.filter(b => b.status !== 'completed').flatMap(b => b.eventIds));
        record.events = record.events.filter(e => !(e.status === 'pending' && e.action.settled && e.action.kind === input.action.kind && e.action.targetIds?.[0] === input.action.targetIds![0] && !protectedIds.has(e.id)));
      }
      if (record.events.filter(event => event.status === "pending" || event.status === "failed").length >= 100) throw new CanvasError("TOO_LARGE", "Too many pending feedback events. Connect an agent and send them first.");
      const { id: _id, workspaceId: _workspace, revision: _revision, createdAt: _created, updatedAt: _updated, ...content } = record.document;
      if (input.action.settled) {
        const kept = new Set(input.action.targetIds);
        for (const id of input.action.targetIds ?? []) {
          let parent = record.document.blocks.find(b => b.id === id)?.parentGroupId;
          while (parent) { kept.add(parent); parent = record.document.groups.find(g => g.id === parent)?.parentGroupId; }
        }
        content.blocks = content.blocks.filter(b => kept.has(b.id));
        content.groups = content.groups.filter(g => kept.has(g.id)).map(g => ({ ...g, blockIds: g.blockIds.filter(id => kept.has(id)), groupIds: g.groupIds.filter(id => kept.has(id)) }));
        content.links = []; content.selectedIds = content.selectedIds.filter(id => kept.has(id));
      }
      const event: AgentEvent = { id: input.eventId, documentId: input.documentId, agentId: record.connection?.agentId ?? null, workspaceId: input.workspaceId, createdAt: timestamp(), revision: record.document.revision, action: clone(input.action), context: documentContentSchema.parse(content), status: "pending" };
      record.events.push(event);
      const retained = new Set(record.outboundBatches.filter(batch => batch.status !== "completed").flatMap(batch => batch.eventIds));
      const recent = new Set(record.events.filter(event => event.status === "sent" || event.status === "acked").slice(-100).map(event => event.id));
      record.events = record.events.filter(event => event.status === "pending" || event.status === "failed" || retained.has(event.id) || recent.has(event.id));
      record.outboundBatches = record.outboundBatches.filter(batch => batch.status !== "completed" || batch.eventIds.some(id => record.events.some(event => event.id === id)));
      touchRuntime(record); return event;
    });
  }
  async events(input: RpcInput<typeof rpc.readAgentEvents>) { return { events: clone(documentRecord(await this.store.read(), input.documentId, input.workspaceId).events) }; }
  markEvents(documentId: string, workspaceId: string, ids: string[], status: AgentEvent["status"], agentId?: string, error?: string) {
    return this.store.transaction(state => {
      const record = documentRecord(state, documentId, workspaceId);
      for (const event of record.events) if (ids.includes(event.id)) {
        if (event.status === "acked" || event.status === "sent" && (status === "pending" || status === "failed")) continue;
        event.status = status; if (agentId) event.agentId = agentId; if (error) event.error = error.slice(0, 1000); else delete event.error;
      }
      for (const batch of record.outboundBatches) {
        if (batch.eventIds.every(id => record.events.some(event => event.id === id && (event.status === "acked" || event.status === "sent")))) batch.status = "completed";
        else if (status === "failed" && ids.some(id => batch.eventIds.includes(id))) batch.status = "failed";
      }
      touchRuntime(record); return { events: clone(record.events) };
    });
  }
  prepareFeedbackBatch(documentId: string, workspaceId: string, agentId: string, flushBatched: boolean, render: (events: AgentEvent[]) => string) {
    return this.store.transaction(state => {
      const record = documentRecord(state, documentId, workspaceId);
      if (record.connection?.agentId !== agentId) return null;
      // Prepared retries always reuse the stored payload and membership, even after new arrivals.
      const retry = record.outboundBatches.find(batch => batch.agentId === agentId && (batch.status === "prepared" || flushBatched && batch.status === "failed"));
      if (retry) { retry.status = "prepared"; return retry; }
      const assigned = new Set(record.outboundBatches.flatMap(batch => batch.eventIds));
      const events = record.events.filter(event => !assigned.has(event.id) && (event.status === "pending" || flushBatched && event.status === "failed") && (!event.agentId || event.agentId === agentId));
      if (!events.length || !flushBatched && !events.some(event => event.action.delivery === "immediate")) return null;
      const prompt = render(clone(events));
      if (Buffer.byteLength(prompt) > 8192) throw new CanvasError("TOO_LARGE", "Feedback prompt exceeds 8 KiB.");
      const batch = { messageId: newId("msg"), agentId, eventIds: events.map(event => event.id), prompt, createdAt: timestamp(), status: "prepared" as const };
      // This transaction is durable before the caller is allowed to invoke SDK send.
      record.outboundBatches.push(batch);
      for (const event of events) event.agentId = agentId;
      return batch;
    });
  }
  finishFeedbackBatch(documentId: string, workspaceId: string, messageId: string, sent: boolean) {
    return this.store.transaction(state => {
      const record = documentRecord(state, documentId, workspaceId);
      const batch = record.outboundBatches.find(batch => batch.messageId === messageId);
      if (!batch) throw new CanvasError("NOT_FOUND", "Feedback batch was not found.");
      // Only this immutable batch's event IDs can transition on this send result.
      for (const event of record.events) if (batch.eventIds.includes(event.id)) {
        if (event.status === "acked" || event.status === "sent") continue;
        event.status = sent ? "sent" : "failed";
        if (sent) delete event.error;
        else event.error = "Delivery to the connected agent could not be confirmed. Retry when available.";
      }
      if (batch.status !== "completed") batch.status = sent ? "completed" : "failed";
      touchRuntime(record);
    });
  }
  async assertReachable(documentId: string, workspaceId: string, agentId: string) {
    const state = await this.store.read();
    if (!reachable(state, documentRecord(state, documentId, workspaceId), agentId)) throw new CanvasError("FORBIDDEN", "This canvas belongs to another agent. This workspace keeps one canvas per agent; use canvas_list for yours or create one.");
  }
  /**
   * Makes the calling agent the feedback recipient. A read only claims a canvas nobody receives; a write takes over,
   * since the agent editing a canvas is the one the user is talking to. A recipient the user picked by hand stays.
   * The document revision is untouched, so the caller's next expectedRevision still holds.
   */
  autoConnect(documentId: string, workspaceId: string, agentId: string, takeover: boolean) {
    return this.store.transaction(state => {
      const record = documentRecord(state, documentId, workspaceId), current = record.connection;
      if (current?.agentId === agentId || current?.pinned || current && !takeover) return false;
      record.connection = { agentId, workspaceId }; touchRuntime(record); return true;
    });
  }
  /** Frees every canvas that pointed at an agent that no longer exists, so the next agent to use it becomes the recipient. */
  releaseAgent(agentId: string) {
    return this.store.transaction(state => {
      for (const record of Object.values(state.documents)) if (record.connection?.agentId === agentId) { record.connection = null; touchRuntime(record); }
    });
  }
  /** Agents holding canvas tools, most recently bound first. */
  async toolAgents() {
    const state = await this.store.read();
    return [...new Set(Object.values(state.owners).flatMap(owner => owner.agentId ? [owner.agentId] : []).reverse())];
  }
  async sharing(input: RpcInput<typeof rpc.readSharing>) { return { mode: (await this.store.read()).sharing[input.workspaceId] ?? "shared" as const }; }
  configureSharing(input: RpcInput<typeof rpc.configureSharing>) {
    return this.store.transaction(state => {
      if (input.mode === "shared") delete state.sharing[input.workspaceId]; else state.sharing[input.workspaceId] = input.mode;
      return { mode: input.mode };
    });
  }
  async injection() { return clone(injectionOf(await this.store.read())); }
  configureInjection(input: RpcInput<typeof rpc.configureInjection>) {
    return this.store.transaction(state => {
      if (state.injection.revision !== input.expectedRevision) throw new CanvasError("REVISION_CONFLICT", "Injection preferences changed.", { currentRevision: state.injection.revision });
      state.injection.workspaceIds = [...injectionOf(state).workspaceIds.filter(id => id !== input.workspaceId), ...(input.enabled ? [input.workspaceId] : [])];
      state.injection.revision++; return state.injection;
    });
  }
  allocateOwner(agentId: string | null = null) {
    const token = newId("owner");
    return this.store.transaction(state => { state.owners[token] = { agentId }; return token; });
  }
  bindOwner(token: string, agentId: string) {
    return this.store.transaction(state => {
      const owner = Object.hasOwn(state.owners, token) ? state.owners[token] : undefined;
      if (!owner || owner.agentId && owner.agentId !== agentId) throw new CanvasError("FORBIDDEN", "Invalid canvas owner binding.");
      owner.agentId = agentId;
    });
  }
  async owner(token: string) {
    const state = await this.store.read(); return Object.hasOwn(state.owners, token) ? state.owners[token].agentId : null;
  }
}
