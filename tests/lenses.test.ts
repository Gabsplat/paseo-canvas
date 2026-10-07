import test from 'node:test';
import assert from 'node:assert/strict';
import { arcPath, biographies, lensMarks, ringModel, type Change } from '../plugin/client/lenses';

const change = (revision: number, actor: Change['actor'], changed: string[], kind: Change['kind'] = 'edit', removed: string[] = []): Change => ({ revision, actor, label: `r${revision}`, at: '2026-10-07T00:00:00.000Z', changed, removed, kind });
const doc = { revision: 20, blocks: ['a', 'b', 'c', 'd', 'loose'].map(id => ({ id, title: id.toUpperCase() })), groups: [{ id: 'g1', title: 'Uno', blockIds: ['a', 'b'], groupIds: ['g2'] }, { id: 'g2', title: 'Dentro', blockIds: ['c'], groupIds: [] }, { id: 'g3', title: 'Dos', blockIds: ['d'], groupIds: [] }] } as never;
const history = [change(18, 'agent', ['a', 'link-1']), change(5, 'user', ['a', 'b']), change(19, 'user', ['b'], 'undo'), change(20, 'system', ['d'], 'edit', ['gone'])];
const event = (status: string, targetIds: string[]) => ({ status, action: { kind: 'x', label: 'x', payload: {}, targetIds, delivery: 'immediate' } }) as never;

test('biographies read each entity from the stored changes in revision order', () => {
  const lives = biographies(history);
  assert.deepEqual(lives.get('a'), { first: 5, last: 18, lastActor: 'agent', edits: 2, byUser: 1, byAgent: 1 });
  assert.deepEqual(lives.get('b'), { first: 5, last: 19, lastActor: 'user', edits: 2, byUser: 2, byAgent: 0 });
  assert.equal(lives.get('d')!.lastActor, 'user', 'a system change is not the assistant'); assert.equal(lives.has('c'), false);
});
test('lenses tint by last author, by stillness and by what was taken up with the assistant', () => {
  assert.equal(lensMarks('none', doc, history, []).marks.size, 0);
  const author = lensMarks('author', doc, history, []);
  assert.deepEqual(Object.fromEntries(author.marks), { a: 'agent', b: 'user', c: 'quiet', d: 'user', loose: 'quiet' });
  assert.deepEqual(author.legend.map(l => [l.key, l.count]), [['user', 2], ['agent', 1], ['quiet', 2]]);
  const age = lensMarks('age', { ...(doc as object), revision: 30 } as never, history, []);
  assert.deepEqual(Object.fromEntries(age.marks), { a: 'settled', b: 'settled', c: 'quiet', d: 'recent', loose: 'quiet' });
  assert.equal(lensMarks('age', doc, history, []).marks.get('d'), 'fresh');
  const talk = lensMarks('talk', doc, [], [event('acked', ['a', 'b']), event('pending', ['b']), event('failed', ['c']), event('acked', ['c']), event('sent', ['zzz'])]);
  assert.deepEqual(Object.fromEntries(talk.marks), { a: 'acked', b: 'open', c: 'failed', d: 'never', loose: 'never' });
});
test('rings give every block one bearing, areas as sectors, and one mark per stored change', () => {
  const model = ringModel(doc, history, [event('pending', ['a']), event('acked', ['d', 'missing'])]);
  assert.deepEqual(model.spokes.map(s => [s.id, s.sector]), [['a', 'g1'], ['b', 'g1'], ['c', 'g1'], ['d', 'g3'], ['loose', '']]);
  assert.deepEqual(model.sectors.map(s => s.title), ['Uno', 'Dos', 'Sin área']);
  for (let i = 1; i < model.spokes.length; i++) assert.ok(model.spokes[i].a0 > model.spokes[i - 1].a1, 'bearings do not overlap');
  assert.ok(model.spokes.at(-1)!.a1 - model.spokes[0].a0 < Math.PI * 2);
  assert.deepEqual([model.rings, model.first, model.last], [4, 5, 20]);
  assert.deepEqual(model.marks.map(m => [m.id, m.ring, m.actor, m.undone]), [['a', 0, 'user', false], ['b', 0, 'user', false], ['a', 1, 'agent', false], ['b', 2, 'user', true], ['d', 3, 'user', false]]);
  assert.equal(model.unplaced, 2, 'a link change and a removed entity have no bearing');
  assert.deepEqual(model.barbs, [{ id: 'a', state: 'open' }, { id: 'd', state: 'acked' }]);
  const empty = ringModel({ blocks: [], groups: [] } as never, [], []); assert.deepEqual([empty.rings, empty.spokes.length, empty.marks.length], [0, 0, 0]);
  assert.match(arcPath(100, 100, 50, 0, Math.PI / 2), /^M150\.00 100\.00A50\.00 50\.00 0 0 1 100\.00 150\.00$/);
});
