import { tokens } from './tokens';
import type { BlockType, CanvasBlock, CanvasDocument, CanvasGroup, CanvasOperation, CanvasCatalog } from '../shared/model';
import { anchorCard, containerMode, freezeOperations, manual, topSelection, type Rect, type Camera } from './logic';
import { getRendererSpec } from '../shared/renderers';
export type Entity = CanvasBlock | CanvasGroup;
export const layoutIcons = { graph: 'Workflow', stack: 'Rows3', grid: 'Grid2x2', flow: 'ArrowRightFromLine', free: 'Move', rows: 'Rows3' } as const;
export const inlineKeys = (renderer?: string): string[] => ({ note: ['text'], text: ['text'], callout: ['text'], step: ['text'], node: ['summary', 'details'], code: ['code'], checklist: ['items'], quiz: ['question', 'options'], metric: ['value', 'label'], 'image-ref': ['caption'], 'preview-frame': ['description'] }[renderer ?? ''] ?? []);
export function dataProperties(type: BlockType | undefined, compact = false) { return type?.properties.filter(p => compact || !inlineKeys(type.renderer).includes(p.key)) ?? []; }
export function typeSlot(type?: BlockType): { label: string; icon: string; kind: 'url' | 'language' | 'status' | 'reset' | 'data' } | undefined {
  if (!type) return { label: 'Datos', icon: 'SlidersHorizontal', kind: 'data' };
  if (['preview-frame', 'image-ref'].includes(type.renderer ?? '')) return { label: 'Cambiar enlace', icon: 'Link', kind: 'url' };
  if (type.renderer === 'code') return { label: 'Lenguaje', icon: 'Code', kind: 'language' };
  if (type.renderer === 'node') return { label: 'Estado', icon: 'CircleDot', kind: 'status' };
  if (getRendererSpec(type.renderer)?.interactive && !type.renderer?.startsWith('wb-')) return { label: 'Reiniciar', icon: 'RotateCcw', kind: 'reset' };
  if (dataProperties(type).length) return { label: 'Datos', icon: 'SlidersHorizontal', kind: 'data' };
}
export function communicationOperation(doc: CanvasDocument, id: string | null, patch: Partial<CanvasDocument['communication']>): CanvasOperation {
  const entity = id ? [...doc.blocks, ...doc.groups].find(e => e.id === id) : undefined;
  if (id && !entity) throw new Error('El bloque cambió. Vuelve a seleccionarlo.');
  const communication = { instructions: '', intent: '', audience: '', ...(entity?.communication ?? (!id ? doc.communication : undefined)), ...patch };
  return entity ? { type: 'groupIds' in entity ? 'group.update' : 'block.update', id: entity.id, patch: { communication } } as CanvasOperation : { type: 'communication.set', communication };
}
export function layoutOperations(doc: CanvasDocument, groupId: string | null, next: NonNullable<CanvasGroup['layout']>, rects: Map<string, Rect>, catalog?: CanvasCatalog | null): CanvasOperation[] {
  const group = groupId ? doc.groups.find(g => g.id === groupId) : undefined;
  if (groupId && !group) return [];
  const frozen = next.mode === 'free' && !manual(containerMode(doc, groupId, catalog)) ? freezeOperations(doc, rects, groupId) : [];
  if (frozen.length > 199) throw new Error('El cambio supera las 200 operaciones de una transacción.');
  return [...frozen, group ? { type: 'group.update', id: group.id, patch: { layout: next } } : { type: 'document.update', layout: next }];
}
/** Leave the parent without changing the drawn world position, including nested group frames. */
export function leaveGroupOperations(doc: CanvasDocument, ids: string[], rects: Map<string, Rect>, catalog?: CanvasCatalog | null): CanvasOperation[] {
  const items = topSelection(doc, ids);
  if (!items.length || !items[0].parentGroupId || !items.every(e => e.parentGroupId === items[0].parentGroupId)) return [];
  const parent = doc.groups.find(g => g.id === items[0].parentGroupId), to = parent?.parentGroupId ?? null, origin = to ? rects.get(to) : undefined;
  if (items.length > 200) throw new Error('El cambio supera las 200 operaciones de una transacción.');
  const moving = new Set(items.map(item => item.id)), operations: CanvasOperation[] = [];
  for (const item of items) {
    const rect = rects.get(item.id); if (!rect) continue;
    const card = 'typeId' in item ? anchorCard(doc, item, catalog) : undefined;
    if (card && moving.has(card.id)) continue;
    // The card carries its annotation. Leaving on its own detaches the layer before moving it.
    if (card) operations.push({ type: 'block.update', id: item.id, patch: { data: { anchor: null } } });
    operations.push({ type: 'entity.move', id: item.id, parentGroupId: to, position: { x: rect.x - (origin?.x ?? 0), y: rect.y - (origin?.y ?? 0) } });
  }
  if (operations.length > 200) throw new Error('El cambio supera las 200 operaciones de una transacción.');
  return operations;
}
export function reorderOperation(doc: CanvasDocument, id: string, direction: number): CanvasOperation[] {
  const entity = [...doc.blocks, ...doc.groups].find(e => e.id === id), parent = doc.groups.find(g => g.id === entity?.parentGroupId);
  if (!entity || !parent) return [];
  const key = 'typeId' in entity ? 'blockIds' : 'groupIds', ids = [...parent[key]], index = ids.indexOf(id), to = index + direction;
  if (index < 0 || to < 0 || to >= ids.length) return [];
  [ids[index], ids[to]] = [ids[to], ids[index]];
  return [{ type: 'group.update', id: parent.id, patch: { [key]: ids } }];
}
export function panelShortcut(key: string, command: boolean, shift: boolean, count: number, group: boolean, disabled: boolean): 'ask' | 'duplicate' | 'group' | 'ungroup' | 'connect' | undefined {
  if (!command && !shift && key.toLowerCase() === 'a' && count) return 'ask';
  if (disabled) return;
  if (command && !shift && key.toLowerCase() === 'd' && count) return 'duplicate';
  if (command && key.toLowerCase() === 'g') return shift ? group ? 'ungroup' : undefined : count ? 'group' : undefined;
  if (!command && !shift && key.toLowerCase() === 'l' && count === 2) return 'connect';
}

export function toolbarPosition(camera: Camera, box: Pick<Rect, 'x' | 'y' | 'width' | 'height'>, viewport: { width: number; height: number }, width: number, link = false, pointer?: { x: number; y: number } | null) {
  const clamp = tokens.toolbar.clamp, safeTop = 68;
  const left = Math.max(clamp, Math.min(viewport.width - width - clamp, camera.offset.x + camera.scale * (box.x + box.width / 2) - width / 2));
  const above = camera.offset.y + camera.scale * box.y - tokens.toolbar.height - (link ? tokens.toolbar.offsetLink : tokens.toolbar.offset);
  const below = camera.offset.y + camera.scale * (box.y + box.height) + tokens.toolbar.offset;
  const oversized = box.height * camera.scale > viewport.height - safeTop;
  let top = Math.max(safeTop, Math.min(viewport.height - tokens.toolbar.height - clamp, oversized ? safeTop + tokens.toolbar.offset : above < safeTop ? below : above));
  if (pointer && pointer.x >= left && pointer.x <= left + width && pointer.y >= top && pointer.y <= top + tokens.toolbar.height) top = Math.max(safeTop, Math.min(viewport.height - tokens.toolbar.height - clamp, Math.abs(top - above) < 1 ? below : above));
  return { left, top };
}
