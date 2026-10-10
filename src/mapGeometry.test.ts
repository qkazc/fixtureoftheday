import { describe, expect, it } from 'vitest';
import { LAND, PORT_POSITIONS, SEA_LANES, SEA_POINTS } from './mapData';
import { lineSegments, MAP_HEIGHT, MAP_WIDTH, nodePosition, project, ringPath, seaPath } from './mapGeometry';
import { PORT_IDS } from '../engine';

describe('project', () => {
  it('puts the map corners at the edges', () => {
    expect(project([-180, 72])).toEqual([0, 0]);
    expect(project([180, -50])).toEqual([MAP_WIDTH, MAP_HEIGHT]);
  });

  it('keeps every port inside the map', () => {
    for (const id of PORT_IDS) {
      const [x, y] = project(PORT_POSITIONS[id]);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(MAP_WIDTH);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(MAP_HEIGHT);
    }
  });
});

describe('lineSegments', () => {
  it('draws one straight segment when the short way does not cross the date line', () => {
    const segs = lineSegments(PORT_POSITIONS.rotterdam, PORT_POSITIONS.mundra);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual([project(PORT_POSITIONS.rotterdam), project(PORT_POSITIONS.mundra)]);
  });

  it('wraps a trans-Pacific line off one edge and back on the other', () => {
    // US Gulf to Qingdao: shorter westward, across the Pacific.
    const segs = lineSegments(PORT_POSITIONS.usGulf, PORT_POSITIONS.qingdao);
    expect(segs).toHaveLength(2);
    const [first, second] = [segs[0]!, segs[1]!];
    expect(first[0]).toEqual(project(PORT_POSITIONS.usGulf));
    expect(first[1][0]).toBe(0); // leaves at the west edge
    expect(second[0][0]).toBe(MAP_WIDTH); // comes back at the east edge
    expect(first[1][1]).toBeCloseTo(second[0][1], 9); // at the same latitude
    expect(second[1]).toEqual(project(PORT_POSITIONS.qingdao));
  });

  it('wraps the same way in both directions', () => {
    const there = lineSegments(PORT_POSITIONS.qingdao, PORT_POSITIONS.usGulf);
    expect(there).toHaveLength(2);
    expect(there[0]![1][0]).toBe(MAP_WIDTH);
  });
});

describe('ringPath', () => {
  it('draws every land ring as a closed path', () => {
    for (const ring of LAND) {
      const d = ringPath(ring);
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
    }
  });
});

describe('sea lanes', () => {
  /** Even-odd ray cast against the hand-drawn land rings, in lon/lat. */
  const onLand = (lon: number, lat: number) =>
    LAND.some((ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > lat !== yj > lat && lon < xi + ((lat - yi) / (yj - yi)) * (xj - xi)) inside = !inside;
      }
      return inside;
    });

  it('keeps every lane in the water (canals excepted)', () => {
    const crossings: string[] = [];
    for (const [a, b, kind] of SEA_LANES) {
      if (kind === 'canal') continue;
      const p = nodePosition(a);
      let q = nodePosition(b);
      // Go the shorter way round, across the date line if need be.
      if (q[0] - p[0] > 180) q = [q[0] - 360, q[1]];
      if (q[0] - p[0] < -180) q = [q[0] + 360, q[1]];
      for (let i = 1; i < 40; i++) {
        const t = i / 40;
        let lon = p[0] + t * (q[0] - p[0]);
        const lat = p[1] + t * (q[1] - p[1]);
        if (lon > 180) lon -= 360;
        if (lon < -180) lon += 360;
        // Ports sit on the coast, so the first and last couple of degrees may touch land.
        const nearPort = (id: string, pt: readonly number[]) =>
          id in PORT_POSITIONS && Math.hypot(lon - pt[0]!, lat - pt[1]!) < 2;
        if (nearPort(a, p) || nearPort(b, nodePosition(b))) continue;
        if (onLand(lon, lat)) {
          crossings.push(`${a} -> ${b} at [${lon.toFixed(1)}, ${lat.toFixed(1)}]`);
          break;
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  it('connects every port to every other port', () => {
    for (const a of PORT_IDS) {
      for (const b of PORT_IDS) {
        const path = seaPath(a, b);
        expect(path[0]).toEqual(PORT_POSITIONS[a]);
        expect(path.at(-1)).toEqual(PORT_POSITIONS[b]);
      }
    }
  });

  it('sends Brazil to China round the Cape of Good Hope, and Rotterdam to Mundra through Suez', () => {
    expect(seaPath('tubarao', 'qingdao')).toContainEqual(SEA_POINTS.capeOfGoodHope);
    expect(seaPath('rotterdam', 'mundra')).toContainEqual(SEA_POINTS.portSaid);
  });
});
