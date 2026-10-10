// Draws the desk map as SVG: land, ports, ships at their open positions, and,
// for the enquiry being worked on, its voyage and the ballast legs of the
// ships that could take it.

import { calendarDay, fitCheck, PORTS, type CargoOrder, type Inbox, type PortId, type ShipOffer } from '../engine';
import { LAND, PORT_POSITIONS } from './mapData';
import { lineSegments, MAP_HEIGHT, MAP_WIDTH, project, ringPath } from './mapGeometry';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}

/** Ports whose labels sit to the left, so close neighbours don't overlap. */
const LABEL_LEFT: ReadonlySet<PortId> = new Set(['santos', 'usGulf', 'kamsar', 'portHedland']);

export interface MapFocus {
  /** The cargo being worked on: draw its voyage and candidate ballast legs. */
  cargo: CargoOrder | null;
  /** Ships already fixed today. */
  fixedShipIds: ReadonlySet<string>;
}

export function drawMap(inbox: Inbox, focus: MapFocus = { cargo: null, fixedShipIds: new Set() }): SVGSVGElement {
  const map = svg('svg', {
    viewBox: `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`,
    class: 'map',
    role: 'img',
    'aria-label': focus.cargo
      ? `Map: voyage ${PORTS[focus.cargo.loadPort].name} to ${PORTS[focus.cargo.dischargePort].name}, with ships that could take it`
      : 'Map of ports and where ships open',
  });
  map.append(svg('rect', { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT, class: 'sea' }));
  for (const ring of LAND) map.append(svg('path', { d: ringPath(ring), class: 'land' }));

  const line = (from: PortId, to: PortId, cls: string) => {
    for (const [a, b] of lineSegments(PORT_POSITIONS[from], PORT_POSITIONS[to])) {
      map.append(svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls }));
    }
  };

  // The enquiry in focus: ballast legs first, then its voyage on top.
  const cargo = focus.cargo;
  const candidate = (ship: ShipOffer) =>
    cargo !== null && !focus.fixedShipIds.has(ship.id) && ship.vesselClass === cargo.vesselClass;
  if (cargo) {
    for (const ship of inbox.market.ships) {
      if (!candidate(ship) || ship.openPort === cargo.loadPort) continue;
      line(ship.openPort, cargo.loadPort, fitCheck(ship, cargo).fits ? 'ballast' : 'ballast late');
    }
    line(cargo.loadPort, cargo.dischargePort, 'voyage');
  }

  // Ports.
  for (const id of Object.keys(PORT_POSITIONS) as PortId[]) {
    const [x, y] = project(PORT_POSITIONS[id]);
    const inFocus = cargo !== null && (id === cargo.loadPort || id === cargo.dischargePort);
    const left = LABEL_LEFT.has(id);
    map.append(
      svg('circle', { cx: x, cy: y, r: 1.6, class: inFocus ? 'port focus' : 'port' }),
      svg('text', { x: x + (left ? -2.5 : 2.5), y: y + 4.5, class: inFocus ? 'port-label focus' : 'port-label', 'text-anchor': left ? 'end' : 'start' }, PORTS[id].name),
    );
  }

  // Ships, stacked above their open port.
  const byPort = new Map<PortId, ShipOffer[]>();
  for (const ship of inbox.market.ships) byPort.set(ship.openPort, [...(byPort.get(ship.openPort) ?? []), ship]);
  for (const [port, ships] of byPort) {
    const [x, y] = project(PORT_POSITIONS[port]);
    const left = LABEL_LEFT.has(port);
    ships.forEach((ship, i) => {
      const sy = y - 3.5 - i * 4.5;
      const fixed = focus.fixedShipIds.has(ship.id);
      const cls = fixed ? 'ship fixed' : cargo && !candidate(ship) ? 'ship faded' : 'ship';
      const label = `${ship.name} · ${calendarDay(inbox.date, ship.openDay)}${fixed ? ' · fixed' : ''}`;
      map.append(
        svg(
          'g',
          { class: cls },
          svg('title', {}, `${ship.name}, ${ship.vesselClass}, open ${PORTS[port].name} ${calendarDay(inbox.date, ship.openDay)}`),
          svg('path', { d: `M${x - 1.4},${sy + 1.2} L${x + 1.4},${sy + 1.2} L${x},${sy - 1.4} Z` }),
          svg('text', { x: x + (left ? -2.5 : 2.5), y: sy + 1.2, 'text-anchor': left ? 'end' : 'start' }, label),
        ),
      );
    });
  }
  return map;
}
