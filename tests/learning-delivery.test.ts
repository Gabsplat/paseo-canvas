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

test('a settled attempt retries a lost response with the same event ID and creates one event', async t => {
  const { service } = await setup(t);
  const reference = { documentId: 'd', workspaceId };
  const view = await service.read(reference);
  const block = view.document.blocks.find(b => b.id === 'b')!;
  let loseResponse = true, flushes = 0;
  const ids: string[] = [];
  const controller = {
    view, current: { current: view },
    learning: { subscribe: () => () => {}, getSnapshot: () => view.runtime, flush: async () => { flushes++; } },
    send: async (action: Parameters<CanvasController['send']>[0], eventId: string) => {
      ids.push(eventId);
      const result = await service.action({ ...reference, expectedRevision: view.document.revision, action, eventId });
      if (loseResponse) { loseResponse = false; return undefined; }
      return result;
    },
  } as unknown as CanvasController;
  const { runtime } = useLearning(block, controller);
  const payload = { attemptId: 'attempt-one', guess: 2, outcome: 3 };
  await assert.rejects(runtime.settle('attempt.attempt-one', payload, 'Comparar intento', 'evt_attempt-one'), /No se guardó/);
  await runtime.settle('attempt.attempt-one', payload, 'Comparar intento', 'evt_attempt-one');
  assert.deepEqual(ids, ['evt_attempt-one', 'evt_attempt-one']);
  assert.equal(flushes, 2);
  assert.equal((await service.events(reference)).events.length, 1);
  await assert.rejects(runtime.settle('attempt.attempt-one', { ...payload, guess: 9 }, 'Comparar intento', 'evt_attempt-one'), /different action/);
});

test('settled delivery waits for runtime flush and stops if the learner switched documents', async t => {
  const { service } = await setup(t);
  const view = await service.read({ documentId: 'd', workspaceId });
  let sends = 0, failFlush = true;
  const controller = {
    view, current: { current: view },
    learning: { subscribe: () => () => {}, getSnapshot: () => view.runtime,
      flush: async () => {
        if (failFlush) throw new Error('offline runtime');
        controller.current.current = { ...view, document: { ...view.document, id: 'another' } };
      },
    },
    send: async () => { sends++; },
  } as unknown as CanvasController;
  const { runtime } = useLearning(view.document.blocks[0], controller);
  await assert.rejects(runtime.settle('attempt.one', {}, 'Comparar', 'evt_one'), /offline runtime/);
  assert.equal(sends, 0);
  failFlush = false;
  await runtime.settle('attempt.one', {}, 'Comparar', 'evt_one');
  assert.equal(sends, 0);
});
