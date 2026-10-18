import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { EXTENSION_API, EXTENSION_FORBIDDEN_OPERATIONS, EXTENSION_LIMITS, extensionDocument, extensionEvent } from '../shared/extensions';
import type { CanvasOperation, CatalogExtension, ExtensionPermission } from '../shared/model';
import { isDark } from './color';
import { layoutCanvas, newId } from './logic';
import { Button, IconButton, Txt, useUI } from './ui';
import { capabilities } from './host';
import type { CanvasController } from './useCanvas';
import { WebExtension, type ExtensionCall } from './web';

const PERMISSION: Record<ExtensionPermission, string> = { edit: 'change the canvas', agent: 'ask the agent for things', network: 'load things from the internet' };
export const extensionIcon = (extension: CatalogExtension) => extension.icon ?? 'Puzzle';
const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * One extension running: its frame, the context it is told, and the answers to what it asks for. Everything an
 * extension does goes through here, so what it may do is decided in one place: reading and selecting are always
 * allowed, editing and asking the assistant only with the permission, and an imported one holds none until granted.
 */
function ExtensionFrame({ extension, controller: c, onOpen, onClose }: { extension: CatalogExtension; controller: CanvasController; onOpen(id: string): void; onClose?(): void }) {
  const u = useUI(), doc = c.view!.document, allowed = extension.granted ? extension.permissions : [];
  const source = useMemo(() => extensionDocument(extension, extension.granted), [extension.html, extension.granted, extension.permissions.join()]);
  const layout = useMemo(() => Object.fromEntries([...layoutCanvas(doc, {}, c.catalog).rects].filter(([, r]) => !r.hidden).map(([id, r]) => [id, { x: r.x, y: r.y, width: r.width, height: r.height }])), [doc.blocks, doc.groups, doc.layout, c.catalog]);
  const context = useMemo(() => ({
    api: EXTENSION_API, extension: { id: extension.id, kind: extension.kind, name: extension.name, permissions: allowed },
    theme: { dark: isDark(u.c.surface0), colors: { background: u.c.surface0, surface: u.c.surface1, foreground: u.c.foreground, muted: u.c.foregroundMuted, border: u.c.border, accent: u.c.accent, flow: u.tone('acento'), needs: u.tone('violeta'), mentions: u.tone('turquesa'), areas: [u.tone('acento'), u.tone('turquesa'), u.tone('violeta'), u.tone('exito'), u.tone('aviso')] } },
    document: { id: doc.id, title: doc.title, description: doc.description, revision: doc.revision,
      blocks: doc.blocks.map(b => ({ id: b.id, title: b.title, typeId: b.typeId, renderer: c.catalog?.blockTypes.find(t => t.id === b.typeId)?.renderer ?? null, data: b.data, parentGroupId: b.parentGroupId ?? null })),
      groups: doc.groups.map(g => ({ id: g.id, title: g.title, description: g.description, blockIds: g.blockIds, groupIds: g.groupIds, parentGroupId: g.parentGroupId ?? null })),
      links: (doc.links ?? []).map(l => ({ id: l.id, from: l.from, to: l.to, kind: l.kind, label: l.label ?? '' })) },
    layout, selection: c.selection,
  }), [doc, layout, c.selection, u.c, extension.id, allowed.join()]);
  const known = (id: unknown): id is string => typeof id === 'string' && [...doc.blocks, ...doc.groups].some(e => e.id === id);
  const need = (permission: ExtensionPermission) => { if (!allowed.includes(permission)) throw new Error(extension.permissions.includes(permission) ? 'This extension has no permission yet: allow it on the canvas first.' : `The extension did not declare the “${permission}” permission.`); };
  const onCall = async ({ method, args }: ExtensionCall): Promise<unknown> => {
    if (method === 'select') { const ids = (Array.isArray(args.ids) ? args.ids : []).filter(known).slice(0, EXTENSION_LIMITS.selection); await c.select([...new Set(ids)]); return { ids }; }
    if (method === 'open') { if (!known(args.id)) throw new Error('That is not on the canvas.'); onOpen(args.id); return null; }
    if (method === 'close') { onClose?.(); return null; }
    if (method === 'edit') {
      need('edit'); const operations = args.operations;
      if (!Array.isArray(operations) || !operations.length || operations.length > EXTENSION_LIMITS.operations) throw new Error(`Expected 1 to ${EXTENSION_LIMITS.operations} operations.`);
      if (operations.some(o => !o || typeof o !== 'object' || (EXTENSION_FORBIDDEN_OPERATIONS as readonly string[]).includes((o as { type?: string }).type ?? ''))) throw new Error('An extension cannot change the saved selection or the agent instructions with edit.');
      if (c.offline) throw new Error(`No connection to ${capabilities.name}.`);
      const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, 200) : extension.name, next = await c.edit(operations as CanvasOperation[], `${extension.name}: ${label}`.slice(0, 300));
      if (!next) throw new Error(c.failure?.message ?? 'The canvas rejected the change.'); return { revision: next.document.revision };
    }
    if (method === 'ask') {
      need('agent'); const event = extensionEvent(args.kind, args.payload); if (!event) throw new Error(`The request needs a short name and JSON data of up to ${EXTENSION_LIMITS.payload} characters.`);
      const targetIds = (Array.isArray(args.targetIds) ? args.targetIds : []).filter(known).slice(0, 20), label = typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, 240) : `${extension.name}: ${event.kind}`;
      const result = await c.send({ kind: 'extension.event', label, payload: { extension: extension.id, event: event.kind, data: event.payload as never }, targetIds, delivery: 'immediate' }, newId('evt'));
      if (!result || result.status === 'failed') throw new Error(result?.error ?? 'Not sent.'); return { status: result.status };
    }
    throw new Error(`lienzo.${method} does not exist in API ${EXTENSION_API}.`);
  };
  if (u.layout.platform !== 'web') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}><Txt kind="small" muted>Extensions run in the web and desktop apps.</Txt></View>;
  return <WebExtension id={extension.id} source={source} title={extension.name} surface={u.c.surface0} context={context} revision={`${doc.id}:${doc.revision}:${c.selection.join()}:${u.c.surface0}:${allowed.join()}`} onCall={onCall} />;
}
/** An imported extension asks before it does more than read: what it wants, in words, and one press to allow it. */
function Grant({ extension, controller: c }: { extension: CatalogExtension; controller: CanvasController }) {
  const u = useUI(), [error, setError] = useState('');
  if (extension.granted || !extension.permissions.length) return null;
  const allow = () => { setError(''); void c.task(async () => { const catalog = await c.api.catalog({}); c.setCatalog(await c.api.catalogMutate({ expectedRevision: catalog.revision, action: { type: 'extension.grant', id: extension.id, granted: true } })); }).catch(() => setError('The permission could not be saved.')); };
  return <View nativeID={`lienzo-extension-grant-${extension.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: u.c.border, backgroundColor: u.wash('aviso') }}>
    <Txt kind="small" style={{ flex: 1 }}>It came in the “{extension.source}” collection and asks to {list(extension.permissions.map(p => PERMISSION[p]))}. Without your permission it can only read and select.{error ? ` ${error}` : ''}</Txt>
    <Button label="Allow" small variant="primary" onPress={allow} />
  </View>;
}
/** A tool made by the person or their agent, as a tab of the right panel, working on the shared selection. */
export function ExtensionTool({ extension, controller, onOpen, onClose, height }: { extension: CatalogExtension; controller: CanvasController; onOpen(id: string): void; onClose(): void; height: number }) {
  const u = useUI();
  return <View nativeID={`lienzo-extension-tool-${extension.id}`} style={{ height, overflow: 'hidden' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 4, minHeight: 36, borderBottomWidth: 1, borderColor: u.c.border }}><Txt kind="small" muted numberOfLines={1} style={{ flex: 1 }}>{extension.description || 'Extension'}</Txt><IconButton icon="X" label={`Close ${extension.name}`} onPress={onClose} /></View>
    <Grant extension={extension} controller={controller} />
    <View style={{ flex: 1, minHeight: 0 }}><ExtensionFrame extension={extension} controller={controller} onOpen={onOpen} onClose={onClose} /></View>
  </View>;
}
