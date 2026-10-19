/**
 * The add sheets (docs/design.md §37.1): a Window, an image, a video, a sound, and an SVG. One compact sheet per kind,
 * in the language of the screens: a labelled field, a live preview of what the link will become, an optional caption
 * labelled as such, and Enter to add, Escape to close. Links can be dropped onto the sheet; SVG files too.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, View } from 'react-native';
import { Icon, ScrollView, TextInput } from './host';
import { isDark, withAlpha } from './color';
import { NATIVE, easeOut, useReducedMotion } from './motion';
import { tokens } from './tokens';
import { Button, IconButton, Txt, useUI } from './ui';
import { attachDrop, fetchSvgUrl, focusFirstField, onEscapeKey, pickFiles, pickSvgFile, readSvgFile, WebSvg, isMacPlatform, type DroppedFile } from './web';
import type { ImageFile } from './media-store';
import { MEDIA_ACCEPT } from '../shared/media';
import { describeLink, fetchLinkPreview, linkBlock, type LinkDescription, type LinkIntent } from './media';
import { sheetShadow } from './Screen';
import { sanitizeSvg } from '../shared/svg';
import type { SvgInsertOptions } from './whiteboard-tools';

const A = tokens.face.addSheet, S = tokens.face.screens;
type UI = ReturnType<typeof useUI>;

/** The shell: dimmed canvas, a compact sheet near the top (a bottom sheet when compact), header, body and footer. */
export function AddSheet({ open, onClose, nativeID, icon, title, subtitle, panel, children, footer, sheetWidth = A.width }: {
  open: boolean; onClose(): void; nativeID: string; icon: string; title: string; subtitle: string; panel: { width: number; height: number };
  children: React.ReactNode; footer: React.ReactNode; sheetWidth?: number;
}) {
  const u = useUI(), motion = useReducedMotion(), shown = useRef(new Animated.Value(0)).current, close = useRef(onClose), box = useRef<View>(null); close.current = onClose;
  useEffect(() => {
    if (!open) return; shown.setValue(motion.current ? 1 : 0);
    if (!motion.current) Animated.timing(shown, { toValue: 1, duration: S.enterMs, easing: easeOut, useNativeDriver: NATIVE }).start();
    focusFirstField(box.current);
    return onEscapeKey(() => { close.current(); return true; }, true);
  }, [open]);
  if (!open) return null;
  const dark = isDark(u.c.surface0), width = u.compact ? panel.width : Math.min(sheetWidth, panel.width - 32);
  const place = u.compact ? { left: 0, right: 0, bottom: 0, maxHeight: panel.height - 24 } : { left: (panel.width - width) / 2, top: Math.max(24, Math.round(panel.height * A.top)), width, maxHeight: panel.height - 48 };
  return <View pointerEvents="box-none" style={{ position: 'absolute', inset: 0, zIndex: 210 }}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', inset: 0, opacity: shown, backgroundColor: withAlpha(dark ? '#000000' : u.c.foreground, S.dim * .75) }} />
    <Pressable accessibilityLabel={`Close ${title}`} onPress={onClose} style={{ position: 'absolute', inset: 0, ...({ cursor: 'default' } as object) }} />
    <Animated.View ref={box} nativeID={nativeID} accessibilityRole={'dialog' as never} accessibilityLabel={title} style={{ position: 'absolute', ...place, borderRadius: A.radius, ...(u.compact ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : {}), borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, overflow: 'hidden',
      boxShadow: sheetShadow(u), elevation: 12, opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [u.compact ? 24 : 6, 0] }) }, { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [u.compact ? 1 : S.enterScale, 1] }) }] } as object}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: A.padding, paddingTop: A.padding - 2, paddingBottom: 4 }}>
        <View style={{ width: A.tile, height: A.tile, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: u.wash('acento') }}><Icon name={icon} size={18} color={u.c.accent} /></View>
        <View style={{ flex: 1, minWidth: 0 }}><Txt kind="title" accessibilityRole="header" numberOfLines={1}>{title}</Txt><Txt kind="small" muted numberOfLines={2}>{subtitle}</Txt></View>
        <IconButton icon="X" label={`Close ${title}`} shortcut="Esc" onPress={onClose} />
      </View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: A.padding, paddingTop: 14, gap: A.gap }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: A.padding, paddingVertical: 12, borderTopWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0 }}>{footer}</View>
    </Animated.View>
  </View>;
}

/** A field with its label above it, an optional "Optional" on the right, and a leading icon. */
export function LabelledField({ label, optional, icon, value, onChange, placeholder, onSubmit, multiline, mono, nativeID, disabled, helper }: {
  label: string; optional?: boolean; icon?: string; value: string; onChange(v: string): void; placeholder?: string; onSubmit?(): void; multiline?: boolean; mono?: boolean; nativeID?: string; disabled?: boolean; helper?: string;
}) {
  const u = useUI(), [focused, setFocused] = useState(false);
  return <View style={{ gap: 6 }}>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}><Txt kind="small" style={{ fontWeight: '600', flex: 1 }}>{label}</Txt>{optional && <Txt kind="small" muted>Optional</Txt>}</View>
    <View style={{ flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: 8, minHeight: u.compact ? 44 : A.field, paddingHorizontal: 12, paddingVertical: multiline ? 10 : 0, borderRadius: 8, borderWidth: focused ? 2 : 1, margin: focused ? 0 : 0, borderColor: focused ? u.c.accent : u.c.border, backgroundColor: u.c.surface0 }}>
      {icon && <View style={{ paddingTop: multiline ? 2 : 0 }}><Icon name={icon} size={15} color={focused ? u.c.accent : u.c.foregroundMuted} /></View>}
      <TextInput nativeID={nativeID} accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={withAlpha(u.c.foregroundMuted, .8)} editable={!disabled}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} multiline={multiline} autoCapitalize={mono || icon === 'Link' ? 'none' : 'sentences'} autoCorrect={!mono && icon !== 'Link'}
        onSubmitEditing={multiline ? undefined : () => onSubmit?.()} returnKeyType={onSubmit ? 'done' : undefined} blurOnSubmit={false}
        style={[u.font(mono ? 'code' : 'body'), { flex: 1, minHeight: multiline ? 132 : undefined, height: multiline ? undefined : '100%', textAlignVertical: multiline ? 'top' : 'center', ...({ outlineStyle: 'none' } as object) }]} />
    </View>
    {!!helper && <Txt kind="small" muted>{helper}</Txt>}
  </View>;
}

/** The footer: the keys on the left, Cancel and the primary action on the right. */
function Footer({ hint, label, disabled, busy, onCancel, onSubmit }: { hint: string; label: string; disabled: boolean; busy?: boolean; onCancel(): void; onSubmit(): void }) {
  const u = useUI();
  return <>
    {!u.compact && <Txt kind="keys" muted numberOfLines={1} style={{ flex: 1 }}>{hint}</Txt>}
    {u.compact && <View style={{ flex: 1 }} />}
    <Button label="Cancel" variant="ghost" onPress={onCancel} />
    <Button label={busy ? 'Adding…' : label} variant="primary" icon="Plus" disabled={disabled || !!busy} onPress={onSubmit} />
  </>;
}

/** A notice in the preview: a calm note, or a warning that says plainly what will happen. */
export function Notice({ tone, children, nativeID }: { tone: 'note' | 'warning' | 'error'; children: React.ReactNode; nativeID?: string }) {
  const u = useUI(), color = tone === 'warning' ? u.c.statusWarning : tone === 'error' ? u.c.statusDanger : u.c.foregroundMuted;
  return <View nativeID={nativeID} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: tone === 'note' ? u.c.surface2 : u.wash(tone === 'warning' ? 'aviso' : 'riesgo') }}>
    <View style={{ paddingTop: 1 }}><Icon name={tone === 'note' ? 'Info' : tone === 'warning' ? 'TriangleAlert' : 'CircleAlert'} size={14} color={color} /></View>
    <Txt kind="small" style={{ flex: 1 }}>{children}</Txt>
  </View>;
}

const KIND_LABEL: Record<string, string> = { page: 'Web page', image: 'Image', video: 'Video', audio: 'Sound', reference: 'Link' };
const KIND_ICON: Record<string, string> = { page: 'AppWindow', image: 'Image', video: 'Film', audio: 'AudioLines', reference: 'Link' };
const INTENT: Record<LinkIntent, { title: string; icon: string; subtitle: string; placeholder: string; empty: string; action: string; caption: string; captionHelp?: string }> = {
  page: { title: 'Window', icon: 'AppWindow', subtitle: 'A live web page inside the Lienzo. A video or sound link becomes a player.', placeholder: 'https://example.com', empty: 'Paste or drop a link to a page.', action: 'Add Window', caption: 'Title', captionHelp: 'Shown on the Window’s bar. Without one, the site’s name is used.' },
  image: { title: 'Image', icon: 'Image', subtitle: 'A picture from this computer or from a link. Press it on the canvas to see it full size.', placeholder: 'https://example.com/picture.png', empty: 'Drop PNG, JPEG, WebP, GIF or SVG files here, or paste a link to one above.', action: 'Add image', caption: 'Caption' },
  video: { title: 'Video', icon: 'Video', subtitle: 'A YouTube or Vimeo link, or a video file. It never starts on its own.', placeholder: 'https://youtube.com/watch?v=…', empty: 'Paste or drop a YouTube or Vimeo link, or a link to an .mp4 or .webm.', action: 'Add video', caption: 'Caption' },
  audio: { title: 'Audio', icon: 'AudioLines', subtitle: 'A sound file from a link. It never starts on its own.', placeholder: 'https://example.com/episode.mp3', empty: 'Paste or drop a link to an .mp3, .m4a, .ogg or .wav.', action: 'Add audio', caption: 'Caption' },
};
export const linkSheetCopy = INTENT;

/** What the link will become, drawn as it would look: the image itself, a video's thumbnail and title, a page's site. */
function LinkPreview({ link, intent, title, thumbnail, imageState, onImage, onChoose, adding }: { link: LinkDescription; intent: LinkIntent; title: string | null; thumbnail?: string | null; imageState: 'loading' | 'ok' | 'failed'; onImage(state: 'ok' | 'failed'): void; onChoose?(): void; adding?: boolean }) {
  const u = useUI();
  const frame = { height: A.preview.height, borderRadius: A.preview.radius, overflow: 'hidden' as const, backgroundColor: u.c.surface0, borderWidth: 1, borderColor: u.c.border };
  if (link.status !== 'ok') return <View nativeID="lienzo-sheet-preview" style={[frame, { borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 }]}>
    <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: u.c.surface2 }}><Icon name={link.status === 'invalid' ? 'Unlink' : INTENT[intent].icon} size={18} color={u.c.foregroundMuted} /></View>
    <Txt kind="small" muted style={{ textAlign: 'center', maxWidth: 340 }}>{adding ? 'Adding the images…' : link.status === 'invalid' ? link.message : INTENT[intent].empty}</Txt>
    {onChoose && !adding && <Button label="Choose file…" icon="FolderOpen" small onPress={onChoose} />}
  </View>;
  const badge = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: withAlpha(u.c.surface1, .92), borderWidth: 1, borderColor: u.c.border }}>
    <Icon name={KIND_ICON[link.kind]} size={12} color={u.c.foreground} /><Txt kind="label" style={{ fontWeight: '600' }}>{link.provider ? `${link.provider} · Video` : KIND_LABEL[link.kind]}</Txt></View>;
  const meta = <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Txt kind="bodyStrong" numberOfLines={1}>{title ?? link.name}</Txt><Txt kind="small" muted numberOfLines={1}>{link.host}</Txt></View>;
  if (link.kind === 'image') return <View nativeID="lienzo-sheet-preview" style={frame}>
    <Image source={{ uri: link.url }} resizeMode="contain" onLoad={() => onImage('ok')} onError={() => onImage('failed')} accessibilityLabel="Preview of the image" style={{ width: '100%', height: '100%', opacity: imageState === 'ok' ? 1 : 0 }} />
    {imageState !== 'ok' && <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name={imageState === 'failed' ? 'ImageOff' : 'Image'} size={22} color={u.c.foregroundMuted} /><Txt kind="small" muted>{imageState === 'failed' ? 'This link did not load as an image.' : 'Loading the image…'}</Txt></View>}
    <View style={{ position: 'absolute', left: 10, top: 10 }}>{badge}</View>
  </View>;
  if (link.provider) return <View nativeID="lienzo-sheet-preview" style={frame}>
    {link.thumbnail ?? thumbnail ? <Image source={{ uri: (link.thumbnail ?? thumbnail)! }} resizeMode="cover" style={{ width: '100%', height: '100%' }} accessibilityLabel="Video thumbnail" /> : <View style={{ flex: 1, backgroundColor: u.c.surface2 }} />}
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha('#000000', .55) }}><Icon name="Play" size={22} color="#ffffff" /></View></View>
    <View style={{ position: 'absolute', left: 10, top: 10 }}>{badge}</View>
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: withAlpha(u.c.surface1, .94), borderTopWidth: 1, borderColor: u.c.border }}>{meta}</View>
  </View>;
  // A page, a file or a plain link: the site and the address, in the shape of a window.
  return <View nativeID="lienzo-sheet-preview" style={[frame, { height: link.kind === 'audio' ? 120 : A.preview.height }]}>
    <View style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1 }}>
      <Icon name={link.kind === 'page' ? 'Globe' : KIND_ICON[link.kind]} size={13} color={u.c.foregroundMuted} />
      <Txt kind="small" muted numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>{title || link.host}</Txt>
    </View>
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18 }}>
      <View style={{ width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: u.wash(link.kind === 'page' ? 'acento' : 'turquesa') }}><Icon name={KIND_ICON[link.kind]} size={22} color={link.kind === 'page' ? u.c.accent : u.tone('turquesa')} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>{badge}<Txt kind="bodyStrong" numberOfLines={1}>{link.name}</Txt><Txt kind="code" muted numberOfLines={1}>{link.url}</Txt></View>
    </View>
  </View>;
}

export type LinkSheetProps = { intent: LinkIntent | null; onClose(): void; panel: { width: number; height: number }; disabled?: boolean;
  /** Image files dropped on the sheet or chosen with "Choose file…" (image intent). Resolves true when they were added. */
  onFiles?(files: ImageFile[]): Promise<boolean>;
  /** Adds the block. Resolves false when nothing was added (the sheet stays open). */
  onAdd(block: ReturnType<typeof linkBlock>): boolean | Promise<boolean> };
export function LinkSheet({ intent, onClose, panel, disabled = false, onAdd, onFiles }: LinkSheetProps) {
  const u = useUI(), [raw, setRaw] = useState(''), [caption, setCaption] = useState(''), [title, setTitle] = useState<string | null>(null), [thumb, setThumb] = useState<string | null>(null), [image, setImage] = useState<'loading' | 'ok' | 'failed'>('loading'), [drop, setDrop] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const zone = useRef<View>(null), kind = intent ?? 'page', link = useMemo(() => describeLink(raw, kind), [raw, kind]), url = link.status === 'ok' ? link.url : '';
  useEffect(() => { setRaw(''); setCaption(''); setError(''); setBusy(false); }, [intent]);
  useEffect(() => { setImage('loading'); setTitle(null); setThumb(null); setError(''); }, [url]);
  useEffect(() => {
    if (link.status !== 'ok' || !link.oembed) return; let live = true;
    const timer = setTimeout(() => { void fetchLinkPreview(link.oembed!).then(found => { if (live) { setTitle(found.title); setThumb(found.thumbnail); } }); }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [url]);
  const files = intent === 'image' && onFiles && u.layout.platform === 'web' ? onFiles : undefined, latestFiles = useRef(files); latestFiles.current = files;
  const addFiles = async (list: ImageFile[]) => {
    const take = latestFiles.current; if (!take || !list.length || disabled || busy) return;
    setBusy(true); setError('');
    try { if (await take(list)) onClose(); else setError('No image was added. See the notice on the canvas.'); }
    catch { setError('The images were not added. Check the connection and try again.'); } finally { setBusy(false); }
  };
  const latestAdd = useRef(addFiles); latestAdd.current = addFiles;
  useEffect(() => intent ? attachDrop(zone.current, { over: setDrop, text: text => setRaw(text.trim()), ...(intent === 'image' ? { file: (_file: DroppedFile, all: DroppedFile[]) => { void latestAdd.current(all); } } : {}) }) : undefined, [intent]);
  if (!intent) return null;
  const copy = INTENT[intent], ready = link.status === 'ok' && !disabled && !busy;
  const submit = async () => {
    if (link.status !== 'ok' || disabled || busy) return;
    setBusy(true); setError('');
    try { if (await onAdd(linkBlock(link, caption, title))) onClose(); else setError('It was not added. See the notice on the canvas.'); }
    catch { setError('It was not added. Check the connection and try again.'); } finally { setBusy(false); }
  };
  const warning = link.status === 'ok' ? (link.kind === 'image' && image === 'failed' ? 'This link did not load as an image. It will be added anyway and show as a link you can open; check that the address points to the picture itself.' : link.warning) : undefined;
  return <AddSheet open onClose={onClose} nativeID={`lienzo-sheet-${intent}`} icon={copy.icon} title={copy.title} subtitle={copy.subtitle} panel={panel}
    footer={<Footer hint={`↵ ${copy.action} · Esc Close`} label={copy.action} disabled={!ready} busy={busy} onCancel={onClose} onSubmit={() => { void submit(); }} />}>
    <View ref={zone} style={{ gap: A.gap, borderRadius: 12, ...(drop ? { outlineWidth: 2, outlineStyle: 'dashed', outlineColor: u.c.accent, outlineOffset: 6 } as object : {}) }}>
      <LabelledField label="Link" icon="Link" nativeID="lienzo-sheet-url" value={raw} onChange={setRaw} placeholder={copy.placeholder} onSubmit={() => { void submit(); }} disabled={disabled} />
      <LinkPreview link={link} intent={intent} title={title} thumbnail={thumb} imageState={image} onImage={setImage} adding={busy && !!files} onChoose={files && !disabled ? () => { void pickFiles(MEDIA_ACCEPT).then(list => latestAdd.current(list)); } : undefined} />
      {warning ? <Notice tone="warning" nativeID="lienzo-sheet-warning">{warning}</Notice> : link.status === 'ok' && link.note ? <Notice tone="note" nativeID="lienzo-sheet-note">{link.note}</Notice> : null}
      <LabelledField label={copy.caption} optional nativeID="lienzo-sheet-caption" value={caption} onChange={setCaption} placeholder={intent === 'page' ? link.status === 'ok' ? link.host : 'The site’s name' : 'A line under it on the canvas'} helper={copy.captionHelp} onSubmit={() => { void submit(); }} disabled={disabled} />
      {!!error && <Notice tone="error">{error}</Notice>}
    </View>
  </AddSheet>;
}

// ---- Import SVG: three ways in, as tabs.
export type SvgTab = 'code' | 'file' | 'url';
const SVG_TABS: readonly { id: SvgTab; label: string; icon: string }[] = [{ id: 'code', label: 'Paste code', icon: 'Code' }, { id: 'file', label: 'File', icon: 'FileUp' }, { id: 'url', label: 'URL', icon: 'Link' }];
/** Said plainly: why an SVG was refused. */
export function svgProblem(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/larger than|too large|limit/i.test(message)) return 'This SVG is too large. Lienzo takes SVG up to 64 KB.';
  if (/not an SVG/i.test(message)) return 'That file is not an SVG.';
  if (/could not be (loaded|read)|fetch|network|abort/i.test(message)) return 'The SVG could not be loaded from that address. The site may not allow it; download the file and use File instead.';
  if (/Unsafe SVG/i.test(message)) return 'This SVG has scripts, links, images or animation, which Lienzo does not import. Static shapes, paths, text and gradients work.';
  return 'This is not an SVG Lienzo can read. Paste the whole <svg>…</svg>.';
}
export type SvgSheetProps = { open: boolean; onClose(): void; panel: { width: number; height: number }; onInsert(svg: string, meta?: SvgInsertOptions): Promise<boolean> };
export function SvgSheet({ open, onClose, panel, onInsert }: SvgSheetProps) {
  const u = useUI(), web = u.layout.platform === 'web', [tab, setTab] = useState<SvgTab>('code'), [code, setCode] = useState(''), [url, setUrl] = useState(''), [loaded, setLoaded] = useState<{ svg: string; name: string } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [drop, setDrop] = useState(false), zone = useRef<View>(null);
  useEffect(() => { if (open) { setTab('code'); setCode(''); setUrl(''); setLoaded(null); setError(''); setBusy(false); } }, [open]);
  useEffect(() => { setError(''); }, [tab]);
  useEffect(() => open ? attachDrop(zone.current, { over: setDrop, file: file => { void readSvgFile(file).then(svg => { setLoaded({ svg, name: file.name }); setTab('file'); setError(''); }).catch(e => { setTab('file'); setError(svgProblem(e)); }); }, text: text => { if (/<svg[\s>]/i.test(text)) { setCode(text); setTab('code'); } else { setUrl(text.trim()); setTab('url'); } } }) : undefined, [open]);
  // The pasted code is checked as you type, so the preview is what will be inserted.
  const pasted = useMemo(() => { if (!code.trim()) return null; try { return { svg: sanitizeSvg(code).svg }; } catch (e) { return { problem: svgProblem(e) }; } }, [code]);
  const tabsShown = web ? SVG_TABS : SVG_TABS.filter(t => t.id === 'code');
  const current = tab === 'code' ? pasted && 'svg' in pasted ? pasted.svg : null : loaded?.svg ?? null;
  const insert = async () => {
    if (!current || busy) return; setBusy(true); setError('');
    try { if (await onInsert(current, tab === 'url' && loaded ? { source: loaded.name.slice(0, 200) } : {})) onClose(); else setError('The SVG was not saved. See the notice on the canvas.'); }
    catch (e) { setError(svgProblem(e)); } finally { setBusy(false); }
  };
  const load = async () => {
    if (!url.trim() || busy) return; setBusy(true); setError(''); setLoaded(null);
    try { const svg = await fetchSvgUrl(url); setLoaded({ svg, name: url.trim() }); } catch (e) { setError(svgProblem(e)); } finally { setBusy(false); }
  };
  const choose = async () => { setError(''); try { const svg = await pickSvgFile(); if (svg) setLoaded({ svg, name: 'Chosen file' }); } catch (e) { setError(svgProblem(e)); } };
  const mac = isMacPlatform(), enter = tab === 'code' ? `${mac ? '⌘' : 'Ctrl+'}↵` : '↵';
  const preview = <View nativeID="lienzo-svg-preview" style={{ height: 168, borderRadius: A.preview.radius, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0, alignItems: 'center', justifyContent: 'center', padding: 28, ...(current ? {} : { borderStyle: 'dashed' }) }}>
    {current && web ? <View style={{ width: '100%', height: '100%' }}><WebSvg svg={current} color={u.c.foreground} label="Preview of the SVG" /></View>
      : <View style={{ alignItems: 'center', gap: 8 }}><Icon name="Shapes" size={20} color={u.c.foregroundMuted} /><Txt kind="small" muted style={{ textAlign: 'center' }}>{current ? 'Ready to insert.' : tab === 'code' ? 'The drawing appears here as you paste.' : tab === 'file' ? 'Choose a file, or drop one on this sheet.' : 'Load the address to see the drawing.'}</Txt></View>}
  </View>;
  useEffect(() => {
    if (!open || !web) return;
    const doc = (globalThis as { document?: { addEventListener(n: string, f: (e: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault(): void }) => void): void; removeEventListener(n: string, f: unknown): void } }).document;
    const key = (e: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault(): void }) => { if (e.key === 'Enter' && (tab === 'code' ? e.metaKey || e.ctrlKey : tab === 'file')) { e.preventDefault(); void insert(); } };
    doc?.addEventListener('keydown', key); return () => doc?.removeEventListener('keydown', key);
  });
  return <AddSheet open={open} onClose={onClose} nativeID="lienzo-sheet-svg" icon="Shapes" title="Import SVG" subtitle="A vector drawing that stays sharp at any zoom. Static SVG only: no scripts, links or images." panel={panel}
    footer={<Footer hint={`${enter} Insert · Esc Close`} label="Insert SVG" disabled={!current} busy={busy} onCancel={onClose} onSubmit={() => { void insert(); }} />}>
    <View ref={zone} style={{ gap: A.gap, borderRadius: 12, ...(drop ? { outlineWidth: 2, outlineStyle: 'dashed', outlineColor: u.c.accent, outlineOffset: 6 } as object : {}) }}>
      {tabsShown.length > 1 && <View accessibilityRole={'tablist' as never} style={{ flexDirection: 'row', gap: 2, padding: 3, borderRadius: 9, backgroundColor: u.c.surface2 }}>
        {tabsShown.map(t => { const on = t.id === tab; return <Pressable key={t.id} nativeID={`lienzo-svg-tab-${t.id}`} accessibilityRole={'tab' as never} accessibilityLabel={t.label} accessibilityState={{ selected: on }} onPress={() => setTab(t.id)}
          style={{ flex: 1, height: A.tab, borderRadius: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: on ? u.c.surface1 : 'transparent', borderWidth: 1, borderColor: on ? u.c.border : 'transparent' }}>
          <Icon name={t.icon} size={14} color={on ? u.c.foreground : u.c.foregroundMuted} /><Txt kind="small" muted={!on} style={{ fontWeight: '600' }}>{t.label}</Txt></Pressable>; })}
      </View>}
      {tab === 'code' && <LabelledField label="SVG code" mono multiline nativeID="lienzo-svg-code" value={code} onChange={setCode} placeholder={'<svg viewBox="0 0 24 24" …>…</svg>'} />}
      {tab === 'file' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: drop ? u.c.accent : u.c.border, backgroundColor: u.c.surface0 }}>
        <Icon name="FileUp" size={18} color={u.c.foregroundMuted} />
        <View style={{ flex: 1, minWidth: 0 }}><Txt kind="bodyStrong" numberOfLines={1}>{loaded ? loaded.name : 'Drop an .svg file here'}</Txt><Txt kind="small" muted>Up to 64 KB.</Txt></View>
        <Button label={loaded ? 'Choose another' : 'Choose file…'} icon="FolderOpen" onPress={() => { void choose(); }} />
      </View>}
      {tab === 'url' && <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <View style={{ flex: 1 }}><LabelledField label="SVG address" icon="Link" nativeID="lienzo-svg-url" value={url} onChange={v => { setUrl(v); setLoaded(null); }} placeholder="https://example.com/drawing.svg" onSubmit={() => { void (loaded ? insert() : load()); }} /></View>
        <Button label={busy && !loaded ? 'Loading…' : 'Load'} disabled={!url.trim() || busy} onPress={() => { void load(); }} style={{ minHeight: u.compact ? 44 : A.field }} />
      </View>}
      {preview}
      {tab === 'code' && pasted && 'problem' in pasted && <Notice tone="warning" nativeID="lienzo-svg-problem">{pasted.problem}</Notice>}
      {!!error && <Notice tone="error" nativeID="lienzo-svg-error">{error}</Notice>}
    </View>
  </AddSheet>;
}
