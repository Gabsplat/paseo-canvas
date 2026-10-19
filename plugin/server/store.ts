import { runtimeJsonSchema, runtimeStateSchema, type JSONValue } from "../shared/learning";
import { mkdir, open, readFile, rename, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { connectionSchema, copilotSettingsSchema, documentSchema, sharingModeSchema, type CanvasDocument } from "../shared/model";
import { catalogStorageSchema, catalogView } from "./catalog";
import { CanvasError } from "../shared/errors";
import { clone, validateDocument } from "./reducer";

const historyEntrySchema = z.object({
  id: z.string(), revision: z.number(), actor: z.enum(["user", "agent", "system"]),
  label: z.string(), at: z.string(), changed: z.array(z.string()), removed: z.array(z.string()),
  kind: z.enum(["edit", "undo", "redo"]), before: documentSchema, after: documentSchema,
  undone: z.boolean().default(false), target: z.string().optional(),
  agentId: z.string().optional(),
}).strict();
/**
 * State written while the canvas still sent the person's actions to the agent carries an event queue and outbound
 * message batches on every document. The canvas is one-way now: those are dropped on read and never written again.
 */
const RETIRED_RECORD_KEYS = ["events", "outboundBatches"];
const withoutRetiredKeys = (value: unknown) => value && typeof value === "object" && RETIRED_RECORD_KEYS.some(key => Object.hasOwn(value, key))
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !RETIRED_RECORD_KEYS.includes(key))) : value;
const recordSchema = z.preprocess(withoutRetiredKeys, z.object({
  document: documentSchema, history: z.array(historyEntrySchema),
  connection: connectionSchema.nullable(), selectionVersion: z.number().int().nonnegative(),
  runtime: runtimeStateSchema.default({ blocks: {}, scopes: {} }),
  runtimeVersion: z.number().int().nonnegative(),
  // lienzo.storage: each extension's own small JSON value on this document, by extension id. No revision, no history.
  extensionStorage: z.record(z.string(), runtimeJsonSchema).optional(),
  // When the person last changed the selection: canvas_selection without a documentId reads the latest one.
  selectedAt: z.iso.datetime().optional(),
  // Agent that created the document through MCP. Scopes access when the workspace keeps one canvas per agent.
  ownerAgentId: z.string().optional(),
}).strict());
// Private per-agent copilot record: the settings the person chose plus what the reminder rule needs to remember.
const copilotRecordSchema = copilotSettingsSchema.extend({
  workspaceId: z.string().min(1).max(200).optional(),
  // The previous ended turn got a reminder; the next one never does ("never twice in a row").
  reminded: z.boolean().default(false),
  updatedAt: z.iso.datetime().optional(),
}).strict();
const stateSchema = z.object({
  format: z.literal("paseo-canvas-state/1"), commit: z.number().int().nonnegative(),
  documents: z.record(z.string(), recordSchema), catalog: catalogStorageSchema,
  owners: z.record(z.string(), z.object({ agentId: z.string().nullable() }).strict()),
  injection: z.object({ revision: z.number().int().nonnegative(), workspaceIds: z.array(z.string()) }).strict(),
  sharing: z.record(z.string(), sharingModeSchema).default({}),
  // Copilot mode per agent. Absent in state written before the copilot existed; an agent without an entry is off.
  copilot: z.record(z.string(), copilotRecordSchema).default({}),
}).strict();
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type DocumentRecord = z.infer<typeof recordSchema>;
export type RuntimeRecord = Pick<DocumentRecord, "document" | "runtime" | "runtimeVersion">;
export type CanvasState = z.infer<typeof stateSchema>;
export type CopilotRecord = z.infer<typeof copilotRecordSchema>;
export { copilotRecordSchema };
export type Actor = HistoryEntry["actor"];

/**
 * A directory fsync makes the rename durable through power loss on Linux and macOS. Windows cannot open a directory
 * for syncing (EPERM, or EISDIR) and NTFS journals the rename itself, so there it is skipped.
 */
export async function syncDirectory(directory: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === "win32") return;
  let handle;
  try { handle = await open(directory, "r"); await handle.sync(); }
  catch (error) { if (!["EPERM", "EISDIR", "EINVAL", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  finally { await handle?.close(); }
}
/** Windows refuses to replace a file another process (an antivirus, the indexer) briefly holds open; that passes. */
async function renameOver(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(from, to); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

export async function atomicWrite(path: string, data: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(data, "utf8");
    await handle.sync();
    await handle.close(); handle = undefined;
    await renameOver(temporary, path);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

/** One writer, one atomic aggregate. Content, history, runtime, and catalog cannot diverge. */
export class CanvasStore {
  private state: CanvasState | null = null;
  private ready: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private runtimeTimer: ReturnType<typeof setTimeout> | undefined;
  private runtimeDirty = false;
  private runtimeError: unknown;
  private closed = false;
  private closing = false;
  private lockOwned = false;
  private readonly lockToken = randomUUID();
  readonly file: string;
  constructor(readonly directory: string) { this.file = join(directory, "state.json"); }

  initialize(): Promise<void> {
    if (this.closed) return Promise.reject(new CanvasError("UNAVAILABLE", "Canvas store is closed."));
    return this.ready ??= this.load().catch(async error => { await this.releaseLock(); this.ready = null; throw error; });
  }
  private async acquireLock(): Promise<void> {
    const path = join(this.directory, "writer.lock");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(path, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, token: this.lockToken }));
        await handle.close();
        this.lockOwned = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const lock = JSON.parse(await readFile(path, "utf8"));
        if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0) throw new CanvasError("UNAVAILABLE", "Invalid canvas writer lock; inspect private storage.");
        let alive = true;
        try { process.kill(lock.pid, 0); }
        catch (signalError) { if ((signalError as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
        if (alive) throw new CanvasError("UNAVAILABLE", "Another canvas writer is already using this directory.");
        await rm(path);
      }
    }
    throw new CanvasError("UNAVAILABLE", "Could not acquire canvas writer lock.");
  }
  private async releaseLock(): Promise<void> {
    if (!this.lockOwned) return;
    const path = join(this.directory, "writer.lock");
    try {
      const lock = JSON.parse(await readFile(path, "utf8"));
      if (lock.token === this.lockToken) await rm(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.lockOwned = false;
  }
  private async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    await this.acquireLock();
    try { this.state = stateSchema.parse(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new CanvasError("UNAVAILABLE", "Canvas state is unreadable or invalid; it was not overwritten.");
      this.state = { format: "paseo-canvas-state/1", commit: 0, documents: {}, catalog: { revision: 0, localTypes: [], localTemplates: [], packs: [], localExtensions: [], grants: [], packHashes: {} }, owners: {}, injection: { revision: 0, workspaceIds: [] }, sharing: {}, copilot: {} };
      await this.persist(this.state);
    }
    for (const record of Object.values(this.state.documents)) validateDocument(record.document);
    catalogView(this.state.catalog);
  }
  private async persist(state: CanvasState): Promise<void> {
    const data = JSON.stringify(state);
    if (Buffer.byteLength(data) > 64 * 1024 * 1024) throw new CanvasError("TOO_LARGE", "Canvas storage exceeds the v1 64 MiB limit. Export documents or reduce history/content.");
    await atomicWrite(this.file, data);
    await syncDirectory(this.directory);
  }
  async read(): Promise<CanvasState> {
    await this.initialize();
    await this.queue;
    return clone(this.state!);
  }
  transaction<T>(change: (state: CanvasState) => T | Promise<T>): Promise<T> {
    if (this.closing || this.closed) return Promise.reject(new CanvasError("UNAVAILABLE", "Canvas store is closing."));
    const run = this.queue.then(async () => {
      await this.initialize();
      const next = clone(this.state!);
      const result = await change(next);
      // Dry-run catalog imports and unchanged transitions do not touch disk.
      if (JSON.stringify(next) === JSON.stringify(this.state)) return clone(result);
      next.commit++;
      stateSchema.parse(next);
      await this.persist(next); this.runtimeDirty = false; this.runtimeError = undefined;
      this.state = next;
      return clone(result);
    });
    this.queue = run.catch(() => {});
    return run;
  }
  /** Runtime updates copy only runtime, never document/history or the aggregate state. */
  runtimeTransaction<T>(documentId: string, workspaceId: string, change: (record: RuntimeRecord) => T): Promise<T> {
    if (this.closing || this.closed) return Promise.reject(new CanvasError('UNAVAILABLE', 'Canvas store is closing.'));
    const run = this.queue.then(async () => {
      await this.initialize();
      const record = documentRecord(this.state!, documentId, workspaceId);
      const next: RuntimeRecord = { document: record.document, runtimeVersion: record.runtimeVersion, runtime: clone(record.runtime) };
      const result = change(next);
      if (JSON.stringify(next.runtime) !== JSON.stringify(record.runtime)) {
        runtimeStateSchema.parse(next.runtime);
        record.runtime = next.runtime; record.runtimeVersion = next.runtimeVersion; this.state!.commit++;
        this.deferPersist();
      }
      return clone(result);
    });
    this.queue = run.catch(() => {}); return run;
  }
  /** lienzo.storage of one document, by extension id: like runtime, memory first and disk shortly after, no revision. */
  extensionStorage<T>(documentId: string, workspaceId: string, change: (storage: Record<string, JSONValue>) => T): Promise<T> {
    if (this.closing || this.closed) return Promise.reject(new CanvasError('UNAVAILABLE', 'Canvas store is closing.'));
    const run = this.queue.then(async () => {
      await this.initialize();
      const record = documentRecord(this.state!, documentId, workspaceId), before = record.extensionStorage ?? {}, next = clone(before);
      const result = change(next);
      if (JSON.stringify(next) !== JSON.stringify(before)) {
        if (Object.keys(next).length) record.extensionStorage = next; else delete record.extensionStorage;
        this.state!.commit++; this.deferPersist();
      }
      return clone(result);
    });
    this.queue = run.catch(() => {}); return run;
  }
  private deferPersist() {
    this.runtimeDirty = true;
    if (!this.runtimeTimer) this.runtimeTimer = setTimeout(() => {
      this.runtimeTimer = undefined;
      void this.flushRuntime().catch(error => { this.runtimeError = error; });
    }, 250);
  }
  /** Await this for a durability boundary; deferred writes acknowledge memory before disk. */
  async flushRuntime(): Promise<void> {
    clearTimeout(this.runtimeTimer); this.runtimeTimer = undefined;
    const run = this.queue.then(async () => {
      if (this.runtimeDirty && this.state) { await this.persist(this.state); this.runtimeDirty = false; this.runtimeError = undefined; }
      if (this.runtimeError) throw this.runtimeError;
    });
    this.queue = run.catch(() => {}); return run;
  }
  async close(): Promise<void> {
    this.closing = true;
    try {
      await this.queue;
      await this.flushRuntime();
      await this.ready?.catch(() => {});
    } finally { await this.releaseLock(); this.closed = true; }
  }
}

export function documentRecord(state: CanvasState, documentId: string, workspaceId: string): DocumentRecord {
  const record = Object.hasOwn(state.documents, documentId) ? state.documents[documentId] : undefined;
  if (!record) throw new CanvasError("NOT_FOUND", "Canvas document was not found.");
  if (record.document.workspaceId !== workspaceId) throw new CanvasError("FORBIDDEN", "Canvas document belongs to another workspace.");
  return record;
}
export function changedEntities(before: CanvasDocument, after: CanvasDocument): { changed: string[]; removed: string[] } {
  const old = new Map([...before.blocks, ...before.groups, ...before.links].map(entity => [entity.id, entity]));
  const current = new Map([...after.blocks, ...after.groups, ...after.links].map(entity => [entity.id, entity]));
  const changed = [...current.keys()].filter(id => JSON.stringify(current.get(id)) !== JSON.stringify(old.get(id)));
  const removed = [...old.keys()].filter(id => !current.has(id));
  if (["title", "description", "example", "communication", "layout", "variables"].some(key => JSON.stringify(before[key as keyof CanvasDocument]) !== JSON.stringify(after[key as keyof CanvasDocument]))) changed.push("$document");
  return { changed, removed };
}
export function assertRevision(record: DocumentRecord, expected: number): void {
  if (record.document.revision === expected) return;
  const tail = record.history.filter(entry => entry.revision > expected);
  throw new CanvasError("REVISION_CONFLICT", "Document changed. Read the latest revision and retry the whole transaction.", { currentRevision: record.document.revision, changedSince: [...new Set(tail.flatMap(entry => entry.changed))], removedSince: [...new Set(tail.flatMap(entry => entry.removed))], historyTruncated: expected < (record.history[0]?.revision ?? 0) - 1 });
}
