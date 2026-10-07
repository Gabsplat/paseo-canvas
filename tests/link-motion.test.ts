import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Platform } from './fixtures/native-headless';
import { setup, mutation, workspaceId } from './helpers';
import { canvasPresentation } from '../plugin/client/presentation';
import { layoutCanvas, linkRoutes } from '../plugin/client/logic';
import { prepareLinkMotion, MAX_LINK_MOTION_TOKENS } from '../plugin/client/link-motion';
import type { CanvasController } from '../plugin/client/useCanvas';
import type { RuntimeState } from '../plugin/shared/learning';
import type { LinkDraw, LinkScene } from '../plugin/client/web';
import type { LinkMotionSample } from '../plugin/client/renderers/types';
import { z } from 'zod';
import { rendererSpecs, getRendererSpec, type RendererSpec } from '../plugin/shared/renderers';
import { controlsSpec } from '../plugin/shared/renderers/controls';
import type { CanvasCatalog, CanvasDocument } from '../plugin/shared/model';
import { LearningRuntimeStore } from '../plugin/client/learning-state';
import type { Element } from './fixtures/react-headless';

export const reducedMotion = { current: false };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/motion') && context.parentURL?.includes('/plugin/client/')) return { url: new URL(`file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./fixtures/react-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native' || specifier === '@getpaseo/plugin/client/react-native' || (specifier.endsWith('/ui') && context.parentURL?.includes('/plugin/client/')))
    return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { getClientRenderer } = require('../plugin/client/renderers');
const { mountLinkLayer } = require('../plugin/client/web');
const { usePresentation } = require('../plugin/client/usePresentation');
const { RegisteredRenderer } = require('../plugin/client/renderers/RegisteredRenderer');
const { HiddenResult } = require('../plugin/client/HiddenResult');
const reference = { documentId: 'd', workspaceId };
// No shipped renderer hides other blocks. The real dispatcher and usePresentation read the
// shared registry, so a test-only renderer that hides data.target until revealed is added to it.
const gateSpec: RendererSpec = { id: 'test-gate', dataSchema: z.object({ target: z.string() }).strict(), interactive: true, guidance: '',
  blockType: { ...controlsSpec.blockType, id: 'gate', renderer: 'test-gate' },
  hiddenTargets: (data, state) => state.revealed ? [] : [(data as { target: string }).target] };
(rendererSpecs as RendererSpec[]).push(gateSpec);
assert.equal(getRendererSpec('test-gate'), gateSpec);
function gated<View extends { document: CanvasDocument }>(view: View, catalog: CanvasCatalog, target = 'c') {
  return { view: { ...view, document: { ...view.document, blocks: [...view.document.blocks, { id: 'gate', typeId: 'gate', title: 'Gate', data: { target } }] } },
    catalog: { ...catalog, blockTypes: [...catalog.blockTypes, gateSpec.blockType] } };
}
const flow = { question: '¿Cuándo llega?', events: [{ t: 100, from: 'b', to: 'c', kind: 'signal', payload: 2 }], duration: 2000, travelMs: 1000, links: { bc: { sign: -1, delay: 50 } } };

test('real dispatcher passes a protected document to neighboring renderers and cannot mount a gated renderer directly', async t => {
  const { service } = await setup(t);
  const { view, catalog } = gated(await service.mutate(mutation(0, [
    { type: 'block.update', id: 'c', patch: { title: 'SECRET RESULT', data: { text: 'SECRET DATA' } } },
    { type: 'link.create', link: { id: 'bc', from: 'b', to: 'c', kind: 'flow' } },
    { type: 'block.create', block: { id: 'flow', typeId: 'animated-flow', title: 'Flujo', data: flow } },
  ])), await service.catalog());
  const learning = new LearningRuntimeStore(async () => { throw new Error('Read only probe'); }, () => {}); t.after(() => learning.reset());
  learning.sync(view.document, 0, { blocks: { flow: { playhead: 625 } }, scopes: {} });
  const controller = { view, current: { current: view }, catalog, learning } as unknown as CanvasController;
  const block = view.document.blocks.find(b => b.id === 'flow')!;
  const wrapper = RegisteredRenderer({ block, id: 'animated-flow', controller, readOnly: false, send: async () => {} }) as Element;
  const child = wrapper.props.children as Element;
  assert.equal(child.props.document.blocks.find((b: any) => b.id === 'c').title, 'Resultado oculto');
  assert.deepEqual(child.props.document.blocks.find((b: any) => b.id === 'c').data, {});
  const rendered = (child.type as Function)(child.props) as Element;
  assert.ok(!JSON.stringify(rendered).includes('SECRET RESULT'));
  assert.ok(!JSON.stringify(rendered).includes('SECRET DATA'));
  const target = RegisteredRenderer({ block: view.document.blocks.find(b => b.id === 'c')!, id: 'function-plot', controller, readOnly: false, send: async () => {} }) as Element;
  assert.equal(target.type, HiddenResult);
  assert.equal(view.document.blocks.find(b => b.id === 'c')!.title, 'SECRET RESULT');
});

test('registered bridge reads optimistic runtime, filters gated endpoints/source, and leaves authored graph and feedback unchanged', async t => {
  const { service } = await setup(t);
  const view = await service.mutate(mutation(0, [
    { type: 'link.create', link: { id: 'bc', from: 'b', to: 'c', kind: 'flow' } },
    { type: 'block.create', block: { id: 'flow', typeId: 'animated-flow', title: 'Flujo', data: flow } },
  ]));
  const catalog = await service.catalog(), original = JSON.stringify(view.document), epoch = 1_800_000_000_000;
  const sample = prepareLinkMotion(view.document, catalog, getClientRenderer);
  const runtime: RuntimeState = { blocks: { flow: { playhead: 0, playing: true, anchorMs: epoch, visited: [0, 0] } }, scopes: {} };
  assert.equal(sample(runtime, epoch, new Map()).playing, true, 'future events still schedule a frame');
  const withGate = gated(view, catalog), hidden = canvasPresentation(withGate.view.document, withGate.catalog, runtime).hiddenBy;
  assert.deepEqual([...hidden.keys()], ['c']);
  assert.deepEqual(sample(runtime, epoch + 625, hidden).tokens, []);
  const visible = sample(runtime, epoch + 625, new Map());
  assert.deepEqual(visible.tokens, [{ linkId: 'bc', progress: .5, kind: 'signal', label: '2', sign: -1, delay: 50 }]);
  assert.equal(visible.playing, true);
  assert.deepEqual(sample(runtime, epoch + 625, new Map([['flow', ['gate']]])).tokens, []);
  runtime.blocks.flow = { playhead: 310, playing: false, anchorMs: 0, visited: [0, 900] };
  assert.equal(sample(runtime, epoch + 5000, new Map()).tokens[0].progress, .2);
  assert.equal(sample(runtime, epoch + 5000, new Map()).playing, false);
  runtime.blocks.flow = {}; assert.deepEqual(sample(runtime, epoch, new Map()), { tokens: [], playing: false });
  assert.equal(JSON.stringify(view.document), original);
  assert.equal((await service.events(reference)).events.length, 0);
  assert.deepEqual((await service.read(reference)).document, view.document);
  const copies = await service.mutate(mutation(1, [
    { type: 'group.create', group: { id: 'g', title: 'Sistema', description: '', groupIds: [], blockIds: ['b', 'c', 'flow'], layout: { mode: 'graph' } } },
    { type: 'entity.duplicate', id: 'g', idPrefix: 'copy' },
  ]));
  const copiedFlow = copies.document.blocks.find(b => b.typeId === 'animated-flow' && b.id !== 'flow')!;
  const event = (copiedFlow.data.events as any[])[0], metadataId = Object.keys(copiedFlow.data.links as object)[0];
  const copiedLink = copies.document.links.find(l => l.id === metadataId)!;
  assert.notEqual(event.from, 'b'); assert.notEqual(event.to, 'c'); assert.notEqual(metadataId, 'bc');
  assert.equal(copiedLink.from, event.from); assert.equal(copiedLink.to, event.to);
});

test('scope frames reuse masked document identity; opening a gate invalidates it', async t => {
  const { service } = await setup(t);
  const { view, catalog } = gated(await service.read(reference), await service.catalog());
  let runtime: RuntimeState = { blocks: {}, scopes: {} };
  const controller = { view, catalog, learning: { subscribe() { return () => {}; }, getSnapshot: () => runtime } } as unknown as CanvasController;
  const first = usePresentation(controller);
  for (const value of [2, -3, .5, 3]) {
    runtime = { blocks: {}, scopes: { '$document': { a: value } } };
    assert.equal(usePresentation(controller).document, first.document);
  }
  runtime = { blocks: { gate: { revealed: true } }, scopes: {} };
  assert.equal(usePresentation(controller).document, view.document);
  runtime = { blocks: {}, scopes: {} };
  // A different authored target must invalidate the projection even at the same revision.
  controller.view = { ...view, document: { ...view.document, blocks: view.document.blocks.map(b => b.id === 'gate' ? { ...b, data: { ...b.data, target: 'b' } } : b) } };
  assert.notEqual(usePresentation(controller).document, first.document);
  assert.equal(usePresentation(controller).document.blocks.find((b: any) => b.id === 'b').title, 'Resultado oculto');
});

class Svg {
  attrs: Record<string, string> = {}; children: Svg[] = []; parent?: Svg; textContent = ''; removed = false;
  constructor(public tag: string) {}
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  removeAttribute(name: string) { delete this.attrs[name]; }
  appendChild(child: Svg) { this.children.push(child); child.parent = this; }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  addEventListener() {}
  getTotalLength() { return this.attrs.d === 'updated-real-path' ? 200 : 100; }
  getPointAtLength(distance: number) { return { x: distance, y: this.attrs.d === 'updated-real-path' ? 20 : 10 }; }
}
function svgHarness() {
  Platform.OS = 'web';
  const frames = new Map<number, Function>(), listeners = new Map<string, Function>(), all: Svg[] = [];
  let sequence = 0, intersection: Function = () => {}, epoch = 1_800_000_000_000, disconnected = false;
  const doc = { hidden: false, createElementNS: (_ns: string, tag: string) => { const node = new Svg(tag); all.push(node); return node; },
    addEventListener: (name: string, cb: Function) => listeners.set(name, cb), removeEventListener: (name: string) => listeners.delete(name) };
  const globals = globalThis as unknown as Record<string, any>, old = new Map<string, unknown>(), now = Date.now;
  for (const [key, value] of Object.entries({ document: doc, requestAnimationFrame: (fn: Function) => { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame: (id: number) => frames.delete(id),
    IntersectionObserver: class { constructor(fn: Function) { intersection = fn; } observe() {} disconnect() { disconnected = true; } } })) { old.set(key, globals[key]); globals[key] = value; }
  Date.now = () => epoch;
  const host = new Svg('host'), marks = new Svg('host'), layer = mountLinkLayer(host, { onPress() {}, onHover() {} }, marks)!;
  return { layer, host, marks, all, doc, frames, listeners, epoch,
    visible(value: boolean) { intersection([{ isIntersecting: value }]); },
    tick(value: number) { epoch = value; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(123)); },
    closed: () => disconnected,
    close() { layer.destroy(); Date.now = now; for (const [key, value] of old) { if (value === undefined) delete globals[key]; else globals[key] = value; } },
  };
}
function scene(motion: LinkScene['motion']): LinkScene {
  const draw: LinkDraw = { key: 'b>c', linkIds: ['bc'], d: 'real-path', color: '#246', width: 1, dash: '', opacity: .4, interactive: true, title: 'Enlace', arrow: null, label: null, badge: null };
  return { draws: [draw], origin: { x: 50, y: 80 }, halo: '#fff', font: 'system-ui', labelSize: 12, badgeSize: 10, hitWidth: 20, motion };
}
const motionNodes = (h: ReturnType<typeof svgHarness>) => h.all.filter(n => n.attrs['data-kind'] && !n.removed);
test('SVG bridge samples epoch time on real paths, follows live geometry/strands, distinguishes kinds and stops on pause/visibility/unmount', () => {
  const h = svgHarness(), seen: number[] = [];
  let playing = true;
  const motion = (epoch: number): LinkMotionSample => { seen.push(epoch); return { playing, tokens: [
    { linkId: 'bc', progress: Math.min(1, (epoch - h.epoch) / 1000), kind: 'signal', label: '2', sign: -1, delay: 50 },
    { linkId: 'bc', progress: .2, kind: 'message', label: 'Hola' }, { linkId: 'bc', progress: .8, kind: 'value', label: '3' },
    { linkId: 'absent', progress: .5, kind: 'value', label: 'Oculto' },
  ] }; };
  try {
    const initial = scene(motion); h.layer.update(initial); assert.equal(h.frames.size, 0);
    h.visible(true); assert.equal(h.frames.size, 1); h.tick(h.epoch + 500);
    assert.equal(seen.at(-1), h.epoch + 500, 'never receives RAF navigation time 123');
    assert.equal(motionNodes(h)[0].attrs.transform, 'translate(50 10)');
    assert.equal(motionNodes(h).length, 3);
    assert.match(motionNodes(h)[0].children[1].textContent, /Señal: 2 · − · 50 ms/);
    assert.equal(new Set(motionNodes(h).map(n => n.children[0].attrs.d)).size, 3);
    initial.draws[0] = { ...initial.draws[0], d: 'updated-real-path', shift: { x: 7, y: 9 } };
    h.layer.update(initial); assert.equal(motionNodes(h)[0].attrs.transform, 'translate(107 29)');
    playing = false; h.layer.update(initial); assert.equal(h.frames.size, 0);
    playing = true; h.layer.update(initial); assert.equal(h.frames.size, 1);
    h.doc.hidden = true; h.listeners.get('visibilitychange')!(); assert.equal(h.frames.size, 0); assert.equal(motionNodes(h).length, 0);
    h.doc.hidden = false; h.listeners.get('visibilitychange')!(); assert.equal(h.frames.size, 1);
    h.visible(false); assert.equal(h.frames.size, 0); h.visible(true); assert.equal(h.frames.size, 1);
    h.layer.update({ ...initial, draws: [] }); assert.equal(motionNodes(h).length, 0, 'never invents missing geometry');
    h.layer.destroy(); assert.equal(h.frames.size, 0); assert.equal(h.listeners.size, 0); assert.equal(h.closed(), true);
  } finally { h.close(); }
  Platform.OS = 'ios'; assert.equal(mountLinkLayer({}, { onPress() {}, onHover() {} }), null); Platform.OS = 'web';
});

test('bounded bridge consumes geometry produced by real layout and connector routing', async t => {
  const { service } = await setup(t);
  const view = await service.mutate(mutation(0, [{ type: 'link.create', link: { id: 'bc', from: 'b', to: 'c', kind: 'flow' } }]));
  const catalog = await service.catalog(), layout = layoutCanvas(view.document, {}, catalog), route = linkRoutes(view.document, layout)[0];
  const h = svgHarness();
  try {
    const value = scene(() => ({ playing: false, tokens: Array.from({ length: 1000 }, () => ({ linkId: 'bc', progress: .5, kind: 'value' as const, label: '2' })) }));
    value.draws[0].d = route.d; h.layer.update(value); h.visible(true);
    assert.ok(h.all.some(n => n.tag === 'path' && n.attrs.d === route.d));
    assert.equal(motionNodes(h).length, MAX_LINK_MOTION_TOKENS); assert.equal(h.frames.size, 0);
  } finally { h.close(); }
});
