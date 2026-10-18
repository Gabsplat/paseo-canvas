import type { CanvasGroup } from '../shared/model';
import type { Point, Rect } from './logic';

export type Sheet = { id: string; number: number; title: string };

/** The Sheets of a document in reading order: top-level Frames that carry a sheet number. */
export function hojasOf(groups: readonly CanvasGroup[]): Sheet[] {
  return groups.filter(g => g.sheet && !g.parentGroupId).map(g => ({ id: g.id, number: g.sheet!.number, title: g.title || `Sheet ${g.sheet!.number}` })).sort((a, b) => a.number - b.number);
}
/** The Sheet the camera is looking at: the one that holds the centre of the view, else the nearest along the strip. */
export function currentHoja(hojas: readonly Sheet[], rects: Map<string, Rect>, center: Point): number {
  let best = -1, distance = Infinity;
  hojas.forEach((h, i) => {
    const r = rects.get(h.id); if (!r || r.hidden) return;
    const dx = center.x < r.x ? r.x - center.x : center.x > r.x + r.width ? center.x - r.x - r.width : 0, dy = center.y < r.y ? r.y - center.y : center.y > r.y + r.height ? center.y - r.y - r.height : 0, d = Math.hypot(dx, dy);
    if (d < distance) { distance = d; best = i; }
  });
  return best;
}

