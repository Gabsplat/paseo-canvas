import React from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from './host';
import type { CanvasGroup } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { Button, Field, IconButton, Segments, Txt, useUI } from './ui';
import { communicationOperation, layoutIcons, layoutOperations } from './panel-actions';
import { containerMode, pinnedChildren, type Rect } from './logic';
import { tokens } from './tokens';
export function DocumentActions({ controller: c, section, rects, release }: { controller: CanvasController; section: 'document' | 'communication'; rects(): Map<string, Rect>; release(ids: string[], label?: string): void }) {
  const u = useUI(), doc = c.view!.document, disabled = c.busy || c.offline;
  const saveCommunication = async (instructions: string) => { const id = doc.id; await c.settle(); const latest = c.current.current?.document; if (!latest || latest.id !== id || disabled) return; return c.edit([communicationOperation(latest, null, { instructions })], 'Edit instructions for the agent'); };
  const layout = doc.layout, mode = containerMode(doc, null, c.catalog), pinned = pinnedChildren(doc, null);
  const saveLayout = (next: NonNullable<CanvasGroup['layout']>) => { if (disabled) return; try { void c.edit(layoutOperations(doc, null, next, rects(), c.catalog), 'Change Lienzo layout'); } catch (error) { c.fail(error); } };
  return <View style={{ gap: 12 }}>
    {section === 'document' && doc.example && <View style={{ backgroundColor: u.wash('aviso'), padding: 12, borderRadius: 6 }}><Txt kind="small">Example Lienzo. Its content is illustrative and does not come from an agent.</Txt></View>}
    {section === 'document' && <Field label="Description" value={doc.description} multiline disabled={disabled} onSave={description => c.edit([{ type: 'document.update', description }], 'Edit description')} />}
    <Field label="Instructions for the agent" value={doc.communication.instructions} multiline inputStyle={{ minHeight: 72 }} disabled={disabled} placeholder="What this Lienzo is for and how the agent should help" onSave={saveCommunication} />
    {!!doc.communication.intent && <Txt kind="small" muted>Intent: {doc.communication.intent}</Txt>}{!!doc.communication.audience && <Txt kind="small" muted>Audience: {doc.communication.audience}</Txt>}
    {section === 'document' && <><Txt kind="small">Layout</Txt><View style={{ flexDirection: 'row', gap: 4 }}>{(['graph', 'stack', 'grid', 'flow', 'free'] as const).map(next => <Pressable key={next} accessibilityRole="button" accessibilityLabel={tokens.layout.labels[next]} accessibilityState={{ selected: mode === next, disabled }} disabled={disabled} onPress={() => saveLayout({ ...layout, mode: next })} style={{ flex: 1, minWidth: 44, height: 48, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 6, borderWidth: mode === next ? layout ? 1.5 : 1 : 0, borderStyle: layout ? 'solid' : 'dashed', borderColor: layout ? u.c.accent : u.c.border, backgroundColor: mode === next && layout ? u.wash('acento') : 'transparent', opacity: disabled ? .45 : 1 }}><Icon name={layoutIcons[next]} size={20} color={u.c.foreground} /><Txt kind="small">{tokens.layout.labels[next]}</Txt></Pressable>)}</View>
      {!layout && <Txt kind="small" muted>Automatic: arranged as {tokens.layout.labels[mode === 'rows' ? 'stack' : mode].toLocaleLowerCase()}.</Txt>}
      {mode === 'graph' && <Segments value={layout?.direction ?? 'down'} options={[{ value: 'down', label: 'Downwards' }, { value: 'right', label: 'To the right' }]} disabled={disabled} onChange={direction => saveLayout({ ...layout, mode: 'graph', direction })} />}
      {mode === 'grid' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Txt>Columns</Txt><IconButton label="Fewer columns" icon="Minus" disabled={disabled || (layout?.columns ?? 2) <= 1} onPress={() => saveLayout({ ...layout, mode: 'grid', columns: (layout?.columns ?? 2) - 1 })} /><Txt>{layout?.columns ?? 2}</Txt><IconButton label="More columns" icon="Plus" disabled={disabled || (layout?.columns ?? 2) >= 4} onPress={() => saveLayout({ ...layout, mode: 'grid', columns: (layout?.columns ?? 2) + 1 })} /></View>}
      {!!pinned.length && <Button label="Arrange automatically" disabled={disabled} onPress={() => release(pinned, 'Arrange automatically')} />}
    </>}
  </View>;
}
