// Map geometry: a simple equirectangular projection (longitude and latitude
// straight onto x and y), cropped to the latitudes the game uses.
//
// SIMPLIFICATION: lines on the map are straight between ports, not sea
// routes. A line whose shorter way round crosses the date line wraps off one
// edge of the map and back on at the other, so trans-Pacific voyages read right.

import type { LonLat } from './mapData';

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
