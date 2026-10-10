// The day's market board: which ships could take which enquiries. Pure
// logic, so it can be tested without a browser. The board shows one row per
// enquiry with its right-size ships (see matchRows); boardCell describes one
// ship against one enquiry.
//
// Ballast distance is always shown: a broker can read it off the position
// lists. The owner's estimated TCE only appears once the enquiry has been
// researched, which is what research costs time for.

import {
  DAY_END_HOUR,
  distanceNm,
  enquiryStatus,
  estimateVoyage,
  fitCheck,
  VESSEL_CLASSES,
  type CargoOrder,
  type DayState,
  type EnquiryEmail,
  type EnquiryStatus,
  type Inbox,
  type ShipOffer,
} from '../engine';

export type CellState =
  /** The ship could be offered for this enquiry. */
  | 'open'
  /** This ship is fixed on this enquiry. */
  | 'fixedHere'
  /** The ship is fixed on another enquiry. */
  | 'shipTaken'
  /** The enquiry is fixed with another ship, or lost. */
  | 'enquiryClosed';

export interface BoardCell {
  fit: 'fits' | 'wrongSize' | 'missesLaycan';
  ballastNm: number;
  /** Owner's TCE at the rate idea; null until researched (or if the wrong size). */
  estTceUsdPerDay: number | null;
  /** estTce as a share of the class market TCE; null when estTce is. */
  estTceRatio: number | null;
  state: CellState;
}

export function boardCell(inbox: Inbox, day: DayState, shipId: string, email: EnquiryEmail): BoardCell {
  const ship = inbox.market.ships.find((s) => s.id === shipId)!;
  const cargo = inbox.market.cargoes.find((c) => c.id === email.cargoId)!;
  const check = fitCheck(ship, cargo);
  const fit = check.fits ? 'fits' : check.problem!;
  const researched = day.researched.includes(email.id);
  const estTce =
    researched && fit !== 'wrongSize'
      ? estimateVoyage(inbox.market, ship, cargo, cargo.marketRateUsdPerTonne).tceUsdPerDay
      : null;
  const fixture = day.fixtures.find((f) => f.shipId === shipId);
  const state: CellState =
    fixture?.emailId === email.id ? 'fixedHere'
    : fixture ? 'shipTaken'
    : enquiryStatus(day, email) !== 'open' ? 'enquiryClosed'
    : 'open';
  return {
    fit,
    ballastNm: distanceNm(ship.openPort, cargo.loadPort),
    estTceUsdPerDay: estTce,
    estTceRatio: estTce === null ? null : estTce / VESSEL_CLASSES[ship.vesselClass].marketTceUsdPerDay,
    state,
  };
}

export interface MatchRow {
  email: EnquiryEmail;
  cargo: CargoOrder;
  status: EnquiryStatus;
  researched: boolean;
  /** Ships of the right size, nearest first. Other sizes are left out. */
  candidates: { ship: ShipOffer; cell: BoardCell }[];
}

/** The matches board: one row per enquiry, soonest deadline first. */
export function matchRows(inbox: Inbox, day: DayState): MatchRow[] {
  return inbox.emails
    .filter((e): e is EnquiryEmail => e.kind === 'enquiry')
    .sort((a, b) => (a.deadlineHour ?? DAY_END_HOUR) - (b.deadlineHour ?? DAY_END_HOUR))
    .map((email) => {
      const cargo = inbox.market.cargoes.find((c) => c.id === email.cargoId)!;
      const candidates = inbox.market.ships
        .map((ship) => ({ ship, cell: boardCell(inbox, day, ship.id, email) }))
        .filter((c) => c.cell.fit !== 'wrongSize')
        .sort((a, b) => a.cell.ballastNm - b.cell.ballastNm);
      return { email, cargo, status: enquiryStatus(day, email), researched: day.researched.includes(email.id), candidates };
    });
}
