import test from 'node:test';
import assert from 'node:assert/strict';
import { biographies, lensMarks, type Change } from '../plugin/client/lenses';

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
