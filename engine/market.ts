// Daily market: the ships and cargoes on offer for one day's challenge.
// The same date always gives the same market.
//
// Days are counted from today (day 0). Each ship opens on some day; each
// cargo has a laycan window, and a ship fits only if it can reach the load
// port by the end of the laycan.
//
// SIMPLIFICATIONS (see LEARNING.md):
// - Each trade needs exactly one ship class; no crossovers.
// - Arriving before the laycan is fine (the ship just waits).
// PLACEHOLDER: bunker price range, commission, rate noise, open days and
// laycan windows are hand-picked.

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
  { commodity: 'coal', loadPort: 'richardsBay', dischargePort: 'rotterdam', vesselClass: 'supramax' },
  { commodity: 'grain', loadPort: 'santos', dischargePort: 'rotterdam', vesselClass: 'panamax' },
  { commodity: 'coal', loadPort: 'newcastle', dischargePort: 'mundra', vesselClass: 'panamax' },
  { commodity: 'grain', loadPort: 'usGulf', dischargePort: 'qingdao', vesselClass: 'panamax' },
];

export interface CargoOrder extends Trade {
  id: string;
  quantityTonnes: number;
  /** Going rate in $/t: gives a ship with a typical ballast leg about the class's market TCE. */
  marketRateUsdPerTonne: number;
  /** Laycan: the ship must arrive at the load port between these days (from today). */
  laycanStartDay: number;
  laycanEndDay: number;
}

export interface ShipOffer {
  id: string;
  name: string;
  vesselClass: VesselClass;
  openPort: PortId;
  /** Day (from today) the ship becomes free at its open port. */
  openDay: number;
  /** Deadweight in tonnes, as shown on a position list. */
  dwt: number;
}

export interface DailyMarket {
  date: string;
  bunkerPriceUsdPerTonne: number;
  cargoes: CargoOrder[];
  ships: ShipOffer[];
}

/** Cargoes (and so enquiries) per day: 3 or 4. */
export const CARGOES_PER_DAY_RANGE: readonly [number, number] = [3, 4];
/** Ships open between today and this many days from now. PLACEHOLDER. */
export const MAX_OPEN_DAY = 6;
/** Laycan windows are this many days wide. PLACEHOLDER. */
export const LAYCAN_DAYS = 3;
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

  const cargoCount = randomInt(rng, CARGOES_PER_DAY_RANGE[0], CARGOES_PER_DAY_RANGE[1]);
  const cargoes = drawTrades(rng, cargoCount).map((trade, i) =>
    makeCargo(rng, trade, `C${i + 1}`, bunkerPriceUsdPerTonne),
  );

  // One ship per cargo, of the right class and open within NEARBY_OPEN_NM of
  // its load port, so every day has a sensible match. Plus a shared ship that
  // two cargoes compete for, and a decoy that opens anywhere. Shuffled so the
  // order gives nothing away.
  const contest = pickContest(rng, cargoes);
  type Placement = { vesselClass: VesselClass; openPort: PortId; openDay: number; forCargoes: CargoOrder[] };
  const placements: Placement[] = [
    ...cargoes.map((c) => ({
      vesselClass: c.vesselClass,
      // The two contested cargoes get their own ship farther away, so the
      // shared ship is the stronger candidate for both.
      openPort: contest.cargoes.includes(c) ? fartherPort(rng, c.loadPort, contest) : nearbyPort(rng, c.loadPort),
      openDay: randomInt(rng, 0, MAX_OPEN_DAY),
      forCargoes: [c],
    })),
    { ...contest.ship, openDay: randomInt(rng, 0, MAX_OPEN_DAY), forCargoes: [...contest.cargoes] },
    {
      vesselClass: pick(rng, VESSEL_CLASS_IDS),
      openPort: pick(rng, PORT_IDS),
      openDay: randomInt(rng, 0, MAX_OPEN_DAY),
      forCargoes: [],
    },
  ];
  const names = shuffle(rng, SHIP_NAMES);
  const placed = shuffle(rng, placements).map((p, i) => ({
    ship: {
      id: `S${i + 1}`,
      name: names[i]!,
      vesselClass: p.vesselClass,
      openPort: p.openPort,
      openDay: p.openDay,
      dwt: VESSEL_CLASSES[p.vesselClass].vessel.dwt,
    },
    forCargoes: p.forCargoes,
  }));
  const market: DailyMarket = { date, bunkerPriceUsdPerTonne, cargoes, ships: placed.map((p) => p.ship) };

  // Clients' hidden limits can leave a cargo with no ship it could be fixed
  // with. If so, move its own ship to the load port (which only makes it
  // arrive earlier), and recheck until every cargo is winnable.
  for (let changed = true; changed; ) {
    changed = false;
    for (const cargo of cargoes) {
      setLaycan(rng, cargo, placed.filter((p) => p.forCargoes.includes(cargo)).map((p) => p.ship));
      const winnable = market.ships.some((ship) => isWorkable(market, ship, cargo));
      const own = placed.find((p) => p.forCargoes.length === 1 && p.forCargoes[0] === cargo)!.ship;
      if (!winnable && own.openPort !== cargo.loadPort) {
        own.openPort = cargo.loadPort;
        changed = true;
      }
    }
  }
  return market;
}

/**
 * Sets a cargo's laycan so every ship placed for it can arrive in time:
 * it ends 1-4 days after the latest of their arrivals. Only set once per
 * cargo, so later moves (which only make ships arrive earlier) keep it valid.
 */
function setLaycan(rng: Rng, cargo: CargoOrder, shipsFor: readonly ShipOffer[]): void {
  if (cargo.laycanEndDay >= 0) return;
  const latest = Math.max(...shipsFor.map((s) => arrivalDay(s, cargo)));
  cargo.laycanEndDay = Math.ceil(latest) + randomInt(rng, 1, 4);
  cargo.laycanStartDay = Math.max(1, cargo.laycanEndDay - LAYCAN_DAYS);
}

/** Day the ship would reach the cargo's load port, sailing straight there once open. */
export function arrivalDay(ship: ShipOffer, cargo: CargoOrder): number {
  const knots = VESSEL_CLASSES[ship.vesselClass].vessel.speedKnots;
  return ship.openDay + distanceNm(ship.openPort, cargo.loadPort) / (knots * 24);
}

export type FitProblem = 'wrongSize' | 'missesLaycan';

/** Can this ship carry this cargo at all? Right size, and at the load port by the end of the laycan. */
export function fitCheck(ship: ShipOffer, cargo: CargoOrder): { fits: boolean; problem: FitProblem | null; arrivalDay: number } {
  const arrival = arrivalDay(ship, cargo);
  const problem: FitProblem | null =
    ship.vesselClass !== cargo.vesselClass ? 'wrongSize' : arrival > cargo.laycanEndDay ? 'missesLaycan' : null;
  return { fits: problem === null, problem, arrivalDay: arrival };
}

/** The ship fits the cargo and some rate would satisfy both owner and charterer. */
export function isWorkable(market: DailyMarket, ship: ShipOffer, cargo: CargoOrder): boolean {
  return fitCheck(ship, cargo).fits && hasDealZone(market, ship, cargo);
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
export function seededShare(text: string, [min, max]: readonly [number, number]): number {
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

/** Two trades a single ship could reasonably serve: same class, load ports close together. */
const isClosePair = (a: Trade, b: Trade) =>
  a.vesselClass === b.vesselClass && distanceNm(a.loadPort, b.loadPort) <= NEARBY_OPEN_NM;

const CLOSE_PAIRS = TRADES.flatMap((a, i) =>
  TRADES.slice(i + 1).filter((b) => isClosePair(a, b)).map((b) => [a, b] as const),
);

/**
 * The day's trades. Every day includes a close pair, so that two cargoes
 * compete for one well-placed ship.
 */
function drawTrades(rng: Rng, count: number): Trade[] {
  let trades = shuffle(rng, TRADES).slice(0, count);
  const hasPair = trades.some((a, i) => trades.slice(i + 1).some((b) => isClosePair(a, b)));
  if (!hasPair) {
    const [a, b] = pick(rng, CLOSE_PAIRS);
    const rest = shuffle(rng, TRADES.filter((t) => t !== a && t !== b)).slice(0, count - 2);
    trades = shuffle(rng, [a, b, ...rest]);
  }
  return trades;
}

/**
 * The day's contest: two cargoes of the same class loading within
 * NEARBY_OPEN_NM of each other, and one extra ship of that class open at the
 * port closest to both load ports, so the player must decide which cargo
 * gets it. drawTrades guarantees such a pair exists.
 */
function pickContest(
  rng: Rng,
  cargoes: readonly CargoOrder[],
): { cargoes: readonly CargoOrder[]; ship: { vesselClass: VesselClass; openPort: PortId } } {
  const pairs = cargoes.flatMap((a, i) =>
    cargoes.slice(i + 1).filter((b) => isClosePair(a, b)).map((b) => [a, b] as const),
  );
  const [a, b] = pick(rng, pairs);
  const reach = (p: PortId) => Math.max(distanceNm(p, a.loadPort), distanceNm(p, b.loadPort));
  const openPort = PORT_IDS.reduce((best, p) => (reach(p) < reach(best) ? p : best));
  return { cargoes: [a, b], ship: { vesselClass: a.vesselClass, openPort } };
}

/**
 * For a contested cargo's own ship: a port within NEARBY_OPEN_NM of its load
 * port, but farther than the shared ship from both contested load ports, so
 * the shared ship stays the better option for each. Falls back to any nearby
 * port if there is none.
 */
function fartherPort(
  rng: Rng,
  loadPort: PortId,
  contest: { cargoes: readonly CargoOrder[]; ship: { openPort: PortId } },
): PortId {
  const options = PORT_IDS.filter(
    (p) =>
      distanceNm(p, loadPort) <= NEARBY_OPEN_NM &&
      contest.cargoes.every(
        (c) => distanceNm(p, c.loadPort) > distanceNm(contest.ship.openPort, c.loadPort),
      ),
  );
  return options.length > 0 ? pick(rng, options) : nearbyPort(rng, loadPort);
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
  // The laycan is set once the ships are placed (see setLaycan).
  return { ...trade, id, quantityTonnes, marketRateUsdPerTonne, laycanStartDay: -1, laycanEndDay: -1 };
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
