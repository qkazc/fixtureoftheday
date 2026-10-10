// Gameplay balance: simulated brokers playing 100 days. These guard the
// design goals rather than exact numbers: reading the counters should beat
// meeting in the middle, and the daily proposal budget should bite.

import { describe, expect, it } from 'vitest';
import { generateMarket, type DailyMarket } from './market';
import {
  CONCESSION_RANGE,
  firmOffer,
  propose,
  proposalsLeft,
  startNegotiation,
  type Negotiation,
} from './negotiation';
import { estimateVoyage, scoreDay, type Fixture } from './scoring';

const DATES = Array.from({ length: 100 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 1 + i * 4)).toISOString().slice(0, 10),
);
const to5c = (rate: number) => Math.round(rate * 20) / 20;
const midpointRate = (n: Negotiation) => to5c((n.ownerOffer + n.chartererBid) / 2);

type Strategy = (n: Negotiation, opening: { offer: number; bid: number }, market: DailyMarket) => Negotiation;

/** Always propose halfway between the current offer and bid. */
const meetInTheMiddle: Strategy = (n) => propose(n, midpointRate(n));

/**
 * Probe once, then use the counters to bound each hidden limit (assuming the
 * stingiest concession share), and go firm if the bounds leave a safe overlap.
 */
const readTheCounters: Strategy = (n, opening) => {
  const last = n.history.at(-1);
  if (!last || n.ownerOffer <= n.chartererBid) return propose(n, midpointRate(n));
  const prev = n.history.at(-2);
  const offerBefore = prev ? prev.ownerOffer : opening.offer;
  const bidBefore = prev ? prev.chartererBid : opening.bid;
  const most = CONCESSION_RANGE[1];
  const floorAtMost = last.ownerAccepted ? last.proposedRate : offerBefore - (offerBefore - last.ownerOffer) / most;
  const ceilingAtLeast = last.chartererAccepted ? last.proposedRate : bidBefore + (last.chartererBid - bidBefore) / most;
  return floorAtMost <= ceilingAtLeast
    ? firmOffer(n, to5c((floorAtMost + ceilingAtLeast) / 2))
    : propose(n, midpointRate(n));
};

/** Cheats: knows both hidden limits and goes firm at the best-scoring rate. */
const knowsTheLimits: Strategy = (n, _opening, market) => {
  const { ownerFloorRate: floor, chartererCeilingRate: ceiling } = n.limits;
  let best = floor;
  let bestScore = -1;
  for (let k = 0; k <= 10; k++) {
    const rate = Math.ceil((floor + ((ceiling - floor) * k) / 10) * 20) / 20;
    if (rate < floor || rate > ceiling) continue;
    const s = scoreDay(market, [{ shipId: n.shipId, cargoId: n.cargoId, rateUsdPerTonne: rate }]).totalScore;
    if (s > bestScore) [best, bestScore] = [rate, s];
  }
  return firmOffer(n, best);
};

/** Plays a day: ships go to cargoes by best estimated TCE, then each deal is negotiated. */
function playDay(market: DailyMarket, strategy: Strategy) {
  const pairs = market.cargoes
    .flatMap((c) =>
      market.ships
        .filter((s) => s.vesselClass === c.vesselClass)
        .map((s) => ({ c, s, tce: estimateVoyage(market, s, c, c.marketRateUsdPerTonne).tceUsdPerDay })),
    )
    .sort((a, b) => b.tce - a.tce);
  const usedShips = new Set<string>();
  const usedCargoes = new Set<string>();
  const done: Negotiation[] = [];
  for (const { c, s } of pairs) {
    if (usedShips.has(s.id) || usedCargoes.has(c.id)) continue;
    usedShips.add(s.id);
    usedCargoes.add(c.id);
    let n = startNegotiation(market, s.id, c.id);
    const opening = { offer: n.ownerOffer, bid: n.chartererBid };
    while (n.status === 'open' && proposalsLeft([...done, n]) > 0) n = strategy(n, opening, market);
    done.push(n);
  }
  const fixtures: Fixture[] = done
    .filter((n) => n.status === 'agreed')
    .map((n) => ({ shipId: n.shipId, cargoId: n.cargoId, rateUsdPerTonne: n.agreedRate! }));
  return { fixed: fixtures.length, score: scoreDay(market, fixtures).totalScore };
}

function average(strategy: Strategy) {
  const results = DATES.map((d) => playDay(generateMarket(d), strategy));
  return {
    fixed: results.reduce((s, r) => s + r.fixed, 0) / results.length,
    score: results.reduce((s, r) => s + r.score, 0) / results.length,
  };
}

describe('gameplay balance over 100 days', () => {
  const middle = average(meetInTheMiddle);
  const reader = average(readTheCounters);
  const oracle = average(knowsTheLimits);

  it('rewards reading the counters over meeting in the middle', () => {
    expect(reader.score).toBeGreaterThan(middle.score);
    expect(reader.fixed).toBeGreaterThan(middle.fixed);
  });

  it('leaves room for skill: perfect play scores well above meeting in the middle', () => {
    expect(oracle.score).toBeGreaterThan(middle.score * 1.1);
  });

  it('makes the proposal budget bite for a broker who always meets in the middle', () => {
    expect(middle.fixed).toBeLessThan(3.6); // out of 4 cargoes a day
  });
});
