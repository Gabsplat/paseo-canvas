import type { CanvasDocument, CanvasGroup, CanvasSheet } from "../shared/model";

/**
 * Sheets are chapters on one horizontal strip. The server does not measure what the client draws, so placement uses
 * a conservative estimate of each Sheet's width: explicit child positions when there are any, otherwise a grid guess
 * from how many things it holds. The client may tidy positions later; numbers and order never depend on them.
 */
export const SHEET_GAP = 320;
export const SHEET_MIN_WIDTH = 1200;
const BLOCK_WIDTH = 320, CELL = 380;

export type SheetSummary = { id: string; number: number; title: string; description: string; createdAt: string; source: CanvasSheet["source"]; position: { x: number; y: number }; blockCount: number; groupCount: number };

export const sheetsOf = (document: Pick<CanvasDocument, "groups">) =>
  document.groups.filter((group): group is CanvasGroup & { sheet: CanvasSheet } => !!group.sheet).sort((a, b) => a.sheet.number - b.sheet.number);

/** Right edge of an entity, relative to its own origin. */
function width(document: Pick<CanvasDocument, "blocks" | "groups">, id: string, depth = 0): number {
  const block = document.blocks.find(block => block.id === id);
  if (block) return block.size?.width ?? BLOCK_WIDTH;
  const group = document.groups.find(group => group.id === id);
  if (!group || depth > 6) return BLOCK_WIDTH;
  const children = [...group.blockIds, ...group.groupIds];
  if (!children.length) return BLOCK_WIDTH;
  const placed = children.map(child => [...document.blocks, ...document.groups].find(entity => entity.id === child)!).filter(entity => entity?.position);
  const explicit = placed.length ? Math.max(...placed.map(entity => entity.position!.x + width(document, entity.id, depth + 1))) : 0;
  const unplaced = children.length - placed.length;
  const columns = group.layout?.direction === "right" || group.layout?.mode === "graph" && group.layout.direction !== "down" ? unplaced : Math.ceil(Math.sqrt(unplaced));
  const guessed = unplaced ? columns * CELL : 0;
  return Math.max(BLOCK_WIDTH, explicit, guessed) + 48;
}

/** Where the next Sheet goes: right of the last Sheet on its strip, or right of whatever is already on the canvas. */
export function nextSheetPlacement(document: Pick<CanvasDocument, "blocks" | "groups">): { number: number; position: { x: number; y: number } } {
  const sheets = sheetsOf(document);
  const number = sheets.length ? Math.max(...sheets.map(sheet => sheet.sheet.number)) + 1 : 1;
  const last = sheets.at(-1);
  if (last) {
    const origin = last.position ?? { x: 0, y: 0 };
    return { number, position: { x: Math.round(origin.x + Math.max(SHEET_MIN_WIDTH, width(document, last.id)) + SHEET_GAP), y: origin.y } };
  }
  const roots = [...document.blocks, ...document.groups].filter(entity => !entity.parentGroupId);
  if (!roots.length) return { number, position: { x: 0, y: 0 } };
  const right = Math.max(...roots.map(entity => (entity.position?.x ?? 0) + width(document, entity.id)));
  return { number, position: { x: Math.round(right + SHEET_GAP), y: 0 } };
}

export function sheetSummaries(document: Pick<CanvasDocument, "blocks" | "groups">): SheetSummary[] {
  return sheetsOf(document).map(group => {
    const subtree = new Set<string>(), walk = (id: string) => { const g = document.groups.find(item => item.id === id); if (!g || subtree.has(id)) return; subtree.add(id); g.groupIds.forEach(walk); };
    walk(group.id);
    const groups = document.groups.filter(item => subtree.has(item.id));
    return { id: group.id, number: group.sheet.number, title: group.title, description: group.description, createdAt: group.sheet.createdAt, source: group.sheet.source, position: group.position ?? { x: 0, y: 0 }, blockCount: groups.reduce((sum, item) => sum + item.blockIds.length, 0), groupCount: groups.length - 1 };
  });
}
