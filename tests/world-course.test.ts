import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { betweenness, route, fitPoints } from '../plugin/client/worlds/course';
import type { Edge } from '../plugin/client/worlds/shared';

// Helper to create edges
function edge(from: string, to: string, kind: 'flow' | 'depends' | 'reference' = 'flow', label = ''): Edge {
  return {
    id: `${from}-${to}`,
    from,
    to,
    kind,
    label,
  };
}

test('betweenness: two triangles joined by bridge', () => {
  // Triangle 1: a-b-c-a
  // Triangle 2: d-e-f-d
  // Bridge: c-d
  const edges_list: Edge[] = [
    edge('a', 'b'),
    edge('b', 'c'),
    edge('c', 'a'),
    edge('c', 'd'), // bridge
    edge('d', 'e'),
    edge('e', 'f'),
    edge('f', 'd'),
  ];

  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const result = betweenness(ids, edges_list);

  // Bridge should have highest betweenness = 1
  const bridgeBetweenness = result.get('c-d') ?? 0;
  assert.ok(bridgeBetweenness > 0.9, 'Bridge should be close to 1');

  // All other edges should have lower betweenness
  for (const e of edges_list) {
    if (e.id !== 'c-d') {
      const be = result.get(e.id) ?? 0;
      assert.ok(be < bridgeBetweenness, `${e.id} should have lower betweenness than bridge`);
    }
  }
});

test('betweenness: empty graph', () => {
  const result = betweenness([], []);
  assert.equal(result.size, 0);
});

test('betweenness: single node', () => {
  const result = betweenness(['a'], []);
  assert.equal(result.size, 0);
});

test('betweenness: all values are in [0, 1]', () => {
  const edges_list: Edge[] = [
    edge('a', 'b'),
    edge('b', 'c'),
    edge('c', 'd'),
    edge('d', 'a'),
    edge('a', 'c'),
  ];

  const ids = ['a', 'b', 'c', 'd'];
  const result = betweenness(ids, edges_list);

  for (const val of result.values()) {
    assert.ok(val >= 0 && val <= 1, `Value ${val} should be in [0, 1]`);
  }
});

test('route: simple path', () => {
  const edges_list: Edge[] = [
    edge('a', 'b'),
    edge('b', 'c'),
    edge('c', 'd'),
  ];

  const result = route('a', 'd', edges_list);
  assert.ok(result, 'Should find a path');
  assert.deepEqual(result!.ids, ['a', 'b', 'c', 'd']);
  assert.equal(result!.via.length, 3);
});

test('route: prefer cheaper path', () => {
  // a -> b -> c (cost 1.2 + 1.2 = 2.4)
  // a -> d -> c (cost 1 + 1 = 2)
  const edges_list: Edge[] = [
    edge('a', 'b', 'depends'),
    edge('b', 'c', 'depends'),
    edge('a', 'd', 'flow'),
    edge('d', 'c', 'flow'),
  ];

  const result = route('a', 'c', edges_list);
  assert.ok(result, 'Should find a path');
  assert.deepEqual(result!.ids, ['a', 'd', 'c'], 'Should prefer cheaper flow path');
});

test('route: reference is most expensive', () => {
  // a -> b (flow = 1)
  // b -> c (reference = 2)
  // Total via b = 3
  // a -> d (reference = 2)
  // d -> c (flow = 1)
  // Total via d = 3 (tie, but fewer links)
  const edges_list: Edge[] = [
    edge('a', 'b', 'flow'),
    edge('b', 'c', 'reference'),
    edge('a', 'd', 'reference'),
    edge('d', 'c', 'flow'),
  ];

  const result = route('a', 'c', edges_list);
  assert.ok(result, 'Should find a path');
  // Both have cost 3, but d has fewer links (2 vs 2), so order of discovery matters
  // Since edges are processed in order, a-b should be discovered first in adjacency
  assert.equal(result!.ids.length, 3, 'Should find path with 3 nodes');
});

test('route: ignores direction', () => {
  const edges_list: Edge[] = [
    edge('a', 'b'),
    edge('b', 'c'),
  ];

  const result = route('c', 'a', edges_list);
  assert.ok(result, 'Should find path in reverse direction');
  assert.deepEqual(result!.ids, ['c', 'b', 'a']);
});

test('route: no path returns null', () => {
  const edges_list: Edge[] = [
    edge('a', 'b'),
    edge('c', 'd'),
  ];

  const result = route('a', 'c', edges_list);
  assert.equal(result, null, 'Should return null when no path exists');
});

test('route: from equals to', () => {
  const edges_list: Edge[] = [edge('a', 'b')];

  const result = route('a', 'a', edges_list);
  assert.ok(result, 'Should return single-node path');
  assert.deepEqual(result!.ids, ['a']);
  assert.equal(result!.via.length, 0);
});

test('route: via edges are in order', () => {
  const edges_list: Edge[] = [
    edge('a', 'b'),
    edge('b', 'c'),
    edge('c', 'd'),
  ];

  const result = route('a', 'd', edges_list);
  assert.ok(result, 'Should find path');
  assert.equal(result!.via.length, 3);
  assert.equal(result!.via[0].from, 'a');
  assert.equal(result!.via[0].to, 'b');
  assert.equal(result!.via[1].from, 'b');
  assert.equal(result!.via[1].to, 'c');
  assert.equal(result!.via[2].from, 'c');
  assert.equal(result!.via[2].to, 'd');
});

test('fitPoints: centers points in box', () => {
  const points = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 10, y: 10 }],
  ]);

  const box = { x: 0, y: 0, width: 100, height: 100 };
  const result = fitPoints(points, box);

  // Points should be centered
  const aPos = result.get('a')!;
  const bPos = result.get('b')!;
  const midX = (aPos.x + bPos.x) / 2;
  const midY = (aPos.y + bPos.y) / 2;

  assert.ok(Math.abs(midX - 50) < 1, 'Center X should be near 50');
  assert.ok(Math.abs(midY - 50) < 1, 'Center Y should be near 50');
});

test('fitPoints: preserves aspect ratio', () => {
  // 2:1 aspect ratio (width:height)
  const points = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 20, y: 10 }],
  ]);

  const box = { x: 0, y: 0, width: 100, height: 100 };
  const result = fitPoints(points, box);

  const aPos = result.get('a')!;
  const bPos = result.get('b')!;
  const width = Math.abs(bPos.x - aPos.x);
  const height = Math.abs(bPos.y - aPos.y);

  // Aspect ratio should be preserved
  const originalRatio = 20 / 10;
  const scaledRatio = width / height;
  assert.ok(Math.abs(scaledRatio - originalRatio) < 0.01, 'Aspect ratio should be preserved');
});

test('fitPoints: single point goes to center', () => {
  const points = new Map([['a', { x: 5, y: 5 }]]);

  const box = { x: 10, y: 20, width: 100, height: 80 };
  const result = fitPoints(points, box);

  const pos = result.get('a')!;
  const expectedX = 10 + 100 / 2;
  const expectedY = 20 + 80 / 2;

  assert.ok(Math.abs(pos.x - expectedX) < 0.1, 'Single point X should be at box center');
  assert.ok(Math.abs(pos.y - expectedY) < 0.1, 'Single point Y should be at box center');
});

test('fitPoints: empty map', () => {
  const points = new Map<string, { x: number; y: number }>();
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const result = fitPoints(points, box);

  assert.equal(result.size, 0);
});

test('fitPoints: fits within bounds', () => {
  const points = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 100, y: 50 }],
  ]);

  const box = { x: 10, y: 20, width: 80, height: 60 };
  const result = fitPoints(points, box);

  for (const [_, pos] of result) {
    assert.ok(pos.x >= box.x, 'X should be >= box.x');
    assert.ok(pos.x <= box.x + box.width, 'X should be <= box.x + box.width');
    assert.ok(pos.y >= box.y, 'Y should be >= box.y');
    assert.ok(pos.y <= box.y + box.height, 'Y should be <= box.y + box.height');
  }
});
