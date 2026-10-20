import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitText, wrappedLines, estimateLine, clampFontSize, wbTextType, scaleTextBox, resizeWhiteboardBox } from '../plugin/client/whiteboard-geometry';
import { layoutCanvas, textWidthKey } from '../plugin/client/logic';
import { wbTextDataSchema } from '../plugin/shared/whiteboard';
import { reduce } from '../plugin/server/reducer';
import { builtinTypes } from '../plugin/shared/builtins';
const document = () => ({ id: 'text', workspaceId: 'workspace', revision: 0, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', title: 'Text', description: '', example: false, communication: { instructions: '', intent: '', audience: '' }, blocks: [], groups: [], links: [], selectedIds: [] }) as any;

// A monospace stand-in for the browser: every character is 10 px wide.
const mono = (line: string) => line.length * 10;
const type = { fontSize: 18, lineHeight: 26 };

test('free text auto-size: as wide as the longest line, at least the minimum, wrapping past the limit', () => {
  assert.deepEqual(fitText('Hello\nWorld wide', type, mono, { maxWidth: 480, minWidth: 24 }), { width: 100, height: 52, lines: 2 });
  assert.deepEqual(fitText('', type, mono, { maxWidth: 480, minWidth: 24 }), { width: 24, height: 26, lines: 1 }, 'empty: one line at the minimum');
  assert.deepEqual(fitText('a\n\n', type, mono, { maxWidth: 480, minWidth: 24 }).lines, 3, 'blank lines count');
  // 60 characters with spaces past a 200 px limit wrap at word boundaries: 6 words of 9 + space.
  const long = Array.from({ length: 6 }, () => 'abcdefghi').join(' ');
  assert.deepEqual(fitText(long, type, mono, { maxWidth: 200, minWidth: 24 }), { width: 200, height: 78, lines: 3 });
  assert.equal(fitText(long, type, mono, { width: 100, maxWidth: 480, minWidth: 24 }).lines, 6, 'a stored width wraps there');
});

test('wrapping breaks at spaces, a word wider than the line by letters, and trailing spaces hang', () => {
  assert.equal(wrappedLines('one two three', 70, mono), 2);
  assert.equal(wrappedLines('abcdefghijklmnopqrst', 50, mono), 4, 'a long word breaks by letters');
  assert.equal(wrappedLines('abcd   ', 40, mono), 1, 'trailing spaces do not wrap');
  assert.equal(wrappedLines('', 40, mono), 1);
  assert.equal(estimateLine(20)('abcd'), 4 * 20 * .56);
});

test('font size: a stored size wins over the step, keeps the step ratio, and stays within 8–400', () => {
  assert.deepEqual(wbTextType({ scale: 'm' }), { fontSize: 18, lineHeight: 26 });
  assert.deepEqual(wbTextType({ scale: 'm', font: 'mono' }), { fontSize: 17, lineHeight: 26 });
  assert.deepEqual(wbTextType({ scale: 'm', fontSize: 36 }), { fontSize: 36, lineHeight: 52 });
  assert.deepEqual(wbTextType({ scale: 'l', fontSize: 56 }), { fontSize: 56, lineHeight: 72 });
  assert.equal(clampFontSize(2), 8);assert.equal(clampFontSize(9000), 400);assert.equal(clampFontSize(17.26), 17.3);
  assert.equal(wbTextDataSchema.safeParse({ text: 'x', fontSize: 7 }).success, false);
  assert.equal(wbTextDataSchema.safeParse({ text: 'x', fontSize: 401 }).success, false);
  assert.equal(wbTextDataSchema.parse({ text: 'x', fontSize: 36 }).fontSize, 36);
});

test('a corner drag scales free text by one factor; the opposite corner or the centre stays; nothing rewraps', () => {
  const start = { x: 100, y: 200, width: 80, height: 26 };
  const se = resizeWhiteboardBox(start, { x: 80, y: 0 }, 'se', { width: 24, height: 8 }, true);
  const twice = scaleTextBox(start, se, 'se', type, { maxWidth: 480 });
  assert.deepEqual({ ...twice }, { x: 100, y: 200, width: 160, height: 52, fontSize: 36, factor: 2 });
  const nw = scaleTextBox(start, { width: 160, height: 52 }, 'nw', type, { maxWidth: 480 });
  assert.deepEqual([nw.x, nw.y], [20, 174], 'the south-east corner stays');
  const centre = scaleTextBox(start, { width: 160, height: 52 }, 'se', type, { maxWidth: 480 }, true);
  assert.deepEqual([centre.x, centre.y], [60, 187], 'Alt: the centre stays');
  // Held at 400 px: the box takes the factor the font could take.
  const huge = scaleTextBox(start, { width: 8000, height: 2600 }, 'se', type, { maxWidth: 480 });
  assert.equal(huge.fontSize, 400);assert.equal(huge.width, Math.ceil(80 * 400 / 18) + 1, 'past the auto limit: a wrap width');assert.ok(Math.abs(huge.height - 26 * 400 / 18) < 1e-9);
  // A stored wrap scales (with a px of slack); an auto text past the limit, or already wrapping, keeps its width as a wrap.
  assert.equal(scaleTextBox({ ...start, width: 200 }, { width: 400, height: 52 }, 'se', type, { wrap: 200, maxWidth: 480 }).wrap, 401);
  assert.equal(scaleTextBox({ ...start, width: 300 }, { width: 600, height: 52 }, 'se', type, { maxWidth: 480 }).wrap, 601);
  assert.equal(scaleTextBox({ ...start, width: 480 }, { width: 240, height: 13 }, 'se', type, { maxWidth: 480 }).wrap, 241);
  assert.equal(twice.wrap, undefined, 'a short auto text stays auto');
});

test('layout keeps free text at its measured box, and scaled text estimates at its own size', () => {
  const catalog = { revision: 0, blockTypes: builtinTypes, packs: [] } as any;
  let doc = document();
  doc = reduce(doc, [{ type: 'block.create', block: { id: 't', typeId: 'wb-text', title: '', position: { x: 0, y: 0 }, data: { text: 'Hello there' } } },
    { type: 'block.create', block: { id: 'big', typeId: 'wb-text', title: '', position: { x: 0, y: 100 }, data: { text: 'Hello there', fontSize: 36 } } }], catalog);
  const guessed = layoutCanvas(doc, {}, catalog).rects;
  assert.ok(Math.abs(guessed.get('big')!.width - 2 * guessed.get('t')!.width) <= 2, 'twice the size, about twice as wide');
  assert.equal(guessed.get('big')!.height, 52);
  const measured = layoutCanvas(doc, { t: 30, [textWidthKey('t')]: 91.5 }, catalog).rects.get('t')!;
  assert.deepEqual([measured.width, measured.height], [91.5, 30]);
});
