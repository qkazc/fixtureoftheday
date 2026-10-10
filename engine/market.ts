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
/**
 * Each cargo's matching ship opens at most this far from the load port.
 * PLACEHOLDER: tuned for gameplay. (US Gulf has no other port this close,
 * so its matching ship always opens there.)
 */
export const NEARBY_OPEN_NM = 4_000;
/** Within this distance a matching ship counts as "close" rather than "medium". */
export const CLOSE_OPEN_NM = 1_000;
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

  // One ship per cargo, of the right class and open within NEARBY_OPEN_NM of
  // its load port, so every day has a sensible match. Plus one spare ship,
  // open anywhere, as a decoy. Shuffled so the order gives nothing away.
  const placements: { vesselClass: VesselClass; openPort: PortId }[] = [
    ...cargoes.map((c) => ({ vesselClass: c.vesselClass, openPort: nearbyPort(rng, c.loadPort) })),
    { vesselClass: pick(rng, VESSEL_CLASS_IDS), openPort: pick(rng, PORT_IDS) },
  ];
  const names = shuffle(rng, SHIP_NAMES);
  const ships = shuffle(rng, placements).map((placement, i) => ({
    id: `S${i + 1}`,
    name: names[i]!,
    ...placement,
  }));

  return { date, bunkerPriceUsdPerTonne, cargoes, ships };
}

/** A port near the load port: half the time close, half the time medium distance. */
function nearbyPort(rng: Rng, loadPort: PortId): PortId {
  const close = PORT_IDS.filter((p) => distanceNm(p, loadPort) <= CLOSE_OPEN_NM);
  const medium = PORT_IDS.filter((p) => {
    const nm = distanceNm(p, loadPort);
    return nm > CLOSE_OPEN_NM && nm <= NEARBY_OPEN_NM;
  });
  // `close` always includes the load port itself; `medium` can be empty.
  return pick(rng, medium.length > 0 && rng() < 0.5 ? medium : close);
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
 * The freight rate ($/t) at which a ship of the trade's class earns the
 * target TCE, given its ballast leg (a typical one by default).
 */
export function rateForTce(
  trade: Trade,
  quantityTonnes: number,
  bunkerPriceUsdPerTonne: number,
  targetTceUsdPerDay: number,
  ballastDistanceNm = TYPICAL_BALLAST_NM,
): number {
  const spec = VESSEL_CLASSES[trade.vesselClass];
  // Price the voyage at zero freight to get its days and costs, then solve
  // TCE = (freight × (1 − commission) − costs) / days for the freight rate.
  const v = calculateVoyage(
    spec.vessel,
    { quantityTonnes, freightRateUsdPerTonne: 0, commissionPct: MARKET_COMMISSION_PCT },
    {
      ballastDistanceNm,
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
