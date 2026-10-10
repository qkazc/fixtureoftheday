import { describe, expect, it } from 'vitest';
import {
  approxCommission,
  calendarDay,
  DAY_START_HOUR,
  FIX_EFFORT_HOURS,
  generateInbox,
  RESEARCH_HOURS,
  type EnquiryEmail,
  type Inbox,
} from './inbox';
import { isWorkable } from './market';

const DATES = Array.from({ length: 100 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 1 + i * 4)).toISOString().slice(0, 10),
);
const INBOXES: Inbox[] = DATES.map(generateInbox);
const enquiries = (inbox: Inbox) => inbox.emails.filter((e): e is EnquiryEmail => e.kind === 'enquiry');
const count = (inbox: Inbox, kind: string) => inbox.emails.filter((e) => e.kind === kind).length;

describe('generateInbox', () => {
  it('gives everyone the same inbox for the same date', () => {
    expect(generateInbox('2026-10-10')).toEqual(generateInbox('2026-10-10'));
    expect(generateInbox('2026-10-10')).not.toEqual(generateInbox('2026-10-11'));
  });

  it.each(INBOXES.map((inbox) => [inbox.date, inbox] as const))('has the right mix of emails on %s', (_, inbox) => {
    expect(count(inbox, 'enquiry')).toBeGreaterThanOrEqual(3);
    expect(count(inbox, 'enquiry')).toBeLessThanOrEqual(4);
    expect(count(inbox, 'positionList')).toBeGreaterThanOrEqual(1);
    expect(count(inbox, 'positionList')).toBeLessThanOrEqual(2);
    expect(count(inbox, 'brokerNote')).toBe(1);
    expect(count(inbox, 'distraction')).toBe(1);
    expect(inbox.emails.length).toBeGreaterThanOrEqual(7);
    expect(inbox.emails.length).toBeLessThanOrEqual(8);
    expect(new Set(inbox.emails.map((e) => e.id)).size).toBe(inbox.emails.length);
  });

  it('puts every ship on exactly one position list, with 2-3 ships each', () => {
    for (const inbox of INBOXES) {
      const lists = inbox.emails.filter((e) => e.kind === 'positionList');
      const listed = lists.flatMap((e) => (e.kind === 'positionList' ? e.shipIds : []));
      expect([...listed].sort()).toEqual(inbox.market.ships.map((s) => s.id).sort());
      for (const l of lists) if (l.kind === 'positionList') {
        expect(l.shipIds.length).toBeGreaterThanOrEqual(2);
        expect(l.shipIds.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('gives each enquiry a deadline that leaves time to research and fix it', () => {
    for (const inbox of INBOXES) {
      for (const e of enquiries(inbox)) {
        const cargo = inbox.market.cargoes.find((c) => c.id === e.cargoId)!;
        expect(e.effortHours).toBe(FIX_EFFORT_HOURS[cargo.vesselClass]);
        expect(e.deadlineHour!).toBeGreaterThanOrEqual(DAY_START_HOUR + RESEARCH_HOURS + e.effortHours);
        expect(e.approxCommissionUsd).toBe(approxCommission(cargo));
      }
    }
  });

  it('makes the distraction look urgent but pay far less than any enquiry', () => {
    for (const inbox of INBOXES) {
      const d = inbox.emails.find((e) => e.kind === 'distraction')!;
      expect(d.subject).toMatch(/URGENT/);
      expect(d.deadlineHour).toBe(10);
      const smallest = Math.min(...enquiries(inbox).map((e) => e.approxCommissionUsd));
      expect(d.approxCommissionUsd).toBeLessThan(smallest / 3);
    }
  });

  it('is always winnable: every enquiry has a ship that fits, makes the laycan and has a deal zone', () => {
    for (const inbox of INBOXES) {
      for (const e of enquiries(inbox)) {
        const cargo = inbox.market.cargoes.find((c) => c.id === e.cargoId)!;
        expect(inbox.market.ships.some((s) => isWorkable(inbox.market, s, cargo)), `${inbox.date} ${e.id}`).toBe(true);
      }
    }
  });

  it('always has a ship that is a workable fit for two enquiries, so the player must choose', () => {
    for (const inbox of INBOXES) {
      const { market } = inbox;
      const shared = market.ships.some((s) => market.cargoes.filter((c) => isWorkable(market, s, c)).length >= 2);
      expect(shared, inbox.date).toBe(true);
    }
  });

  it('writes the broker note as one line', () => {
    for (const inbox of INBOXES.slice(0, 10)) {
      const note = inbox.emails.find((e) => e.kind === 'brokerNote')!;
      expect(note.body).toHaveLength(1);
    }
  });
});

describe('calendarDay', () => {
  it('counts days from the inbox date, across month ends', () => {
    expect(calendarDay('2026-10-10', 0)).toBe('10 Oct');
    expect(calendarDay('2026-10-30', 3)).toBe('2 Nov');
  });
});
