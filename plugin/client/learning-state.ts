import type { CanvasDocument } from '../shared/model';
import { cleanRuntime, resolveScope, type RuntimeState } from '../shared/learning';
import type { RpcInput } from '@getpaseo/plugin';
import type { setRuntime, runtimeOutputSchema } from '../shared/rpc';
import type { z } from 'zod';
type Request = RpcInput<typeof setRuntime>;
type Response = z.infer<typeof runtimeOutputSchema>;
type Pending = { sequence: number; block?: Request['blocks'][number]; scope?: Request['scopes'][number] };
/** One optimistic store per controller; every renderer reads the same scope snapshot. */
export class LearningRuntimeStore {
  private listeners = new Set<() => void>();
  private document?: CanvasDocument;
  private runtimeVersion = -1;
  private base: RuntimeState = { blocks: {}, scopes: {} };
  private snapshot: RuntimeState = this.base;
  private pending = new Map<string, Pending>();
  private timer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private generation = 0;
  private flight?: Promise<void>;
  constructor(private transport: (request: Request) => Promise<Response>, private failure: (error: unknown) => void) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  sync(document: CanvasDocument, runtimeVersion: number, runtime: RuntimeState) {
    if (this.document?.id !== document.id || this.document.workspaceId !== document.workspaceId) this.reset();
    this.document = document;
    for (const [key, entry] of this.pending) {
      if (entry.block && !document.blocks.some(b => b.id === entry.block!.id)) this.pending.delete(key);
      if (entry.scope) {
        const declarations = entry.scope.id === '$document' ? document.variables : document.groups.find(g => g.id === entry.scope!.id)?.variables;
        if (!declarations?.some(v => Object.hasOwn(entry.scope!.values, v.name))) this.pending.delete(key);
      }
    }
    if (runtimeVersion >= this.runtimeVersion) { this.runtimeVersion = runtimeVersion; this.base = runtime; }
    this.publish();
  }
  reset() {
    clearTimeout(this.timer); this.timer = undefined; this.generation++; this.flight = undefined;
    this.document = undefined; this.pending.clear(); this.runtimeVersion = -1;
    this.base = { blocks: {}, scopes: {} }; this.publish();
  }
  private publish() {
    const runtime: RuntimeState = { blocks: { ...this.base.blocks }, scopes: Object.fromEntries(Object.entries(this.base.scopes).map(([id, values]) => [id, { ...values }])) };
    for (const change of this.pending.values()) {
      if (change.block) { if (change.block.state === null) delete runtime.blocks[change.block.id]; else runtime.blocks[change.block.id] = change.block.state; }
      if (change.scope) {
        const values = runtime.scopes[change.scope.id] ??= {};
        for (const [name, value] of Object.entries(change.scope.values)) { if (value === null) delete values[name]; else values[name] = value; }
      }
    }
    if (this.document) cleanRuntime(this.document, runtime);
    this.snapshot = runtime; this.listeners.forEach(listener => listener());
  }
  setBlock(id: string, state: RuntimeState['blocks'][string] | null, settled = false) {
    if (!this.document?.blocks.some(b => b.id === id)) return;
    this.pending.set(`block:${id}`, { sequence: ++this.sequence, block: { id, state } }); this.changed(settled);
  }
  setVariable(blockId: string, name: string, value: number | null, settled = false) {
    if (!this.document) return;
    const variable = resolveScope(this.document, blockId, this.snapshot)[name];
    if (!variable) throw new Error(`Variable ${name} is not declared.`);
    if (value !== null && (!Number.isFinite(value) || value < variable.min || value > variable.max)) throw new Error(`Variable ${name} is outside its declared range.`);
    this.pending.set(`scope:${variable.scopeId}:${name}`, { sequence: ++this.sequence, scope: { id: variable.scopeId, values: { [name]: value } } }); this.changed(settled);
  }
  private changed(settled: boolean) {
    this.publish(); clearTimeout(this.timer);
    if (settled) void this.flush().catch(this.failure);
    else this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(this.failure); }, 80);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined;
    const generation = this.generation;
    if (this.flight) { await this.flight; if (generation !== this.generation) return; }
    if (!this.document || !this.pending.size) return;
    const document = this.document;
    const run = async () => {
      while (this.pending.size && generation === this.generation) {
        // At most four entries per kind keeps both RPC and MCP responses bounded.
        const entries = [...this.pending.entries()].slice(0, 4), blocks = entries.flatMap(([, p]) => p.block ? [p.block] : []);
        const scopes = entries.flatMap(([, p]) => p.scope ? [p.scope] : []);
        const response = await this.transport({ documentId: document.id, workspaceId: document.workspaceId, blocks, scopes });
        if (generation !== this.generation) return;
        if (response.runtimeVersion >= this.runtimeVersion) {
          this.runtimeVersion = response.runtimeVersion;
          const base = { blocks: { ...this.base.blocks }, scopes: { ...this.base.scopes } };
          for (const entry of blocks) { if (response.runtime.blocks[entry.id]) base.blocks[entry.id] = response.runtime.blocks[entry.id]; else delete base.blocks[entry.id]; }
          for (const entry of scopes) { if (response.runtime.scopes[entry.id]) base.scopes[entry.id] = response.runtime.scopes[entry.id]; else delete base.scopes[entry.id]; }
          this.base = base;
        }
        for (const [key, value] of entries) if (this.pending.get(key)?.sequence === value.sequence) this.pending.delete(key);
        this.publish();
      }
    };
    const flight = run(); this.flight = flight;
    try { await flight; } finally { if (this.flight === flight) this.flight = undefined; }
  }
}
