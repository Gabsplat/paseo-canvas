import { useSyncExternalStore } from 'react';
import type { CanvasController } from './useCanvas';
import type { CanvasBlock } from '../shared/model';
import { resolveScope, type ResolvedVariable, type RuntimeState } from '../shared/learning';
import { RUNTIME_BLOCK_BYTES } from '../shared/learning';
export type RendererRuntime = {
  state: RuntimeState['blocks'][string];
  /** Replaces the block's state. The last interaction recorded on it is kept. */
  set(state: RuntimeState['blocks'][string] | null, settled?: boolean): void;
  flush(): Promise<void>;
  /**
   * Records what the person just did with the block as its `lastInteraction` { kind, label, at, payload } and saves it.
   * This is how an outcome reaches the agent: it reads the block's state with canvas_selection or canvas_read. Nothing
   * is sent to the agent.
   */
  record(kind: string, payload: CanvasBlock['data'] | null, label?: string): Promise<void>;
};
type BlockState = RuntimeState['blocks'][string];
const INTERACTION_PAYLOAD_BYTES = 1500;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
/** A block's state with `lastInteraction` set, kept under the 4 KiB block limit: a large payload is dropped first. */
export function withInteraction(state: BlockState, kind: string, payload: CanvasBlock['data'] | null, label: string, at = new Date().toISOString()): BlockState | null {
  const bare = { kind, label: label.slice(0, 300), at };
  const full = payload && bytes(payload) <= INTERACTION_PAYLOAD_BYTES ? { ...bare, payload } : bare;
  for (const lastInteraction of [full, bare]) { const next = { ...state, lastInteraction }; if (bytes(next) < RUNTIME_BLOCK_BYTES) return next as BlockState; }
  return null;
}
/** Records an interaction on any block, registered renderer or not (a quiz hint, a form saved). */
export async function recordInteraction(controller: CanvasController, blockId: string, kind: string, payload: CanvasBlock['data'] | null, label: string): Promise<void> {
  const documentId = controller.current.current?.document.id;
  await controller.learning.flush();
  if (!documentId || documentId !== controller.current.current?.document.id) return;
  const next = withInteraction(controller.learning.getSnapshot().blocks[blockId] ?? {}, kind, payload, label);
  if (!next) return;
  controller.learning.setBlock(blockId, next, true);
  await controller.learning.flush();
}
export type RendererScope = {
  variables: Record<string, ResolvedVariable>; values: Record<string, number>;
  get(name: string): number;
  set(name: string, value: number | null, settled?: boolean): void;
};
export function useLearning(block: CanvasBlock, controller: CanvasController): { runtime: RendererRuntime; scope: RendererScope } {
  const snapshot = useSyncExternalStore(controller.learning.subscribe, controller.learning.getSnapshot, controller.learning.getSnapshot);
  const doc = controller.view?.document;
  const variables = doc ? resolveScope(doc, block.id, snapshot) : {};
  const values = Object.fromEntries(Object.entries(variables).map(([name, v]) => [name, v.current]));
  return {
    runtime: {
      state: snapshot.blocks[block.id] ?? {},
      set: (state, settled = false) => {
        const kept = controller.learning.getSnapshot().blocks[block.id]?.lastInteraction;
        const merged = state && kept !== undefined && !Object.hasOwn(state, 'lastInteraction') ? { ...state, lastInteraction: kept } : state;
        controller.learning.setBlock(block.id, merged && bytes(merged) < RUNTIME_BLOCK_BYTES ? merged : state, settled);
      },
      flush: () => controller.learning.flush(),
      record: (kind, payload, label = 'Interaction') => recordInteraction(controller, block.id, kind, payload, label),
    },
    scope: { variables, values, get: name => values[name] ?? NaN, set: (name, value, settled = false) => controller.learning.setVariable(block.id, name, value, settled) },
  };
}
