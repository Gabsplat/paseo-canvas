/**
 * RELIEVE world: the document as terrain.
 * Elevation based on connectivity: things with more links raise the ground.
 */

export type Sample = { id: string; x: number; y: number; weight: number };

/**
 * Compute elevation at each grid node.
 * Each sample contributes weight * exp(-d² / (2σ²)) to nearby nodes.
 * Skips contributions beyond 3σ.
 * Returns Float32Array with cols*rows values, indexed [row*cols + col].
 * Node at grid position (col*cell, row*cell).
 */
export function reliefField(
  samples: readonly Sample[],
  cols: number,
  rows: number,
  cell: number,
  sigma: number
): Float32Array {
  const field = new Float32Array(cols * rows);
  const sigma2 = sigma * sigma;
  const cutoff = 3 * sigma;

  for (const sample of samples) {
    const minCol = Math.max(0, Math.floor((sample.x - cutoff) / cell));
    const maxCol = Math.min(cols - 1, Math.ceil((sample.x + cutoff) / cell));
    const minRow = Math.max(0, Math.floor((sample.y - cutoff) / cell));
    const maxRow = Math.min(rows - 1, Math.ceil((sample.y + cutoff) / cell));

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const nodeX = col * cell;
        const nodeY = row * cell;
        const dx = nodeX - sample.x;
        const dy = nodeY - sample.y;
        const d2 = dx * dx + dy * dy;
        const contribution = sample.weight * Math.exp(-d2 / (2 * sigma2));
        field[row * cols + col] += contribution;
      }
    }
  }

  return field;
}

/**
 * Extract contour lines at a given elevation level using marching squares.
 * Returns flat array [x1, y1, x2, y2, ...] of line segments in GRID units.
 * Multiply by cell to get drawing coordinates.
 */
export function contours(field: Float32Array, cols: number, rows: number, level: number): number[] {
  const out: number[] = [];
  // Where the level crosses the edge between two grid nodes, by linear interpolation.
  const cross = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number): [number, number] => { const t = v1 === v0 ? 0.5 : (level - v0) / (v1 - v0); return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]; };
  for (let row = 0; row < rows - 1; row++) for (let col = 0; col < cols - 1; col++) {
    const a = field[row * cols + col], b = field[row * cols + col + 1], c = field[(row + 1) * cols + col + 1], d = field[(row + 1) * cols + col];
    const index = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
    if (index === 0 || index === 15) continue;
    const top = () => cross(col, row, a, col + 1, row, b), right = () => cross(col + 1, row, b, col + 1, row + 1, c), bottom = () => cross(col, row + 1, d, col + 1, row + 1, c), left = () => cross(col, row, a, col, row + 1, d);
    const seg = (p: [number, number], q: [number, number]) => { out.push(p[0], p[1], q[0], q[1]); };
    switch (index) {
      case 1: case 14: seg(left(), bottom()); break;
      case 2: case 13: seg(bottom(), right()); break;
      case 3: case 12: seg(left(), right()); break;
      case 4: case 11: seg(top(), right()); break;
      case 6: case 9: seg(top(), bottom()); break;
      case 7: case 8: seg(left(), top()); break;
      // Saddles: the average of the four corners decides which pair of corners is joined.
      case 5: if ((a + b + c + d) / 4 > level) { seg(left(), top()); seg(bottom(), right()); } else { seg(left(), bottom()); seg(top(), right()); } break;
      case 10: if ((a + b + c + d) / 4 > level) { seg(left(), bottom()); seg(top(), right()); } else { seg(left(), top()); seg(bottom(), right()); } break;
    }
  }
  return out;
}

/**
 * Evenly spaced elevation levels between 8% and 92% of the field's maximum.
 * Returns empty array if max is 0.
 */
export function levelsOf(field: Float32Array, count: number): number[] {
  let max = 0;
  for (let i = 0; i < field.length; i++) {
    if (field[i] > max) max = field[i];
  }
  if (max === 0) return [];

  const min = 0.08 * max;
  const top = 0.92 * max;
  const levels: number[] = [];
  for (let i = 0; i < count; i++) {
    levels.push(min + (top - min) * (i / (count - 1)));
  }
  return levels;
}

/**
 * Find summit nodes: strictly higher than 8 neighbours, above 35% of max.
 * Returns unique samples by id, sorted by elevation descending, at most limit.
 */
export function summits(
  samples: readonly Sample[],
  field: Float32Array,
  cols: number,
  rows: number,
  cell: number,
  limit: number
): Sample[] {
  let max = 0;
  for (let i = 0; i < field.length; i++) {
    if (field[i] > max) max = field[i];
  }
  if (max === 0) return [];

  const threshold = 0.35 * max;
  const summitIds = new Set<string>();
  const summitElevations = new Map<string, number>();
  const sampleById = new Map(samples.map(s => [s.id, s]));

  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const idx = row * cols + col;
      const z = field[idx];
      if (z < threshold) continue;

      // Check 8 neighbours
      let isPeak = true;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (field[(row + dr) * cols + col + dc] >= z) {
            isPeak = false;
            break;
          }
        }
        if (!isPeak) break;
      }

      if (isPeak) {
        // Find nearest sample
        let nearest: Sample | null = null;
        let minDist = Infinity;
        const nodeX = col * cell;
        const nodeY = row * cell;

        for (const sample of samples) {
          const dx = sample.x - nodeX;
          const dy = sample.y - nodeY;
          const dist = dx * dx + dy * dy;
          if (dist < minDist) {
            minDist = dist;
            nearest = sample;
          }
        }

        if (nearest) {
          summitIds.add(nearest.id);
          summitElevations.set(nearest.id, z);
        }
      }
    }
  }

  const result = Array.from(summitIds)
    .map(id => sampleById.get(id)!)
    .sort((a, b) => (summitElevations.get(b.id) ?? 0) - (summitElevations.get(a.id) ?? 0))
    .slice(0, limit);

  return result;
}

/**
 * Fit points uniformly scaled and centred into a box preserving aspect ratio.
 * A single point goes to the centre.
 * Default weight is 1.
 */
export function fitSamples(
  points: Map<string, { x: number; y: number }>,
  weights: Map<string, number>,
  box: { x: number; y: number; width: number; height: number }
): Sample[] {
  const samples = Array.from(points.entries());
  if (samples.length === 0) return [];
  if (samples.length === 1) {
    const [id, pt] = samples[0];
    return [{ id, x: box.x + box.width / 2, y: box.y + box.height / 2, weight: weights.get(id) ?? 1 }];
  }

  // Compute bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [, pt] of samples) {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minY = Math.min(minY, pt.y);
    maxY = Math.max(maxY, pt.y);
  }

  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scaleX = box.width / w;
  const scaleY = box.height / h;
  const scale = Math.min(scaleX, scaleY);

  // Centred in box
  const scaledW = w * scale;
  const scaledH = h * scale;
  const offsetX = box.x + (box.width - scaledW) / 2 - minX * scale;
  const offsetY = box.y + (box.height - scaledH) / 2 - minY * scale;

  return samples.map(([id, pt]) => ({
    id,
    x: pt.x * scale + offsetX,
    y: pt.y * scale + offsetY,
    weight: weights.get(id) ?? 1
  }));
}
