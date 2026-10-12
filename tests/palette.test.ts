import test from 'node:test';
import assert from 'node:assert/strict';
import { flatten, fuzzyScore, itemScore, paletteSections, remember, type PaletteItem } from '../plugin/client/palette';

const item = (id: string, group: PaletteItem['group'], title: string, keywords?: string): PaletteItem => ({ id, group, title, keywords, icon: 'Dot', run() {} });
const items = [item('pencil', 'Tools', 'Pencil', 'draw freehand'), item('rect', 'Tools', 'Rectangle', 'shape box'), item('marco', 'Tools', 'Marco', 'frame group container'), item('dup', 'Actions', 'Duplicate'), item('doc', 'Lienzos', 'Árbol de clases'), item('keys', 'Settings', 'Keyboard shortcuts'), item('ask', 'Ask the agent', 'Ask the agent: pen')];
test('fuzzy matching needs every character in order and prefers word starts and runs', () => {
  assert.equal(fuzzyScore('pcl', 'Pencil') !== null, true);
  assert.equal(fuzzyScore('lcp', 'Pencil'), null);
  assert.ok(fuzzyScore('pen', 'Pencil')! > fuzzyScore('pen', 'Open canvas')!);
  assert.ok(fuzzyScore('fs', 'Fit selection')! > fuzzyScore('fs', 'Office stuff')!);
  assert.notEqual(fuzzyScore('arbol', 'Árbol de clases'), null, 'accents do not matter');
});
test('keywords match too', () => { assert.notEqual(itemScore('frame', items[2]), null); assert.equal(itemScore('zzz', items[2]), null); });
test('an empty query shows Recent first, then the groups, without Ask', () => {
  const sections = paletteSections(items, '', ['dup', 'gone']);
  assert.deepEqual(sections.map(s => s.group), ['Recent', 'Tools', 'Lienzos', 'Settings']);
  assert.deepEqual(sections[0].items.map(i => i.id), ['dup']);
  assert.equal(flatten(sections).filter(i => i.id === 'dup').length, 1, 'a recent item is not repeated');
});
test('a query groups matches in order and always ends with Ask the agent', () => {
  const sections = paletteSections(items, 'pen', []);
  assert.deepEqual(sections.map(s => s.group), ['Tools', 'Ask the agent']);
  assert.equal(sections[0].items[0].id, 'pencil');
  assert.deepEqual(paletteSections(items, 'xyzq').map(s => s.group), ['Ask the agent']);
});
test('recent keeps the latest first without duplicates', () => { assert.deepEqual(remember(['a', 'b', 'c'], 'b', 3), ['b', 'a', 'c']); });
test('long descriptions do not match everything: subtitles and keywords match by whole words', () => {
  const flow = item('flow', 'Tools', 'Animated flow', 'timeline links nodes'); flow.subtitle = 'Time and cause travelling along the real links of the Lienzo.';
  assert.equal(itemScore('cart', flow), null, 'c-a-r-t is scattered through the subtitle but matches no word');
  assert.notEqual(itemScore('timeline', flow), null);
  assert.notEqual(itemScore('real links', flow), null);
});
