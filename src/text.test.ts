import { describe, expect, it } from 'vitest';
import { generateInbox, summarizeDay, endDay, startDay, attemptFix, isWorkable, negotiationLimits, research, type EnquiryEmail } from '../engine';
import {
  blockMessage,
  clockLabel,
  deadlineLabel,
  endOfDayText,
  fixOutcomeMessage,
  fixtureReasonText,
  hoursLabel,
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
    // 10 Oct: fix the Santos-Qingdao grain, then research Santos-Rotterdam at 13:00.
    // Research takes it to 13:30, too late for a 2 h fix due by 15:00, and the day ends.
    const enquiry = (to: string) =>
      inbox.emails.find((e): e is EnquiryEmail => e.kind === 'enquiry' && cargoOf(e.cargoId).loadPort === 'santos' && cargoOf(e.cargoId).dischargePort === to)!;
    const qingdao = enquiry('qingdao');
    const rotterdam = enquiry('rotterdam');
    const coal = inbox.emails.find((e): e is EnquiryEmail => e.kind === 'enquiry' && cargoOf(e.cargoId).commodity === 'coal')!;
    let s = startDay();
    // Use up the morning on the coal enquiry with a lowball (refused, costs 1 h), twice.
    const coalShip = inbox.market.ships.find((sh) => isWorkable(inbox.market, sh, cargoOf(coal.cargoId)))!;
    s = (attemptFix(inbox, s, coal.id, coalShip.id, 0.5) as { state: typeof s }).state;
    s = (attemptFix(inbox, s, coal.id, coalShip.id, 0.5) as { state: typeof s }).state;
    const qShip = inbox.market.ships.find((sh) => isWorkable(inbox.market, sh, cargoOf(qingdao.cargoId)))!;
    const l = negotiationLimits(inbox.market, qShip, cargoOf(qingdao.cargoId));
    s = (attemptFix(inbox, s, qingdao.id, qShip.id, (l.ownerFloorRate + l.chartererCeilingRate) / 2) as { state: typeof s }).state;
    s = { ...s, clockHour: 13 };
    const r = research(inbox, s, rotterdam.id);
    expect(r.ok && r.state.ended).toBe(true);
    const lines = endOfDayText(summarizeDay(inbox, r.state), cargoOf);
    expect(lines[0]).toBe('Day ended at 13:30 with 3.5 h left: nothing more you could act on.');
    expect(lines).toContain('69,000 t grain, Santos to Rotterdam: needed 2 h, but its deadline was 15:00.');
  });
});

