import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reliefField,
  contours,
  levelsOf,
  summits,
  fitSamples,
  type Sample
} from '../plugin/client/worlds/relief';

test('reliefField peaks at the node nearest a single sample and falls with distance', () => {
  const samples: Sample[] = [{ id: 'a', x: 50, y: 50, weight: 1 }];
  const field = reliefField(samples, 11, 11, 10, 10);

  // Peak at (5, 5) which is the grid node closest to (50, 50)
  const peakIdx = 5 * 11 + 5;
  const peak = field[peakIdx];

  // Check that it's higher than neighbours
  assert(peak > field[4 * 11 + 5], 'should be higher than node above');
  assert(peak > field[6 * 11 + 5], 'should be higher than node below');
  assert(peak > field[5 * 11 + 4], 'should be higher than node left');
  assert(peak > field[5 * 11 + 6], 'should be higher than node right');

  // Check that elevation falls with distance
  const far = field[0];
  assert(far < peak, 'far corner should be lower than peak');
});

test('two samples add their contributions', () => {
  const samples1: Sample[] = [{ id: 'a', x: 50, y: 50, weight: 1 }];
  const field1 = reliefField(samples1, 11, 11, 10, 10);

  const samples2: Sample[] = [
    { id: 'a', x: 50, y: 50, weight: 1 },
    { id: 'b', x: 50, y: 50, weight: 1 }
  ];
  const field2 = reliefField(samples2, 11, 11, 10, 10);

  // The combined field should be roughly double at the peak
  const peak1 = field1[5 * 11 + 5];
  const peak2 = field2[5 * 11 + 5];
  assert(peak2 > peak1, 'two samples should create higher elevation');
  assert(peak2 > peak1 * 1.5, 'should be significantly higher');
});

test('a heavier sample is higher', () => {
  const light: Sample[] = [{ id: 'a', x: 50, y: 50, weight: 1 }];
  const heavy: Sample[] = [{ id: 'a', x: 50, y: 50, weight: 5 }];

  const fieldLight = reliefField(light, 11, 11, 10, 10);
  const fieldHeavy = reliefField(heavy, 11, 11, 10, 10);

  const peakLight = fieldLight[5 * 11 + 5];
  const peakHeavy = fieldHeavy[5 * 11 + 5];
  assert(peakHeavy > peakLight, 'heavier sample should produce higher elevation');
});

test('contours of a single symmetric bump at a mid level have consistent point distribution', () => {
  const samples: Sample[] = [{ id: 'a', x: 50, y: 50, weight: 1 }];
  const field = reliefField(samples, 11, 11, 10, 10);

  const levels = levelsOf(field, 5);
  const midLevel = levels[2];

  const segs = contours(field, 11, 11, midLevel);
  assert(segs.length > 0, 'should have segments');
  assert(segs.length % 4 === 0, 'segments should be in groups of 4 (x1, y1, x2, y2)');

  // Verify that all points are within reasonable bounds
  for (let i = 0; i < segs.length; i++) {
    const val = segs[i];
    assert(val >= -0.5 && val <= 10.5, `coordinate ${i} should be in grid range, got ${val}`);
  }
});

test('contour points lie at roughly the same distance from centre', () => {
  const samples: Sample[] = [{ id: 'a', x: 50, y: 50, weight: 1 }];
  const field = reliefField(samples, 11, 11, 10, 10);

  const levels = levelsOf(field, 5);
  const midLevel = levels[2];

  const segs = contours(field, 11, 11, midLevel);
  if (segs.length === 0) return;

  const centre = { x: 5, y: 5 };
  const distances: number[] = [];
  for (let i = 0; i < segs.length; i += 4) {
    const x1 = segs[i];
    const y1 = segs[i + 1];
    const x2 = segs[i + 2];
    const y2 = segs[i + 3];

    const d1 = Math.hypot(x1 - centre.x, y1 - centre.y);
    const d2 = Math.hypot(x2 - centre.x, y2 - centre.y);
    distances.push(d1, d2);
  }

  const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
  const maxDeviation = Math.max(...distances.map(d => Math.abs(d - avgDist)));

  // Most contour points should be within 20% of average
  const closePoints = distances.filter(d => Math.abs(d - avgDist) < avgDist * 0.2).length;
  assert(closePoints > distances.length * 0.5, 'most contour points should be close to average distance');
});

test('a level above the maximum gives no segments', () => {
  const samples: Sample[] = [{ id: 'a', x: 50, y: 50, weight: 1 }];
  const field = reliefField(samples, 11, 11, 10, 10);

  let max = 0;
  for (const val of field) {
    max = Math.max(max, val);
  }

  const segs = contours(field, 11, 11, max * 2);
  assert.equal(segs.length, 0, 'should have no segments above maximum');
});

test('levelsOf returns evenly spaced levels', () => {
  const samples: Sample[] = [{ id: 'a', x: 50, y: 50, weight: 1 }];
  const field = reliefField(samples, 11, 11, 10, 10);

  const levels = levelsOf(field, 5);
  assert.equal(levels.length, 5, 'should return requested count');

  let max = 0;
  for (const val of field) {
    max = Math.max(max, val);
  }

  const min = 0.08 * max;
  const top = 0.92 * max;

  assert(levels[0] >= min - 0.0001, 'first level should be at 8% of max');
  assert(levels[4] <= top + 0.0001, 'last level should be at 92% of max');

  // Check spacing
  const gaps: number[] = [];
  for (let i = 1; i < levels.length; i++) {
    gaps.push(levels[i] - levels[i - 1]);
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  for (const gap of gaps) {
    assert(Math.abs(gap - avgGap) < avgGap * 0.01, 'gaps should be roughly equal');
  }
});

test('levelsOf returns empty array when maximum is 0', () => {
  const field = new Float32Array(11 * 11);
  const levels = levelsOf(field, 9);
  assert.equal(levels.length, 0, 'should return empty array for zero max');
});

test('summits finds the two bumps of two well separated samples in height order', () => {
  const samples: Sample[] = [
    { id: 'a', x: 20, y: 50, weight: 2 },
    { id: 'b', x: 80, y: 50, weight: 1 }
  ];
  const field = reliefField(samples, 11, 11, 10, 10);

  const found = summits(samples, field, 11, 11, 10, 8);
  assert(found.length > 0, 'should find summits');

  // Should find both samples as summits
  const ids = found.map(s => s.id);
  assert(ids.includes('a'), 'should find heavier sample');
  assert(ids.includes('b'), 'should find lighter sample');

  // Heavier one should come first
  if (ids[0] === 'a' && ids[1] === 'b') {
    // Good
  } else {
    assert(
      found[0].weight >= found[1].weight,
      'summits should be sorted by elevation descending'
    );
  }
});

test('summits returns none for an empty field', () => {
  const field = new Float32Array(11 * 11);
  const found = summits([], field, 11, 11, 10, 8);
  assert.equal(found.length, 0, 'should return empty array for zero max');
});

test('fitSamples keeps aspect ratio', () => {
  const points = new Map<string, { x: number; y: number }>([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 100, y: 50 }]
  ]);
  const weights = new Map<string, number>([
    ['a', 1],
    ['b', 1]
  ]);

  const samples = fitSamples(points, weights, { x: 0, y: 0, width: 200, height: 100 });

  // Aspect ratio should be preserved
  const sx = samples.find(s => s.id === 'a');
  const ex = samples.find(s => s.id === 'b');
  assert(sx && ex);

  const scaledWidth = ex.x - sx.x;
  const scaledHeight = ex.y - sx.y;
  const ratio = scaledWidth / scaledHeight;
  assert(Math.abs(ratio - 2) < 0.01, 'aspect ratio should be preserved (2:1)');
});

test('fitSamples handles one point by placing it at centre', () => {
  const points = new Map<string, { x: number; y: number }>([['a', { x: 50, y: 50 }]]);
  const weights = new Map<string, number>([['a', 1]]);

  const samples = fitSamples(points, weights, { x: 10, y: 20, width: 100, height: 50 });

  assert.equal(samples.length, 1);
  assert.equal(samples[0].id, 'a');
  assert.equal(samples[0].x, 10 + 50, 'should be centred horizontally');
  assert.equal(samples[0].y, 20 + 25, 'should be centred vertically');
});
