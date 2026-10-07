import test from 'node:test';
import assert from 'node:assert/strict';
import { agentView, entityOrder, focusOf, matrixOf, readings, streamOf } from '../plugin/client/view-models';
import type { Change } from '../plugin/client/lenses';

const b = (id: string) => ({ id, title: id.toUpperCase(), typeId: 'node', data: {} });
const doc = { blocks: ['a', 'b', 'c', 'd', 'e', 'x'].map(b), groups: [{ id: 'g1', title: 'Uno', blockIds: ['a', 'b'], groupIds: ['g2'] }, { id: 'g2', title: 'Dentro', blockIds: ['c'], groupIds: [] }, { id: 'g3', title: 'Dos', blockIds: ['d', 'e'], groupIds: [] }],
  links: [{ id: 'f1', from: 'a', to: 'b', kind: 'flow', label: 'pide' }, { id: 'f2', from: 'b', to: 'c', kind: 'flow' }, { id: 'f3', from: 'b', to: 'd', kind: 'flow', label: 'avisa' }, { id: 'd1', from: 'c', to: 'e', kind: 'depends' }, { id: 'd2', from: 'd', to: 'e', kind: 'depends', label: 'lee' }, { id: 'r1', from: 'x', to: 'b', kind: 'reference' }, { id: 'ga', from: 'g1', to: 'g3', kind: 'flow' }, { id: 'bad', from: 'a', to: 'ghost', kind: 'flow' }] } as never;
const change = (revision: number, actor: Change['actor'], changed: string[], kind: Change['kind'] = 'edit'): Change => ({ revision, actor, label: `cambio ${revision}`, at: new Date(Date.UTC(2026, 9, 7, 0, revision)).toISOString(), changed, removed: [], kind });
const event = (id: string, status: string, targetIds: string[], revision: number, minute: number) => ({ id, status, revision, createdAt: new Date(Date.UTC(2026, 9, 7, 0, minute, 30)).toISOString(), action: { kind: 'ask', label: `pedido ${id}`, payload: {}, targetIds, delivery: 'immediate' } }) as never;

test('reading order goes area by area with nested areas in place, then areas that end a link', () => {
  assert.deepEqual(entityOrder(doc).map(e => [e.id, e.area]), [['a', 'Uno'], ['b', 'Uno'], ['c', 'Uno'], ['d', 'Dos'], ['e', 'Dos'], ['x', ''], ['g1', 'Áreas'], ['g3', 'Áreas']]);
});
test('focus sorts the neighbours of one thing by what each link means', () => {
  const f = focusOf(doc, 'b');
  assert.deepEqual([f.before.map(n => n.id), f.after.map(n => [n.id, n.label]), f.mentions.map(n => n.id), f.needs, f.neededBy], [['a'], [['c', ''], ['d', 'avisa']], ['x'], [], []]);
  const e = focusOf(doc, 'e'); assert.deepEqual(e.neededBy.map(n => [n.id, n.label]), [['c', ''], ['d', 'lee']]); assert.deepEqual(focusOf(doc, 'c').needs.map(n => n.id), ['e']);
  assert.deepEqual(focusOf(doc, 'a').after.map(n => n.id), ['b'], 'a link to something that does not exist is ignored');
});
test('readings are the paths the links spell out, bounded and without loops', () => {
  const all = readings(doc);
  assert.deepEqual(all.filter(r => r.kind === 'flow').map(r => r.steps.map(s => s.id).join('>')), ['a>b>c', 'a>b>d', 'g1>g3']);
  assert.deepEqual(all.find(r => r.key === 'flow:a>b>d')!.steps.map(s => s.via), ['', 'pide', 'avisa']);
  assert.deepEqual(all.filter(r => r.kind === 'depends').map(r => r.steps.map(s => s.id).join('>')), ['c>e', 'd>e']);
  const loop = { blocks: ['p', 'q'].map(b), groups: [], links: [{ id: '1', from: 'p', to: 'q', kind: 'flow' }, { id: '2', from: 'q', to: 'p', kind: 'flow' }] } as never;
  assert.deepEqual(readings(loop).map(r => r.steps.map(s => s.id).join('>')), ['p>q']);
  const fan = { blocks: Array.from({ length: 30 }, (_, i) => b(`n${i}`)), groups: [], links: Array.from({ length: 29 }, (_, i) => ({ id: `l${i}`, from: 'n0', to: `n${i + 1}`, kind: 'flow' })) } as never;
  assert.equal(readings(fan, 5).length, 5);
});
test('the matrix puts each link at from-row, to-column and marks the area bands', () => {
  const m = matrixOf(doc), at = (id: string) => m.order.findIndex(e => e.id === id);
  assert.equal(m.cells.length, 7); assert.deepEqual(m.cells.find(c => c.linkId === 'f3'), { row: at('b'), col: at('d'), kind: 'flow', label: 'avisa', linkId: 'f3' });
  assert.deepEqual(m.areas, [{ title: 'Uno', from: 0, to: 3 }, { title: 'Dos', from: 3, to: 5 }, { title: '', from: 5, to: 6 }, { title: 'Áreas', from: 6, to: 8 }]);
});
test('the stream is newest first and pulls out what still waits', () => {
  const s = streamOf(doc, [change(3, 'agent', ['a', 'link-1']), change(5, 'user', ['b'], 'undo')], [event('e1', 'pending', ['c'], 4, 4), event('e2', 'acked', ['zz'], 2, 2)]);
  assert.deepEqual(s.items.map(i => [i.key, i.who, i.what]), [['r5', 'user', 'undo'], ['ee1', 'user', 'request'], ['r3', 'agent', 'change'], ['ee2', 'user', 'request']]);
  assert.deepEqual(s.items.find(i => i.key === 'r3')!.ids, ['a']); assert.deepEqual(s.waiting.map(i => i.key), ['ee1']); assert.deepEqual(s.items.at(-1)!.ids, []);
});
test('what the assistant holds: current where it wrote last or acknowledged since, behind where you changed after', () => {
  const view = agentView(doc, [change(2, 'agent', ['a', 'b']), change(4, 'user', ['b', 'c', 'd']), change(6, 'agent', ['d'])], [event('1', 'acked', ['c'], 5, 5), event('2', 'pending', ['b'], 5, 5), event('3', 'acked', ['e'], 1, 1), event('4', 'acked', ['b'], 3, 3)]);
  assert.deepEqual(Object.fromEntries(view), { a: 'current', b: 'behind', c: 'current', d: 'current', e: 'current', x: 'unknown' });
});
