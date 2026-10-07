import { islandStyle } from './whiteboard-visuals';
import { WhiteboardContent } from './WhiteboardContent';
import { isWhiteboardRenderer } from '../shared/whiteboard';
import React, { useRef, useState } from 'react';
import { Animated, Image, Pressable, View, type GestureResponderEvent } from 'react-native';
import { openExternalUrl } from '@getpaseo/plugin/client';
import { copyText, Icon, ScrollView, useToast } from '@getpaseo/plugin/client/react-native';
import type { RpcInput } from '@getpaseo/plugin';
import type { agentAction } from '../shared/rpc';
import type { AgentEvent, BlockType, CanvasBlock, CanvasDocument } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { connectionsOf, hasCommunication, newId, propertyValue, safeUrl, nodeDensity } from './logic';
import { tokens } from './tokens';
import { withAlpha, type Tone } from './color';
import { Modal, Button, CheckRow, Chip, Field, IconButton, OptionRow, Txt, useUI } from './ui';
import { WebFrame, WebMedia } from './web';
import { mediaSource } from './media';
import { ImageViewer } from './ImageViewer';
import { getClientRenderer } from './renderers';
import { RegisteredRenderer } from './renderers/RegisteredRenderer';
import { usePresentation } from './usePresentation';
import { HiddenResult } from './HiddenResult';
export const visual = (type?: BlockType) => getClientRenderer(type?.renderer)?.visual ?? tokens.renderers[type ? type.renderer ?? 'generic' : 'unknown'];
const str = (value: unknown) => typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
const G = tokens.graph;
export function statusTone(status: string): Tone {
  const word = status.trim().toLowerCase();
  return (['exito', 'aviso', 'riesgo', 'acento'] as const).find(tone => (G.status[tone] as readonly string[]).includes(word)) ?? 'neutro';
}
const relation = { flow: ['conecta con', 'llega desde'], depends: ['depende de', 'lo necesita'], reference: ['menciona a', 'mencionado por'] } as const;
/** Links as sentences. This is how connections read where there is no canvas: the outline and the inspector. */
export function ConnectionRows({ doc, id, onOpen, onLink }: { doc: CanvasDocument; id: string; onOpen: (id: string) => void; onLink?: (linkId: string) => void }) {
  const u = useUI(), rows = connectionsOf(doc, id); if (!rows.length) return null;
  return <View style={{ gap: 2 }}>{rows.map(({ link, outgoing, otherId, title }) => <Pressable key={link.id} accessibilityRole="button" accessibilityLabel={`${outgoing ? 'Sale' : 'Entra'}: ${relation[link.kind][outgoing ? 0 : 1]} ${title}${link.label ? `, ${link.label}` : ''}`} onPress={e => { e.stopPropagation(); (onLink ?? onOpen)(onLink ? link.id : otherId); }} style={({ pressed, ...state }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: u.compact ? 36 : 24, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 6, backgroundColor: pressed ? withAlpha(u.c.foreground, tokens.alpha.pressedFill) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, tokens.alpha.hoverFill) : 'transparent' })}>
    <Icon name={outgoing ? 'ArrowRight' : 'ArrowLeft'} size={12} color={u.tone(link.tone ? link.tone === 'peligro' ? 'riesgo' : link.tone : G.link.defaultTone[link.kind])} />
    <Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{relation[link.kind][outgoing ? 0 : 1]} <Txt kind="small" style={{ fontWeight: '600' }}>{title}</Txt>{link.label ? ` · ${link.label}` : ''}</Txt>
  </Pressable>)}</View>;
}
export function Delivery({ event, retry }: { event?: AgentEvent; retry?: () => void }) {
  const u = useUI(); if (!event) return null;
  const text = event.status === 'pending' ? 'En cola' : event.status === 'sent' ? `Enviado · ${new Date(event.createdAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : event.status === 'acked' ? 'Recibido por el agente' : 'No se envió';
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}><Icon name={event.status === 'pending' ? 'Clock' : event.status === 'sent' ? 'Check' : event.status === 'acked' ? 'CheckCheck' : 'CircleAlert'} size={12} color={event.status === 'failed' ? u.c.statusDanger : event.status === 'acked' ? u.c.statusSuccess : u.c.foregroundMuted} /><Txt kind="small" muted>{text}</Txt>{event.status === 'failed' && <><Txt kind="small" numberOfLines={1} style={{ color: u.c.statusDanger }}>{event.error}</Txt>{retry && <Button small label="Reintentar" variant="ghost" onPress={retry} />}</>}</View>;
}
function UrlPreview({ block, fill = false }: { block: CanvasBlock; fill?: boolean }) {
  const u = useUI(), toast = useToast(), url = safeUrl(block.data.url), [loaded, setLoaded] = useState(false), [timeout, setTimeoutState] = useState(false);
  React.useEffect(() => { setLoaded(false); setTimeoutState(false); }, [url]);
  const open = () => { if (url) void openExternalUrl(url).catch(e => toast.error(String(e))); };
  if (!url) return <View style={{ minHeight: 96, borderWidth: 1, borderStyle: 'dashed', borderRadius: 6, borderColor: u.c.border, padding: 12, gap: 8 }}><Txt kind="label" muted>Referencia conceptual</Txt><Txt>{str(block.data.description)}</Txt>{block.data.url ? <Txt kind="small" style={{ color: u.c.statusDanger }}>Enlace no válido</Txt> : null}</View>;
  const height = u.compact ? tokens.preview.frame.heightCompact : tokens.preview.frame.height;
  return <View style={{ gap: 8, flexGrow: fill ? 1 : undefined }}><View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: u.c.surface2, borderRadius: 6, paddingLeft: 8, minHeight: 28, gap: 6 }}><Icon name="Globe" size={12} color={u.c.foregroundMuted} /><Txt kind="code" selectable numberOfLines={1} ellipsizeMode="middle" muted style={{ flex: 1 }}>{url}</Txt><IconButton label="Abrir vista previa" icon="ExternalLink" onPress={open} /></View>
    {u.layout.platform === 'web' ? <View style={{ height: fill ? undefined : height, minHeight: fill ? 200 : undefined, flex: fill ? 1 : undefined }}><WebFrame url={url} title={block.title || 'Vista previa'} border={u.c.border} surface={u.c.surface2} height={fill ? '100%' : height} onLoaded={() => setLoaded(true)} onTimeout={() => setTimeoutState(true)} />{!loaded && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, backgroundColor: u.c.surface2, alignItems: 'center', justifyContent: 'center' }}><Txt kind="small" muted>{timeout ? 'El sitio no respondió. Puedes abrirlo en el navegador.' : 'Cargando vista previa…'}</Txt></View>}</View> : <View style={{ height, backgroundColor: u.c.surface0, borderWidth: 1, borderColor: u.c.border, borderRadius: 6, alignItems: 'center', justifyContent: 'center', gap: 12 }}><Icon name="AppWindow" size={24} color={u.c.foregroundMuted} /><Txt kind="small" muted>La vista en vivo se abre en el navegador.</Txt><Button label="Abrir vista previa" small onPress={open} /></View>}
    <Txt kind="small" muted>Si el sitio no permite incrustarse, usa Abrir vista previa.</Txt>{!!block.data.description && <Txt>{str(block.data.description)}</Txt>}
  </View>;
}
function FormBody({ block, type, controller: c, submit }: { block: CanvasBlock; type: BlockType; controller: CanvasController; submit: (values: CanvasBlock['data']) => Promise<void> }) {
  const values = useRef<Record<string, unknown>>(Object.fromEntries(type.properties.map(p => [p.key, p.kind === 'json' ? JSON.stringify(block.data[p.key] ?? null, null, 2) : block.data[p.key] ?? '']))), dirty = useRef(new Set<string>());
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState(''), [, render] = useState(0);
  React.useEffect(() => { for (const p of type.properties) if (!dirty.current.has(p.key)) values.current[p.key] = p.kind === 'json' ? JSON.stringify(block.data[p.key] ?? null, null, 2) : block.data[p.key] ?? ''; render(n => n + 1); }, [block.data]);
  const save = async (p: BlockType['properties'][number], raw: unknown) => {
    const value = propertyValue(p.kind, raw); const result = await c.edit([{ type: 'block.update', id: block.id, patch: { data: { [p.key]: value } } }], `Editar «${p.label}»`); if (result) dirty.current.delete(p.key); return result;
  };
  return <View style={{ gap: 8 }}>{type.properties.map(p => p.kind === 'boolean' ? <CheckRow key={p.key} label={p.label} checked={values.current[p.key] === true} disabled={c.offline || submitting} onPress={() => { const checked = values.current[p.key] !== true; values.current[p.key] = checked; dirty.current.add(p.key); render(n => n + 1); void save(p, checked).catch(e => setError(String(e))); }} /> : <Field key={p.key} label={p.label} required={p.required} value={p.kind === 'json' ? JSON.stringify(block.data[p.key] ?? null, null, 2) : str(block.data[p.key])} disabled={c.offline || submitting} multiline={p.kind === 'json'} mono={p.kind !== 'text'} onDraft={value => { values.current[p.key] = value; dirty.current.add(p.key); }} onSave={value => save(p, value)} />)}{error && <Txt kind="small">{error}</Txt>}<Button label={submitting ? 'Enviando…' : 'Enviar'} variant="primary" small disabled={c.offline || submitting} onPress={() => { void (async () => { setSubmitting(true); setError(''); try { const documentId = c.current.current?.document.id; await c.settle(); if (documentId !== c.current.current?.document.id) return; const data = Object.fromEntries(type.properties.map(p => [p.key, propertyValue(p.kind, values.current[p.key])])) as CanvasBlock['data']; const result = await c.edit([{ type: 'block.update', id: block.id, patch: { data } }], `Guardar formulario «${block.title}»`); if (!result) throw new Error('No se guardó el formulario.'); const committed = result.document.blocks.find(b => b.id === block.id); if (committed) await submit(committed.data); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSubmitting(false); } })(); }} /></View>;
}
function Media({ block, fill = false }: { block: CanvasBlock; fill?: boolean }) {
  const u = useUI(), toast = useToast(), source = mediaSource(block.data.url, block.data.mediaKind), [failed, setFailed] = useState(false), [playing, setPlaying] = useState(false), [expanded, setExpanded] = useState(false);
  const url = source?.url;
  React.useEffect(() => { setFailed(false); setPlaying(false); setExpanded(false); }, [url]);
  if (!source) return <Txt kind="small" style={{ color: u.c.statusDanger }}>Añade un enlace HTTP o HTTPS válido en el inspector.</Txt>;
  const { kind, embed, provider } = source, icon = tokens.media.kinds[kind], height = kind === 'image' ? tokens.media.image.height : tokens.media.video.height;
  const open = () => { void openExternalUrl(source.url).catch(e => toast.error(String(e))); };
  const frameStyle = { height: fill ? undefined : height, minHeight: fill ? height : undefined, flex: fill ? 1 : undefined, backgroundColor: u.c.surface2, borderRadius: 6, overflow: 'hidden' as const };
  let player: React.ReactNode;
  if (kind === 'image' && !failed) player = <Pressable nativeID={`lienzo-interactive-image-${block.id}`} accessibilityRole="button" accessibilityLabel={`Ampliar imagen: ${block.title}`} onPress={e => { e.stopPropagation(); setExpanded(true); }} style={frameStyle}><Image source={{ uri: source.url }} accessibilityLabel={str(block.data.caption) || block.title} onError={() => setFailed(true)} resizeMode="contain" style={{ width: '100%', height: '100%' }} /><View pointerEvents="none" style={{ position: 'absolute', right: 8, bottom: 8, width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: u.c.surface1, borderWidth: 1, borderColor: u.c.border }}><Icon name="Maximize" size={14} color={u.c.foreground} /></View></Pressable>;
  else if ((kind === 'video' || kind === 'audio') && u.layout.platform === 'web' && !failed) {
    player = embed ? playing ? <View style={frameStyle}><WebFrame url={embed} title={block.title || provider || 'Video'} border={u.c.border} surface={u.c.surface2} height={fill ? '100%' : height} player /></View> : <Pressable nativeID={`lienzo-interactive-video-${block.id}`} accessibilityRole="button" accessibilityLabel={`Cargar video de ${provider}`} onPress={e => { e.stopPropagation(); setPlaying(true); }} style={[frameStyle, { alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: u.c.border }]}><Icon name="Film" size={24} color={u.c.foregroundMuted} /><Txt kind="bodyStrong">{provider}</Txt><Txt kind="small" muted>Cargar reproductor</Txt></Pressable>
      : <View nativeID={`lienzo-interactive-media-${block.id}`} style={kind === 'audio' ? { height: tokens.media.audio.height } : frameStyle}><WebMedia url={source.url} title={block.title || kind} kind={kind} height={fill ? '100%' : height} surface={u.c.surface2} onError={() => setFailed(true)} /></View>;
  } else player = <View style={{ gap: 6 }}><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name={icon} size={20} color={u.tone('turquesa')} /><Txt kind="bodyStrong" style={{ flex: 1 }}>{new URL(source.url).hostname}</Txt></View><Txt kind="code" muted selectable numberOfLines={1}>{source.url}</Txt><Txt kind="small" muted>{failed ? 'No se pudo cargar el recurso. Puedes abrir el enlace original.' : kind === 'reference' ? 'Referencia externa.' : 'Reproduce este recurso en el navegador.'}</Txt></View>;
  return <View style={{ gap: 8, flexGrow: fill ? 1 : undefined }}>{player}{embed && playing && <Button label="Cerrar reproductor" small variant="ghost" onPress={() => setPlaying(false)} />}<Button label="Abrir referencia" small variant="ghost" icon="ExternalLink" onPress={open} />{!!block.data.caption && <Txt kind="small" muted>{str(block.data.caption)}</Txt>}{kind === 'image' && expanded && <ImageViewer url={source.url} title={block.title} open={expanded} close={() => setExpanded(false)} />}</View>;
}
export function BlockCard({ block, controller: c, selected, onSelect, onInspect, onPacks, onReorder, headerHandlers, onMeasure, outline = false, dragging = false, dim = false, onHover, detailsSide = 'right', cursor, height }: { block: CanvasBlock; controller: CanvasController; selected: boolean; onSelect: (id: string, event?: GestureResponderEvent, multi?: boolean) => void; onInspect: () => void; onPacks: () => void; onReorder: (id: string, direction: number) => void; headerHandlers?: object; onMeasure?: (height: number) => void; outline?: boolean; dragging?: boolean; dim?: boolean; onHover?: (id: string, inside: boolean) => void; detailsSide?: 'right' | 'bottom'; cursor?: string; height?: Animated.Value }) {
  const u = useUI(), toast = useToast(), type = c.catalog?.blockTypes.find(t => t.id === block.typeId), v = visual(type), [focus, setFocus] = useState(false), [hovered, setHovered] = useState(false), [answer, setAnswer] = useState(str(block.data.answer)), [hint, setHint] = useState(false), [sending, setSending] = useState(false), [sendError, setSendError] = useState('');
  const retry = useRef<null | { action: RpcInput<typeof agentAction>['action']; id: string }>(null);
  React.useEffect(() => setAnswer(str(block.data.answer)), [block.data.answer]);
  const presentation = usePresentation(c), gateIds = presentation?.hiddenBy.get(block.id);
  if (gateIds?.length) return <Animated.View onLayout={e => onMeasure?.(e.nativeEvent.layout.height)} style={{ height: height && !outline ? height : undefined }}>
    <Pressable nativeID={`lienzo-grab-${block.id}`} {...headerHandlers} accessibilityRole="button" accessibilityLabel="Resultado oculto" accessibilityState={{ selected }} onPress={e => onSelect(block.id, e)} onLongPress={e => onSelect(block.id, e, true)} style={{ minHeight: tokens.size.blockMinHeight, padding: 14, backgroundColor: u.c.surface1, borderWidth: selected ? 2 : 1, borderColor: selected ? u.c.accent : u.c.border, borderStyle: 'dashed', borderRadius: 10 }}>
      <HiddenResult gateIds={gateIds} open={id => onSelect(id)} />
    </Pressable>
  </Animated.View>;
  const sized = !!height && !outline;
  const pending = c.pendingIds.includes(block.id), writeFailure = c.failure?.affectedIds?.includes(block.id) ? c.failure : null;
  const disabled = pending || c.offline;
  const event = [...c.events].reverse().find(e => e.action.targetIds?.includes(block.id));
  async function send(kind: string, payload: CanvasBlock['data'], label: string, delivery: 'immediate' | 'batched' = 'immediate', again = false) {
    if (sending) return;
    if (!again) retry.current = { action: { kind, label, payload, targetIds: [block.id], delivery }, id: newId('evt') };
    setSending(true); setSendError('');
    try { const request = retry.current!; const result = await c.send(request.action, request.id); if (!result) setSendError('No se envió. Revisa el aviso del lienzo.'); else if (result.status === 'failed') setSendError(result.error ?? 'No se envió'); }
    finally { setSending(false); }
  }
  const retrySend = () => { if (event?.status === 'failed') { void c.task(async () => { const result = await c.api.flush({ workspaceId: c.workspaceId, documentId: c.view!.document.id }); c.setEvents(result.events); }); } else if (retry.current) void send('', {}, '', 'immediate', true); };
  const fieldSave = (key: string, value: unknown) => c.edit([{ type: 'block.update', id: block.id, patch: { data: { [key]: value } as CanvasBlock['data'] } }], `Editar «${key}»`);
  const generic = () => <View style={{ gap: 8 }}>{(type?.properties ?? Object.keys(block.data).map(key => ({ key, label: key, kind: 'json' }))).map(p => <View key={p.key} style={{ gap: 4 }}><Txt kind="label" muted>{p.label}</Txt><Txt kind={p.kind === 'json' || p.kind === 'number' ? 'code' : 'body'} selectable numberOfLines={outline ? undefined : p.kind === 'json' ? 4 : 8}>{typeof block.data[p.key] === 'boolean' ? block.data[p.key] ? 'Sí' : 'No' : str(block.data[p.key])}</Txt></View>)}</View>;
  let body: React.ReactNode = generic(), qualifier = '';
  const renderer = type?.renderer;
  if (isWhiteboardRenderer(renderer)) return <WhiteboardContent block={block} kind={renderer} width={block.size?.width ?? 160} height={block.size?.height ?? 104} outline={outline} onSelect={event => onSelect(block.id,event)} onMeasure={onMeasure} />;
  if (!type) body = <View style={{ gap: 8 }}><Txt>Este tipo no está en tu catálogo. Importa el pack que lo define.</Txt><Button label="Abrir packs" small variant="ghost" onPress={onPacks} /></View>;
  else if (getClientRenderer(renderer)) body = <RegisteredRenderer block={block} id={renderer!} controller={c} readOnly={disabled} send={send} />;
  else if (['note', 'text', 'callout', 'step'].includes(renderer ?? '') && typeof block.data.text === 'string') body = <Txt selectable numberOfLines={outline || sized ? undefined : 8}>{block.data.text}</Txt>;
  else if (renderer === 'code' && typeof block.data.code === 'string') {
    const lines = block.data.code.split('\n'); qualifier = ['', 'text', 'plain', 'txt'].includes(str(block.data.language).trim().toLowerCase()) ? '' : str(block.data.language);
    body = <View style={{ gap: 4, backgroundColor: u.c.surface2, borderRadius: 6, padding: 8 }}><View style={{ position: 'absolute', right: 0, top: 0, zIndex: 1 }}><IconButton label="Copiar código" icon="Copy" onPress={() => { void copyText(str(block.data.code)).then(() => toast.show('Código copiado')).catch(() => toast.error('Selecciona el código para copiarlo.')); }} /></View><ScrollView horizontal><Txt kind="code" selectable>{(outline || sized ? lines : lines.slice(0, 12)).join('\n')}</Txt></ScrollView>{!outline && !sized && lines.length > 12 && <Txt kind="label" muted>… {lines.length - 12} líneas más</Txt>}</View>;
  } else if (renderer === 'checklist' && Array.isArray(block.data.items)) {
    const items = block.data.items.map(item => typeof item === 'string' ? { label: item, done: false } : { label: str((item as { label?: unknown })?.label), done: !!(item as { done?: unknown })?.done }); qualifier = `${items.filter(i => i.done).length}/${items.length}`;
    body = <View style={{ marginVertical: -3 }}>{items.map((item, i) => <CheckRow key={i} label={item.label} checked={item.done} tone="exito" strike={item.done} disabled={disabled} onPress={() => { void fieldSave('items', items.map((old, index) => index === i ? { ...old, done: !old.done } : old)); }} />)}</View>;
  } else if ((renderer === 'choice' || renderer === 'quiz') && Array.isArray(block.data.options)) {
    qualifier = `${block.data.options.length} opciones`;
    body = <View style={{ gap: 6 }}><Txt style={{ marginBottom: 2 }}>{str(block.data.question)}</Txt>{block.data.options.map((option, i) => <OptionRow key={i} label={str(option)} selected={answer === str(option)} disabled={c.offline || sending} onPress={() => setAnswer(str(option))} />)}<Button label={sending ? 'Enviando…' : 'Enviar respuesta'} variant="primary" small icon="SendHorizontal" style={{ alignSelf: 'flex-start', marginTop: 2 }} disabled={disabled || sending || !answer || answer === block.data.answer} onPress={() => { void (async () => { const result = await fieldSave('answer', answer); if (result) await send('block.answer', { answer }, `Responder «${block.title}»`); })(); }} />{renderer === 'quiz' && block.data.hint && <><Button label="Ver pista" small variant="ghost" style={{ alignSelf: 'flex-start' }} disabled={disabled || hint} onPress={() => { setHint(true); void send('block.hint', {}, `Ver pista de «${block.title}»`, 'batched'); }} />{hint && <View style={{ backgroundColor: u.wash('turquesa'), padding: 8, borderRadius: 6 }}><Txt>{str(block.data.hint)}</Txt></View>}</>}{block.data.answer && block.data.explanation && <Txt>{str(block.data.explanation)}</Txt>}</View>;
  } else if (renderer === 'progress') {
    const total = Number(block.data.total), current = Math.max(0, Math.min(Number(block.data.current) || 0, total));
    body = <View style={{ gap: 6 }}><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: Math.max(0, total), now: current }} style={{ height: 6, backgroundColor: u.c.surface2, borderRadius: 3, overflow: 'hidden' }}><View style={{ width: `${total > 0 ? current / total * 100 : 0}%`, height: 6, backgroundColor: u.tone('exito') }} /></View><Txt kind="small" muted>{total > 0 ? `${current} de ${total}` : 'Sin total'}</Txt></View>;
  } else if (renderer === 'preview-frame') { body = <UrlPreview block={block} fill={sized} />; }
  else if (renderer === 'image-ref') body = <Media block={block} fill={sized} />;
  else if (renderer === 'metric') body = <View><Txt kind="display">{str(block.data.value)} {str(block.data.unit)}</Txt><Txt kind="small" muted>{str(block.data.label)}</Txt></View>;
  else if (renderer === 'form') body = <FormBody block={block} type={type} controller={c} submit={values => send('block.submit', { values }, `Enviar «${block.title}»`)} />;
  const doc = presentation?.document ?? c.view?.document, connections = outline && doc ? <ConnectionRows doc={doc} id={block.id} onOpen={id => onSelect(id)} /> : null;
  const state = (hasCommunication(block.communication) && renderer !== 'node' || pending || writeFailure || sending || sendError || event) ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderColor: u.c.border }}>{hasCommunication(block.communication) && renderer !== 'node' && <Chip label="Con instrucción" tone="acento" icon="Compass" center />}{pending ? <Txt kind="small" muted>Guardando…</Txt> : writeFailure ? <View><Txt kind="small" style={{ color: u.c.statusDanger }}>No se guardó</Txt>{writeFailure.retry && <Button label="Reintentar" small variant="ghost" onPress={() => { void writeFailure.retry?.().catch(e => c.fail(e)); }} />}</View> : sending ? <Txt kind="small" muted>Enviando…</Txt> : sendError ? <View><Txt kind="small" style={{ color: u.c.statusDanger }}>{sendError}</Txt><Button label="Reintentar" small variant="ghost" onPress={retrySend} /></View> : <Delivery event={event} retry={retrySend} />}</View> : null;
  // A lifted card stays solid: the lift is told by scale and shadow (Canvas), not by fading it.
  const opacity = dragging ? 1 : pending ? tokens.alpha.pending : dim ? G.dim.node : 1, grab = cursor ? { cursor } as object : null;
  const hover = (inside: boolean) => { setHovered(inside); onHover?.(block.id, inside); };
  if (renderer === 'node') {
    // The compact card of the graph canvas: an eyebrow, a status, a name. The long text waits in a side note that
    // never changes the card's size, so selecting a node does not reflow the graph around it.
    const kind = str(block.data.kind).trim(), status = str(block.data.status).trim(), summary = str(block.data.summary).trim(), details = str(block.data.details).trim(), tone = statusTone(status);
    const note = selected && !outline && !dragging && c.selection.length === 1 && !!details;
    return <Animated.View onLayout={e => onMeasure?.(e.nativeEvent.layout.height)} style={{ opacity, height: sized ? height : undefined }}>
      {(selected || focus) && <View pointerEvents="none" style={{ position: 'absolute', top: -3, bottom: -3, left: -3, right: -3, borderRadius: G.node.radius + 3, backgroundColor: selected ? u.halo : withAlpha(u.c.foregroundMuted, .3) }} />}
      <Pressable nativeID={`lienzo-grab-${block.id}`} {...headerHandlers} accessibilityRole="button" accessibilityLabel={`${kind || type!.name}: ${block.title}${status ? `, ${status}` : ''}`} accessibilityState={{ selected }} onHoverIn={() => hover(true)} onHoverOut={() => hover(false)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onPress={e => onSelect(block.id, e)} onLongPress={e => onSelect(block.id, e, true)}
        style={{ flex: sized ? 1 : undefined, minHeight: G.node.minHeight, overflow: 'hidden', backgroundColor: u.c.surface1, borderRadius: G.node.radius, borderWidth: selected ? 2 : 1, borderColor: writeFailure ? u.c.statusDanger : selected || dragging ? u.c.accent : hovered ? withAlpha(u.c.foregroundMuted, .5) : u.c.border, paddingVertical: G.node.paddingV - (selected ? 1 : 0), paddingHorizontal: G.node.paddingH - (selected ? 1 : 0), gap: G.node.gap, ...grab }}>
        {(!!kind || !!status || hasCommunication(block.communication)) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 16 }}><Txt kind="label" muted numberOfLines={1} style={{ flex: 1 }}>{kind}</Txt>{hasCommunication(block.communication) && <Icon name="Compass" size={12} color={u.c.accent} />}{!!status && <View style={{ maxWidth: 96, minHeight: 16, paddingHorizontal: 6, borderRadius: tokens.radius.pill, backgroundColor: u.wash(tone), justifyContent: 'center' }}><Txt kind="label" numberOfLines={1} style={{ color: tone === 'neutro' ? u.c.foregroundMuted : u.tone(tone), textTransform: 'none', letterSpacing: 0, fontWeight: '600' }}>{status}</Txt></View>}</View>}
        <Txt kind="heading" numberOfLines={outline ? undefined : G.node.titleLines}>{block.title || 'Sin título'}</Txt>
        {!!summary && <Txt kind="small" muted numberOfLines={outline || sized ? undefined : c.view ? nodeDensity(c.view.document, block).summaryLines : G.node.summaryLines}>{summary}</Txt>}
        {outline && !!details && <Txt selectable style={{ marginTop: 4 }}>{details}</Txt>}
        {outline && connections}{state}
      </Pressable>
      {note && <View style={{ position: 'absolute', ...(detailsSide === 'right' ? { left: '100%', top: 0, marginLeft: G.node.details.offset } : { left: 0, top: '100%', marginTop: G.node.details.offset }), width: G.node.details.width, ...islandStyle(u, true), borderRadius: G.node.radius, padding: G.node.paddingH, gap: 8, zIndex: 5 }}>
        <Txt kind="label" muted>Detalle</Txt><Txt selectable numberOfLines={G.node.details.maxLines}>{details}</Txt><Button label="Inspeccionar" small variant="ghost" icon="PanelRight" style={{ alignSelf: 'flex-start', marginLeft: -8 }} onPress={onInspect} />
      </View>}
    </Animated.View>;
  }
  return <Animated.View onLayout={e => onMeasure?.(e.nativeEvent.layout.height)} style={{ opacity, height: sized ? height : undefined }}>
    {(selected || focus) && <View pointerEvents="none" style={{ position: 'absolute', top: -3, bottom: -3, left: -3, right: -3, borderRadius: 13, backgroundColor: selected ? u.halo : withAlpha(u.c.foregroundMuted, .3) }} />}<View style={{ flex: sized ? 1 : undefined, backgroundColor: u.c.surface1, borderWidth: selected ? 2 : 1, borderColor: writeFailure ? u.c.statusDanger : selected || dragging ? u.c.accent : hovered ? withAlpha(u.c.foregroundMuted, .5) : u.c.border, borderRadius: 10, overflow: 'hidden', paddingVertical: selected ? 11 : 12, paddingRight: selected ? 13 : 14, paddingLeft: selected ? 16 : 17, gap: 8, minHeight: tokens.size.blockMinHeight }}><View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: tokens.border.spine, backgroundColor: v.tone === 'neutro' ? u.c.border : u.tone(v.tone as Tone) }} />
      {/* A titled block needs no label saying what it is: its content shows it. Only an untitled one keeps its type name. */}
      <Pressable nativeID={`lienzo-grab-${block.id}-header`} {...headerHandlers} accessibilityRole="button" accessibilityLabel={`${type?.name ?? block.typeId}: ${block.title}`} onHoverIn={() => hover(true)} onHoverOut={() => hover(false)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onPress={e => onSelect(block.id, e)} onLongPress={e => onSelect(block.id, e, true)} style={{ minHeight: u.compact ? 24 : 20, flexDirection: 'row', gap: 6, alignItems: 'flex-start', ...grab }}>
        {block.title ? <Txt kind="heading" numberOfLines={outline ? undefined : 3} style={{ flex: 1 }}>{block.title}</Txt> : <View style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 20 }}><Icon name={v.icon} size={14} color={u.tone(v.tone as Tone)} /><Txt kind="label" muted numberOfLines={1} style={{ flex: 1 }}>{type?.name ?? block.typeId}</Txt></View>}
        {!!qualifier && <Txt kind="label" muted numberOfLines={1} style={{ lineHeight: 20 }}>{qualifier}</Txt>}
        {c.view?.document.example && renderer === 'preview-frame' && <Chip label="Ejemplo" tone="aviso" icon="FlaskConical" center />}</Pressable>
      {sized ? <ScrollView nativeID={`lienzo-scroll-${block.id}`} style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ flexGrow: 1, gap: 8 }}>{body}{connections}{state}</ScrollView> : <>{body}{connections}{state}</>}
    </View>
  </Animated.View>;
}
