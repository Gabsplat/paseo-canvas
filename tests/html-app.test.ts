import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlAppDataSchema, htmlAppInteraction, htmlAppState, HTML_APP_LIMITS } from '../plugin/shared/renderers/html-app';
import { getRendererSpec } from '../plugin/shared/renderers';
import { setup, mutation, workspaceId } from './helpers';

test('a mini app accepts any page within its size and height limits', () => {
  assert.equal(htmlAppDataSchema.safeParse({ html: '<canvas></canvas><script>alert(1)</script><style>*{all:unset}</style>' }).success, true);
  assert.equal(htmlAppDataSchema.safeParse({ html: '' }).success, false);
  assert.equal(htmlAppDataSchema.safeParse({ html: 'x'.repeat(HTML_APP_LIMITS.html + 1) }).success, false);
  assert.equal(htmlAppDataSchema.safeParse({ html: 'x', height: 40 }).success, false);
  assert.equal(htmlAppDataSchema.safeParse({ html: 'x', url: 'https://example.org' }).success, false);
});
test('what a mini app stores is bounded plain JSON, and a legacy send only records its last call', () => {
  assert.deepEqual(htmlAppState({ step: 2, answer: 'b', seen: [1, 2] }), { value: { step: 2, answer: 'b', seen: [1, 2] } });
  assert.deepEqual(htmlAppState(undefined), { value: null }); assert.deepEqual(htmlAppState('done'), { value: 'done' });
  assert.equal(htmlAppState({ text: 'x'.repeat(HTML_APP_LIMITS.state) }), null);
  const loop: Record<string, unknown> = {}; loop.self = loop; assert.equal(htmlAppState(loop), null);
  assert.deepEqual(htmlAppState({ run() {}, keep: 1 }), { value: { keep: 1 } });
  assert.deepEqual(htmlAppInteraction('step.done', { n: 2 }), { kind: 'step.done', payload: { n: 2 } });
  assert.deepEqual(htmlAppInteraction('click', undefined), { kind: 'click' });
  assert.deepEqual(htmlAppInteraction('big', { text: 'x'.repeat(HTML_APP_LIMITS.payload) }), { kind: 'big' }, 'a long payload is dropped, the kind kept');
  for (const kind of ['', '9lives', 'a b', 'x'.repeat(65), 7, null]) assert.equal(htmlAppInteraction(kind, {}), null);
});
test('a mini app is created and rewritten through the real service, and the agent is told how to build one', async t => {
  const { service } = await setup(t), spec = getRendererSpec('html')!;
  assert.match(spec.guidance, /lienzo\.setState\(value\)/); assert.match(spec.guidance, /cannot message you/); assert.doesNotMatch(spec.guidance, /lienzo\.send|wake/); assert.match(spec.guidance, /no preset components/);
  await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'app', typeId: 'html', title: 'Ejemplo', data: { html: '<b>uno</b>' } } }]));
  const next = await service.mutate(mutation(1, [{ type: 'block.update', id: 'app', patch: { data: { html: '<b>dos</b>', height: 240 } } }]));
  assert.deepEqual(next.document.blocks.find(b => b.id === 'app')!.data, { html: '<b>dos</b>', height: 240 });
  await assert.rejects(service.mutate(mutation(2, [{ type: 'block.update', id: 'app', patch: { data: { html: '' } } }])));
  assert.ok((await service.catalog()).blockTypes.some(type => type.id === 'html' && type.name === 'Mini app'));
  void workspaceId;
});
test('the bridge tells a mini app where its window is, and believes only the canvas page', async () => {
  const { readFile } = await import('node:fs/promises'), vm = await import('node:vm');
  // The bridge is text shipped into a frame; it is read here as text because its module needs a browser.
  const source = await readFile('plugin/client/web.ts', 'utf8'), literal = /export const HTML_APP_BRIDGE = ("(?:[^"\\]|\\.)*");/.exec(source);
  assert.ok(literal, 'bridge found'); const script = (JSON.parse(literal[1]) as string).replace(/^<script>|<\/script>$/g, '');
  const sent: { type: string }[] = [], listeners: ((e: { source: unknown; data: unknown }) => void)[] = [], parent = { postMessage: (m: never) => { sent.push(m); } };
  const window: Record<string, unknown> = {}, sandbox = { window, parent, document: { documentElement: { style: {} } }, addEventListener: (_: string, f: never) => { listeners.push(f); } };
  vm.runInNewContext(script, sandbox);
  const lienzo = window.lienzo as { frame: unknown; context: unknown; onFrame(f: (frame: unknown) => void): void }, deliver = (data: unknown, from: unknown = parent) => listeners.forEach(f => f({ source: from, data }));
  assert.equal(sent[0].type, 'ready'); assert.equal(lienzo.frame, null);
  const seen: unknown[] = []; lienzo.onFrame(f => seen.push(f));
  const frame = { x: 10, y: 20, width: 300, height: 200, others: [{ x: 400, y: 20, width: 300, height: 200 }] };
  deliver({ lienzo: 1, type: 'frame', frame }); assert.deepEqual(seen, [frame]); assert.deepEqual(lienzo.frame, frame);
  const late: unknown[] = []; lienzo.onFrame(f => late.push(f)); assert.deepEqual(late, [frame], 'a late listener gets the current frame at once');
  // Another mini app can post here, but not as the canvas.
  deliver({ lienzo: 1, type: 'frame', frame: { x: 0 } }, {}); deliver({ lienzo: 1, type: 'context', context: { theme: { dark: true } } }, {});
  assert.deepEqual(lienzo.frame, frame); assert.equal(lienzo.context, null);
  deliver({ lienzo: 1, type: 'context', context: { theme: { dark: true } } }); assert.deepEqual(lienzo.context, { theme: { dark: true } });
  assert.ok(getRendererSpec('html')!.guidance!.includes('lienzo.onFrame'));
});
test('setState asks the canvas to store the value and resolves when it is saved; send never wakes anything', async () => {
  const { readFile } = await import('node:fs/promises'), vm = await import('node:vm');
  const source = await readFile('plugin/client/web.ts', 'utf8'), literal = /export const HTML_APP_BRIDGE = ("(?:[^"\\]|\\.)*");/.exec(source);
  const script = (JSON.parse(literal![1]) as string).replace(/^<script>|<\/script>$/g, ''), sent: Record<string, unknown>[] = [], listeners: ((e: { source: unknown; data: unknown }) => void)[] = [], parent = { postMessage: (m: never) => { sent.push(m); } };
  const window: Record<string, unknown> = {}; vm.runInNewContext(script, { window, parent, Promise, document: { documentElement: { style: {} } }, addEventListener: (_: string, f: never) => { listeners.push(f); } });
  const lienzo = window.lienzo as { setState(value: unknown): Promise<void>; state: unknown; send(kind: string, payload?: unknown): void }, deliver = (data: unknown) => listeners.forEach(f => f({ source: parent, data }));
  assert.equal(lienzo.state, null);
  const saved = lienzo.setState({ answer: 'b' }), refused = lienzo.setState({ big: true });
  const [first, second] = JSON.parse(JSON.stringify(sent.slice(1)));
  assert.deepEqual([first.type, first.value, second.value], ['state', { answer: 'b' }, { big: true }]);
  deliver({ lienzo: 1, type: 'stored', id: first.id, ok: true }); deliver({ lienzo: 1, type: 'stored', id: second.id, ok: false, error: 'Too big' });
  await saved; await assert.rejects(refused, /Too big/);
  deliver({ lienzo: 1, type: 'context', context: { theme: { dark: false }, state: { answer: 'b' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(lienzo.state)), { answer: 'b' }, 'the page restores what it stored');
  lienzo.send('done', { ok: true });
  const legacy = JSON.parse(JSON.stringify(sent.at(-1)));
  assert.deepEqual([legacy.type, legacy.kind, 'wake' in legacy], ['event', 'done', false]);
  const renderer = await readFile('plugin/client/renderers/html-app.tsx', 'utf8');
  assert.doesNotMatch(renderer, /immediate|batched|wake/); assert.match(renderer, /runtime\.record\(/);
});
