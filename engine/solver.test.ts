import { describe, expect, it } from 'vitest';
import { attemptFix, handleDistraction, startDay, summarizeDay, type DayState } from './day';
import { generateInbox, type EnquiryEmail, type Inbox } from './inbox';
import { negotiationLimits, quoteRange } from './market';
import { scoreDay } from './scoring';
import { bestRate, solveDay } from './solver';

const dates = (n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString().slice(0, 10));
const INBOXES = dates(100).map((d) => generateInbox(d));
const enquiriesOf = (inbox: Inbox) => inbox.emails.filter((e): e is EnquiryEmail => e.kind === 'enquiry');
const cargoOf = (inbox: Inbox, e: EnquiryEmail) => inbox.market.cargoes.find((c) => c.id === e.cargoId)!;

/** Plays a plan through the real day, so the solver can't cheat the rules. */
function play(inbox: Inbox, plan: ReturnType<typeof solveDay>): DayState {
  let day = startDay();
  if (plan.handlesDistraction) {
    const r = handleDistraction(inbox, day, inbox.emails.find((e) => e.kind === 'distraction')!.id);
    if (!r.ok) throw new Error(`distraction refused: ${r.reason}`);
    day = r.state;
  }
  for (const f of plan.fixes) {
    const r = attemptFix(inbox, day, f.emailId, f.shipId, f.rateUsdPerTonne);
    if (!r.ok) throw new Error(`${inbox.date} ${f.emailId}: ${r.reason}`);
    if (r.outcome !== 'fixed') throw new Error(`${inbox.date} ${f.emailId}: ${r.outcome}`);
    day = r.state;
  }
  return day;
}

/** Every sequence of actions through the real day: slow, but obviously right. */
function bruteForceBest(inbox: Inbox): number {
  const distraction = inbox.emails.find((e) => e.kind === 'distraction')!;
  let best = 0;
  const walk = (day: DayState) => {
    best = Math.max(best, summarizeDay(inbox, day).totalScore);
    const d = handleDistraction(inbox, day, distraction.id);
    if (d.ok) walk(d.state);
    for (const e of enquiriesOf(inbox)) {
      for (const ship of inbox.market.ships) {
        const rate = bestRate(inbox.market, ship, cargoOf(inbox, e));
        if (!rate) continue;
        const r = attemptFix(inbox, day, e.id, ship.id, rate.rateUsdPerTonne);
        if (r.ok && r.outcome === 'fixed') walk(r.state);
      }
    }
  };
  walk(startDay());
  return best;
}

describe('quoteRange', () => {
  it('runs from 70% to 130% of the rate idea, on the $0.05 grid', () => {
    expect(quoteRange(10)).toEqual({ min: 7, max: 13 });
    const r = quoteRange(12.35);
    expect(r.min).toBe(8.65);
    expect(r.max).toBe(16.05);
  });
});

describe('bestRate', () => {
  it('is a quotable rate inside both limits, and no neighbouring rate scores more', () => {
    for (const inbox of INBOXES.slice(0, 20)) {
      for (const cargo of inbox.market.cargoes) {
        for (const ship of inbox.market.ships) {
          const best = bestRate(inbox.market, ship, cargo);
          if (!best) continue;
          const l = negotiationLimits(inbox.market, ship, cargo);
          expect(best.rateUsdPerTonne).toBeGreaterThanOrEqual(l.ownerFloorRate);
          expect(best.rateUsdPerTonne).toBeLessThanOrEqual(l.chartererCeilingRate);
          expect(Math.round(best.rateUsdPerTonne * 20)).toBeCloseTo(best.rateUsdPerTonne * 20, 9);
          for (const nudge of [-0.05, 0.05]) {
            const rate = Math.round((best.rateUsdPerTonne + nudge) * 20) / 20;
            if (rate < l.ownerFloorRate || rate > l.chartererCeilingRate) continue;
            const score = scoreDay(inbox.market, [{ shipId: ship.id, cargoId: cargo.id, rateUsdPerTonne: rate }]).totalScore;
            expect(score).toBeLessThanOrEqual(best.score);
          }
        }
      }
    }
  });

  it('is null for a ship of the wrong size', () => {
    const inbox = INBOXES[0]!;
    const cargo = inbox.market.cargoes[0]!;
    const wrong = inbox.market.ships.find((s) => s.vesselClass !== cargo.vesselClass)!;
    expect(bestRate(inbox.market, wrong, cargo)).toBeNull();
  });

  it('finds a quotable rate for every enquiry on every day', () => {
    for (const inbox of INBOXES) {
      for (const cargo of inbox.market.cargoes) {
        expect(inbox.market.ships.some((s) => bestRate(inbox.market, s, cargo)), `${inbox.date} ${cargo.id}`).toBe(true);
      }
    }
  });
});

describe('solveDay', () => {
  it('gives a plan that plays through the real day and scores what it says', () => {
    for (const inbox of INBOXES) {
      const plan = solveDay(inbox);
      const summary = summarizeDay(inbox, play(inbox, plan));
      expect(summary.totalScore).toBeCloseTo(plan.score, 6);
      expect(summary.totalCommissionUsd).toBeCloseTo(plan.commissionUsd, 6);
      expect(plan.score).toBeGreaterThan(0);
    }
  });

  it('matches a brute-force search over every sequence of actions', () => {
    for (const inbox of INBOXES.slice(0, 8)) {
      expect(solveDay(inbox).score, inbox.date).toBeCloseTo(bruteForceBest(inbox), 6);
    }
  });

  it('is the same every time for the same day', () => {
    expect(solveDay(generateInbox('2026-10-10'))).toEqual(solveDay(generateInbox('2026-10-10')));
  });
});
