// The day's market board: ships (rows) against enquiries (columns). Pure
// logic for one cell, so it can be tested without a browser.
//
// Ballast distance is always shown: a broker can read it off the position
// lists. The owner's estimated TCE only appears once the enquiry has been
// researched, which is what research costs time for.

import {
  distanceNm,
  enquiryStatus,
  estimateVoyage,
  fitCheck,
  VESSEL_CLASSES,
  type DayState,
  type EnquiryEmail,
  type Inbox,
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
