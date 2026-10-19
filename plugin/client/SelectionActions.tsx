import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, TextInput } from './host';
import type { CanvasGroup, CanvasLink, CanvasOperation } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { Button, CheckRow, Field, IconButton, Segments, Txt, useTooltip, useUI } from './ui';
import { ancestors, connectOperations, containerMode, hasCommunication, instructionLevels, pinnedChildren, type Rect } from './logic';
import { communicationOperation, layoutIcons, layoutOperations, leaveGroupOperations, reorderOperation, typeSlot } from './panel-actions';
import { isWhiteboardRenderer, WB_COLORS, type WbColor } from '../shared/whiteboard';
import { resolveScope } from '../shared/learning';
import { islandStyle, wbColor } from './whiteboard-visuals';
import { tokens } from './tokens';
import { activateRendererReset } from './web';
import { usePresentation } from './usePresentation';
import { RegisteredRenderer } from './renderers/RegisteredRenderer';
import { recordInteraction } from './useLearning';
import { BlockContent, VariablesEditor } from './PropertyEditors';
import { needsContentInteraction } from './interaction';
import { linkTone } from './Links';
import { HiddenResult } from './HiddenResult';
import { withAlpha } from './color';
import { PanelSection } from './RightPanel';
import { attentionSection, sectionMemory, sectionScope } from './property-model';

const toneNames = { neutro: 'Neutral', acento: 'Accent', violeta: 'Violet', turquesa: 'Teal', aviso: 'Amber', peligro: 'Red' } as const;
const MARCO = 'Frame — holds things together on the canvas.';
type Colour = { kind: 'whiteboard'; value: WbColor; set(color: WbColor): void } | { kind: 'link'; link: CanvasLink; set(tone: CanvasLink['tone'] | undefined): void };

function BarButton({ label, icon, onPress, disabled, shortcut, detail, active, danger, nativeID, children }: { label: string; icon?: string; onPress(): void; disabled?: boolean; shortcut?: string; detail?: string; active?: boolean; danger?: boolean; nativeID?: string; children?: React.ReactNode }) {
  const u = useUI(), tip = useTooltip({ label, shortcut, detail }), size = u.compact ? tokens.face.selectionBar.buttonTouch : tokens.face.selectionBar.button;
  return <Pressable ref={tip.ref} nativeID={nativeID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} accessibilityState={{ disabled: !!disabled, selected: !!active }} disabled={disabled}
    onPress={e => { e.stopPropagation(); onPress(); }} onPressIn={tip.onPressIn} onHoverIn={tip.onHoverIn} onHoverOut={tip.onHoverOut} onLongPress={u.compact ? tip.onLongPress : undefined}
    style={({ pressed, ...state }) => ({ width: size, height: size, borderRadius: 6, alignItems: 'center', justifyContent: 'center', opacity: disabled ? .45 : 1, backgroundColor: active ? withAlpha(u.c.accent, .14) : pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
    {children ?? <Icon name={icon!} size={16} color={danger ? u.c.statusDanger : active ? u.c.accent : u.c.foreground} />}
  </Pressable>;
}

/**
 * The small bar over the selection: colour, Frame, duplicate, delete. Detail lives in the right panel.
 * A selected link gets its own: colour, kind, reverse, delete.
 */
export function SelectionBar({ controller: c, disabled, linkId, colour, duplicate, remove, wrap, unwrap, keyLabel, onProperties }: {
  controller: CanvasController; disabled: boolean; linkId?: string | null; colour?: Colour; duplicate(): void; remove(): void; wrap(): void; unwrap(): void; keyLabel(id: string): string | undefined; onProperties?(): void;
}) {
  const u = useUI(), doc = c.view!.document, [swatches, setSwatches] = useState(false);
  const selected = [...doc.groups, ...doc.blocks].filter(e => c.selection.includes(e.id)), link = linkId ? doc.links.find(l => l.id === linkId) : undefined;
  const single = selected.length === 1 ? selected[0] : undefined, group = single && 'groupIds' in single ? single : undefined;
  useEffect(() => { setSwatches(false); }, [c.selection.join('|'), linkId]);
  if (!selected.length && !link) return null;
  const current = colour?.kind === 'whiteboard' ? wbColor(colour.value, u) : colour?.kind === 'link' ? u.tone(linkTone(colour.link)) : undefined;
  const choices = colour?.kind === 'whiteboard' ? WB_COLORS.map(color => ({ id: color, name: tokens.whiteboard.colors.find(x => x.id === color)!.label, value: wbColor(color, u), on: colour.value === color, pick: () => colour.set(color) }))
    : colour?.kind === 'link' ? [{ id: 'auto', name: 'Automatic', value: u.c.surface2, on: !colour.link.tone, pick: () => colour.set(undefined) }, ...tokens.graph.tones.map(tone => ({ id: tone, name: toneNames[tone], value: u.tone(linkTone({ kind: colour.link.kind, tone })), on: colour.link.tone === tone, pick: () => colour.set(tone) }))] : [];
  return <View pointerEvents="box-none" style={{ alignItems: 'center' }}>
    <View nativeID="lienzo-interactive-selection-toolbar" accessibilityRole="toolbar" accessibilityLabel="Selection" style={u.compact ? { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderTopWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, alignSelf: 'stretch' } : [islandStyle(u, true), { flexDirection: 'row', alignItems: 'center', gap: 2 }]}>
      {colour && <BarButton nativeID="lienzo-selection-colour" label="Colour" active={swatches} disabled={disabled} onPress={() => setSwatches(v => !v)}><View style={{ width: tokens.face.selectionBar.swatch, height: tokens.face.selectionBar.swatch, borderRadius: 9, backgroundColor: current, borderWidth: 1, borderColor: u.c.border }} /></BarButton>}
      {link ? <>
        <BarButton label={link.kind === 'flow' ? 'Kind: flow' : link.kind === 'depends' ? 'Kind: needs' : 'Kind: mention'} icon={link.kind === 'flow' ? 'Minus' : link.kind === 'depends' ? 'MoreHorizontal' : 'Ellipsis'} detail="Press to change what this link means." disabled={disabled} onPress={() => { const kinds = ['flow', 'depends', 'reference'] as const; void c.edit([{ type: 'link.update', id: link.id, patch: { kind: kinds[(kinds.indexOf(link.kind) + 1) % kinds.length] } }], 'Change link kind'); }} />
        <BarButton label="Reverse" icon="ArrowLeftRight" disabled={disabled} onPress={() => { void c.edit([{ type: 'link.update', id: link.id, patch: { from: link.to, to: link.from } }], 'Reverse link'); }} />
      </> : <>
        {group ? <BarButton nativeID="lienzo-selection-unwrap" label="Unwrap Frame" icon="Ungroup" shortcut={keyLabel('edit.unwrap')} detail="Keeps what is inside; removes the frame." disabled={disabled} onPress={unwrap} />
          : <BarButton nativeID="lienzo-selection-marco" label="Wrap in a Frame" icon="SquareDashed" shortcut={keyLabel('edit.wrap')} detail={MARCO} disabled={disabled} onPress={wrap} />}
        <BarButton nativeID="lienzo-selection-duplicate" label="Duplicate" icon="CopyPlus" shortcut={keyLabel('edit.duplicate')} disabled={disabled} onPress={duplicate} />
      </>}
      <BarButton nativeID="lienzo-selection-delete" label="Delete" icon="Trash2" danger shortcut={keyLabel('edit.delete')} disabled={disabled} onPress={remove} />
      {onProperties && <BarButton label="Properties" icon="SlidersHorizontal" shortcut={keyLabel('panel.right')} onPress={onProperties} />}
    </View>
    {swatches && choices.length > 0 && <View nativeID="lienzo-selection-swatches" accessibilityRole="radiogroup" accessibilityLabel="Colour" style={[islandStyle(u, true), { position: 'absolute', top: (u.compact ? 52 : tokens.face.selectionBar.button + 10) + 6, flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 6, maxWidth: 260, zIndex: 12 }]}>
      {choices.map(choice => <Pressable key={choice.id} accessibilityRole="radio" accessibilityLabel={choice.name} accessibilityState={{ checked: choice.on, disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); choice.pick(); setSwatches(false); }}
        style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: choice.on ? 2 : 0, borderColor: u.c.accent }}><View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: choice.value, borderWidth: 1, borderColor: u.c.border }} /></Pressable>)}
    </View>}
  </View>;
}

/**
 * What the right panel shows for the selection: its content fields, style, instructions, connections and every
 * other action, in collapsible sections. Each edit is one transaction, labelled for history and undo.
 */
export function SelectionProperties({ controller: c, panelRoot, disabled, add, duplicate, remove, groupSelection, connectSelection, release, rects, editText, undoNotice, linkId, onLink, interact, style, focus }: {
  controller: CanvasController; panelRoot: React.RefObject<View | null>; disabled: boolean; add(): void; duplicate(): void; remove(): void; groupSelection(): void; connectSelection(): void; release(ids: string[], label?: string): void; rects(): Map<string, Rect>; editText(): void; interact(): void; undoNotice(label: string): void;
  linkId?: string | null; onLink(id: string | null): void; style?: React.ReactNode;
  /** A section to open and scroll to: `instruction` from the menu. */
  focus?: string | null;
}) {
  const lifetime = useRef(true), liveController = useRef(c); liveController.current = c;
  useEffect(() => { lifetime.current = true; return () => { lifetime.current = false; }; }, []);
  const u = useUI(), presentation = usePresentation(c), doc = c.view!.document, [query, setQuery] = useState(''), [instructionTarget, setInstructionTarget] = useState<string | null | undefined>(undefined);
  const selected = [...doc.groups, ...doc.blocks].filter(e => c.selection.includes(e.id)), entity = selected.length === 1 ? selected[0] : undefined;
  const group = entity && 'groupIds' in entity ? entity : undefined, block = entity && 'typeId' in entity ? entity : undefined;
  const type = c.catalog?.blockTypes.find(t => t.id === block?.typeId), slot = typeSlot(type), link = linkId ? doc.links.find(l => l.id === linkId) : undefined;
  useEffect(() => { setQuery(''); setInstructionTarget(undefined); }, [c.selection.join('|'), linkId]);
  // Sections start collapsed; a block with a problem in its data opens Content, for this selection only.
  const attention = attentionSection(type, block, doc), scope = sectionScope(c.selection, linkId);
  useEffect(() => { if (attention) sectionMemory.force(attention, scope); }, [attention, scope]);
  const apply = async (operations: CanvasOperation[], label: string) => { if (disabled || !operations.length) return; return c.edit(operations, label); };
  const patchEntity = (patch: object, label: string) => entity ? apply([{ type: group ? 'group.update' : 'block.update', id: entity.id, patch } as CanvasOperation], label) : Promise.resolve(undefined);
  const updateLink = (patch: Partial<CanvasLink>, label: string) => link ? apply([{ type: 'link.update', id: link.id, patch }], label) : Promise.resolve(undefined);
  const target = instructionTarget === undefined ? entity?.id ?? null : instructionTarget, targetEntity = target ? [...doc.blocks, ...doc.groups].find(e => e.id === target) : undefined;
  const communication = targetEntity?.communication ?? (!target ? doc.communication : undefined);
  const saveCommunication = async (patch: Partial<typeof doc.communication>) => {
    if (disabled) return; const documentId = doc.id; await c.settle(); const latest = c.current.current?.document;
    if (!latest || latest.id !== documentId) return;
    return c.edit([communicationOperation(latest, target, patch)], 'Edit instructions for the agent');
  };
  const layout = group?.layout, layoutMode = containerMode(doc, group?.id ?? null, c.catalog);
  const saveLayout = (next: NonNullable<CanvasGroup['layout']>) => { try { void apply(layoutOperations(doc, group?.id ?? null, next, rects(), c.catalog), 'Change Frame layout'); } catch (error) { c.fail(error); } };
  const resetUnavailable = u.layout.platform !== 'web' && type?.renderer !== 'controls';
  const reset = async () => {
    if (!block || disabled || resetUnavailable) return;
    const documentId = doc.id, blockId = block.id, root = panelRoot.current; await c.settle();
    const current = () => { const controller = liveController.current, latest = controller.current.current?.document; return lifetime.current && !!root && panelRoot.current === root && !controller.busy && !controller.offline && latest?.id === documentId && latest.workspaceId === doc.workspaceId && controller.selection.length === 1 && controller.selection[0] === blockId && latest.blocks.some(item => item.id === blockId); };
    if (!current()) { if (lifetime.current) c.fail(new Error('Not reset: the document or the selection changed.')); return; }
    if (u.layout.platform === 'web') { if (!activateRendererReset(root, blockId, current)) c.fail(new Error('Not reset: open the Frame and wait for the block to appear.')); return; }
    const latest = c.current.current!.document;
    if (type?.renderer === 'controls') { const variables = resolveScope(latest, blockId, c.learning.getSnapshot()); for (const name of block.data.variables as string[] ?? []) if (variables[name]) c.learning.setVariable(blockId, name, null); }
    else c.learning.setBlock(blockId, null);
    await c.learning.flush(); if (c.current.current?.document.id !== documentId) return;
    if (['controls', 'animated-flow', 'glsl-shader'].includes(type?.renderer ?? '')) await recordInteraction(c, blockId, type!.renderer + '.reset', null, 'Reset ' + type!.name);
  };
  const row = (label: string, icon: string, press: () => void, writes = true, danger = false, unavailable = false) => <Pressable key={label} accessibilityRole="menuitem" accessibilityLabel={label} accessibilityState={{ disabled: unavailable || writes && disabled }} disabled={unavailable || writes && disabled} onPress={event => { event.stopPropagation(); press(); }}
    style={({ pressed, ...state }) => ({ minHeight: u.compact ? 44 : tokens.menu.row.height, paddingHorizontal: tokens.menu.row.paddingH, marginHorizontal: -tokens.menu.row.paddingH, borderRadius: tokens.menu.row.radius, flexDirection: 'row', alignItems: 'center', gap: tokens.menu.row.gap, backgroundColor: pressed ? u.c.surface2 : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .05) : 'transparent', opacity: unavailable || writes && disabled ? .45 : 1 })}><Icon name={icon} size={16} color={danger ? u.c.statusDanger : u.c.foregroundMuted} /><Txt style={{ flex: 1, color: danger ? u.c.statusDanger : u.c.foreground }}>{label}</Txt></Pressable>;
  const concealed = entity && presentation?.hiddenBy.get(entity.id), gate = block && presentation?.activeGates.has(block.id);
  const levels = instructionLevels(doc, targetEntity).filter(level => level.id !== target && !!level.communication.instructions.trim());
  const candidates = entity ? [...doc.blocks, ...doc.groups].filter(e => e.id !== entity.id && !ancestors(doc, entity).some(g => g.id === e.id) && !ancestors(doc, e).some(g => g.id === entity.id) && !presentation?.hiddenBy.has(e.id) && (!query.trim() || e.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) : [];
  const connectTo = (candidateId: string) => { if (!entity || disabled) return; const documentId = doc.id, result = connectOperations(doc, entity.id, candidateId); const choose = async (id: string) => { await c.select([]); if (c.current.current?.document.id !== documentId) return; onLink(id); }; if (result.existing) void choose(result.existing.id); else void apply(result.operations, 'Connect').then(next => { if (next && result.id) void choose(result.id); }); };
  // Titles come from what is shown: a result still hidden behind a learning gate is never named here.
  const shown = presentation?.document ?? doc, shownTitle = (id: string) => [...shown.blocks, ...shown.groups].find(e => e.id === id)?.title || 'Untitled';
  const heading = link ? `${shownTitle(link.from)} → ${shownTitle(link.to)}` : selected.length > 1 ? `${selected.length} selected` : entity ? shownTitle(entity.id) : 'Untitled';
  const links = entity ? doc.links.filter(l => l.from === entity.id || l.to === entity.id).length : 0;
  const kindName = link ? 'Link' : selected.length > 1 ? 'Selection' : group ? 'Frame' : type?.name ?? 'Block';
  const head = <View style={{ paddingHorizontal: tokens.face.rightPanel.padding, paddingVertical: 10, gap: 2 }}><Txt kind="label" muted>{kindName}</Txt><Txt kind="bodyStrong" numberOfLines={2}>{heading}</Txt></View>;

  if (gate) return <View>{head}<PanelSection title="Data"><RegisteredRenderer block={block!} id={type!.renderer!} controller={c} readOnly={disabled} /></PanelSection></View>;
  if (concealed?.length) return <View>{head}<View style={{ padding: 12 }}><HiddenResult gateIds={concealed} open={id => { void c.select([id]); }} /></View></View>;
  if (link) return <View nativeID="lienzo-properties-link">{head}
    <PanelSection title="Link">
      <Field key={link.id + ':label'} label="Label" value={link.label ?? ''} disabled={disabled} placeholder="What travels along it (optional)" helper="Drawn on the line. Up to 200 characters." onSave={label => { if (label.length > 200) throw new Error('Up to 200 characters.'); return updateLink({ label }, 'Edit link label'); }} />
      <Txt kind="small" style={{ fontWeight: '600' }}>Kind</Txt>
      {(['flow', 'depends', 'reference'] as const).map(kind => <Pressable key={kind} accessibilityRole="radio" accessibilityLabel={tokens.graph.kinds[kind]} accessibilityState={{ checked: link.kind === kind, disabled }} disabled={disabled} onPress={() => { void updateLink({ kind }, 'Change link kind'); }} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 40, opacity: disabled ? .45 : 1 }}><View style={{ width: 28, height: 1, borderTopWidth: 1.5, borderColor: u.c.foregroundMuted, borderStyle: kind === 'flow' ? 'solid' : kind === 'depends' ? 'dashed' : 'dotted' }} /><View style={{ flex: 1 }}><Txt>{tokens.graph.kinds[kind]}</Txt><Txt kind="small" muted>{tokens.graph.kindHelp[kind]}</Txt></View>{link.kind === kind && <Icon name="Check" size={14} color={u.c.accent} />}</Pressable>)}
      <Txt kind="small" style={{ fontWeight: '600' }}>Colour</Txt>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{[undefined, ...tokens.graph.tones].map(tone => <Pressable key={tone ?? 'auto'} accessibilityRole="radio" accessibilityLabel={tone ? toneNames[tone] : 'Automatic'} accessibilityState={{ checked: link.tone === tone, disabled }} disabled={disabled} onPress={() => { if (tone) void updateLink({ tone }, 'Change link colour'); else if (link.tone) { const { tone: _tone, ...rest } = link; void apply([{ type: 'link.delete', id: link.id }, { type: 'link.create', link: rest }], 'Clear link colour'); } }} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: tone ? u.tone(linkTone({ kind: link.kind, tone })) : u.c.surface2, borderWidth: link.tone === tone ? 2 : 1, borderColor: link.tone === tone ? u.c.accent : u.c.border, opacity: disabled ? .45 : 1 }} />)}</View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label="Reverse" icon="ArrowLeftRight" small disabled={disabled} onPress={() => { void updateLink({ from: link.to, to: link.from }, 'Reverse link'); }} /><Button label="Delete link" icon="Trash2" small variant="danger" disabled={disabled} onPress={remove} /></View>
    </PanelSection>
  </View>;

  const fields = block && (type ? <BlockContent key={block.id} controller={c} block={block} type={type} disabled={disabled} />
    : <Txt kind="small" muted>This block’s type is not in the catalog any more, so its properties cannot be edited here. The agent can still read them.</Txt>);
  const actions = <>
    {entity && row(group ? 'Edit title on the canvas' : 'Edit text on the canvas', 'Type', editText, true)}
    {block && needsContentInteraction(type?.renderer) && !u.compact && row('Interact', 'MousePointerClick', interact, false)}
    {block && slot?.kind === 'reset' && row(slot.label, slot.icon, () => { void reset().catch(c.fail); }, true, false, resetUnavailable)}
    {group && row('Add inside', 'Plus', add)}
    {group && row(group.collapsed ? 'Expand' : 'Collapse', group.collapsed ? 'ChevronDown' : 'ChevronUp', () => { void patchEntity({ collapsed: !group.collapsed }, group.collapsed ? 'Expand Frame' : 'Collapse Frame'); })}
    {selected.length > 1 && row('Wrap in a Frame', 'SquareDashed', groupSelection)}
    {selected.length === 2 && row('Connect the two', 'Spline', connectSelection)}
    {row('Duplicate', 'CopyPlus', duplicate)}
    {group && row('Unwrap Frame', 'Ungroup', () => { void apply([{ type: 'group.delete', id: group.id, ungroup: true }], 'Unwrap Frame'); })}
    {(entity?.position || selected.some(e => e.position)) && row(selected.length > 1 ? 'Release positions' : 'Release position', 'PinOff', () => release(selected.filter(e => e.position).map(e => e.id)))}
    {group && pinnedChildren(doc, group.id).length > 0 && row('Arrange automatically', 'LayoutGrid', () => release(pinnedChildren(doc, group.id), 'Arrange automatically'))}
    {selected.length > 0 && selected[0].parentGroupId && selected.every(e => e.parentGroupId === selected[0].parentGroupId) && row('Take out of the Frame', 'LogOut', () => { try { void apply(leaveGroupOperations(doc, c.selection, rects(), c.catalog), 'Take out of the Frame'); } catch (error) { c.fail(error); } })}
    {block?.size && row('Automatic size', 'Maximize', () => { void patchEntity({ size: null }, 'Restore automatic size'); })}
    {entity?.parentGroupId && ['stack', 'grid', 'flow'].includes(containerMode(doc, entity.parentGroupId, c.catalog)) && [-1, 1].map(direction => row(direction < 0 ? 'Move earlier' : 'Move later', direction < 0 ? 'ChevronUp' : 'ChevronDown', () => { void apply(reorderOperation(doc, entity.id, direction), direction < 0 ? 'Move earlier' : 'Move later'); }, true, false, !reorderOperation(doc, entity.id, direction).length))}
    {row(group ? 'Delete Frame and contents' : 'Delete', 'Trash2', remove, true, true)}
  </>;
  return <View nativeID="lienzo-properties">{head}
    {style && <PanelSection title="Style">{style}</PanelSection>}
    {block && !isWhiteboardSelection(c, selected) && <PanelSection title="Content">{fields}</PanelSection>}
    {group && <PanelSection title="Frame">
      <Field key={group.id + ':title'} label="Title" value={group.title} disabled={disabled} onSave={title => patchEntity({ title }, 'Edit title')} />
      <Field key={group.id + ':purpose'} label="Purpose" value={group.description} multiline disabled={disabled} helper="One sentence: what this Frame is for." onSave={description => patchEntity({ description }, 'Edit Frame purpose')} />
    </PanelSection>}
    {group && <PanelSection title="Layout">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{(['graph', 'stack', 'grid', 'flow', 'free'] as const).map(mode => <Pressable key={mode} accessibilityRole="button" accessibilityLabel={tokens.layout.labels[mode]} accessibilityState={{ selected: mode === layoutMode, disabled }} disabled={disabled} onPress={() => saveLayout({ ...layout, mode })} style={{ width: 50, height: 48, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 6, borderWidth: mode === layoutMode ? layout ? 1.5 : 1 : 0, borderStyle: !layout ? 'dashed' : 'solid', borderColor: layout ? u.c.accent : u.c.border, backgroundColor: mode === layoutMode && layout ? u.wash('acento') : 'transparent', opacity: disabled ? .45 : 1 }}><Icon name={layoutIcons[mode]} size={18} color={u.c.foreground} /><Txt kind="small">{tokens.layout.labels[mode]}</Txt></Pressable>)}</View>
      {!layout && <Txt kind="small" muted>Automatic: arranged as {tokens.layout.labels[layoutMode === 'rows' ? 'stack' : layoutMode].toLocaleLowerCase()}.</Txt>}
      {layoutMode === 'graph' && <Segments value={layout?.direction ?? 'down'} options={[{ value: 'down', label: 'Downwards' }, { value: 'right', label: 'To the right' }]} disabled={disabled} onChange={direction => saveLayout({ ...layout, mode: 'graph', direction })} />}
      {layoutMode === 'grid' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Txt>Columns</Txt><IconButton icon="Minus" label="Fewer columns" disabled={disabled || (layout?.columns ?? 2) <= 1} onPress={() => saveLayout({ ...layout, mode: 'grid', columns: (layout?.columns ?? 2) - 1 })} /><Txt>{layout?.columns ?? 2}</Txt><IconButton icon="Plus" label="More columns" disabled={disabled || (layout?.columns ?? 2) >= 4} onPress={() => saveLayout({ ...layout, mode: 'grid', columns: (layout?.columns ?? 2) + 1 })} /></View>}
    </PanelSection>}
    {group && <PanelSection title="Variables" summary={group.variables?.length ? String(group.variables.length) : undefined}><VariablesEditor controller={c} scopeId={group.id} disabled={disabled} /></PanelSection>}
    {entity && <PanelSection title="Instructions for the agent" summary={hasCommunication(entity.communication) ? 'Written' : undefined}>
      <Field key={'instruction:' + (target ?? doc.id)} label={target === entity.id ? 'How the agent should talk about this' : target ? `Frame “${targetEntity?.title}”` : 'The whole Lienzo'} value={communication?.instructions ?? ''} multiline inputStyle={{ minHeight: 72, maxHeight: 192 }} disabled={disabled} placeholder="For example: explain it to a beginner, step by step." onSave={instructions => saveCommunication({ instructions })} />
      {levels.length > 0 && <><Txt kind="small" muted>Also applies:</Txt>{levels.map(level => <Button key={level.id} label={level.id === doc.id ? 'The whole Lienzo' : 'Frame “' + level.title + '”'} icon="Compass" variant="ghost" small onPress={() => setInstructionTarget(level.id === doc.id ? null : level.id)} />)}</>}
      {target !== entity.id && <Button label="Back to this one" small variant="ghost" onPress={() => setInstructionTarget(undefined)} />}
      {hasCommunication(communication) && <Button label="Clear" icon="Eraser" variant="ghost" small disabled={disabled} onPress={() => { void saveCommunication({ instructions: '', intent: '', audience: '' }).then(next => { if (next) undoNotice('Instructions cleared'); }); }} />}
    </PanelSection>}
    {entity && <PanelSection title="Connect" summary={links ? String(links) : undefined}>
      <TextInput accessibilityLabel="Find something to connect to" placeholder="Search by title" placeholderTextColor={u.c.foregroundMuted} value={query} onChangeText={setQuery} onSubmitEditing={() => { if (candidates[0]) connectTo(candidates[0].id); }} style={[u.font('body'), { minHeight: u.compact ? 44 : 32, paddingHorizontal: 10, backgroundColor: u.c.surface2, borderRadius: 6, borderWidth: 1, borderColor: u.c.border }]} />
      {candidates.slice(0, 6).map(candidate => <Pressable key={candidate.id} accessibilityRole="menuitem" accessibilityLabel={'Connect to ' + (candidate.title || 'Untitled')} disabled={disabled} accessibilityState={{ disabled }} onPress={() => connectTo(candidate.id)} style={{ minHeight: 40, flexDirection: 'row', gap: 8, alignItems: 'center', opacity: disabled ? .45 : 1 }}><Icon name={'groupIds' in candidate ? 'SquareDashed' : 'CircleDot'} size={16} color={u.c.foregroundMuted} /><View style={{ flex: 1 }}><Txt numberOfLines={1}>{candidate.title || 'Untitled'}</Txt><Txt kind="small" muted numberOfLines={1}>{doc.groups.find(parent => parent.id === candidate.parentGroupId)?.title ?? 'The whole Lienzo'}</Txt></View></Pressable>)}
      {!candidates.length && <Txt kind="small" muted>{query.trim() ? `Nothing matches “${query}”.` : 'Nothing else to connect to.'}</Txt>}{candidates.length > 6 && <Txt kind="small" muted>{candidates.length - 6} more. Type to narrow.</Txt>}
    </PanelSection>}
    <PanelSection title="Actions">{actions}</PanelSection>
  </View>;
}
const isWhiteboardSelection = (c: CanvasController, selected: readonly { id: string }[]) => selected.length > 0 && selected.every(e => 'typeId' in e && isWhiteboardRenderer(c.catalog?.blockTypes.find(t => t.id === (e as { typeId: string }).typeId)?.renderer));
