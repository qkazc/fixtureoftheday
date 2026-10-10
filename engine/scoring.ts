// Scoring a day's work: commission earned, weighted by how satisfied the
// shipowner and the charterer are with each fixture.
//
// SIMPLIFICATIONS (see LEARNING.md):
// - Each side refuses only at the edge of its satisfaction band, and there
//   is no back-and-forth yet (negotiation comes later).
// - Satisfaction depends only on money, not timing or reputation.
// - One broker per fixture, always earning the same brokerage percentage.
// PLACEHOLDER: the ±20% satisfaction bands are tuned for gameplay.

import { MARKET_COMMISSION_PCT, type CargoOrder, type DailyMarket, type ShipOffer } from './market';
import { VESSEL_CLASSES } from './vessels';
import { buildRoute, calculateVoyage, type VoyageResult } from './voyage';

export interface Fixture {
  shipId: string;
  cargoId: string;
  rateUsdPerTonne: number;
}

/**
 * A fixture only happens if both sides accept the rate. The owner refuses if
 * the voyage earns less than (1 − band) × the class market TCE; the charterer
 * refuses to pay more than (1 + band) × the cargo's market rate.
 */
export type FixtureStatus = 'fixed' | 'refusedByOwner' | 'refusedByCharterer';

export interface FixtureResult {
  fixture: Fixture;
  status: FixtureStatus;
  voyage: VoyageResult;
  /** Zero unless the fixture was agreed. */
  brokerageUsd: number;
  /** 0–100; 50 means the owner earns exactly the class market TCE. */
  ownerSatisfaction: number;
  /** 0–100; 50 means the charterer pays exactly the market rate. */
  chartererSatisfaction: number;
  /** brokerage × (owner + charterer satisfaction) / 100; zero if refused. */
  score: number;
}

export interface DayScore {
  fixtures: FixtureResult[];
  totalBrokerageUsd: number;
  totalScore: number;
}

/** The broker's share of gross freight. A common real-world figure. */
export const BROKERAGE_PCT = 1.25;
/** How far from market (as a fraction) takes satisfaction from 50 to 0 or 100. */
export const SATISFACTION_BAND = 0.2;

/** Maps a ratio to market onto 0–100: 1.0 gives 50, ±band gives 100 or 0. */
function satisfaction(ratioToMarket: number): number {
  const s = 50 + ((ratioToMarket - 1) / SATISFACTION_BAND) * 50;
  return Math.min(100, Math.max(0, s));
}

export function scoreDay(market: DailyMarket, fixtures: readonly Fixture[]): DayScore {
  const usedShips = new Set<string>();
  const usedCargoes = new Set<string>();

  const results = fixtures.map((fixture): FixtureResult => {
    const ship = findById(market.ships, fixture.shipId, 'ship');
    const cargo = findById(market.cargoes, fixture.cargoId, 'cargo');
    if (usedShips.has(ship.id)) throw new Error(`ship ${ship.id} is fixed twice`);
    if (usedCargoes.has(cargo.id)) throw new Error(`cargo ${cargo.id} is fixed twice`);
    usedShips.add(ship.id);
    usedCargoes.add(cargo.id);
    return scoreFixture(market, ship, cargo, fixture);
  });

  return {
    fixtures: results,
    totalBrokerageUsd: results.reduce((sum, r) => sum + r.brokerageUsd, 0),
    totalScore: results.reduce((sum, r) => sum + r.score, 0),
  };
}

function scoreFixture(
  market: DailyMarket,
  ship: ShipOffer,
  cargo: CargoOrder,
  fixture: Fixture,
): FixtureResult {
  if (ship.vesselClass !== cargo.vesselClass) {
    throw new Error(
      `ship ${ship.id} is a ${ship.vesselClass} but cargo ${cargo.id} needs a ${cargo.vesselClass}`,
    );
  }
  if (!Number.isFinite(fixture.rateUsdPerTonne) || fixture.rateUsdPerTonne <= 0) {
    throw new RangeError(`rate must be a positive number, got ${fixture.rateUsdPerTonne}`);
  }

  const spec = VESSEL_CLASSES[ship.vesselClass];
  const voyage = estimateVoyage(market, ship, cargo, fixture.rateUsdPerTonne);

  const ownerRatio = voyage.tceUsdPerDay / spec.marketTceUsdPerDay;
  const rateRatio = fixture.rateUsdPerTonne / cargo.marketRateUsdPerTonne;
  const ownerSatisfaction = satisfaction(ownerRatio);
  // The charterer is happier the *less* they pay, so flip the ratio around 1.
  const chartererSatisfaction = satisfaction(2 - rateRatio);

  const status: FixtureStatus =
    rateRatio > 1 + SATISFACTION_BAND
      ? 'refusedByCharterer'
      : ownerRatio < 1 - SATISFACTION_BAND
        ? 'refusedByOwner'
        : 'fixed';
  const brokerageUsd =
    status === 'fixed' ? voyage.grossFreightUsd * (BROKERAGE_PCT / 100) : 0;
  const score = brokerageUsd * ((ownerSatisfaction + chartererSatisfaction) / 100);

  return { fixture, status, voyage, brokerageUsd, ownerSatisfaction, chartererSatisfaction, score };
}

/**
 * A voyage estimate: the voyage for this ship and cargo at a given rate,
 * including the ship's ballast leg from where it is open.
 */
export function estimateVoyage(
  market: DailyMarket,
  ship: ShipOffer,
  cargo: CargoOrder,
  rateUsdPerTonne: number,
): VoyageResult {
  const spec = VESSEL_CLASSES[ship.vesselClass];
  return calculateVoyage(
    spec.vessel,
    {
      quantityTonnes: cargo.quantityTonnes,
      freightRateUsdPerTonne: rateUsdPerTonne,
      commissionPct: MARKET_COMMISSION_PCT,
    },
    buildRoute(
      { openPort: ship.openPort, loadPort: cargo.loadPort, dischargePort: cargo.dischargePort },
      spec.portDays,
      spec.portCostsUsd,
    ),
    { bunkerPriceUsdPerTonne: market.bunkerPriceUsdPerTonne },
  );
}

function findById<T extends { id: string }>(items: readonly T[], id: string, kind: string): T {
  const item = items.find((i) => i.id === id);
  if (!item) throw new RangeError(`unknown ${kind} id: ${id}`);
  return item;
}
