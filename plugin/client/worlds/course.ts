import type { Edge } from './shared';

/**
 * Compute edge betweenness centrality using Brandes' algorithm.
 * Works on undirected, unweighted graphs. Returns values normalized to [0, 1]
 * where 1 is the highest betweenness in the graph (all zeros stay 0).
 */
export function betweenness(ids: readonly string[], links: readonly Edge[]): Map<string, number> {
  const n = ids.length;
  if (n === 0) return new Map();

  const idSet = new Set(ids);
  const adj = new Map<string, string[]>();
  const edgeMap = new Map<string, Edge>();

  // Build adjacency list and edge map
  for (const id of ids) adj.set(id, []);
  for (const link of links) {
    if (!idSet.has(link.from) || !idSet.has(link.to)) continue;
    adj.get(link.from)!.push(link.to);
    adj.get(link.to)!.push(link.from);
    edgeMap.set(`${link.from}:${link.to}`, link);
    edgeMap.set(`${link.to}:${link.from}`, link);
  }

  const edgeBetweenness = new Map<string, number>();
  for (const link of links) edgeBetweenness.set(link.id, 0);

  // BFS from every source
  for (const s of ids) {
    const S: string[] = [];
    const P = new Map<string, string[]>();
    const g = new Map<string, number>();
    const d = new Map<string, number>();

    for (const v of ids) {
      P.set(v, []);
      g.set(v, 0);
      d.set(v, -1);
    }

    g.set(s, 1);
    d.set(s, 0);

    const Q: string[] = [s];
    for (let i = 0; i < Q.length; i++) {
      const v = Q[i];
      S.push(v);

      for (const w of adj.get(v) ?? []) {
        if (d.get(w)! < 0) {
          d.set(w, d.get(v)! + 1);
          Q.push(w);
        }
        if (d.get(w)! === d.get(v)! + 1) {
          g.set(w, g.get(w)! + g.get(v)!);
          P.get(w)!.push(v);
        }
      }
    }

    const e = new Map<string, number>();
    for (const v of ids) e.set(v, 0);

    for (let i = S.length - 1; i >= 0; i--) {
      const w = S[i];
      for (const v of P.get(w) ?? []) {
        const c = (g.get(v)! / g.get(w)!) * (1 + e.get(w)!);
        e.set(v, e.get(v)! + c);

        // Add to edge betweenness
        const edge = edgeMap.get(`${v}:${w}`);
        if (edge) {
          const current = edgeBetweenness.get(edge.id) ?? 0;
          edgeBetweenness.set(edge.id, current + c);
        }
      }
    }
  }

  // Normalize by dividing by 2 (undirected) and scale to [0, 1]
  let max = 0;
  for (const val of edgeBetweenness.values()) {
    const normalized = val / 2;
    if (normalized > max) max = normalized;
  }

  const result = new Map<string, number>();
  if (max === 0) {
    for (const link of links) result.set(link.id, 0);
  } else {
    for (const [edgeId, val] of edgeBetweenness) {
      result.set(edgeId, (val / 2) / max);
    }
  }

  return result;
}

/**
 * Find the shortest path between two nodes using Dijkstra's algorithm.
 * Cost function: flow=1, depends=1.2, reference=2.
 * Direction is ignored (undirected graph).
 * Ties broken by fewer links, then by edge order.
 */
export function route(
  from: string,
  to: string,
  links: readonly Edge[]
): { ids: string[]; via: Edge[] } | null {
  if (from === to) return { ids: [from], via: [] };

  const idSet = new Set<string>();
  const adj = new Map<string, { id: string; edge: Edge; cost: number }[]>();

  // Build adjacency and collect all ids
  for (const link of links) {
    idSet.add(link.from);
    idSet.add(link.to);
  }

  for (const id of idSet) adj.set(id, []);

  const costOf = (kind: Edge['kind']) =>
    kind === 'flow' ? 1 : kind === 'depends' ? 1.2 : 2;

  for (const link of links) {
    const cost = costOf(link.kind);
    adj.get(link.from)!.push({ id: link.to, edge: link, cost });
    adj.get(link.to)!.push({ id: link.from, edge: link, cost });
  }

  // Dijkstra with array-based priority queue
  type Node = { id: string; cost: number; pathLength: number };
  const dist = new Map<string, { cost: number; pathLength: number }>();
  const parent = new Map<string, { id: string; edge: Edge }>();
  const queue: Node[] = [{ id: from, cost: 0, pathLength: 0 }];

  dist.set(from, { cost: 0, pathLength: 0 });

  while (queue.length > 0) {
    // Pop minimum cost node
    let minIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      const a = queue[i];
      const b = queue[minIdx];
      if (a.cost < b.cost || (a.cost === b.cost && a.pathLength < b.pathLength)) {
        minIdx = i;
      }
    }
    const current = queue[minIdx];
    queue[minIdx] = queue[queue.length - 1];
    queue.pop();

    if (current.id === to) {
      // Reconstruct path
      const ids: string[] = [to];
      const via: Edge[] = [];
      let node = to;
      while (node !== from) {
        const p = parent.get(node);
        if (!p) return null;
        ids.unshift(p.id);
        via.unshift(p.edge);
        node = p.id;
      }
      return { ids, via };
    }

    const currentDist = dist.get(current.id);
    if (!currentDist || current.cost > currentDist.cost) continue;

    for (const neighbor of adj.get(current.id) ?? []) {
      const newCost = current.cost + neighbor.cost;
      const newPathLength = current.pathLength + 1;
      const neighborDist = dist.get(neighbor.id);

      if (
        !neighborDist ||
        newCost < neighborDist.cost ||
        (newCost === neighborDist.cost && newPathLength < neighborDist.pathLength)
      ) {
        dist.set(neighbor.id, { cost: newCost, pathLength: newPathLength });
        parent.set(neighbor.id, {
          id: current.id,
          edge: neighbor.edge,
        });
        queue.push({
          id: neighbor.id,
          cost: newCost,
          pathLength: newPathLength,
        });
      }
    }
  }

  return null;
}

/**
 * Uniformly scale and center points into a box, preserving aspect ratio.
 * A single point goes to the center of the box.
 */
export function fitPoints(
  points: Map<string, { x: number; y: number }>,
  box: { x: number; y: number; width: number; height: number }
): Map<string, { x: number; y: number }> {
  if (points.size === 0) return new Map();

  const entries = Array.from(points.entries());
  if (entries.length === 1) {
    const [id, _] = entries[0];
    return new Map([[id, { x: box.x + box.width / 2, y: box.y + box.height / 2 }]]);
  }

  // Find bounding box
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [_, p] of entries) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const width = maxX - minX || 1;
  const height = maxY - minY || 1;

  // Calculate scale to fit in box
  const scaleX = box.width / width;
  const scaleY = box.height / height;
  const scale = Math.min(scaleX, scaleY);

  // Center the scaled content
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const offsetX = box.x + (box.width - scaledWidth) / 2;
  const offsetY = box.y + (box.height - scaledHeight) / 2;

  const result = new Map<string, { x: number; y: number }>();
  for (const [id, p] of entries) {
    result.set(id, {
      x: offsetX + (p.x - minX) * scale,
      y: offsetY + (p.y - minY) * scale,
    });
  }

  return result;
}
