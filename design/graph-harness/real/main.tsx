// The REAL Lienzo canvas (plugin/client/Canvas.tsx, Blocks.tsx, Links.tsx, motion.tsx, logic.ts, web.ts, tokens.ts)
// mounted under react-native-web, with a stand-in controller whose `edit` runs the REAL schema parser and reducer
// (plugin/shared/model.ts, plugin/server/reducer.ts) after a short delay, like an RPC. What is NOT real here: the Paseo
// host (its icons, modal, toast, theme object), the RPC transport, polling and the panel chrome. Example data only.
import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Pressable, Text, View } from 'react-native';
import { builtinPacks, builtinTemplates, builtinTypes } from '../../../plugin/shared/builtins';
import { mutateInputSchema, type CanvasCatalog, type CanvasDocument, type CanvasOperation } from '../../../plugin/shared/model';
import { reduce } from '../../../plugin/server/reducer';
import { Canvas, type CanvasApi } from '../../../plugin/client/Canvas';
import { UIProvider } from '../../../plugin/client/ui';
import { pinnedChildren, releaseOperations, reuseDocumentEntities } from '../../../plugin/client/logic';
import { tokens } from '../../../plugin/client/tokens';
import { reducedMotion } from '../../../plugin/client/motion';
import { Onboarding } from '../../../plugin/client/Onboarding';
import { dismissGuide, guideWasDismissed } from '../../../plugin/client/web';
import { setMockModalColors } from './host-rn';
import { learningFixture } from './learning-fixtures';
import { LearningRuntimeStore } from '../../../plugin/client/learning-state';
import { cleanRuntime, type RuntimeState } from '../../../plugin/shared/learning';
import { runtimeSetInputSchema, runtimeOutputSchema } from '../../../plugin/shared/rpc';
declare const document: any, location: any, window: any;
const params = new URLSearchParams(location.search), dark = params.get('theme') !== 'papel';
const palette = tokens.contributedThemes[dark ? 'lienzo-tinta' : 'lienzo-papel'].colors, status = tokens.mockOnly[dark ? 'dark' : 'light'];
const theme = { colors: { surface0: palette.background, surface1: palette.raised, surface2: palette.control, border: palette.border, foreground: palette.foreground, foregroundMuted: palette.mutedForeground, accent: palette.accent, accentForeground: status.onAccent, statusSuccess: status.success, statusWarning: status.warning, statusDanger: status.danger } };
setMockModalColors(theme.colors);
const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, templates: builtinTemplates, packs: builtinPacks };
const base = { id: 'harness', workspaceId: 'w', revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', selectedIds: [], example: true, description: '', communication: { intent: '', audience: '', instructions: '' } };
const n = (id: string, title: string, parentGroupId?: string, kind = 'MODULE', st = 'ready', summary = '') => ({ id, typeId: 'node', title, data: { kind, status: st, ...(summary ? { summary } : {}) }, ...(parentGroupId ? { parentGroupId } : {}) });
const note = (id: string, title: string, parentGroupId?: string) => ({ id, typeId: 'note', title, data: { text: 'Nota de ejemplo para el arnés.' }, ...(parentGroupId ? { parentGroupId } : {}) });
const l = (from: string, to: string, kind: 'flow' | 'depends' | 'reference' = 'flow', label?: string) => ({ id: `${from}-${to}-${kind}`, from, to, kind, ...(label ? { label } : {}) });
const reference = (): CanvasDocument => ({ ...base, title: 'Sesión de cuenta (datos de ejemplo)',
  links: [l('inspect', 'host', 'depends'), l('host', 'session', 'depends'), l('host', 'profiles', 'depends'), l('session', 'convex', 'depends'), l('session', 'custody', 'flow', 'guarda tokens'), l('session', 'clerk', 'depends'), l('recovery', 'clerk'), l('convex', 'runtime'), l('custody', 'runtime'), l('clerk', 'runtime')],
  groups: [{ id: 'inside', title: 'Dentro de la sesión', description: '', blockIds: ['inspect', 'recovery', 'host', 'session', 'profiles', 'convex', 'custody', 'clerk'], groupIds: [] }, { id: 'notes', title: 'Notas (pila)', description: '', blockIds: ['n1', 'n2', 'n3'], groupIds: [], layout: { mode: 'stack' } }, { id: 'empty', title: 'Vacío', description: '', blockIds: [], groupIds: [] }],
  blocks: [n('inspect', 'Inspección de cuenta', 'inside'), n('recovery', 'Recuperación', 'inside', 'MODULE', 'draft'), n('host', 'Composición del host', 'inside'), n('session', 'Sesión de cuenta', 'inside', 'MODULE', 'ready', 'Mantiene la sesión viva y renueva credenciales.'), n('profiles', 'Perfiles locales', 'inside', 'MODULE', 'blocked'), n('convex', 'Cliente Convex', 'inside'), n('custody', 'Custodia de credenciales', 'inside'), n('clerk', 'Acceso con Clerk', 'inside', 'MODULE', 'review'), n('runtime', 'Runtime', undefined, 'OUTSIDE'), note('n1', 'Primera nota', 'notes'), note('n2', 'Segunda nota', 'notes'), note('n3', 'Tercera nota', 'notes')] });
const many = (): CanvasDocument => { const groups = Array.from({ length: 6 }, (_, g) => `g${g}`), ids = (g: number) => Array.from({ length: 25 }, (_, i) => `g${g}n${i}`);
  return { ...base, title: '150 nodos (datos de ejemplo)', groups: groups.map((id, g) => ({ id, title: `Área ${g + 1}`, description: '', blockIds: ids(g), groupIds: [] })), blocks: groups.flatMap((id, g) => ids(g).map((nid, i) => n(nid, `Nodo ${g + 1}.${i + 1}`, id))),
    links: groups.flatMap((_, g) => ids(g).flatMap((nid, i) => [...(i ? [l(ids(g)[Math.floor((i - 1) / 3)], nid)] : []), ...(i === 24 && g < 5 ? [l(nid, `g${g + 1}n0`, 'depends')] : [])])) }; };
const interactive = (): CanvasDocument => ({ ...base, title: 'Medios interactivos (datos de ejemplo)', layout: { mode: 'free' }, groups: [], links: [], blocks: [
  { id: 'image', title: 'Imagen de ejemplo', typeId: 'media', data: { url: 'http://127.0.0.1:8765/image-fixture.svg', mediaKind: 'image', caption: 'Imagen de prueba. Pulsa para ampliarla.' }, position: { x: 0, y: 0 }, size: { width: 320, height: 360 } },
  { id: 'video', title: 'Video de ejemplo', typeId: 'media', data: { url: 'http://127.0.0.1:8765/clip.mp4', mediaKind: 'video', caption: 'Video sintético para comprobar controles.' }, position: { x: 352, y: 0 }, size: { width: 320, height: 360 } },
  { id: 'web', title: 'Web de ejemplo', typeId: 'preview', data: { url: 'http://127.0.0.1:8766/web-fixture.html', description: 'Formulario y scroll de prueba, en otro origen del box.' }, position: { x: 704, y: 0 }, size: { width: 592, height: 440 } },
  { id: 'youtube', title: 'YouTube de ejemplo', typeId: 'media', data: { url: 'https://youtu.be/M7lc1UVf-VE?t=42', mediaKind: 'video' }, position: { x: 0, y: 480 }, size: { width: 320, height: 360 } },
  { id: 'vimeo', title: 'Vimeo de ejemplo', typeId: 'media', data: { url: 'https://vimeo.com/76979871', mediaKind: 'video' }, position: { x: 352, y: 480 }, size: { width: 320, height: 360 } },
  { id: 'audio', title: 'Audio de ejemplo', typeId: 'media', data: { url: 'http://127.0.0.1:8765/audio.wav', mediaKind: 'audio' }, position: { x: 704, y: 480 }, size: { width: 320, height: 240 } },
] });
const initial = params.has('lesson') ? learningFixture(reference(), params.get('lesson')!) : params.get('doc') === 'many' ? many() : params.get('doc') === 'interactive' ? interactive() : reference();
function App() {
  const [doc, setDoc] = useState<CanvasDocument>(initial), [selection, setSelection] = useState<string[]>([]), [busy, setBusy] = useState(false), [last, setLast] = useState('—'), [fail, setFail] = useState(false);
  const guideScope = 'harness-only', [guide, setGuide] = useState(params.has('guide') || params.has('first-visit') && !guideWasDismissed(guideScope));
  const current = useRef<any>(null), api = useRef<CanvasApi>(null), log = useRef<{ label: string; operations: CanvasOperation[] }[]>([]), failNext = useRef(false), writes = useRef<Promise<unknown>>(Promise.resolve());
  const runtimeServer = useRef<RuntimeState>({ blocks: {}, scopes: {} }), runtimeVersion = useRef(0);
  const runtimeLog = useRef<any[]>([]), events = useRef<any[]>([]);
  const learningRef = useRef<LearningRuntimeStore | null>(null);
  if (!learningRef.current) {
    learningRef.current = new LearningRuntimeStore(async raw => {
      const request = runtimeSetInputSchema.parse(raw), destination = current.current.document;
      const previousRuntime = structuredClone(runtimeServer.current), previousVersion = runtimeVersion.current;
      await new Promise(resolve => setTimeout(resolve, Number(params.get('runtimeLatency') ?? 60)));
      if (current.current.document.id !== destination.id) return runtimeOutputSchema.parse({ runtime: previousRuntime, runtimeVersion: previousVersion });
      const runtime = structuredClone(runtimeServer.current);
      for (const entry of request.blocks) {
        if (!current.current.document.blocks.some((b: any) => b.id === entry.id)) throw new Error('Missing block');
        if (entry.state === null) delete runtime.blocks[entry.id]; else runtime.blocks[entry.id] = entry.state;
      }
      for (const entry of request.scopes) {
        const declarations = entry.id === '$document' ? current.current.document.variables : current.current.document.groups.find((g: any) => g.id === entry.id)?.variables;
        const values = runtime.scopes[entry.id] ??= {};
        for (const [name, value] of Object.entries(entry.values)) {
          const declaration = declarations?.find((v: any) => v.name === name);
          if (!declaration || value !== null && (value < declaration.min || value > declaration.max)) throw new Error('Invalid scope value');
          if (value === null) delete values[name]; else values[name] = value;
        }
      }
      cleanRuntime(current.current.document, runtime);
      if (JSON.stringify(runtime) !== JSON.stringify(runtimeServer.current)) runtimeVersion.current++;
      runtimeServer.current = runtime; runtimeLog.current.push(request);
      return runtimeOutputSchema.parse({ runtime, runtimeVersion: runtimeVersion.current });
    }, error => setLast(`ERROR runtime: ${String(error)}`));
    learningRef.current.sync(initial, 0, runtimeServer.current);
  }
  const learning = learningRef.current;
  const view = useMemo(() => ({ document: doc, connection: null, canUndo: false, canRedo: false, selectionVersion: 0, runtimeVersion: 0 }), [doc]); current.current = view;
  const commit = async (operations: CanvasOperation[], label: string) => {
    setBusy(true); await new Promise(resolve => setTimeout(resolve, Number(params.get('latency') ?? 60)));
    try {
      if (failNext.current) { failNext.current = false; setFail(false); setLast(`RECHAZADO (simulado): ${label}`); return undefined; }
      const parsed = mutateInputSchema.parse({ workspaceId: 'w', documentId: 'harness', expectedRevision: current.current.document.revision, operations, label });
      const next = reuseDocumentEntities(current.current.document, { ...reduce(current.current.document, parsed.operations, catalog), revision: current.current.document.revision + 1 });
      const result = { ...current.current, document: next }; current.current = result;
      learning.sync(next, runtimeVersion.current, runtimeServer.current); log.current.push({ label, operations }); setLast(`REV ${next.revision} · ${label} · ${operations.length} op`); setDoc(next); return result;
    } catch (error) { setLast(`ERROR: ${String(error)}`); return undefined; } finally { setBusy(false); }
  };
  // Match useCanvas.edit's serialization; the failure and latency are simulated, not a live RPC.
  const edit = (operations: CanvasOperation[], label: string) => { const result = writes.current.then(() => commit(operations, label)); writes.current = result; return result; };
  const controller: any = { learning, view, current, catalog, selection, select: async (ids: string[]) => setSelection([...new Set(ids)]), edit, offline: false, busy, pendingIds: [], failure: null, events: [], workspaceId: 'w', api: {}, task: async () => undefined, setEvents: () => {}, send: async (action: any, eventId: string) => { events.current.push({ action, eventId, simulated: true }); await new Promise(resolve => setTimeout(resolve, Number(params.get('sendLatency') ?? 0))); return current.current; }, settle: async () => {}, fail: () => {}, clearFailure: () => {} };
  const release = (ids: string[]) => { const operations = releaseOperations(current.current.document, ids, catalog); if (operations.length) void edit(operations, ids.length === 1 ? 'Soltar posición' : 'Reordenar automáticamente'); };
  window.__lienzo = {
    // Simulated remote changes exercise production subscription/reset paths, not host RPC.
    resetRuntime: (blockId: string) => { delete runtimeServer.current.blocks[blockId]; learning.sync(current.current.document, ++runtimeVersion.current, structuredClone(runtimeServer.current)); },
    switchExample: () => { const next = { ...learningFixture(initial, 'prediction'), id: 'second-example' }; runtimeServer.current = { blocks: {}, scopes: {} }; current.current = { ...current.current, document: next }; learning.sync(next, 0, runtimeServer.current); runtimeVersion.current = 0; setDoc(next); },
    runtime: () => learning.getSnapshot(), runtimeServer: () => runtimeServer.current, runtimeLog: runtimeLog.current, events: events.current, flushRuntime: () => learning.flush(), doc: () => current.current.document, log: log.current, selection, reducedMotion: () => reducedMotion.current, fit: () => api.current?.fit(), edit };
  const button = (label: string, onPress: () => void) => <Pressable accessibilityLabel={label} onPress={onPress} style={{ paddingHorizontal: 8, height: 24, justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6 }}><Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{label}</Text></Pressable>;
  return <View style={{ position: 'absolute', inset: 0, backgroundColor: theme.colors.surface0 }}>
      <View style={{ height: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>ARNÉS · componentes RN reales · datos de ejemplo</Text>
        {button('Ajustar', () => api.current?.fit())}{button('A selección', () => api.current?.zoomToSelection())}{button('Reordenar raíz', () => release(pinnedChildren(current.current.document, null)))}{button('Soltar selección', () => release(selection))}{button('Tamaño automático', () => { if (selection.length) void edit(selection.map(id => ({ type: 'block.update', id, patch: { size: null } })), 'Tamaño automático'); })}{button('Guía de Lienzo', () => setGuide(true))}{button(fail ? 'Fallará el próximo' : 'Fallar próximo guardado', () => { failNext.current = true; setFail(true); })}
        <Text nativeID="last" style={{ color: theme.colors.foreground, fontSize: 12, flex: 1 }} numberOfLines={1}>{last}</Text>
      </View>
      <View style={{ flex: 1 }}><Canvas key={doc.id} api={api} onRelease={release} controller={controller} mode={params.has('compact') ? 'outline' : 'canvas'} linkId={null} onLink={() => {}} onInspect={() => {}} onPacks={() => {}} reorder={() => {}} onGeometry={() => {}} /></View>
      <Onboarding open={guide} close={() => { dismissGuide(guideScope); setGuide(false); }} catalog={catalog} onAction={action => setLast(`Guía: ${action}`)} />
    </View>;
}
document.body.style.cssText = 'margin:0;overflow:hidden'; const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;display:flex'; document.body.appendChild(host);
// Match LienzoPanel: host context wraps the stateful panel, so a saved edit does not publish a new theme/layout context.
createRoot(host).render(<UIProvider theme={theme as any} layout={{ compact: params.has('compact'), platform: 'web' } as any} host={{ id: 'harness' } as any}><App /></UIProvider>);
// ?perf=1: frame times of the last second, written straight to the page so a screenshot taken mid-drag can read them.
if (params.get('perf')) {
  const meter = document.createElement('div'); meter.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9;font:12px ui-monospace,monospace;padding:4px 8px;border-radius:6px;background:#000;color:#fff'; document.body.appendChild(meter);
  let last = performance.now(), frames: number[] = [], recorded: number[] = [], recording = false;
  const sample = () => { const sorted = [...recorded].sort((a, b) => a - b); return sorted.length ? { frames: sorted.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted[sorted.length - 1] } : null; };
  window.__lienzoPerf = { start: () => { recorded = []; recording = true; }, stop: () => { recording = false; return sample(); } };
  const tick = (now: number) => { const dt = now - last; frames.push(dt); if (recording) recorded.push(dt); last = now; if (frames.length > 60) frames.shift(); const sorted = [...frames].sort((a, b) => a - b); meter.textContent = `frame ms · mediana ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} · p95 ${sorted[Math.floor(sorted.length * .95)].toFixed(1)} · máx ${sorted[sorted.length - 1].toFixed(1)}`; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
