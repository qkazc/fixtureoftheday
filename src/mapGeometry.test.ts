import { describe, expect, it } from 'vitest';
import { LAND, PORT_POSITIONS } from './mapData';
import { lineSegments, MAP_HEIGHT, MAP_WIDTH, project, ringPath } from './mapGeometry';
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
