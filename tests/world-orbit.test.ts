import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { orbitModel, pickCentre, polar } from '../plugin/client/worlds/orbit';
import type { Thing, Edge } from '../plugin/client/worlds/shared';

describe('orbit world', () => {
  // Helper: create a thing
  const thing = (id: string, area: string = '', areaIndex: number = -1): Thing => ({
    id,
    title: `Thing ${id}`,
    summary: '',
    area,
    areaIndex,
    group: false,
  });

  // Helper: create an edge
  const edge = (id: string, from: string, to: string, kind: 'flow' | 'depends' | 'reference' = 'flow'): Edge => ({
    id,
    from,
    to,
    kind,
    label: '',
  });

  describe('orbitModel', () => {
    test('ring assignment by hop distance', () => {
      const all = [thing('a'), thing('b'), thing('c'), thing('d'), thing('e')];
      const links = [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c'),
        edge('cd', 'c', 'd'),
      ];
      // a-b-c-d, e unreachable
      const model = orbitModel(all, links, 'a');
      const getRing = (id: string) => model.bodies.find(b => b.id === id)?.ring ?? -1;

      assert.equal(getRing('a'), 0, 'centre is ring 0');
      assert.equal(getRing('b'), 1, 'b is 1 hop from a');
      assert.equal(getRing('c'), 2, 'c is 2 hops from a');
      assert.equal(getRing('d'), 3, 'c is 3 hops from a');
      assert.equal(getRing('e'), 4, 'e has no path to a');
    });

    test('ring 3 includes 3+ hops', () => {
      const all = [thing('a'), thing('b'), thing('c'), thing('d'), thing('e'), thing('f')];
      const links = [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c'),
        edge('cd', 'c', 'd'),
        edge('de', 'd', 'e'),
        edge('ef', 'e', 'f'),
      ];
      // a-b-c-d-e-f (4+ hops should go to ring 3)
      const model = orbitModel(all, links, 'a');
      const getRing = (id: string) => model.bodies.find(b => b.id === id)?.ring ?? -1;

      assert.equal(getRing('e'), 3, 'e at 4 hops goes to ring 3');
      assert.equal(getRing('f'), 3, 'f at 5 hops goes to ring 3');
    });

    test('sectors proportional and tiling', () => {
      const all = [
        thing('a', 'Area1', 0),
        thing('b', 'Area1', 0),
        thing('c', 'Area2', 1),
        thing('d', 'Area2', 1),
        thing('d2', 'Area2', 1),
      ];
      const links = [
        edge('ab', 'a', 'b'),
        edge('ac', 'a', 'c'),
        edge('ad', 'a', 'd'),
      ];
      const model = orbitModel(all, links, 'a');

      // Two sectors: Area1 (2 things) and Area2 (3 things)
      assert.equal(model.sectors.length, 2, 'two sectors');
      assert.equal(model.sectors[0].areaIndex, 0, 'first sector is area 0');
      assert.equal(model.sectors[1].areaIndex, 1, 'second sector is area 1');

      // Check proportions: 2/(2+3) for area1, 3/(2+3) for area2
      const angle1 = model.sectors[0].a1 - model.sectors[0].a0;
      const angle2 = model.sectors[1].a1 - model.sectors[1].a0;
      const ratio = angle1 / angle2;
      assert.ok(Math.abs(ratio - 2 / 3) < 0.01, 'sector sizes proportional');

      // Check they tile the circle
      const total = angle1 + angle2;
      assert.ok(Math.abs(total - 2 * Math.PI) < 0.01, 'sectors tile full circle');
    });

    test('"Sin área" sector comes last', () => {
      const all = [
        thing('a', 'Area1', 0),
        thing('b', 'Area1', 0),
        thing('c', '', -1), // No area
      ];
      const links = [edge('ac', 'a', 'c'), edge('bc', 'b', 'c')];
      const model = orbitModel(all, links, 'a');

      const lastSector = model.sectors[model.sectors.length - 1];
      assert.equal(lastSector.areaIndex, -1, '"Sin área" is last sector');
      assert.equal(lastSector.area, 'Sin área', 'area name is "Sin área"');
    });

    test('bodies within sector are evenly spaced', () => {
      const all = [thing('a', 'Area1', 0), thing('b', 'Area1', 0), thing('c', 'Area1', 0)];
      const links = [edge('ab', 'a', 'b'), edge('ac', 'a', 'c')];
      const model = orbitModel(all, links, 'a');

      const sector = model.sectors[0];
      const sectorSize = sector.a1 - sector.a0;
      const bodies = model.bodies.filter(b => b.ring === 1).sort((x, y) => x.angle - y.angle);

      if (bodies.length === 2) {
        const expectedPos1 = sector.a0 + (0.5 / 2) * sectorSize;
        const expectedPos2 = sector.a0 + (1.5 / 2) * sectorSize;
        assert.ok(Math.abs(bodies[0].angle - expectedPos1) < 0.01, 'first body at (0+0.5)/2 of sector');
        assert.ok(Math.abs(bodies[1].angle - expectedPos2) < 0.01, 'second body at (1+0.5)/2 of sector');
      }
    });

    test('via and out on ring 1', () => {
      const all = [thing('a'), thing('b')];
      const links = [edge('ab', 'a', 'b')];
      const model = orbitModel(all, links, 'a');

      const bodyB = model.bodies.find(b => b.id === 'b');
      assert.ok(bodyB, 'body b exists');
      assert.equal(bodyB!.ring, 1, 'b is on ring 1');
      assert.ok(bodyB!.via, 'b has via set');
      assert.equal(bodyB!.via!.id, 'ab', 'via is the link');
      assert.equal(bodyB!.out, true, 'out is true for outgoing edge');
    });

    test('out false for incoming edge', () => {
      const all = [thing('a'), thing('b')];
      const links = [edge('ba', 'b', 'a')];
      const model = orbitModel(all, links, 'a');

      const bodyB = model.bodies.find(b => b.id === 'b');
      assert.ok(bodyB, 'body b exists');
      assert.equal(bodyB!.ring, 1, 'b is on ring 1');
      assert.ok(bodyB!.via, 'b has via set');
      assert.equal(bodyB!.out, false, 'out is false for incoming edge');
    });

    test('counts array', () => {
      const all = [thing('a'), thing('b'), thing('c'), thing('d'), thing('e')];
      const links = [
        edge('ab', 'a', 'b'),
        edge('bc', 'b', 'c'),
        edge('cd', 'c', 'd'),
      ];
      const model = orbitModel(all, links, 'a');

      assert.deepEqual(model.counts, [1, 1, 1, 1, 1], 'counts match rings');
    });
  });

  describe('pickCentre', () => {
    test('uses selection[0] if it is a thing', () => {
      const all = [thing('a'), thing('b'), thing('c')];
      const links: Edge[] = [];
      const result = pickCentre(all, links, ['b']);
      assert.equal(result, 'b', 'uses selection[0]');
    });

    test('picks thing with most links', () => {
      const all = [thing('a'), thing('b'), thing('c')];
      const links = [
        edge('ab', 'a', 'b'),
        edge('ac', 'a', 'c'),
        edge('bc', 'b', 'c'),
      ];
      // a has 2 links, b has 2, c has 2 → picks first in all
      const result = pickCentre(all, links, []);
      assert.equal(result, 'a', 'picks thing with most links (first in all on tie)');
    });

    test('handles no links', () => {
      const all = [thing('a'), thing('b')];
      const links: Edge[] = [];
      const result = pickCentre(all, links, []);
      assert.equal(result, 'a', 'falls back to first in all when no links');
    });

    test('returns null for empty all', () => {
      const all: Thing[] = [];
      const links: Edge[] = [];
      const result = pickCentre(all, links, []);
      assert.equal(result, null, 'returns null for empty all');
    });

    test('ignores invalid selection', () => {
      const all = [thing('a'), thing('b')];
      const links = [edge('ab', 'a', 'b')];
      const result = pickCentre(all, links, ['nonexistent']);
      assert.equal(result, 'a', 'ignores invalid selection and picks by links');
    });
  });

  describe('polar', () => {
    test('converts polar to cartesian', () => {
      const { x, y } = polar(100, 100, 50, 0);
      assert.ok(Math.abs(x - 150) < 0.01, 'x at angle 0');
      assert.ok(Math.abs(y - 100) < 0.01, 'y at angle 0');
    });

    test('handles angle π/2', () => {
      const { x, y } = polar(100, 100, 50, Math.PI / 2);
      assert.ok(Math.abs(x - 100) < 0.01, 'x at angle π/2');
      assert.ok(Math.abs(y - 150) < 0.01, 'y at angle π/2');
    });

    test('handles negative angle', () => {
      const { x, y } = polar(100, 100, 50, -Math.PI / 2);
      assert.ok(Math.abs(x - 100) < 0.01, 'x at angle -π/2');
      assert.ok(Math.abs(y - 50) < 0.01, 'y at angle -π/2');
    });
  });

  describe('sectors with same area', () => {
    test('bodies of one area stay in that area sector', () => {
      const all = [
        thing('a', 'Area1', 0),
        thing('b', 'Area1', 0),
        thing('c', 'Area2', 1),
        thing('d', 'Area2', 1),
      ];
      const links = [
        edge('ab', 'a', 'b'),
        edge('ac', 'a', 'c'),
        edge('ad', 'a', 'd'),
      ];
      const model = orbitModel(all, links, 'a');

      const area1Sector = model.sectors.find(s => s.areaIndex === 0);
      const area2Sector = model.sectors.find(s => s.areaIndex === 1);

      if (area1Sector && area2Sector) {
        const area1Bodies = model.bodies.filter(b => b.ring === 1 && all.find(t => t.id === b.id)?.areaIndex === 0);
        const area2Bodies = model.bodies.filter(b => b.ring === 1 && all.find(t => t.id === b.id)?.areaIndex === 1);

        for (const body of area1Bodies) {
          assert.ok(body.angle >= area1Sector.a0 && body.angle <= area1Sector.a1, `body ${body.id} in area 1 sector`);
        }
        for (const body of area2Bodies) {
          assert.ok(body.angle >= area2Sector.a0 && body.angle <= area2Sector.a1, `body ${body.id} in area 2 sector`);
        }
      }
    });
  });
});
