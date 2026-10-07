import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlAppDataSchema, htmlAppEvent, HTML_APP_LIMITS } from '../plugin/shared/renderers/html-app';
import { getRendererSpec } from '../plugin/shared/renderers';
import { setup, mutation, workspaceId } from './helpers';

test('a mini app accepts any page within its size and height limits', () => {
  assert.equal(htmlAppDataSchema.safeParse({ html: '<canvas></canvas><script>alert(1)</script><style>*{all:unset}</style>' }).success, true);
  assert.equal(htmlAppDataSchema.safeParse({ html: '' }).success, false);
  assert.equal(htmlAppDataSchema.safeParse({ html: 'x'.repeat(HTML_APP_LIMITS.html + 1) }).success, false);
  assert.equal(htmlAppDataSchema.safeParse({ html: 'x', height: 40 }).success, false);
  assert.equal(htmlAppDataSchema.safeParse({ html: 'x', url: 'https://example.org' }).success, false);
});
test('what a mini app reports is a named, bounded, plain JSON event or nothing', () => {
  assert.deepEqual(htmlAppEvent('step.done', { n: 2, at: [1, 2] }), { kind: 'step.done', payload: { n: 2, at: [1, 2] } });
  assert.deepEqual(htmlAppEvent('click', undefined), { kind: 'click', payload: null });
  for (const kind of ['', '9lives', 'a b', 'x'.repeat(65), 7, null]) assert.equal(htmlAppEvent(kind, {}), null);
  assert.equal(htmlAppEvent('big', { text: 'x'.repeat(HTML_APP_LIMITS.payload) }), null);
  const loop: Record<string, unknown> = {}; loop.self = loop; assert.equal(htmlAppEvent('loop', loop), null);
  assert.deepEqual(htmlAppEvent('fn', { run() {}, keep: 1 }), { kind: 'fn', payload: { keep: 1 } });
});
test('a mini app is created and rewritten through the real service, and the agent is told how to build one', async t => {
  const { service } = await setup(t), spec = getRendererSpec('html')!;
  assert.match(spec.guidance, /lienzo\.send\(kind, payload\)/); assert.match(spec.guidance, /no preset components/);
  await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'app', typeId: 'html', title: 'Ejemplo', data: { html: '<b>uno</b>' } } }]));
  const next = await service.mutate(mutation(1, [{ type: 'block.update', id: 'app', patch: { data: { html: '<b>dos</b>', height: 240 } } }]));
  assert.deepEqual(next.document.blocks.find(b => b.id === 'app')!.data, { html: '<b>dos</b>', height: 240 });
  await assert.rejects(service.mutate(mutation(2, [{ type: 'block.update', id: 'app', patch: { data: { html: '' } } }])));
  assert.ok((await service.catalog()).blockTypes.some(type => type.id === 'html' && type.name === 'Mini app'));
  void workspaceId;
});
