import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { URL } from 'node:url';
import type { CanvasController } from '../plugin/client/useCanvas';
import { setup, workspaceId } from './helpers';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react') return { url: new URL('./fixtures/react-headless.ts', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { useLearning } = require('../plugin/client/useLearning') as typeof import('../plugin/client/useLearning');

test('record persists the interaction as the block state lastInteraction, keeps the renderer state and stays under 4 KiB', async t => {
  const { service } = await setup(t);
  const reference = { documentId: 'd', workspaceId };
  const view = await service.read(reference);
  const block = view.document.blocks.find(b => b.id === 'b')!;
  let snapshot = { blocks: {} as Record<string, Record<string, unknown>>, scopes: {} }, flushes = 0;
  const pending: { id: string; state: Record<string, unknown> | null }[] = [];
  const controller = {
    view, current: { current: view },
    learning: {
      subscribe: () => () => {}, getSnapshot: () => snapshot,
      setBlock: (id: string, state: Record<string, unknown> | null) => { pending.push({ id, state }); snapshot = { ...snapshot, blocks: { ...snapshot.blocks, ...(state ? { [id]: state } : {}) } }; },
      flush: async () => { flushes++; while (pending.length) { const entry = pending.shift()!; await service.runtimeSet({ ...reference, blocks: [{ id: entry.id, state: entry.state as never }], scopes: [] }); } },
    },
  } as unknown as CanvasController;
  const { runtime } = useLearning(block, controller);
  runtime.set({ playhead: 4 });
  await runtime.record('attempt.one', { guess: 2, outcome: 3 }, 'Compare attempt');
  let stored = (await service.read(reference)).runtime.blocks.b as Record<string, any>;
  assert.equal(stored.playhead, 4);
  assert.deepEqual([stored.lastInteraction.kind, stored.lastInteraction.label, stored.lastInteraction.payload], ['attempt.one', 'Compare attempt', { guess: 2, outcome: 3 }]);
  assert.ok(flushes >= 2, 'the renderer state is flushed before the record');
  // A later state write keeps the record; a payload too big for the block is dropped and the kind kept.
  runtime.set({ playhead: 9 }); await controller.learning.flush();
  stored = (await service.read(reference)).runtime.blocks.b as Record<string, any>;
  assert.deepEqual([stored.playhead, stored.lastInteraction.kind], [9, 'attempt.one']);
  await runtime.record('attempt.big', { text: 'x'.repeat(5000) }, 'Big');
  stored = (await service.read(reference)).runtime.blocks.b as Record<string, any>;
  assert.deepEqual([stored.lastInteraction.kind, 'payload' in stored.lastInteraction], ['attempt.big', false]);
});

test('record waits for the runtime flush and records nothing if the learner switched documents', async t => {
  const { service } = await setup(t);
  const view = await service.read({ documentId: 'd', workspaceId });
  let writes = 0, failFlush = true;
  const controller = {
    view, current: { current: view },
    learning: { subscribe: () => () => {}, getSnapshot: () => view.runtime, setBlock: () => { writes++; },
      flush: async () => {
        if (failFlush) throw new Error('offline runtime');
        controller.current.current = { ...view, document: { ...view.document, id: 'another' } };
      },
    },
  } as unknown as CanvasController;
  const { runtime } = useLearning(view.document.blocks[0], controller);
  await assert.rejects(runtime.record('attempt.one', {}, 'Compare'), /offline runtime/);
  assert.equal(writes, 0);
  failFlush = false;
  await runtime.record('attempt.one', {}, 'Compare');
  assert.equal(writes, 0);
});
