// Daily market: the ships and cargoes on offer for one day's challenge.
// The same date always gives the same market.
//
// SIMPLIFICATIONS (see LEARNING.md):
// - No dates: every ship is ready now, so there are no laycans.
// - Each trade needs exactly one ship class; no crossovers.
// PLACEHOLDER: bunker price range, commission and rate noise are hand-picked.

import { distanceNm, type Commodity, type PortId, PORT_IDS } from './ports';
import { createRng, hashSeed, pick, randomInt, shuffle, type Rng } from './random';
import { VESSEL_CLASS_IDS, VESSEL_CLASSES, type VesselClass } from './vessels';
import { calculateVoyage } from './voyage';

export interface Trade {
  commodity: Commodity;
  loadPort: PortId;
  dischargePort: PortId;
  vesselClass: VesselClass;
}

export const TRADES: readonly Trade[] = [
  { commodity: 'ironOre', loadPort: 'portHedland', dischargePort: 'qingdao', vesselClass: 'capesize' },
  { commodity: 'ironOre', loadPort: 'tubarao', dischargePort: 'qingdao', vesselClass: 'capesize' },
  { commodity: 'ironOre', loadPort: 'tubarao', dischargePort: 'rotterdam', vesselClass: 'capesize' },
  { commodity: 'bauxite', loadPort: 'kamsar', dischargePort: 'qingdao', vesselClass: 'capesize' },
  { commodity: 'coal', loadPort: 'newcastle', dischargePort: 'qingdao', vesselClass: 'panamax' },
  { commodity: 'coal', loadPort: 'richardsBay', dischargePort: 'mundra', vesselClass: 'supramax' },
  { commodity: 'grain', loadPort: 'santos', dischargePort: 'qingdao', vesselClass: 'panamax' },
  { commodity: 'grain', loadPort: 'usGulf', dischargePort: 'rotterdam', vesselClass: 'supramax' },
];

export interface CargoOrder extends Trade {
  id: string;
  quantityTonnes: number;
  /** Going rate in $/t: gives a ship with a typical ballast leg about the class's market TCE. */
  marketRateUsdPerTonne: number;
}

export interface ShipOffer {
  id: string;
  name: string;
  vesselClass: VesselClass;
  openPort: PortId;
}

export interface DailyMarket {
  date: string;
  bunkerPriceUsdPerTonne: number;
  cargoes: CargoOrder[];
  ships: ShipOffer[];
}

export const CARGOES_PER_DAY = 4;
/** Address commission + brokerage assumed when setting market rates. */
export const MARKET_COMMISSION_PCT = 5;
/**
 * Market rates assume the ship sails this far empty to reach the load port.
 * A ship closer than this can beat the market TCE at the market rate.
 * PLACEHOLDER: a hand-picked "typical" ballast leg.
 */
export const TYPICAL_BALLAST_NM = 2_000;
const RATE_NOISE = 0.1; // market rates vary up to ±10% around the target
const SHIP_NAMES = [
  'Amber Tern', 'Blue Heron', 'Cape Lark', 'Coral Wren', 'Golden Kite', 'Iron Gull',
  'Jade Petrel', 'Northern Swift', 'Ocean Plover', 'Silver Crane', 'Storm Egret', 'Sun Falcon',
];

export function generateMarket(date: string): DailyMarket {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError(`date must look like YYYY-MM-DD, got ${date}`);
  }
  const rng = createRng(hashSeed(date));
  const bunkerPriceUsdPerTonne = randomInt(rng, 110, 130) * 5; // $550–650

  const cargoes = shuffle(rng, TRADES)
    .slice(0, CARGOES_PER_DAY)
    .map((trade, i) => makeCargo(rng, trade, `C${i + 1}`, bunkerPriceUsdPerTonne));

  // One ship that fits each cargo, so every day is solvable, plus one spare.
  const classes = [...cargoes.map((c) => c.vesselClass), pick(rng, VESSEL_CLASS_IDS)];
  const names = shuffle(rng, SHIP_NAMES);
  const ships = shuffle(rng, classes).map((vesselClass, i) => ({
    id: `S${i + 1}`,
    name: names[i]!,
    vesselClass,
    openPort: pick(rng, PORT_IDS),
  }));

  return { date, bunkerPriceUsdPerTonne, cargoes, ships };
}

function makeCargo(rng: Rng, trade: Trade, id: string, bunkerPriceUsdPerTonne: number): CargoOrder {
  const spec = VESSEL_CLASSES[trade.vesselClass];
  const quantityTonnes =
    randomInt(rng, spec.cargoMinTonnes / 1000, spec.cargoMaxTonnes / 1000) * 1000;
  const targetTce = spec.marketTceUsdPerDay * (1 + (rng() * 2 - 1) * RATE_NOISE);
  const rate = rateForTce(trade, quantityTonnes, bunkerPriceUsdPerTonne, targetTce);
  const marketRateUsdPerTonne = Math.round(rate * 20) / 20; // quoted to the nearest $0.05
  return { ...trade, id, quantityTonnes, marketRateUsdPerTonne };
}

/**
 * The freight rate ($/t) at which a ship of the trade's class, with a
 * typical ballast leg, earns the target TCE.
 */
export function rateForTce(
  trade: Trade,
  quantityTonnes: number,
  bunkerPriceUsdPerTonne: number,
  targetTceUsdPerDay: number,
): number {
  const spec = VESSEL_CLASSES[trade.vesselClass];
  // Price the voyage at zero freight to get its days and costs, then solve
  // TCE = (freight × (1 − commission) − costs) / days for the freight rate.
  const v = calculateVoyage(
    spec.vessel,
    { quantityTonnes, freightRateUsdPerTonne: 0, commissionPct: MARKET_COMMISSION_PCT },
    {
      ballastDistanceNm: TYPICAL_BALLAST_NM,
      ladenDistanceNm: distanceNm(trade.loadPort, trade.dischargePort),
      portDays: spec.portDays,
      portCostsUsd: spec.portCostsUsd,
    },
    { bunkerPriceUsdPerTonne },
  );
  return (
    (targetTceUsdPerDay * v.totalDays + v.voyageCostsUsd) /
    (quantityTonnes * (1 - MARKET_COMMISSION_PCT / 100))
  );
}
