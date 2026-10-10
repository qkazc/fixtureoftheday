import { describe, expect, it } from 'vitest';
import { generateMarket, hasDealZone, type DailyMarket } from './market';
import {
  isFinalRound,
  MAX_ROUNDS,
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

const midpoint = (n: Negotiation) => Math.round(((n.ownerOffer + n.chartererBid) / 2) * 20) / 20;

describe('startNegotiation', () => {
  it('opens with the offer above the bid, each inside its side’s limit', () => {
    for (const { market, shipId, cargoId } of allPairs()) {
      const n = startNegotiation(market, shipId, cargoId);
      expect(n.status).toBe('open');
      expect(n.ownerOffer).toBeGreaterThan(n.chartererBid);
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
    const m = generateMarket('2026-10-10');
    const c = m.cargoes[0]!;
    let n = startNegotiation(m, m.ships.find((s) => s.vesselClass === c.vesselClass)!.id, c.id);
    // Make the positions overlap by hand, then propose inside the overlap.
    n = { ...n, ownerOffer: 10, chartererBid: 11 };
    const done = propose(n, 10.5);
    expect(done.status).toBe('agreed');
    expect(done.agreedRate).toBe(10.5);
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

  it('before the last call, only accepts rates that meet the current position', () => {
    const m = generateMarket('2026-10-10');
    const c = m.cargoes[0]!;
    const n = startNegotiation(m, m.ships.find((s) => s.vesselClass === c.vesselClass)!.id, c.id);
    // Inside the owner's limit but below their current offer: not yet.
    const r = propose(n, (n.limits.ownerFloorRate + n.ownerOffer) / 2);
    expect(r.history[0]!.ownerAccepted).toBe(false);
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
