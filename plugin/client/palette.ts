/**
 * The command palette's model (docs/redesign-2026-10.md, "Command palette"): fuzzy matching on titles and keywords,
 * results grouped in a fixed order, and Recent on an empty query.
 */
export type PaletteGroup = 'Recent' | 'Tools' | 'Actions' | 'Hojas' | 'Lienzos' | 'Extensions' | 'Settings';
export const PALETTE_GROUPS: readonly PaletteGroup[] = ['Recent', 'Tools', 'Actions', 'Hojas', 'Lienzos', 'Extensions', 'Settings'];
export type PaletteItem = {
  id: string; group: Exclude<PaletteGroup, 'Recent'>; title: string; subtitle?: string; icon: string; keywords?: string;
  /** Combinations from the shortcut registry, shown as chips. */
  shortcut?: string;
  /** The verb on the right of the footer: Open, Run… */
  verb?: string;
  disabled?: boolean;
  /** `background` is true for ⌘↵: run and keep the palette open. */
  run(background: boolean): void;
};
export type PaletteSection = { group: PaletteGroup; items: PaletteItem[] };

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/**
 * How well `query` matches `text`, or null. Every query character must appear in order. Consecutive characters,
 * the start of a word and the start of the text are worth more; a long gap is worth less.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, ' ').trim(), t = fold(text);
  if (!q) return 0;
  if (t.includes(q)) return 1000 - t.indexOf(q) * 2 + (t.startsWith(q) || t.includes(' ' + q) ? 200 : 0) - t.length * .1;
  let score = 0, from = 0, last = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = t.indexOf(ch, from); if (at < 0) return null;
    const wordStart = at === 0 || /[\s\-_./·:]/.test(t[at - 1]);
    score += at === last + 1 ? 12 : wordStart ? 9 : 1;
    score -= Math.min(6, at - from) * .5;
    last = at; from = at + 1;
  }
  return score - t.length * .1;
}
/** Whole words of `query` found in `text`, in any order: how keywords and subtitles match. */
function wordsScore(query: string, text: string): number | null {
  const words = fold(query).split(/\s+/).filter(Boolean), haystack = fold(text);
  if (!words.length || !words.every(w => haystack.includes(w))) return null;
  return 600 - haystack.length * .1 + (words.every(w => haystack.split(/[\s\-_./·:]+/).some(part => part.startsWith(w))) ? 100 : 0);
}
/**
 * The best score over an item's title, keywords and subtitle. Titles match fuzzily (letters in order, a scattered
 * match must still be good); keywords and subtitles only by the words typed, so long descriptions do not match
 * everything.
 */
export function itemScore(query: string, item: Pick<PaletteItem, 'title' | 'keywords' | 'subtitle'>): number | null {
  const q = fold(query).trim(), raw = fuzzyScore(q, item.title), title = raw !== null && (raw >= 600 || raw >= q.replace(/\s/g, '').length * 2) ? raw + 20 : null;
  const keywords = item.keywords ? wordsScore(q, item.keywords) : null, subtitle = item.subtitle ? wordsScore(q, item.subtitle) : null;
  const best = Math.max(title ?? -Infinity, keywords ?? -Infinity, subtitle === null ? -Infinity : subtitle - 100);
  return Number.isFinite(best) ? best : null;
}
/**
 * The sections the palette shows. Without a query: Recent first, then every group. With one: matches by score in
 * each group, at most `perGroup`.
 */
export function paletteSections(items: readonly PaletteItem[], query: string, recent: readonly string[] = [], perGroup = 6): PaletteSection[] {
  const q = query.trim(), out: PaletteSection[] = [];
  if (!q) {
    const recentItems = recent.map(id => items.find(i => i.id === id)).filter((i): i is PaletteItem => !!i);
    if (recentItems.length) out.push({ group: 'Recent', items: recentItems });
    for (const group of PALETTE_GROUPS) {
      if (group === 'Recent') continue;
      const list = items.filter(i => i.group === group && !recentItems.includes(i));
      if (list.length) out.push({ group, items: list });
    }
    return out;
  }
  for (const group of PALETTE_GROUPS) {
    if (group === 'Recent') continue;
    const scored = items.filter(i => i.group === group).map(item => ({ item, score: itemScore(q, item) })).filter((e): e is { item: PaletteItem; score: number } => e.score !== null).sort((a, b) => b.score - a.score).slice(0, perGroup);
    if (scored.length) out.push({ group, items: scored.map(e => e.item) });
  }
  return out;
}
/** Remember what was run, most recent first, without duplicates. */
export function remember(recent: readonly string[], id: string, max = 6): string[] { return [id, ...recent.filter(x => x !== id)].slice(0, max); }
/** The flat order the arrow keys walk. */
export function flatten(sections: readonly PaletteSection[]): PaletteItem[] { return sections.flatMap(s => s.items); }
