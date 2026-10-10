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
  const placements: { vesselClass: VesselClass; openPort: PortId; forCargo?: CargoOrder }[] = [
    ...cargoes.map((c) => ({
      vesselClass: c.vesselClass,
      openPort: nearbyPort(rng, c.loadPort),
      forCargo: c,
    })),
    { vesselClass: pick(rng, VESSEL_CLASS_IDS), openPort: pick(rng, PORT_IDS) },
  ];
  const names = shuffle(rng, SHIP_NAMES);
  const placed = shuffle(rng, placements).map((p, i) => ({
    ship: { id: `S${i + 1}`, name: names[i]!, vesselClass: p.vesselClass, openPort: p.openPort },
    forCargo: p.forCargo,
  }));
  const market: DailyMarket = { date, bunkerPriceUsdPerTonne, cargoes, ships: placed.map((p) => p.ship) };

  // Clients' hidden limits can leave a cargo with no ship it could be fixed
  // with. If so, move its guaranteed ship to the load port, and recheck until
  // every cargo is winnable (each move only ever fixes things for its cargo).
  for (let changed = true; changed; ) {
    changed = false;
    for (const cargo of cargoes) {
      const winnable = market.ships.some(
        (ship) => ship.vesselClass === cargo.vesselClass && hasDealZone(market, ship, cargo),
      );
      const own = placed.find((p) => p.forCargo === cargo)!.ship;
      if (!winnable && own.openPort !== cargo.loadPort) {
        own.openPort = cargo.loadPort;
        changed = true;
      }
    }
  }
  return market;
}

/** Owner floor: lowest acceptable TCE, as a share of the class market TCE. */
export const OWNER_FLOOR_RANGE: readonly [number, number] = [0.8, 0.95];
/** Charterer ceiling: highest acceptable rate, as a share of the market rate. */
export const CHARTERER_CEILING_RANGE: readonly [number, number] = [1.05, 1.2];

export interface NegotiationLimits {
  /** Lowest rate the owner will accept ($/t). Hidden from the player. */
  ownerFloorRate: number;
  /** Highest rate the charterer will pay ($/t). Hidden from the player. */
  chartererCeilingRate: number;
}

/** A number in [min, max] fixed by the text, so each client keeps the same mood all day. */
function seededShare(text: string, [min, max]: readonly [number, number]): number {
  return min + createRng(hashSeed(text))() * (max - min);
}

/**
 * Each owner's floor and each charterer's ceiling for one ship-cargo pair.
 * PLACEHOLDER: the ranges are tuned for play.
 */
export function negotiationLimits(
  market: DailyMarket,
  ship: ShipOffer,
  cargo: CargoOrder,
): NegotiationLimits {
  const spec = VESSEL_CLASSES[ship.vesselClass];
  const floorShare = seededShare(`${market.date}|owner|${ship.id}`, OWNER_FLOOR_RANGE);
  const ceilingShare = seededShare(`${market.date}|charterer|${cargo.id}`, CHARTERER_CEILING_RANGE);
  return {
    ownerFloorRate: rateForTce(
      cargo,
      cargo.quantityTonnes,
      market.bunkerPriceUsdPerTonne,
      spec.marketTceUsdPerDay * floorShare,
      distanceNm(ship.openPort, cargo.loadPort),
    ),
    chartererCeilingRate: cargo.marketRateUsdPerTonne * ceilingShare,
  };
}

/** True if some rate would satisfy both the owner's floor and the charterer's ceiling. */
export function hasDealZone(market: DailyMarket, ship: ShipOffer, cargo: CargoOrder): boolean {
  const l = negotiationLimits(market, ship, cargo);
  return l.ownerFloorRate <= l.chartererCeilingRate;
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
