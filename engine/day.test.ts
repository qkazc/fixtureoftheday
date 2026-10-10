import { describe, expect, it } from 'vitest';
import {
  anyActionPossible,
  attemptFix,
  endDay,
  enquiryStatus,
  handleDistraction,
  hoursLeft,
  research,
  startDay,
  summarizeDay,
  type DayState,
} from './day';
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  DISTRACTION_PAYOUT_USD,
  generateInbox,
  RESEARCH_HOURS,
  type EnquiryEmail,
  type Inbox,
} from './inbox';
import { fitCheck, isWorkable, negotiationLimits, type CargoOrder, type ShipOffer } from './market';
import { scoreDay } from './scoring';

const DATES = Array.from({ length: 100 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 1 + i * 4)).toISOString().slice(0, 10),
);

const enquiries = (inbox: Inbox) => inbox.emails.filter((e): e is EnquiryEmail => e.kind === 'enquiry');
const cargoOf = (inbox: Inbox, e: EnquiryEmail) => inbox.market.cargoes.find((c) => c.id === e.cargoId)!;

/** A rate in the middle of the hidden deal zone: always accepted. */
const goodRate = (inbox: Inbox, ship: ShipOffer, cargo: CargoOrder) => {
  const l = negotiationLimits(inbox.market, ship, cargo);
  return (l.ownerFloorRate + l.chartererCeilingRate) / 2;
};

/**
 * Finds a day with a contested ship: one that is workable for two enquiries.
 * Returns the inbox, that ship, and the two enquiries.
 */
function contestedDay() {
  for (const date of DATES) {
    const inbox = generateInbox(date);
    for (const ship of inbox.market.ships) {
      const both = enquiries(inbox).filter((e) => isWorkable(inbox.market, ship, cargoOf(inbox, e)));
      if (both.length >= 2) return { inbox, ship, a: both[0]!, b: both[1]! };
    }
  }
  throw new Error('no contested day');
}

describe('the clock', () => {
  const inbox = generateInbox('2026-10-10');

  it('starts at 09:00 with 8 hours', () => {
    const s = startDay();
    expect(s.clockHour).toBe(DAY_START_HOUR);
    expect(hoursLeft(s)).toBe(8);
  });

  it('charges RESEARCH_HOURS for research, once per enquiry', () => {
    const e = enquiries(inbox)[0]!;
    const r = research(inbox, startDay(), e.id);
    expect(r.ok && r.state.clockHour).toBe(DAY_START_HOUR + RESEARCH_HOURS);
    if (!r.ok) return;
    expect(r.outcome.length).toBe(inbox.market.ships.length);
    const again = research(inbox, r.state, e.id);
    expect(again.ok).toBe(false);
  });

  it('charges the email’s effort for a fix attempt, whether or not it closes', () => {
    const { inbox: day, ship, a } = contestedDay();
    const cargo = cargoOf(day, a);
    const low = attemptFix(day, startDay(), a.id, ship.id, 0.5);
    expect(low.ok && low.outcome).toBe('refusedByOwner');
    expect(low.state.clockHour).toBe(DAY_START_HOUR + a.effortHours);
    const high = attemptFix(day, startDay(), a.id, ship.id, cargo.marketRateUsdPerTonne * 2);
    expect(high.ok && high.outcome).toBe('refusedByCharterer');
    const good = attemptFix(day, startDay(), a.id, ship.id, goodRate(day, ship, cargo));
    expect(good.ok && good.outcome).toBe('fixed');
    expect(good.state.clockHour).toBe(DAY_START_HOUR + a.effortHours);
  });

  it('leaves a refused enquiry open for another try if the deadline allows', () => {
    // An enquiry whose deadline leaves time for two attempts.
    for (const date of DATES) {
      const day = generateInbox(date);
      const e = enquiries(day).find((x) => x.deadlineHour! >= DAY_START_HOUR + 2 * x.effortHours);
      if (!e) continue;
      const cargo = cargoOf(day, e);
      const ship = day.market.ships.find((sh) => isWorkable(day.market, sh, cargo))!;
      const low = attemptFix(day, startDay(), e.id, ship.id, 0.5);
      expect(low.ok && low.outcome).toBe('refusedByOwner');
      expect(enquiryStatus(low.state, e)).toBe('open');
      const retry = attemptFix(day, low.state, e.id, ship.id, goodRate(day, ship, cargo));
      expect(retry.ok && retry.outcome).toBe('fixed');
      return;
    }
    throw new Error('no enquiry with time for two attempts');
  });

  it('charges an hour for the distraction and pays its small commission', () => {
    const d = inbox.emails.find((e) => e.kind === 'distraction')!;
    const r = handleDistraction(inbox, startDay(), d.id);
    expect(r.ok && r.state.clockHour).toBe(DAY_START_HOUR + 1);
    expect(summarizeDay(inbox, r.state).totalCommissionUsd).toBe(DISTRACTION_PAYOUT_USD);
    expect(handleDistraction(inbox, r.state, d.id).ok).toBe(false);
  });

  it('refuses actions that don’t fit in the hours left', () => {
    const late: DayState = { ...startDay(), clockHour: DAY_END_HOUR - 0.25 };
    const e = enquiries(inbox)[0]!;
    const r = research(inbox, late, e.id);
    expect(!r.ok && r.reason).toBe('notEnoughHours');
  });

  it('refuses everything once the day has ended', () => {
    const ended = endDay(startDay());
    const e = enquiries(inbox)[0]!;
    const r = research(inbox, ended, e.id);
    expect(!r.ok && r.reason).toBe('dayOver');
    expect(anyActionPossible(inbox, ended)).toBe(false);
  });
});

describe('deadlines', () => {
  it('loses an enquiry when there is no longer time to fix it before its deadline', () => {
    const inbox = generateInbox('2026-10-10');
    const e = enquiries(inbox).find((x) => x.deadlineHour! < DAY_END_HOUR)!;
    const before: DayState = { ...startDay(), clockHour: e.deadlineHour! - e.effortHours };
    expect(enquiryStatus(before, e)).toBe('open');
    const after: DayState = { ...before, clockHour: before.clockHour + 0.5 };
    expect(enquiryStatus(after, e)).toBe('lost');
    const ship = inbox.market.ships.find((s) => isWorkable(inbox.market, s, cargoOf(inbox, e)))!;
    const r = attemptFix(inbox, after, e.id, ship.id, goodRate(inbox, ship, cargoOf(inbox, e)));
    expect(!r.ok && r.reason).toBe('deadlinePassed');
  });

  it('makes the distraction miss its 10:00 deadline if you start elsewhere', () => {
    const inbox = generateInbox('2026-10-10');
    const d = inbox.emails.find((e) => e.kind === 'distraction')!;
    const late: DayState = { ...startDay(), clockHour: 9.5 };
    const r = handleDistraction(inbox, late, d.id);
    expect(!r.ok && r.reason).toBe('deadlinePassed');
  });
});

describe('ships', () => {
  it('removes a fixed ship from every other enquiry', () => {
    const { inbox, ship, a, b } = contestedDay();
    const first = attemptFix(inbox, startDay(), a.id, ship.id, goodRate(inbox, ship, cargoOf(inbox, a)));
    expect(first.ok && first.outcome).toBe('fixed');
    const second = attemptFix(inbox, first.state, b.id, ship.id, goodRate(inbox, ship, cargoOf(inbox, b)));
    expect(!second.ok && second.reason).toBe('shipAlreadyFixed');
    const r = research(inbox, first.state, b.id);
    expect(r.ok && r.outcome.some((row) => row.ship.id === ship.id)).toBe(false);
  });

  it('refuses a ship that is the wrong size or can’t make the laycan', () => {
    for (const date of DATES.slice(0, 20)) {
      const inbox = generateInbox(date);
      for (const e of enquiries(inbox)) {
        for (const ship of inbox.market.ships) {
          const fit = fitCheck(ship, cargoOf(inbox, e));
          if (fit.fits) continue;
          const r = attemptFix(inbox, startDay(), e.id, ship.id, 10);
          expect(!r.ok && r.reason).toBe(fit.problem);
        }
      }
    }
  });
});

describe('a sensible day', () => {
  it('can fix at least two enquiries on every one of 100 days', () => {
    for (const date of DATES) {
      const inbox = generateInbox(date);
      let s = startDay();
      const byDeadline = [...enquiries(inbox)].sort((x, y) => x.deadlineHour! - y.deadlineHour! || x.effortHours - y.effortHours);
      for (const e of byDeadline) {
        const cargo = cargoOf(inbox, e);
        const used = new Set(s.fixtures.map((f) => f.shipId));
        const ship = inbox.market.ships.find((sh) => !used.has(sh.id) && isWorkable(inbox.market, sh, cargo));
        if (!ship) continue;
        const r = attemptFix(inbox, s, e.id, ship.id, goodRate(inbox, ship, cargo));
        if (r.ok) s = r.state;
      }
      expect(s.fixtures.length, date).toBeGreaterThanOrEqual(2);
    }
  });

  it('ends by itself once nothing more can be done', () => {
    const inbox = generateInbox('2026-10-10');
    let s = startDay();
    // Burn time on lowball attempts until the day ends.
    for (let i = 0; i < 20 && !s.ended; i++) {
      const e = enquiries(inbox).find((x) => enquiryStatus(s, x) === 'open');
      if (!e) break;
      const ship = inbox.market.ships.find((sh) => fitCheck(sh, cargoOf(inbox, e)).fits)!;
      const r = attemptFix(inbox, s, e.id, ship.id, 0.5);
      if (!r.ok) break;
      s = r.state;
    }
    expect(s.ended).toBe(true);
    expect(anyActionPossible(inbox, s)).toBe(false);
  });
});

describe('summarizeDay', () => {
  it('matches scoreDay for the fixtures and lists the rest as skipped', () => {
    const { inbox, ship, a } = contestedDay();
    const rate = goodRate(inbox, ship, cargoOf(inbox, a));
    const r = attemptFix(inbox, startDay(), a.id, ship.id, rate);
    expect(r.ok).toBe(true);
    const summary = summarizeDay(inbox, r.state);
    const expected = scoreDay(inbox.market, [{ shipId: ship.id, cargoId: a.cargoId, rateUsdPerTonne: rate }]);
    expect(summary.fixtures).toHaveLength(1);
    expect(summary.totalCommissionUsd).toBeCloseTo(expected.totalBrokerageUsd, 6);
    expect(summary.totalScore).toBeCloseTo(expected.totalScore, 6);
    expect(summary.avgOwnerSatisfaction).toBeCloseTo(expected.fixtures[0]!.ownerSatisfaction, 6);
    expect(summary.skippedEnquiries.map((x) => x.email.id)).not.toContain(a.id);
    expect(summary.skippedEnquiries).toHaveLength(enquiries(inbox).length - 1);
    expect(summary.distractionSkipped).toBe(true);
  });

  it('names a ship that could have fixed every skipped enquiry, on 100 days', () => {
    for (const date of DATES) {
      const inbox = generateInbox(date);
      const summary = summarizeDay(inbox, endDay(startDay()));
      expect(summary.fixtures).toHaveLength(0);
      expect(summary.avgOwnerSatisfaction).toBeNull();
      for (const skipped of summary.skippedEnquiries) {
        const could = skipped.couldHaveFixed;
        expect(could, `${date} ${skipped.email.id}`).not.toBeNull();
        expect(isWorkable(inbox.market, could!.ship, cargoOf(inbox, skipped.email))).toBe(true);
        expect(could!.approxCommissionUsd).toBeGreaterThan(0);
      }
    }
  });

  it('explains a long-ballast fixture as such', () => {
    for (const date of DATES) {
      const inbox = generateInbox(date);
      for (const e of enquiries(inbox)) {
        const cargo = cargoOf(inbox, e);
        for (const ship of inbox.market.ships) {
          if (!isWorkable(inbox.market, ship, cargo)) continue;
          const floor = negotiationLimits(inbox.market, ship, cargo).ownerFloorRate;
          const r = attemptFix(inbox, startDay(), e.id, ship.id, floor + 0.01);
          if (!r.ok || r.outcome !== 'fixed') continue;
          const reason = summarizeDay(inbox, r.state).fixtures[0]!.reason;
          if (reason.kind === 'longBallast') {
            expect(reason.ballastNm).toBeGreaterThan(2000);
            return;
          }
        }
      }
    }
    throw new Error('no long-ballast fixture found in 100 days');
  });
});
