import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strataModel, type Cell } from '../plugin/client/worlds/strata';
import type { Thing, Edge } from '../plugin/client/worlds/shared';

// Helper to create a thing
function thing(id: string, title: string, areaIndex = 0): Thing {
  return { id, title, summary: '', area: 'Area', areaIndex, group: false };
}

// Helper to create an edge
function edge(id: string, from: string, to: string, kind: 'depends' | 'flow' | 'reference' = 'depends'): Edge {
  return { id, from, to, kind, label: '' };
}

describe('strata.ts - stratification model', () => {
  it('handles depends links: from rests on to', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'a', 'b', 'depends'), // a rests on b
    ];

    const result = strataModel(things_, edges_);

    assert.equal(result.layers.length, 2);
    assert.equal(result.layers[0][0].ids[0], 'b'); // b is at depth 0
    assert.equal(result.layers[1][0].ids[0], 'a'); // a is at depth 1
  });

  it('handles flow links: to rests on from', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'a', 'b', 'flow'), // b rests on a
    ];

    const result = strataModel(things_, edges_);

    assert.equal(result.layers.length, 2);
    assert.equal(result.layers[0][0].ids[0], 'a'); // a is at depth 0
    assert.equal(result.layers[1][0].ids[0], 'b'); // b is at depth 1
  });

  it('ignores reference links', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'a', 'b', 'reference'), // ignored
    ];

    const result = strataModel(things_, edges_);

    // A mention holds nothing up: with only that link there are no layers and both lie loose.
    assert.equal(result.layers.length, 0);
    assert.equal(result.loose.length, 2);
  });

  it('calculates longest-path depth correctly with diamond', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
      thing('c', 'C'),
      thing('d', 'D'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'b', 'a', 'depends'), // b -> a
      edge('e2', 'c', 'a', 'depends'), // c -> a
      edge('e3', 'd', 'b', 'depends'), // d -> b
      edge('e4', 'd', 'c', 'depends'), // d -> c
    ];

    const result = strataModel(things_, edges_);

    assert.equal(result.layers.length, 3);
    // a at depth 0 (rests on nothing)
    const aCell = result.layers[0].find(c => c.ids.includes('a'));
    assert(aCell);
    assert.equal(aCell.depth, 0);

    // b and c at depth 1 (rest on a)
    const bCell = result.layers[1].find(c => c.ids.includes('b'));
    const cCell = result.layers[1].find(c => c.ids.includes('c'));
    assert(bCell);
    assert(cCell);
    assert.equal(bCell.depth, 1);
    assert.equal(cCell.depth, 1);

    // d at depth 2 (rests on b and c, which are at depth 1)
    const dCell = result.layers[2].find(c => c.ids.includes('d'));
    assert(dCell);
    assert.equal(dCell.depth, 2);
  });

  it('calculates longest-path depth with long chain', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
      thing('c', 'C'),
      thing('d', 'D'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'b', 'a', 'depends'),
      edge('e2', 'c', 'b', 'depends'),
      edge('e3', 'd', 'c', 'depends'),
    ];

    const result = strataModel(things_, edges_);

    assert.equal(result.layers.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.equal(result.layers[i].length, 1);
      assert.equal(result.layers[i][0].depth, i);
    }
  });

  it('detects cycles and creates single cells', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
      thing('c', 'C'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'a', 'b', 'depends'), // a -> b
      edge('e2', 'b', 'c', 'depends'), // b -> c
      edge('e3', 'c', 'a', 'depends'), // c -> a (cycle!)
    ];

    const result = strataModel(things_, edges_);

    // All three should be in one cell (strongly connected component)
    assert.equal(result.layers.length, 1);
    assert.equal(result.layers[0].length, 1);
    assert.equal(result.layers[0][0].ids.length, 3);
    assert(result.layers[0][0].ids.includes('a'));
    assert(result.layers[0][0].ids.includes('b'));
    assert(result.layers[0][0].ids.includes('c'));
  });

  it('cycle cell title includes +N count', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'a', 'b', 'depends'),
      edge('e2', 'b', 'a', 'depends'),
    ];

    const result = strataModel(things_, edges_);

    const cell = result.layers[0][0];
    assert.equal(cell.ids.length, 2);
    assert.match(cell.title, /\+1$/);
  });

  it('load counts things transitively excluding own members', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
      thing('c', 'C'),
      thing('d', 'D'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'b', 'a', 'depends'), // b -> a
      edge('e2', 'c', 'b', 'depends'), // c -> b
      edge('e3', 'd', 'c', 'depends'), // d -> c
    ];

    const result = strataModel(things_, edges_);

    const aCell = result.layers[0][0];
    const bCell = result.layers[1][0];
    const cCell = result.layers[2][0];
    const dCell = result.layers[3][0];

    // a is rested on by b, c, d = 3 things
    assert.equal(aCell.load, 3);

    // b is rested on by c, d = 2 things
    assert.equal(bCell.load, 2);

    // c is rested on by d = 1 thing
    assert.equal(cCell.load, 1);

    // d rests on nothing = 0 things
    assert.equal(dCell.load, 0);
  });

  it('loose things have no resting-on relations', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
      thing('c', 'C'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'b', 'a', 'depends'),
    ];

    const result = strataModel(things_, edges_);

    assert.equal(result.loose.length, 1);
    assert.equal(result.loose[0].id, 'c');
  });

  it('things with only reference links are loose', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
      thing('c', 'C'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'a', 'b', 'reference'), // ignored
      edge('e2', 'c', 'b', 'depends'),
    ];

    const result = strataModel(things_, edges_);

    // a should be loose (only has a reference link)
    assert.equal(result.loose.length, 1);
    assert.equal(result.loose[0].id, 'a');
  });

  it('above map is transitive and consistent', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
      thing('c', 'C'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'b', 'a', 'depends'),
      edge('e2', 'c', 'b', 'depends'),
    ];

    const result = strataModel(things_, edges_);

    // a: b and c rest on it
    const aAbove = result.above.get('a');
    assert(aAbove);
    assert.equal(aAbove.size, 2);
    assert(aAbove.has('b'));
    assert(aAbove.has('c'));

    // b: c rests on it
    const bAbove = result.above.get('b');
    assert(bAbove);
    assert.equal(bAbove.size, 1);
    assert(bAbove.has('c'));

    // c: nothing rests on it
    const cAbove = result.above.get('c');
    assert(cAbove);
    assert.equal(cAbove.size, 0);
  });

  it('below map is transitive and consistent', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
      thing('c', 'C'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'b', 'a', 'depends'),
      edge('e2', 'c', 'b', 'depends'),
    ];

    const result = strataModel(things_, edges_);

    // c: b and a rest under it
    const cBelow = result.below.get('c');
    assert(cBelow);
    assert.equal(cBelow.size, 2);
    assert(cBelow.has('b'));
    assert(cBelow.has('a'));

    // b: a rests under it
    const bBelow = result.below.get('b');
    assert(bBelow);
    assert.equal(bBelow.size, 1);
    assert(bBelow.has('a'));

    // a: nothing rests under it
    const aBelow = result.below.get('a');
    assert(aBelow);
    assert.equal(aBelow.size, 0);
  });

  it('area index is preserved from first member of cell', () => {
    const things_: Thing[] = [
      thing('a', 'A', 2),
      thing('b', 'B', 1),
    ];
    const edges_: Edge[] = [
      edge('e1', 'a', 'b', 'depends'),
    ];

    const result = strataModel(things_, edges_);

    // a should be in a cell with areaIndex 2 (from a)
    const aCell = result.layers.find(l => l.some(c => c.ids.includes('a')))?.find(c => c.ids.includes('a'));
    assert(aCell);
    assert.equal(aCell.areaIndex, 2);

    // b should be in a cell with areaIndex 1 (from b)
    const bCell = result.layers.find(l => l.some(c => c.ids.includes('b')))?.find(c => c.ids.includes('b'));
    assert(bCell);
    assert.equal(bCell.areaIndex, 1);
  });

  it('cells are sorted by load descending within layer', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
      thing('c', 'C'),
      thing('d', 'D'),
      thing('e', 'E'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'b', 'a', 'depends'), // b -> a (load 0)
      edge('e2', 'c', 'a', 'depends'), // c -> a (load 1, rested on by d)
      edge('e3', 'd', 'c', 'depends'), // d -> c
      edge('e4', 'e', 'b', 'depends'), // e -> b (load 1, rested on by e)
    ];

    const result = strataModel(things_, edges_);

    // Find layer with b and c (depth 1)
    const layer = result.layers.find(l => l.length === 2);
    assert(layer);

    // Both should have load 1, but c comes first in original array
    assert.equal(layer[0].load, 1);
    assert.equal(layer[1].load, 1);
  });

  it('handles empty document', () => {
    const result = strataModel([], []);

    assert.equal(result.layers.length, 0);
    assert.equal(result.loose.length, 0);
  });

  it('handles self-loops', () => {
    const things_: Thing[] = [
      thing('a', 'A'),
      thing('b', 'B'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'a', 'a', 'depends'), // a -> a (ignored, same from/to)
      edge('e2', 'b', 'a', 'depends'),
    ];

    const result = strataModel(things_, edges_);

    // Should treat as if a -> a doesn't exist
    assert.equal(result.layers.length, 2);
  });

  it('complex example: mixed link types', () => {
    const things_: Thing[] = [
      thing('server', 'Server'),
      thing('db', 'Database'),
      thing('cache', 'Cache'),
      thing('ui', 'UI'),
      thing('docs', 'Docs'),
    ];
    const edges_: Edge[] = [
      edge('e1', 'server', 'db', 'depends'), // server depends on db
      edge('e2', 'server', 'cache', 'depends'), // server depends on cache
      edge('e3', 'server', 'ui', 'flow'), // server flows to ui, so ui rests on server
      edge('e4', 'docs', 'server', 'reference'), // docs references server (ignored)
    ];

    const result = strataModel(things_, edges_);

    // db and cache at depth 0
    assert.equal(result.layers[0].length, 2);

    // server at depth 1 (rests on db and cache)
    const serverCell = result.layers[1].find(c => c.ids.includes('server'));
    assert(serverCell);
    assert.equal(serverCell.depth, 1);

    // ui at depth 2 (rests on server)
    const uiCell = result.layers[2].find(c => c.ids.includes('ui'));
    assert(uiCell);
    assert.equal(uiCell.depth, 2);

    // docs is loose (only has reference link)
    assert.equal(result.loose.length, 1);
    assert.equal(result.loose[0].id, 'docs');
  });
});
