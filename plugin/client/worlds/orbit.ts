import { hops, adjacency, type Thing, type Edge } from './shared';

export type Body = { id: string; ring: 0 | 1 | 2 | 3 | 4; angle: number; via?: Edge; out?: boolean };

/**
 * Compute the orbital model around a centre.
 * - Ring 0: the centre
 * - Ring 1, 2, 3: things at exactly 1, 2, 3+ links (hops)
 * - Ring 4: things with no path to the centre
 * - Sectors are proportional to area representation and tile the full circle
 * - Bodies within a sector are evenly spaced
 */
export function orbitModel(
  all: readonly Thing[],
  links: readonly Edge[],
  centre: string
): {
  centre: string;
  bodies: Body[];
  sectors: { area: string; areaIndex: number; a0: number; a1: number }[];
  counts: [number, number, number, number, number];
} {
  const adj = adjacency(links);
  const distances = hops(centre, links);
  const centreThing = all.find(t => t.id === centre);

  // Partition things into rings
  const rings: Thing[][] = [[], [], [], [], []];
  rings[0] = centreThing ? [centreThing] : [];

  for (const thing of all) {
    if (thing.id === centre) continue;
    const dist = distances.get(thing.id);
    if (dist === undefined) {
      rings[4].push(thing); // No path: dust
    } else if (dist === 1) {
      rings[1].push(thing);
    } else if (dist === 2) {
      rings[2].push(thing);
    } else if (dist === 3) {
      rings[3].push(thing);
    } else {
      // 4+ hops also go to ring 3
      rings[3].push(thing);
    }
  }

  // Build sectors: one per unique area, proportional to count across the whole document
  const areaMap = new Map<number, number>(); // areaIndex → count
  for (const thing of all) {
    if (thing.areaIndex !== -1) {
      areaMap.set(thing.areaIndex, (areaMap.get(thing.areaIndex) ?? 0) + 1);
    }
  }

  // "Sin área" (areaIndex -1) comes last
  const sectorOrder: number[] = [];
  const seen = new Set<number>();
  for (const thing of all) {
    if (!seen.has(thing.areaIndex) && thing.areaIndex !== -1) {
      seen.add(thing.areaIndex);
      sectorOrder.push(thing.areaIndex);
    }
  }
  if (all.some(t => t.areaIndex === -1)) {
    sectorOrder.push(-1);
  }

  const totalInAreas = Array.from(areaMap.values()).reduce((a, b) => a + b, 0);
  const totalWithoutArea = all.filter(t => t.areaIndex === -1).length;
  const totalCount = totalInAreas + totalWithoutArea;

  // Compute sector angles
  const sectors: { area: string; areaIndex: number; a0: number; a1: number }[] = [];
  let angle = -Math.PI / 2; // Start at top
  for (const areaIndex of sectorOrder) {
    const count = areaIndex === -1 ? totalWithoutArea : areaMap.get(areaIndex) ?? 0;
    const proportion = totalCount > 0 ? count / totalCount : 0;
    const arcSize = proportion * 2 * Math.PI;
    const area = areaIndex === -1 ? 'Sin área' : all.find(t => t.areaIndex === areaIndex)?.area ?? 'Área';
    sectors.push({ area, areaIndex, a0: angle, a1: angle + arcSize });
    angle += arcSize;
  }

  // Helper: map a sector angle and index within sector to an absolute angle
  const bodyAngle = (sectorIdx: number, indexInRing: number, countInRing: number): number => {
    if (countInRing === 0) return 0;
    const sector = sectors[sectorIdx];
    const sectorSize = sector.a1 - sector.a0;
    const position = (indexInRing + 0.5) / countInRing;
    return sector.a0 + position * sectorSize;
  };

  // Build bodies for each ring
  const bodies: Body[] = [];
  const counts: [number, number, number, number, number] = [
    rings[0].length,
    rings[1].length,
    rings[2].length,
    rings[3].length,
    rings[4].length,
  ];

  // Ring 0 (centre)
  for (const thing of rings[0]) {
    bodies.push({ id: thing.id, ring: 0, angle: 0 });
  }

  // Rings 1-4
  for (let ringNum = 1; ringNum <= 4; ringNum++) {
    const ring = rings[ringNum];
    const ringsByArea = new Map<number, Thing[]>();
    for (const thing of ring) {
      if (!ringsByArea.has(thing.areaIndex)) ringsByArea.set(thing.areaIndex, []);
      ringsByArea.get(thing.areaIndex)!.push(thing);
    }

    // For each sector, place its bodies
    for (let sectorIdx = 0; sectorIdx < sectors.length; sectorIdx++) {
      const sector = sectors[sectorIdx];
      const thingsInSector = ringsByArea.get(sector.areaIndex) ?? [];
      for (let i = 0; i < thingsInSector.length; i++) {
        const thing = thingsInSector[i];
        const angle = bodyAngle(sectorIdx, i, thingsInSector.length);
        const body: Body = { id: thing.id, ring: ringNum as any, angle };

        // For ring 1, add via and out
        if (ringNum === 1) {
          const neighbors = adj.get(thing.id) ?? [];
          const centreLink = neighbors.find(n => n.id === centre);
          if (centreLink) {
            body.via = centreLink.edge;
            // out is true when centre is the link's from
            // In adjacency, out=true means the edge goes out from the first param
            // So from body's perspective, if out=false, the edge goes from centre to body (centre is from)
            body.out = !centreLink.out;
          }
        }

        bodies.push(body);
      }
    }
  }

  return { centre, bodies, sectors, counts };
}

/**
 * Pick which thing should be the centre.
 * - If selection[0] is a thing, use it
 * - Otherwise, pick the thing with the most links
 * - Ties: first in all
 * - Fallback: all[0]?.id ?? null
 */
export function pickCentre(
  all: readonly Thing[],
  links: readonly Edge[],
  selection: readonly string[]
): string | null {
  const allById = new Map(all.map(t => [t.id, t]));

  // If selection[0] is a thing, use it
  if (selection.length > 0 && allById.has(selection[0])) {
    return selection[0];
  }

  // Count links per thing
  const linkCount = new Map<string, number>();
  for (const link of links) {
    linkCount.set(link.from, (linkCount.get(link.from) ?? 0) + 1);
    linkCount.set(link.to, (linkCount.get(link.to) ?? 0) + 1);
  }

  // Find thing with most links
  let maxCount = -1;
  let best: string | null = null;
  for (const thing of all) {
    const count = linkCount.get(thing.id) ?? 0;
    if (count > maxCount) {
      maxCount = count;
      best = thing.id;
    }
  }

  return best ?? all[0]?.id ?? null;
}

/**
 * Convert polar coordinates to Cartesian.
 */
export function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}
