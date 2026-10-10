// Voyage calculator: the owner's view of a single voyage charter.
//
// Given a ship, a cargo, a route and market prices, works out how long the
// voyage takes, what it costs, and what it earns per day (TCE).
//
// SIMPLIFICATIONS (see LEARNING.md):
// - One constant speed, no weather allowance ("sea margin"), no currents.
// - One fuel type at one price, with one burn rate at sea and one in port.
// - Port time and port costs are lump sums for the whole voyage, not derived
//   from load/discharge rates; no demurrage or delays.
// - Cargo is limited only by DWT; fuel/stores weight, cargo volume and port
//   draft limits are ignored.
// - No canal transits or tolls.

export interface Vessel {
  /** Deadweight: total tonnes the ship can carry (cargo + fuel + stores). */
  dwt: number;
  /** Service speed in knots (nautical miles per hour). */
  speedKnots: number;
  /** Fuel burned per day while sailing, in tonnes. */
  fuelAtSeaTonnesPerDay: number;
  /** Fuel burned per day while in port (generators, cranes), in tonnes. */
  fuelInPortTonnesPerDay: number;
  /** Daily running cost (crew, insurance, maintenance). Not a voyage cost. */
  opexUsdPerDay: number;
}

export interface Cargo {
  quantityTonnes: number;
  freightRateUsdPerTonne: number;
  /** Total commissions (address + brokerage) as a percentage, e.g. 5 = 5%. */
  commissionPct: number;
}

export interface Route {
  /** Empty leg from the ship's open position to the load port. */
  ballastDistanceNm: number;
  /** Loaded leg from load port to discharge port. */
  ladenDistanceNm: number;
  /** Total days spent in load and discharge ports. */
  portDays: number;
  /** Total port costs for all port calls on the voyage. */
  portCostsUsd: number;
}

export interface Market {
  bunkerPriceUsdPerTonne: number;
}

export interface VoyageResult {
  seaDays: number;
  portDays: number;
  totalDays: number;
  fuelTonnes: number;
  fuelCostUsd: number;
  portCostsUsd: number;
  grossFreightUsd: number;
  commissionUsd: number;
  /** Fuel + port costs + commission: costs caused by this voyage. */
  voyageCostsUsd: number;
  /** Gross freight minus voyage costs, before opex. */
  netResultUsd: number;
  /** Time Charter Equivalent: net result per voyage day, excluding opex. */
  tceUsdPerDay: number;
  /** Opex over the voyage duration (reported separately, not in TCE). */
  opexUsd: number;
  /** TCE minus daily opex: what the owner actually makes per day. */
  dailyProfitUsd: number;
}

const HOURS_PER_DAY = 24;

export function calculateVoyage(
  vessel: Vessel,
  cargo: Cargo,
  route: Route,
  market: Market,
): VoyageResult {
  requirePositive('vessel.dwt', vessel.dwt);
  requirePositive('vessel.speedKnots', vessel.speedKnots);
  requireNonNegative('vessel.fuelAtSeaTonnesPerDay', vessel.fuelAtSeaTonnesPerDay);
  requireNonNegative('vessel.fuelInPortTonnesPerDay', vessel.fuelInPortTonnesPerDay);
  requireNonNegative('vessel.opexUsdPerDay', vessel.opexUsdPerDay);
  requirePositive('cargo.quantityTonnes', cargo.quantityTonnes);
  requireNonNegative('cargo.freightRateUsdPerTonne', cargo.freightRateUsdPerTonne);
  requireNonNegative('cargo.commissionPct', cargo.commissionPct);
  if (cargo.commissionPct > 100) {
    throw new RangeError(`cargo.commissionPct must be at most 100, got ${cargo.commissionPct}`);
  }
  requireNonNegative('route.ballastDistanceNm', route.ballastDistanceNm);
  requirePositive('route.ladenDistanceNm', route.ladenDistanceNm);
  requireNonNegative('route.portDays', route.portDays);
  requireNonNegative('route.portCostsUsd', route.portCostsUsd);
  requireNonNegative('market.bunkerPriceUsdPerTonne', market.bunkerPriceUsdPerTonne);
  if (cargo.quantityTonnes > vessel.dwt) {
    throw new RangeError(
      `cargo of ${cargo.quantityTonnes} t exceeds vessel DWT of ${vessel.dwt} t`,
    );
  }

  const distanceNm = route.ballastDistanceNm + route.ladenDistanceNm;
  const seaDays = distanceNm / (vessel.speedKnots * HOURS_PER_DAY);
  const portDays = route.portDays;
  const totalDays = seaDays + portDays;

  const fuelTonnes =
    seaDays * vessel.fuelAtSeaTonnesPerDay + portDays * vessel.fuelInPortTonnesPerDay;
  const fuelCostUsd = fuelTonnes * market.bunkerPriceUsdPerTonne;

  const grossFreightUsd = cargo.quantityTonnes * cargo.freightRateUsdPerTonne;
  const commissionUsd = grossFreightUsd * (cargo.commissionPct / 100);

  const voyageCostsUsd = fuelCostUsd + route.portCostsUsd + commissionUsd;
  const netResultUsd = grossFreightUsd - voyageCostsUsd;
  const tceUsdPerDay = netResultUsd / totalDays;

  const opexUsd = totalDays * vessel.opexUsdPerDay;
  const dailyProfitUsd = tceUsdPerDay - vessel.opexUsdPerDay;

  return {
    seaDays,
    portDays,
    totalDays,
    fuelTonnes,
    fuelCostUsd,
    portCostsUsd: route.portCostsUsd,
    grossFreightUsd,
    commissionUsd,
    voyageCostsUsd,
    netResultUsd,
    tceUsdPerDay,
    opexUsd,
    dailyProfitUsd,
  };
}

function requireNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0, got ${value}`);
  }
}

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number > 0, got ${value}`);
  }
}
