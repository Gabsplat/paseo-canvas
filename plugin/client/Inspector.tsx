import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import type { CanvasBlock, CanvasGroup, CanvasLink, CanvasOperation } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { Button, CheckRow, Chip, Field, IconButton, Input, Section, Segments, Txt, useUI } from './ui';
import { newId, topSelection, ancestors, connectOperations, containerMode, freezeOperations, manual, pinnedChildren, type LinkKind, type Rect } from './logic';
import { ConnectionRows, Delivery } from './Blocks';
import { linkTone } from './Links';
import { tokens } from './tokens';
import { withAlpha } from './color';
type Communication = NonNullable<CanvasBlock['communication']>;
function CommunicationEditor({ value, save, disabled }: { value?: Communication; save: (v: Partial<Communication>) => Promise<unknown>; disabled: boolean }) {
  return <Field label="Indicaciones para el asistente" value={value?.instructions ?? ''} disabled={disabled} multiline placeholder="Cómo debe comunicarse el asistente a través de este lienzo" onSave={instructions => save({ instructions })} />;
}
const G = tokens.graph, toneNames = { neutro: 'Neutro', acento: 'Acento', violeta: 'Violeta', turquesa: 'Turquesa', aviso: 'Aviso', peligro: 'Peligro' } as const;
function LinkEditor({ controller: c, link, onLink }: { controller: CanvasController; link: CanvasLink; onLink: (id: string | null) => void }) {
  const u = useUI(), doc = c.view!.document, disabled = c.busy || c.offline, title = (id: string) => [...doc.blocks, ...doc.groups].find(e => e.id === id)?.title || id;
  const update = (patch: Partial<Omit<CanvasLink, 'id'>>, label: string) => c.edit([{ type: 'link.update', id: link.id, patch }], label);
  const parallel = doc.links.filter(l => l.id !== link.id && (l.from === link.from && l.to === link.to || l.from === link.to && l.to === link.from));
  // A tone cannot be unset by a patch, so "automatic" replaces the link by itself without one, in one transaction.
  const automatic = () => { const { tone: _tone, ...rest } = link; return c.edit([{ type: 'link.delete', id: link.id }, { type: 'link.create', link: rest }], 'Quitar color del enlace'); };
  const swatch = (key: string, name: string, color: string, selected: boolean, press: () => void) => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={`Color ${name}`} accessibilityState={{ checked: selected, disabled }} disabled={disabled} hitSlop={u.compact ? 8 : 2} onPress={press} style={{ width: 28, height: 28, borderRadius: 14, borderWidth: selected ? 2 : 1, borderColor: selected ? u.c.foreground : u.c.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? .45 : 1 }}><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color }} /></Pressable>;
  return <>
    <View style={{ gap: 12 }}>
      <Field key={`${link.id}:label`} label="Etiqueta" value={link.label ?? ''} disabled={disabled} placeholder="Qué pasa por este enlace (opcional)" helper="Se dibuja sobre la línea. Máximo 200 caracteres." onSave={label => { if (label.length > 200) throw new Error('Máximo 200 caracteres.'); return update({ label }, 'Editar etiqueta del enlace'); }} />
      <Txt kind="small" style={{ fontWeight: '600' }}>Tipo</Txt><Segments value={link.kind} options={(Object.keys(G.kinds) as LinkKind[]).map(value => ({ value, label: G.kinds[value] }))} disabled={disabled} onChange={kind => { if (kind !== link.kind) void update({ kind }, 'Cambiar tipo de enlace'); }} />
      <Txt kind="small" muted>{G.kindHelp[link.kind]} «{title(link.to)}». {link.kind === 'flow' ? 'Línea continua.' : link.kind === 'depends' ? 'Línea discontinua.' : 'Línea punteada.'}</Txt>
      <Txt kind="small" style={{ fontWeight: '600' }}>Color</Txt>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Pressable accessibilityRole="radio" accessibilityLabel="Color automático según el tipo" accessibilityState={{ checked: !link.tone, disabled }} disabled={disabled} onPress={() => { if (link.tone) void automatic(); }} style={{ height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: !link.tone ? 2 : 1, borderColor: !link.tone ? u.c.foreground : u.c.border, justifyContent: 'center', opacity: disabled ? .45 : 1 }}><Txt kind="small" style={{ fontWeight: '600' }}>Auto</Txt></Pressable>
        {G.tones.map(tone => swatch(tone, toneNames[tone], tone === 'neutro' ? withAlpha(u.c.foregroundMuted, .8) : u.tone(linkTone({ kind: link.kind, tone })), link.tone === tone, () => { if (link.tone !== tone) void update({ tone }, 'Cambiar color del enlace'); }))}
      </View>
    </View>
    {parallel.length > 0 && <Section title="Mismo par de elementos">{parallel.map(other => <Button key={other.id} label={`${other.from === link.from ? '→' : '←'} ${other.label || G.kinds[other.kind]}`} variant="ghost" style={{ justifyContent: 'flex-start' }} onPress={() => onLink(other.id)} />)}</Section>}
    <View style={{ gap: 12, paddingTop: 20, borderTopWidth: 1, borderColor: u.c.border }}>
      <Button label="Invertir dirección" icon="ArrowLeftRight" small disabled={disabled} style={{ alignSelf: 'flex-start' }} onPress={() => { void update({ from: link.to, to: link.from }, 'Invertir enlace'); }} />
      <Button label="Eliminar enlace" variant="danger" disabled={disabled} onPress={() => { void c.edit([{ type: 'link.delete', id: link.id }], 'Eliminar enlace').then(next => { if (next) onLink(null); }); }} />
    </View>
  </>;
}
function ConnectPicker({ controller: c, from, onLink }: { controller: CanvasController; from: string; onLink: (id: string | null) => void }) {
  const u = useUI(), doc = c.view!.document, [open, setOpen] = useState(false), [query, setQuery] = useState(''), disabled = c.busy || c.offline;
  const self = [...doc.blocks, ...doc.groups].find(e => e.id === from)!, family = new Set([from, ...ancestors(doc, self).map(g => g.id)]);
  const needle = query.trim().toLowerCase(), candidates = [...doc.blocks, ...doc.groups].filter(e => !family.has(e.id) && !ancestors(doc, e).some(g => g.id === from) && (!needle || (e.title || e.id).toLowerCase().includes(needle)));
  const connect = (to: string) => {
    const { existing, operations, id } = connectOperations(doc, from, to);
    if (existing) { onLink(existing.id); void c.select([]); return; }
    void c.edit(operations, `Conectar «${self.title || from}» → «${candidates.find(e => e.id === to)?.title || to}»`).then(next => { if (next && id) { setOpen(false); setQuery(''); onLink(id); void c.select([]); } });
  };
  if (!open) return <Button label="Conectar con…" icon="Spline" small disabled={disabled} style={{ alignSelf: 'flex-start' }} onPress={() => setOpen(true)} />;
  return <View style={{ gap: 8 }}><Input label="Buscar elemento que conectar" placeholder="Buscar por título" value={query} onChange={setQuery} />
    {candidates.slice(0, 8).map(e => <Button key={e.id} label={`→ ${e.title || e.id}`} icon={'groupIds' in e ? 'Group' : 'CircleDot'} variant="ghost" disabled={disabled} style={{ justifyContent: 'flex-start' }} onPress={() => connect(e.id)} />)}
    {!candidates.length && <Txt kind="small" muted>{needle ? 'Nada coincide con la búsqueda.' : 'No hay otro elemento que conectar.'}</Txt>}
    {candidates.length > 8 && <Txt kind="small" muted>{candidates.length - 8} más. Escribe para acotar.</Txt>}
    <Button label="Cancelar" small variant="ghost" style={{ alignSelf: 'flex-start' }} onPress={() => { setOpen(false); setQuery(''); }} />
    <Txt kind="small" muted style={{ color: u.c.foregroundMuted }}>En el lienzo también puedes arrastrar desde el punto «+» del borde de un nodo hasta otro.</Txt>
  </View>;
}
export function Inspector({ controller: c, linkId, onLink, onClose, groupSelection, release, rects, onTemplate, onExportSelection, reorder, initialSection }: { controller: CanvasController; linkId: string | null; onLink: (id: string | null) => void; onClose?: () => void; groupSelection: () => void; release: (ids: string[], label?: string) => void; rects: () => Map<string, Rect>; onTemplate: (g: CanvasGroup) => void; onExportSelection: () => void; reorder: (id: string, direction: number) => void; initialSection?: 'document' | 'communication' | 'history' | 'activity' }) {
  const u = useUI(), doc = c.view?.document, [history, setHistory] = useState<Awaited<ReturnType<typeof c.api.history>>['transactions']>([]);
  const scroller = React.useRef<React.ComponentRef<typeof ScrollView>>(null), anchors = React.useRef<Record<string, number>>({});
  const anchor = (section: string) => (event: { nativeEvent: { layout: { y: number } } }) => { anchors.current[section] = event.nativeEvent.layout.y; if (initialSection === section) scroller.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false }); };
  useEffect(() => { if (initialSection) scroller.current?.scrollTo({ y: anchors.current[initialSection] ?? 0, animated: false }); }, [initialSection]);
  useEffect(() => { let live = true; if (doc) void c.api.history({ workspaceId: c.workspaceId, documentId: doc.id }).then(r => { if (live) setHistory(r.transactions); }).catch(() => {}); return () => { live = false; }; }, [doc?.id, doc?.revision]);
  if (!doc) return <View style={{ padding: 16 }}><Txt muted>{c.loading ? 'Cargando…' : 'Abre un documento para editarlo.'}</Txt></View>;
  const selected = [...doc.groups, ...doc.blocks].filter(e => c.selection.includes(e.id)), e = selected.length === 1 ? selected[0] : undefined;
  const group = e && 'groupIds' in e ? e : undefined, block = e && 'typeId' in e ? e : undefined, type = c.catalog?.blockTypes.find(t => t.id === block?.typeId), disabled = c.busy || c.offline;
  const link = linkId ? doc.links.find(l => l.id === linkId) : undefined, title = (id: string) => [...doc.blocks, ...doc.groups].find(item => item.id === id)?.title || id;
  const mode = containerMode(doc, group?.id ?? null, c.catalog), layout = group ? group.layout : doc.layout, modes = ['graph', 'stack', 'grid', 'flow', 'free'] as const;
  const pinned = block ? [] : pinnedChildren(doc, group?.id ?? null);
  // Switching to Libre freezes everything where it is drawn, in the same transaction, so the switch itself moves nothing.
  const setLayout = (next: NonNullable<CanvasGroup['layout']>, label: string) => {
    const frozen = next.mode === 'free' && !manual(mode) ? freezeOperations(doc, rects(), group?.id ?? null) : [];
    if (frozen.length > 199) { c.fail(new Error('Este cambio supera las 200 operaciones de una transacción. Divide los elementos en grupos más pequeños.')); return Promise.resolve(undefined); }
    return c.edit([...frozen, group ? { type: 'group.update', id: group.id, patch: { layout: next } } : { type: 'document.update', layout: next }], label);
  };
  const editEntity = (patch: Partial<CanvasBlock> | Partial<CanvasGroup>, label: string) => c.edit([{ type: group ? 'group.update' : 'block.update', id: e!.id, patch } as CanvasOperation], label);
  const editComm = async (patch: Partial<Communication>) => {
    const id = doc.id, entityId = e?.id; await c.settle(); const latest = c.current.current?.document;
    if (!latest || latest.id !== id) return undefined;
    const target = entityId ? [...latest.blocks, ...latest.groups].find(item => item.id === entityId) : undefined;
    if (entityId && !target) return undefined;
    const communication = { intent: '', audience: '', instructions: '', ...(target?.communication ?? (!entityId ? latest.communication : undefined)), ...patch };
    return entityId ? c.edit([{ type: group ? 'group.update' : 'block.update', id: entityId, patch: { communication } } as CanvasOperation], 'Editar indicaciones para el asistente') : c.edit([{ type: 'communication.set', communication }], 'Editar indicaciones para el asistente');
  };

  return <View style={{ flex: 1, minHeight: 0, backgroundColor: u.c.surface1 }}><View style={{ minHeight: 48, padding: 12, borderBottomWidth: 1, borderColor: u.c.border, flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><Txt kind="heading" numberOfLines={1}>{link ? `${title(link.from)} → ${title(link.to)}` : selected.length > 1 ? `${selected.length} seleccionados` : e?.title ?? doc.title}</Txt></View>{onClose && <IconButton label="Cerrar detalles" icon="X" onPress={onClose} />}</View><ScrollView ref={scroller} contentContainerStyle={{ padding: 16, gap: 20 }}>
    {link ? <LinkEditor key={link.id} controller={c} link={link} onLink={onLink} /> : selected.length > 1 ? <>{selected.length === 2 && (() => { const [from, to] = c.selection.filter(id => selected.some(item => item.id === id)); return <Button label={`Conectar «${title(from)}» → «${title(to)}»`} icon="Spline" disabled={disabled} onPress={() => { const { existing, operations, id } = connectOperations(doc, from, to); if (existing) { onLink(existing.id); void c.select([]); } else if (operations.length) void c.edit(operations, `Conectar «${title(from)}» → «${title(to)}»`).then(next => { if (next && id) { onLink(id); void c.select([]); } }); }} />; })()}<Button label="Agrupar" icon="Group" disabled={disabled} onPress={groupSelection} /><Button label="Exportar selección" icon="FileOutput" disabled={disabled} onPress={onExportSelection} /><Button label="Eliminar" variant="danger" disabled={disabled} onPress={() => { void c.edit(topSelection(doc, c.selection).map(item => ({ type: 'groupIds' in item ? 'group.delete' : 'block.delete', id: item.id } as CanvasOperation)), 'Eliminar selección'); }} /></> : <>
      <View style={{ gap: 12 }}><Field label="Título" value={e?.title ?? doc.title} disabled={disabled} onSave={title => e ? editEntity({ title }, 'Editar título') : c.edit([{ type: 'document.update', title }], 'Editar título')} />
        {!block && <Field label={group ? 'Propósito' : 'Descripción'} value={group?.description ?? doc.description} multiline disabled={disabled} helper={group ? 'Una frase: para qué sirve este grupo.' : undefined} onSave={description => group ? editEntity({ description }, 'Editar propósito del grupo') : c.edit([{ type: 'document.update', description }], 'Editar descripción')} />}
        {!e && doc.example && <View style={{ backgroundColor: u.wash('aviso'), padding: 12, borderRadius: 6, gap: 8 }}><Chip label="Ejemplo" tone="aviso" icon="FlaskConical" /><Txt kind="small">Documento de ejemplo. Su contenido es ilustrativo y no proviene de tu asistente.</Txt></View>}
        {block && type?.properties.map(p => p.kind === 'boolean' ? <CheckRow key={p.key} label={p.label} checked={!!block.data[p.key]} disabled={disabled} onPress={() => { void editEntity({ data: { [p.key]: !block.data[p.key] } }, `Editar «${p.key}»`); }} /> : <Field key={`${block.id}:${p.key}`} label={p.label} required={p.required} value={p.kind === 'json' ? JSON.stringify(block.data[p.key] ?? null, null, 2) : String(block.data[p.key] ?? '')} multiline={p.kind === 'json' || p.kind === 'text'} mono={p.kind !== 'text'} disabled={disabled} onSave={value => { let parsed: unknown = value; if (p.kind === 'json') { try { parsed = JSON.parse(value); } catch { throw new Error('JSON no válido'); } } else if (p.kind === 'number') { parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error('Número no válido'); } return editEntity({ data: { [p.key]: parsed } as CanvasBlock['data'] }, `Editar «${p.key}»`); }} />)}
        {block && !type && <Txt kind="small" muted>Importa la colección que define este tipo para editar sus propiedades.</Txt>}
        {block?.size && <Button label="Tamaño automático" small variant="ghost" icon="Maximize" disabled={disabled} onPress={() => { void editEntity({ size: null }, 'Restablecer tamaño automático'); }} />}
        {!block && <><Txt kind="small" style={{ fontWeight: '600' }}>{group ? 'Disposición' : 'Disposición del lienzo'}</Txt><Segments value={mode as (typeof modes)[number]} options={modes.map(value => ({ value, label: tokens.layout.labels[value] }))} onChange={next => { void setLayout({ ...layout, mode: next }, group ? 'Cambiar disposición del grupo' : 'Cambiar disposición del lienzo'); }} disabled={disabled} />
          {manual(mode) && <Txt kind="small" muted>Libre: nada se mueve si no lo mueves tú. Al pasar a Libre, todo se queda donde está.</Txt>}
          {pinned.length > 0 && <><Button label={tokens.canvas.pin.container} small icon="LayoutGrid" style={{ alignSelf: 'flex-start' }} disabled={disabled} onPress={() => release(pinned, tokens.canvas.pin.container)} /><Txt kind="small" muted>{pinned.length === 1 ? '1 elemento tiene' : `${pinned.length} elementos tienen`} un sitio fijado a mano{manual(mode) ? '.' : '; el resto se ordena solo.'}</Txt></>}
          {!layout && <Txt kind="small" muted>{mode === 'graph' ? 'Automática: hay enlaces, se ordena como grafo.' : mode === 'rows' ? 'Automática: los grupos se reparten en filas.' : mode === 'free' ? 'Automática: posiciones guardadas; lo demás, en filas.' : 'Automática: en pila.'}</Txt>}
          {mode === 'graph' && <><Txt kind="small" style={{ fontWeight: '600' }}>Dirección del grafo</Txt><Segments value={layout?.direction ?? 'down'} options={(['down', 'right'] as const).map(value => ({ value, label: tokens.layout.graph.directions[value] }))} disabled={disabled} onChange={direction => { void setLayout({ ...layout, mode: 'graph', direction }, 'Cambiar dirección del grafo'); }} /><Txt kind="small" muted>Los elementos enlazados se ordenan por capas; los que arrastras conservan su sitio.</Txt></>}</>}
        {group && <>{group.layout?.mode === 'grid' && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><IconButton icon="Minus" label="Menos columnas" disabled={disabled || (group.layout.columns ?? 2) <= 1} onPress={() => { void editEntity({ layout: { ...group.layout!, columns: (group.layout!.columns ?? 2) - 1 } }, 'Cambiar columnas'); }} /><Txt>{group.layout.columns ?? 2} columnas</Txt><IconButton icon="Plus" label="Más columnas" disabled={disabled || (group.layout.columns ?? 2) >= 4} onPress={() => { void editEntity({ layout: { ...group.layout!, columns: (group.layout!.columns ?? 2) + 1 } }, 'Cambiar columnas'); }} /></View>}<CheckRow label="Contraer grupo" checked={!!group.collapsed} disabled={disabled} onPress={() => { void editEntity({ collapsed: !group.collapsed }, 'Contraer grupo'); }} /></>}
      </View>
      {e && <Section title="Conexiones">{!doc.links.some(l => l.from === e.id || l.to === e.id) && <Txt kind="small" muted>Sin enlaces todavía.</Txt>}<ConnectionRows doc={doc} id={e.id} onOpen={id => { void c.select([id]); }} onLink={id => { onLink(id); void c.select([]); }} /><ConnectPicker key={e.id} controller={c} from={e.id} onLink={onLink} /></Section>}
      {e?.position && <Button label={tokens.canvas.pin.label} small icon="PinOff" style={{ alignSelf: 'flex-start' }} disabled={disabled} onPress={() => release([e.id])} />}
      {group && <Section title="Contenido">{[...group.blockIds, ...group.groupIds].map(id => { const child = [...doc.blocks, ...doc.groups].find(e => e.id === id); return <View key={id} style={{ flexDirection: 'row', alignItems: 'center' }}><Button label={child?.title || id} variant="ghost" onPress={() => { void c.select([id]); }} style={{ flex: 1 }} /><IconButton label="Subir" icon="ChevronUp" disabled={disabled} onPress={() => reorder(id, -1)} /><IconButton label="Bajar" icon="ChevronDown" disabled={disabled} onPress={() => reorder(id, 1)} /></View>; })}</Section>}
      <View onLayout={anchor('communication')}><CommunicationEditor key={e?.id ?? doc.id} value={e?.communication ?? (!e ? doc.communication : undefined)} save={editComm} disabled={disabled} /></View>
      {e && <>
        <View style={{ gap: 12, paddingTop: 20, borderTopWidth: 1, borderColor: u.c.border }}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label="Exportar selección" icon="FileOutput" small disabled={disabled} onPress={onExportSelection} /><Button label="Duplicar" icon="CopyPlus" small disabled={disabled} onPress={() => { void c.edit([{ type: 'entity.duplicate', id: e.id, idPrefix: newId('copy') }], 'Duplicar elemento'); }} />{group && <><Button label="Guardar como plantilla" small disabled={disabled} onPress={() => onTemplate(group)} /><Button label="Desagrupar" icon="Ungroup" small disabled={disabled} onPress={() => { void c.edit([{ type: 'group.delete', id: group.id, ungroup: true }], 'Desagrupar'); }} /></>}</View><Button label={group ? 'Eliminar grupo y contenido' : 'Eliminar'} variant="danger" disabled={disabled} onPress={() => { void c.edit([{ type: group ? 'group.delete' : 'block.delete', id: e.id }], 'Eliminar elemento'); }} /></View></>}
      {!e && <><Section onLayout={anchor('activity')} title="Actividad">{c.events.slice(-5).reverse().map(event => <View key={event.id} style={{ gap: 4 }}><Txt kind="small">{event.action.label}</Txt><Delivery event={event} /></View>)}{c.events.some(e => e.status === 'pending' || e.status === 'failed') && <Button label="Enviar pendientes" small disabled={disabled} onPress={() => { void c.task(async () => { const result = await c.api.flush({ workspaceId: c.workspaceId, documentId: doc.id }); c.setEvents(result.events); }); }} />}{!c.events.length && <Txt kind="small" muted>Aún no hay acciones enviadas.</Txt>}</Section><Section onLayout={anchor('history')} title="Historial">{history.slice(-8).reverse().map(tx => <View key={tx.id} style={{ gap: 4 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name={tx.actor === 'agent' ? 'Bot' : tx.actor === 'user' ? 'User' : 'Cog'} size={12} color={u.c.foregroundMuted} /></View><Txt kind="small" muted={tx.kind !== 'edit'}>{tx.label}</Txt><Txt kind="small" muted>{new Date(tx.at).toLocaleString('es')}</Txt></View>)}</Section></>}
    </>}
  </ScrollView></View>;
}
