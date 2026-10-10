import { describe, expect, it } from 'vitest';
import { dailyPuzzle, MAX_VARIANTS, naiveScore, rateDay } from './daily';
import { generateInbox } from './inbox';
import { chartererCeilingShare, GENERATOR_VERSION, ownerFloorShare } from './market';
import { hashSeed } from './random';
import { bestRate } from './solver';

const YEAR = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
const PUZZLES = YEAR.map(dailyPuzzle);

describe('naiveScore', () => {
  it('never beats the best possible day', () => {
    for (const date of YEAR.slice(0, 60)) {
      const inbox = generateInbox(date);
      expect(naiveScore(inbox)).toBeLessThanOrEqual(rateDay(inbox).best.score + 1e-6);
    }
  });
});

describe('rateDay', () => {
  it('rates a day by how far the naive plan falls short', () => {
    const r = rateDay(generateInbox('2026-10-10'));
    expect(r.trapGap).toBeCloseTo(1 - r.naiveScore / r.best.score, 9);
    expect(r.trapGap).toBeGreaterThanOrEqual(0);
    expect(r.trapGap).toBeLessThan(1);
  });
});

describe('dailyPuzzle', () => {
  it('is the same puzzle every time for a date', () => {
    expect(dailyPuzzle('2026-10-10')).toEqual(dailyPuzzle('2026-10-10'));
  });

  it('is one of the date’s seeded variants', () => {
    for (const p of PUZZLES.slice(0, 30)) {
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(MAX_VARIANTS);
      expect(p.inbox).toEqual(generateInbox(p.inbox.date, p.variant));
    }
  });

  it('gives a fair day every day of a year, and an interesting one almost every day', () => {
    expect(PUZZLES.filter((p) => !p.rating.fair)).toEqual([]);
    const dull = PUZZLES.filter((p) => !p.rating.interesting).length;
    expect(dull / PUZZLES.length).toBeLessThan(0.02);
  });

  it('keeps every enquiry winnable with a quotable rate', () => {
    for (const { inbox } of PUZZLES) {
      for (const cargo of inbox.market.cargoes) {
        expect(inbox.market.ships.some((s) => bestRate(inbox.market, s, cargo)), `${inbox.date} ${cargo.id}`).toBe(true);
      }
    }
  });
});

describe('generator version', () => {
  // A fingerprint of everything a player meets on a few dates: the inbox, the
  // market and every client's hidden limit. If this fails, a change has
  // altered the puzzles. If that was intended, bump GENERATOR_VERSION in
  // market.ts (so old saves are discarded) and update these fingerprints.
  const fingerprint = (date: string) => {
    const { inbox } = dailyPuzzle(date);
    const { market } = inbox;
    const limits = [
      ...market.ships.map((s) => ownerFloorShare(market, s)),
      ...market.cargoes.map((c) => chartererCeilingShare(market, c)),
    ];
    return hashSeed(JSON.stringify({ inbox, limits })).toString(16);
  };

  it(`still generates the same puzzles for version ${GENERATOR_VERSION}`, () => {
    expect(GENERATOR_VERSION).toBe(1);
    expect(['2026-01-01', '2026-10-10', '2027-06-30'].map(fingerprint)).toEqual(['26541012', 'f1c6b0d9', 'ffceb357']);
  });
});
