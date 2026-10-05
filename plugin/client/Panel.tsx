import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';
import { type PluginWorkspacePanelProps, useAgent } from '@getpaseo/plugin/client';
import { Icon, ScrollView, copyText, useToast } from '@getpaseo/plugin/client/react-native';
import type { BlockType, CanvasGroup, CanvasOperation, CanvasPack } from '../shared/model';
import { useCanvas, type CanvasController } from './useCanvas';
import { Button, Chip, IconButton, Input, Modal, Segments, Txt, UIProvider, useUI } from './ui';
import { Canvas } from './Canvas';
import { Catalog, PackExport, PackImport } from './Catalog';
import { Inspector } from './Inspector';
import { AgentModal } from './AgentModal';
import { Delivery } from './Blocks';
import { documentContent, layoutDocument, moveOperations, newId, selectionPack, snap, topSelection, type Point, type Rect } from './logic';
import { focusInput, keyboard } from './web';
import { tokens } from './tokens';
import { withAlpha } from './color';

type CatalogTab = 'types' | 'templates' | 'packs';
type InspectorSection = 'document' | 'communication' | 'history' | 'activity';

function EmptyState({ title, description, error, children }: { title: string; description?: string; error?: string; children: React.ReactNode }) {
  const u = useUI();
  return <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
    <View style={{ width: '100%', maxWidth: tokens.size.emptyStateMaxWidth, gap: 12, alignItems: 'center' }}>
      <View style={{ width: 56, height: 56, borderRadius: tokens.radius.group, backgroundColor: u.wash(error ? 'riesgo' : 'acento'), alignItems: 'center', justifyContent: 'center' }}><Icon name={error ? 'CircleAlert' : 'Frame'} size={24} color={error ? u.c.statusDanger : u.c.accent} /></View>
      <Txt kind="display" style={{ textAlign: 'center' }}>{title}</Txt>
      {description && <Txt muted style={{ textAlign: 'center' }}>{description}</Txt>}
      {error && <View style={{ alignSelf: 'stretch', backgroundColor: u.c.surface2, borderRadius: 6, padding: 10 }}><Txt kind="code" selectable numberOfLines={4}>{error}</Txt></View>}
      {children}
    </View>
  </ScrollView>;
}

function Banner({ title, message, icon, color, children }: { title: string; message: string; icon: string; color: string; children: React.ReactNode }) {
  const u = useUI();
  return <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: u.c.surface1, borderWidth: 1.5, borderColor: color, borderRadius: tokens.radius.block, padding: 12, gap: 8 }}>
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><View style={{ width: 16 }}><Icon name={icon} size={16} color={color} /></View><Txt kind="bodyStrong" style={{ flex: 1 }}>{title}</Txt></View>
    <Txt kind="small" muted>{message}</Txt>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
  </View>;
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  return minutes < 1 ? 'ahora' : minutes < 60 ? 'hace ' + minutes + ' min' : minutes < 1440 ? 'hace ' + Math.floor(minutes / 60) + ' h' : 'hace ' + Math.floor(minutes / 1440) + ' d';
}

function LoadingDocument() {
  const u = useUI(), opacity = useRef(new Animated.Value(1)).current, [slow, setSlow] = useState(false);
  useEffect(() => {
    let live = true, pulse: Animated.CompositeAnimation | undefined;
    const animate = (reduced: boolean) => {
      pulse?.stop(); opacity.setValue(1);
      if (!reduced && live) {
        pulse = Animated.loop(Animated.sequence([Animated.timing(opacity, { toValue: .5, duration: 900, useNativeDriver: true }), Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true })]));
        pulse.start();
      }
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(animate).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', animate);
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => { live = false; clearTimeout(timer); listener.remove(); pulse?.stop(); };
  }, [opacity]);
  return <View accessibilityLabel="Cargando documento" style={{ flex: 1, padding: 24, gap: 16, overflow: 'hidden' }}>
    <Animated.View style={{ opacity, borderWidth: 1.5, borderColor: u.c.border, borderRadius: tokens.radius.group, padding: 16, gap: 12, maxWidth: 352 }}>
      <View style={{ height: 12, width: '65%', backgroundColor: u.c.surface2, borderRadius: 4 }} />
      {[0, 1, 2].map(i => <View key={i} style={{ width: tokens.size.blockWidth.standard, maxWidth: '100%', height: 96, backgroundColor: u.c.surface2, borderRadius: tokens.radius.block }} />)}
    </Animated.View>
    <View style={{ height: 8, width: 120, backgroundColor: u.c.surface2, borderRadius: 4 }} />
    <View style={{ height: 8, width: 180, backgroundColor: u.c.surface2, borderRadius: 4 }} />
    {slow && <Txt kind="small" muted>Sigue cargando…</Txt>}
  </View>;
}

function DocumentRow({ summary, selected, disabled, open }: { summary: CanvasController['documents'][number]; selected: boolean; disabled: boolean; open: () => void }) {
  const u = useUI();
  return <Pressable accessibilityRole="button" accessibilityLabel={'Abrir ' + summary.title} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={open} style={({ pressed }) => ({ minHeight: 52, padding: 10, gap: 10, flexDirection: 'row', alignItems: 'center', borderRadius: 6, backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : selected ? u.c.surface2 : 'transparent', opacity: disabled ? .45 : 1 })}>
    <View style={{ width: 16 }}><Icon name="Frame" size={16} color={u.c.foregroundMuted} /></View>
    <View style={{ flex: 1, gap: 4 }}><Txt kind="groupTitle" numberOfLines={1}>{summary.title}</Txt>{summary.example && <Chip label="Ejemplo" tone="aviso" icon="FlaskConical" />}<Txt kind="small" muted>{'REV ' + summary.revision + ' · ' + relativeTime(summary.updatedAt)}</Txt></View>
    {selected && <Icon name="Check" size={16} color={u.c.accent} />}
  </Pressable>;
}

function ExampleRow({ title, disabled, create }: { title: string; disabled: boolean; create: () => void }) {
  const u = useUI(), [focused, setFocused] = useState(false);
  return <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
    <View><Chip label="Ejemplo" tone="aviso" icon="FlaskConical" /></View>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={create} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed, ...state }) => ({ flex: 1, minHeight: u.compact ? tokens.size.controlCompact : tokens.size.control, paddingHorizontal: focused ? 7 : 8, borderRadius: tokens.radius.control, borderWidth: focused ? 2 : 1, borderColor: focused ? u.c.accent : 'transparent', justifyContent: 'center', backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent', opacity: disabled ? .45 : 1 })}>
      <Txt kind="bodyStrong" numberOfLines={2} style={{ textAlign: 'left' }}>{title}</Txt>
    </Pressable>
  </View>;
}

function ContextTray({ controller: c, note, setNote, sending, error, lastId, send, retry, inspect, connect, wide }: { controller: CanvasController; note: string; setNote: (value: string) => void; sending: boolean; error: string; lastId?: string; send: () => void; retry: () => void; inspect: (section?: InspectorSection) => void; connect: () => void; wide: boolean }) {
  const u = useUI(), doc = c.view!.document, queued = c.events.filter(e => e.status === 'pending').length;
  const lastEvent = lastId ? c.events.find(e => e.id === lastId) : [...c.events].reverse().find(e => e.action.kind === 'selection.send');
  const disabled = sending || c.busy || c.offline;
  return <View style={{ minHeight: tokens.size.tray, maxHeight: tokens.size.trayExpandedMax, borderTopWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1 }}>
    <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }} keyboardShouldPersistTaps="handled">
      {error && <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Txt kind="small" style={{ flex: 1, color: u.c.statusDanger }} numberOfLines={2}>{error}</Txt><Button label="Reintentar" variant="ghost" small disabled={disabled} onPress={retry} /></View>}
      {!c.selection.length ? <Txt kind="small" muted>Selecciona bloques o grupos para darle contexto al agente.</Txt> : <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}><Txt kind="label" muted>Contexto</Txt>
          {c.selection.slice(0, 3).map(id => {
            const entity = [...doc.blocks, ...doc.groups].find(e => e.id === id);
            const type = entity && 'typeId' in entity ? c.catalog?.blockTypes.find(t => t.id === entity.typeId) : undefined;
            return <Pressable key={id} accessibilityRole="button" accessibilityLabel={'Quitar del contexto: ' + (entity?.title || id)} disabled={c.offline || sending} onPress={() => { void c.select(c.selection.filter(x => x !== id)); }} hitSlop={u.compact ? 12 : 6} style={{ maxWidth: 160, minHeight: 20, paddingHorizontal: 6, borderRadius: 4, backgroundColor: u.wash('neutro'), flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name={entity && 'groupIds' in entity ? 'Group' : type ? tokens.renderers[type.renderer ?? 'generic'].icon : 'PackageOpen'} size={12} color={u.c.foregroundMuted} /><Txt kind="small" numberOfLines={1} muted style={{ flexShrink: 1 }}>{entity?.title || id}</Txt><Icon name="X" size={12} color={u.c.foregroundMuted} />
            </Pressable>;
          })}
          {c.selection.length > 3 && <Txt kind="small" muted>{'+' + (c.selection.length - 3)}</Txt>}
          {!wide && <Button label="Inspeccionar" small variant="ghost" onPress={() => inspect()} />}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: u.compact ? 'wrap' : 'nowrap' }}>
          <View style={{ flex: 1, minWidth: u.compact ? '100%' : 80 }}><Input value={note} onChange={setNote} readOnly={sending || c.offline} multiline placeholder="Añade una nota para el agente (opcional)" style={{ minHeight: u.compact ? 44 : 32, maxHeight: 84, paddingVertical: 4 }} /></View>
          {queued > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Ver acciones en cola" onPress={() => inspect('activity')} hitSlop={12}><Chip label={queued + ' en cola'} icon="Clock" /></Pressable>}
          {c.view?.connection ? <Button label={sending ? 'Enviando…' : 'Enviar al agente'} variant="primary" icon="SendHorizontal" disabled={disabled} onPress={send} /> : <><Chip label="Sin agente" icon="Unplug" /><Button label="Conectar" small variant="ghost" onPress={connect} /></>}
        </View>
        {!c.view?.connection && <Txt kind="small" muted>Se guardará en cola hasta que conectes un agente.</Txt>}
      </>}
      {lastEvent && <Delivery event={lastEvent} retry={lastEvent.status === 'failed' && !disabled ? retry : undefined} />}
    </ScrollView>
  </View>;
}
function Presence({ id, open }: { id: string | null; open: () => void }) {
  const u = useUI(), agent = useAgent(id ?? '', a => ({ title: a.title, status: a.status }));
  const status = agent?.status === 'running' ? 'trabajando' : agent?.status === 'idle' ? 'inactivo' : agent?.status === 'error' ? 'con error' : agent?.status === 'closed' ? 'cerrado' : agent ? 'iniciando' : 'sin datos';
  const color = agent?.status === 'running' ? u.c.accent : agent?.status === 'idle' ? u.c.statusSuccess : agent?.status === 'error' || agent?.status === 'closed' ? u.c.statusDanger : u.c.foregroundMuted;
  return <Pressable accessibilityRole="button" accessibilityLabel={id ? 'Agente conectado: ' + (agent?.title || id) + ', ' + status : 'Conectar agente'} onPress={open} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 160, padding: 6 }}><View style={{ width: 12 }}><Icon name={id ? 'Bot' : 'Unplug'} size={12} color={u.c.foregroundMuted} /></View>{id && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />}<Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{id ? agent?.title || 'Agente no disponible' : 'Sin agente'}</Txt></Pressable>;
}
export function LienzoPanel(props: PluginWorkspacePanelProps) { return <UIProvider theme={props.theme} layout={props.layout} host={props.host}><Panel key={`${props.host.id}:${props.workspaceId}`} workspaceId={props.workspaceId} /></UIProvider>; }
function Panel({ workspaceId }: { workspaceId: string }) {
  const u = useUI(), c = useCanvas(workspaceId), toast = useToast(), doc = c.view?.document;
  const [width, setWidth] = useState(0), [barHeight, setBarHeight] = useState<number>(tokens.size.topBar), wide = !u.compact && width >= 980;
  const [mode, setMode] = useState<'canvas' | 'outline'>(u.compact ? 'outline' : 'canvas'), [catalogOpen, setCatalogOpen] = useState(true), [overlay, setOverlay] = useState<'catalog' | 'inspector' | null>(null);
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('types'), [catalogKey, setCatalogKey] = useState(0);
  const [inspectorSection, setInspectorSection] = useState<InspectorSection>('document'), [inspectorKey, setInspectorKey] = useState(0);
  const [docsError, setDocsError] = useState(''), [docsLoading, setDocsLoading] = useState(false);
  const [newIntent, setNewIntent] = useState(''), [newAudience, setNewAudience] = useState(''), [newInstructions, setNewInstructions] = useState('');
  const [showAllWarnings, setShowAllWarnings] = useState(false), [templateError, setTemplateError] = useState('');
  const [docsOpen, setDocsOpen] = useState(false), [agentsOpen, setAgentsOpen] = useState(false), [overflow, setOverflow] = useState(false), [importOpen, setImportOpen] = useState(false), [exported, setExported] = useState<CanvasPack | null>(null), [template, setTemplate] = useState<CanvasGroup | null>(null), [templateName, setTemplateName] = useState(''), [newTitle, setNewTitle] = useState('Lienzo sin título'), [reload, setReload] = useState(false);
  const [note, setNote] = useState(''), [sending, setSending] = useState(false), [sendError, setSendError] = useState('');
  const retrySend = useRef<{ id: string; documentId: string; ids: string[]; note: string } | null>(null);
  const root = useRef<View>(null), searchRef = useRef<View>(null), geometry = useRef<{ rects: Map<string, Rect>; center: Point }>({ rects: new Map(), center: { x: 24, y: 24 } });
  const disabled = c.busy || c.offline || sending || c.loading;
  useEffect(() => { setNote(''); setSendError(''); setSending(false); retrySend.current = null; setReload(false); setTemplate(null); setTemplateError(''); geometry.current = { rects: new Map(), center: { x: 24, y: 24 } }; }, [doc?.id]);
  useEffect(() => { if (u.compact) setMode('outline'); setOverlay(null); }, [u.compact, wide]);
  const inspectorOpen = (section: InspectorSection = 'document') => {
    setInspectorSection(section); setInspectorKey(key => key + 1);
    if (section !== 'document') void c.select([]);
    if (!wide) setOverlay('inspector');
  };
  const openCatalog = (tab: CatalogTab = 'types') => { setCatalogTab(tab); setCatalogKey(key => key + 1); if (wide) setCatalogOpen(true); else setOverlay('catalog'); };
  const toggleCatalog = () => { if (wide) setCatalogOpen(!catalogOpen); else setOverlay(overlay === 'catalog' ? null : 'catalog'); };
  async function refreshDocuments() {
    setDocsLoading(true); setDocsError('');
    try { await c.refreshList(); } catch (e) { setDocsError(e instanceof Error ? e.message : String(e)); }
    finally { setDocsLoading(false); }
  }
  function openDocuments() { setDocsOpen(true); void refreshDocuments(); }
  async function changeRevision(kind: 'undo' | 'redo') {
    if (disabled || !(kind === 'undo' ? c.view?.canUndo : c.view?.canRedo)) return;
    const next = await c.revision(kind);
    if (next) toast.show(kind === 'undo' ? 'Deshecho' : 'Rehecho', { variant: 'success' });
  }
  function reorder(id: string, delta: number) {
    if (!doc || disabled) return; const entity = [...doc.blocks, ...doc.groups].find(e => e.id === id), group = doc.groups.find(g => g.id === entity?.parentGroupId); if (!entity || !group) return;
    const key = 'typeId' in entity! ? 'blockIds' : 'groupIds', ids = [...group[key]], index = ids.indexOf(id), to = index + delta; if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]]; void c.edit([{ type: 'group.update', id: group.id, patch: { [key]: ids } }], delta < 0 ? 'Subir elemento' : 'Bajar elemento');
  }
  function reparent(id: string, parent: string | null) {
    if (!doc || disabled) return; const rects = geometry.current.rects.size ? geometry.current.rects : layoutDocument(doc, {}, c.catalog);
    const operations = moveOperations(doc, rects, [id], { x: 0, y: 0 }, parent); if (operations.length) void c.edit(operations, 'Cambiar grupo');
  }
  function groupSelection() {
    if (!doc || !c.selection.length || disabled) return; const items = topSelection(doc, c.selection), id = newId('group'); if (!items.length) return;
    const parent = items.every(e => e.parentGroupId === items[0]?.parentGroupId) ? items[0]?.parentGroupId ?? null : null;
    const rects = geometry.current.rects.size ? geometry.current.rects : layoutDocument(doc, {}, c.catalog);
    const position = parent ? items[0].position : { x: snap(Math.min(...items.map(e => rects.get(e.id)?.x ?? 0))), y: snap(Math.min(...items.map(e => rects.get(e.id)?.y ?? 0))) };
    void (async () => { const result = await c.edit([{ type: 'group.create', group: { id, title: 'Nuevo grupo', description: '', blockIds: items.filter(e => 'typeId' in e).map(e => e.id), groupIds: items.filter(e => 'groupIds' in e).map(e => e.id), parentGroupId: parent, position, layout: { mode: 'stack' } } }], `Agrupar ${items.length} elementos`); if (result) { await c.select([id]); inspectorOpen(); } })();
  }
  function removeSelection() { if (doc && !disabled) { const items = topSelection(doc, c.selection); if (items.length > 200) { toast.error('Elimina como máximo 200 elementos por vez.'); return; } if (items.length) void c.edit(items.map(e => ({ type: 'groupIds' in e ? 'group.delete' : 'block.delete', id: e.id } as CanvasOperation)), 'Eliminar selección').then(next => { if (next) toast.show('Selección eliminada'); }); } }
  function duplicateSelection() {
    if (!doc || disabled) return;
    const items = topSelection(doc, c.selection), copies = items.map(item => ({ item, prefix: newId('copy') }));
    if (!copies.length) return;
    if (copies.length > 200) { toast.error('Duplica como máximo 200 elementos por vez.'); return; }
    void c.edit(copies.map(({ item, prefix }) => ({ type: 'entity.duplicate', id: item.id, idPrefix: prefix })), 'Duplicar selección').then(next => { if (next) void c.select(copies.map(({ item, prefix }) => prefix + '.' + item.id)); });
  }
  function exportDocument() { if (doc && c.catalog) setExported(selectionPack(doc, c.catalog, [...doc.groups, ...doc.blocks].map(e => e.id))); }
  async function send(again = false) {
    if (!doc || disabled || !c.selection.length && !again) return;
    if (!again && c.selection.length > 100) { setSendError('Selecciona como máximo 100 objetivos por acción.'); return; }
    if (!again) retrySend.current = { id: newId('evt'), documentId: doc.id, ids: [...c.selection], note };
    const request = retrySend.current; if (!request || request.documentId !== doc.id) return;
    setSending(true); setSendError('');
    try { await c.settle(); const event = await c.send({ kind: 'selection.send', label: 'Enviar contexto seleccionado', payload: { note: request.note }, targetIds: request.ids, delivery: 'immediate' }, request.id);
      if (c.current.current?.document.id !== request.documentId) return;
      if (!event) setSendError('No se envió. Revisa el aviso del lienzo.');
      else if (event.status === 'failed') setSendError(event.error ?? 'No se envió');
      else { if ((event.status === 'sent' || event.status === 'pending') && note === request.note) setNote(''); toast.show(event.status === 'pending' ? 'En cola: el agente está ocupado o no conectado' : event.status === 'acked' ? 'Recibido por el agente' : 'Contexto enviado', { variant: event.status === 'pending' ? 'info' : 'success' }); }
    } catch (e) { if (c.current.current?.document.id === request.documentId) setSendError(String(e)); } finally { if (c.current.current?.document.id === request.documentId) setSending(false); }
  }
  function retryFeedback() {
    if (!doc || disabled) return;
    const previous = retrySend.current ? c.events.find(e => e.id === retrySend.current!.id) : [...c.events].reverse().find(e => e.action.kind === 'selection.send');
    if (previous?.status !== 'failed') { void send(true); return; }
    const documentId = doc.id;
    // The flush RPC retries stored batches with their original event ids and payloads.
    setSending(true);
    void c.task(async () => {
      if (c.current.current?.document.id !== documentId) return;
      const result = await c.api.flush({ workspaceId, documentId });
      if (c.current.current?.document.id !== documentId) return;
      c.setEvents(result.events);
      const event = result.events.find(e => e.id === previous.id);
      setSendError(event?.status === 'failed' ? event.error ?? 'No se envió' : '');
      if ((event?.status === 'sent' || event?.status === 'pending') && note === previous.action.payload.note) setNote('');
      if (event?.status === 'pending') toast.show('En cola: el agente está ocupado o no conectado');
      else if (event?.status === 'sent' || event?.status === 'acked') toast.show(event.status === 'acked' ? 'Recibido por el agente' : 'Contexto enviado', { variant: 'success' });
      return result;
    }).finally(() => { if (c.current.current?.document.id === documentId) setSending(false); });
  }
  async function saveTemplate() {
    if (!doc || !template || disabled || !templateName.trim()) return;
    const documentId = doc.id, groupId = template.id, name = templateName.trim();
    const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'plantilla';
    const templateId = slug + '.' + newId('template');
    setTemplateError('');
    const save = async () => {
      if (c.current.current?.document.id !== documentId) return;
      const exported = await c.api.exportGroup({ workspaceId, documentId, groupId, templateId, name });
      const catalog = await c.api.catalog({});
      const next = await c.api.catalogMutate({ expectedRevision: catalog.revision, action: { type: 'template.put', template: exported.template } });
      c.setCatalog(next);
      if (c.current.current?.document.id === documentId) { setTemplate(null); openCatalog('templates'); toast.show('Plantilla «' + name + '» guardada', { variant: 'success' }); }
      return next;
    };
    const retry = (): Promise<Awaited<ReturnType<typeof save>>> => c.task(save, retry, undefined, 'template:' + templateId);
    const next = await retry();
    if (!next && c.current.current?.document.id === documentId) setTemplateError('No se guardó. Revisa el aviso del lienzo o vuelve a intentarlo.');
  }
  function insert(type: BlockType) {
    if (!doc) { openDocuments(); return; } if (disabled) return; const parent = c.selection.length === 1 ? doc.groups.find(g => g.id === c.selection[0]) : undefined, id = newId('block');
    void (async () => { const next = await c.edit([{ type: 'block.create', block: { id, title: type.name, typeId: type.id, data: type.defaults, parentGroupId: parent?.id ?? null, ...(!parent ? { position: geometry.current.center } : {}) } }], `Añadir ${type.name}`); if (next) await c.select([id]); })();
  }
  function insertTemplate(id: string) {
    if (!doc) { openDocuments(); return; } if (disabled) return; const prefix = newId('t'), item = c.catalog?.templates.find(t => t.id === id); if (!item) return; const roots = [...item.groups, ...item.blocks].filter(e => !e.parentGroupId);
    void (async () => { const operations: CanvasOperation[] = [{ type: 'template.insert', templateId: id, idPrefix: prefix }]; if (roots.length < 200) roots.forEach((g, i) => operations.push({ type: 'entity.move', id: `${prefix}.${g.id}`, parentGroupId: null, position: { x: geometry.current.center.x + i * 32, y: geometry.current.center.y + i * 32 } })); const next = await c.edit(operations, 'Añadir plantilla'); if (next) await c.select(roots.map(g => `${prefix}.${g.id}`)); })();
  }
  useEffect(() => {
    if (u.layout.platform !== 'web') return;
    return keyboard(root.current, e => {
      if (e.key === 'Escape') { setOverlay(null); setOverflow(false); void c.select([]); return true; }
      if (e.command && e.key.toLowerCase() === 'k') { openCatalog(); setTimeout(() => focusInput(searchRef.current), 50); return true; }
      if (!doc || disabled) return false;
      if (e.command && e.key.toLowerCase() === 'z') { void changeRevision(e.shift ? 'redo' : 'undo'); return true; }
      if (e.command && e.key.toLowerCase() === 'g') { groupSelection(); return true; }
      if (e.command && e.key === 'Enter') { void send(); return true; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && c.selection.length) { removeSelection(); return true; }
      if (e.key === 'Enter') { inspectorOpen(); return true; }
      if (e.key === 'Tab') {
        const ids: string[] = [], visit = (g: CanvasGroup) => { ids.push(g.id, ...g.blockIds); g.groupIds.forEach(id => { const child = doc.groups.find(g => g.id === id); if (child) visit(child); }); };
        doc.groups.filter(g => !g.parentGroupId).forEach(visit); ids.push(...doc.blocks.filter(b => !b.parentGroupId).map(b => b.id)); if (!ids.length) return false;
        const current = ids.indexOf(c.selection[0]), next = (current + (e.shift ? -1 : 1) + ids.length) % ids.length; void c.select([ids[next]]); return true;
      }
      const distance = e.shift ? 32 : 8, delta = e.key === 'ArrowLeft' ? { x: -distance, y: 0 } : e.key === 'ArrowRight' ? { x: distance, y: 0 } : e.key === 'ArrowUp' ? { x: 0, y: -distance } : e.key === 'ArrowDown' ? { x: 0, y: distance } : null;
      if (delta && c.selection.length) { const operations = moveOperations(doc, geometry.current.rects, c.selection, delta); if (operations.length) void c.edit(operations, 'Mover selección'); return true; }
      return false;
    });
  }, [u.layout.platform, doc, c.selection, c.busy, c.offline, c.loading, wide, note, overlay, sending]);
  const catalog = <Catalog key={catalogKey} initialTab={catalogTab} controller={c} insert={insert} insertTemplate={insertTemplate} onImport={() => setImportOpen(true)} onExport={setExported} searchRef={searchRef} />;
  const inspector = <Inspector key={inspectorKey} initialSection={inspectorSection} controller={c} onClose={wide || u.compact ? undefined : () => setOverlay(null)} groupSelection={groupSelection} reparent={reparent} onTemplate={g => { setTemplate(g); setTemplateName(g.title); setTemplateError(''); }} onExportSelection={() => { if (doc && c.catalog) setExported(selectionPack(doc, c.catalog, c.selection)); }} reorder={reorder} />;
  return <View ref={root} onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ flex: 1, minHeight: 0, backgroundColor: u.c.surface0 }}>
    <View onLayout={e => setBarHeight(e.nativeEvent.layout.height)} style={{ height: u.compact ? tokens.size.topBarCompact : tokens.size.topBar, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1 }}>
      {!u.compact && <IconButton label="Catálogo" icon="LibraryBig" active={wide ? catalogOpen : overlay === 'catalog'} onPress={toggleCatalog} />}
      <Pressable accessibilityRole="button" accessibilityLabel="Documentos" onPress={openDocuments} style={{ flex: u.compact ? 1 : undefined, flexShrink: 1, maxWidth: 360, flexDirection: 'row', gap: 6, alignItems: 'center' }}><Txt kind="title" numberOfLines={1} style={{ flexShrink: 1 }}>{doc?.title ?? 'Lienzo'}</Txt>{doc?.example && <Chip label="Ejemplo" tone="aviso" icon="FlaskConical" />}<Icon name="ChevronDown" size={14} color={u.c.foregroundMuted} /></Pressable>
      {!u.compact && <>{doc && <Pressable accessibilityRole="button" accessibilityLabel="Historial de revisiones" onPress={() => inspectorOpen('history')} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.failure ? u.c.statusDanger : c.busy ? u.c.statusWarning : u.c.statusSuccess }} /><Txt kind="label" muted>{doc ? 'REV ' + doc.revision : ''}</Txt></Pressable>}<View style={{ flex: 1 }} /><IconButton icon="Undo2" label="Deshacer" disabled={disabled || !c.view?.canUndo} onPress={() => { void changeRevision('undo'); }} /><IconButton icon="Redo2" label="Rehacer" disabled={disabled || !c.view?.canRedo} onPress={() => { void changeRevision('redo'); }} /></>}
      <View style={{ width: u.compact ? 168 : 156 }}><Segments value={mode} options={[{ value: 'canvas', label: 'Lienzo' }, { value: 'outline', label: 'Esquema' }]} onChange={setMode} /></View>
      {!u.compact && <><Presence id={c.view?.connection?.agentId ?? null} open={() => setAgentsOpen(true)} />{!wide && <IconButton label="Inspector" icon="PanelRight" active={overlay === 'inspector'} onPress={() => setOverlay(overlay === 'inspector' ? null : 'inspector')} />}</>}{u.compact && <IconButton icon="Ellipsis" label="Más acciones" onPress={() => setOverflow(true)} />}
    </View>
    <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
      {wide && catalogOpen && <View style={{ width: 288, borderRightWidth: 1, borderColor: u.c.border }}>{catalog}</View>}
      <View style={{ flex: 1, minWidth: 0 }}>
        {doc && (c.failure || c.offline || reload) && <View style={{ padding: 12, gap: 8 }}>
          {c.failure && <Banner title={c.failure.conflict ? 'El lienzo cambió mientras editabas' : 'No se guardó el cambio'} icon={c.failure.conflict ? 'GitCompareArrows' : 'CircleAlert'} color={c.failure.conflict ? u.c.statusWarning : u.c.statusDanger} message={c.failure.conflict ? 'Tu cambio se hizo sobre REV ' + (c.failure.revision ?? '?') + '; el documento ya va en REV ' + doc.revision + '. No se aplicó.' : c.failure.message}>
            {c.failure.retry && <Button label={c.failure.conflict ? 'Reaplicar mi cambio' : 'Reintentar'} variant="primary" small disabled={disabled} onPress={() => { void c.failure?.retry?.().catch(e => c.fail(e)); }} />}<Button label="Descartar" variant="ghost" small onPress={c.clearFailure} />
          </Banner>}
          {c.offline && <Banner title="Sin conexión con Paseo" icon="Unplug" color={u.c.border} message="Puedes seguir leyendo; los cambios se desactivan."><Button label="Reintentar" small onPress={() => { void c.refresh(); }} /></Banner>}
          {reload && !(c.failure && c.offline) && <Banner title="Conexión guardada" icon="Info" color={u.c.accent} message="Recarga el agente para que reciba las herramientas de Lienzo."><Button label="Entendido" small variant="ghost" onPress={() => setReload(false)} /></Banner>}
          {c.failure && c.offline && reload && <Button label="+1 aviso" small variant="ghost" onPress={() => setShowAllWarnings(true)} />}
        </View>}
        {c.loading ? <LoadingDocument /> : !doc && c.failure ? <EmptyState title="No se pudo abrir el documento" error={c.failure.message}>
          <Button label="Reintentar" variant="primary" disabled={c.busy} onPress={() => { void c.failure?.retry?.().catch(e => c.fail(e)); }} />
          <Button label="Copiar detalle" variant="ghost" icon="Copy" onPress={() => { void copyText(c.failure?.message ?? '').then(() => toast.show('Detalle copiado')).catch(() => toast.error('No se pudo copiar. Selecciona el texto.')); }} />
        </EmptyState> : !doc ? <EmptyState title="Lienzo">
          <Txt kind="label" muted>Paseo Canvas</Txt><Button label="Crear documento" variant="primary" disabled={disabled} onPress={openDocuments} />
          <Txt kind="label" muted>Ejemplos</Txt>
          {c.catalog?.packs.flatMap(pack => pack.documents.map((d, i) => <ExampleRow key={pack.id + ':' + i} title={d.title} disabled={disabled} create={() => { void c.example(pack.id, i); }} />))}
        </EmptyState> : !doc.blocks.length && !doc.groups.length ? <EmptyState title="Un lienzo en blanco" description="Añade un bloque desde el catálogo o pide al agente que empiece. Los grupos enmarcan bloques que van juntos.">
          <Button label="Añadir primer bloque" variant="primary" disabled={c.offline} onPress={() => openCatalog('types')} /><Button label="Usar una plantilla" disabled={c.offline} onPress={() => openCatalog('templates')} />
        </EmptyState> : <Canvas key={doc.id} controller={c} mode={mode} onInspect={() => inspectorOpen()} onPacks={() => openCatalog('packs')} reorder={reorder} onGeometry={(rects, center) => { geometry.current = { rects, center }; }} />}
        {doc && <ContextTray controller={c} wide={wide} note={note} setNote={setNote} sending={sending} error={sendError} lastId={retrySend.current?.id} send={() => { void send(); }} retry={retryFeedback} inspect={inspectorOpen} connect={() => setAgentsOpen(true)} />}
      </View>{wide && <View style={{ width: 328, borderLeftWidth: 1, borderColor: u.c.border }}>{inspector}</View>}
    </View>
    {!wide && !u.compact && overlay && <View style={{ position: 'absolute', top: barHeight, left: 0, right: 0, bottom: 0 }}><Pressable accessibilityLabel="Cerrar panel" onPress={() => setOverlay(null)} style={{ position: 'absolute', inset: 0, backgroundColor: withAlpha('#000', .45) }} /><View style={{ position: 'absolute', top: 0, bottom: 0, ...(overlay === 'catalog' ? { left: 0, width: 288, borderRightWidth: 1 } : { right: 0, width: 328, borderLeftWidth: 1 }), borderColor: u.c.border }}>{overlay === 'catalog' ? <>{catalog}<View style={{ position: 'absolute', top: 4, right: 4 }}><IconButton label="Cerrar catálogo" icon="X" onPress={() => setOverlay(null)} /></View></> : inspector}</View></View>}
    {u.compact && <Modal title={overlay === 'catalog' ? 'Catálogo local' : 'Inspector'} open={!!overlay} onOpenChange={v => { if (!v) setOverlay(null); }}><Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>{overlay === 'catalog' ? catalog : inspector}</Modal.Content></Modal>}
    <Modal title="Avisos" open={showAllWarnings} onOpenChange={setShowAllWarnings}><Modal.Content>{reload && <Banner title="Conexión guardada" icon="Info" color={u.c.accent} message="Recarga el agente para que reciba las herramientas de Lienzo."><Button label="Entendido" small variant="ghost" onPress={() => { setReload(false); setShowAllWarnings(false); }} /></Banner>}</Modal.Content></Modal>
    <Modal title="Documentos" open={docsOpen} onOpenChange={setDocsOpen}><Modal.Content>
      {docsLoading && <Txt kind="small" muted>Cargando documentos…</Txt>}
      {docsError && <View style={{ gap: 8 }}><Txt kind="code" selectable style={{ color: u.c.statusDanger }}>{docsError}</Txt><Button label="Reintentar" small onPress={() => { void refreshDocuments(); }} /></View>}
      <Txt kind="label" muted>Tus documentos</Txt>
      {!docsLoading && !c.documents.some(d => !d.example) && <Txt kind="small" muted>Aún no tienes documentos propios.</Txt>}
      {c.documents.filter(d => !d.example).map(d => <DocumentRow key={d.id} summary={d} selected={doc?.id === d.id} disabled={c.busy || sending} open={() => { setDocsOpen(false); void c.open(d.id); }} />)}
      <Txt kind="label" muted>Ejemplos</Txt>
      {c.documents.filter(d => d.example).map(d => <DocumentRow key={d.id} summary={d} selected={doc?.id === d.id} disabled={c.busy || sending} open={() => { setDocsOpen(false); void c.open(d.id); }} />)}
      {c.catalog?.packs.filter(p => ['frontend', 'learn'].includes(p.id)).flatMap(p => p.documents.map((d, i) => <View key={p.id + ':' + i} style={{ gap: 4 }}><Chip label="Ejemplo" tone="aviso" icon="FlaskConical" /><Button label={'Crear ' + d.title} variant="ghost" disabled={disabled} onPress={() => { void c.example(p.id, i).then(next => { if (next) setDocsOpen(false); }); }} /></View>))}
      <View style={{ gap: 12, paddingTop: 20, borderTopWidth: 1, borderColor: u.c.border }}>
        <Txt kind="label" muted>Nuevo documento</Txt><Txt kind="small" style={{ fontWeight: '600' }}>Título</Txt><Input value={newTitle} onChange={setNewTitle} label="Título del nuevo documento" readOnly={disabled} style={{ fontFamily: u.font('title').fontFamily }} />
        <View style={{ borderRadius: 10, borderWidth: 1, borderColor: u.toneBorder('acento'), backgroundColor: u.wash('acento'), padding: 12, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="Compass" size={14} color={u.c.accent} /><Txt kind="bodyStrong" style={{ flex: 1 }}>Instrucción</Txt><Txt kind="label" muted>Documento</Txt></View>
          <Txt kind="small" style={{ fontWeight: '600' }}>Intención</Txt><Input label="Intención" value={newIntent} onChange={setNewIntent} readOnly={disabled} placeholder="Para qué se usa esto: enseñar, revisar, decidir…" />
          <Txt kind="small" style={{ fontWeight: '600' }}>Audiencia</Txt><Input label="Audiencia" value={newAudience} onChange={setNewAudience} readOnly={disabled} placeholder="A quién le habla el agente" />
          <Txt kind="small" style={{ fontWeight: '600' }}>Instrucciones</Txt><Input label="Instrucciones" value={newInstructions} onChange={setNewInstructions} readOnly={disabled} multiline placeholder="Cómo debe comunicarse el agente a través de este lienzo" /><Txt kind="small" muted>{newInstructions.length + '/8000'}</Txt>
        </View>
        {(newTitle.length > 300 || newIntent.length > 1000 || newAudience.length > 500 || newInstructions.length > 8000) && <Txt kind="small" style={{ color: u.c.statusDanger }}>Revisa los límites: título 300, intención 1000, audiencia 500 e instrucciones 8000 caracteres.</Txt>}
        {c.failure && <Txt kind="small" style={{ color: u.c.statusDanger }}>{c.failure.message}</Txt>}
        <Button label={c.busy ? 'Creando…' : 'Nuevo documento'} variant="primary" disabled={disabled || !newTitle.trim() || newTitle.length > 300 || newIntent.length > 1000 || newAudience.length > 500 || newInstructions.length > 8000} onPress={() => { void c.create({ title: newTitle.trim(), description: '', example: false, blocks: [], groups: [], selectedIds: [], communication: { instructions: newInstructions, intent: newIntent, audience: newAudience } }).then(next => { if (next) { setDocsOpen(false); setNewTitle('Lienzo sin título'); setNewIntent(''); setNewAudience(''); setNewInstructions(''); } }); }} />
      </View>
      {doc && <><Button label="Duplicar como documento propio" icon="CopyPlus" disabled={disabled} onPress={() => { const content = documentContent(doc, true); content.title = content.title.slice(0, 300); content.selectedIds = []; void c.create(content).then(next => { if (next) setDocsOpen(false); }); }} /><Button label="Exportar documento como pack" icon="FileOutput" disabled={!c.catalog} onPress={() => { setDocsOpen(false); exportDocument(); }} /></>}
    </Modal.Content></Modal>
    <Modal title="Más acciones" open={overflow} onOpenChange={setOverflow}><Modal.Content>
      <Presence id={c.view?.connection?.agentId ?? null} open={() => { setOverflow(false); setAgentsOpen(true); }} />
      {doc && <Button label={'REV ' + doc.revision + ' · Historial'} icon="History" variant="ghost" style={{ justifyContent: 'flex-start' }} onPress={() => { setOverflow(false); inspectorOpen('history'); }} />}
      <Button label="Deshacer" icon="Undo2" variant="ghost" style={{ justifyContent: 'flex-start' }} disabled={disabled || !c.view?.canUndo} onPress={() => { void changeRevision('undo'); }} />
      <Button label="Rehacer" icon="Redo2" variant="ghost" style={{ justifyContent: 'flex-start' }} disabled={disabled || !c.view?.canRedo} onPress={() => { void changeRevision('redo'); }} />
      <Button label="Documentos" icon="Frame" variant="ghost" style={{ justifyContent: 'flex-start' }} onPress={() => { setOverflow(false); openDocuments(); }} />
      <Button label="Catálogo" icon="LibraryBig" variant="ghost" style={{ justifyContent: 'flex-start' }} onPress={() => { setOverflow(false); openCatalog(); }} />
      <Button label="Acuerdo de comunicación" icon="Compass" variant="ghost" style={{ justifyContent: 'flex-start' }} disabled={!doc} onPress={() => { setOverflow(false); inspectorOpen('communication'); }} />
      <Button label="Agente conectado" icon="Plug" variant="ghost" style={{ justifyContent: 'flex-start' }} disabled={!doc} onPress={() => { setOverflow(false); setAgentsOpen(true); }} />
      <Button label="Actividad" icon="Clock" variant="ghost" style={{ justifyContent: 'flex-start' }} disabled={!doc} onPress={() => { setOverflow(false); inspectorOpen('activity'); }} />
      {!!c.selection.length && <><Button label="Agrupar selección" icon="Group" variant="ghost" style={{ justifyContent: 'flex-start' }} disabled={disabled} onPress={() => { setOverflow(false); groupSelection(); }} /><Button label="Duplicar selección" icon="CopyPlus" variant="ghost" style={{ justifyContent: 'flex-start' }} disabled={disabled} onPress={() => { setOverflow(false); duplicateSelection(); }} /><Button label="Eliminar selección" icon="Trash2" variant="danger" disabled={disabled} onPress={() => { setOverflow(false); removeSelection(); }} /></>}
      <Button label="Importar pack" icon="FileInput" variant="ghost" style={{ justifyContent: 'flex-start' }} disabled={c.offline} onPress={() => { setOverflow(false); setImportOpen(true); }} />
    </Modal.Content></Modal>

    <Modal title="Guardar como plantilla" open={!!template} onOpenChange={v => { if (!v) setTemplate(null); }}><Modal.Content>
      <Txt kind="small" style={{ fontWeight: '600' }}>Nombre</Txt><Input label="Nombre de la plantilla" value={templateName} onChange={setTemplateName} readOnly={disabled} />
      {(templateError || c.failure) && <Txt kind="small" style={{ color: u.c.statusDanger }}>{c.failure?.message ?? templateError}</Txt>}
      <Button label={c.busy ? 'Guardando…' : 'Guardar plantilla'} variant="primary" disabled={disabled || !templateName.trim() || templateName.length > 200} onPress={() => { void saveTemplate(); }} />
    </Modal.Content></Modal>
    <AgentModal controller={c} open={agentsOpen} close={() => setAgentsOpen(false)} onReload={() => setReload(true)} /><PackImport controller={c} open={importOpen} close={() => setImportOpen(false)} /><PackExport pack={exported} close={() => setExported(null)} />
  </View>;
}
