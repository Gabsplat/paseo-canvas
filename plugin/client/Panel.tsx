import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';
import { type PanelProps, AgentSheet, capabilities, useAgent, useSettings } from './host';
import { Icon, ScrollView, useToast } from './host';
import type { BlockType, CanvasGroup, CanvasOperation } from '../shared/model';
import { useCanvas, type CanvasController } from './useCanvas';
import { Button, Chip, IconButton, Field, friendlyError, Modal, Txt, UIProvider, useUI, MenuRow, MenuDivider, TooltipProvider, TooltipLayer } from './ui';
import { Canvas, type CanvasApi } from './Canvas';
import { DocumentActions } from './DocumentActions';
import { SelectionBar, SelectionProperties } from './SelectionActions';
import { VariablesEditor } from './PropertyEditors';
import { DOCUMENT_SCOPE } from '../shared/learning';
import { AgentModal } from './AgentModal';
import { requestTitleEdit, visual } from './Blocks';
import { connectOperations, groupOperations, layoutDocument, moveOperations, newId, releaseOperations, topSelection, type Point, type Rect } from './logic';
import { isMacPlatform, keyboard, type PanelKey } from './web';
import { Onboarding } from './Onboarding';
import { claimFirstGuide } from './guide';
import { canvasPreferences, interfacePreferences } from '../shared/preferences';
import { tokens } from './tokens';
import { withAlpha, type Tone } from './color';
import { usePresentation } from './usePresentation';
import { ExtensionTool, extensionIcon } from './Extensions';
import { StyleIsland, LibraryPopover } from './FloatingTools';
import type { RecentIcon } from './icon-library';
import { DEFAULT_TOOL_STYLE, type CanvasTool, type ToolStyle, type SvgInsertOptions } from './whiteboard-tools';
import { islandStyle } from './whiteboard-visuals';
import { type linkBlock } from './media';
import { panelFits } from './panel-actions';
import { LinkSheet, SvgSheet } from './AddSheets';
import { isWhiteboardRenderer, learnerLayerIds, strokeLayers, type WbRenderer, type WbDrawData, type WbShape } from '../shared/whiteboard';
import { Toolbar, GLOSSARY, shapeIcon, type ToolId, type PinnedTool } from './Toolbar';
import { AddMenu, type ToolEntry } from './AddMenu';
import { RightPanel, PanelSection, type PanelTab } from './RightPanel';
import { CommandPalette } from './CommandPalette';
import { EmptyMate, Kettle, LoadingEgg, MateDrawing } from './Eggs';
import { applies, comboParts, eventCombo, formatCombo, shortcutRegistry } from './shortcuts';
import { remember, type PaletteItem } from './palette';
import { getClientRenderer } from './renderers';
import { HojaControls, HojaMenu, LatestPill, useCopilotCanvas } from './Hojas';
import { Screen, sheetFrame } from './Screen';
import { LienzosScreen } from './LienzosScreen';
import { HistoryScreen } from './HistoryScreen';
import { ExtensionsContent } from './ExtensionsScreen';
import { WikiContent } from './WikiScreen';
import { HOME_PAGE, allWikiPages, pageForSelection, searchWiki } from '../shared/wiki';
import { SettingsContent, settingsRail, type SettingsSection } from './SettingsScreen';

type ViewMode = 'canvas' | 'outline';
type InspectorSection = 'document' | 'communication' | 'history';
/** The one screen open over the canvas, if any (docs/redesign-2026-10.md, "UI pass"). */
type ScreenState = { kind: 'lienzos' } | { kind: 'history' } | { kind: 'extensions' } | { kind: 'settings'; section: SettingsSection } | { kind: 'help'; page: string };
type VentanaKind = 'page' | 'image' | 'video' | 'audio';
const F = tokens.face;
/** What ⌘K ran last, per host and workspace, for as long as this client runs. */
const recentByScope = new Map<string, string[]>();

function EmptyState({ title, description, error, art, children }: { title: string; description?: string; error?: string; art?: React.ReactNode; children: React.ReactNode }) {
  const u = useUI();
  return <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
    <View style={{ width: '100%', maxWidth: tokens.size.emptyStateMaxWidth, gap: 12, alignItems: 'center' }}>
      {art ?? <View style={{ width: 56, height: 56, borderRadius: tokens.radius.group, backgroundColor: u.wash(error ? 'riesgo' : 'acento'), alignItems: 'center', justifyContent: 'center' }}><Icon name={error ? 'CircleAlert' : 'Frame'} size={24} color={error ? u.c.statusDanger : u.c.accent} /></View>}
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
  return minutes < 1 ? 'just now' : minutes < 60 ? minutes + ' min ago' : minutes < 1440 ? Math.floor(minutes / 60) + ' h ago' : Math.floor(minutes / 1440) + ' d ago';
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
  return <View accessibilityLabel="Loading the Lienzo" style={{ flex: 1, padding: 24, gap: 16, overflow: 'hidden' }}>
    <Animated.View style={{ opacity, borderWidth: 1.5, borderColor: u.c.border, borderRadius: tokens.radius.group, padding: 16, gap: 12, maxWidth: 352 }}>
      <View style={{ height: 12, width: '65%', backgroundColor: u.c.surface2, borderRadius: 4 }} />
      {[0, 1, 2].map(i => <View key={i} style={{ width: tokens.size.blockWidth.standard, maxWidth: '100%', height: 96, backgroundColor: u.c.surface2, borderRadius: tokens.radius.block }} />)}
    </Animated.View>
    <View style={{ height: 8, width: 120, backgroundColor: u.c.surface2, borderRadius: 4 }} />
    <View style={{ height: 8, width: 180, backgroundColor: u.c.surface2, borderRadius: 4 }} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 }}><LoadingEgg />{slow && <Txt kind="small" muted>Still loading…</Txt>}</View>
  </View>;
}

function Presence({ id, open }: { id: string | null; open: () => void }) {
  const u = useUI(), agent = useAgent(id ?? '', a => ({ title: a.title, status: a.status }));
  // A host without agents (the desktop app) knows who connected over MCP, not whether it is working: no status.
  if (!capabilities.runsAgents) return <Pressable accessibilityRole="button" accessibilityLabel={id ? 'Agent connected over MCP: ' + (agent?.title || 'unknown client') : 'Connect an agent'} onPress={open} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 160, padding: 6 }}><View style={{ width: 12 }}><Icon name={id ? 'Bot' : 'Unplug'} size={12} color={u.c.foregroundMuted} /></View><Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{id ? agent?.title || 'MCP client' : 'No agent'}</Txt></Pressable>;
  const status = agent?.status === 'running' ? 'working' : agent?.status === 'idle' ? 'idle' : agent?.status === 'error' ? 'with an error' : agent?.status === 'closed' ? 'closed' : agent ? 'starting' : 'no data';
  const color = agent?.status === 'running' ? u.c.accent : agent?.status === 'idle' ? u.c.statusSuccess : agent?.status === 'error' || agent?.status === 'closed' ? u.c.statusDanger : u.c.foregroundMuted;
  return <Pressable accessibilityRole="button" accessibilityLabel={id ? 'Agent connected: ' + (agent?.title || 'Agent unavailable') + ', ' + status : 'Connect an agent'} onPress={open} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 160, padding: 6 }}><View style={{ width: 12 }}><Icon name={id ? 'Bot' : 'Unplug'} size={12} color={u.c.foregroundMuted} /></View>{id && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />}<Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{id ? agent?.title || 'Agent unavailable' : 'No agent'}</Txt></Pressable>;
}
export function LienzoPanel(props: PanelProps) { return <UIProvider theme={props.theme} layout={props.layout} host={props.host}><Panel key={`${props.host.id}:${props.workspaceId}`} workspaceId={props.workspaceId} hostId={props.host.id} /></UIProvider>; }
function Panel({ workspaceId, hostId }: { workspaceId: string; hostId: string }) {
  const u = useUI(), raw = useCanvas(workspaceId), toast = useToast(), settings = useSettings(canvasPreferences), prefs = useSettings(interfacePreferences);
  const c = useMemo<CanvasController>(() => ({ ...raw,
    failure: raw.failure ? { ...raw.failure, message: friendlyError(raw.failure.message) } : null,
  }), [raw]);
  const doc = c.view?.document;
  const [width, setWidth] = useState(0), [panelHeight, setPanelHeight] = useState(0), [toolbarBox, setToolbarBox] = useState({ x: 0, width: 0 });
  const [extTools, setExtTools] = useState<string[]>([]), [screen, setScreen] = useState<ScreenState | null>(null);
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false), [overflow, setOverflow] = useState(false), [reload, setReload] = useState(false);
  const [tool, setTool] = useState<CanvasTool>('select'), [toolStyle, setToolStyle] = useState<ToolStyle>(DEFAULT_TOOL_STYLE), [toolLocked, setToolLocked] = useState(false), [shapePick, setShapePick] = useState<WbShape>('rect');
  const [addOpen, setAddOpen] = useState(false), [libraryOpen, setLibraryOpen] = useState(false), [svgOpen, setSvgOpen] = useState(false), [libraryError, setLibraryError] = useState(''), [svgBusy, setSvgBusy] = useState(false);
  const [interactionId, setInteractionId] = useState<string | null>(null), [rename, setRename] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false), [kettle, setKettle] = useState(0);
  const scope = `${hostId}:${workspaceId}`, [recent, setRecent] = useState<string[]>(() => recentByScope.get(scope) ?? []);
  const [panel, setPanel] = useState<{ pinned: boolean; hidden: boolean; forced: boolean; tab: string; focus: string | null }>({ pinned: false, hidden: false, forced: false, tab: 'properties', focus: null });
  const [pinnedLocal, setPinnedLocal] = useState<string[] | null>(null), [overridesLocal, setOverridesLocal] = useState<Record<string, string> | null>(null), [, setRegistryTick] = useState(0), [recentLocal, setRecentLocal] = useState<RecentIcon[] | null>(null);
  const [undoLabel, setUndoLabel] = useState('');
  useEffect(() => { if (!undoLabel) return; const timer = setTimeout(() => setUndoLabel(''), 5000); return () => clearTimeout(timer); }, [undoLabel]);
  useEffect(() => shortcutRegistry.subscribe(() => setRegistryTick(t => t + 1)), []);
  const [saveSlow, setSaveSlow] = useState(false);
  const [ventana, setVentana] = useState<VentanaKind | null>(null);
  // Hide all UI (⌘.) hides the floating controls. Failures and the canvas zoom stay visible.
  const [immersive, setImmersive] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false), guideClaim = useRef(false), guideMounted = useRef(true);
  useEffect(() => { guideMounted.current = true; return () => { guideMounted.current = false; }; }, []);
  useEffect(() => {
    if (!c.catalog || c.loading || guideClaim.current || settings.status !== 'ready' || settings.values.guideSeen || settings.saving || settings.saveError) return;
    guideClaim.current = true;
    void claimFirstGuide(settings).then(show => { if (show && guideMounted.current) setGuideOpen(true); });
  }, [c.catalog, c.loading, settings]);
  const closeGuide = () => setGuideOpen(false);
  // A selected link is view state, like the selection highlight; every change to the link itself goes through c.edit.
  const [linkId, setLinkId] = useState<string | null>(null);
  const addRef = useRef<View>(null);
  const root = useRef<View>(null), canvas = useRef<CanvasApi>(null), geometry = useRef<{ rects: Map<string, Rect>; center: Point }>({ rects: new Map(), center: { x: 24, y: 24 } });
  const disabled = c.busy || c.offline || c.loading;
  const mac = isMacPlatform();
  // ---- Shortcuts and pins: the person's choices live in the host's `interface` settings; the registry resolves them.
  const savedPrefs = prefs.status === 'ready' ? prefs.values as { pinned?: string[]; shortcuts?: Record<string, string>; recentIcons?: RecentIcon[] } : undefined;
  const pinnedIds = pinnedLocal ?? savedPrefs?.pinned ?? [], overrides = overridesLocal ?? savedPrefs?.shortcuts ?? {}, recentIcons = recentLocal ?? savedPrefs?.recentIcons ?? [];
  const savePrefs = (patch: { pinned?: string[]; shortcuts?: Record<string, string>; recentIcons?: RecentIcon[] }) => {
    if (patch.pinned) setPinnedLocal(patch.pinned); if (patch.shortcuts) setOverridesLocal(patch.shortcuts); if (patch.recentIcons) setRecentLocal(patch.recentIcons);
    if (prefs.status !== 'ready') return;
    // Recent icons are a convenience: losing one is not worth a notice.
    void prefs.save({ pinned: patch.pinned ?? pinnedIds, shortcuts: patch.shortcuts ?? overrides, recentIcons: patch.recentIcons ?? recentIcons }, prefs.revision).then(saved => { if (!saved && !patch.recentIcons) toast.error('Your choice was not saved for next time. It still applies now.'); });
  };
  const resolved = shortcutRegistry.resolve(overrides);
  const copilot = useCopilotCanvas({ c, fly: ids => canvas.current?.flyToIds(ids), geometry, center: () => canvas.current?.viewportCenter(), active: !(u.compact && ['select', 'svg'].includes(tool)) && !!c.view });
  const keyLabel = (id: string) => { const combo = resolved.list.find(s => s.id === id)?.assigned[0]; return combo ? formatCombo(combo, mac) : undefined; };
  const chips = (combo: string) => comboParts(combo, mac);
  useEffect(() => { if (c.arrival) toast.show(`New Lienzo: “${c.arrival.title}”`, { variant: 'info' }); }, [c.arrival?.id]);
  useEffect(() => { setReload(false); setLinkId(null); setExtTools([]); geometry.current = { rects: new Map(), center: { x: 24, y: 24 } }; }, [doc?.id]);
  useEffect(() => { setAddOpen(false); }, [u.compact]);
  useEffect(() => { if (linkId && (c.selection.length || !doc?.links.some(l => l.id === linkId))) setLinkId(null); }, [linkId, c.selection, doc?.links]);
  // A new selection brings the panel back if the person had hidden it, and a section asked for earlier is forgotten.
  useEffect(() => { if (c.selection.length || linkId) setPanel(p => p.hidden || p.focus ? { ...p, hidden: false, focus: null } : p); }, [c.selection.join('|'), linkId]);
  const selectLink = (id: string | null) => { setLinkId(id); };
  function connectSelection() {
    if (!doc || disabled || c.selection.length !== 2) return false; const [from, to] = c.selection, name = (id: string) => [...doc.blocks, ...doc.groups].find(e => e.id === id)?.title || 'Untitled';
    const { existing, operations, id } = connectOperations(doc, from, to);
    if (existing) { toast.show('That link already exists'); selectLink(existing.id); void c.select([]); return true; }
    if (!operations.length) return false;
    void c.edit(operations, `Connect “${name(from)}” → “${name(to)}”`).then(next => { if (next && id) { selectLink(id); void c.select([]); } }); return true;
  }
  const showPanel = (focus: string | null = null) => setPanel(p => ({ ...p, hidden: false, forced: true, tab: 'properties', focus }));
  const inspectorOpen = (section: InspectorSection = 'document') => {
    setImmersive(false); // asking for details leaves Hide all UI so the request is visible
    if (section === 'history') { setScreen({ kind: 'history' }); return; }
    if (section === 'communication') { void c.select([]); setLinkId(null); }
    showPanel(section === 'communication' ? 'instruction' : null);
  };
  const openScreen = (next: ScreenState) => { setAddOpen(false); setLibraryOpen(false); setOverflow(false); setPaletteOpen(false); setImmersive(false); setScreen(next); };
  const openExtensions = () => openScreen({ kind: 'extensions' });
  const openHelp = (page: string = HOME_PAGE) => openScreen({ kind: 'help', page });
  const openSettings = (section: SettingsSection = 'shortcuts') => openScreen({ kind: 'settings', section });
  function openDocuments() { openScreen({ kind: 'lienzos' }); }
  async function newCanvas() {
    if (disabled) return;
    const next = await c.create({ title: 'Untitled Lienzo', description: '', example: false, blocks: [], groups: [], links: [], selectedIds: [], communication: { instructions: '', intent: '', audience: '' } });
    if (next) { setScreen(null); setLinkId(null); }
  }
  async function changeRevision(kind: 'undo' | 'redo') {
    if (disabled || !(kind === 'undo' ? c.view?.canUndo : c.view?.canRedo)) return;
    const next = await c.revision(kind);
    if (next) toast.show(kind === 'undo' ? 'Undone' : 'Redone', { variant: 'success' });
  }
  const noticeUndo = (label: string) => { setUndoLabel(label); toast.show(label + ' · Undo'); };
  function ungroupSelection() { const group = doc?.groups.find(g => c.selection.length === 1 && g.id === c.selection[0]); if (group && !disabled) void c.edit([{ type: 'group.delete', id: group.id, ungroup: true }], 'Unwrap Frame'); }
  function editSelectedText() {
    const block = doc?.blocks.find(b => b.id === c.selection[0]);
    if (!u.compact && block && isWhiteboardRenderer(c.catalog?.blockTypes.find(t => t.id === block.typeId)?.renderer)) canvas.current?.editSelection();
    else if (!(block && mode === 'canvas' && requestTitleEdit(block.id))) showPanel();
  }
  function reorder(id: string, delta: number) {
    if (!doc || disabled) return; const entity = [...doc.blocks, ...doc.groups].find(e => e.id === id), group = doc.groups.find(g => g.id === entity?.parentGroupId); if (!entity || !group) return;
    const key = 'typeId' in entity! ? 'blockIds' : 'groupIds', ids = [...group[key]], index = ids.indexOf(id), to = index + delta; if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]]; void c.edit([{ type: 'group.update', id: group.id, patch: { [key]: ids } }], delta < 0 ? 'Move earlier' : 'Move later');
  }
  const rectsNow = () => geometry.current.rects.size ? geometry.current.rects : layoutDocument(doc!, {}, c.catalog);
  /** "Release position" / "Arrange automatically": hands pinned entities back to the layout of their container. */
  function release(ids: string[], label = ids.length === 1 ? 'Release position' : 'Arrange automatically') {
    if (!doc || disabled || !ids.length) return;
    // A transaction carries 200 operations; a large container is released in consecutive transactions, one entity never split.
    const items = topSelection(doc, ids);
    for (const item of items) {
      const operations = releaseOperations(doc, [item.id], c.catalog);
      if (operations.length > 200 || item.position && !operations.length) { c.fail(new Error(`Cannot release the position of “${item.title || 'Untitled'}”: ${operations.length > 200 ? 'it needs more than the 200 operations of one transaction' : 'its type is no longer in the catalog'}.`)); return; }
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
          if (operations.length > 200 || item?.position && !operations.length) { c.fail(new Error(`Could not release the position of “${item?.title || 'Untitled'}”.`)); return; }
          if (batch.length + operations.length > 200) break;
          remaining.shift(); batch.push(...operations);
        }
        if (!batch.length) continue;
        const next = await c.edit(batch, label); if (!next) return;
        changed = true; await c.select(selection.filter(id => [...next.document.blocks, ...next.document.groups].some(e => e.id === id)));
      }
      toast.show(changed ? ids.length === 1 ? 'Back in the automatic order' : 'Arranged automatically' : 'No positions to release');
    })();
  }
  function groupSelection() {
    if (!doc || !c.selection.length || disabled) return; const id = newId('group'), operations = groupOperations(doc, rectsNow(), c.selection, id, c.catalog); if (!operations.length) return;
    void (async () => { const result = await c.edit(operations, `Wrap ${operations.length - 1} in a Frame`); if (result) await c.select([id]); })();
  }
  function removeSelection() { if (doc && !disabled) { const items = topSelection(doc, c.selection); if (items.length > 200) { toast.error('Delete at most 200 things at a time.'); return; } if (items.length) void c.edit(items.map(e => ({ type: 'groupIds' in e ? 'group.delete' : 'block.delete', id: e.id } as CanvasOperation)), 'Delete selection').then(next => { if (next) noticeUndo('Deleted'); }); } }
  const removeLinkOrSelection = () => { if (linkId && !c.selection.length) { if (!disabled) void c.edit([{ type: 'link.delete', id: linkId }], 'Delete link').then(next => { if (next) { setLinkId(null); noticeUndo('Deleted'); } }); } else removeSelection(); };
  function duplicateSelection() {
    if (!doc || disabled) return;
    const items = topSelection(doc, c.selection), copies = items.map(item => ({ item, prefix: newId('copy') }));
    if (!copies.length) return;
    if (copies.length > 200) { toast.error('Duplicate at most 200 things at a time.'); return; }
    void c.edit(copies.map(({ item, prefix }) => ({ type: 'entity.duplicate', id: item.id, idPrefix: prefix })), 'Duplicate selection').then(next => { if (next) void c.select(copies.map(({ item, prefix }) => prefix + '.' + item.id)); });
  }
  function insert(type: BlockType, data = type.defaults, title = type.name): Promise<boolean> {
    if (!doc) { openDocuments(); return Promise.resolve(false); } if (disabled) return Promise.resolve(false);
    if (isWhiteboardRenderer(type.renderer)) { if (type.renderer === 'wb-svg') setSvgOpen(true); else chooseTool(type.renderer === 'wb-text' ? 'text' : type.renderer === 'wb-shape' ? 'shape' : 'draw'); return Promise.resolve(false); }
    const parent = c.selection.length === 1 ? doc.groups.find(g => g.id === c.selection[0]) : undefined;
    const activeBlock = c.selection.length === 1 ? doc.blocks.find(block => block.id === c.selection[0]) : undefined, rect = activeBlock ? rectsNow().get(activeBlock.id) : undefined;
    const parentGroupId = parent?.id ?? activeBlock?.parentGroupId ?? null, parentRect = parentGroupId ? rectsNow().get(parentGroupId) : undefined;
    const position = rect ? { x: rect.x + rect.width + tokens.graph.gap.node - (parentRect?.x ?? 0), y: rect.y - (parentRect?.y ?? 0) } : parent ? undefined : geometry.current.center;
    const id = newId('block');
    return (async () => { const next = await c.edit([{ type: 'block.create', block: { id, title, typeId: type.id, data, parentGroupId, ...(position ? { position } : {}) } }], `Add ${type.name}`); if (next) await c.select([id]); return !!next; })();
  }
  /** M: a new, empty Frame in the middle of the view (inside the selected Frame, if one is selected). */
  function createGroup() {
    if (!doc) { openDocuments(); return; } if (disabled) return;
    const parent = c.selection.length === 1 ? doc.groups.find(group => group.id === c.selection[0]) : undefined, id = newId('group');
    void c.edit([{ type: 'group.create', group: { id, title: 'Untitled Frame', description: '', blockIds: [], groupIds: [], parentGroupId: parent?.id ?? null, ...(!parent ? { position: geometry.current.center } : {}) } }], 'Add Frame').then(next => { if (next) void c.select([id]); });
  }
  const openVentana = (kind: VentanaKind) => { if (!doc) { openDocuments(); return; } setAddOpen(false); setVentana(kind); };
  /** W: a Window. A web page becomes a live preview; an image, video or audio link becomes a player (AddSheets.tsx). */
  async function insertLink(link: ReturnType<typeof linkBlock>): Promise<boolean> {
    if (!doc || disabled) return false;
    const type = link.renderer === 'preview-frame' ? c.catalog?.blockTypes.find(type => type.renderer === 'preview-frame') : c.catalog?.blockTypes.find(type => type.id === 'media' && type.renderer === 'image-ref');
    if (!type) { toast.error('That kind of Window is not in the local catalog.'); return false; }
    return insert(type, { ...type.defaults, ...link.data }, link.title);
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
  // "Clear my strokes": only the learner's own drawings, in one undoable transaction. The agent's and the author's stay.
  const myLayers = strokeLayers(doc?.blocks ?? [], b => c.catalog?.blockTypes.find(t => t.id === b.typeId)?.renderer === 'wb-draw').filter(layer => layer.author === 'learner');
  const clearMyStrokes = () => { const ids = learnerLayerIds(myLayers); if (ids.length && !c.busy && !c.offline) void c.edit(ids.map(id => ({ type: 'block.delete' as const, id })), 'Clear my strokes'); };
  const mode: ViewMode = u.compact && ['select', 'svg'].includes(tool) ? 'outline' : 'canvas';
  function chooseTool(next: CanvasTool) {
    if (!doc) { openDocuments(); return; }
    if (disabled && !['select', 'hand'].includes(next)) return;
    if (next === 'svg') { setAddOpen(false); setLibraryOpen(true); return; }
    canvas.current?.cancelGesture(); setTool(next); setToolLocked(false); setLibraryOpen(false);
    // The tool in hand brings its options to the front of the right panel.
    setPanel(p => ({ ...p, hidden: false, tab: ['text', 'shape', 'draw', 'eraser'].includes(next) ? 'tool' : p.tab }));
  }
  const toolId: ToolId | null = tool === 'select' ? 'select' : tool === 'hand' ? 'hand' : tool === 'draw' ? 'pencil' : tool === 'text' ? 'text' : tool === 'eraser' ? 'eraser' : tool === 'shape' ? toolStyle.shape === 'line' && toolStyle.heads !== 'none' ? 'arrow' : 'shape' : null;
  function pickShape(shape: WbShape) { if (!doc) { openDocuments(); return; } setShapePick(shape); setToolStyle(previous => ({ ...previous, shape, heads: 'none' })); chooseTool('shape'); }
  function chooseToolId(id: ToolId) {
    if (id === 'marco') { createGroup(); return; }
    if (id === 'ventana') { openVentana('page'); return; }
    if (id === 'shape') { pickShape(shapePick); return; }
    if (id === 'arrow') { if (!doc) { openDocuments(); return; } setToolStyle(previous => ({ ...previous, shape: 'line', heads: 'end' })); chooseTool('shape'); return; }
    chooseTool(id === 'pencil' ? 'draw' : id);
  }
  useEffect(() => { if (c.offline) { canvas.current?.cancelGesture(); setTool('select'); setToolLocked(false); } }, [c.offline]);
  useEffect(() => {
    if (!c.busy) { setSaveSlow(false); return; }
    const timer = setTimeout(() => setSaveSlow(true), 400); return () => clearTimeout(timer);
  }, [c.busy]);
  useEffect(() => { setTool('select'); setToolLocked(false); setAddOpen(false); setLibraryOpen(false); setSvgOpen(false); setLibraryError(''); setInteractionId(null); setRename(false); setVentana(null); }, [doc?.id]);
  function changeStyle(patch: Partial<ToolStyle>) {
    if (disabled) return;
    setToolStyle(previous => ({ ...previous, ...patch }));
    const documentId = doc?.id, ids = selectedWhiteboard.map(block => block.id);
    if (!documentId || !ids.length) return;
    if (ids.length > 200) { toast.error('Change the style of up to 200 things at a time.'); return; }
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
      const label = patch.color !== undefined && patch.fillColor === undefined ? 'Change colour' : patch.scale !== undefined ? 'Change size' : patch.fill !== undefined || patch.fillColor !== undefined ? 'Change fill' : patch.stroke !== undefined ? 'Change stroke' : patch.font !== undefined ? 'Change font' : patch.align !== undefined ? 'Change alignment' : patch.shape !== undefined ? 'Change shape' : 'Change arrowheads';
      if (operations.length) await c.edit(operations, label);
    })().catch(c.fail);
  }
  async function insertSvg(svg: string, meta: SvgInsertOptions = {}): Promise<boolean> {
    if (!doc || disabled || svgBusy) return false;
    const documentId = doc.id;
    setSvgBusy(true); setLibraryError('');
    try {
      const parent = c.selection.length === 1 ? doc.groups.find(group => group.id === c.selection[0]) : undefined;
      const result = await canvas.current?.insertSvg(svg, { ...meta, ...(parent && meta.parentGroupId === undefined ? { parentGroupId: parent.id } : {}) });
      if (c.current.current?.document.id !== documentId) return false;
      if (result) { setLibraryOpen(false); setTool('select'); }
      else setLibraryError('The SVG was not saved. See the notice on the canvas.');
      return result ?? false;
    } catch { setLibraryError('This SVG has active content or external links and cannot be imported.'); return false; }
    finally { setSvgBusy(false); }
  }
  // ---- What can be added: one list feeds the + catalog, pinned tools, keys 1–9 and ⌘K.
  // Tools the person or their agent added are read again whenever the catalog or the menu opens.
  const extensionTools = (c.catalog?.extensions ?? []).filter(e => e.kind === 'tool');
  useEffect(() => { if (addOpen || overflow || paletteOpen) void c.api.catalog({}).then(c.setCatalog).catch(() => {}); }, [addOpen, overflow, paletteOpen]);
  const toggleExtension = (id: string) => { if (!doc) { openDocuments(); return; } setExtTools(open => open.includes(id) ? open.filter(x => x !== id) : [...open, id]); setPanel(p => ({ ...p, hidden: false, tab: 'ext:' + id })); };
  const typeOf = (renderer: string) => c.catalog?.blockTypes.find(t => t.renderer === renderer);
  const entries: ToolEntry[] = (() => {
    const shape = (id: WbShape, name: string, description: string, shortcut?: string): ToolEntry => ({ id: 'shape.' + id, section: 'Shapes & drawing', name, description, icon: shapeIcon(id), keywords: 'shape ' + id, shortcut: shortcut && keyLabel(shortcut), active: toolId === 'shape' && toolStyle.shape === id, run: () => pickShape(id) });
    const list: ToolEntry[] = [
      { id: 'pencil', section: 'Shapes & drawing', name: 'Pencil', description: 'Freehand strokes. Yours are solid; the agent’s are dashed.', icon: 'Pencil', keywords: 'draw freehand pen', shortcut: keyLabel('tool.pencil'), active: toolId === 'pencil', run: () => chooseToolId('pencil') },
      shape('rect', 'Rectangle', 'Drag to size it; Shift keeps it square.', 'tool.rectangle'), shape('ellipse', 'Ellipse', 'Drag to size it; Shift keeps it round.', 'tool.ellipse'),
      shape('diamond', 'Diamond', 'For a decision or a turning point.'), shape('triangle', 'Triangle', 'A plain triangle.'), shape('rounded', 'Rounded rectangle', 'Softer corners.'),
      shape('hexagon', 'Hexagon', 'A hexagon.'), shape('cylinder', 'Cylinder', 'The usual drawing of a database.'), shape('line', 'Line', 'A straight line; Shift snaps to 15°.'),
      { id: 'arrow', section: 'Shapes & drawing', name: 'Arrow', description: 'A line with an arrowhead.', icon: 'MoveUpRight', keywords: 'line connector', shortcut: keyLabel('tool.arrow'), active: toolId === 'arrow', run: () => chooseToolId('arrow') },
      { id: 'text', section: 'Shapes & drawing', name: 'Text', description: 'A free label, without a card.', icon: 'Type', keywords: 'label write', shortcut: keyLabel('tool.text'), active: toolId === 'text', run: () => chooseToolId('text') },
      { id: 'eraser', section: 'Shapes & drawing', name: 'Eraser', description: 'Removes whole strokes; Undo brings them back.', icon: 'Eraser', keywords: 'delete rub', shortcut: keyLabel('tool.eraser'), active: toolId === 'eraser', run: () => chooseToolId('eraser') },
      { id: 'marco', section: 'Shapes & drawing', name: 'Frame', description: GLOSSARY.marco, icon: 'SquareDashed', keywords: 'frame group area container', shortcut: keyLabel('tool.marco'), run: createGroup },
      { id: 'icons', section: 'Shapes & drawing', name: 'Icons', description: 'Search icons to drop on the canvas: a set that works offline, and open sets online.', icon: 'Shapes', keywords: 'svg library icon lucide iconify logo server database architecture', run: () => chooseTool('svg') },
      { id: 'svg', section: 'Shapes & drawing', name: 'Import SVG…', description: 'A vector drawing from code, a file or a link.', icon: 'Upload', keywords: 'vector image', run: () => setSvgOpen(true) },
      { id: 'ventana', section: 'Embeds', name: 'Window', description: GLOSSARY.ventana, icon: 'AppWindow', keywords: 'web page iframe embed preview window site', shortcut: keyLabel('tool.ventana'), run: () => openVentana('page') },
      { id: 'image', section: 'Embeds', name: 'Image', description: 'A picture from a link.', icon: 'Image', keywords: 'photo picture media', run: () => openVentana('image') },
      { id: 'video', section: 'Embeds', name: 'Video', description: 'A video file, YouTube or Vimeo link. Never autoplays.', icon: 'Video', keywords: 'youtube vimeo media', run: () => openVentana('video') },
      { id: 'audio', section: 'Embeds', name: 'Audio', description: 'A sound file from a link.', icon: 'AudioLines', keywords: 'sound media podcast', run: () => openVentana('audio') },
    ];
    for (const [renderer, keywords] of [['html', 'mini app html javascript ventana'], ['file-tree', 'files folders project']] as const) { const type = typeOf(renderer); if (type) list.push({ id: 'type.' + type.id, section: 'Embeds', name: type.name, description: type.description, icon: visual(type).icon, tone: visual(type).tone as Tone, keywords, run: () => insert(type) }); }
    for (const type of c.catalog?.blockTypes ?? []) {
      if (isWhiteboardRenderer(type.renderer) || ['html', 'file-tree', 'preview-frame', 'image-ref'].includes(type.renderer ?? '')) continue;
      const v = visual(type); list.push({ id: 'type.' + type.id, section: 'Blocks', name: type.name, description: type.description, icon: v.icon, tone: v.tone as Tone, keywords: (getClientRenderer(type.renderer) ? 'interactive ' : '') + type.id, run: () => insert(type) });
    }
    for (const extension of extensionTools) list.push({ id: 'ext.' + extension.id, section: 'Extensions', name: extension.name, description: extension.description || 'A tool from an extension.', icon: extensionIcon(extension), keywords: 'extension tool', active: extTools.includes(extension.id), run: () => toggleExtension(extension.id) });
    return list.map(e => ({ ...e, disabled: !doc || (disabled && e.section !== 'Extensions') }));
  })();
  const pinnedEntries = pinnedIds.map(id => entries.find(e => e.id === id)).filter((e): e is ToolEntry => !!e);
  const togglePin = (id: string) => { const next = pinnedIds.includes(id) ? pinnedIds.filter(x => x !== id) : [...pinnedIds, id].slice(-F.toolbar.maxPinned); savePrefs({ pinned: next }); };
  const pinnedTools: PinnedTool[] = pinnedEntries.map(e => ({ id: e.id, label: e.name, icon: e.icon, color: e.tone && e.tone !== 'neutro' ? u.tone(e.tone) : undefined, detail: e.description, active: e.active, onPress: e.run }));
  // ---- The right panel: Properties of the selection, the tool's options, extension tools; the document when asked.
  const hasSelection = !!doc && (!!c.selection.length || !!linkId), toolOptions = !!doc && ['text', 'shape', 'draw', 'eraser'].includes(tool);
  const styleNode = (selectionKinds.size > 0 || toolOptions) ? <StyleIsland bare tool={tool} selectionKinds={selectionKinds} value={displayedStyle} onChange={changeStyle} orientation="vertical" touch={u.compact} disabled={disabled} myStrokes={myLayers.reduce((sum, layer) => sum + layer.strokes, 0)} onClearMyStrokes={clearMyStrokes} /> : null;
  const selectionProperties = doc && hasSelection ? <SelectionProperties controller={c} panelRoot={root} disabled={disabled} linkId={linkId} onLink={selectLink} focus={panel.focus}
    add={() => setAddOpen(true)} duplicate={duplicateSelection} remove={removeLinkOrSelection} groupSelection={groupSelection} connectSelection={connectSelection} release={release}
    rects={rectsNow} editText={editSelectedText} interact={() => canvas.current?.beginInteraction()} undoNotice={noticeUndo}
    style={selectionKinds.size > 0 ? styleNode : undefined} /> : null;
  const documentProperties = doc ? <View nativeID="lienzo-properties-document">
    <View style={{ paddingHorizontal: F.rightPanel.padding, paddingVertical: 10, gap: 2 }}><Txt kind="label" muted>Lienzo</Txt><Txt kind="bodyStrong" numberOfLines={2}>{doc.title}</Txt><Txt kind="small" muted>{GLOSSARY.lienzo}</Txt></View>
    <PanelSection title="This Lienzo"><DocumentActions controller={c} section="document" rects={rectsNow} release={release} /></PanelSection>
    <PanelSection title="Variables" defaultOpen={!!doc.variables?.length}><VariablesEditor controller={c} scopeId={DOCUMENT_SCOPE} disabled={disabled} /></PanelSection>
  </View> : null;
  const toolName = toolId ? { select: 'Select', hand: 'Hand', pencil: 'Pencil', shape: 'Shape', text: 'Text', arrow: 'Arrow', eraser: 'Eraser', marco: 'Frame', ventana: 'Window' }[toolId] : 'Tool';
  const tabs: PanelTab[] = [];
  // The "?" of Properties opens the Help page of what is selected.
  const selectionHelp = (() => {
    if (!doc || !hasSelection) return HOME_PAGE;
    if (!c.selection.length) return pageForSelection({ kind: 'link' });
    if (c.selection.length > 1) return pageForSelection({ kind: 'many' });
    const group = doc.groups.find(g => g.id === c.selection[0]), block = doc.blocks.find(b => b.id === c.selection[0]);
    return group ? pageForSelection({ kind: 'frame', sheet: !!group.sheet }) : pageForSelection({ kind: 'block', typeId: block?.typeId ?? '' });
  })();
  if (hasSelection) tabs.push({ id: 'properties', label: 'Properties', icon: 'SlidersHorizontal', content: selectionProperties, help: () => openHelp(selectionHelp) });
  if (toolOptions && styleNode) tabs.push({ id: 'tool', label: toolName + ' options', icon: tool === 'draw' ? 'Pencil' : tool === 'text' ? 'Type' : tool === 'eraser' ? 'Eraser' : 'Shapes', content: <View nativeID="lienzo-tool-options" style={{ padding: F.rightPanel.padding }}>{styleNode}</View> });
  for (const id of extTools) { const extension = extensionTools.find(e => e.id === id); if (extension && doc) tabs.push({ id: 'ext:' + id, label: extension.name, icon: extensionIcon(extension), help: () => openHelp(pageForSelection({ kind: 'extension', id: extension.id })), scroll: false, content: <ExtensionTool key={id} extension={extension} controller={c} onOpen={id => { void c.select([id]); }} onClose={() => setExtTools(open => open.filter(x => x !== extension.id))} height={Math.min(440, Math.max(240, panelHeight - F.top.height - 2 * tokens.island.inset - F.rightPanel.bottomClearance - F.rightPanel.tabs - 20))} /> }); }
  if (!tabs.length && (panel.pinned || panel.forced) && documentProperties) tabs.push({ id: 'properties', label: 'Lienzo', icon: 'Frame', content: documentProperties });
  // A selection opens Properties by itself only when it fits beside the canvas; on a narrow or compact panel it would
  // cover what was just pressed (a mini app, a control), so there it opens when asked, pinned or not.
  const roomy = panelFits(width, u.compact);
  const panelVisible = !!doc && !immersive && !panel.hidden && tabs.length > 0 && (roomy ? true : panel.forced);
  const activeTab = tabs.some(t => t.id === panel.tab) ? panel.tab : tabs[0]?.id ?? 'properties';
  // ⌘\ hides what is showing; it brings the panel back for the selection or the tool, or for the Lienzo when there is neither.
  const sources = hasSelection || (toolOptions && !!styleNode) || extTools.length > 0;
  const togglePanel = () => setPanel(p => panelVisible ? { ...p, hidden: true, forced: false } : { ...p, hidden: false, forced: !sources || !roomy });
  // ---- ⌘K: everything the panel can do, in one list.
  const paletteItems = (query: string): PaletteItem[] => {
    const items: PaletteItem[] = [
      { id: 'tool.select', group: 'Tools', title: 'Select', icon: 'MousePointer2', shortcut: resolved.list.find(s => s.id === 'tool.select')?.assigned[0], run: () => chooseToolId('select') },
      { id: 'tool.hand', group: 'Tools', title: 'Hand', icon: 'Hand', keywords: 'pan move', shortcut: resolved.list.find(s => s.id === 'tool.hand')?.assigned[0], run: () => chooseToolId('hand') },
      ...entries.map((e): PaletteItem => ({ id: e.id, group: e.section === 'Extensions' ? 'Extensions' : 'Tools', title: e.name, subtitle: e.description, icon: e.icon, keywords: e.keywords, disabled: e.disabled, verb: e.section === 'Extensions' ? 'Open' : 'Use', shortcut: e.shortcut ? resolved.list.find(s => s.id === ({ pencil: 'tool.pencil', 'shape.rect': 'tool.rectangle', 'shape.ellipse': 'tool.ellipse', arrow: 'tool.arrow', text: 'tool.text', eraser: 'tool.eraser', marco: 'tool.marco', ventana: 'tool.ventana' } as Record<string, string>)[e.id])?.assigned[0] : undefined, run: e.run })),
      { id: 'ext.manage', group: 'Extensions', title: 'Manage extensions…', subtitle: 'Add, export, or write your own', icon: 'Puzzle', keywords: 'extensions tools install file', run: openExtensions },
    ];
    const key = (id: string) => resolved.list.find(s => s.id === id)?.assigned[0];
    if (doc) {
      if (hasSelection) items.push(
        { id: 'action.duplicate', group: 'Actions', title: 'Duplicate', subtitle: 'The selection', icon: 'CopyPlus', shortcut: key('edit.duplicate'), disabled, run: duplicateSelection },
        { id: 'action.wrap', group: 'Actions', title: 'Wrap in a Frame', subtitle: GLOSSARY.marco, icon: 'SquareDashed', shortcut: key('edit.wrap'), disabled: disabled || !c.selection.length, run: groupSelection },
        { id: 'action.delete', group: 'Actions', title: 'Delete', subtitle: 'The selection', icon: 'Trash2', shortcut: key('edit.delete'), disabled, run: removeLinkOrSelection },
        { id: 'action.fitSelection', group: 'Actions', title: 'Fit selection', icon: 'Scan', shortcut: key('view.fitSelection'), run: () => canvas.current?.zoomToSelection() },
      );
      if (c.selection.length === 2) items.push({ id: 'action.connect', group: 'Actions', title: 'Connect the two', icon: 'Spline', disabled, run: () => { connectSelection(); } });
      items.push(
        { id: 'action.undo', group: 'Actions', title: 'Undo', icon: 'Undo2', shortcut: key('edit.undo'), disabled: disabled || !c.view?.canUndo, run: () => { void changeRevision('undo'); } },
        { id: 'action.redo', group: 'Actions', title: 'Redo', icon: 'Redo2', shortcut: key('edit.redo'), disabled: disabled || !c.view?.canRedo, run: () => { void changeRevision('redo'); } },
        { id: 'action.fitAll', group: 'Actions', title: 'Fit all', icon: 'Maximize', shortcut: key('view.fitAll'), run: () => canvas.current?.fit() },
        { id: 'action.lens', group: 'Actions', title: 'Cycle Lens', subtitle: GLOSSARY.lente, icon: 'Glasses', keywords: 'lens colour author age', shortcut: key('lens.cycle'), run: () => canvas.current?.cycleLens() },
        { id: 'action.hideUI', group: 'Actions', title: immersive ? 'Show the interface' : 'Hide all UI', icon: immersive ? 'Minimize2' : 'Maximize2', shortcut: key('ui.hide'), run: () => setImmersive(v => !v) },
        { id: 'action.panel', group: 'Actions', title: panelVisible ? 'Hide Properties' : 'Show Properties', icon: 'PanelRight', shortcut: key('panel.right'), run: togglePanel },
        { id: 'action.rename', group: 'Lienzos', title: 'Rename this Lienzo', icon: 'Pencil', disabled, run: () => setRename(true) },
      );
    }
    copilot.hojas.forEach((h, i) => items.push({ id: 'hoja.' + h.id, group: 'Sheets', title: `Sheet ${h.number}: ${h.title}`, subtitle: i === copilot.current ? 'You are here' : undefined, icon: 'BookOpen', verb: 'Go', run: () => { copilot.goToHoja(i); } }));
    if (c.view?.latestAgent?.ids.length) items.push({ id: 'agent.latest', group: 'Sheets', title: "Go to the agent's latest", subtitle: c.view.latestAgent.label, icon: 'Sparkles', verb: 'Go', run: () => { copilot.goToLatest(); } });
    items.push({ id: 'agent.follow', group: 'Sheets', title: copilot.follow ? 'Stop following the agent' : 'Follow the agent', subtitle: 'The camera goes wherever the agent draws', icon: 'Magnet', run: () => copilot.toggleFollow() });
    items.push({ id: 'lienzo.new', group: 'Lienzos', title: 'New Lienzo', subtitle: GLOSSARY.lienzo, icon: 'Plus', disabled, run: () => { void newCanvas(); } });
    items.push({ id: 'lienzo.all', group: 'Lienzos', title: 'All Lienzos', subtitle: 'Your Lienzos, with thumbnails', icon: 'LayoutGrid', keywords: 'home documents files open', run: openDocuments });
    for (const d of c.documents) if (d.id !== doc?.id) items.push({ id: 'lienzo.' + d.id, group: 'Lienzos', title: d.title, subtitle: relativeTime(d.updatedAt), icon: 'Frame', verb: 'Open', disabled: c.busy, run: () => { void c.open(d.id); } });
    items.push(
      { id: 'settings.open', group: 'Settings', title: 'Settings', subtitle: 'Shortcuts, toolbar, extensions, about', icon: 'Settings', keywords: 'preferences options', run: () => openSettings('shortcuts') },
      { id: 'settings.shortcuts', group: 'Settings', title: 'Keyboard shortcuts', subtitle: 'See and reassign keys', icon: 'Keyboard', keywords: 'keys keyboard bindings cheat sheet', shortcut: key('help.shortcuts'), run: () => openSettings('shortcuts') },
      { id: 'settings.toolbar', group: 'Settings', title: 'Toolbar', subtitle: 'Pinned tools', icon: 'PanelBottom', keywords: 'pin pinned tools', run: () => openSettings('toolbar') },
      { id: 'settings.about', group: 'Settings', title: 'About Lienzo', subtitle: 'Version and where your Lienzos live', icon: 'Info', keywords: 'version data path', run: () => openSettings('about') },
      { id: 'settings.agent', group: 'Settings', title: 'Agent connection', icon: 'Plug', keywords: 'assistant connect', disabled: !doc, run: () => setAgentsOpen(true) },
      { id: 'settings.instructions', group: 'Settings', title: 'Instructions for the agent', subtitle: 'How it should explain on this Lienzo', icon: 'Compass', disabled: !doc, run: () => inspectorOpen('communication') },
      { id: 'settings.history', group: 'Settings', title: 'History', subtitle: 'Every change, by day', icon: 'History', keywords: 'activity timeline changes', disabled: !doc, run: () => inspectorOpen('history') },
      { id: 'help.open', group: 'Settings', title: 'Help', subtitle: 'How every tool and block works, and what to ask your agent', icon: 'CircleHelp', keywords: 'help wiki docs guide manual how', run: () => openHelp() },
      { id: 'settings.guide', group: 'Settings', title: 'Lienzo guide', subtitle: 'Four short scenes', icon: 'BookOpen', keywords: 'tour onboarding help', run: () => { setScreen(null); setGuideOpen(true); } },
    );
    const q = query.trim();
    // Help pages join the results once there is something to search for.
    if (q) for (const page of searchWiki(allWikiPages(c.catalog?.extensions ?? []), q).slice(0, 6)) items.push({ id: 'help.' + page.id, group: 'Help', title: page.title, subtitle: page.summary, icon: page.icon, keywords: page.keywords, verb: 'Read', run: () => openHelp(page.id) });
    return items;
  };
  const runPaletteItem = (item: PaletteItem) => { const next = remember(recent, item.id, F.palette.recent); recentByScope.set(scope, next); setRecent(next); item.run(false); };
  // ---- Keys. Registered shortcuts go through the registry; the few contextual ones (Enter, Tab, arrows) stay here.
  const runShortcut = (id: string): boolean => {
    if (id.startsWith('pinned.')) { const entry = pinnedEntries[Number(id.slice(7)) - 1]; if (!entry || entry.disabled) return false; entry.run(); return true; }
    const tools: Record<string, () => void> = { 'tool.select': () => chooseToolId('select'), 'tool.hand': () => chooseToolId('hand'), 'tool.pencil': () => chooseToolId('pencil'), 'tool.rectangle': () => pickShape('rect'), 'tool.ellipse': () => pickShape('ellipse'), 'tool.text': () => chooseToolId('text'), 'tool.arrow': () => chooseToolId('arrow'), 'tool.eraser': () => chooseToolId('eraser'), 'tool.marco': createGroup, 'tool.ventana': () => openVentana('page') };
    if (tools[id]) { if (disabled && !['tool.select', 'tool.hand'].includes(id)) return false; tools[id](); return true; }
    switch (id) {
      case 'palette.open': setAddOpen(false); setPaletteOpen(true); return true;
      case 'help.shortcuts': openSettings('shortcuts'); return true;
      case 'lens.cycle': canvas.current?.cycleLens(); return true;
      case 'view.fitAll': canvas.current?.fit(); return true;
      case 'view.fitSelection': canvas.current?.zoomToSelection(); return true;
      case 'panel.right': togglePanel(); return true;
      case 'ui.hide': setAddOpen(false); setImmersive(v => !v); return true;
      case 'edit.undo': void changeRevision('undo'); return true;
      case 'edit.redo': void changeRevision('redo'); return true;
      case 'edit.duplicate': duplicateSelection(); return true;
      case 'edit.wrap': groupSelection(); return true;
      case 'edit.unwrap': ungroupSelection(); return true;
      case 'edit.delete': removeLinkOrSelection(); return true;
      case 'edit.selectAll': if (!doc) return false; void c.select([...doc.groups.filter(g => !g.parentGroupId), ...doc.blocks.filter(b => !b.parentGroupId)].map(e => e.id)); return true;
      case 'hoja.previous': return copilot.step(-1);
      case 'hoja.next': return copilot.step(1);
      case 'hoja.jump': if (!copilot.hojas.length) return false; copilot.setMenuOpen(true); return true;
      case 'agent.follow': copilot.toggleFollow(); return true;
      case 'agent.latest': return copilot.goToLatest();
      default: return false;
    }
  };
  const escape = () => {
    if (addOpen) { setAddOpen(false); return true; }
    if (libraryOpen) { setLibraryOpen(false); return true; }
    if (immersive) { setImmersive(false); return true; }
    if (interactionId) { canvas.current?.endInteraction(); return true; }
    if (tool !== 'select') { canvas.current?.cancelGesture(); chooseTool('select'); return true; }
    setOverflow(false); setLinkId(null); void c.select([]); return true;
  };
  const modalOpen = guideOpen || paletteOpen || !!screen || agentsOpen || (overflow && u.compact) || !!ventana || svgOpen;
  const keyState = { document: !!doc, canvas: mode === 'canvas', selection: !!c.selection.length || !!linkId };
  const reservedKey = (key: string) => { const combo = eventCombo({ key, shift: false, command: false }); return !!combo && resolved.byCombo.has(combo); };
  // The handlers are read through a ref so the listener is attached once and always sees this render's state.
  const keys = useRef<{ main(e: PanelKey): boolean; field(e: PanelKey): boolean }>({ main: () => false, field: () => false });
  keys.current = { main: (e: PanelKey) => {
      if (modalOpen) return false;
      if (e.key === 'Escape' && overflow && !u.compact) { setOverflow(false); return true; }
      if (e.key === 'Escape') return escape();
      const combo = eventCombo(e), id = combo ? resolved.byCombo.get(combo) : undefined, def = id ? resolved.list.find(s => s.id === id) : undefined;
      if (id && def && !def.fixed && applies(def.when, keyState)) { if (runShortcut(id)) return true; }
      if (!doc) return false;
      if ((e.key === 'Enter' || e.key === 'F2') && !e.command && c.selection.length === 1) { editSelectedText(); return true; }
      if (e.key === 'F2' && !c.selection.length && !disabled) { setRename(true); return true; }
      if (disabled) return false;
      if (e.key === 'Enter') { showPanel(); return true; }
      if (e.key === 'Tab') {
        const ids: string[] = [], visit = (g: CanvasGroup) => { ids.push(g.id, ...g.blockIds); g.groupIds.forEach(id => { const child = doc.groups.find(g => g.id === id); if (child) visit(child); }); };
        doc.groups.filter(g => !g.parentGroupId).forEach(visit); ids.push(...doc.blocks.filter(b => !b.parentGroupId).map(b => b.id)); if (!ids.length) return false;
        const current = ids.indexOf(c.selection[0]), next = (current + (e.shift ? -1 : 1) + ids.length) % ids.length; void c.select([ids[next]]); return true;
      }
      const distance = e.shift ? 32 : 8, delta = e.key === 'ArrowLeft' ? { x: -distance, y: 0 } : e.key === 'ArrowRight' ? { x: distance, y: 0 } : e.key === 'ArrowUp' ? { x: 0, y: -distance } : e.key === 'ArrowDown' ? { x: 0, y: distance } : null;
      // A held arrow key repeats: nudges land at once, they do not glide.
      if (delta && c.selection.length) { const operations = moveOperations(doc, geometry.current.rects, c.selection, delta, undefined, { catalog: c.catalog }); if (operations.length) { canvas.current?.instant(); void c.edit(operations, 'Move selection'); } return true; }
      if (!e.command && mode === 'canvas') {
        if (e.key === '0') { canvas.current?.zoomTo(1); return true; }
        if (e.key === '+' || e.key === '=') { canvas.current?.zoomStep(1); return true; }
        if (e.key === '-') { canvas.current?.zoomStep(-1); return true; }
      }
      return false;
    }, field: (e: PanelKey) => {
      // From a field (a search box, a text being edited) only ⌘K and ⌘\ reach the panel.
      if (modalOpen) return false;
      const id = resolved.byCombo.get(eventCombo(e) ?? '');
      return (id === 'palette.open' || id === 'panel.right') && e.command ? runShortcut(id) : false;
    } };
  useEffect(() => {
    if (u.layout.platform !== 'web') return;
    return keyboard(root.current, e => keys.current.main(e), e => keys.current.field(e));
  }, [u.layout.platform]);
  const menuRows = <>
      {/* Grouped by what the action is about; one left edge, dividers instead of headings. */}
      <MenuRow icon="Plus" label="New Lienzo" disabled={disabled} onPress={() => { setOverflow(false); void newCanvas(); }} />
      <MenuRow icon="Frame" label="Lienzos" onPress={() => { setOverflow(false); openDocuments(); }} />
      <MenuRow icon="Pencil" label="Rename" hint="F2" disabled={!doc || disabled} onPress={() => { setOverflow(false); setRename(true); }} />
      <MenuDivider />
      <MenuRow icon="Undo2" label="Undo" hint={keyLabel('edit.undo')} disabled={disabled || !c.view?.canUndo} onPress={() => { void changeRevision('undo'); }} />
      <MenuRow icon="Redo2" label="Redo" hint={keyLabel('edit.redo')} disabled={disabled || !c.view?.canRedo} onPress={() => { void changeRevision('redo'); }} />
      {doc && <MenuRow icon="History" label="History" onPress={() => { setOverflow(false); inspectorOpen('history'); }} />}
      <MenuDivider />
      <MenuRow icon="Maximize2" label="Hide all UI" hint={keyLabel('ui.hide')} disabled={!doc} onPress={() => { setOverflow(false); setImmersive(true); }} />
      <MenuRow icon="Plug" label="Agent" disabled={!doc} trailing={<Presence id={c.view?.connection?.agentId ?? null} open={() => { setOverflow(false); setAgentsOpen(true); }} />} onPress={() => { setOverflow(false); setAgentsOpen(true); }} />
      <MenuRow icon="Compass" label="Instructions for the agent" disabled={!doc} onPress={() => { setOverflow(false); inspectorOpen('communication'); }} />
      <MenuDivider />
      <MenuRow icon="Puzzle" label="Extensions" onPress={openExtensions} />
      <MenuRow icon="Settings" label="Settings" onPress={() => openSettings('shortcuts')} />
      <MenuRow icon="Keyboard" label="Keyboard shortcuts" hint={keyLabel('help.shortcuts')} onPress={() => openSettings('shortcuts')} />
      <MenuRow icon="CircleHelp" label="Help" onPress={() => openHelp()} />
      <MenuRow icon="BookOpen" label="Lienzo guide" onPress={() => { setOverflow(false); setGuideOpen(true); }} />
  </>;
  const colour = selectedWhiteboard.length && !linkId ? { kind: 'whiteboard' as const, value: displayedStyle.color, set: (color: ToolStyle['color']) => changeStyle({ color }) } : undefined;
  const link = linkId ? doc?.links.find(l => l.id === linkId) : undefined;
  const linkColour = link ? { kind: 'link' as const, link, set: (tone: typeof link.tone) => { if (tone) void c.edit([{ type: 'link.update', id: link.id, patch: { tone } }], 'Change link colour'); else if (link.tone) { const { tone: _tone, ...rest } = link; void c.edit([{ type: 'link.delete', id: link.id }, { type: 'link.create', link: rest }], 'Clear link colour'); } } } : undefined;
  const selectionBar = doc && !immersive && hasSelection ? <SelectionBar controller={c} disabled={disabled} linkId={linkId} colour={linkColour ?? colour} duplicate={duplicateSelection} remove={removeLinkOrSelection} wrap={groupSelection} unwrap={ungroupSelection} keyLabel={keyLabel} onProperties={!roomy ? () => showPanel() : undefined} /> : undefined;
  const title = doc ? rename ? <Field key={doc.id} hideLabel label="Lienzo title" value={doc.title} disabled={disabled} inputStyle={u.font('groupTitle')} onSave={async value => {
    if (!value.trim() || value.trim().length > 300) throw new Error('Write a title of up to 300 characters.');
    await c.settle(); if (c.current.current?.document.id !== doc.id) return;
    const next = await c.edit([{ type: 'document.update', title: value.trim() }], 'Rename Lienzo'); if (next) setRename(false); return next;
  }} /> : <Pressable nativeID="lienzo-title" accessibilityRole="button" accessibilityLabel={'Open Lienzos: ' + doc.title} onPress={openDocuments} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: tokens.island.title.paddingH, minHeight: tokens.island.button.size, gap: 4 }}><Txt kind="groupTitle" numberOfLines={1} style={{ flexShrink: 1 }}>{doc.title}</Txt><Icon name="ChevronDown" size={12} color={u.c.foregroundMuted} /></Pressable> : <View style={{ justifyContent: 'center', paddingHorizontal: tokens.island.title.paddingH, minHeight: tokens.island.button.size }}><Txt kind="groupTitle" numberOfLines={1}>Lienzo</Txt></View>;
  // The toolbar sits on the bottom edge, level with the minimap and the zoom control.
  const toolbarBottom = F.toolbar.bottom;
  // On a compact panel the toolbar is docked in the flow at the bottom; floating things clear its strip.
  const compactDock = F.toolbar.height + F.toolbar.compactPadding.top + F.toolbar.compactPadding.bottom;
  const toolbar = <Toolbar active={toolId} shape={toolId === 'arrow' ? shapePick : toolStyle.shape === 'line' && toolStyle.heads !== 'none' ? shapePick : toolStyle.shape} locked={toolLocked} disabled={!doc || disabled} onTool={chooseToolId} onShape={pickShape} onLock={setToolLocked} pinned={pinnedTools} onAdd={() => { setLibraryOpen(false); setAddOpen(open => !open); }} addOpen={addOpen} keyLabel={keyLabel} scroll={u.compact} addRef={addRef} />;
  // The document island and what drops from it keep clear of the window controls (the desktop app's traffic lights).
  const islandLeft = tokens.island.inset + u.inset.left;
  const panelTop = F.top.height + tokens.island.inset + F.top.islandGap, panelMax = Math.max(200, panelHeight - panelTop - F.rightPanel.bottomClearance);
  const addLeft = Math.max(tokens.island.inset, Math.min(width - F.catalog.width - tokens.island.inset, toolbarBox.x + toolbarBox.width - F.catalog.width + 24));
  // ---- Screens: one large sheet over the canvas at a time.
  const panelBox = { width, height: panelHeight }, frame = sheetFrame(panelBox, u.compact, u.inset), railWidth = u.compact ? 0 : tokens.face.screens.rail;
  const closeScreen = () => setScreen(null);
  const pinnedRows = pinnedEntries.map(e => ({ id: e.id, name: e.name, icon: e.icon, description: e.description }));
  const screens = <>
    <Screen open={screen?.kind === 'lienzos'} onClose={closeScreen} panel={panelBox} nativeID="lienzo-screen-lienzos" label="Lienzos" fit="top">
      <LienzosScreen c={c} width={frame.width} open={screen?.kind === 'lienzos'} onNew={() => { void newCanvas(); }} onOpen={id => { setScreen(null); if (id !== doc?.id) void c.open(id); }} />
    </Screen>
    <Screen open={screen?.kind === 'history'} onClose={closeScreen} panel={panelBox} nativeID="lienzo-screen-history" label="History" fit="center">
      <HistoryScreen c={c} open={screen?.kind === 'history'} onUndo={() => { void changeRevision('undo'); }} onRedo={() => { void changeRevision('redo'); }}
        onFly={ids => { setScreen(null); void c.select(ids); setTimeout(() => canvas.current?.flyToIds(ids), 0); }} />
    </Screen>
    <Screen open={screen?.kind === 'extensions'} onClose={closeScreen} panel={panelBox} nativeID="lienzo-screen-extensions" label="Extensions" fit="top">
      <ExtensionsContent c={c} width={frame.width} onHelp={openHelp} />
    </Screen>
    <Screen open={screen?.kind === 'settings'} onClose={closeScreen} panel={panelBox} nativeID="lienzo-screen-settings" label="Settings" fit="top" rail={settingsRail()} active={screen?.kind === 'settings' ? screen.section : undefined} onRail={id => setScreen({ kind: 'settings', section: id as SettingsSection })}>
      {screen?.kind === 'settings' && <SettingsContent key={screen.section} section={screen.section} c={c} width={frame.width - railWidth} list={resolved.list} defs={shortcutRegistry.all()} overrides={overrides} chips={chips}
        saveShortcuts={next => savePrefs({ shortcuts: next })} pinned={pinnedRows} savePinned={ids => savePrefs({ pinned: ids })} onGuide={() => { setScreen(null); setGuideOpen(true); }} />}
    </Screen>
    <Screen open={screen?.kind === 'help'} onClose={closeScreen} panel={panelBox} nativeID="lienzo-screen-help" label="Help">
      {screen?.kind === 'help' && <WikiContent width={frame.width} page={screen.page} onPage={page => setScreen({ kind: 'help', page })} extensions={c.catalog?.extensions ?? []} shortcuts={resolved.list} chips={chips} onTour={() => { setScreen(null); setGuideOpen(true); }} />}
    </Screen>
  </>;
  const empty = !!doc && !doc.blocks.length && !doc.groups.length && mode === 'canvas' && !immersive && tool === 'select';
  return <TooltipProvider root={root}><View ref={root} onLayout={e => { setWidth(e.nativeEvent.layout.width); setPanelHeight(e.nativeEvent.layout.height); }} style={{ flex: 1, minHeight: 0, backgroundColor: u.c.surface0 }}>
    {u.compact && !immersive && <View style={{ height: tokens.size.topBarCompact, paddingHorizontal: 8, paddingLeft: 8 + u.inset.left, flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1 }}>
      <IconButton icon="Menu" label="Menu" onPress={() => setOverflow(true)} /><View style={{ flex: 1, minWidth: 0 }}>{title}</View>{doc?.example && <Chip label="Example" tone="aviso" icon="FlaskConical" center />}<IconButton icon="Undo2" label="Undo" shortcut={keyLabel('edit.undo')} disabled={disabled || !c.view?.canUndo} onPress={() => { void changeRevision('undo'); }} /><IconButton icon="Search" label="Search and commands" shortcut={keyLabel('palette.open')} onPress={() => setPaletteOpen(true)} /><IconButton icon="PanelRight" label="Properties" shortcut={keyLabel('panel.right')} disabled={!doc} active={panelVisible} onPress={togglePanel} />
    </View>}
    <View style={u.compact ? { flex: 1, minHeight: 0 } : { position: 'absolute', inset: 0 }}>
      {c.loading ? <LoadingDocument /> : !doc && c.failure ? <EmptyState title="The Lienzo could not be opened" error={c.failure.message}><Button label="Retry" variant="primary" disabled={c.busy} onPress={() => { void c.failure?.retry?.().catch(c.fail); }} /></EmptyState> : !doc ? <EmptyState art={<MateDrawing size={112} />} title="Pour yourself a mate." description="Then start a Lienzo, or ask your agent to draw what it is explaining.">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}><Button label="New Lienzo" variant="primary" disabled={disabled} onPress={() => { void newCanvas(); }} />{c.documents.length > 0 && <Button label="All Lienzos" icon="LayoutGrid" onPress={openDocuments} />}</View>
      </EmptyState> : <Canvas key={doc.id} api={canvas} glowIds={copilot.glowIds} onUserCamera={copilot.userMoved} tool={tool} onToolChange={setTool} toolStyle={toolStyle} toolLocked={toolLocked} onInteractionChange={setInteractionId} selectionToolbar={u.compact ? undefined : selectionBar} onRelease={release} controller={c} mode={mode} linkId={linkId} onLink={id => { if (id === null) setLibraryOpen(false); selectLink(id); }} onInspect={() => showPanel()} onPacks={openExtensions} reorder={reorder} onGeometry={(rects, center) => { geometry.current = { rects, center }; }} reservedKey={reservedKey} lensShortcut={keyLabel('lens.cycle')} obscuredRight={panelVisible && !u.compact ? F.rightPanel.width + F.rightPanel.inset : 0} />}
    </View>
    <View pointerEvents="box-none" style={{ position: 'absolute', inset: 0 }}>
      {!!undoLabel && <View pointerEvents="box-none" style={{ position: 'absolute', top: tokens.island.bannerTop, left: 0, right: 0, alignItems: 'center', zIndex: 30 }}><View style={[islandStyle(u), { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }]}><Txt kind="small">{undoLabel}</Txt><Button label="Undo" small variant="ghost" disabled={disabled || !c.view?.canUndo} onPress={() => { setUndoLabel(''); void changeRevision('undo'); }} /><IconButton label="Close notice" icon="X" onPress={() => setUndoLabel('')} /></View></View>}
      {!u.compact && !immersive && <View pointerEvents="box-none" style={{ position: 'absolute', top: tokens.island.inset, left: islandLeft, maxWidth: Math.max(0, width - 24 - 120 - u.inset.left) }}><View nativeID="lienzo-document-island" style={[islandStyle(u), { flexDirection: 'row', alignItems: 'center', height: F.top.height }]}>
        <IconButton icon="Menu" label="Menu" detail="Lienzos, history, agent, extensions and settings." size={36} onPress={() => { setAddOpen(false); setOverflow(true); }} />
        <View style={{ flexShrink: 1, minWidth: 0, maxWidth: width < 880 ? tokens.island.title.maxWidthTight : tokens.island.title.maxWidth, ...(rename ? { width: width < 880 ? tokens.island.title.maxWidthTight : tokens.island.title.maxWidth } : {}) }}>{title}</View>
        {doc?.example && <Chip label="Example" tone="aviso" icon="FlaskConical" center style={{ marginRight: 6 }} />}
        {(saveSlow || c.failure) && <View accessibilityLabel={c.failure ? 'Not saved' : 'Saving'} style={{ width: 6, height: 6, borderRadius: 3, marginRight: 8, backgroundColor: c.failure ? u.c.statusDanger : u.c.statusWarning }} />}
        {!!doc && <><View style={{ width: 1, height: 20, marginHorizontal: 4, backgroundColor: u.c.border }} /><HojaControls copilot={copilot} shortcut={keyLabel} /></>}
      </View></View>}
      {!u.compact && !immersive && <View pointerEvents="box-none" style={{ position: 'absolute', top: tokens.island.inset, right: tokens.island.inset }}><View nativeID="lienzo-top-right" style={[islandStyle(u), { flexDirection: 'row', alignItems: 'center', height: F.top.height }]}>
        <IconButton icon="Search" label="Search and commands" shortcut={keyLabel('palette.open')} detail="Tools, actions, Sheets and Lienzos." size={36} onPress={() => { setAddOpen(false); setPaletteOpen(true); }} />
        <IconButton icon="PanelRight" label="Properties" shortcut={keyLabel('panel.right')} detail="The panel on the right. Pin it to keep it open." size={36} disabled={!doc} active={panelVisible} onPress={togglePanel} />
      </View></View>}
      {empty && <View pointerEvents="box-none" style={{ position: 'absolute', top: Math.max(F.top.height + 40, panelHeight * .24), left: 24, right: 24, alignItems: 'center', gap: 14 }}>
        <EmptyMate />
        <View pointerEvents="box-none" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}><Button label="Add something" icon="Plus" disabled={disabled} onPress={() => setAddOpen(true)} /></View>
      </View>}
      {doc && !immersive && !u.compact && <View pointerEvents="box-none" style={{ position: 'absolute', bottom: toolbarBottom, left: tokens.island.inset, right: tokens.island.inset, alignItems: 'center' }}><View pointerEvents="box-none" onLayout={e => { const { x, width: w } = e.nativeEvent.layout; setToolbarBox({ x: x + tokens.island.inset, width: w }); }}>{toolbar}</View></View>}
      {panelVisible && !u.compact && <RightPanel tabs={tabs} active={activeTab} onTab={tab => setPanel(p => ({ ...p, tab }))} pinned={panel.pinned} onPin={pinned => setPanel(p => ({ ...p, pinned }))} onClose={togglePanel} top={panelTop} maxHeight={panelMax} shortcut={keyLabel('panel.right')} focusSection={panel.focus === 'instruction' ? 'Instructions for the agent' : undefined} />}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: u.compact ? tokens.size.topBarCompact + 8 : tokens.island.bannerTop, left: 12, right: panelVisible && !u.compact ? F.rightPanel.width + 24 : 12 }}>{doc && (c.failure || c.offline || reload) && <View pointerEvents="box-none" style={{ padding: 12, gap: 8 }}>
          {c.failure && <Banner title={c.failure.conflict ? 'The Lienzo changed while you were editing' : 'The change was not saved'} icon={c.failure.conflict ? 'GitCompareArrows' : 'CircleAlert'} color={c.failure.conflict ? u.c.statusWarning : u.c.statusDanger} message={c.failure.conflict ? 'Another edit changed the Lienzo and yours was not saved. You can apply it again on top of the current content, or discard it.' : c.failure.message}>
            {c.failure.retry && <Button label={c.failure.conflict ? 'Apply my change again' : 'Retry'} variant="primary" small disabled={disabled} onPress={() => { void c.failure?.retry?.().catch(e => c.fail(e)); }} />}<Button label="Discard" variant="ghost" small onPress={c.clearFailure} />
          </Banner>}
          {c.offline && <Banner title={`No connection to ${capabilities.name}`} icon="Unplug" color={u.c.border} message="You can keep reading; changes are paused."><Button label="Retry" small onPress={() => { void c.refresh(); }} /></Banner>}
          {reload && !(c.failure && c.offline) && <Banner title="This agent has no Lienzo tools" icon="Info" color={u.c.statusWarning} message="It is connected, but it was created without the tools, so it cannot read or edit the Lienzo. Turn the tools on in the agent dialog and create a new agent, or use “Set up an existing agent”."><Button label="Got it" small variant="ghost" onPress={() => setReload(false)} /></Banner>}
          {c.failure && c.offline && reload && <Button label="+1 notice" small variant="ghost" onPress={() => setShowAllWarnings(true)} />}
        </View>}</View>
      {doc && !immersive && <LatestPill copilot={copilot} bottom={u.compact ? compactDock + 12 : toolbarBottom + F.toolbar.height + 12} label={c.view?.latestAgent?.label} />}
      {doc && !u.compact && <HojaMenu copilot={copilot} left={islandLeft} top={tokens.island.inset + F.top.height + 6} maxHeight={Math.max(200, panelHeight - 220)} />}
      {libraryOpen && !immersive && <View pointerEvents="box-none" style={u.compact ? { position: 'absolute', left: 8, right: 8, bottom: compactDock + 8, alignItems: 'center' } : { position: 'absolute', bottom: toolbarBottom + F.toolbar.height + 8, left: 0, right: 0, alignItems: 'center' }}>
        <LibraryPopover onInsert={insertSvg} onImport={() => { setLibraryOpen(false); setSvgOpen(true); }} error={libraryError} busy={disabled || svgBusy} onClose={() => setLibraryOpen(false)} recent={recentIcons} onRecent={list => savePrefs({ recentIcons: list })} online={!c.offline} maxHeight={Math.max(280, panelHeight - toolbarBottom - F.toolbar.height - 40)} />
      </View>}
      {immersive && <View pointerEvents="box-none" style={{ position: 'absolute', top: 12, right: 12 }}><View style={islandStyle(u)}><IconButton icon="Minimize2" label="Show the interface" shortcut={keyLabel('ui.hide')} onPress={() => setImmersive(false)} /></View></View>}
      <Kettle serial={kettle} bottom={u.compact ? compactDock + 12 : 60} />
    </View>
    {u.compact && doc && !immersive && selectionBar}
    {u.compact && doc && !immersive && <View style={{ paddingHorizontal: 8, paddingTop: F.toolbar.compactPadding.top, paddingBottom: F.toolbar.compactPadding.bottom }}>{toolbar}</View>}
    {panelVisible && u.compact && <RightPanel tabs={tabs} active={activeTab} onTab={tab => setPanel(p => ({ ...p, tab }))} pinned={panel.pinned} onPin={pinned => setPanel(p => ({ ...p, pinned }))} onClose={togglePanel} top={0} maxHeight={Math.max(320, panelHeight - 120)} open />}
    {addOpen && <><Pressable accessibilityLabel="Close the catalog" onPress={() => setAddOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 40 }} />
      <View pointerEvents="box-none" style={u.compact ? { position: 'absolute', left: 8, right: 8, bottom: compactDock + 6, zIndex: 41, alignItems: 'center' } : { position: 'absolute', left: addLeft, bottom: toolbarBottom + F.toolbar.height + F.catalog.offset, zIndex: 41 }}>
        <AddMenu entries={entries} pinned={pinnedIds} onPin={togglePin} onClose={() => setAddOpen(false)} onManage={openExtensions} maxHeight={Math.min(F.catalog.maxHeight, Math.max(240, panelHeight - toolbarBottom - F.toolbar.height - 80))} width={u.compact ? Math.min(F.catalog.width, width - 16) : F.catalog.width} />
      </View></>}
    {/* The menu drops from its button on a wide panel; on a compact one it is a sheet. */}
    {overflow && !u.compact && <><Pressable accessibilityLabel="Close the menu" onPress={() => setOverflow(false)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 40 }} />
      <View nativeID="lienzo-interactive-menu" accessibilityRole="menu" style={{ position: 'absolute', left: islandLeft, top: tokens.island.inset + F.top.height + 6, width: 288, maxHeight: Math.max(240, panelHeight - tokens.island.inset - 72), zIndex: 41, ...islandStyle(u, true), padding: 0, overflow: 'hidden' }}><ScrollView contentContainerStyle={{ padding: 6 }}>{menuRows}</ScrollView></View></>}
    <CommandPalette open={paletteOpen} items={paletteItems} recent={recent} chips={chips} width={width} height={panelHeight} onClose={() => setPaletteOpen(false)} onRun={(item, background) => { runPaletteItem(item); if (background) toast.show('Running: ' + item.title, { variant: 'info' }); }} onQuery={query => { if (query.trim().toLowerCase() === 'mate') setKettle(k => k + 1); }} />
    <TooltipLayer />
    <LinkSheet intent={ventana} onClose={() => setVentana(null)} panel={panelBox} disabled={disabled} onAdd={insertLink} />
    <SvgSheet open={svgOpen} onClose={() => setSvgOpen(false)} panel={panelBox} onInsert={insertSvg} />
    <Modal title="Notices" open={showAllWarnings} onOpenChange={setShowAllWarnings}><Modal.Content>{reload && <Banner title="This agent has no Lienzo tools" icon="Info" color={u.c.statusWarning} message="It is connected, but it was created without the tools, so it cannot read or edit the Lienzo. Turn the tools on in the agent dialog and create a new agent, or use “Set up an existing agent”."><Button label="Got it" small variant="ghost" onPress={() => { setReload(false); setShowAllWarnings(false); }} /></Banner>}</Modal.Content></Modal>
    <Modal title="Menu" open={overflow && u.compact} onOpenChange={setOverflow}><Modal.Content><View>{menuRows}</View></Modal.Content></Modal>
    {settings.saveError && <View style={{ position: 'absolute', top: tokens.island.bannerTop, left: 12, right: 12, padding: 8, backgroundColor: u.c.surface1 }}><Txt kind="small" muted>Could not remember that you saw the guide.</Txt><Button label="Retry" small variant="ghost" onPress={() => { guideClaim.current = false; void settings.reload(); }} /></View>}
    <Onboarding open={guideOpen} close={closeGuide} panel={panelBox} />
    {AgentSheet ? <AgentSheet open={agentsOpen} close={() => setAgentsOpen(false)} connectedAgentId={c.view?.connection?.agentId ?? null} /> : <AgentModal controller={c} open={agentsOpen} close={() => setAgentsOpen(false)} onReload={() => setReload(true)} />}
    {screens}
  </View></TooltipProvider>;
}
