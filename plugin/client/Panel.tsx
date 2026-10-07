import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';
import { type PluginWorkspacePanelProps, useAgent, useSettings } from '@getpaseo/plugin/client';
import { Icon, ScrollView, useToast } from '@getpaseo/plugin/client/react-native';
import type { BlockType, CanvasGroup, CanvasOperation, CanvasPack } from '../shared/model';
import { useCanvas, type CanvasController } from './useCanvas';
import { Button, Chip, IconButton, Input, Field, friendlyError, Modal, Segments, Txt, UIProvider, useUI, MenuRow, MenuDivider } from './ui';
import { Canvas, type CanvasApi } from './Canvas';
import { Catalog, PackExport, PackImport } from './Catalog';
import { DocumentActions } from './DocumentActions';
import { SelectionActions, type ActionPopover } from './SelectionActions';
import { panelShortcut } from './panel-actions';
import { AgentModal } from './AgentModal';
import { Delivery } from './Blocks';
import { connectOperations, documentContent, groupOperations, layoutDocument, moveOperations, newId, releaseOperations, selectionPack, topSelection, safeUrl, type Point, type Rect } from './logic';
import { focusInput, keyboard } from './web';
import { Onboarding } from './Onboarding';
import { claimFirstGuide, type GuideAction } from './guide';
import { canvasPreferences } from '../shared/preferences';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { usePresentation } from './usePresentation';
import { BlockPalette } from './BlockPalette';
import { Rings } from './Rings';
import { ToolIsland, StyleIsland, ShapePopover, LibraryPopover, SvgImportDialog } from './FloatingTools';
import { DEFAULT_TOOL_STYLE, type CanvasTool, type ToolStyle, type SvgInsertOptions } from './whiteboard-tools';
import { islandStyle } from './whiteboard-visuals';
import { mediaSource } from './media';
import { needsContentInteraction } from './interaction';
import { isWhiteboardRenderer, learnerLayerIds, strokeLayers, type WbRenderer, type WbDrawData } from '../shared/whiteboard';

type CatalogTab = 'types' | 'templates' | 'packs';
type InspectorSection = 'document' | 'communication' | 'history' | 'activity';

function EmptyState({ title, description, error, children }: { title: string; description?: string; error?: string; children: React.ReactNode }) {
  const u = useUI();
  return <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
    <View style={{ width: '100%', maxWidth: tokens.size.emptyStateMaxWidth, gap: 12, alignItems: 'center' }}>
      <View style={{ width: 56, height: 56, borderRadius: tokens.radius.group, backgroundColor: u.wash(error ? 'riesgo' : 'acento'), alignItems: 'center', justifyContent: 'center' }}><Icon name={error ? 'CircleAlert' : 'Frame'} size={24} color={error ? u.c.statusDanger : u.c.accent} /></View>
      <Txt kind="display" style={{ textAlign: 'center' }}>{title}</Txt>
      {description && <Txt muted style={{ textAlign: 'center' }}>{description}</Txt>}
      {error && <View style={{ alignSelf: 'stretch', backgroundColor: u.c.surface2, borderRadius: 6, padding: 10 }}><Txt kind="small" numberOfLines={4}>{error}</Txt></View>}
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
    <View style={{ flex: 1, gap: 4 }}><Txt kind="groupTitle" numberOfLines={1}>{summary.title}</Txt>{summary.example && <Chip label="Ejemplo" tone="aviso" icon="FlaskConical" />}<Txt kind="small" muted>{relativeTime(summary.updatedAt)}</Txt></View>
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

function ContextTray({ composerRef, controller: c, note, setNote, sending, error, lastId, send, retry, inspect, connect }: { composerRef: React.RefObject<View | null>; controller: CanvasController; note: string; setNote: (value: string) => void; sending: boolean; error: string; lastId?: string; send: () => void; retry: () => void; inspect: (section?: InspectorSection) => void; connect: () => void }) {
  const presentation = usePresentation(c), u = useUI(), doc = presentation?.document ?? c.view!.document;
  const queued = c.events.filter(e => e.status === 'pending' || e.status === 'failed').length;
  const lastEvent = lastId ? c.events.find(e => e.id === lastId) : [...c.events].reverse().find(e => e.action.kind === 'selection.send');
  const disabled = sending || c.busy || c.offline;
  return <View ref={composerRef} nativeID="lienzo-composer" style={[islandStyle(u), { borderRadius: tokens.composer.radius, paddingHorizontal: tokens.composer.paddingH }]}>
    {!!c.selection.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.composer.chipsRow.gap, paddingTop: tokens.composer.chipsRow.paddingTop }}>
      {c.selection.slice(0, 3).map(id => {
        const entity = [...doc.blocks, ...doc.groups].find(e => e.id === id);
        return <Pressable key={id} accessibilityRole="button" accessibilityLabel={'Quitar del contexto: ' + (entity?.title || 'Elemento')} disabled={disabled} onPress={() => { void c.select(c.selection.filter(x => x !== id)); }} hitSlop={6} style={{ maxWidth: 160, minHeight: 20, paddingHorizontal: 6, borderRadius: tokens.radius.control, backgroundColor: u.wash('neutro'), flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{entity?.title || 'Elemento'}</Txt><Icon name="X" size={12} color={u.c.foregroundMuted} />
        </Pressable>;
      })}
      {c.selection.length > 3 && <Button label={'+' + (c.selection.length - 3)} small variant="ghost" onPress={() => inspect()} />}
    </View>}
    <View style={{ minHeight: tokens.composer.height, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
      <IconButton icon={c.view?.connection ? 'Bot' : 'Unplug'} label={c.view?.connection ? 'Asistente conectado' : 'Conectar asistente'} onPress={connect} />
      <View style={{ flex: 1, minWidth: 0 }}><Input value={note} label="Escribir al asistente" onChange={setNote} readOnly={sending || c.offline} multiline placeholder={c.selection.length ? 'Preguntar sobre la selección…' : 'Escribir al asistente…'} style={{ minHeight: 32, maxHeight: 84, paddingVertical: 4, borderWidth: 0, backgroundColor: 'transparent' }} /></View>
      <IconButton label={sending ? 'Enviando' : 'Enviar al asistente'} icon="ArrowUp" disabled={disabled || !c.selection.length && !note.trim()} onPress={send} />
    </View>
    {!c.view?.connection && <Txt kind="small" muted>Sin asistente. Se guarda en cola.</Txt>}
    {queued > 0 && <Button label={queued + ' acciones en cola'} small variant="ghost" onPress={() => inspect('activity')} />}
    {!!error && <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Txt kind="small" style={{ flex: 1, color: u.c.statusDanger }} numberOfLines={2}>{error}</Txt><Button label="Reintentar" variant="ghost" small disabled={disabled} onPress={retry} /></View>}
    {lastEvent && <Delivery event={lastEvent} retry={lastEvent.status === 'failed' && !disabled ? retry : undefined} />}
  </View>;
}
function Presence({ id, open }: { id: string | null; open: () => void }) {
  const u = useUI(), agent = useAgent(id ?? '', a => ({ title: a.title, status: a.status }));
  const status = agent?.status === 'running' ? 'trabajando' : agent?.status === 'idle' ? 'inactivo' : agent?.status === 'error' ? 'con error' : agent?.status === 'closed' ? 'cerrado' : agent ? 'iniciando' : 'sin datos';
  const color = agent?.status === 'running' ? u.c.accent : agent?.status === 'idle' ? u.c.statusSuccess : agent?.status === 'error' || agent?.status === 'closed' ? u.c.statusDanger : u.c.foregroundMuted;
  return <Pressable accessibilityRole="button" accessibilityLabel={id ? 'Asistente conectado: ' + (agent?.title || 'Asistente no disponible') + ', ' + status : 'Conectar asistente'} onPress={open} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 160, padding: 6 }}><View style={{ width: 12 }}><Icon name={id ? 'Bot' : 'Unplug'} size={12} color={u.c.foregroundMuted} /></View>{id && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />}<Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{id ? agent?.title || 'Asistente no disponible' : 'Sin asistente'}</Txt></Pressable>;
}
export function LienzoPanel(props: PluginWorkspacePanelProps) { return <UIProvider theme={props.theme} layout={props.layout} host={props.host}><Panel key={`${props.host.id}:${props.workspaceId}`} workspaceId={props.workspaceId} /></UIProvider>; }
function Panel({ workspaceId }: { workspaceId: string }) {
  const u = useUI(), raw = useCanvas(workspaceId), toast = useToast(), settings = useSettings(canvasPreferences);
  const c = useMemo<CanvasController>(() => ({ ...raw,
    failure: raw.failure ? { ...raw.failure, message: friendlyError(raw.failure.message) } : null,
    events: raw.events.map(event => event.error ? { ...event, error: friendlyError(event.error) } : event),
    send: async (...args) => { const event = await raw.send(...args); return event?.error ? { ...event, error: friendlyError(event.error) } : event; },
  }), [raw]);
  const doc = c.view?.document;
  const [width, setWidth] = useState(0), [panelHeight, setPanelHeight] = useState(0), [islandWidth, setIslandWidth] = useState(0), [composerHeight, setComposerHeight] = useState(44), [styleHeight, setStyleHeight] = useState(0);
  const [mode, setMode] = useState<'canvas' | 'outline' | 'rings'>(u.compact ? 'outline' : 'canvas'), [overlay, setOverlay] = useState<'catalog' | 'inspector' | null>(null), [catalogFull, setCatalogFull] = useState(true);
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('types'), [catalogKey, setCatalogKey] = useState(0);
  const [inspectorSection, setInspectorSection] = useState<InspectorSection>('document'), [inspectorKey, setInspectorKey] = useState(0);
  const [docsError, setDocsError] = useState(''), [docsLoading, setDocsLoading] = useState(false);
  const [showAllWarnings, setShowAllWarnings] = useState(false), [templateError, setTemplateError] = useState('');
  const [documentSettingsOpen, setDocumentSettingsOpen] = useState(false), [docsOpen, setDocsOpen] = useState(false), [agentsOpen, setAgentsOpen] = useState(false), [overflow, setOverflow] = useState(false), [importOpen, setImportOpen] = useState(false), [exported, setExported] = useState<CanvasPack | null>(null), [template, setTemplate] = useState<CanvasGroup | null>(null), [templateName, setTemplateName] = useState(''), [reload, setReload] = useState(false);
  const [note, setNote] = useState(''), [sending, setSending] = useState(false), [sendError, setSendError] = useState('');
  const [tool, setTool] = useState<CanvasTool>('select'), [toolStyle, setToolStyle] = useState<ToolStyle>(DEFAULT_TOOL_STYLE), [toolLocked, setToolLocked] = useState(false);
  const [toolPopover, setToolPopover] = useState<'shapes' | 'library' | null>(null), [toolsOpen, setToolsOpen] = useState(false), [svgOpen, setSvgOpen] = useState(false), [libraryError, setLibraryError] = useState(''), [svgBusy, setSvgBusy] = useState(false);
  const [interactionId, setInteractionId] = useState<string | null>(null), [rename, setRename] = useState(false);
  const [undoLabel, setUndoLabel] = useState('');
  useEffect(() => { if (!undoLabel) return; const timer = setTimeout(() => setUndoLabel(''), 5000); return () => clearTimeout(timer); }, [undoLabel]);
  const [saveSlow, setSaveSlow] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false), [mediaUrl, setMediaUrl] = useState(''), [mediaCaption, setMediaCaption] = useState(''), [mediaError, setMediaError] = useState('');
  // Solo lienzo hides the floating controls. Failures and the Canvas zoom remain visible.
  const [immersive, setImmersive] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false), guideClaim = useRef(false), guideMounted = useRef(true);
  useEffect(() => { guideMounted.current = true; return () => { guideMounted.current = false; }; }, []);
  useEffect(() => {
    if (!c.catalog || c.loading || guideClaim.current || settings.status !== 'ready' || settings.values.guideSeen || settings.saving || settings.saveError) return;
    guideClaim.current = true;
    void claimFirstGuide(settings).then(show => { if (show && guideMounted.current) setGuideOpen(true); });
  }, [c.catalog, c.loading, settings]);
  const closeGuide = () => setGuideOpen(false);
  const guideAction = (action: GuideAction) => {
    if (!doc && ['agents', 'inspector', 'communication', 'history', 'activity'].includes(action)) { openDocuments(); return; }
    if (action === 'documents') openDocuments();
    else if (action === 'catalog' || action === 'templates' || action === 'packs') openCatalog(action === 'catalog' ? 'types' : action);
    else if (action === 'agents') setAgentsOpen(true);
    else inspectorOpen(action === 'inspector' ? 'document' : action);
  };
  // A selected link is view state, like the selection highlight; every change to the link itself goes through c.edit.
  const [actionPopup, setActionPopup] = useState<ActionPopover>(null);
  const [linkId, setLinkId] = useState<string | null>(null);
  const retrySend = useRef<{ id: string; documentId: string; ids: string[]; note: string } | null>(null);
  const composerRef = useRef<View>(null);
  const root = useRef<View>(null), searchRef = useRef<View>(null), canvas = useRef<CanvasApi>(null), geometry = useRef<{ rects: Map<string, Rect>; center: Point }>({ rects: new Map(), center: { x: 24, y: 24 } });
  const disabled = c.busy || c.offline || sending || c.loading;
  useEffect(() => { if (c.arrival) toast.show(`Documento nuevo: «${c.arrival.title}»`, { variant: 'info' }); }, [c.arrival?.id]);
  useEffect(() => { setNote(''); setSendError(''); setSending(false); retrySend.current = null; setReload(false); setDocumentSettingsOpen(false); setTemplate(null); setTemplateError(''); setActionPopup(null); setLinkId(null); geometry.current = { rects: new Map(), center: { x: 24, y: 24 } }; }, [doc?.id]);
  useEffect(() => { if (u.compact) setMode('outline'); setOverlay(null); }, [u.compact]);
  useEffect(() => { if (linkId && (c.selection.length || !doc?.links.some(l => l.id === linkId))) setLinkId(null); }, [linkId, c.selection, doc?.links]);
  useEffect(() => { setActionPopup(previous => previous?.kind === 'instruction' && previous.targetId !== undefined ? previous : null); }, [c.selection.join('|'), linkId]);
  const selectLink = (id: string | null) => { setLinkId(id); };
  function connectSelection() {
    if (!doc || disabled || c.selection.length !== 2) return false; const [from, to] = c.selection, name = (id: string) => [...doc.blocks, ...doc.groups].find(e => e.id === id)?.title || id;
    const { existing, operations, id } = connectOperations(doc, from, to);
    if (existing) { toast.show('Ese enlace ya existe'); selectLink(existing.id); void c.select([]); return true; }
    if (!operations.length) return false;
    void c.edit(operations, `Conectar «${name(from)}» → «${name(to)}»`).then(next => { if (next && id) { selectLink(id); void c.select([]); } }); return true;
  }
  const inspectorOpen = (section: InspectorSection = 'document') => {
    setImmersive(false); // asking for the inspector or catalog leaves Solo lienzo so the request is visible
    setInspectorSection(section); setInspectorKey(key => key + 1);
    if (section !== 'document' || (!c.selection.length && !linkId)) { void c.select([]); setLinkId(null); setOverlay(null); setDocumentSettingsOpen(true); }
    else { setOverlay(null); setActionPopup({ kind: linkId ? 'link-type' : 'data' }); }
  };
  const openCatalog = (tab: CatalogTab = 'types', full = true) => { setCatalogFull(full); setActionPopup(null); setDocumentSettingsOpen(false); setImmersive(false); setCatalogTab(tab); setCatalogKey(key => key + 1); setToolPopover(null); setOverlay('catalog'); };
  async function refreshDocuments() {
    setDocsLoading(true); setDocsError('');
    try { await c.refreshList(); } catch (e) { setDocsError(friendlyError(e)); }
    finally { setDocsLoading(false); }
  }
  function openDocuments() { setActionPopup(null); setToolPopover(null); setDocsOpen(true); void refreshDocuments(); }
  async function newCanvas() {
    if (disabled) return;
    const next = await c.create({ title: 'Lienzo sin título', description: '', example: false, blocks: [], groups: [], links: [], selectedIds: [], communication: { instructions: '', intent: '', audience: '' } });
    if (next) { setDocsOpen(false); setDocumentSettingsOpen(false); setOverlay(null); setLinkId(null); }
  }
  async function changeRevision(kind: 'undo' | 'redo') {
    if (disabled || !(kind === 'undo' ? c.view?.canUndo : c.view?.canRedo)) return;
    const next = await c.revision(kind);
    if (next) toast.show(kind === 'undo' ? 'Deshecho' : 'Rehecho', { variant: 'success' });
  }
  const focusComposer = () => { setImmersive(false); focusInput(composerRef.current); };
  const noticeUndo = (label: string) => { setUndoLabel(label); toast.show(label + ' · Deshacer'); };
  function ungroupSelection() { const group = doc?.groups.find(g => c.selection.length === 1 && g.id === c.selection[0]); if (group && !disabled) void c.edit([{ type: 'group.delete', id: group.id, ungroup: true }], 'Desagrupar'); }
  function editSelectedText() {
    const block = doc?.blocks.find(b => b.id === c.selection[0]);
    if (!u.compact && block && isWhiteboardRenderer(c.catalog?.blockTypes.find(t => t.id === block.typeId)?.renderer)) canvas.current?.editSelection();
    else setActionPopup({ kind: 'text' });
  }
  function reorder(id: string, delta: number) {
    if (!doc || disabled) return; const entity = [...doc.blocks, ...doc.groups].find(e => e.id === id), group = doc.groups.find(g => g.id === entity?.parentGroupId); if (!entity || !group) return;
    const key = 'typeId' in entity! ? 'blockIds' : 'groupIds', ids = [...group[key]], index = ids.indexOf(id), to = index + delta; if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]]; void c.edit([{ type: 'group.update', id: group.id, patch: { [key]: ids } }], delta < 0 ? 'Subir elemento' : 'Bajar elemento');
  }
  const rectsNow = () => geometry.current.rects.size ? geometry.current.rects : layoutDocument(doc!, {}, c.catalog);
  /** "Soltar posición" / "Reordenar automáticamente": hands pinned entities back to the layout of their container. */
  function release(ids: string[], label = ids.length === 1 ? 'Soltar posición' : 'Reordenar automáticamente') {
    if (!doc || disabled || !ids.length) return;
    // A transaction carries 200 operations; a large container is released in consecutive transactions, one entity never split.
    const items = topSelection(doc, ids);
    for (const item of items) {
      const operations = releaseOperations(doc, [item.id], c.catalog);
      if (operations.length > 200 || item.position && !operations.length) { c.fail(new Error(`No se puede soltar la posición de «${item.title || item.id}»: ${operations.length > 200 ? 'supera las 200 operaciones de una transacción' : 'su tipo ya no está en el catálogo'}.`)); return; }
    }
    const selection = [...c.selection];
    void (async () => {
      await c.settle();
      const remaining = items.map(e => e.id); let changed = false;
      while (remaining.length) {
        const latest = c.current.current?.document; if (!latest || latest.id !== doc.id) return;
        const batch: CanvasOperation[] = [];
        while (remaining.length) {
          const operations = releaseOperations(latest, [remaining[0]], c.catalog), item = [...latest.blocks, ...latest.groups].find(e => e.id === remaining[0]);
          if (operations.length > 200 || item?.position && !operations.length) { c.fail(new Error(`No se pudo soltar la posición de «${item?.title || remaining[0]}».`)); return; }
          if (batch.length + operations.length > 200) break;
          remaining.shift(); batch.push(...operations);
        }
        if (!batch.length) continue;
        const next = await c.edit(batch, label); if (!next) return;
        changed = true; await c.select(selection.filter(id => [...next.document.blocks, ...next.document.groups].some(e => e.id === id)));
      }
      toast.show(changed ? ids.length === 1 ? 'Vuelve al orden automático' : 'Reordenado automáticamente' : 'No hay posiciones que soltar');
    })();
  }
  function groupSelection() {
    if (!doc || !c.selection.length || disabled) return; const id = newId('group'), operations = groupOperations(doc, rectsNow(), c.selection, id, c.catalog); if (!operations.length) return;
    void (async () => { const result = await c.edit(operations, `Agrupar ${operations.length - 1} elementos`); if (result) { await c.select([id]); setActionPopup(null); } })();
  }
  function removeSelection() { if (doc && !disabled) { const items = topSelection(doc, c.selection); if (items.length > 200) { toast.error('Elimina como máximo 200 elementos por vez.'); return; } if (items.length) void c.edit(items.map(e => ({ type: 'groupIds' in e ? 'group.delete' : 'block.delete', id: e.id } as CanvasOperation)), 'Eliminar selección').then(next => { if (next) noticeUndo('Eliminado'); }); } }
  function duplicateSelection() {
    if (!doc || disabled) return;
    const items = topSelection(doc, c.selection), copies = items.map(item => ({ item, prefix: newId('copy') }));
    if (!copies.length) return;
    if (copies.length > 200) { toast.error('Duplica como máximo 200 elementos por vez.'); return; }
    void c.edit(copies.map(({ item, prefix }) => ({ type: 'entity.duplicate', id: item.id, idPrefix: prefix })), 'Duplicar selección').then(next => { if (next) void c.select(copies.map(({ item, prefix }) => prefix + '.' + item.id)); });
  }
  function exportDocument() { if (doc && c.catalog) setExported(selectionPack(doc, c.catalog, [...doc.groups, ...doc.blocks].map(e => e.id))); }
  async function send(again = false) {
    if (!doc || disabled || !c.selection.length && !note.trim() && !again) return;
    if (!again && c.selection.length > 100) { setSendError('Selecciona como máximo 100 objetivos por acción.'); return; }
    if (!again) retrySend.current = { id: newId('evt'), documentId: doc.id, ids: [...c.selection], note };
    const request = retrySend.current; if (!request || request.documentId !== doc.id) return;
    setSending(true); setSendError('');
    try { await c.settle(); if (c.current.current?.document.id !== request.documentId) return; const event = await c.send({ kind: 'selection.send', label: request.ids.length ? 'Preguntar sobre la selección' : 'Preguntar sobre el lienzo', payload: { note: request.note }, targetIds: request.ids, delivery: 'immediate' }, request.id);
      if (c.current.current?.document.id !== request.documentId) return;
      if (!event) setSendError('No se envió. Revisa el aviso del lienzo.');
      else if (event.status === 'failed') setSendError(event.error ?? 'No se envió. Revisa el aviso del lienzo.');
      else { if ((event.status === 'sent' || event.status === 'pending') && note === request.note) setNote(''); toast.show(event.status === 'pending' ? 'En cola: el asistente está ocupado o no conectado' : event.status === 'acked' ? 'Recibido por el asistente' : 'Contexto enviado', { variant: event.status === 'pending' ? 'info' : 'success' }); }
    } catch (e) { if (c.current.current?.document.id === request.documentId) setSendError(friendlyError(e)); } finally { if (c.current.current?.document.id === request.documentId) setSending(false); }
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
      setSendError(event?.status === 'failed' ? friendlyError(event.error) : '');
      if ((event?.status === 'sent' || event?.status === 'pending') && note === previous.action.payload.note) setNote('');
      if (event?.status === 'pending') toast.show('En cola: el asistente está ocupado o no conectado');
      else if (event?.status === 'sent' || event?.status === 'acked') toast.show(event.status === 'acked' ? 'Recibido por el asistente' : 'Contexto enviado', { variant: 'success' });
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
  function insert(type: BlockType, data = type.defaults) {
    if (!doc) { openDocuments(); return; } if (disabled) return;
    if (isWhiteboardRenderer(type.renderer)) { setOverlay(null); if (type.renderer === 'wb-svg') { setSvgOpen(true); setMode('canvas'); } else chooseTool(type.renderer === 'wb-text' ? 'text' : type.renderer === 'wb-shape' ? 'shape' : 'draw'); return; }
    const parent = c.selection.length === 1 ? doc.groups.find(g => g.id === c.selection[0]) : undefined;
    const activeBlock = c.selection.length === 1 ? doc.blocks.find(block => block.id === c.selection[0]) : undefined, rect = activeBlock ? rectsNow().get(activeBlock.id) : undefined;
    const parentGroupId = parent?.id ?? activeBlock?.parentGroupId ?? null, parentRect = parentGroupId ? rectsNow().get(parentGroupId) : undefined;
    const position = rect ? { x: rect.x + rect.width + tokens.graph.gap.node - (parentRect?.x ?? 0), y: rect.y - (parentRect?.y ?? 0) } : parent ? undefined : geometry.current.center;
    const id = newId('block'); setOverlay(null);
    void (async () => { const next = await c.edit([{ type: 'block.create', block: { id, title: type.name, typeId: type.id, data, parentGroupId, ...(position ? { position } : {}) } }], `Añadir ${type.name}`); if (next) await c.select([id]); })();
  }
  function insertTemplate(id: string) {
    if (!doc) { openDocuments(); return; } if (disabled) return; const prefix = newId('t'), item = c.catalog?.templates.find(t => t.id === id); if (!item) return; const roots = [...item.groups, ...item.blocks].filter(e => !e.parentGroupId);
    void (async () => { const operations: CanvasOperation[] = [{ type: 'template.insert', templateId: id, idPrefix: prefix }]; if (roots.length < 200) roots.forEach((g, i) => operations.push({ type: 'entity.move', id: `${prefix}.${g.id}`, parentGroupId: null, position: { x: geometry.current.center.x + i * 32, y: geometry.current.center.y + i * 32 } })); const next = await c.edit(operations, 'Añadir plantilla'); if (next) await c.select(roots.map(g => `${prefix}.${g.id}`)); })();
  }
  function createGroup() {
    if (!doc || disabled) return;
    const parent = c.selection.length === 1 ? doc.groups.find(group => group.id === c.selection[0]) : undefined, id = newId('group');
    setOverlay(null);
    void c.edit([{ type: 'group.create', group: { id, title: 'Grupo sin título', description: '', blockIds: [], groupIds: [], parentGroupId: parent?.id ?? null, ...(!parent ? { position: geometry.current.center } : {}) } }], 'Añadir grupo').then(next => { if (next) void c.select([id]); });
  }
  function insertMedia() {
    if (!doc || disabled) return;
    const url = safeUrl(mediaUrl), type = c.catalog?.blockTypes.find(type => type.id === 'media' && type.renderer === 'image-ref');
    if (!url) { setMediaError('Usa una URL HTTP o HTTPS válida.'); return; }
    if (!type) { setMediaError('El tipo multimedia no está disponible en la colección local.'); return; }
    const source = mediaSource(url);
    insert(type, { ...type.defaults, url, caption: mediaCaption, mediaKind: source?.kind ?? 'reference' });
    setMediaOpen(false); setMediaUrl(''); setMediaCaption(''); setMediaError('');
  }
  const rendererOf = (typeId: string) => c.catalog?.blockTypes.find(type => type.id === typeId)?.renderer;
  const selectedWhiteboard = doc?.blocks.filter(block => c.selection.includes(block.id) && isWhiteboardRenderer(rendererOf(block.typeId))) ?? [];
  const selectionKinds = new Set<WbRenderer | 'line'>(selectedWhiteboard.map(block => rendererOf(block.typeId) === 'wb-shape' && block.data.shape === 'line' ? 'line' : rendererOf(block.typeId) as WbRenderer));
  const selectedStyle = selectedWhiteboard[0];
  const displayedStyle: ToolStyle = selectedStyle ? (() => {
    const data = selectedStyle.data, renderer = rendererOf(selectedStyle.typeId);
    if (renderer === 'wb-draw') { const stroke = (data as WbDrawData).strokes[0]; return { ...toolStyle, color: stroke.color, scale: stroke.weight }; }
    return { ...toolStyle, ...Object.fromEntries(Object.keys(DEFAULT_TOOL_STYLE).filter(key => data[key] !== undefined).map(key => [key, data[key]])), ...(data.weight ? { scale: data.weight as ToolStyle['scale'] } : {}), fillColor: data.fillColor as ToolStyle['fillColor'] };
  })() : toolStyle;
  const showStyle = selectionKinds.size > 0 || ['text', 'shape', 'draw', 'eraser'].includes(tool);
  // "Borrar mis trazos": only the learner's own drawings, in one undoable transaction. Assistant and authored strokes stay.
  const myLayers = strokeLayers(doc?.blocks ?? [], b => c.catalog?.blockTypes.find(t => t.id === b.typeId)?.renderer === 'wb-draw').filter(layer => layer.author === 'learner');
  const clearMyStrokes = () => { const ids = learnerLayerIds(myLayers); if (ids.length && !c.busy && !c.offline) void c.edit(ids.map(id => ({ type: 'block.delete' as const, id })), 'Borrar mis trazos'); };
  const toolWidth = width < 560 ? 218 : 362;
  const toolsLeft = Math.min(Math.max((width - toolWidth) / 2, tokens.island.inset + islandWidth + 8), Math.max(tokens.island.inset, width - toolWidth - tokens.island.inset));
  // On a panel tall enough the tools dock on the left edge as a floating column; otherwise they stay in the top row.
  const dock = !u.compact && panelHeight >= tokens.island.dock.minPanelHeight, dockTop = Math.max(tokens.island.bannerTop, (panelHeight - tokens.island.dock.height) / 2), dockFlyoutLeft = tokens.island.inset + tokens.island.dock.width + 8;
  // The "+" tool opens blocks as icon columns beside the dock; search, templates and collections are the full catalog.
  const palette = dock && overlay === 'catalog' && !catalogFull && !immersive;
  const toolsTop = dock ? tokens.island.inset : tokens.island.inset + islandWidth + 8 + toolWidth > width - tokens.island.inset ? tokens.island.bannerTop : tokens.island.inset;
  const composerWidth = width < 560 ? Math.max(0, width - 24 - 88) : Math.min(tokens.composer.width.max, Math.max(0, width - 2 * (width < 880 ? 100 : 180)));
  function chooseTool(next: CanvasTool) {
    if (!doc) { openDocuments(); return; }
    if (disabled && !['select', 'hand'].includes(next)) return;
    if (next === 'svg') { setToolPopover('library'); setMode('canvas'); return; }
    canvas.current?.cancelGesture(); setTool(next); setToolLocked(false); setMode('canvas'); setToolPopover(null);
    if (u.compact && !['select', 'hand'].includes(next)) setToolsOpen(false);
  }
  useEffect(() => { if (c.offline) { canvas.current?.cancelGesture(); setTool('select'); setToolLocked(false); } }, [c.offline]);
  useEffect(() => {
    if (!c.busy) { setSaveSlow(false); return; }
    const timer = setTimeout(() => setSaveSlow(true), 400); return () => clearTimeout(timer);
  }, [c.busy]);
  useEffect(() => { setTool('select'); setToolLocked(false); setToolPopover(null); setToolsOpen(false); setSvgOpen(false); setLibraryError(''); setInteractionId(null); setRename(false); setMediaOpen(false); setMediaUrl(''); setMediaCaption(''); setMediaError(''); }, [doc?.id]);
  function changeStyle(patch: Partial<ToolStyle>) {
    if (disabled) return;
    setToolStyle(previous => ({ ...previous, ...patch }));
    const documentId = doc?.id, ids = selectedWhiteboard.map(block => block.id);
    if (!documentId || !ids.length) return;
    if (ids.length > 200) { toast.error('Cambia el estilo de hasta 200 elementos por vez.'); return; }
    void (async () => {
      await c.settle();
      const latest = c.current.current?.document; if (!latest || latest.id !== documentId) return;
      const operations: CanvasOperation[] = [];
      for (const block of latest.blocks.filter(block => ids.includes(block.id))) {
        const renderer = rendererOf(block.typeId), data = { ...block.data };
        if (!isWhiteboardRenderer(renderer)) continue;
        if (renderer === 'wb-draw') {
          if (patch.color === undefined && patch.scale === undefined) continue;
          data.strokes = (block.data as WbDrawData).strokes.map(stroke => ({ ...stroke, ...(patch.color !== undefined ? { color: patch.color } : {}), ...(patch.scale !== undefined ? { weight: patch.scale } : {}) }));
        } else {
          const allowed = renderer === 'wb-text' ? ['color', 'scale', 'font', 'align'] : renderer === 'wb-svg' ? ['color'] : ['color', 'shape', 'fill', 'fillColor', 'stroke'];
          let changed = false;
          for (const key of allowed) { const value = patch[key as keyof ToolStyle]; if (value !== undefined) { data[key] = value; changed = true; } }
          if (renderer === 'wb-shape') {
            if (patch.scale !== undefined) { data.weight = patch.scale; changed = true; }
            if (data.shape === 'line' && patch.heads !== undefined) { data.heads = patch.heads; changed = true; }
            if (data.shape !== 'line') { delete data.from; delete data.heads; }
          }
          if (!changed) continue;
        }
        operations.push({ type: 'block.update', id: block.id, patch: { data } });
      }
      const label = patch.color !== undefined && patch.fillColor === undefined ? 'Cambiar color' : patch.scale !== undefined ? 'Cambiar tamaño' : patch.fill !== undefined || patch.fillColor !== undefined ? 'Cambiar relleno' : patch.stroke !== undefined ? 'Cambiar trazo' : patch.font !== undefined ? 'Cambiar fuente' : patch.align !== undefined ? 'Cambiar alineación' : patch.shape !== undefined ? 'Cambiar forma' : 'Cambiar puntas';
      if (operations.length) await c.edit(operations, label);
    })().catch(c.fail);
  }
  async function insertSvg(svg: string, meta: SvgInsertOptions = {}): Promise<boolean> {
    if (!doc || disabled || svgBusy) return false;
    const documentId = doc.id;
    setSvgBusy(true); setLibraryError(''); setMode('canvas');
    try {
      const parent = c.selection.length === 1 ? doc.groups.find(group => group.id === c.selection[0]) : undefined;
      const result = await canvas.current?.insertSvg(svg, { ...meta, ...(parent && meta.parentGroupId === undefined ? { parentGroupId: parent.id } : {}) });
      if (c.current.current?.document.id !== documentId) return false;
      if (result) { setToolPopover(null); setTool('select'); setToolsOpen(false); }
      else setLibraryError('No se guardó el SVG. Revisa el aviso del lienzo.');
      return result ?? false;
    } catch { setLibraryError('Este SVG contiene contenido activo o enlaces externos y no se puede importar.'); return false; }
    finally { setSvgBusy(false); }
  }
  useEffect(() => {
    if (u.layout.platform !== 'web') return;
    return keyboard(root.current, e => {
      if (guideOpen) return false;
      if (e.key === 'Escape' && actionPopup) { setActionPopup(null); return true; }
      if (e.key === 'Escape' && overflow && !u.compact) { setOverflow(false); return true; }
      if (e.key === 'Escape' && palette) { setOverlay(null); return true; }
      if (actionPopup || overlay || toolsOpen || documentSettingsOpen || docsOpen || agentsOpen || overflow || template || mediaOpen || svgOpen) return false;
      if (e.key === 'Escape' && immersive) { setImmersive(false); return true; }
      if (e.key === 'Escape' && (toolPopover || toolsOpen)) { setToolPopover(null); setToolsOpen(false); return true; }
      if (e.key === 'Escape' && interactionId) { canvas.current?.endInteraction(); return true; }
      if (e.key === 'Escape' && tool !== 'select') { canvas.current?.cancelGesture(); chooseTool('select'); return true; }
      if (e.key === 'Escape') { setOverlay(null); setOverflow(false); setLinkId(null); void c.select([]); return true; }
      if (!e.command && e.key.toLowerCase() === 'f' && doc) { setOverlay(null); setImmersive(v => !v); return true; }
      if (e.command && e.key.toLowerCase() === 'k') { openCatalog(); setTimeout(() => focusInput(searchRef.current), 50); return true; }
      if (!doc) return false;
      if (!e.command && e.shift && e.key.toLowerCase() === 'l') { setMode(value => value === 'canvas' ? 'outline' : 'canvas'); return true; }
      const shortcuts: Record<string, CanvasTool> = { v: 'select', h: 'hand', t: 'text', r: 'shape', d: 'draw', e: 'eraser' };
      if (!e.command && !e.shift && shortcuts[e.key.toLowerCase()]) { chooseTool(shortcuts[e.key.toLowerCase()]); return true; }
      if ((e.key === 'Enter' || e.key === 'F2') && !e.command && c.selection.length === 1) { editSelectedText(); return true; }
      if (e.key === 'F2' && !c.selection.length && !disabled) { setRename(true); return true; }
      if (!e.command && !e.shift && e.key.toLowerCase() === 'a' && c.selection.length) { focusComposer(); return true; }
      if (disabled) return false;
      if (e.command && e.key.toLowerCase() === 'z') { void changeRevision(e.shift ? 'redo' : 'undo'); return true; }
      const shortcut = panelShortcut(e.key, e.command, e.shift, c.selection.length, !!doc.groups.find(g => c.selection.length === 1 && g.id === c.selection[0]), disabled);
      if (shortcut) { if (shortcut === 'ask') focusComposer(); else if (shortcut === 'duplicate') duplicateSelection(); else if (shortcut === 'group') groupSelection(); else if (shortcut === 'ungroup') ungroupSelection(); else connectSelection(); return true; }
      if (e.command && e.key === 'Enter') { void send(); return true; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && linkId && !c.selection.length) { void c.edit([{ type: 'link.delete', id: linkId }], 'Eliminar enlace').then(next => { if (next) noticeUndo('Eliminado'); }); return true; }
      if (!e.command && e.key.toLowerCase() === 'l' && c.selection.length === 2) return connectSelection();
      if ((e.key === 'Delete' || e.key === 'Backspace') && c.selection.length) { removeSelection(); return true; }
      if (e.key === 'Enter') { inspectorOpen(); return true; }
      if (e.key === 'Tab') {
        const ids: string[] = [], visit = (g: CanvasGroup) => { ids.push(g.id, ...g.blockIds); g.groupIds.forEach(id => { const child = doc.groups.find(g => g.id === id); if (child) visit(child); }); };
        doc.groups.filter(g => !g.parentGroupId).forEach(visit); ids.push(...doc.blocks.filter(b => !b.parentGroupId).map(b => b.id)); if (!ids.length) return false;
        const current = ids.indexOf(c.selection[0]), next = (current + (e.shift ? -1 : 1) + ids.length) % ids.length; void c.select([ids[next]]); return true;
      }
      const distance = e.shift ? 32 : 8, delta = e.key === 'ArrowLeft' ? { x: -distance, y: 0 } : e.key === 'ArrowRight' ? { x: distance, y: 0 } : e.key === 'ArrowUp' ? { x: 0, y: -distance } : e.key === 'ArrowDown' ? { x: 0, y: distance } : null;
      // A held arrow key repeats: nudges land at once, they do not glide.
      if (delta && c.selection.length) { const operations = moveOperations(doc, geometry.current.rects, c.selection, delta, undefined, { catalog: c.catalog }); if (operations.length) { canvas.current?.instant(); void c.edit(operations, 'Mover selección'); } return true; }
      if (!e.command && mode === 'canvas') {
        if (e.key === '1') { canvas.current?.fit(); return true; }
        if (e.key === '2') { canvas.current?.zoomToSelection(); return true; }
        if (e.key === '0') { canvas.current?.zoomTo(1); return true; }
        if (e.key === '+' || e.key === '=') { canvas.current?.zoomStep(1); return true; }
        if (e.key === '-') { canvas.current?.zoomStep(-1); return true; }
      }
      return false;
    });
  }, [u.layout.platform, doc, c.selection, c.busy, c.offline, c.loading, note, overlay, sending, immersive, linkId, mode, guideOpen, tool, toolPopover, toolsOpen, interactionId, actionPopup, documentSettingsOpen, docsOpen, agentsOpen, overflow, template, mediaOpen, svgOpen]);
  const menuRows = <>
      {/* Grouped by what the action is about; one left edge, dividers instead of headings. */}
      <MenuRow icon="Plus" label="Nuevo lienzo" disabled={disabled} onPress={() => { setOverflow(false); void newCanvas(); }} />
      <MenuRow icon="Frame" label="Documentos" onPress={() => { setOverflow(false); openDocuments(); }} />
      <MenuRow icon="Pencil" label="Renombrar lienzo" hint="F2" disabled={!doc || disabled} onPress={() => { setOverflow(false); setRename(true); }} />
      {doc && <MenuRow icon="CopyPlus" label="Duplicar como documento propio" disabled={disabled} onPress={() => { setOverflow(false); const content = documentContent(doc, true); content.title = content.title.slice(0, 300); content.selectedIds = []; void c.create(content); }} />}
      <MenuDivider />
      <MenuRow icon="Undo2" label="Deshacer" disabled={disabled || !c.view?.canUndo} onPress={() => { void changeRevision('undo'); }} />
      <MenuRow icon="Redo2" label="Rehacer" disabled={disabled || !c.view?.canRedo} onPress={() => { void changeRevision('redo'); }} />
      {doc && <MenuRow icon="History" label="Historial" onPress={() => { setOverflow(false); inspectorOpen('history'); }} />}
      {!!c.selection.length && <><MenuDivider />
        {c.selection.length === 2 && <MenuRow icon="Spline" label="Conectar los dos seleccionados" disabled={disabled} onPress={() => { setOverflow(false); connectSelection(); }} />}
        <MenuRow icon="Group" label="Agrupar selección" disabled={disabled} onPress={() => { setOverflow(false); groupSelection(); }} />
        <MenuRow icon="CopyPlus" label="Duplicar selección" disabled={disabled} onPress={() => { setOverflow(false); duplicateSelection(); }} />
        <MenuRow icon="Trash2" label="Eliminar selección" danger disabled={disabled} onPress={() => { setOverflow(false); removeSelection(); }} /></>}
      <MenuDivider />
      <MenuRow icon={mode === 'canvas' ? 'ListTree' : 'Frame'} label={mode === 'canvas' ? 'Ver como lista' : 'Ver como lienzo'} hint="⇧L" onPress={() => { setOverflow(false); setMode(mode === 'canvas' ? 'outline' : 'canvas'); }} />
      <MenuRow icon="Target" label={mode === 'rings' ? 'Volver al lienzo' : 'Ver como anillos'} disabled={!doc} onPress={() => { setOverflow(false); setOverlay(null); setMode(mode === 'rings' ? 'canvas' : 'rings'); }} />
      <MenuRow icon="Maximize2" label="Solo lienzo" hint="F" disabled={!doc} onPress={() => { setOverflow(false); setOverlay(null); setImmersive(true); }} />
      {u.compact && <MenuRow icon="PenTool" label="Herramientas" disabled={!doc} onPress={() => { setOverflow(false); setMode('canvas'); setToolsOpen(true); }} />}
      <MenuDivider />
      <MenuRow icon="Plug" label="Asistente" disabled={!doc} trailing={<Presence id={c.view?.connection?.agentId ?? null} open={() => { setOverflow(false); setAgentsOpen(true); }} />} onPress={() => { setOverflow(false); setAgentsOpen(true); }} />
      <MenuRow icon="Compass" label="Indicaciones para el asistente" disabled={!doc} onPress={() => { setOverflow(false); inspectorOpen('communication'); }} />
      <MenuRow icon="Clock" label="Actividad" disabled={!doc} onPress={() => { setOverflow(false); inspectorOpen('activity'); }} />
      <MenuDivider />
      <MenuRow icon="LibraryBig" label="Catálogo" hint="⌘K" onPress={() => { setOverflow(false); openCatalog(); }} />
      <MenuRow icon="FileInput" label="Importar colección" disabled={c.offline} onPress={() => { setOverflow(false); setImportOpen(true); }} />
      {doc && <MenuRow icon="FileOutput" label="Exportar documento como colección" disabled={!c.catalog} onPress={() => { setOverflow(false); exportDocument(); }} />}
      <MenuDivider />
      <MenuRow icon="Settings" label="Ajustes del lienzo" disabled={!doc} onPress={() => { setOverflow(false); void c.select([]); setLinkId(null); setOverlay(null); setInspectorSection('document'); setInspectorKey(key => key + 1); setDocumentSettingsOpen(true); }} />
      <MenuRow icon="BookOpen" label="Guía de Lienzo" onPress={() => { setOverflow(false); setGuideOpen(true); }} />
  </>;
  const paletteExtras = [{ label: 'Grupo', icon: 'Group', description: 'Un área que contiene y ordena otros bloques.', onPress: createGroup }, { label: 'Multimedia por URL…', icon: 'Image', description: 'Imagen, video o audio desde un enlace.', onPress: () => { setOverlay(null); setMediaError(''); setMediaOpen(true); } }, { label: 'Importar SVG…', icon: 'Upload', description: 'Un dibujo vectorial desde archivo, texto o enlace.', onPress: () => { setOverlay(null); setMode('canvas'); setSvgOpen(true); } }];
  const catalog = <Catalog key={catalogKey} initialTab={catalogTab} controller={c} insert={insert} insertTemplate={insertTemplate} extras={paletteExtras} onImport={() => setImportOpen(true)} onExport={setExported} searchRef={searchRef} />;
  const inspector = doc ? <DocumentActions controller={c} section={inspectorSection} rects={rectsNow} release={release} /> : null;
  const selectionToolbar = !immersive && (c.selection.length || linkId || actionPopup?.kind === 'instruction') ? <SelectionActions controller={c} panelRoot={root} availableWidth={width} availableHeight={panelHeight} disabled={disabled} popup={actionPopup} onPopup={value => { setActionPopup(value); if (value) { setToolPopover(null); setOverlay(null); setOverflow(false); } }} linkId={linkId} onLink={selectLink} ask={focusComposer} add={() => { setActionPopup(null); openCatalog(); }} duplicate={duplicateSelection} remove={() => { if (linkId && !c.selection.length) void c.edit([{ type: 'link.delete', id: linkId }], 'Eliminar enlace').then(next => { if (next) { setLinkId(null); noticeUndo('Eliminado'); } }); else removeSelection(); }} groupSelection={groupSelection} connectSelection={connectSelection} release={release} template={g => { setTemplate(g); setTemplateName(g.title); setTemplateError(''); }} exportSelection={() => { if (doc && c.catalog) setExported(selectionPack(doc, c.catalog, c.selection)); }} rects={rectsNow} editText={editSelectedText} interact={() => canvas.current?.beginInteraction()} editLinkLabel={() => canvas.current?.editLinkLabel()} undoNotice={noticeUndo} /> : undefined;
  const toolIsland = <ToolIsland tool={tool} onToolChange={chooseTool} locked={toolLocked} onLockChange={setToolLocked} shape={toolStyle.shape} onOpenShapes={() => { setOverlay(null); setToolPopover('shapes'); }} onOpenLibrary={() => { setOverlay(null); setLibraryError(''); setToolPopover('library'); setMode('canvas'); }} onOpenPicker={() => { if (overlay === 'catalog') setOverlay(null); else openCatalog('types', false); }} width={width} touch={u.compact} disabled={!doc || disabled} vertical={dock} />;
  const styleIsland = <StyleIsland tool={tool} selectionKinds={selectionKinds} value={displayedStyle} onChange={changeStyle} orientation={u.compact || width < 880 ? 'horizontal' : 'vertical'} touch={u.compact} disabled={disabled} myStrokes={myLayers.reduce((sum, layer) => sum + layer.strokes, 0)} onClearMyStrokes={clearMyStrokes} />;
  const title = doc ? rename ? <Field key={doc.id} hideLabel label="Título del lienzo" value={doc.title} disabled={disabled} inputStyle={u.font('groupTitle')} onSave={async value => {
    if (!value.trim() || value.trim().length > 300) throw new Error('Escribe un título de hasta 300 caracteres.');
    await c.settle(); if (c.current.current?.document.id !== doc.id) return;
    const next = await c.edit([{ type: 'document.update', title: value.trim() }], 'Renombrar lienzo'); if (next) setRename(false); return next;
  }} /> : <Pressable accessibilityRole="button" accessibilityLabel={'Abrir lienzos: ' + doc.title} onPress={openDocuments} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: tokens.island.title.paddingH, minHeight: tokens.island.button.size, gap: 4 }}><Txt kind="groupTitle" numberOfLines={1} style={{ flexShrink: 1 }}>{doc.title}</Txt><Icon name="ChevronDown" size={12} color={u.c.foregroundMuted} /></Pressable> : <Txt kind="groupTitle">Lienzo</Txt>;
  return <View ref={root} onLayout={e => { setWidth(e.nativeEvent.layout.width); setPanelHeight(e.nativeEvent.layout.height); }} style={{ flex: 1, minHeight: 0, backgroundColor: u.c.surface0 }}>
    {u.compact && !immersive && <View style={{ height: tokens.size.topBarCompact, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1 }}>
      <IconButton icon="Menu" label="Más acciones" onPress={() => setOverflow(true)} /><View style={{ flex: 1, minWidth: 0 }}>{title}</View>{doc?.example && <Chip label="Ejemplo" tone="aviso" icon="FlaskConical" center />}<IconButton icon="Undo2" label="Deshacer" disabled={disabled || !c.view?.canUndo} onPress={() => { void changeRevision('undo'); }} /><IconButton icon="Plus" label="Añadir" disabled={!doc || disabled} onPress={() => openCatalog()} /><IconButton icon="PenTool" label="Herramientas" disabled={!doc} onPress={() => { setMode('canvas'); setToolsOpen(true); }} />
      <IconButton icon={mode === 'canvas' ? 'ListTree' : 'Frame'} label={mode === 'canvas' ? 'Ver como lista' : 'Ver como lienzo'} onPress={() => setMode(mode === 'canvas' ? 'outline' : 'canvas')} /><IconButton icon="Target" label={mode === 'rings' ? 'Volver al lienzo' : 'Ver como anillos'} active={mode === 'rings'} onPress={() => { setOverlay(null); setMode(mode === 'rings' ? 'canvas' : 'rings'); }} />
    </View>}
    <View style={u.compact ? { flex: 1, minHeight: 0 } : { position: 'absolute', inset: 0 }}>
      {c.loading ? <LoadingDocument /> : !doc && c.failure ? <EmptyState title="No se pudo abrir el lienzo" error={c.failure.message}><Button label="Reintentar" variant="primary" disabled={c.busy} onPress={() => { void c.failure?.retry?.().catch(c.fail); }} /></EmptyState> : !doc ? <EmptyState title="Lienzo">
        <Button label="Nuevo lienzo" variant="primary" disabled={disabled} onPress={() => { void newCanvas(); }} /><Txt kind="label" muted>Ejemplos</Txt>
        {c.catalog?.packs.flatMap(pack => pack.documents.map((d, i) => <ExampleRow key={pack.id + ':' + i} title={d.title} disabled={disabled} create={() => { void c.example(pack.id, i); }} />))}
      </EmptyState> : mode === 'rings' ? <Rings controller={c} onOpen={id => { void c.select([id]); setMode('canvas'); }} /> : <Canvas key={doc.id} api={canvas} tool={tool} onToolChange={setTool} toolStyle={toolStyle} toolLocked={toolLocked} onInteractionChange={setInteractionId} selectionToolbar={u.compact ? undefined : selectionToolbar} onRelease={release} controller={c} mode={mode === 'outline' ? 'outline' : 'canvas'} linkId={linkId} onLink={id => { if (id === null) setToolPopover(null); selectLink(id); }} onInspect={() => inspectorOpen()} onPacks={() => openCatalog('packs')} reorder={reorder} onGeometry={(rects, center) => { geometry.current = { rects, center }; }} />}
    </View>
    <View pointerEvents="box-none" style={{ position: 'absolute', inset: 0 }}>
      {!u.compact && !c.selection.length && !linkId && actionPopup && <View pointerEvents="box-none" style={{ position: 'absolute', top: tokens.island.bannerTop, left: 12, width: tokens.popover.width.medium }}>{selectionToolbar}</View>}
      {!!undoLabel && <View pointerEvents="box-none" style={{ position: 'absolute', top: tokens.island.bannerTop, right: 12, zIndex: 30 }}><View style={[islandStyle(u), { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }]}><Txt kind="small">{undoLabel}</Txt><Button label="Deshacer" small variant="ghost" disabled={disabled || !c.view?.canUndo} onPress={() => { setUndoLabel(''); void changeRevision('undo'); }} /><IconButton label="Cerrar aviso" icon="X" onPress={() => setUndoLabel('')} /></View></View>}
      {!u.compact && !immersive && <View pointerEvents="box-none" onLayout={e => setIslandWidth(e.nativeEvent.layout.width)} style={{ position: 'absolute', top: tokens.island.inset, left: tokens.island.inset, maxWidth: Math.max(0, width - 24) }}><View nativeID="lienzo-document-island" style={[islandStyle(u), { flexDirection: 'row', alignItems: 'center' }]}>
        <IconButton icon="Menu" label="Más acciones" onPress={() => { setToolPopover(null); setOverflow(true); }} />
        <View style={{ flexShrink: 1, minWidth: 0, maxWidth: width < 880 ? tokens.island.title.maxWidthTight : tokens.island.title.maxWidth, ...(rename ? { width: width < 880 ? tokens.island.title.maxWidthTight : tokens.island.title.maxWidth } : {}) }}>{title}</View>
        {doc?.example && <Chip label="Ejemplo" tone="aviso" icon="FlaskConical" center />}
        {(saveSlow || c.failure) && <View accessibilityLabel={c.failure ? 'No se guardó' : 'Guardando'} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.failure ? u.c.statusDanger : u.c.statusWarning }} />}
        <View style={{ width: tokens.island.divider.width, height: tokens.island.divider.height, marginHorizontal: tokens.island.divider.marginH, backgroundColor: u.c.border }} />
        <IconButton icon="Undo2" label="Deshacer" disabled={disabled || !c.view?.canUndo} onPress={() => { void changeRevision('undo'); }} />{width >= 560 && <IconButton icon="Redo2" label="Rehacer" disabled={disabled || !c.view?.canRedo} onPress={() => { void changeRevision('redo'); }} />}
        {!!doc && <IconButton icon="Target" label={mode === 'rings' ? 'Volver al lienzo' : 'Ver como anillos'} active={mode === 'rings'} onPress={() => { setOverlay(null); setMode(mode === 'rings' ? 'canvas' : 'rings'); }} />}
      </View></View>}
      {!u.compact && !immersive && mode !== 'rings' && <View pointerEvents="box-none" style={dock ? { position: 'absolute', top: dockTop, left: tokens.island.inset } : { position: 'absolute', top: toolsTop, left: toolsTop === tokens.island.inset ? toolsLeft : Math.max(tokens.island.inset, (width - toolWidth) / 2) }}>{toolIsland}</View>}
      {doc && !doc.blocks.length && !doc.groups.length && mode === 'canvas' && !immersive && tool === 'select' && <View pointerEvents="box-none" style={{ position: 'absolute', top: toolsTop + 80, left: 24, right: 24, alignItems: 'center', gap: 8 }}><View pointerEvents="none"><Txt kind="display" style={{ textAlign: 'center' }}>Un lienzo en blanco</Txt><Txt muted style={{ textAlign: 'center' }}>Escribe, dibuja o añade un bloque.</Txt></View><View pointerEvents="box-none" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label="Añadir un bloque" disabled={disabled} onPress={() => openCatalog()} /><Button label="Usar una plantilla" disabled={disabled} onPress={() => openCatalog('templates')} /></View></View>}
      {doc && !immersive && !u.compact && <View pointerEvents="box-none" onLayout={e => setComposerHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', bottom: tokens.island.inset, left: width < 560 ? tokens.island.inset : (width - composerWidth) / 2, width: composerWidth }}><ContextTray composerRef={composerRef} controller={c} note={note} setNote={setNote} sending={sending} error={sendError} lastId={retrySend.current?.id} send={() => { void send(); }} retry={retryFeedback} inspect={inspectorOpen} connect={() => setAgentsOpen(true)} /></View>}
      {showStyle && !immersive && !u.compact && mode === 'canvas' && <View pointerEvents="box-none" style={width >= 880 ? { position: 'absolute', right: tokens.island.inset, top: Math.max(toolsTop + 56, (panelHeight - styleHeight) / 2), maxHeight: Math.max(80, panelHeight - 160) } : { position: 'absolute', bottom: tokens.island.inset + composerHeight + 8, left: tokens.island.inset, right: tokens.island.inset }}><ScrollView pointerEvents="box-none" style={{ maxHeight: Math.max(80, panelHeight - 160) }} contentContainerStyle={{ alignItems: width >= 880 ? 'flex-end' : 'center' }}><View pointerEvents="box-none" onLayout={e => setStyleHeight(e.nativeEvent.layout.height)}>{styleIsland}</View></ScrollView></View>}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: u.compact ? tokens.size.topBarCompact + 8 : toolsTop + tokens.island.bannerTop, left: 12, right: 12 }}>{doc && (c.failure || c.offline || reload) && <View pointerEvents="box-none" style={{ padding: 12, gap: 8 }}>
          {c.failure && <Banner title={c.failure.conflict ? 'El lienzo cambió mientras editabas' : 'No se guardó el cambio'} icon={c.failure.conflict ? 'GitCompareArrows' : 'CircleAlert'} color={c.failure.conflict ? u.c.statusWarning : u.c.statusDanger} message={c.failure.conflict ? 'Otra edición cambió el lienzo y tu cambio no se guardó. Puedes reaplicarlo sobre el contenido actual o descartarlo.' : c.failure.message}>
            {c.failure.retry && <Button label={c.failure.conflict ? 'Reaplicar mi cambio' : 'Reintentar'} variant="primary" small disabled={disabled} onPress={() => { void c.failure?.retry?.().catch(e => c.fail(e)); }} />}<Button label="Descartar" variant="ghost" small onPress={c.clearFailure} />
          </Banner>}
          {c.offline && <Banner title="Sin conexión con Paseo" icon="Unplug" color={u.c.border} message="Puedes seguir leyendo; los cambios se desactivan."><Button label="Reintentar" small onPress={() => { void c.refresh(); }} /></Banner>}
          {reload && !(c.failure && c.offline) && <Banner title="Este asistente no tiene las herramientas de Lienzo" icon="Info" color={u.c.statusWarning} message="Quedó conectado y recibirá tus acciones como mensajes, pero se creó sin las herramientas, así que no puede leer ni editar el lienzo. Activa las herramientas en el diálogo de asistente y crea un asistente nuevo, o usa «Configurar un asistente existente»."><Button label="Entendido" small variant="ghost" onPress={() => setReload(false)} /></Banner>}
          {c.failure && c.offline && reload && <Button label="+1 aviso" small variant="ghost" onPress={() => setShowAllWarnings(true)} />}
        </View>}</View>
      {toolPopover && !toolsOpen && !u.compact && !immersive && <View pointerEvents="box-none" style={dock ? { position: 'absolute', top: dockTop, left: dockFlyoutLeft } : { position: 'absolute', top: toolsTop + tokens.toolbar.height + 8, left: Math.max(12, Math.min(toolsLeft, width - (toolPopover === 'library' ? 316 : 196))) }}>
        {toolPopover === 'shapes' ? <ShapePopover value={toolStyle.shape} heads={toolStyle.heads} onPick={(shape, heads) => { setToolStyle(previous => ({ ...previous, shape, heads })); chooseTool('shape'); }} onClose={() => setToolPopover(null)} /> : <LibraryPopover onInsert={insertSvg} onImport={() => { setToolPopover(null); setSvgOpen(true); }} error={libraryError} busy={disabled || svgBusy} onClose={() => setToolPopover(null)} />}
      </View>}
      {immersive && <View pointerEvents="box-none" style={{ position: 'absolute', top: 12, right: 12 }}><View style={islandStyle(u)}><IconButton icon="Minimize2" label="Mostrar controles" onPress={() => setImmersive(false)} /></View></View>}
      {u.compact && !immersive && mode === 'canvas' && !['select', 'hand'].includes(tool) && <View pointerEvents="box-none" style={{ position: 'absolute', top: tokens.size.topBarCompact + 8, left: 0, right: 0, alignItems: 'center' }}><Button label="Listo" variant="primary" onPress={() => chooseTool('select')} /></View>}
    </View>
    {u.compact && doc && !immersive && selectionToolbar}
    {u.compact && doc && !immersive && <ContextTray composerRef={composerRef} controller={c} note={note} setNote={setNote} sending={sending} error={sendError} lastId={retrySend.current?.id} send={() => { void send(); }} retry={retryFeedback} inspect={inspectorOpen} connect={() => setAgentsOpen(true)} />}
    <Modal title={overlay === 'catalog' ? 'Añadir un bloque' : 'Detalles'} open={!!overlay && !immersive && !palette} onOpenChange={v => { if (!v) setOverlay(null); }}><Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
      {overlay === 'catalog' && width < 560 && <View style={{ padding: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label="Forma" icon="Shapes" disabled={disabled} onPress={() => { setOverlay(null); setToolsOpen(true); setToolPopover('shapes'); setMode('canvas'); }} /><Button label="Goma" icon="Eraser" disabled={disabled} onPress={() => { setOverlay(null); chooseTool('eraser'); }} /><Button label="Biblioteca" icon="Library" disabled={disabled} onPress={() => { setOverlay(null); setToolsOpen(true); setToolPopover('library'); setMode('canvas'); }} /></View>}
      <View style={{ minHeight: 320, maxHeight: Math.max(320, panelHeight - 120), flex: 1 }}>{overlay === 'catalog' ? catalog : inspector}</View>
    </Modal.Content></Modal>
    <Modal title="Herramientas" open={toolsOpen} onOpenChange={open => { setToolsOpen(open); if (!open) setToolPopover(null); }}><Modal.Content><View style={{ gap: 12 }}>
      <View style={{ alignItems: 'center' }}><ToolIsland tool={tool} onToolChange={chooseTool} locked={toolLocked} onLockChange={setToolLocked} shape={toolStyle.shape} onOpenShapes={() => setToolPopover('shapes')} onOpenLibrary={() => setToolPopover('library')} onOpenPicker={() => { setToolsOpen(false); openCatalog(); }} width={880} grid={u.compact} touch={u.compact} disabled={!doc || disabled} /></View>
      {styleIsland}
      <Button label="Biblioteca" icon="Library" variant="ghost" style={{ justifyContent: 'flex-start' }} disabled={!doc || disabled} onPress={() => { setLibraryError(''); setToolPopover('library'); }} />
      {toolPopover === 'shapes' && <ShapePopover value={toolStyle.shape} heads={toolStyle.heads} onPick={(shape, heads) => { setToolStyle(previous => ({ ...previous, shape, heads })); chooseTool('shape'); }} onClose={() => setToolPopover(null)} />}
      {toolPopover === 'library' && <LibraryPopover onInsert={insertSvg} onImport={() => { setToolsOpen(false); setSvgOpen(true); }} error={libraryError} busy={disabled || svgBusy} onClose={() => setToolPopover(null)} />}
      <Button label="Listo" variant="primary" onPress={() => { setToolsOpen(false); setToolPopover(null); }} />
    </View></Modal.Content></Modal>
    <Modal title="Añadir multimedia" open={mediaOpen} onOpenChange={setMediaOpen}><Modal.Content>
      <Input label="URL de imagen, video o audio" value={mediaUrl} onChange={setMediaUrl} readOnly={disabled} />
      <Input label="Pie de la referencia" value={mediaCaption} onChange={setMediaCaption} readOnly={disabled} />
      {!!mediaError && <Txt kind="small" style={{ color: u.c.statusDanger }}>{mediaError}</Txt>}
      <Button label="Añadir multimedia" variant="primary" disabled={disabled || !mediaUrl.trim()} onPress={insertMedia} />
    </Modal.Content></Modal>
    <SvgImportDialog open={svgOpen} onClose={() => setSvgOpen(false)} onInsert={insertSvg} />
    <Modal title="Avisos" open={showAllWarnings} onOpenChange={setShowAllWarnings}><Modal.Content>{reload && <Banner title="Este asistente no tiene las herramientas de Lienzo" icon="Info" color={u.c.statusWarning} message="Quedó conectado y recibirá tus acciones como mensajes, pero se creó sin las herramientas, así que no puede leer ni editar el lienzo. Activa las herramientas en el diálogo de asistente y crea un asistente nuevo, o usa «Configurar un asistente existente»."><Button label="Entendido" small variant="ghost" onPress={() => { setReload(false); setShowAllWarnings(false); }} /></Banner>}</Modal.Content></Modal>
    <Modal title="Documentos" open={docsOpen} onOpenChange={setDocsOpen}><Modal.Content>
      {docsLoading && <Txt kind="small" muted>Cargando documentos…</Txt>}
      {docsError && <View style={{ gap: 8 }}><Txt kind="small" style={{ color: u.c.statusDanger }}>{docsError}</Txt><Button label="Reintentar" small onPress={() => { void refreshDocuments(); }} /></View>}
      <Txt kind="label" muted>Tus documentos</Txt>
      {!docsLoading && !c.documents.some(d => !d.example) && <Txt kind="small" muted>Aún no tienes documentos propios.</Txt>}
      {c.documents.filter(d => !d.example).map(d => <DocumentRow key={d.id} summary={d} selected={doc?.id === d.id} disabled={c.busy || sending} open={() => { setDocsOpen(false); void c.open(d.id); }} />)}
      <Button label={c.busy ? 'Creando…' : 'Nuevo lienzo'} variant="primary" disabled={disabled} onPress={() => { void newCanvas(); }} />
      <Txt kind="label" muted>Ejemplos</Txt>
      {c.documents.filter(d => d.example).map(d => <DocumentRow key={d.id} summary={d} selected={doc?.id === d.id} disabled={c.busy || sending} open={() => { setDocsOpen(false); void c.open(d.id); }} />)}
      {c.catalog?.packs.filter(p => ['frontend', 'learn'].includes(p.id)).flatMap(p => p.documents.map((d, i) => <View key={p.id + ':' + i} style={{ gap: 4 }}><Chip label="Ejemplo" tone="aviso" icon="FlaskConical" /><Button label={'Crear ' + d.title} variant="ghost" disabled={disabled} onPress={() => { void c.example(p.id, i).then(next => { if (next) setDocsOpen(false); }); }} /></View>))}
    </Modal.Content></Modal>
    {palette && <><Pressable accessibilityLabel="Cerrar bloques" onPress={() => setOverlay(null)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 40 }} />
      <View pointerEvents="box-none" style={{ position: 'absolute', left: dockFlyoutLeft, top: 0, bottom: 0, justifyContent: 'center', zIndex: 41 }}><BlockPalette types={c.catalog?.blockTypes ?? []} extras={paletteExtras} insert={insert} onMore={() => setCatalogFull(true)} disabled={disabled} maxRows={Math.floor((panelHeight - 2 * tokens.island.bannerTop) / tokens.island.palette.button)} /></View></>}
    {/* The menu drops from its button on a wide panel; on a compact one it is a sheet. */}
    {overflow && !u.compact && <><Pressable accessibilityLabel="Cerrar menú" onPress={() => setOverflow(false)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 40 }} />
      <View nativeID="lienzo-interactive-menu" accessibilityRole="menu" style={{ position: 'absolute', left: tokens.island.inset, top: tokens.island.inset + 48, width: 288, maxHeight: Math.max(240, panelHeight - tokens.island.inset - 72), zIndex: 41, ...islandStyle(u, true), padding: 0, overflow: 'hidden' }}><ScrollView contentContainerStyle={{ padding: 6 }}>{menuRows}</ScrollView></View></>}
    <Modal title="Menú" open={overflow && u.compact} onOpenChange={setOverflow}><Modal.Content><View>{menuRows}</View></Modal.Content></Modal>

    <Modal title={inspectorSection === 'history' ? 'Historial' : inspectorSection === 'activity' ? 'Actividad' : inspectorSection === 'communication' ? 'Instrucciones para el asistente' : 'Ajustes del lienzo'} open={documentSettingsOpen && !!doc} onOpenChange={setDocumentSettingsOpen}><Modal.Content>{documentSettingsOpen && doc && inspector}</Modal.Content></Modal>
    {settings.saveError && <View style={{ position: 'absolute', top: toolsTop + 64, left: 12, right: 12, padding: 8, backgroundColor: u.c.surface1 }}><Txt kind="small" muted>No se pudo recordar que ya viste la guía.</Txt><Button label="Reintentar" small variant="ghost" onPress={() => { guideClaim.current = false; void settings.reload(); }} /></View>}
    <Onboarding open={guideOpen} close={closeGuide} catalog={c.catalog} onAction={guideAction} />
    <Modal title="Guardar como plantilla" open={!!template} onOpenChange={v => { if (!v) setTemplate(null); }}><Modal.Content>
      <Txt kind="small" style={{ fontWeight: '600' }}>Nombre</Txt><Input label="Nombre de la plantilla" value={templateName} onChange={setTemplateName} readOnly={disabled} />
      {(templateError || c.failure) && <Txt kind="small" style={{ color: u.c.statusDanger }}>{c.failure?.message ?? templateError}</Txt>}
      <Button label={c.busy ? 'Guardando…' : 'Guardar plantilla'} variant="primary" disabled={disabled || !templateName.trim() || templateName.length > 200} onPress={() => { void saveTemplate(); }} />
    </Modal.Content></Modal>
    <AgentModal controller={c} open={agentsOpen} close={() => setAgentsOpen(false)} onReload={() => setReload(true)} /><PackImport controller={c} open={importOpen} close={() => setImportOpen(false)} /><PackExport pack={exported} close={() => setExported(null)} />
  </View>;
}
