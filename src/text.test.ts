import { describe, expect, it } from 'vitest';
import { generateInbox, summarizeDay, endDay, startDay, attemptFix, isWorkable, negotiationLimits, research, solveDay, type BestDay, type EnquiryEmail, type Inbox } from '../engine';
import {
  bestPlanText,
  blockMessage,
  cargoLabel,
  clockLabel,
  deadlineLabel,
  endOfDayText,
  fixOutcomeMessage,
  fixtureReasonText,
  hoursLabel,
  parPercent,
  roughUsd,
  skippedText,
} from './text';

describe('labels', () => {
  it('formats clock times, deadlines, hours and rough money', () => {
    expect(clockLabel(9)).toBe('09:00');
    expect(clockLabel(13.5)).toBe('13:30');
    expect(deadlineLabel(11)).toBe('answer by 11:00');
    expect(deadlineLabel(17)).toBe('no rush');
    expect(deadlineLabel(null)).toBe('no rush');
    expect(hoursLabel(2)).toBe('2 h');
    expect(hoursLabel(0.5)).toBe('0.5 h');
    expect(roughUsd(15_000)).toBe('~$15k');
    expect(roughUsd(1_500)).toBe('~$1.5k');
    expect(roughUsd(2_000)).toBe('~$2k');
    expect(roughUsd(500)).toBe('~$500');
  });

  it('has a message for every blocked action', () => {
    expect(blockMessage('missesLaycan')).toMatch(/laycan/);
    expect(blockMessage('shipAlreadyFixed')).toMatch(/already been fixed/);
  });

  it('says who refused a fix', () => {
    expect(fixOutcomeMessage('fixed', 9.5)).toBe('Fixed at $9.50/t.');
    expect(fixOutcomeMessage('refusedByOwner', 9.5)).toMatch(/owner/);
    expect(fixOutcomeMessage('refusedByCharterer', 9.5)).toMatch(/charterer/);
  });
});

describe('end-of-day text', () => {
  const inbox = generateInbox('2026-10-10');
  const enquiries = inbox.emails.filter((e): e is EnquiryEmail => e.kind === 'enquiry');

  it('names the ship, its size and distance for a skipped enquiry', () => {
    const summary = summarizeDay(inbox, endDay(startDay()));
    const s = summary.skippedEnquiries[0]!;
    const text = skippedText(s);
    expect(text).toContain(s.couldHaveFixed!.ship.name);
    expect(text).toMatch(/nm away, could have fixed it for about \$[\d,]+ commission\./);
  });

  it('explains each fixture in one sentence', () => {
    const e = enquiries[0]!;
    const cargo = inbox.market.cargoes.find((c) => c.id === e.cargoId)!;
    const ship = inbox.market.ships.find((s) => isWorkable(inbox.market, s, cargo))!;
    const l = negotiationLimits(inbox.market, ship, cargo);
    const r = attemptFix(inbox, startDay(), e.id, ship.id, (l.ownerFloorRate + l.chartererCeilingRate) / 2);
    expect(r.ok).toBe(true);
    const line = fixtureReasonText(summarizeDay(inbox, r.state).fixtures[0]!);
    expect(line).toMatch(/\.$/);
    expect(line.length).toBeGreaterThan(20);
  });
});

describe('endOfDayText', () => {
  const inbox = generateInbox('2026-10-10');
  const cargoOf = (id: string) => inbox.market.cargoes.find((c) => c.id === id)!;

  it('says when the player ended the day', () => {
    expect(endOfDayText(summarizeDay(inbox, endDay(startDay())), cargoOf)).toEqual([
      'You ended the day at 09:00 with 8 h left.',
    ]);
  });

  it('explains an early end: the time, and why each enquiry was out of reach', () => {
    // Every enquiry due at 15:00. Research one at 14:00: that takes the clock
    // to 14:30, too late for any fix (each takes at least 1 h), so the day ends.
    const due15: Inbox = { ...inbox, emails: inbox.emails.map((e) => (e.kind === 'enquiry' ? { ...e, deadlineHour: 15 } : e)) };
    const enquiries = due15.emails.filter((e): e is EnquiryEmail => e.kind === 'enquiry');
    const r = research(due15, { ...startDay(), clockHour: 14 }, enquiries[0]!.id);
    expect(r.ok && r.state.ended).toBe(true);
    const lines = endOfDayText(summarizeDay(due15, r.state), cargoOf);
    expect(lines[0]).toBe('Day ended at 14:30 with 2.5 h left: nothing more you could act on.');
    for (const e of enquiries) {
      const why = 14.5 + e.effortHours > 17 ? 'more than the time left' : 'but its deadline was 15:00';
      expect(lines).toContain(`${cargoLabel(cargoOf(e.cargoId))}: needed ${e.effortHours} h, ${why}.`);
    }
  });
});


describe('parPercent', () => {
  it('rounds to a whole percentage and never passes 100', () => {
    expect(parPercent(0, 1000)).toBe(0);
    expect(parPercent(854, 1000)).toBe(85);
    expect(parPercent(1000, 1000)).toBe(100);
    expect(parPercent(1000.4, 1000)).toBe(100);
    expect(parPercent(0, 0)).toBe(100);
  });
});

describe('bestPlanText', () => {
  const inbox = generateInbox('2026-10-10');

  it('lists the best day as timed steps, one per fix', () => {
    const best = solveDay(inbox);
    const lines = bestPlanText(inbox, best);
    expect(lines).toHaveLength(best.fixes.length + (best.handlesDistraction ? 1 : 0));
    expect(lines[0]).toMatch(/^09:00 /);
    for (const f of best.fixes) expect(lines.some((l) => l.includes(`at $${f.rateUsdPerTonne.toFixed(2)}/t.`))).toBe(true);
  });

  it('starts with the urgent parcel when the plan handles it', () => {
    const best: BestDay = { score: 1, commissionUsd: 1, handlesDistraction: true, fixes: [] };
    expect(bestPlanText(inbox, best)).toEqual(['09:00 Handle the urgent small parcel ($1,500).']);
  });
});
