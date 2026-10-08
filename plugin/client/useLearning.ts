import { useSyncExternalStore } from 'react';
import type { CanvasController } from './useCanvas';
import type { CanvasBlock } from '../shared/model';
import { resolveScope, type ResolvedVariable, type RuntimeState } from '../shared/learning';
import { newId } from './logic';
export type RendererRuntime = {
  state: RuntimeState['blocks'][string];
  set(state: RuntimeState['blocks'][string] | null, settled?: boolean): void;
  flush(): Promise<void>;
  settle(kind: string, payload: CanvasBlock['data'], label?: string, eventId?: string): Promise<void>;
};
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
      set: (state, settled = false) => controller.learning.setBlock(block.id, state, settled),
      flush: () => controller.learning.flush(),
      async settle(kind, payload, label = 'Interacción completada', eventId = newId('evt')) {
        const documentId = controller.current.current?.document.id;
        await controller.learning.flush();
        if (documentId !== controller.current.current?.document.id) return;
        const result = await controller.send({ kind, payload, label, delivery: 'batched', settled: true, targetIds: [block.id] }, eventId);
        if (!result) throw new Error('No se guardó la interacción.');
      },
    },
    scope: { variables, values, get: name => values[name] ?? NaN, set: (name, value, settled = false) => controller.learning.setVariable(block.id, name, value, settled) },
  };
}
