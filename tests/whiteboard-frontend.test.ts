import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { Platform } from './fixtures/native-headless';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./fixtures/react-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native') return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { attachEntityDrag, attachMiddlePan, attachToolPointer, WebSvg, fetchSvgUrl } = require('../plugin/client/web');
class Events {
  listeners = new Map<string, Set<Function>>();
  addEventListener(name: string, fn: Function) { const set = this.listeners.get(name) ?? new Set(); set.add(fn); this.listeners.set(name, set); }
  removeEventListener(name: string, fn: Function) { this.listeners.get(name)?.delete(fn); }
  fire(name: string, event: any) { for (const fn of [...(this.listeners.get(name) ?? [])]) fn(event); }
}
function harness() {
  Platform.OS = 'web'; const node = new Events(), doc = new Events();
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document'); Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  const entity = { id: 'lienzo-entity-card' };
  const target = (kind = 'text') => ({ closest(selector: string) {
    if (selector.includes('[id^="lienzo-entity-"')) return entity;
    if ((kind === 'input' || kind === 'range') && selector.includes('input')) return this;
    if (kind === 'resize' && selector.includes('lienzo-interactive-resize-')) return this;
    if (kind === 'link' && selector.includes('lienzo-link-handle-')) return this;
    if (kind === 'active' && selector.includes('data-lienzo-interacting')) return this;
    return null;
  } });
  const event = (x: number, y: number, kind = 'text', button = 0) => ({ target: target(kind), clientX: x, clientY: y, pointerId: 1, button, shiftKey: false, ctrlKey: false, metaKey: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
  return { node, doc, event, close() { if (before) Object.defineProperty(globalThis, 'document', before); else Reflect.deleteProperty(globalThis, 'document'); } };
}
test('all-area entity drag preserves clicks, passes original grab point and starts only after threshold', () => {
  for (const kind of ['text', 'button', 'svg', 'renderer', 'image']) {
    const h = harness(), calls: any[] = [];
    const stop = attachEntityDrag(h.node, { enabled: () => true, start: (...args: any[]) => calls.push(['start', ...args]), move: (p: any) => calls.push(['move', p]), end: (cancelled: boolean) => calls.push(['end', cancelled]) });
    try {
      const down = h.event(10, 20, kind); h.node.fire('pointerdown', down); h.doc.fire('pointermove', h.event(12, 21, kind)); h.doc.fire('pointerup', h.event(12, 21, kind));
      assert.equal(down.prevented, false); assert.equal(calls.length, 0);
      h.node.fire('pointerdown', h.event(10, 20, kind)); const move = h.event(40, 60, kind); h.doc.fire('pointermove', move); h.doc.fire('pointerup', move);
      assert.deepEqual(calls.map(c => c[0]), ['start', 'move', 'end']); assert.equal(calls[0][1], 'card'); assert.equal(calls[0][2].x, 10); assert.equal(calls[0][2].y, 20); assert.equal(move.prevented, true); assert.equal(calls[2][1], false);
    } finally { stop(); h.close(); }
  }
});
test('inputs, ranges, active deep content, resize and link handles keep left gestures', () => {
  const h = harness(); let starts = 0;
  const stop = attachEntityDrag(h.node, { enabled: () => true, start: () => starts++, move() {}, end() {} });
  try { for (const kind of ['input', 'range', 'active', 'resize', 'link']) { h.node.fire('pointerdown', h.event(10, 20, kind)); h.doc.fire('pointermove', h.event(40, 60, kind)); h.doc.fire('pointerup', h.event(40, 60, kind)); } assert.equal(starts, 0); } finally { stop(); h.close(); }
});
test('Escape and unmount cancel active drag once, and disabled state never starts it', () => {
  const h = harness(), ends: boolean[] = []; let enabled = false;
  const stop = attachEntityDrag(h.node, { enabled: () => enabled, start() {}, move() {}, end: (cancelled: boolean) => ends.push(cancelled) });
  try {
    h.node.fire('pointerdown', h.event(0, 0)); h.doc.fire('pointermove', h.event(50, 50)); assert.deepEqual(ends, []);
    enabled = true; h.node.fire('pointerdown', h.event(0, 0)); h.doc.fire('pointermove', h.event(50, 50)); h.doc.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }); h.doc.fire('pointerup', h.event(50, 50)); assert.deepEqual(ends, [true]);
    h.node.fire('pointerdown', h.event(0, 0)); h.doc.fire('pointermove', h.event(50, 50)); stop(); assert.deepEqual(ends, [true, true]);
  } finally { stop(); h.close(); }
});
test('middle mouse pans over every passive or deep renderer including ranges and SVG', () => {
  for (const kind of ['text', 'svg', 'renderer', 'active', 'range', 'image', 'button']) {
    const h = harness(), deltas: any[] = []; let ends = 0;
    const stop = attachMiddlePan(h.node, (p: any) => deltas.push(p), () => ends++);
    try { const down = h.event(10, 20, kind, 1); h.node.fire('pointerdown', down); h.doc.fire('pointermove', h.event(25, 12, kind, 1)); h.doc.fire('pointerup', h.event(25, 12, kind, 1)); assert.deepEqual(deltas, [{ dx: 0, dy: 0 }, { dx: 15, dy: -8 }]); assert.equal(down.prevented, true); assert.equal(ends, 1); } finally { stop(); h.close(); }
  }
});
test('browser adapters are inert on native', () => {
  Platform.OS = 'ios'; const node = new Events(); attachEntityDrag(node, { enabled: () => true, start() {}, move() {}, end() {} })(); attachMiddlePan(node, () => {})(); assert.equal(node.listeners.size, 0); Platform.OS = 'web';
});
test('inactive creation tools leave entity drag available; active tools cancel without a save', () => {
  const h = harness(), calls: string[] = []; let active = false;
  const stop = attachToolPointer(h.node, { begin: () => active, move: () => calls.push('preview'), end: (_p: unknown, cancelled: boolean) => calls.push(cancelled ? 'cancel' : 'commit') });
  try {
    const ignored = h.event(0, 0); h.node.fire('pointerdown', ignored); h.doc.fire('pointermove', h.event(40, 40)); h.doc.fire('pointerup', h.event(40, 40)); assert.equal(ignored.prevented, false); assert.equal(calls.length, 0);
    active = true; h.node.fire('pointerdown', h.event(0, 0)); h.doc.fire('pointermove', h.event(40, 40)); h.doc.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }); h.doc.fire('pointerup', h.event(40, 40)); assert.deepEqual(calls, ['preview', 'cancel']);
  } finally { stop(); h.close(); }
});
test('SVG browser rendering validates unsafe markup and only changes root dimensions', () => {
  Platform.OS = 'web'; const rendered = WebSvg({ svg: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="2" y="2" width="20" height="20" /></svg>', color: '#fff', label: 'Box' });
  assert.equal(rendered.type, 'img'); assert.ok(decodeURIComponent(rendered.props.src.split(',')[1]).includes('width="20"')); assert.equal(WebSvg({ svg: '<svg viewBox="0 0 24 24"><script /></svg>', color: '#fff', label: 'Unsafe' }), null);
  Platform.OS = 'ios'; assert.equal(WebSvg({ svg: 'unused', color: '#fff', label: 'Native' }), null); Platform.OS = 'web';
});
test('SVG URL import reads bounded bytes, omits credentials and rejects oversized streams', async () => {
  const h = harness(), old = globalThis.fetch; let credentials = '', cancelled = false;
  try {
    const data = new TextEncoder().encode('<svg viewBox="0 0 24 24"><path d="M0 0L24 24" /></svg>');
    globalThis.fetch = (async (_url: unknown, options: any) => { credentials = options.credentials; let done = false; return { ok: true, url: 'https://example.test/icon.svg', headers: { get: () => null }, body: { getReader: () => ({ read: async () => done ? { done: true } : (done = true, { done: false, value: data }), cancel: async () => {} }) } }; }) as any;
    assert.ok((await fetchSvgUrl('https://example.test/icon.svg')).includes('<path')); assert.equal(credentials, 'omit');
    globalThis.fetch = (async () => ({ ok: true, headers: { get: () => null }, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(65537) }), cancel: async () => { cancelled = true; } }) } })) as any;
    await assert.rejects(fetchSvgUrl('https://example.test/big.svg'), /64 KB/); assert.equal(cancelled, true);
    await assert.rejects(fetchSvgUrl('javascript:alert(1)'));
  } finally { globalThis.fetch = old; h.close(); }
});

const { useWhiteboard } = require('../plugin/client/useWhiteboard');
const { DEFAULT_TOOL_STYLE } = require('../plugin/client/whiteboard-tools');
const { resizeWhiteboardBox, resizeLineBox, erasedStrokes } = require('../plugin/client/whiteboard-geometry');
const { layoutCanvas, moveOperations, selectionPack } = require('../plugin/client/logic');
const { builtinTypes, builtinTemplates, builtinPacks } = require('../plugin/shared/builtins');
const { reduce } = require('../plugin/server/reducer');
const { reset, updates } = require('./fixtures/react-headless');
function document() { return { id:'whiteboard',workspaceId:'workspace',revision:0,createdAt:'2026-10-06T00:00:00.000Z',updatedAt:'2026-10-06T00:00:00.000Z',title:'Whiteboard',description:'',example:false,communication:{instructions:'',intent:'',audience:''},blocks:[],groups:[],links:[],selectedIds:[] } as any; }
const catalog={revision:0,blockTypes:builtinTypes,templates:builtinTemplates,packs:builtinPacks};
const pointer=(x:number,y:number,shift=false)=>({x,y,shift,command:false,pointerId:1});
function toolHarness(tool='shape',style=DEFAULT_TOOL_STYLE) {
  reset();let doc=document(),currentTool=tool,reject=false;const transactions:any[]=[];
  const c:any={view:{document:doc},catalog,busy:false,offline:false,selection:[],select:async(ids:string[])=>{c.selection=ids;},fail:(e:unknown)=>{throw e;},edit:async(operations:any[],label:string)=>{transactions.push({operations,label});if(reject)return undefined;doc=reduce(doc,operations,catalog);c.view={document:doc};return c.view;}};
  const env:any={controller:c,get layout(){return layoutCanvas(doc,{},catalog);},world:(p:any)=>({x:p.x,y:p.y}),center:()=>({x:400,y:300}),scale:()=>1,tool:()=>currentTool,choose:(t:string)=>{currentTool=t;},style:()=>style,locked:()=>false,pan:()=>{}};
  const wb=useWhiteboard(env);return{wb,c,transactions,doc:()=>doc,tool:()=>currentTool,setTool:(t:string)=>{currentTool=t;},reject:()=>{reject=true;}};
}
test('creation hook commits one real shape transaction and aborts Escape/document/offline/busy gestures',async()=>{
  const h=toolHarness();assert.equal(h.wb.begin(pointer(100,100)),true);h.wb.move(pointer(280,220));assert.equal(h.transactions.length,0);await h.wb.finish(pointer(280,220),false);
  assert.equal(h.transactions.length,1);assert.equal(h.doc().blocks[0].typeId,'wb-shape');assert.deepEqual(h.doc().blocks[0].position,{x:100,y:100});assert.deepEqual(h.doc().blocks[0].size,{width:180,height:120});assert.equal(h.tool(),'select');
  for(const reason of ['cancel','document','offline','busy']){const q=toolHarness();q.wb.begin(pointer(10,10));q.wb.move(pointer(60,60));if(reason==='document')q.c.view={document:{...q.doc(),id:'another'}};if(reason==='offline')q.c.offline=true;if(reason==='busy')q.c.busy=true;await q.wb.finish(pointer(60,60),reason==='cancel');assert.equal(q.transactions.length,0);assert.equal(q.wb.store.current,null);}
});
test('draw sessions append complete strokes, scale old points correctly and eraser deletes crossed strokes in one transaction',async()=>{
  const h=toolHarness('draw');for(const y of [10,60]){h.wb.begin(pointer(10,y));for(let x=20;x<=120;x+=10)h.wb.move(pointer(x,y));await h.wb.finish(pointer(120,y),false);}
  assert.equal(h.transactions.length,2);assert.equal(h.doc().blocks.length,1);const block=h.doc().blocks[0];assert.equal(block.data.strokes.length,2);assert.equal(block.data.strokes[0].points.length,4);assert.deepEqual(block.size,{width:110,height:50});
  h.setTool('eraser');h.wb.begin(pointer(55,10));await h.wb.finish(pointer(55,10),false);assert.equal(h.transactions.length,3);assert.equal(h.doc().blocks[0].data.strokes.length,1);
  h.wb.begin(pointer(55,60));await h.wb.finish(pointer(55,60),false);assert.equal(h.transactions.length,4);assert.equal(h.doc().blocks.length,0);
});
test('SVG library insertion uses validated catalog data, visible center and parent-relative position',async()=>{
  const h=toolHarness('svg');const {SVG_LIBRARY}=require('../plugin/client/SvgLibrary');const entry=SVG_LIBRARY[0];assert.equal(await h.wb.insertSvg(entry.svg,{caption:entry.caption,source:entry.source,license:entry.license}),true);
  assert.equal(h.transactions.length,1);const b=h.doc().blocks[0];assert.deepEqual(b.position,{x:352,y:252});assert.deepEqual(b.size,{width:96,height:96});assert.equal(b.data.source,'tabler:server');assert.equal(b.data.license,'MIT · Tabler Icons');
  h.c.view.document.groups.push({id:'group',title:'Group',description:'',blockIds:[],groupIds:[],position:{x:700,y:50},layout:{mode:'stack'}});h.c.selection=['group'];assert.equal(await h.wb.insertSvg(entry.svg),true);const child=h.doc().blocks[1];assert.equal(child.parentGroupId,'group');assert.ok(child.position.x<700);assert.ok(child.position.y<100);
});
test('rejected gesture transaction discards preview and leaves the document unchanged',async()=>{
  const h=toolHarness();h.reject();h.wb.begin(pointer(10,10));h.wb.move(pointer(100,100));assert.ok(h.wb.store.current);await h.wb.finish(pointer(100,100),false);assert.equal(h.transactions.length,1);assert.equal(h.doc().blocks.length,0);assert.equal(h.wb.store.current,null);
});
test('text creation remains an unsaved draft until confirmation and cancellation has no transaction',async()=>{
  const h=toolHarness('text');h.wb.begin(pointer(50,60));await h.wb.finish(pointer(250,60),false);const draft=updates.find((v:any)=>v?.kind==='wb-text') as any;assert.equal(draft.block.typeId,'wb-text');assert.equal(draft.block.data.width,200);assert.equal(h.doc().blocks.length,0);assert.equal(h.transactions.length,0);h.wb.cancel();assert.equal(h.transactions.length,0);
});
test('whiteboard overlays preserve group-relative coordinates in every layout and never push ordinary cards',()=>{
  for(const mode of ['free','stack','grid','flow','graph']){const doc=document();doc.groups=[{id:'g',title:'Group',description:'',position:{x:500,y:200},blockIds:['card','shape','text'],groupIds:[],layout:{mode}}];doc.blocks=[{id:'card',typeId:'node',title:'Card',parentGroupId:'g',data:{}},{id:'shape',typeId:'wb-shape',title:'',parentGroupId:'g',position:{x:24,y:80},size:{width:300,height:160},data:{shape:'rect'}},{id:'text',typeId:'wb-text',title:'',parentGroupId:'g',position:{x:24,y:80},data:{text:'Annotation'}}];const layout=layoutCanvas(doc,{},catalog),baseline=layoutCanvas({...doc,blocks:doc.blocks.slice(0,1),groups:[{...doc.groups[0],blockIds:['card']}]},{},catalog),g=layout.rects.get('g');assert.deepEqual({x:layout.rects.get('shape').x-g.x,y:layout.rects.get('shape').y-g.y},{x:24,y:80},mode);assert.deepEqual({x:layout.rects.get('card').x-g.x,y:layout.rects.get('card').y-g.y},{x:baseline.rects.get('card').x-baseline.rects.get('g').x,y:baseline.rects.get('card').y-baseline.rects.get('g').y},mode);const moved=reduce(doc,moveOperations(doc,layout.rects,['shape'],{x:40,y:16},undefined,{catalog,grid:false}),catalog);assert.deepEqual(moved.blocks[1].position,{x:64,y:96},mode);const pack=selectionPack(doc,catalog,['g']);assert.equal(pack.documents[0].blocks.length,3);}
});
test('eight-handle resizing anchors opposite edges, preserves SVG proportions, and line endpoints cross safely',()=>{
  const start={x:100,y:80,width:160,height:104},minimum={width:24,height:24};assert.deepEqual(resizeWhiteboardBox(start,{x:40,y:20},'nw',minimum),{x:140,y:100,width:120,height:84});assert.deepEqual(resizeWhiteboardBox(start,{x:40,y:0},'e',minimum),{x:100,y:80,width:200,height:104});const svg=resizeWhiteboardBox(start,{x:80,y:0},'e',minimum,true);assert.ok(Math.abs(svg.width/svg.height-160/104)<.01);
  const line=resizeLineBox({x:0,y:0,width:100,height:100},{shape:'line',from:'nw'}, {x:200,y:0},'start');assert.equal(line.from,'ne');assert.deepEqual(line.position,{x:100,y:0});assert.deepEqual(line.size,{width:100,height:100});
  assert.deepEqual(erasedStrokes({extent:{width:10,height:10},strokes:[{points:[0,0,10,10],color:'tinta',weight:'m'}]},{x:50,y:50},{width:100,height:100},2),[0]);assert.deepEqual(erasedStrokes({extent:{width:10,height:10},strokes:[{points:[0,0,10,10],color:'tinta',weight:'m'}]},{x:50,y:10},{width:100,height:100},2),[]);
});

test('canvas shortcuts delegate to focused learning controls and deep interaction, but Space on background temporarily pans', () => {
  const { attachCanvasKeys } = require('../plugin/client/web');
  const h = harness(), keys: string[] = [], hand: boolean[] = [];
  const stop = attachCanvasKeys(h.node, (key: string) => { keys.push(key); return true; }, (active: boolean) => hand.push(active));
  const event = (key: string, kind: string) => ({ ...h.event(0, 0), key, target: { closest(selector: string) {
    return kind === 'learning' && selector.includes('lienzo-interactive-') || kind === 'deep' && selector.includes('lienzo-using-') || kind === 'editing' && selector.includes('input') ? this : null;
  } } });
  try {
    for (const kind of ['learning', 'deep', 'editing']) for (const key of [' ', 'v', 'h', 't', 'r', 'd', 'e', 'Enter']) {
      const e = event(key, kind); h.node.fire('keydown', e); h.doc.fire('keyup', e); assert.equal(e.prevented, false);
    }
    assert.deepEqual(keys, []); assert.deepEqual(hand, []);
    h.node.fire('keydown', event('t', 'background')); assert.deepEqual(keys, ['t']);
    h.node.fire('keydown', event(' ', 'background')); h.node.fire('keydown', event(' ', 'background')); h.doc.fire('keyup', event(' ', 'background'));
    assert.deepEqual(hand, [true, false]);
  } finally { stop(); h.close(); }
});
test('wheel pans and command zooms a passive frame shield, while active media and learning surfaces retain wheel control', () => {
  const { attachWheel } = require('../plugin/client/web'); const h = harness(), calls: any[] = [];
  (h.node as any).getBoundingClientRect = () => ({ left: 10, top: 20 });
  const stop = attachWheel(h.node, (e: any) => calls.push(e));
  const event = (kind: string, command = false) => ({ ...h.event(30, 50), ctrlKey: command, deltaX: 5, deltaY: 7, target: { closest(selector: string) {
    if (kind === 'surface' && selector.includes('lienzo-interactive-surface-')) return this;
    if (kind === 'active' && selector.includes('data-lienzo-interacting')) return this;
    if (kind.startsWith('legacy-') && selector === '[id^="lienzo-interactive-"]') return { id: `lienzo-interactive-${kind.slice(7)}-page` };
    if (kind === 'passive' && selector.includes('lienzo-interactive-')) return null;
    return null;
  } } });
  try {
    for (const kind of ['passive', 'legacy-frame', 'legacy-media', 'legacy-video']) { const e = event(kind); h.node.fire('wheel', e); assert.equal(e.prevented, true); }
    for (const kind of ['active', 'surface']) { const e = event(kind); h.node.fire('wheel', e); assert.equal(e.prevented, false); }
    h.node.fire('wheel', event('active', true)); assert.equal(calls.length, 5); assert.deepEqual(calls[0], { x: 20, y: 30, dx: 5, dy: 7, command: false }); assert.equal(calls[4].command, true);
  } finally { stop(); h.close(); }
});

test('eraser sweeps between sparse pointer events and keeps one transaction per completed gesture', async () => {
  const h = toolHarness('draw'); h.wb.begin(pointer(10, 60)); h.wb.move(pointer(120, 60)); await h.wb.finish(pointer(120, 60), false);
  h.setTool('eraser'); h.wb.begin(pointer(55, 0)); h.wb.move(pointer(55, 120)); await h.wb.finish(pointer(55, 120), false);
  assert.equal(h.transactions.length, 2); assert.equal(h.doc().blocks.length, 0);
});
test('automatic return to select never makes a fast repeated inactive tool click only toggle its lock', () => {
  const { readFileSync } = require('node:fs'), { runInNewContext } = require('node:vm'), ts = require('typescript');
  const { tokens } = require('../plugin/client/tokens'); let ref: any, now = 100;
  const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }), useRef: (initial: any) => ref ??= { current: initial } };
  const modules: Record<string, any> = { react, 'react-native': { Pressable: 'Pressable', View: 'View' }, '@getpaseo/plugin/client/react-native': { Icon: 'Icon', ScrollView: 'ScrollView' }, '../shared/whiteboard': require('../plugin/shared/whiteboard'), './tokens': { tokens }, './color': { withAlpha: () => '' }, './ui': { useUI: () => ({ c: {} }) }, './web': {}, './SvgLibrary': {}, './whiteboard-visuals': { islandStyle: () => ({}) } };
  const output = ts.transpileModule(readFileSync('plugin/client/FloatingTools.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const exports: any = {}; runInNewContext(output, { exports, require: (id: string) => modules[id], Date: { now: () => now } });
  const picked: string[] = [], locks: boolean[] = [];
  const press = (tool: string) => {
    const tree = exports.ToolIsland({ tool, onToolChange: (t: string) => picked.push(t), onLockChange: (lock: boolean) => locks.push(lock), onOpenShapes() {}, onOpenLibrary() {}, onOpenPicker() {}, width: 1200 });
    const children = tree.props.children.flat(Infinity); const text = children.find((node: any) => node?.props?.accessibilityLabel === 'Texto (T)'); assert.ok(text); text.props.onPress({ stopPropagation() {} }); now += 50;
  };
  press('select'); press('select'); assert.deepEqual(picked, ['text', 'text']); assert.deepEqual(locks, [false, false]);
  press('text'); assert.deepEqual(picked, ['text', 'text']); assert.deepEqual(locks, [false, false, true]);
});

test('library drag keeps short clicks, drops at page coordinates inside Canvas and cancels Escape/outside without insertion', () => {
  const { attachLibraryDrag } = require('../plugin/client/web'); const h = harness(), drops: any[] = [];
  (h.doc as any).getElementById = () => ({ getBoundingClientRect: () => ({ left: 100, top: 100, width: 500, height: 400 }) });
  const stop = attachLibraryDrag(h.node, { enabled: () => true, preview: () => undefined, drop: (id: string, page: any) => drops.push({ id, page }) });
  const event = (x: number, y: number) => ({ ...h.event(x, y), target: { closest: () => ({ id: 'lienzo-library-icon-server' }) } });
  try {
    const click = event(20, 30); h.node.fire('pointerdown', click); h.doc.fire('pointerup', click); assert.equal(click.prevented, false); assert.deepEqual(drops, []);
    h.node.fire('pointerdown', event(20, 30)); h.doc.fire('pointermove', event(220, 240)); h.doc.fire('pointerup', event(220, 240)); assert.deepEqual(drops, [{ id: 'server', page: { x: 220, y: 240 } }]);
    h.node.fire('pointerdown', event(20, 30)); h.doc.fire('pointermove', event(220, 240)); h.doc.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }); h.doc.fire('pointerup', event(220, 240)); assert.equal(drops.length, 1);
    h.node.fire('pointerdown', event(20, 30)); h.doc.fire('pointermove', event(800, 800)); h.doc.fire('pointerup', event(800, 800)); assert.equal(drops.length, 1);
  } finally { stop(); h.close(); }
});
test('SVG pointer placement converts through world adapter and chooses the actual group under release', async () => {
  const h = toolHarness('svg'), { SVG_LIBRARY } = require('../plugin/client/SvgLibrary');
  h.c.view.document.groups.push({id:'group',title:'Group',description:'',blockIds:[],groupIds:[],position:{x:700,y:50},layout:{mode:'stack'}});
  const frame = layoutCanvas(h.doc(), {}, catalog).rects.get('group'); const atPage = { x: frame.x + 80, y: frame.y + 80 };
  assert.equal(await h.wb.insertSvg(SVG_LIBRARY[0].svg, { atPage }), true);
  const b = h.doc().blocks[0]; assert.equal(b.parentGroupId, 'group'); assert.deepEqual(b.position, { x:32,y:32 });
});
test('automatic layout release preserves mandatory whiteboard positions alongside ordinary cards', () => {
  const { releaseOperations, pinnedChildren } = require('../plugin/client/logic'); const doc = document();
  doc.blocks = [{id:'shape',typeId:'wb-shape',title:'',position:{x:24,y:80},size:{width:160,height:104},data:{shape:'rect'}},{id:'card',typeId:'node',title:'Card',position:{x:400,y:80},data:{}}];
  assert.deepEqual(pinnedChildren(doc, null), ['card']); const operations = releaseOperations(doc, ['shape','card'], catalog);
  assert.ok(operations.length); assert.ok(operations.every((op: any) => op.id !== 'shape' && op.block?.id !== 'shape'));
  const released = reduce(doc,operations,catalog); assert.deepEqual(released.blocks.find((b: any) => b.id === 'shape').position,{x:24,y:80}); assert.equal(released.blocks.find((b: any) => b.id === 'card').position,undefined);
});

test('whiteboard annotations and their links do not change inferred automatic layout', () => {
  const { containerMode } = require('../plugin/client/logic'); const doc = document();
  doc.groups = [{ id:'g',title:'Group',description:'',blockIds:['a','b'],groupIds:[] }]; doc.blocks = ['a','b'].map(id => ({id,typeId:'node',title:id,parentGroupId:'g',data:{}}));
  const mode = containerMode(doc,'g',catalog), before = layoutCanvas(doc,{},catalog);
  doc.groups[0].blockIds.push('shape'); doc.blocks.push({id:'shape',typeId:'wb-shape',title:'',parentGroupId:'g',position:{x:30,y:80},size:{width:160,height:104},data:{shape:'rect'}}); doc.links.push({id:'annotation',from:'a',to:'shape',kind:'reference',label:''});
  assert.equal(containerMode(doc,'g',catalog),mode); const after = layoutCanvas(doc,{},catalog);
  for (const id of ['a','b']) { const a=before.rects.get(id),b=after.rects.get(id); assert.deepEqual({x:a.x,y:a.y},{x:b.x,y:b.y}); }
});

test('Canvas imperative editSelection routes whiteboard editing and deep card interaction without requiring canvas focus', () => {
  const { readFileSync } = require('node:fs'), { runInNewContext } = require('node:vm'), ts = require('typescript');
  const { tokens } = require('../plugin/client/tokens'), logic = require('../plugin/client/logic'), wb = require('../plugin/shared/whiteboard');
  const edits: string[] = [], interaction: (string|null)[] = []; let api: any, cursor=0; const hooks:any[]=[];
  class Value { value: number; constructor(v: number) { this.value=v; } addListener() {return 'listener';} removeListener() {} removeAllListeners() {} stopAnimation() {} setValue(v:number){this.value=v;} interpolate(){return this;} }
  const react = { createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),memo:(fn:any)=>fn,useRef:(current:any)=>hooks[cursor++]??={current},useState:(initial:any)=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return[hooks[i],(next:any)=>hooks[i]=typeof next==='function'?next(hooks[i]):next];},useMemo:(fn:any)=>fn(),useCallback:(fn:any)=>fn,useEffect:()=>{},useLayoutEffect:()=>{},useImperativeHandle:(_ref:any,fn:any)=>{api=fn();} };
  const doc=document(); doc.blocks=[{id:'text',typeId:'wb-text',title:'',position:{x:40,y:60},data:{text:'Hello'}},{id:'frame',typeId:'preview',title:'Frame',data:{url:'https://example.test'}}];
  const c:any={view:{document:doc},selection:['frame'],catalog,events:[],pendingIds:[],learning:{getSnapshot:()=>({})}};
  const modules:Record<string,any>={
    react,'react-native':{Animated:{Value,View:'Animated.View',add:()=>0,subtract:()=>0,multiply:()=>0,divide:()=>1},PanResponder:{create:(handlers:any)=>({panHandlers:handlers})},Pressable:'Pressable',View:'View'},'@getpaseo/plugin/client/react-native':{},
    './SelectionOverlay': {}, './ZoomControl':{ZoomControl:()=>null},'./logic':logic,'./tokens':{tokens},'./color':{isDark:()=>false,withAlpha:()=>''},'./Blocks':{},'./usePresentation':{usePresentation:()=>undefined},'./link-motion':{prepareLinkMotion:()=>undefined},'./renderers':{},'./Links':{},'./MagnetCue':{},'./ui':{useUI:()=>({layout:{platform:'web'},c:{surface0:'#fff'},font:()=>({})})},'./web':{},
    './motion':{NATIVE:false,reducedMotion:{current:true},useReducedMotion:()=>{}},'./whiteboard-tools':{DEFAULT_TOOL_STYLE},'../shared/whiteboard':wb,'./useWhiteboard':{useWhiteboard:()=>({editor:null,store:{},edit:(id:string)=>edits.push(id)})},'./WhiteboardContent':{},'./WhiteboardOverlay':{},'./interaction':require('../plugin/client/interaction'),'./whiteboard-geometry':require('../plugin/client/whiteboard-geometry'),'./whiteboard-visuals':{islandStyle:()=>({})},
  };
  const output=ts.transpileModule(readFileSync('plugin/client/Canvas.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const exports:any={};runInNewContext(output,{exports,require:(id:string)=>{assert.ok(id in modules,id);return modules[id];},Date,Map,Set});
  const render=()=>{cursor=0;return exports.Canvas({selectionToolbar:'ToolbarMarker',controller:c,mode:'canvas',onInspect(){},onPacks(){},reorder(){},onGeometry(){},linkId:null,onLink(){},onInteractionChange:(id:string|null)=>interaction.push(id)});};
  const content=(node:any):any[]=>Array.isArray(node)?node.flatMap(content):node?.props?content(node.props.children):[node];
  assert.ok(content(render()).includes('ToolbarMarker'));
  api.editSelection();assert.equal(api.interactionId(),'frame');assert.deepEqual(interaction,['frame']);assert.deepEqual(edits,[]);assert.equal(content(render()).includes('ToolbarMarker'),false);
  api.endInteraction();assert.equal(api.interactionId(),null);assert.ok(content(render()).includes('ToolbarMarker'));c.selection=['text'];api.editSelection();assert.deepEqual(edits,['text']);assert.equal(api.interactionId(),null);
});

test('real Txt suppresses native text dragging only in passive cards and restores selection after interaction or leaving the card', () => {
  const { readFileSync } = require('node:fs'), { runInNewContext } = require('node:vm'), ts = require('typescript');
  const { tokens } = require('../plugin/client/tokens');
  const values = new Map<any, any>(); let contextReads = 0;
  const react: any = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, ...(children.length ? {children: children.length === 1 ? children[0] : children} : {}) } }),
    createContext(initial: any) {
      const context: any = { initial }; context.Provider = ({ value, children }: any) => {
        const had = values.has(context), previous = values.get(context); values.set(context, value);
        try { return mount(children); } finally { if (had) values.set(context, previous); else values.delete(context); }
      }; return context;
    },
    useContext: (context: any) => { contextReads++; return values.has(context) ? values.get(context) : context.initial; },
    useMemo: (get: any) => get(),
  };
  function mount(tree: any): any {
    if (Array.isArray(tree)) return tree.map(mount);
    if (!tree?.props) return tree;
    if (typeof tree.type === 'function') return mount(tree.type(tree.props));
    return tree;
  }
  const modules: Record<string, any> = { react, 'react-native': { Text:'NativeText', Platform:{OS:'web',select:(value:any)=>value.default} }, '@getpaseo/plugin/client/react-native': { Modal:Object.assign(()=>null,{Content:()=>null}) }, './tokens':{tokens}, './color':{withAlpha:()=>''}, './web':{}, './motion':{useReducedMotion(){}} };
  function load(name: string) {
    const output = ts.transpileModule(readFileSync(`plugin/client/${name}`, 'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true} }).outputText;
    const exports:any={};runInNewContext(output,{exports,require:(id:string)=>{assert.ok(id in modules,id);return modules[id];}});return exports;
  }
  const interaction = modules['./interaction'] = load('interaction.ts'), ui = load('ui.tsx');
  const render = (scope: boolean | null, selectable: boolean | undefined = true) => {
    const before = contextReads;
    let text = react.createElement(ui.Txt, { selectable, style:{userSelect:'text'}, children:'Contenido de la nota', accessibilityLabel:'Note text' });
    if (scope !== null) text = react.createElement(interaction.ContentInteractionProvider, { value:scope }, text);
    const rendered = mount(react.createElement(ui.UIProvider, {theme:{colors:{foreground:'#111',foregroundMuted:'#777',accent:'#36a'}},layout:{compact:false},host:{id:'test'}},text));
    assert.equal(contextReads-before,2); return rendered;
  };
  const passive = render(false); assert.equal(passive.type,'NativeText'); assert.equal(passive.props.selectable,false); assert.equal(passive.props.children,'Contenido de la nota');
  const flatStyle = (text:any) => Object.assign({},...text.props.style.filter(Boolean)); assert.equal(flatStyle(passive).userSelect,'none');
  const active = render(true); assert.equal(active.props.selectable,true); assert.equal(flatStyle(active).userSelect,'text');
  assert.equal(render(false).props.selectable,false); // Leaving interaction restores move mode on the same card.
  for (const outside of ['outline','JSON dialog','inspector']) { const text=render(null);assert.equal(text.props.selectable,true,outside);assert.equal(flatStyle(text).userSelect,'text',outside); }
  assert.equal(render(null,false).props.selectable,false);assert.equal(render(true,false).props.selectable,false);
  assert.equal(interaction.useContentInteraction(),false); assert.equal(interaction.useContentSelectionAllowed(),true);
});

test('ToolIsland grid contract keeps all eight actions in 4x2 geometry and preserves callbacks and locking', () => {
  const { readFileSync } = require('node:fs'), { runInNewContext } = require('node:vm'), ts = require('typescript'), { tokens } = require('../plugin/client/tokens');
  let cursor=0;const slots:any[]=[],calls:string[]=[];
  const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),useRef:(value:any)=>slots[cursor++]??=( {current:value} )};
  const modules:Record<string,any>={react,'react-native':{Pressable:'Pressable',View:'View'},'@getpaseo/plugin/client/react-native':{Icon:'Icon',ScrollView:'ScrollView'},'../shared/whiteboard':require('../plugin/shared/whiteboard'),'./tokens':{tokens},'./color':{withAlpha:()=>''},'./ui':{useUI:()=>({c:{}})},'./web':{},'./SvgLibrary':{},'./whiteboard-visuals':{islandStyle:()=>({})}};
  const exports:any={},output=ts.transpileModule(readFileSync('plugin/client/FloatingTools.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  runInNewContext(output,{exports,require:(id:string)=>modules[id],Date:{now:()=>100}});
  const render=(tool='select',disabled=false)=>{cursor=0;return exports.ToolIsland({tool,grid:true,width:320,disabled,onToolChange:(t:string)=>calls.push(t),onLockChange:(v:boolean)=>calls.push(`lock:${v}`),onOpenShapes:()=>calls.push('shapes'),onOpenLibrary:()=>calls.push('library'),onOpenPicker:()=>calls.push('picker')});};
  let tree=render();assert.equal(tree.props.style.width,200);assert.equal(tree.props.style.flexWrap,'wrap');assert.equal(tree.props.style.gap,8);
  const buttons=tree.props.children.flat(Infinity);assert.equal(buttons.length,8);assert.ok(buttons.every((b:any)=>b.type==='Pressable'));
  assert.deepEqual(Array.from(buttons,(b:any)=>b.props.accessibilityLabel),['Seleccionar (V)','Mano (H)','Texto (T)','Forma (R)','Lápiz (D)','Goma (E)','Biblioteca','Añadir bloque']);
  for(const button of buttons){const style=button.props.style({pressed:false});assert.equal(style.width,44);assert.equal(style.height,44);}
  const press=(b:any)=>b.props.onPress({stopPropagation(){}});press(buttons[3]);assert.deepEqual(calls,['lock:false','shape']);
  tree=render('shape');press(tree.props.children.flat(Infinity)[3]);assert.equal(calls.at(-1),'lock:true');
  press(buttons[6]);press(buttons[7]);assert.deepEqual(calls.slice(-2),['library','picker']);
  const disabled=render('select',true).props.children.flat(Infinity);assert.deepEqual(Array.from(disabled,(b:any)=>b.props.disabled),[false,false,true,true,true,true,true,true]);
});

test('narrow ZoomControl keeps only the percent trigger and exposes functional fit and zoom actions in its menu', () => {
  const { readFileSync } = require('node:fs'), { runInNewContext } = require('node:vm'), ts = require('typescript'), { tokens } = require('../plugin/client/tokens');
  let cursor=0;const slots:any[]=[],calls:any[]=[];
  const react={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),useState:(initial:any)=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],(value:any)=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef:(value:any)=>slots[cursor++]??={current:value},useEffect(){}};
  const modules:Record<string,any>={react,'react-native':{Pressable:'Pressable',View:'View'},'@getpaseo/plugin/client/react-native':{Icon:'Icon'},'./ui':{IconButton:'IconButton',Txt:'Txt',useUI:()=>({compact:false,c:{}})},'./tokens':{tokens},'./color':{withAlpha:()=>''},'./whiteboard-visuals':{islandStyle:()=>({})},'./web':{}};
  const exports:any={},output=ts.transpileModule(readFileSync('plugin/client/ZoomControl.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  runInNewContext(output,{exports,require:(id:string)=>modules[id]});
  const render=(width:number)=>{cursor=0;return exports.ZoomControl({width,camera:{current:{scale:1}},subscribe:()=>()=>{},onStep:(d:number)=>calls.push(d),onFit:()=>calls.push('fit'),onReset:()=>calls.push('reset')});};
  const nodes=(tree:any):any[]=>Array.isArray(tree)?tree.flatMap(nodes):!tree?.props?[]:[tree,...nodes(tree.props.children)];
  for(const width of [560,760,879]){const tree=render(width);assert.equal(nodes(tree).filter(n=>n.type==='IconButton').length,0);assert.equal(nodes(tree).filter(n=>n.props.accessibilityLabel==='Opciones de zoom').length,1);}
  let tree=render(760);nodes(tree).find(n=>n.props.accessibilityLabel==='Opciones de zoom').props.onPress();tree=render(760);
  const actions=nodes(tree).filter(n=>n.props.accessibilityRole==='menuitem');assert.deepEqual(actions.map(n=>n.props.accessibilityLabel),['Acercar','Alejar','Ajustar al lienzo','Tamaño real 100 %']);
  for(const action of actions)action.props.onPress({stopPropagation(){}});assert.deepEqual(calls,[1,-1,'fit','reset']);assert.equal(nodes(render(760)).some(n=>n.props.accessibilityRole==='menu'),false);
  assert.equal(nodes(render(880)).filter(n=>n.type==='IconButton').length,3);
});

test('zoom menu delegates inside clicks, dismisses outside/Escape, and supports focused keyboard navigation', () => {
  const { attachZoomMenu } = require('../plugin/client/web');const h=harness();let closed=0,focused='',triggerFocus=0;
  const rows=['Acercar','Alejar','Ajustar al lienzo'].map(label=>({getAttribute:(name:string)=>name==='aria-label'?label:null,focus:()=>{focused=label;}}));
  const node:any=new Events();node.contains=(target:any)=>rows.includes(target);node.querySelectorAll=()=>rows;
  const trigger:any={contains:(target:any)=>target===trigger,focus:()=>{triggerFocus++;}};
  const stop=attachZoomMenu(node,trigger,()=>closed++);
  try {
    assert.equal(focused,'Acercar');h.doc.fire('pointerdown',{target:rows[1]});assert.equal(closed,0);
    const key=(key:string,target=rows[0])=>({key,target,ctrlKey:false,metaKey:false,preventDefault(){},stopPropagation(){}});
    h.doc.fire('keydown',key('ArrowDown'));assert.equal(focused,'Alejar');h.doc.fire('keydown',key('End'));assert.equal(focused,'Ajustar al lienzo');
    h.doc.fire('keydown',key('Escape'));assert.equal(closed,1);assert.equal(triggerFocus,1);h.doc.fire('pointerdown',{target:{}});assert.equal(closed,2);
  }finally{stop();h.close();}
});
