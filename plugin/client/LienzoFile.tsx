/**
 * Sharing one Lienzo as a .lienzo file (docs/design.md §41, shared/lienzo-file.ts): the export dialog, the review
 * before an import, and how a file reaches them (a picker, a drop, the desktop app opening one). Both dialogs use the
 * add sheet's shell. The server does the work (canvas.lienzo.export / canvas.lienzo.import); nothing here writes.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, files as hostFiles } from './host';
import type { CanvasDocument } from '../shared/model';
import { LIENZO_ACCEPT, LIENZO_FILE, formatBytes, lienzoCounts, lienzoFileName, type LienzoReview } from '../shared/lienzo-file';
import type { CanvasController } from './useCanvas';
import { Button, Chip, Txt, friendlyError, useUI } from './ui';
import { AddSheet, Notice } from './AddSheets';
import { Thumbnail } from './LienzosScreen';
import { LoadingEgg } from './Eggs';
import { downloadText, onEnterKey, pickFiles } from './web';
import { withAlpha, type Tone } from './color';
import { tokens } from './tokens';

const T = tokens.face.lienzoFile;
export type LienzoFlow = { kind: 'export'; documentId: string } | { kind: 'import'; name: string; text: string; error?: string };
type FileLike = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

export const isLienzoName = (name: string) => /\.lienzo$/i.test(name);
const tooLarge = (name: string) => `“${name}” is larger than ${LIENZO_FILE.maxBytes / 1024 / 1024} MB, the most a .lienzo file can be.`;
/** A dropped or chosen file, read as text after its size is checked. Never throws: a problem comes back as `error`. */
export async function readLienzoFile(file: FileLike): Promise<Extract<LienzoFlow, { kind: 'import' }>> {
  if (file.size > LIENZO_FILE.maxBytes) return { kind: 'import', name: file.name, text: '', error: tooLarge(file.name) };
  try { return { kind: 'import', name: file.name, text: new TextDecoder('utf-8').decode(await file.arrayBuffer()) }; }
  catch { return { kind: 'import', name: file.name, text: '', error: `“${file.name}” could not be read.` }; }
}
/** "Import…": the system picker, one file. Null when cancelled. */
export async function pickLienzoFile(): Promise<Extract<LienzoFlow, { kind: 'import' }> | null> {
  const [file] = await pickFiles(`${LIENZO_ACCEPT},application/json`, false);
  return file ? readLienzoFile(file) : null;
}
/** .lienzo files the host opens with the app (the desktop app); nothing on Paseo. */
export function onOpenLienzo(listener: (flow: Extract<LienzoFlow, { kind: 'import' }>) => void): () => void {
  return hostFiles ? hostFiles.onOpen(file => listener({ kind: 'import', name: file.name, text: file.text, ...(file.error ? { error: file.error } : {}) })) : () => {};
}

/** The summary both dialogs lead with: the Lienzo drawn small, its title and what it holds. */
function Summary({ c, document, title, lines }: { c: CanvasController; document?: CanvasDocument; title: string; lines: React.ReactNode[] }) {
  const u = useUI();
  return <View style={{ flexDirection: 'row', gap: T.card.gap, alignItems: 'center', padding: T.card.padding, borderRadius: T.card.radius, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0 }}>
    <View style={{ width: T.thumb.width, height: T.thumb.height, borderRadius: T.thumb.radius, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, overflow: 'hidden' }}>
      <Thumbnail document={document} c={c} width={T.thumb.width - 2} height={T.thumb.height - 2} />
    </View>
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <Txt kind="title" numberOfLines={2}>{title}</Txt>
      {lines.map((line, i) => <Txt key={i} kind="small" muted numberOfLines={2}>{line}</Txt>)}
    </View>
  </View>;
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function holds(counts: { blocks: number; sheets: number; frames: number }, images: string) {
  return [plural(counts.blocks, 'block'), counts.sheets ? plural(counts.sheets, 'Sheet') : '', counts.frames ? plural(counts.frames, 'Frame') : '', images].filter(Boolean).join(' · ');
}

/** A choice with a title and one line under it; the whole row toggles. */
function Option({ label, detail, checked, disabled, onPress, nativeID }: { label: string; detail: string; checked: boolean; disabled?: boolean; onPress(): void; nativeID: string }) {
  const u = useUI();
  return <Pressable nativeID={nativeID} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityHint={detail} accessibilityState={{ checked, disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed, ...state }) => ({ minHeight: T.option.minHeight, flexDirection: 'row', alignItems: 'flex-start', gap: T.option.gap, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
      borderColor: checked ? withAlpha(u.c.accent, .55) : u.c.border, backgroundColor: pressed ? withAlpha(u.c.foreground, .06) : checked ? withAlpha(u.c.accent, .06) : (state as { hovered?: boolean }).hovered && !disabled ? withAlpha(u.c.foreground, .03) : 'transparent', opacity: disabled ? .5 : 1 })}>
    <View style={{ width: T.option.box, height: T.option.box, marginTop: 1, borderRadius: T.option.radius, borderWidth: checked ? 0 : 1.5, borderColor: u.c.foregroundMuted, backgroundColor: checked ? u.c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {checked && <Icon name="Check" size={12} color={u.c.accentForeground} />}
    </View>
    <View style={{ flex: 1, gap: 2 }}><Txt kind="bodyStrong">{label}</Txt><Txt kind="small" muted>{detail}</Txt></View>
  </Pressable>;
}

function SheetFooter({ hint, children }: { hint: string; children: React.ReactNode }) {
  const u = useUI();
  return <>{u.compact ? <View style={{ flex: 1 }} /> : <Txt kind="keys" muted numberOfLines={1} style={{ flex: 1 }}>{hint}</Txt>}{children}</>;
}

/** Export: two choices, a note that history stays, then the system's Save dialog or a download. */
export function ExportSheet({ c, documentId, panel, onClose, onSaved }: { c: CanvasController; documentId: string | null; panel: { width: number; height: number }; onClose(): void; onSaved(message: string): void }) {
  const u = useUI(), [comments, setComments] = useState(false), [runtime, setRuntime] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [doc, setDoc] = useState<CanvasDocument | null>(null), [threads, setThreads] = useState<number | null>(null);
  useEffect(() => {
    if (!documentId) return; let live = true;
    setComments(false); setRuntime(false); setBusy(false); setError(''); setThreads(null);
    const open = c.view?.document.id === documentId ? c.view.document : null; setDoc(open);
    if (!open) void c.api.read({ workspaceId: c.workspaceId, documentId }).then(view => { if (live) setDoc(view.document); }).catch(e => { if (live) setError(friendlyError(e)); });
    void c.api.comments({ workspaceId: c.workspaceId, documentId }).then(view => { if (live) setThreads(view.threads.length); }).catch(() => { if (live) setThreads(0); });
    return () => { live = false; };
  }, [documentId]);
  const counts = doc ? lienzoCounts(doc) : null, name = doc ? lienzoFileName(doc.title) : '';
  const run = async () => {
    if (!documentId || busy) return; setBusy(true); setError('');
    try {
      const file = await c.api.exportLienzo({ workspaceId: c.workspaceId, documentId, comments, runtime });
      const saved = hostFiles ? await hostFiles.save({ name: file.fileName, mime: file.mime, text: file.text }) : downloadText(file.text, file.fileName, file.mime);
      if (!saved) { if (!hostFiles) setError('This device cannot save files here. Export from the web or desktop app.'); return; }
      onClose();
      onSaved(file.missingImages ? `Saved ${file.fileName}. ${plural(file.missingImages, 'image')} could not be found on this computer and ${file.missingImages === 1 ? 'was' : 'were'} left out.` : `Saved ${file.fileName} · ${formatBytes(file.bytes)}`);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const latest = React.useRef(run); latest.current = run;
  useEffect(() => documentId ? onEnterKey(() => { void latest.current(); return true; }) : undefined, [documentId]);
  return <AddSheet open={!!documentId} onClose={onClose} nativeID="lienzo-export-sheet" icon="FileOutput" title="Export this Lienzo" subtitle="A .lienzo file anyone with Lienzo can open. It opens as a new Lienzo; nothing of theirs is replaced." panel={panel} sheetWidth={T.width}
    footer={<SheetFooter hint="↵ Export · Esc Close"><Button label="Cancel" variant="ghost" onPress={onClose} /><Button label={busy ? 'Exporting…' : 'Export'} icon="FileOutput" variant="primary" disabled={!doc || busy} onPress={() => { void run(); }} /></SheetFooter>}>
    <Summary c={c} document={doc ?? undefined} title={doc?.title ?? 'Reading the Lienzo…'} lines={counts ? [holds(counts, counts.images ? `${plural(counts.images, 'image')} inside` : ''), <Txt key="n" kind="code" style={{ fontSize: 12 }}>{name}</Txt>] : []} />
    <View style={{ gap: 8 }}>
      <Txt kind="small" style={{ fontWeight: '600' }}>Include</Txt>
      <Option nativeID="lienzo-export-comments" label="Comments" checked={comments} disabled={threads === 0} onPress={() => setComments(v => !v)}
        detail={threads === null ? 'The notes pinned on this Lienzo, with who wrote them.' : threads ? `${plural(threads, 'thread')}, open and resolved, with who wrote them.` : 'This Lienzo has no comments.'} />
      <Option nativeID="lienzo-export-runtime" label="What people did with interactive blocks" checked={runtime} onPress={() => setRuntime(v => !v)}
        detail="Control values, quiz answers, mini app state and what extensions kept on this Lienzo. Off: the blocks start fresh." />
    </View>
    <Notice tone="note">History is not included: the file holds this Lienzo as it is now. Images and the custom block types and extensions it uses travel inside it.</Notice>
    {!!error && <Notice tone="error" nativeID="lienzo-export-error">{error}</Notice>}
  </AddSheet>;
}

const STATUS: Record<LienzoReview['blockTypes'][number]['status'], { label: string; tone: Tone }> = {
  new: { label: 'New', tone: T.status.new as Tone }, installed: { label: 'Installed', tone: T.status.installed as Tone }, conflict: { label: 'Yours kept', tone: T.status.conflict as Tone },
};
function ItemRow({ icon, name, detail, status, nativeID }: { icon: string; name: string; detail?: string; status: keyof typeof STATUS; nativeID?: string }) {
  const u = useUI(), s = STATUS[status];
  return <View nativeID={nativeID} style={{ minHeight: T.row.height, flexDirection: 'row', alignItems: 'center', gap: T.row.gap }}>
    <View style={{ width: T.row.icon, height: T.row.icon, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: u.c.surface2 }}><Icon name={icon} size={14} color={u.c.foregroundMuted} /></View>
    <View style={{ flex: 1, minWidth: 0 }}><Txt numberOfLines={1}>{name}</Txt>{!!detail && <Txt kind="small" muted numberOfLines={1}>{detail}</Txt>}</View>
    <Chip label={s.label} tone={s.tone} center />
  </View>;
}
function Fact({ icon, label, value, on }: { icon: string; label: string; value: string; on: boolean }) {
  const u = useUI();
  return <View style={{ flex: 1, minWidth: 180, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, backgroundColor: u.c.surface2 }}>
    <Icon name={icon} size={15} color={on ? u.c.accent : u.c.foregroundMuted} />
    <View style={{ flex: 1, minWidth: 0 }}><Txt kind="small" muted>{label}</Txt><Txt kind="bodyStrong" numberOfLines={1} style={on ? undefined : { color: u.c.foregroundMuted, fontWeight: '400' }}>{value}</Txt></View>
  </View>;
}
const PERMISSION: Record<string, string> = { edit: 'edit', network: 'go online', view: 'move the view', variables: 'set variables' };
const exportedOn = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
/** The incoming content as a document the thumbnail can draw. */
const previewDocument = (review: LienzoReview, workspaceId: string): CanvasDocument | undefined => review.preview && { ...review.preview, id: 'lienzo-import-preview', workspaceId, revision: 0, createdAt: review.exportedAt, updatedAt: review.exportedAt };

/** The review before an import: what the file is, what it brings, what is new here; then one button. */
export function ImportSheet({ c, file, panel, onClose, onImported }: { c: CanvasController; file: Extract<LienzoFlow, { kind: 'import' }> | null; panel: { width: number; height: number }; onClose(): void; onImported(id: string, review: LienzoReview): void }) {
  const u = useUI(), [review, setReview] = useState<LienzoReview | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!file) return; let live = true; setReview(null); setBusy(false); setError(file.error ?? '');
    if (!file.error) void c.api.importLienzo({ workspaceId: c.workspaceId, text: file.text, dryRun: true }).then(r => { if (live) setReview(r); }).catch(e => { if (live) setError(friendlyError(e)); });
    return () => { live = false; };
  }, [file]);
  const run = async () => {
    if (!file || !review || busy) return; setBusy(true); setError('');
    try { const done = await c.api.importLienzo({ workspaceId: c.workspaceId, text: file.text, dryRun: false }); if (done.documentId) onImported(done.documentId, done); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const latest = React.useRef(run); latest.current = run;
  useEffect(() => file ? onEnterKey(() => { void latest.current(); return true; }) : undefined, [file]);
  const asking = review?.extensions.filter(e => e.status === 'new' && e.permissions.length) ?? [];
  const sub = review ? `Exported ${exportedOn(review.exportedAt)} from ${review.app.name} ${review.app.version}`.replace('Exported  from', 'Exported from') : 'It becomes a new Lienzo. Nothing you have is overwritten.';
  return <AddSheet open={!!file} onClose={onClose} nativeID="lienzo-import-sheet" icon="FileInput" title={file ? `Import “${file.name}”` : 'Import a Lienzo'} subtitle={sub} panel={panel} sheetWidth={T.width}
    footer={<SheetFooter hint={review ? `↵ Import · Esc Close · ${formatBytes(review.bytes)}` : 'Esc Close'}>
      <Button label={review ? 'Cancel' : 'Close'} variant="ghost" onPress={onClose} />
      {(review || !error) && <Button label={busy ? 'Importing…' : 'Import as a new Lienzo'} icon="FileInput" variant="primary" disabled={!review || busy || c.offline} onPress={() => { void run(); }} />}
    </SheetFooter>}>
    {!review && !error && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: T.thumb.height }}><LoadingEgg /><Txt muted>Reading the file…</Txt></View>}
    {review && <>
      <Summary c={c} document={previewDocument(review, c.workspaceId)} title={review.title}
        lines={[holds(review, review.images.count ? `${plural(review.images.count, 'image')}, ${formatBytes(review.images.bytes)}` : ''),
          ...(review.importTitle !== review.title ? [<Txt key="t" kind="small" style={{ color: u.c.foreground }}>Imports as “{review.importTitle}”: you already have one with this name.</Txt>] : [])]} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Fact icon="MessageSquare" label="Comments" value={review.comments === null ? 'Not included' : review.comments ? `${plural(review.comments, 'thread')}, authors kept` : 'Included, none'} on={!!review.comments} />
        <Fact icon="SlidersHorizontal" label="Interactive state" value={review.runtime ? 'Included' : 'Not included: blocks start fresh'} on={review.runtime} />
      </View>
      {!!review.blockTypes.length && <View nativeID="lienzo-import-types" style={{ gap: 2 }}>
        <Txt kind="small" style={{ fontWeight: '600', marginBottom: 4 }}>Block types it brings</Txt>
        {review.blockTypes.map(t => <ItemRow key={t.id} icon="Shapes" name={t.name} detail={t.id} status={t.status} />)}
      </View>}
      {!!review.extensions.length && <View nativeID="lienzo-import-extensions" style={{ gap: 2 }}>
        <Txt kind="small" style={{ fontWeight: '600', marginBottom: 4 }}>Extensions it brings</Txt>
        {review.extensions.map(e => <ItemRow key={e.id} icon={e.icon ?? 'Puzzle'} name={e.name} detail={e.permissions.length ? `Asks to ${e.permissions.map(p => PERMISSION[p] ?? p).join(', ')}` : 'Reads and selects only'} status={e.status} />)}
        {asking.length > 0 && <Txt kind="small" muted style={{ marginTop: 4 }}>Imported extensions only read and select until you allow them in Extensions.</Txt>}
      </View>}
      {review.warnings.map((warning, i) => <Notice key={i} tone="warning">{warning}</Notice>)}
    </>}
    {!!error && <Notice tone="error" nativeID="lienzo-import-error">{error}</Notice>}
  </AddSheet>;
}
