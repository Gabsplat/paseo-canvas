import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHORTCUTS, ShortcutRegistry, applies, comboParts, eventCombo, formatCombo, normalizeCombo, resolveShortcuts } from '../plugin/client/shortcuts';

const owner = (overrides = {}, defs = DEFAULT_SHORTCUTS) => resolveShortcuts(defs, overrides).byCombo;
test('combinations have one spelling', () => {
  assert.equal(normalizeCombo('Shift+Cmd+Z'), 'mod+shift+z');
  assert.equal(normalizeCombo('ctrl+K'), 'mod+k');
  assert.equal(normalizeCombo('Esc'), 'escape');
  assert.equal(normalizeCombo('mod++'), 'mod++');
  assert.equal(normalizeCombo('?'), '?');
});
test('a key press spells the same combination on any layout', () => {
  assert.equal(eventCombo({ key: '!', code: 'Digit1', shift: true, command: false }), 'shift+1');
  assert.equal(eventCombo({ key: '?', code: 'Slash', shift: true, command: false }), '?');
  assert.equal(eventCombo({ key: 'K', code: 'KeyK', shift: false, command: true }), 'mod+k');
  assert.equal(eventCombo({ key: 'Z', code: 'KeyZ', shift: true, command: true }), 'mod+shift+z');
  assert.equal(eventCombo({ key: '\\', code: 'Backslash', shift: false, command: true }), 'mod+\\');
  assert.equal(eventCombo({ key: 'Delete', shift: false, command: false }), 'delete');
  assert.equal(eventCombo({ key: 'Shift', shift: true, command: false }), null);
});
test('the defaults from the brief are all assigned with no conflict', () => {
  const { list, byCombo } = resolveShortcuts(DEFAULT_SHORTCUTS);
  assert.deepEqual(list.filter(s => s.unassigned).map(s => s.id), []);
  for (const [combo, id] of [['v', 'tool.select'], ['h', 'tool.hand'], ['p', 'tool.pencil'], ['r', 'tool.rectangle'], ['o', 'tool.ellipse'], ['t', 'tool.text'], ['a', 'tool.arrow'], ['e', 'tool.eraser'], ['m', 'tool.marco'], ['w', 'tool.ventana'], ['l', 'lens.cycle'], ['mod+k', 'palette.open'], ['[', 'hoja.previous'], [']', 'hoja.next'], ['mod+j', 'hoja.jump'], ['f', 'agent.follow'], ['g', 'agent.latest'], ['shift+1', 'view.fitAll'], ['shift+2', 'view.fitSelection'], ['mod+\\', 'panel.right'], ['mod+.', 'ui.hide'], ['?', 'help.shortcuts'], ['mod+z', 'edit.undo'], ['mod+shift+z', 'edit.redo'], ['mod+d', 'edit.duplicate'], ['mod+g', 'edit.wrap'], ['delete', 'edit.delete'], ['backspace', 'edit.delete'], ['escape', 'edit.escape'], ['mod+a', 'edit.selectAll'], ['1', 'pinned.1'], ['9', 'pinned.9']] as const) assert.equal(byCombo.get(combo), id, combo);
  assert.ok(['hoja.previous', 'hoja.next', 'hoja.jump', 'agent.follow', 'agent.latest'].every(id => list.some(s => s.id === id)), 'Sheet and agent shortcuts are registered');
});
test('an override wins and the shortcut it displaces is listed as unassigned', () => {
  const { list, byCombo } = resolveShortcuts(DEFAULT_SHORTCUTS, { 'tool.text': 'P' });
  assert.equal(byCombo.get('p'), 'tool.text');
  assert.equal(byCombo.get('t'), undefined, 'the old key is free again');
  const pencil = list.find(s => s.id === 'tool.pencil')!;
  assert.equal(pencil.unassigned, true); assert.equal(pencil.conflictWith, 'tool.text');
  assert.equal(list.find(s => s.id === 'tool.text')!.overridden, true);
});
test('an empty override clears a shortcut; fixed shortcuts cannot be reassigned', () => {
  const { list, byCombo } = resolveShortcuts(DEFAULT_SHORTCUTS, { 'tool.hand': '', 'edit.escape': 'q' });
  assert.equal(byCombo.get('h'), undefined); assert.equal(list.find(s => s.id === 'tool.hand')!.unassigned, true);
  assert.equal(list.find(s => s.id === 'tool.hand')!.conflictWith, undefined);
  assert.equal(byCombo.get('escape'), 'edit.escape'); assert.equal(byCombo.get('q'), undefined);
});
test('extensions register through the same registry and lose conflicts', () => {
  const registry = new ShortcutRegistry(); let changes = 0; registry.subscribe(() => changes++);
  const remove = registry.register([{ id: 'ext.stamp', label: 'Stamp', group: 'Extensions', keys: ['p'], source: 'stamp' }, { id: 'ext.free', label: 'Free', group: 'Extensions', keys: ['alt+q'], source: 'stamp' }]);
  const { list, byCombo } = registry.resolve();
  assert.equal(byCombo.get('p'), 'tool.pencil'); assert.equal(byCombo.get('alt+q'), 'ext.free');
  assert.equal(list.find(s => s.id === 'ext.stamp')!.conflictWith, 'tool.pencil');
  assert.equal(registry.resolve({ 'ext.stamp': 'alt+p' }).byCombo.get('alt+p'), 'ext.stamp', 'the person can give it a free key');
  remove(); assert.equal(registry.all().some(s => s.id === 'ext.stamp'), false); assert.equal(changes, 2);
});
test('shortcuts display per platform and apply only when they can', () => {
  assert.deepEqual(comboParts('mod+shift+z', true), ['⌘', '⇧', 'Z']);
  assert.equal(formatCombo('mod+k', false), 'Ctrl+K'); assert.equal(formatCombo('mod+k', true), '⌘K'); assert.equal(formatCombo('shift+1', true), '⇧1');
  assert.equal(applies('selection', { document: true, canvas: true, selection: false }), false);
  assert.equal(applies('always', { document: false, canvas: false, selection: false }), true);
});
test('Sheets are read in number order and the one in view is the nearest to the centre', async () => {
  const { hojasOf, currentHoja } = await import('../plugin/client/hojas-model');
  const g = (id: string, number?: number, parentGroupId?: string) => ({ id, title: id, description: '', blockIds: [], groupIds: [], ...(number ? { sheet: { number, createdAt: '2026-10-12T00:00:00.000Z', source: 'agent' as const } } : {}), ...(parentGroupId ? { parentGroupId } : {}) });
  const hojas = hojasOf([g('b', 2), g('plain'), g('a', 1), g('nested', 3, 'a')] as never);
  assert.deepEqual(hojas.map(h => [h.id, h.number]), [['a', 1], ['b', 2]]);
  const rects = new Map([['a', { x: 0, y: 0, width: 400, height: 300 }], ['b', { x: 600, y: 0, width: 400, height: 300 }]]) as never;
  assert.equal(currentHoja(hojas, rects, { x: 100, y: 100 }), 0); assert.equal(currentHoja(hojas, rects, { x: 560, y: 100 }), 1); assert.equal(currentHoja(hojas, rects, { x: 2000, y: 100 }), 1);
  assert.equal(currentHoja([], rects, { x: 0, y: 0 }), -1);
});
