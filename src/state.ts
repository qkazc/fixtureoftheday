// UI state: the player's choices for the day, and turning them into scores.
// Pure functions only, so they can be unit-tested without a browser.

import {
  distanceNm,
  estimateVoyage,
  firmOffer,
  propose,
  proposalsLeft,
  scoreDay,
  startNegotiation,
  VESSEL_CLASSES,
  type DailyMarket,
  type Fixture,
  type FixtureResult,
  type Negotiation,
  type ShipOffer,
} from '../engine';

export interface Selection {
  shipId: string | null;
  /** Talks with the chosen ship's owner and the charterer, once a ship is picked. */
  negotiation: Negotiation | null;
}

/** The player's choice for each cargo, keyed by cargo id. */
export type Selections = Record<string, Selection>;

export interface Evaluation {
  /** Result per cargo id, or null when that cargo isn't fixed. */
  byCargo: Record<string, FixtureResult | null>;
  totalBrokerageUsd: number;
  totalScore: number;
}

export function initialSelections(market: DailyMarket): Selections {
  return Object.fromEntries(market.cargoes.map((c) => [c.id, { shipId: null, negotiation: null }]));
}

/** Once a proposal has gone out, the ship for that cargo can't be changed. */
export const isLocked = (s: Selection): boolean => (s.negotiation?.history.length ?? 0) > 0;

/** True if the ship is tied up: chosen for a cargo whose talks haven't failed. */
const isBusy = (s: Selection): boolean => s.shipId !== null && s.negotiation?.status !== 'failed';

/** Ships that could carry this cargo: right class and not busy with another cargo. */
export function availableShips(
  market: DailyMarket,
  selections: Selections,
  cargoId: string,
): ShipOffer[] {
  const cargo = market.cargoes.find((c) => c.id === cargoId);
  if (!cargo) return [];
  const busyElsewhere = new Set(
    Object.entries(selections)
      .filter(([id, s]) => id !== cargoId && isBusy(s))
      .map(([, s]) => s.shipId),
  );
  return market.ships.filter((s) => s.vesselClass === cargo.vesselClass && !busyElsewhere.has(s.id));
}

/** Picks (or clears) the ship for a cargo and opens talks. Ignored once locked. */
export function chooseShip(
  market: DailyMarket,
  selections: Selections,
  cargoId: string,
  shipId: string | null,
): Selections {
  const current = selections[cargoId];
  if (!current || isLocked(current)) return selections;
  return {
    ...selections,
    [cargoId]: { shipId, negotiation: shipId ? startNegotiation(market, shipId, cargoId) : null },
  };
}

/** Proposals and firm offers left today. */
export function budgetLeft(selections: Selections): number {
  return proposalsLeft(Object.values(selections).flatMap((s) => (s.negotiation ? [s.negotiation] : [])));
}

/** Sends a proposal for one cargo. Ignored without open talks or budget. */
export function sendProposal(selections: Selections, cargoId: string, rate: number): Selections {
  return send(selections, cargoId, (n) => propose(n, rate));
}

/** Makes a firm offer for one cargo. Ignored without open talks or budget. */
export function sendFirmOffer(selections: Selections, cargoId: string, rate: number): Selections {
  return send(selections, cargoId, (n) => firmOffer(n, rate));
}

function send(selections: Selections, cargoId: string, play: (n: Negotiation) => Negotiation): Selections {
  const current = selections[cargoId];
  if (!current?.negotiation || current.negotiation.status !== 'open') return selections;
  if (budgetLeft(selections) <= 0) return selections;
  return { ...selections, [cargoId]: { ...current, negotiation: play(current.negotiation) } };
}

/** Distance and voyage length for a ship-cargo pair; these don't depend on the rate. */
export function voyageOutline(
  market: DailyMarket,
  shipId: string,
  cargoId: string,
): { ballastNm: number; days: number } {
  const ship = market.ships.find((s) => s.id === shipId)!;
  const cargo = market.cargoes.find((c) => c.id === cargoId)!;
  const spec = VESSEL_CLASSES[ship.vesselClass];
  const ballastNm = distanceNm(ship.openPort, cargo.loadPort);
  const seaNm = ballastNm + distanceNm(cargo.loadPort, cargo.dischargePort);
  return { ballastNm, days: seaNm / (spec.vessel.speedKnots * 24) + spec.portDays };
}

export type CellStatus = 'free' | 'talking' | 'fixed' | 'failed' | 'busy';

export interface BoardCell {
  /** False when the ship is the wrong class for the cargo. */
  fits: boolean;
  ballastNm: number;
  /** Owner's TCE if the cargo went at its market rate (a quick voyage estimate); null if it doesn't fit. */
  estTceUsdPerDay: number | null;
  /** estTce as a share of the class market TCE (1 = exactly market); null if it doesn't fit. */
  estTceRatio: number | null;
  /** What's happening with this ship-cargo pair right now. */
  status: CellStatus;
}

/** One cell of the market board: a ship (row) against a cargo (column). */
export function boardCell(
  market: DailyMarket,
  selections: Selections,
  shipId: string,
  cargoId: string,
): BoardCell {
  const ship = market.ships.find((s) => s.id === shipId)!;
  const cargo = market.cargoes.find((c) => c.id === cargoId)!;
  const ballastNm = distanceNm(ship.openPort, cargo.loadPort);
  const fits = ship.vesselClass === cargo.vesselClass;
  const estTce = fits ? estimateVoyage(market, ship, cargo, cargo.marketRateUsdPerTonne).tceUsdPerDay : null;
  const sel = selections[cargoId];
  const here = sel?.shipId === shipId ? sel.negotiation?.status : undefined;
  const busyElsewhere = Object.entries(selections).some(
    ([id, s]) => id !== cargoId && s.shipId === shipId && isBusy(s),
  );
  const status: CellStatus =
    here === 'agreed' ? 'fixed'
    : here === 'failed' ? 'failed'
    : here === 'open' ? 'talking'
    : busyElsewhere || isLocked(sel ?? { shipId: null, negotiation: null }) ? 'busy'
    : 'free';
  return {
    fits,
    ballastNm,
    estTceUsdPerDay: estTce,
    estTceRatio: estTce === null ? null : estTce / VESSEL_CLASSES[ship.vesselClass].marketTceUsdPerDay,
    status,
  };
}

/** Fixtures for every cargo whose talks ended in agreement. */
export function toFixtures(selections: Selections): Fixture[] {
  return Object.entries(selections).flatMap(([cargoId, s]) =>
    s.shipId && s.negotiation?.status === 'agreed' && s.negotiation.agreedRate !== null
      ? [{ cargoId, shipId: s.shipId, rateUsdPerTonne: s.negotiation.agreedRate }]
      : [],
  );
}

export function evaluate(market: DailyMarket, selections: Selections): Evaluation {
  const day = scoreDay(market, toFixtures(selections));
  const byCargo: Record<string, FixtureResult | null> = Object.fromEntries(
    market.cargoes.map((c) => [c.id, null]),
  );
  for (const r of day.fixtures) byCargo[r.fixture.cargoId] = r;
  return { byCargo, totalBrokerageUsd: day.totalBrokerageUsd, totalScore: day.totalScore };
}
