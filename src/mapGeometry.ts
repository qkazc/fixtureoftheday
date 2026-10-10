// Map geometry: a simple equirectangular projection (longitude and latitude
// straight onto x and y), cropped to the latitudes the game uses.
//
// Voyages are drawn along hand-placed sea lanes (see mapData.ts), taking the
// shortest way through them, so lines stay in the water. A leg whose shorter
// way round crosses the date line wraps off one edge of the map and back on
// at the other, so trans-Pacific voyages read right.
//
// SIMPLIFICATION: this only affects drawing. Voyage distances come from the
// game's distance table, not from these lanes.

import type { PortId } from '../engine';
import { PORT_POSITIONS, SEA_LANES, SEA_POINTS, type LonLat, type MapNode } from './mapData';

/** The visible window, in degrees. */
export const VIEW = { west: -180, east: 180, north: 72, south: -50 } as const;
export const MAP_WIDTH = VIEW.east - VIEW.west;
export const MAP_HEIGHT = VIEW.north - VIEW.south;

export type Point = readonly [x: number, y: number];

/** Longitude/latitude to map units (x right, y down). */
export function project([lon, lat]: LonLat): Point {
  return [lon - VIEW.west, VIEW.north - lat];
}

/**
 * The line from a to b as one or two projected segments. If the shorter way
 * round crosses the date line, it is split where it leaves one edge and
 * re-enters at the other.
 */
export function lineSegments(a: LonLat, b: LonLat): [Point, Point][] {
  const dLon = b[0] - a[0];
  if (Math.abs(dLon) <= 180) return [[project(a), project(b)]];
  // Go the other way round: unwrap b by ±360 so the line is short.
  const bLon = dLon > 0 ? b[0] - 360 : b[0] + 360;
  const edgeLon = dLon > 0 ? VIEW.west : VIEW.east;
  const t = (edgeLon - a[0]) / (bLon - a[0]);
  const edgeLat = a[1] + t * (b[1] - a[1]);
  const otherEdge = edgeLon === VIEW.west ? VIEW.east : VIEW.west;
  return [
    [project(a), project([edgeLon, edgeLat])],
    [project([otherEdge, edgeLat]), project(b)],
  ];
}

/** SVG path data for a closed ring of [lon, lat] points. */
export function ringPath(ring: readonly LonLat[]): string {
  return ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${project(p).map((n) => n.toFixed(1)).join(',')}`).join('') + 'Z';
}

export const nodePosition = (id: MapNode): LonLat =>
  id in PORT_POSITIONS ? PORT_POSITIONS[id as PortId] : SEA_POINTS[id as keyof typeof SEA_POINTS];

/** Length of a leg in map degrees, going the shorter way round. */
function legLength(a: LonLat, b: LonLat): number {
  const dLon = Math.abs(b[0] - a[0]);
  return Math.hypot(Math.min(dLon, 360 - dLon), b[1] - a[1]);
}

const NEIGHBOURS = new Map<MapNode, { to: MapNode; length: number }[]>();
for (const [a, b] of SEA_LANES) {
  const length = legLength(nodePosition(a), nodePosition(b));
  NEIGHBOURS.set(a, [...(NEIGHBOURS.get(a) ?? []), { to: b, length }]);
  NEIGHBOURS.set(b, [...(NEIGHBOURS.get(b) ?? []), { to: a, length }]);
}

/** The points a drawn voyage passes through, from one port to another (Dijkstra over the sea lanes). */
export function seaPath(from: PortId, to: PortId): LonLat[] {
  if (from === to) return [PORT_POSITIONS[from]];
  const dist = new Map<MapNode, number>([[from, 0]]);
  const prev = new Map<MapNode, MapNode>();
  const done = new Set<MapNode>();
  for (;;) {
    let current: MapNode | undefined;
    let best = Infinity;
    for (const [node, d] of dist) if (!done.has(node) && d < best) [current, best] = [node, d];
    if (current === undefined) throw new Error(`no sea lane from ${from} to ${to}`);
    if (current === to) break;
    done.add(current);
    for (const { to: next, length } of NEIGHBOURS.get(current) ?? []) {
      if (best + length < (dist.get(next) ?? Infinity)) {
        dist.set(next, best + length);
        prev.set(next, current);
      }
    }
  }
  const path: MapNode[] = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
  return path.map(nodePosition);
}

/** Projected segments for a voyage drawn along the sea lanes. */
export function voyageSegments(from: PortId, to: PortId): [Point, Point][] {
  const points = seaPath(from, to);
  return points.slice(1).flatMap((p, i) => lineSegments(points[i]!, p));
}

