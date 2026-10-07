import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import type { CanvasLink } from '../shared/model';
import { withAlpha, type Tone } from './color';
import { tokens } from './tokens';
import { Button, Txt, useUI } from './ui';
import type { CanvasController } from './useCanvas';
import { useHistory } from './useHistory';
import { focusOf, matrixOf, readings, streamOf, type Neighbour } from './view-models';

type ViewProps = { controller: CanvasController; onOpen(id: string): void };
const V = tokens.views, kindTone = (kind: CanvasLink['kind']): Tone => tokens.graph.link.defaultTone[kind] as Tone, kindName = (kind: CanvasLink['kind']) => tokens.graph.kinds[kind];
/** Shared shell of the alternative views: clear of the islands, one question as its heading, the canvas one press away. */
function Frame({ title, question, children, scroll = true }: { title: string; question: string; children: React.ReactNode; scroll?: boolean }) {
  const u = useUI(), head = <View style={{ gap: 2, paddingBottom: 12 }}><Txt kind="heading">{title}</Txt><Txt kind="small" muted>{question}</Txt></View>;
  const style = { flex: 1, backgroundColor: u.c.surface0 }, inner = { paddingTop: u.compact ? 16 : tokens.island.bannerTop + 8, paddingHorizontal: u.compact ? 16 : V.padX, paddingBottom: V.padBottom };
  return scroll ? <ScrollView style={style} contentContainerStyle={inner}>{head}{children}</ScrollView> : <View style={[style, inner]}>{head}{children}</View>;
}
function Empty({ text }: { text: string }) { return <Txt kind="small" muted>{text}</Txt>; }

// ---- Foco ---------------------------------------------------------------------------------------------------------
function Slot({ title, items, tone, onPick, align = 'stretch' }: { title: string; items: Neighbour[]; tone: Tone; onPick(id: string): void; align?: 'stretch' | 'flex-end' | 'flex-start' }) {
  const u = useUI();
  return <View style={{ flex: 1, minWidth: 0, gap: 6, alignItems: align }}><Txt kind="label" muted>{title}</Txt>
    {!items.length && <View style={{ minHeight: 36, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: u.c.border, justifyContent: 'center', paddingHorizontal: 10, alignSelf: 'stretch' }}><Txt kind="small" muted>Nada</Txt></View>}
    {items.map(n => <Pressable key={n.linkId} accessibilityRole="button" accessibilityLabel={`Ir a ${n.title}`} onPress={() => onPick(n.id)} style={({ pressed, ...state }) => ({ alignSelf: 'stretch', borderRadius: 8, borderWidth: 1, borderLeftWidth: 3, borderColor: (state as { hovered?: boolean }).hovered ? u.tone(tone) : u.c.border, borderLeftColor: u.tone(tone), backgroundColor: pressed ? u.c.surface2 : u.c.surface1, paddingHorizontal: 10, paddingVertical: 8, gap: 2 })}>
      <Txt numberOfLines={2} style={{ fontWeight: '600' }}>{n.title}</Txt>{!!n.label && <Txt kind="small" muted numberOfLines={1}>{n.label}</Txt>}</Pressable>)}
  </View>;
}
/** One thing in the middle and everything it touches around it, placed by what each link means. Press a neighbour to stand there. */
export function FocusView({ controller: c, onOpen }: ViewProps) {
  const u = useUI(), doc = c.view!.document, all = [...doc.blocks, ...doc.groups], linked = new Set((doc.links ?? []).flatMap(l => [l.from, l.to]));
  const id = c.selection.length === 1 && all.some(e => e.id === c.selection[0]) ? c.selection[0] : all.find(e => linked.has(e.id))?.id ?? all[0]?.id, here = all.find(e => e.id === id);
  const f = useMemo(() => id ? focusOf(doc, id) : null, [doc.links, doc.blocks, doc.groups, id]), pick = (next: string) => { void c.select([next]); };
  const block = doc.blocks.find(b => b.id === id), summary = block ? String(block.data.summary ?? block.data.text ?? '') : '';
  if (!here || !f) return <Frame title="Foco" question="¿Qué papel cumple esto?"><Empty text="Todavía no hay nada en este lienzo." /></Frame>;
  return <Frame title="Foco" question="¿Qué papel cumple esto? Lo que necesita arriba, quién lo necesita abajo, el flujo a los lados.">
    <View style={{ gap: 16, maxWidth: V.focusMax, alignSelf: 'center', width: '100%' }}>
      <Slot title="Necesita a" items={f.needs} tone="violeta" onPick={pick} />
      <View style={{ flexDirection: u.compact ? 'column' : 'row', gap: 16, alignItems: 'flex-start' }}>
        <Slot title="Viene de" items={f.before} tone="acento" onPick={pick} />
        <View nativeID="lienzo-focus-centre" style={{ flex: u.compact ? undefined : 1.3, alignSelf: 'stretch', borderRadius: 12, borderWidth: 2, borderColor: u.c.accent, backgroundColor: u.c.surface1, padding: 14, gap: 6 }}>
          <Txt kind="heading" numberOfLines={3}>{here.title || 'Sin título'}</Txt>{!!summary && <Txt kind="small" muted numberOfLines={6}>{summary}</Txt>}
          <Button label="Ver en el lienzo" small icon="Frame" style={{ alignSelf: 'flex-start' }} onPress={() => onOpen(here.id)} />
        </View>
        <Slot title="Sigue a" items={f.after} tone="acento" onPick={pick} />
      </View>
      <Slot title="Lo necesitan" items={f.neededBy} tone="violeta" onPick={pick} />
      {!!f.mentions.length && <Slot title="Menciones" items={f.mentions} tone="turquesa" onPick={pick} />}
    </View>
  </Frame>;
}

// ---- Lecturas cruzadas --------------------------------------------------------------------------------------------
/** The same cards read along the lines the links already draw: pick a reading and walk it one card at a time. */
export function ReadingsView({ controller: c, onOpen }: ViewProps) {
  const u = useUI(), doc = c.view!.document, list = useMemo(() => readings(doc), [doc.links, doc.blocks, doc.groups]), [key, setKey] = useState(''), [at, setAt] = useState(0);
  const reading = list.find(r => r.key === key) ?? list[0], title = (id: string) => [...doc.blocks, ...doc.groups].find(e => e.id === id)?.title || 'Sin título';
  useEffect(() => { setAt(0); }, [reading?.key]);
  const step = reading?.steps[Math.min(at, (reading?.steps.length ?? 1) - 1)], block = step ? doc.blocks.find(b => b.id === step.id) : undefined;
  // A card that sits on several readings is a crossing: the same card, a different role in each.
  const crossings = step ? list.filter(r => r.key !== reading!.key && r.steps.some(s => s.id === step.id)) : [];
  if (!reading) return <Frame title="Lecturas" question="¿Cuál es el camino de un punto a otro?"><Empty text="Este lienzo no tiene enlaces de flujo ni de dependencia, así que no hay caminos que leer." /></Frame>;
  return <Frame title="Lecturas" question="¿Cuál es el camino de un punto a otro? Cada cadena de enlaces es una lectura de las mismas tarjetas.">
    <View style={{ flexDirection: u.compact ? 'column' : 'row', gap: 20, alignItems: 'flex-start' }}>
      <View style={{ width: u.compact ? '100%' : V.listWidth, gap: 4 }}>
        {list.map(r => { const on = r.key === reading.key; return <Pressable key={r.key} accessibilityRole="button" accessibilityLabel={`Lectura de ${title(r.steps[0].id)} a ${title(r.steps.at(-1)!.id)}`} accessibilityState={{ selected: on }} onPress={() => setKey(r.key)}
          style={({ pressed, ...state }) => ({ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 2, borderLeftWidth: 3, borderLeftColor: u.tone(kindTone(r.kind)), backgroundColor: on ? withAlpha(u.c.accent, .14) : pressed || (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
          <Txt numberOfLines={1} style={{ fontWeight: on ? '600' : '400' }}>{title(r.steps[0].id)} → {title(r.steps.at(-1)!.id)}</Txt><Txt kind="label" muted>{kindName(r.kind)} · {r.steps.length} pasos</Txt></Pressable>; })}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 12, alignSelf: 'stretch' }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{reading.steps.map((s, i) => <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`Paso ${i + 1}: ${title(s.id)}`} accessibilityState={{ selected: i === at }} onPress={() => setAt(i)}
          style={{ maxWidth: 180, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, borderWidth: i === at ? 2 : 1, borderColor: i === at ? u.c.accent : u.c.border, backgroundColor: i <= at ? u.c.surface1 : 'transparent', paddingHorizontal: 8, paddingVertical: 6, opacity: i <= at ? 1 : .6 }}>
          <Txt kind="label" style={{ color: i === at ? u.c.accent : u.c.foregroundMuted }}>{i + 1}</Txt><Txt kind="small" numberOfLines={1} style={{ flexShrink: 1 }}>{title(s.id)}</Txt></Pressable>)}</View>
        {step && <View nativeID="lienzo-reading-step" style={{ borderRadius: 12, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, padding: 16, gap: 8 }}>
          {!!step.via && <Txt kind="small" style={{ color: u.tone(kindTone(reading.kind)) }}>← {step.via}</Txt>}
          <Txt kind="heading">{title(step.id)}</Txt>{!!block && !!String(block.data.summary ?? block.data.text ?? '') && <Txt muted>{String(block.data.summary ?? block.data.text ?? '')}</Txt>}
          {!!crossings.length && <Txt kind="small" muted>Cruce: también está en {crossings.slice(0, 3).map(r => `«${title(r.steps[0].id)} → ${title(r.steps.at(-1)!.id)}»`).join(', ')}{crossings.length > 3 ? ` y ${crossings.length - 3} más` : ''}.</Txt>}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Button label="Anterior" small icon="ArrowLeft" disabled={at === 0} onPress={() => setAt(at - 1)} /><Button label="Siguiente" small variant="primary" icon="ArrowRight" disabled={at >= reading.steps.length - 1} onPress={() => setAt(at + 1)} /><Button label="Ver en el lienzo" small variant="ghost" icon="Frame" onPress={() => onOpen(step.id)} /></View>
        </View>}
      </View>
    </View>
  </Frame>;
}

// ---- Matriz -------------------------------------------------------------------------------------------------------
/** Every link as a cell: the row needs, follows or mentions the column. No lines, so nothing can cross. */
export function MatrixView({ controller: c, onOpen }: ViewProps) {
  const u = useUI(), doc = c.view!.document, m = useMemo(() => matrixOf(doc), [doc.links, doc.blocks, doc.groups]), [hover, setHover] = useState<number | null>(null), n = m.order.length, cell = V.cell, side = n * cell;
  const told = hover !== null ? m.cells[hover] : null, focusRow = told?.row ?? -1, focusCol = told?.col ?? -1;
  if (!m.cells.length) return <Frame title="Matriz" question="¿Qué está acoplado con qué?"><Empty text="Este lienzo no tiene enlaces todavía." /></Frame>;
  return <Frame title="Matriz" question="¿Qué está acoplado con qué? Cada celda es un enlace de la fila hacia la columna; lejos de la diagonal, acople entre áreas." scroll={false}>
    <View style={{ minHeight: 34, justifyContent: 'center' }}>{told ? <Txt kind="small"><Txt kind="small" style={{ fontWeight: '600' }}>{m.order[told.row].title}</Txt> {tokens.graph.kindHelp[told.kind].toLowerCase()} <Txt kind="small" style={{ fontWeight: '600' }}>{m.order[told.col].title}</Txt>{told.label ? ` · ${told.label}` : ''}</Txt> : <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>{(['flow', 'depends', 'reference'] as const).map(kind => <View key={kind} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: u.tone(kindTone(kind)) }} /><Txt kind="small" muted>{kindName(kind)}</Txt></View>)}<Txt kind="small" muted>{m.cells.length} enlaces entre {n} elementos</Txt></View>}</View>
    <ScrollView style={{ flex: 1 }}><ScrollView horizontal><View nativeID="lienzo-matrix" style={{ flexDirection: 'row' }}>
      <View style={{ width: V.rowLabel, paddingTop: V.colHead }}>{m.order.map((e, i) => <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`Ver ${e.title} en el lienzo`} onPress={() => onOpen(e.id)} style={{ height: cell, flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 8, backgroundColor: i === focusRow ? withAlpha(u.c.accent, .14) : 'transparent' }}><Txt kind="label" muted style={{ width: 22, textAlign: 'right' }}>{i + 1}</Txt><Txt kind="small" numberOfLines={1} style={{ flex: 1, fontWeight: e.group ? '600' : '400' }}>{e.title}</Txt></Pressable>)}</View>
      <View><View style={{ height: V.colHead, flexDirection: 'row', alignItems: 'flex-end' }}>{m.order.map((e, i) => <View key={e.id} style={{ width: cell, alignItems: 'center', paddingBottom: 4, backgroundColor: i === focusCol ? withAlpha(u.c.accent, .14) : 'transparent' }}><Txt kind="label" muted style={{ fontSize: 9 }}>{i + 1}</Txt></View>)}</View>
        <View style={{ width: side, height: side, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1 }}>
          {m.areas.map((a, i) => <View key={i} pointerEvents="none" style={{ position: 'absolute', left: a.from * cell, top: a.from * cell, width: (a.to - a.from) * cell, height: (a.to - a.from) * cell, backgroundColor: withAlpha(u.c.foregroundMuted, .08), borderWidth: 1, borderColor: withAlpha(u.c.foregroundMuted, .35) }} />)}
          {m.order.map((_, i) => <View key={i} pointerEvents="none" style={{ position: 'absolute', left: i * cell + cell / 2 - 1, top: i * cell + cell / 2 - 1, width: 2, height: 2, borderRadius: 1, backgroundColor: withAlpha(u.c.foregroundMuted, .5) }} />)}
          {m.cells.map((k, i) => <Pressable key={k.linkId} accessibilityRole="button" accessibilityLabel={`${m.order[k.row].title} ${tokens.graph.kindHelp[k.kind].toLowerCase()} ${m.order[k.col].title}`} onHoverIn={() => setHover(i)} onHoverOut={() => setHover(h => h === i ? null : h)} onPress={() => { setHover(i); void c.select([m.order[k.row].id, m.order[k.col].id]); }}
            style={{ position: 'absolute', left: k.col * cell + 2, top: k.row * cell + 2, width: cell - 4, height: cell - 4, borderRadius: 3, backgroundColor: u.tone(kindTone(k.kind)), opacity: hover === null || hover === i ? 1 : .55, borderWidth: hover === i ? 2 : 0, borderColor: u.c.foreground }} />)}
        </View></View>
    </View></ScrollView></ScrollView>
  </Frame>;
}

// ---- Corriente ----------------------------------------------------------------------------------------------------
/** What happened, newest first: your changes, the assistant's, the requests between you, and what still waits. */
export function StreamView({ controller: c, onOpen }: ViewProps) {
  const u = useUI(), doc = c.view!.document, { changes, failed } = useHistory(c, true), s = useMemo(() => streamOf(doc, changes ?? [], c.events), [doc.blocks, doc.groups, changes, c.events]);
  const title = (id: string) => [...doc.blocks, ...doc.groups].find(e => e.id === id)?.title || 'Sin título', user = u.c.accent, agent = u.tone('violeta');
  const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const state: Record<string, [string, Tone]> = { pending: ['En cola', 'aviso'], sent: ['Enviado, sin respuesta', 'aviso'], failed: ['No se entregó', 'riesgo'], acked: ['Atendido', 'exito'] };
  const row = (item: typeof s.items[number]) => <View key={item.key} style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: u.c.border }}>
    <View style={{ width: 44, alignItems: 'flex-end', gap: 2 }}><Txt kind="label" muted>{when(item.at)}</Txt>{item.revision !== undefined && <Txt kind="label" muted>r{item.revision}</Txt>}</View>
    <View style={{ width: 10, alignItems: 'center', paddingTop: 5 }}><View style={{ width: 10, height: 10, borderRadius: item.what === 'request' ? 2 : 5, backgroundColor: item.what === 'undo' || item.what === 'redo' ? 'transparent' : item.who === 'agent' ? agent : user, borderWidth: item.what === 'undo' || item.what === 'redo' ? 1.5 : 0, borderColor: u.c.foregroundMuted }} /></View>
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <Txt numberOfLines={2}><Txt style={{ fontWeight: '600' }}>{item.what === 'request' ? 'Pediste' : item.who === 'agent' ? 'El asistente' : 'Tú'}</Txt>{item.what === 'request' ? ': ' : item.what === 'undo' ? ' deshiciste: ' : item.what === 'redo' ? ' rehiciste: ' : ': '}{item.label}</Txt>
      {!!item.state && <Txt kind="small" style={{ color: u.tone(state[item.state][1]) }}>{state[item.state][0]}</Txt>}
      {!!item.ids.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{item.ids.slice(0, V.streamChips).map(id => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Ver ${title(id)} en el lienzo`} onPress={() => onOpen(id)} style={({ pressed, ...st }) => ({ maxWidth: 200, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: pressed || (st as { hovered?: boolean }).hovered ? u.c.surface2 : u.c.surface1, borderWidth: 1, borderColor: u.c.border })}><Txt kind="small" numberOfLines={1}>{title(id)}</Txt></Pressable>)}{item.ids.length > V.streamChips && <Txt kind="small" muted>+{item.ids.length - V.streamChips}</Txt>}</View>}
    </View></View>;
  return <Frame title="Corriente" question="¿Qué pasó y por qué está esto acá? Lo más reciente arriba.">
    <View nativeID="lienzo-stream" style={{ maxWidth: V.streamMax, alignSelf: 'center', width: '100%' }}>
      {failed && !changes ? <Empty text="No se pudo leer el historial." /> : !changes ? <Empty text="Leyendo el historial…" /> : <>
        {!!s.waiting.length && <View style={{ borderRadius: 12, borderWidth: 1, borderColor: u.tone('aviso'), backgroundColor: u.wash('aviso'), paddingHorizontal: 14, paddingTop: 10, marginBottom: 16 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="Hourglass" size={14} color={u.tone('aviso')} /><Txt kind="label">Esperando al asistente · {s.waiting.length}</Txt></View>{s.waiting.map(row)}</View>}
        {!s.items.length ? <Empty text="Todavía no hay cambios ni pedidos guardados." /> : s.items.map(row)}
        <Txt kind="small" muted style={{ paddingTop: 12 }}>El historial guarda los 50 cambios más recientes.</Txt></>}
    </View>
  </Frame>;
}
