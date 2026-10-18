import { cleanRuntime, DOCUMENT_SCOPE, RUNTIME_BLOCK_BYTES, RUNTIME_DOCUMENT_BYTES } from "../shared/learning";
import { safeJson } from "./reducer";
import type { RpcInput } from "../shared/contract";
import * as rpc from "../shared/rpc";
import {
  documentSchema, catalogMutateInputSchema, groupSchema,
  type CanvasDocument, type CanvasPack, type DocumentView, type LatestAgent,
} from "../shared/model";
import { CanvasError } from "../shared/errors";
import { isRetiredRenderer } from "../shared/renderers";
import { CanvasStore, documentRecord, assertRevision, changedEntities, type RuntimeRecord, type DocumentRecord, type Actor, type HistoryEntry } from "./store";
import { catalogView, packDiff, packIssues, parsePack, validateExtension, validateType } from "./catalog";
import { clone, newId, reduce, validateDocument, normalizeBlock, effectiveInstructions } from "./reducer";
import { nextSheetPlacement, sheetSummaries } from "./sheets";

const timestamp = () => new Date().toISOString();
type State = Parameters<Parameters<CanvasStore["transaction"]>[0]>[0];
// Untouched preferences mean "every workspace": installing the plugin is enough for new agents to get the tools.
// The user turns this off from the agent dialog; any explicit choice is stored and respected.
const injectionOf = (state: State) => state.injection.revision === 0 && !state.injection.workspaceIds.length ? { revision: 0, workspaceIds: ["*"] } : state.injection;
/** With one canvas per agent, a document is reachable by its creator, its connected agent, or anyone while it is unclaimed. */
const reachable = (state: State, record: DocumentRecord, agentId: string) => state.sharing[record.document.workspaceId] !== "agent"
  || record.ownerAgentId === agentId || record.connection?.agentId === agentId || !record.ownerAgentId && !record.connection;
const view = (record: DocumentRecord, actor: Actor = "user", agentId?: string): DocumentView => ({
  document: clone(record.document), connection: clone(record.connection),
  canUndo: record.history.some(entry => entry.kind === "edit" && entry.actor === actor && (actor !== "agent" || entry.agentId === agentId) && !entry.undone),
  canRedo: record.history.some(entry => entry.kind === "edit" && entry.actor === actor && (actor !== "agent" || entry.agentId === agentId) && entry.undone),
  selectionVersion: record.selectionVersion, runtimeVersion: record.runtimeVersion, runtime: clone(record.runtime),
  latestAgent: latestAgent(record),
});
/** The agent's most recent transaction, for "go to latest": changed IDs that still exist, and what it removed. */
export function latestAgent(record: Pick<DocumentRecord, "document" | "history">, agentId?: string): LatestAgent | null {
  const entry = [...record.history].reverse().find(entry => entry.actor === "agent" && (!agentId || entry.agentId === agentId));
  if (!entry) return null;
  const present = new Set([...record.document.blocks, ...record.document.groups, ...record.document.links].map(entity => entity.id));
  return { transactionId: entry.id, revision: entry.revision, at: entry.at, ...(entry.agentId ? { agentId: entry.agentId } : {}), label: entry.label, kind: entry.kind, ids: entry.changed.filter(id => present.has(id)), removed: [...entry.removed] };
}
const touchRuntime = (record: RuntimeRecord) => { record.runtimeVersion++; };
const SELECTION_ENTITIES = 40, LONG_TEXT = 2000;
/**
 * Long strings (a mini app's page, a big code sample) and drawing points are summarised, so a selection always fits in
 * one response. A drawing keeps its author, anchor, extent and stroke count; canvas_read ids returns everything.
 */
export function compactData(data: CanvasDocument["blocks"][number]["data"]) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    typeof value === "string" && value.length > LONG_TEXT ? `[${value.length} characters; read this block with canvas_read ids to get it]`
      : key === "strokes" && Array.isArray(value) ? { count: value.length, note: "Stroke points omitted; read this block with canvas_read ids to get them." }
      : value]));
}
/** A grant is for the code that was approved: an extension that is new or different in the replacing pack needs approval again. */
function keptGrants(grants: string[], old: CanvasPack | undefined, next: CanvasPack): string[] {
  const before = new Map((old?.extensions ?? []).map(extension => [extension.id, JSON.stringify(extension)])), mine = new Set([...(old?.extensions ?? []), ...next.extensions].map(extension => extension.id));
  return grants.filter(id => !mine.has(id) || next.extensions.some(extension => extension.id === id && before.get(id) === JSON.stringify(extension)));
}
function recordEdit(record: DocumentRecord, next: CanvasDocument, actor: Actor, label: string, kind: HistoryEntry["kind"] = "edit", target?: string, agentId?: string): void {
  const before = clone(record.document);
  next.revision = before.revision + 1;
  next.updatedAt = timestamp();
  const delta = changedEntities(before, next);
  if (JSON.stringify(before.selectedIds) !== JSON.stringify(next.selectedIds)) { record.selectionVersion++; if (actor === "user") record.selectedAt = next.updatedAt; touchRuntime(record); }
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
    return { documents: Object.values(state.documents).filter(record => record.document.workspaceId === input.workspaceId && (!agentId || reachable(state, record, agentId))).map(({ document, connection }) => ({ id: document.id, workspaceId: document.workspaceId, title: document.title, description: document.description, example: document.example, revision: document.revision, updatedAt: document.updatedAt,
      blockCount: document.blocks.length, groupCount: document.groups.filter(group => !group.sheet).length, hojaCount: document.groups.filter(group => group.sheet).length, agentId: connection?.agentId ?? null })) };
  }
  async read(input: RpcInput<typeof rpc.readDocument>, actor: Actor = "user", agentId?: string) { return view(documentRecord(await this.store.read(), input.documentId, input.workspaceId), actor, agentId); }
  async watch(input: RpcInput<typeof rpc.watchDocument>) {
    const record = documentRecord(await this.store.read(), input.documentId, input.workspaceId);
    return { revision: record.document.revision, runtimeVersion: record.runtimeVersion, ...(input.knownRevision !== record.document.revision || input.knownRuntimeVersion !== record.runtimeVersion ? { view: view(record) } : {}) };
  }
  /** Deletes a Lienzo and its history. A conversation whose copilot drew there gets a new one the next time it is turned on. */
  remove(input: RpcInput<typeof rpc.deleteDocument>) {
    return this.store.transaction(state => {
      documentRecord(state, input.documentId, input.workspaceId);
      delete state.documents[input.documentId];
      for (const record of Object.values(state.copilot)) if (record.documentId === input.documentId) record.documentId = null;
      return { deleted: true };
    });
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
      state.documents[id] = { document, history: [], connection, selectionVersion: 0, runtimeVersion: 0, runtime: { blocks: {}, scopes: {} }, ...(actor === "agent" && connection ? { ownerAgentId: connection.agentId } : {}) };
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
  /** A new Sheet: the next number, placed right of the last Sheet on the strip, in one undoable transaction. */
  createSheet(input: RpcInput<typeof rpc.createSheet>, actor: Actor = "user", agentId?: string) {
    return this.store.transaction(state => {
      const record = documentRecord(state, input.documentId, input.workspaceId);
      assertRevision(record, input.expectedRevision);
      const { number, position } = nextSheetPlacement(record.document), id = input.id ?? newId("hoja");
      const group = groupSchema.parse({ id, title: input.title, description: input.description ?? "", blockIds: [], groupIds: [], position, ...(input.layout ? { layout: input.layout } : {}), sheet: { number, createdAt: timestamp(), source: actor === "agent" ? "agent" : "user" } });
      const next = reduce(record.document, [{ type: "group.create", group }], catalogView(state.catalog), actor);
      if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024) throw new CanvasError("TOO_LARGE", "A document cannot exceed 1 MiB.");
      recordEdit(record, next, actor, `Sheet ${number}: ${input.title}`.slice(0, 300), "edit", undefined, agentId);
      return { view: view(record, actor, agentId), id, number };
    });
  }
  async sheets(input: RpcInput<typeof rpc.listSheets>) {
    const record = documentRecord(await this.store.read(), input.documentId, input.workspaceId);
    return { revision: record.document.revision, sheets: sheetSummaries(record.document) };
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
      record.document.selectedIds = next.selectedIds; record.selectionVersion++; record.selectedAt = timestamp(); touchRuntime(record);
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
  /**
   * What the person has selected, for "this" and "what I selected": each entity with its effective instructions and,
   * for a block, the state its interaction left (runtime state, a mini app's stored state, the last interaction).
   * Without a documentId it reads the reachable document whose selection the person changed most recently.
   */
  async selected(input: { workspaceId: string; documentId?: string }, agentId?: string) {
    const state = await this.store.read();
    let record: DocumentRecord | undefined;
    if (input.documentId) record = documentRecord(state, input.documentId, input.workspaceId);
    else record = Object.values(state.documents)
      .filter(item => item.document.workspaceId === input.workspaceId && item.document.selectedIds.length && (!agentId || reachable(state, item, agentId)))
      .sort((a, b) => (b.selectedAt ?? "").localeCompare(a.selectedAt ?? "") || b.document.updatedAt.localeCompare(a.document.updatedAt))[0];
    if (!record) return { documentId: null, ids: [], entities: [], note: "Nothing is selected in any Lienzo of this workspace. Ask the person to select what they mean, or read the canvas with canvas_read." };
    const document = record.document, ids = document.selectedIds;
    const entities = ids.slice(0, SELECTION_ENTITIES).map(id => {
      const entity = [...document.blocks, ...document.groups].find(entity => entity.id === id)!;
      const runtime = Object.hasOwn(record!.runtime.blocks, id) ? clone(record!.runtime.blocks[id]) : undefined;
      return { entity: "typeId" in entity ? { ...entity, data: compactData(entity.data) } : entity, effectiveInstructions: effectiveInstructions(document, id), ...(runtime ? { state: runtime } : {}) };
    });
    return {
      documentId: document.id, title: document.title, revision: document.revision, selectionVersion: record.selectionVersion,
      ...(record.selectedAt ? { selectedAt: record.selectedAt } : {}), ids, entities,
      ...(ids.length > SELECTION_ENTITIES ? { hasMore: true, hint: `Only the first ${SELECTION_ENTITIES} are described; read the rest with canvas_read ids.` } : {}),
      ...(!ids.length ? { note: "Nothing is selected in this Lienzo. Ask the person to select what they mean." } : {}),
    };
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
          // Retired names stay readable in stored data; a type saved now must be one the catalog can offer.
          if (isRetiredRenderer(action.blockType.renderer) || isRetiredRenderer(action.blockType.id)) throw new CanvasError("VALIDATION", `Block type ${action.blockType.id} uses a renderer or ID that is no longer available.`);
          validateType(action.blockType);
          state.catalog.localTypes = [...state.catalog.localTypes.filter(type => type.id !== action.blockType.id), clone(action.blockType)]; break;
        case "pack.remove": {
          const gone = state.catalog.packs.find(pack => pack.id === action.id);
          if (!gone) throw new CanvasError("NOT_FOUND", "That extension file is not installed.");
          state.catalog.packs = state.catalog.packs.filter(pack => pack.id !== action.id);
          state.catalog.grants = state.catalog.grants.filter(id => !gone.extensions.some(extension => extension.id === id)); break;
        }
        case "extension.put":
          validateExtension(action.extension, current);
          state.catalog.localExtensions = [...state.catalog.localExtensions.filter(extension => extension.id !== action.extension.id), clone(action.extension)]; break;
        case "extension.remove":
          if (!state.catalog.localExtensions.some(extension => extension.id === action.id)) throw new CanvasError("NOT_FOUND", "Local extension was not found. Extensions that came in a file are removed with their file.");
          state.catalog.localExtensions = state.catalog.localExtensions.filter(extension => extension.id !== action.id); break;
        case "extension.grant": {
          const held = current.extensions.find(extension => extension.id === action.id);
          if (!held || held.source === "local" || held.source === "builtin") throw new CanvasError("NOT_FOUND", "Only an extension that came in an imported file is granted or revoked.");
          state.catalog.grants = [...state.catalog.grants.filter(id => id !== action.id), ...(action.granted ? [action.id] : [])]; break;
        }
      }
      state.catalog.revision++;
      return catalogView(state.catalog);
    });
  }
  importPack(input: RpcInput<typeof rpc.importPack>) {
    return this.store.transaction(state => {
      if (state.catalog.revision !== input.expectedRevision) throw new CanvasError("REVISION_CONFLICT", "Catalog changed. Read it and retry.", { currentRevision: state.catalog.revision });
      const catalog = catalogView(state.catalog), pack = parsePack(input.pack, catalog), old = state.catalog.packs.find(item => item.id === pack.id);
      if (old && !input.replace) throw new CanvasError("VALIDATION", "That extension file is already installed; pass replace:true explicitly.");
      const diff = packDiff(old, pack);
      if (!input.dryRun) { state.catalog.packs = [...state.catalog.packs.filter(item => item.id !== pack.id), pack]; state.catalog.grants = keptGrants(state.catalog.grants, old, pack); state.catalog.revision++; }
      return { catalog: catalogView(state.catalog), diff, committed: !input.dryRun };
    });
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
  async assertReachable(documentId: string, workspaceId: string, agentId: string) {
    const state = await this.store.read();
    if (!reachable(state, documentRecord(state, documentId, workspaceId), agentId)) throw new CanvasError("FORBIDDEN", "This canvas belongs to another agent. This workspace keeps one canvas per agent; use canvas_list for yours or create one.");
  }
  /**
   * Makes the calling agent the one working on this canvas. A read only claims a canvas nobody holds; a write takes over,
   * since the agent editing a canvas is the one the person is talking to. An agent the person picked by hand stays.
   * The document revision is untouched, so the caller's next expectedRevision still holds.
   */
  autoConnect(documentId: string, workspaceId: string, agentId: string, takeover: boolean) {
    return this.store.transaction(state => {
      const record = documentRecord(state, documentId, workspaceId), current = record.connection;
      if (current?.agentId === agentId || current?.pinned || current && !takeover) return false;
      record.connection = { agentId, workspaceId }; touchRuntime(record); return true;
    });
  }
  /** Frees every canvas that pointed at an agent that no longer exists, so the next agent to use it takes it. */
  releaseAgent(agentId: string) {
    return this.store.transaction(state => {
      for (const record of Object.values(state.documents)) if (record.connection?.agentId === agentId) { record.connection = null; touchRuntime(record); }
    });
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
