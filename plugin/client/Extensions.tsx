import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { EXTENSION_API, EXTENSION_FORBIDDEN_OPERATIONS, EXTENSION_LIMITS, extensionDocument, extensionEvent } from '../shared/extensions';
import type { CanvasOperation, CatalogExtension, ExtensionPermission } from '../shared/model';
import { isDark } from './color';
import { layoutCanvas, newId } from './logic';
import { Button, IconButton, Txt, useUI } from './ui';
import type { CanvasController } from './useCanvas';
import { WebExtension, type ExtensionCall } from './web';

const PERMISSION: Record<ExtensionPermission, string> = { edit: 'cambiar el lienzo', agent: 'pedirle cosas al asistente', network: 'cargar cosas de internet' };
export const extensionIcon = (extension: CatalogExtension) => extension.icon ?? (extension.kind === 'view' ? 'LayoutDashboard' : 'Puzzle');
const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;

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
  const need = (permission: ExtensionPermission) => { if (!allowed.includes(permission)) throw new Error(extension.permissions.includes(permission) ? 'Esta extensión todavía no tiene permiso: hay que permitírselo en el lienzo.' : `La extensión no declaró el permiso «${permission}».`); };
  const onCall = async ({ method, args }: ExtensionCall): Promise<unknown> => {
    if (method === 'select') { const ids = (Array.isArray(args.ids) ? args.ids : []).filter(known).slice(0, EXTENSION_LIMITS.selection); await c.select([...new Set(ids)]); return { ids }; }
    if (method === 'open') { if (!known(args.id)) throw new Error('Eso no está en el lienzo.'); onOpen(args.id); return null; }
    if (method === 'close') { onClose?.(); return null; }
    if (method === 'edit') {
      need('edit'); const operations = args.operations;
      if (!Array.isArray(operations) || !operations.length || operations.length > EXTENSION_LIMITS.operations) throw new Error(`Se esperaban de 1 a ${EXTENSION_LIMITS.operations} operaciones.`);
      if (operations.some(o => !o || typeof o !== 'object' || (EXTENSION_FORBIDDEN_OPERATIONS as readonly string[]).includes((o as { type?: string }).type ?? ''))) throw new Error('Una extensión no puede cambiar la selección guardada ni las instrucciones del asistente con edit.');
      if (c.offline) throw new Error('Sin conexión con Paseo.');
      const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, 200) : extension.name, next = await c.edit(operations as CanvasOperation[], `${extension.name}: ${label}`.slice(0, 300));
      if (!next) throw new Error(c.failure?.message ?? 'El lienzo rechazó el cambio.'); return { revision: next.document.revision };
    }
    if (method === 'ask') {
      need('agent'); const event = extensionEvent(args.kind, args.payload); if (!event) throw new Error(`El pedido necesita un nombre corto y datos JSON de hasta ${EXTENSION_LIMITS.payload} caracteres.`);
      const targetIds = (Array.isArray(args.targetIds) ? args.targetIds : []).filter(known).slice(0, 20), label = typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, 240) : `${extension.name}: ${event.kind}`;
      const result = await c.send({ kind: 'extension.event', label, payload: { extension: extension.id, event: event.kind, data: event.payload as never }, targetIds, delivery: 'immediate' }, newId('evt'));
      if (!result || result.status === 'failed') throw new Error(result?.error ?? 'No se envió.'); return { status: result.status };
    }
    throw new Error(`lienzo.${method} no existe en la API ${EXTENSION_API}.`);
  };
  if (u.layout.platform !== 'web') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}><Txt kind="small" muted>Las extensiones se ejecutan en la versión web o de escritorio.</Txt></View>;
  return <WebExtension id={extension.id} source={source} title={extension.name} surface={u.c.surface0} context={context} revision={`${doc.id}:${doc.revision}:${c.selection.join()}:${u.c.surface0}:${allowed.join()}`} onCall={onCall} />;
}
/** An imported extension asks before it does more than read: what it wants, in words, and one press to allow it. */
function Grant({ extension, controller: c }: { extension: CatalogExtension; controller: CanvasController }) {
  const u = useUI(), [error, setError] = useState('');
  if (extension.granted || !extension.permissions.length) return null;
  const allow = () => { setError(''); void c.task(async () => { const catalog = await c.api.catalog({}); c.setCatalog(await c.api.catalogMutate({ expectedRevision: catalog.revision, action: { type: 'extension.grant', id: extension.id, granted: true } })); }).catch(() => setError('No se pudo guardar el permiso.')); };
  return <View nativeID={`lienzo-extension-grant-${extension.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: u.c.border, backgroundColor: u.wash('aviso') }}>
    <Txt kind="small" style={{ flex: 1 }}>Vino en la colección «{extension.source}» y pide {list(extension.permissions.map(p => PERMISSION[p]))}. Sin tu permiso solo puede leer y seleccionar.{error ? ` ${error}` : ''}</Txt>
    <Button label="Permitir" small variant="primary" onPress={allow} />
  </View>;
}
/** A view made by the person or their assistant, in the same place and under the same kind of heading as the shipped ones. */
export function ExtensionView({ extension, controller, onOpen }: { extension: CatalogExtension; controller: CanvasController; onOpen(id: string): void }) {
  const u = useUI();
  return <View nativeID={`lienzo-extension-view-${extension.id}`} style={{ flex: 1, backgroundColor: u.c.surface0 }}>
    <View style={{ paddingLeft: u.compact ? 16 : 20, paddingRight: 16, paddingTop: u.compact ? 12 : 64, paddingBottom: 10, gap: 2 }}><Txt kind="heading">{extension.name}</Txt>{!!extension.description && <Txt kind="small" muted numberOfLines={2} style={{ maxWidth: 560 }}>{extension.description}</Txt>}</View>
    <Grant extension={extension} controller={controller} />
    <View style={{ flex: 1, minHeight: 0 }}><ExtensionFrame extension={extension} controller={controller} onOpen={onOpen} /></View>
  </View>;
}
/** A tool made by the person or their assistant: a floating panel over whatever view is open, working on the shared selection. */
export function ExtensionTool({ extension, controller, onOpen, onClose, left, top, maxHeight }: { extension: CatalogExtension; controller: CanvasController; onOpen(id: string): void; onClose(): void; left: number; top: number; maxHeight: number }) {
  const u = useUI();
  return <View nativeID={`lienzo-extension-tool-${extension.id}`} style={{ position: 'absolute', left, top, width: 320, height: Math.min(440, maxHeight), zIndex: 30, borderRadius: 12, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, overflow: 'hidden' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 4, minHeight: 40, borderBottomWidth: 1, borderColor: u.c.border }}><Txt kind="small" numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>{extension.name}</Txt><IconButton icon="X" label={`Cerrar ${extension.name}`} onPress={onClose} /></View>
    <Grant extension={extension} controller={controller} />
    <View style={{ flex: 1, minHeight: 0 }}><ExtensionFrame extension={extension} controller={controller} onOpen={onOpen} onClose={onClose} /></View>
  </View>;
}
