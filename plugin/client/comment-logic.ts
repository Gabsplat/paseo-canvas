import type { CommentAuthor, CommentThread } from '../shared/comments';
import type { Point, Rect } from './logic';

/** The pure parts of comments on the canvas (Comments.tsx), kept apart so they are tested without a renderer. */
export type CommentFilter = 'open' | 'resolved';
export function relativeTime(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} h ago` : minutes < 10080 ? `${Math.floor(minutes / 1440)} d ago` : new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
export const authorName = (author: CommentAuthor) => author.kind === 'agent' ? author.label : 'You';
/** Threads a pin shows: open ones; resolved ones only while the list shows resolved, or the one that is open. */
export function visibleThreads(threads: readonly CommentThread[], options: { pins: boolean; filter: CommentFilter; listOpen: boolean; openId?: string }) {
  return threads.filter(t => t.id === options.openId || options.pins && (t.status === 'open' || options.listOpen && options.filter === 'resolved'));
}
/** The thing a press with the Comment tool lands on: the smallest block under it, else the innermost Frame, else the spot. */
export function commentTarget(point: Point, rects: ReadonlyMap<string, Rect>, groups: ReadonlySet<string>): { kind: 'block' | 'group'; id: string } | null {
  let best: { kind: 'block' | 'group'; id: string; area: number; depth: number } | null = null;
  for (const [id, r] of rects) {
    if (r.hidden || point.x < r.x || point.y < r.y || point.x > r.x + r.width || point.y > r.y + r.height) continue;
    const kind = groups.has(id) ? 'group' : 'block', area = r.width * r.height;
    const better = !best ? true : (kind === 'block') !== (best.kind === 'block') ? kind === 'block' : kind === 'block' ? area < best.area : r.depth > best.depth || r.depth === best.depth && area < best.area;
    if (better) best = { kind, id, area, depth: r.depth };
  }
  return best && { kind: best.kind, id: best.id };
}

