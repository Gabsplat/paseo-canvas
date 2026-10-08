import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import { fileTreeRows, fileTreeTargets, visibleFileTreeRows, type FileTreeData } from '../../shared/renderers/file-tree';
import { withAlpha } from '../color';
import { Txt } from '../ui';
import { tokens } from '../tokens';
import type { RendererProps, ClientRenderer } from './types';
const T = tokens.fileTree;
function FileTree({ data, block, ui, document, selection = [], select }: RendererProps<FileTreeData>) {
  const rows = useMemo(() => fileTreeRows(data), [data]);
  // An entry and the card that explains it point at each other: pressing one selects the other, and it shows.
  const targets = useMemo(() => fileTreeTargets(rows, document, block.id), [rows, document.blocks, document.groups, block.id]);
  // Opening and closing is the reader's own view of the tree: local, never written to the document.
  const [closed, setClosed] = useState(() => new Set((data.collapsed ?? []).map(path => path.replace(/\/$/, ''))));
  const visible = visibleFileTreeRows(rows, closed), row = ui.compact ? T.rowCompact : T.row;
  const toggle = (path: string) => setClosed(current => { const next = new Set(current); if (!next.delete(path)) next.add(path); return next; });
  return <View accessibilityRole="list" accessibilityLabel={`Árbol de archivos${data.root ? ` de ${data.root}` : ''}`} style={{ marginHorizontal: -T.bleed }}>
    {!!data.root && <View style={{ minHeight: row, paddingHorizontal: T.bleed, flexDirection: 'row', alignItems: 'center', gap: T.gap }}><Icon name="FolderRoot" size={T.icon} color={ui.c.foregroundMuted} /><Txt kind="code" numberOfLines={1} style={{ fontWeight: '600', color: ui.c.foregroundMuted }}>{data.root}</Txt></View>}
    {visible.map(entry => {
      const open = entry.dir && !closed.has(entry.path), accent = ui.c.accent, foldable = entry.dir && entry.children > 0;
      const target = select ? targets.get(entry.path) : undefined, pointed = !!target && selection.includes(target), lit = entry.highlight || pointed;
      const chevron = <View style={{ width: T.chevron, alignItems: 'center' }}>{foldable && <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={T.chevron} color={ui.c.foregroundMuted} />}</View>;
      const label = `${entry.dir ? 'Carpeta' : 'Archivo'} ${entry.path}${entry.note ? `: ${entry.note}` : ''}`;
      return <Pressable key={entry.path} nativeID={`lienzo-interactive-tree-${block.id}-${entry.path}`} accessibilityRole={target || foldable ? 'button' : undefined} accessibilityLabel={target ? `${label}. Ver su tarjeta` : label} accessibilityState={{ selected: pointed, ...(foldable ? { expanded: open } : {}) }} disabled={!target && !foldable}
        onPress={e => { e.stopPropagation(); if (target) select!(pointed ? [] : [target]); else toggle(entry.path); }}
        style={({ pressed, ...state }) => ({ minHeight: row, paddingHorizontal: T.bleed, flexDirection: 'row', alignItems: 'center', gap: T.gap, borderRadius: T.radius, opacity: entry.muted ? T.mutedAlpha : 1,
          backgroundColor: pointed ? withAlpha(accent, T.pointedFill) : entry.highlight ? withAlpha(accent, T.highlightFill) : pressed ? withAlpha(ui.c.foreground, .1) : (state as { hovered?: boolean }).hovered && (target || foldable) ? withAlpha(ui.c.foreground, .06) : 'transparent' })}>
        {/* One thin guide per level keeps deep entries attached to their folder. */}
        {Array.from({ length: entry.depth + (data.root ? 1 : 0) }, (_, level) => <View key={level} pointerEvents="none" style={{ width: T.indent, alignSelf: 'stretch', alignItems: 'center' }}><View style={{ width: 1, flex: 1, backgroundColor: ui.c.border }} /></View>)}
        {/* On a linked folder the row selects its card, so the chevron is the part that opens and closes it. */}
        {target && foldable ? <Pressable accessibilityRole="button" accessibilityLabel={`${open ? 'Cerrar' : 'Abrir'} ${entry.path}`} hitSlop={8} onPress={e => { e.stopPropagation(); toggle(entry.path); }}>{chevron}</Pressable> : chevron}
        <Icon name={entry.dir ? open && entry.children ? 'FolderOpen' : 'Folder' : 'File'} size={T.icon} color={lit ? accent : ui.c.foregroundMuted} />
        <Txt kind="code" numberOfLines={1} style={{ flexShrink: 0, maxWidth: entry.note ? '62%' : '100%', fontWeight: entry.dir || lit ? '600' : '400', color: lit ? accent : ui.c.foreground }}>{entry.name}{entry.dir ? '/' : ''}</Txt>
        {!!entry.note && <Txt kind="small" muted numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{entry.note}</Txt>}
        {!entry.note && <View style={{ flex: 1 }} />}
        {entry.dir && !open && entry.children > 0 && <Txt kind="label" muted>{entry.children}</Txt>}
        {!!target && <Icon name="ArrowUpRight" size={T.chevron} color={pointed ? accent : ui.c.foregroundMuted} />}
      </Pressable>;
    })}
  </View>;
}
export const fileTreeRenderer: ClientRenderer<FileTreeData> = { id: 'file-tree', Component: FileTree, visual: { icon: 'FolderTree', tone: 'turquesa', width: 'standard' } };
