import { LearningRuntimeStore } from "./learning-state";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRpc } from '@getpaseo/plugin/client';
import type { RpcInput } from '@getpaseo/plugin';
import * as rpc from '../shared/rpc';
import type { AgentEvent, CanvasCatalog, CanvasOperation, DocumentView } from '../shared/model';
import { useHostId } from './ui';
import { initialDocumentId, rememberOpenDocument } from './session';
import { reuseDocumentEntities } from './logic';
export type Failure = { message: string; conflict: boolean; revision?: number; retry?: () => Promise<unknown>; affectedIds?: string[]; operationKey?: string };
export const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export function useCanvas(workspaceId: string) {
  const hostId = useHostId(), scope = JSON.stringify([hostId, workspaceId]), scopeRef = useRef(scope); scopeRef.current = scope;
  const api = {
    list: useRpc(rpc.listDocuments), read: useRpc(rpc.readDocument), create: useRpc(rpc.createDocument), mutate: useRpc(rpc.mutateDocument),
    undo: useRpc(rpc.undoDocument), redo: useRpc(rpc.redoDocument), watch: useRpc(rpc.watchDocument), selection: useRpc(rpc.setSelection),
    catalog: useRpc(rpc.readCatalog), catalogMutate: useRpc(rpc.mutateCatalog), validate: useRpc(rpc.validatePack), import: useRpc(rpc.importPack), export: useRpc(rpc.exportPack),
    instantiate: useRpc(rpc.instantiatePack), exportGroup: useRpc(rpc.exportGroup), connect: useRpc(rpc.connectAgent), setup: useRpc(rpc.agentSetup),
    runtimeSet: useRpc(rpc.setRuntime), action: useRpc(rpc.agentAction), events: useRpc(rpc.readAgentEvents), flush: useRpc(rpc.flushAgentEvents), history: useRpc(rpc.readHistory),
  };
  const apiRef = useRef(api); apiRef.current = api;
  const [view, setView] = useState<DocumentView | null>(null), current = useRef(view);
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof api.list>>['documents']>([]);
  const [catalog, setCatalog] = useState<CanvasCatalog | null>(null), [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), locked = useRef(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [offline, setOffline] = useState(false), [failure, setFailure] = useState<Failure | null>(null);
  const [selection, setSelection] = useState<string[]>([]), desired = useRef<string[] | null>(null), selecting = useRef(false);
  const generation = useRef(0), active = useRef(true);
  const selectionScope = useRef(0), eventEpoch = useRef(0);
  // IDs already seen in this workspace. A document that appears later without being opened here was created elsewhere
  // (normally by the agent through canvas_create), so the panel follows it.
  const knownIds = useRef<Set<string> | null>(null), [arrival, setArrival] = useState<{ id: string; title: string } | null>(null);
  const learningRef = useRef<LearningRuntimeStore | null>(null);
  if (!learningRef.current) learningRef.current = new LearningRuntimeStore(request => apiRef.current.runtimeSet(request), error => fail(error));
  const learning = learningRef.current;
  function accept(next: DocumentView) {
    if (!active.current || scopeRef.current !== scope || next.document.workspaceId !== workspaceId) return;
    const prev = current.current;
    if (prev?.document.id === next.document.id && (next.document.revision < prev.document.revision || next.runtimeVersion < prev.runtimeVersion)) return;
    const shared = { ...next, document: reuseDocumentEntities(prev?.document, next.document) };
    current.current = shared; learning.sync(shared.document, shared.runtimeVersion, shared.runtime); setView(shared);
    if (prev?.document.id !== next.document.id) rememberOpenDocument(hostId, workspaceId, next.document.id);
    if (desired.current === null) setSelection(next.document.selectedIds);
  }
  function clearFailure() { setFailure(null); }
  function setScopedEvents(value: AgentEvent[] | ((events: AgentEvent[]) => AgentEvent[])) {
    if (current.current?.document.id !== view?.document.id) return;
    eventEpoch.current++; setEvents(value);
  }
  function fail(e: unknown, retry?: () => Promise<unknown>, revision?: number, affectedIds?: string[], operationKey?: string) {
    if (!active.current) return;
    const message = errorText(e); setFailure({ message, retry, revision, affectedIds, operationKey, conflict: /REVISION_CONFLICT|revision conflict|latest revision|Expected revision|selection version/i.test(message) });
  }
  async function refreshList() { const g = generation.current; const result = await apiRef.current.list({ workspaceId }); if (active.current && g === generation.current) setDocuments(result.documents); return result.documents; }
  async function open(id: string) {
    learning.reset(); const g = ++generation.current; desired.current = null; current.current = null; setView(null); setSelection([]); setEvents([]); setLoading(true); setFailure(null);
    try {
      const next = await apiRef.current.read({ workspaceId, documentId: id }); if (g !== generation.current || !active.current) return;
      accept(next); setOffline(false);
    } catch (e) { if (g === generation.current) fail(e, () => open(id)); }
    finally { if (g === generation.current && active.current) setLoading(false); }
  }
  async function loadInitial(g = generation.current): Promise<void> {
    setLoading(true);
    try {
      const [list, cat] = await Promise.all([apiRef.current.list({ workspaceId }), apiRef.current.catalog({})]);
      if (!active.current || g !== generation.current) return;
      setDocuments(list.documents); setCatalog(cat); knownIds.current = new Set(list.documents.map(d => d.id));
      const id = initialDocumentId(hostId, workspaceId, list.documents);
      if (id) await open(id); else setFailure(null);
    } catch (error) { if (active.current && g === generation.current) fail(error, () => loadInitial()); }
    finally { if (active.current && g === generation.current) setLoading(false); }
  }
  useLayoutEffect(() => {
    learning.reset(); active.current = true; const g = ++generation.current;
    current.current = null; desired.current = null; knownIds.current = null; setArrival(null); setView(null); setSelection([]); setEvents([]); setDocuments([]); setCatalog(null); setFailure(null); setOffline(false); setLoading(true);
    void loadInitial(g);
    return () => { learning.reset(); active.current = false; ++generation.current; };
  }, [hostId, workspaceId]);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const v = current.current, g = generation.current, eventVersion = eventEpoch.current;
      if (v) {
        try {
          const [change, delivery] = await Promise.all([apiRef.current.watch({ workspaceId, documentId: v.document.id, knownRevision: v.document.revision, knownRuntimeVersion: v.runtimeVersion }), apiRef.current.events({ workspaceId, documentId: v.document.id })]);
          if (!stopped && g === generation.current) { if (change.view) accept(change.view); if (eventVersion === eventEpoch.current) setEvents(delivery.events); setOffline(false); }
        } catch { if (!stopped && g === generation.current) setOffline(true); }
      }
      try {
        const list = await apiRef.current.list({ workspaceId }), known = knownIds.current;
        if (!stopped && g === generation.current && known) {
          const fresh = list.documents.filter(d => !known.has(d.id)); knownIds.current = new Set(list.documents.map(d => d.id));
          if (fresh.length || list.documents.length !== known.size) setDocuments(list.documents);
          const target = fresh.filter(d => d.id !== current.current?.document.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
          if (target && !locked.current) { setArrival({ id: target.id, title: target.title }); void open(target.id); }
        }
      } catch { /* The document watch above already reports connectivity. */ }
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 500); return () => { stopped = true; clearTimeout(timer); };
  }, [hostId, workspaceId]);
  async function task<T>(run: () => Promise<T>, retry?: () => Promise<unknown>, affectedIds?: string[], operationKey?: string): Promise<T | undefined> {
    const g = generation.current;
    while (locked.current && active.current && g === generation.current) await new Promise<void>(resolve => setTimeout(resolve, 20));
    if (offline || !active.current || g !== generation.current) return;
    locked.current = true; setBusy(true); if (affectedIds) setPendingIds(affectedIds); const base = current.current;
    try { const result = await run(); if (g === generation.current) setFailure(old => old && old.operationKey !== operationKey ? old : null); return result; }
    catch (e) {
      if (g === generation.current) {
        if (base && /REVISION_CONFLICT|revision|stale/i.test(errorText(e))) {
          try { const fresh = await apiRef.current.read({ workspaceId, documentId: base.document.id }); if (g === generation.current) accept(fresh); } catch { /* Keep the rejected draft and the original failure. Poll will recover connectivity. */ }
        }
        if (g === generation.current) fail(e, retry ?? (() => task(run, retry, affectedIds, operationKey)), base?.document.revision, affectedIds, operationKey);
      }
      return undefined;
    }
    finally { locked.current = false; if (active.current) { setBusy(false); setPendingIds([]); } }
  }
  async function edit(operations: CanvasOperation[], label: string): Promise<DocumentView | undefined> {
    const v = current.current; if (!v) return;
    const g = generation.current, id = v.document.id;
    const affectedIds = operations.flatMap(op => 'id' in op ? [op.id] : op.type === 'block.create' ? [op.block.id] : op.type === 'group.create' ? [op.group.id] : []);
    return task(async () => {
      if (g !== generation.current || current.current?.document.id !== id) return undefined;
      const next = await apiRef.current.mutate({ workspaceId, documentId: id, expectedRevision: current.current.document.revision, operations, label });
      if (!active.current || g !== generation.current) return undefined;
      accept(next); void refreshList().catch(error => fail(error)); return next;
    }, async () => {
      if (current.current?.document.id !== id) return;
      accept(await apiRef.current.read({ workspaceId, documentId: id })); return edit(operations, label);
    }, affectedIds, JSON.stringify([id, operations, label]));
  }
  async function select(ids: string[]) {
    const g = generation.current;
    desired.current = [...new Set(ids)]; setSelection(desired.current);
    if (selecting.current && selectionScope.current === g) return;
    selecting.current = true; selectionScope.current = g;
    try {
      while (desired.current !== null && g === generation.current) {
        const v = current.current; if (!v) break;
        const request = desired.current; desired.current = null;
        try {
          const next = await apiRef.current.selection({ workspaceId, documentId: v.document.id, expectedSelectionVersion: v.selectionVersion, ids: request });
          if (g === generation.current) accept(next);
        } catch (e) {
          if (g === generation.current) {
            const next = await apiRef.current.read({ workspaceId, documentId: v.document.id }); accept(next);
            if (desired.current === null) { setSelection(next.document.selectedIds); fail(e, () => select(request)); }
          }
        }
      }
    } catch (e) { if (g === generation.current) fail(e); }
    finally { if (selectionScope.current === g) selecting.current = false; }
  }
  async function revision(kind: 'undo' | 'redo'): Promise<DocumentView | undefined> {
    const v = current.current; if (!v) return; const g = generation.current;
    return task(async () => { const next = await apiRef.current[kind]({ workspaceId, documentId: v.document.id, expectedRevision: v.document.revision }); if (!active.current || g !== generation.current) return undefined; accept(next); return next; }, () => revision(kind));
  }
  async function settle(): Promise<void> {
    const g = generation.current;
    while ((locked.current || selecting.current && selectionScope.current === g) && g === generation.current && active.current) await new Promise<void>(resolve => setTimeout(resolve, 20));
    if (g !== generation.current || !active.current) throw new Error('El documento cambió antes de completar la acción.');
  }
  async function send(action: RpcInput<typeof rpc.agentAction>['action'], eventId: string): Promise<AgentEvent | undefined> {
    const v = current.current; if (!v) return;
    const g = generation.current;
    const request = { workspaceId, documentId: v.document.id, expectedRevision: v.document.revision, action, eventId };
    if (action.settled) {
      try {
        const result = await apiRef.current.action(request);
        if (!active.current || g !== generation.current) return undefined;
        eventEpoch.current++; setEvents(old => [...old.filter(e => e.id !== result.id && !(e.status === 'pending' && e.action.settled && e.action.kind === result.action.kind && e.action.targetIds?.[0] === result.action.targetIds?.[0])), result]); return result;
      } catch (error) { fail(error); return undefined; }
    }
    return task(async () => { const result = await apiRef.current.action(request); if (!active.current || g !== generation.current) return undefined; eventEpoch.current++; setEvents(old => [...old.filter(e => e.id !== result.id), result]); return result; }, () => { if (current.current?.document.id !== request.documentId) return Promise.resolve(); return send(action, eventId); });
  }
  async function create(content: RpcInput<typeof rpc.createDocument>['content']) {
    const g = generation.current;
    return task(async () => { const next = await apiRef.current.create({ workspaceId, content }); if (!active.current || g !== generation.current) return undefined; ++generation.current; desired.current = null; setFailure(null); setEvents([]); accept(next); await refreshList().catch(error => fail(error, refreshList)); return next; });
  }
  async function example(packId: string, index = 0) {
    const g = generation.current;
    return task(async () => { const next = await apiRef.current.instantiate({ workspaceId, packId, documentIndex: index }); if (!active.current || g !== generation.current) return undefined; ++generation.current; desired.current = null; setFailure(null); setEvents([]); accept(next); await refreshList().catch(error => fail(error, refreshList)); return next; });
  }
  async function refresh() {
    const v = current.current; if (!v) return;
    try { accept(await apiRef.current.read({ workspaceId, documentId: v.document.id })); setOffline(false); } catch (e) { fail(e, refresh); }
  }
  return { learning, api, workspaceId, view, current, documents, catalog, setCatalog, events, setEvents: setScopedEvents, loading, busy, pendingIds, offline, failure, clearFailure, fail, selection, select, accept, open, refresh, edit, revision, send, task, create, example, refreshList, settle, arrival };
}
export type CanvasController = ReturnType<typeof useCanvas>;
