import { describe, expect, it } from 'vitest';
import { generateInbox, startDay, type DayState } from '../engine';
import { inboxRows } from './inboxRows';
import { compactUsd } from './format';

const inbox = generateInbox('2026-10-10');

describe('inboxRows', () => {
  const rows = inboxRows(inbox, startDay());

  it('lists every email once: actions first by deadline, then reference', () => {
    expect(rows.map((r) => r.id).sort()).toEqual(inbox.emails.map((e) => e.id).sort());
    const firstReference = rows.findIndex((r) => r.group === 'reference');
    expect(rows.slice(firstReference).every((r) => r.group === 'reference')).toBe(true);
    const dues = rows.filter((r) => r.group === 'action').map((r) => (r.due === 'no rush' ? '17:00' : r.due));
    expect(dues).toEqual([...dues].sort());
  });

  it('tags emails by type and summarises enquiries in one short line', () => {
    const cargo = rows.find((r) => r.tag === 'CARGO')!;
    expect(cargo.summary).toMatch(/^(Supramax|Panamax|Capesize) · [\d,]+ t \w[\w ]* · .+ → .+$/);
    expect(cargo.stakes).toMatch(/^\d h · ~\$\d+(\.\d)?k$/);
    expect(rows.find((r) => r.tag === 'URGENT')!.due).toBe('10:00');
    expect(rows.filter((r) => r.tag === 'SHIPS').every((r) => r.due === '' && r.stakes === '')).toBe(true);
  });

  it('flags a deadline as close when less than an hour of slack is left', () => {
    const urgent = rows.find((r) => r.tag === 'URGENT')!;
    expect(urgent.dueSoon).toBe(true); // 1 h job due 10:00 at 09:00: no slack
    const late: DayState = { ...startDay(), clockHour: 10.5 };
    expect(inboxRows(inbox, late).find((r) => r.tag === 'URGENT')!.status).toBe('MISSED');
  });
});

describe('compactUsd', () => {
  it('shortens thousands', () => {
    expect(compactUsd(18_844)).toBe('$18.8k');
    expect(compactUsd(950)).toBe('$950');
    expect(compactUsd(-2_857)).toBe('−$2.9k');
  });
});
