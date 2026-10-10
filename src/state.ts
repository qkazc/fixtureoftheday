// UI state: the player's choices for the day, and turning them into scores.
// Pure functions only, so they can be unit-tested without a browser.

import {
  scoreDay,
  type DailyMarket,
  type Fixture,
  type FixtureResult,
  type ShipOffer,
} from '../engine';

export interface Selection {
  shipId: string | null;
  rateUsdPerTonne: number;
}

/** The player's choice for each cargo, keyed by cargo id. */
export type Selections = Record<string, Selection>;

export interface Evaluation {
  /** Result per cargo id, or null when that cargo isn't (validly) fixed. */
  byCargo: Record<string, FixtureResult | null>;
  totalBrokerageUsd: number;
  totalScore: number;
}

/** No ships chosen; each rate starts at the cargo's market rate. */
export function initialSelections(market: DailyMarket): Selections {
  return Object.fromEntries(
    market.cargoes.map((c) => [c.id, { shipId: null, rateUsdPerTonne: c.marketRateUsdPerTonne }]),
  );
}

/** Ships that could carry this cargo: right class and not chosen for another cargo. */
export function availableShips(
  market: DailyMarket,
  selections: Selections,
  cargoId: string,
): ShipOffer[] {
  const cargo = market.cargoes.find((c) => c.id === cargoId);
  if (!cargo) return [];
  const takenElsewhere = new Set(
    Object.entries(selections)
      .filter(([id, s]) => id !== cargoId && s.shipId !== null)
      .map(([, s]) => s.shipId),
  );
  return market.ships.filter(
    (s) => s.vesselClass === cargo.vesselClass && !takenElsewhere.has(s.id),
  );
}

/** Fixtures for every cargo with a ship chosen and a usable rate. */
export function toFixtures(selections: Selections): Fixture[] {
  return Object.entries(selections)
    .filter(([, s]) => s.shipId !== null && Number.isFinite(s.rateUsdPerTonne) && s.rateUsdPerTonne > 0)
    .map(([cargoId, s]) => ({ cargoId, shipId: s.shipId!, rateUsdPerTonne: s.rateUsdPerTonne }));
}

export function evaluate(market: DailyMarket, selections: Selections): Evaluation {
  const day = scoreDay(market, toFixtures(selections));
  const byCargo: Record<string, FixtureResult | null> = Object.fromEntries(
    market.cargoes.map((c) => [c.id, null]),
  );
  for (const r of day.fixtures) byCargo[r.fixture.cargoId] = r;
  return { byCargo, totalBrokerageUsd: day.totalBrokerageUsd, totalScore: day.totalScore };
}
