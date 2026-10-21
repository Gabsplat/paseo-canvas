import type { PresentationMode } from "../shared/presentation";
import type { JSONValue } from "../shared/learning";

/**
 * What an agent asks the person's open Lienzo to do with an extension's UI (canvas_extension_open / _close), and how
 * it gets there: the same watch every open Lienzo already polls (canvas.watch, every 1.5 s) carries the requests
 * made since its last poll. In memory on purpose: a request is for whoever is looking now, never replayed later.
 *
 * Still one-way: this carries a request from the agent to the canvas. Nothing travels back to the agent but the fact
 * that a window took it.
 */
export type ExtensionUiRequest = { seq: number; id: string; action: "open" | "close"; extension: string; mode?: PresentationMode; input?: JSONValue; anchorId?: string };
export const EXTENSION_UI_TIMING = {
  /** A window that polled this recently has the Lienzo open (the poll is every 1.5 s). */
  presenceMs: 5000,
  /** How long a request waits for a window to take it before the tool says none did. */
  deliveryMs: 4500,
  /** A request nobody took is dropped after this. */
  keepMs: 15000,
} as const;
type Pending = ExtensionUiRequest & { documentId: string; at: number; taken: boolean; resolve(taken: boolean): void };

export class ExtensionUiChannel {
  private seq = 0;
  private readonly seen = new Map<string, number>();
  private readonly pending: Pending[] = [];
  constructor(private readonly now: () => number = Date.now, private readonly timing: { presenceMs: number; deliveryMs: number; keepMs: number } = EXTENSION_UI_TIMING) {}
  /**
   * A window polled `documentId`. It gets the requests made after `known` (the seq it was last told); a window that
   * polls for the first time (no `known`) gets none, only the current seq, so nothing old is replayed.
   */
  watch(documentId: string, known?: number): { uiSeq: number; ui?: ExtensionUiRequest[] } {
    const now = this.now(); this.seen.set(documentId, now); this.prune(now);
    if (known === undefined || known > this.seq) return { uiSeq: this.seq };
    const ready = this.pending.filter(p => p.documentId === documentId && p.seq > known);
    for (const p of ready) if (!p.taken) { p.taken = true; p.resolve(true); }
    return ready.length ? { uiSeq: this.seq, ui: ready.map(({ seq, id, action, extension, mode, input, anchorId }) => ({ seq, id, action, extension, ...(mode ? { mode } : {}), ...(input !== undefined ? { input } : {}), ...(anchorId ? { anchorId } : {}) })) } : { uiSeq: this.seq };
  }
  /** Whether a window showed this Lienzo recently. */
  present(documentId: string): boolean { const at = this.seen.get(documentId); return at !== undefined && this.now() - at <= this.timing.presenceMs; }
  /** The Lienzo a window polled most recently among `candidates`, if any polled recently. */
  latest(candidates: readonly string[]): string | null {
    let best: string | null = null, at = -Infinity;
    for (const id of candidates) { const t = this.seen.get(id); if (t !== undefined && this.now() - t <= this.timing.presenceMs && t > at) { best = id; at = t; } }
    return best;
  }
  /** Queues a request for the windows showing `documentId`; resolves whether one took it in time. */
  send(documentId: string, request: Omit<ExtensionUiRequest, "seq">): Promise<boolean> {
    const now = this.now(); this.prune(now);
    return new Promise(resolve => {
      const timer = setTimeout(() => entry.resolve(false), this.timing.deliveryMs);
      const entry: Pending = { ...request, seq: ++this.seq, documentId, at: now, taken: false, resolve: taken => { clearTimeout(timer); entry.resolve = () => {}; resolve(taken); } };
      this.pending.push(entry);
    });
  }
  private prune(now: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) if (now - this.pending[i].at > this.timing.keepMs) { this.pending[i].resolve(false); this.pending.splice(i, 1); }
  }
}
