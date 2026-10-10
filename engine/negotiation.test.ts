import { describe, expect, it } from 'vitest';
import { generateMarket, hasDealZone, type DailyMarket } from './market';
import {
  firmOffer,
  isFinalRound,
  MAX_ROUNDS,
  PROPOSALS_PER_DAY,
  proposalsLeft,
  propose,
  roundsLeft,
  startNegotiation,
  type Negotiation,
} from './negotiation';

const DATES = Array.from({ length: 40 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 1 + i * 9)).toISOString().slice(0, 10),
);

/** Every ship-cargo pair of matching class across many days. */
function allPairs(): { market: DailyMarket; shipId: string; cargoId: string }[] {
  return DATES.flatMap((date) => {
    const market = generateMarket(date);
    return market.cargoes.flatMap((c) =>
      market.ships
        .filter((s) => s.vesselClass === c.vesselClass)
        .map((s) => ({ market, shipId: s.id, cargoId: c.id })),
    );
  });
}

const midpointRate = (n: Negotiation) => Math.round(((n.ownerOffer + n.chartererBid) / 2) * 20) / 20;
const midpoint = (n: Negotiation) => Math.round(((n.ownerOffer + n.chartererBid) / 2) * 20) / 20;

describe('startNegotiation', () => {
  it('opens with each side short of its limit', () => {
    for (const { market, shipId, cargoId } of allPairs()) {
      const n = startNegotiation(market, shipId, cargoId);
      expect(n.status).toBe('open');
      expect(n.ownerOffer).toBeGreaterThanOrEqual(n.limits.ownerFloorRate);
      expect(n.chartererBid).toBeLessThanOrEqual(n.limits.chartererCeilingRate);
      expect(roundsLeft(n)).toBe(MAX_ROUNDS);
    }
  });

  it('is the same every time for the same day', () => {
    const m = generateMarket('2026-10-10');
    const c = m.cargoes[0]!;
    const s = m.ships.find((x) => x.vesselClass === c.vesselClass)!;
    expect(startNegotiation(m, s.id, c.id)).toEqual(startNegotiation(m, s.id, c.id));
  });

  it('rejects unknown ids and mismatched classes', () => {
    const m = generateMarket('2026-10-10');
    expect(() => startNegotiation(m, 'S99', 'C1')).toThrow(/unknown ship id/);
    expect(() => startNegotiation(m, 'S1', 'C99')).toThrow(/unknown cargo id/);
    const c = m.cargoes[0]!;
    const wrong = m.ships.find((x) => x.vesselClass !== c.vesselClass)!;
    expect(() => startNegotiation(m, wrong.id, c.id)).toThrow(/needs a/);
  });
});

describe('propose', () => {
  it('agrees when the rate meets both current positions', () => {
    const pair = allPairs().find(({ market, shipId, cargoId }) => {
      const l = startNegotiation(market, shipId, cargoId).limits;
      return l.ownerFloorRate < l.chartererCeilingRate;
    })!;
    let n = startNegotiation(pair.market, pair.shipId, pair.cargoId);
    // Put both sides at their limits, then propose between them.
    n = { ...n, ownerOffer: n.limits.ownerFloorRate, chartererBid: n.limits.chartererCeilingRate };
    const rate = (n.ownerOffer + n.chartererBid) / 2;
    const done = propose(n, rate);
    expect(done.status).toBe('agreed');
    expect(done.agreedRate).toBe(rate);
  });

  it('moves countering sides towards their limits, never past them', () => {
    for (const { market, shipId, cargoId } of allPairs()) {
      let n = startNegotiation(market, shipId, cargoId);
      while (n.status === 'open') {
        const before = n;
        n = propose(n, midpoint(n));
        const last = n.history.at(-1)!;
        if (!last.ownerAccepted) {
          expect(n.ownerOffer).toBeLessThanOrEqual(before.ownerOffer);
          expect(n.ownerOffer).toBeGreaterThanOrEqual(n.limits.ownerFloorRate);
        }
        if (!last.chartererAccepted) {
          expect(n.chartererBid).toBeGreaterThanOrEqual(before.chartererBid);
          expect(n.chartererBid).toBeLessThanOrEqual(n.limits.chartererCeilingRate);
        }
      }
    }
  });

  it('only ever agrees on a rate inside both hidden limits', () => {
    for (const { market, shipId, cargoId } of allPairs()) {
      let n = startNegotiation(market, shipId, cargoId);
      while (n.status === 'open') n = propose(n, midpoint(n));
      if (n.status === 'agreed') {
        expect(n.agreedRate!).toBeGreaterThanOrEqual(n.limits.ownerFloorRate);
        expect(n.agreedRate!).toBeLessThanOrEqual(n.limits.chartererCeilingRate);
      }
    }
  });

  it('never agrees when there is no deal zone', () => {
    let checked = 0;
    for (const { market, shipId, cargoId } of allPairs()) {
      const ship = market.ships.find((s) => s.id === shipId)!;
      const cargo = market.cargoes.find((c) => c.id === cargoId)!;
      if (hasDealZone(market, ship, cargo)) continue;
      checked++;
      let n = startNegotiation(market, shipId, cargoId);
      // Try anything: the opening offer, the bid, the midpoint.
      for (const pickRate of [(x: Negotiation) => x.ownerOffer, (x: Negotiation) => x.chartererBid, midpoint]) {
        n = startNegotiation(market, shipId, cargoId);
        while (n.status === 'open') n = propose(n, pickRate(n));
        expect(n.status).toBe('failed');
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('on the last call, closes any rate inside the deal zone', () => {
    let checked = 0;
    for (const { market, shipId, cargoId } of allPairs()) {
      const ship = market.ships.find((s) => s.id === shipId)!;
      const cargo = market.cargoes.find((c) => c.id === cargoId)!;
      if (!hasDealZone(market, ship, cargo)) continue;
      let n = startNegotiation(market, shipId, cargoId);
      // Two lowball rounds that the owner won't accept.
      n = propose(n, 0.05);
      n = propose(n, 0.05);
      expect(isFinalRound(n)).toBe(true);
      const { ownerFloorRate, chartererCeilingRate } = n.limits;
      const done = propose(n, (ownerFloorRate + chartererCeilingRate) / 2);
      expect(done.status).toBe('agreed');
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('before the last call, accepts a proposal at least as good as its own counter, and never counters past it', () => {
    for (const { market, shipId, cargoId } of allPairs()) {
      const n = startNegotiation(market, shipId, cargoId);
      if (n.ownerOffer <= n.chartererBid) continue; // openings already overlap
      const after = propose(n, midpointRate(n));
      const r = after.history[0]!;
      if (!r.ownerAccepted) expect(after.ownerOffer).toBeGreaterThan(r.proposedRate);
      if (!r.chartererAccepted) expect(after.chartererBid).toBeLessThan(r.proposedRate);
      // A proposal inside the owner's limit but above their current offer is taken.
      const generous = propose(n, n.ownerOffer + 1);
      expect(generous.history[0]!.ownerAccepted).toBe(true);
    }
  });

  it('fails after the last round without a deal', () => {
    const m = generateMarket('2026-10-10');
    const c = m.cargoes[0]!;
    let n = startNegotiation(m, m.ships.find((s) => s.vesselClass === c.vesselClass)!.id, c.id);
    for (let i = 0; i < MAX_ROUNDS; i++) n = propose(n, 0.05); // owner never accepts this
    expect(n.status).toBe('failed');
    expect(n.history).toHaveLength(MAX_ROUNDS);
    expect(() => propose(n, 10)).toThrow(/already failed/);
  });

  it('rejects a zero, negative or missing rate', () => {
    const m = generateMarket('2026-10-10');
    const c = m.cargoes[0]!;
    const n = startNegotiation(m, m.ships.find((s) => s.vesselClass === c.vesselClass)!.id, c.id);
    expect(() => propose(n, 0)).toThrow(/positive/);
    expect(() => propose(n, Number.NaN)).toThrow(/positive/);
  });

  it('lets a sensible broker close most winnable deals by meeting in the middle', () => {
    let winnable = 0;
    let closed = 0;
    for (const { market, shipId, cargoId } of allPairs()) {
      const ship = market.ships.find((s) => s.id === shipId)!;
      const cargo = market.cargoes.find((c) => c.id === cargoId)!;
      if (!hasDealZone(market, ship, cargo)) continue;
      winnable++;
      let n = startNegotiation(market, shipId, cargoId);
      while (n.status === 'open') n = propose(n, midpoint(n));
      if (n.status === 'agreed') closed++;
    }
    // Not every one: a too-greedy or too-stingy midpoint can run out of rounds.
    expect(closed / winnable).toBeGreaterThan(0.5);
  });
});

describe('firmOffer', () => {
  const m = generateMarket('2026-10-10');
  const c = m.cargoes[0]!;
  const open = () => startNegotiation(m, m.ships.find((s) => s.vesselClass === c.vesselClass)!.id, c.id);

  it('closes at once when the rate is inside both hidden limits', () => {
    let checked = 0;
    for (const { market, shipId, cargoId } of allPairs()) {
      const n = startNegotiation(market, shipId, cargoId);
      const { ownerFloorRate, chartererCeilingRate } = n.limits;
      if (ownerFloorRate > chartererCeilingRate) continue; // no deal zone for this pair
      const done = firmOffer(n, (ownerFloorRate + chartererCeilingRate) / 2);
      expect(done.status).toBe('agreed');
      expect(done.history[0]!.kind).toBe('firm');
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('ends the talks when either side says no, with no counters', () => {
    const n = open();
    const tooLow = firmOffer(n, n.limits.ownerFloorRate * 0.9);
    expect(tooLow.status).toBe('failed');
    expect(tooLow.history[0]!.ownerAccepted).toBe(false);
    expect(tooLow.ownerOffer).toBe(n.ownerOffer);
    const tooHigh = firmOffer(n, n.limits.chartererCeilingRate * 1.1);
    expect(tooHigh.status).toBe('failed');
    expect(tooHigh.history[0]!.chartererAccepted).toBe(false);
  });
});

describe('client behaviour varies', () => {
  it('opens and concedes differently from client to client', () => {
    const margins = new Set<number>();
    const concessions = new Set<number>();
    for (const { market, shipId, cargoId } of allPairs().slice(0, 30)) {
      const n = startNegotiation(market, shipId, cargoId);
      margins.add(Math.round((n.ownerOffer / n.limits.ownerFloorRate) * 100));
      concessions.add(Math.round(n.limits.ownerConcession * 100));
    }
    expect(margins.size).toBeGreaterThan(5);
    expect(concessions.size).toBeGreaterThan(5);
  });
});

describe('proposalsLeft', () => {
  it('counts every proposal and firm offer against the daily budget', () => {
    const m = generateMarket('2026-10-10');
    const c = m.cargoes[0]!;
    let n = startNegotiation(m, m.ships.find((s) => s.vesselClass === c.vesselClass)!.id, c.id);
    expect(proposalsLeft([n])).toBe(PROPOSALS_PER_DAY);
    n = propose(n, 0.05);
    n = propose(n, 0.05);
    expect(proposalsLeft([n])).toBe(PROPOSALS_PER_DAY - 2);
    expect(proposalsLeft([n, n])).toBe(PROPOSALS_PER_DAY - 4);
  });
});

