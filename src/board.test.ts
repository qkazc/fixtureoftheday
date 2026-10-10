import { describe, expect, it } from 'vitest';
import {
  attemptFix,
  fitCheck,
  generateInbox,
  isWorkable,
  negotiationLimits,
  research,
  startDay,
  type EnquiryEmail,
} from '../engine';
import { boardCell, matchRows } from './board';

const inbox = generateInbox('2026-10-10');
const enquiries = inbox.emails.filter((e): e is EnquiryEmail => e.kind === 'enquiry');
const cargoOf = (e: EnquiryEmail) => inbox.market.cargoes.find((c) => c.id === e.cargoId)!;
// An enquiry and a ship that can work it.
const e = enquiries.find((x) => inbox.market.ships.some((s) => isWorkable(inbox.market, s, cargoOf(x))))!;
const ship = inbox.market.ships.find((s) => isWorkable(inbox.market, s, cargoOf(e)))!;

describe('boardCell', () => {
  it('always shows the ballast distance, but hides the estimate until researched', () => {
    const before = boardCell(inbox, startDay(), ship.id, e);
    expect(before.ballastNm).toBeGreaterThanOrEqual(0);
    expect(before.estTceUsdPerDay).toBeNull();
    const r = research(inbox, startDay(), e.id);
    expect(r.ok).toBe(true);
    const after = boardCell(inbox, r.state, ship.id, e);
    expect(after.estTceUsdPerDay).not.toBeNull();
    expect(after.estTceRatio).toBeGreaterThan(0);
  });

  it('reports wrong size and missed laycans, with no estimate for the wrong size', () => {
    const r = research(inbox, startDay(), e.id);
    if (!r.ok) throw new Error('research failed');
    for (const s of inbox.market.ships) {
      const cell = boardCell(inbox, r.state, s.id, e);
      const check = fitCheck(s, cargoOf(e));
      expect(cell.fit).toBe(check.fits ? 'fits' : check.problem);
      if (cell.fit === 'wrongSize') expect(cell.estTceUsdPerDay).toBeNull();
    }
  });

  it('marks fixed cells, taken ships and closed enquiries', () => {
    const l = negotiationLimits(inbox.market, ship, cargoOf(e));
    const r = attemptFix(inbox, startDay(), e.id, ship.id, (l.ownerFloorRate + l.chartererCeilingRate) / 2);
    if (!r.ok || r.outcome !== 'fixed') throw new Error('fix failed');
    expect(boardCell(inbox, r.state, ship.id, e).state).toBe('fixedHere');
    const other = enquiries.find((x) => x !== e)!;
    expect(boardCell(inbox, r.state, ship.id, other).state).toBe('shipTaken');
    const otherShip = inbox.market.ships.find((s) => s.id !== ship.id)!;
    expect(boardCell(inbox, r.state, otherShip.id, e).state).toBe('enquiryClosed');
    expect(boardCell(inbox, startDay(), otherShip.id, other).state).toBe('open');
  });
});

describe('matchRows', () => {
  const rows = matchRows(inbox, startDay());

  it('has one row per enquiry, soonest deadline first', () => {
    expect(rows).toHaveLength(enquiries.length);
    const deadlines = rows.map((r) => r.email.deadlineHour!);
    expect(deadlines).toEqual([...deadlines].sort((a, b) => a - b));
  });

  it('lists only ships of the right size, nearest first', () => {
    for (const row of rows) {
      expect(row.candidates.length).toBeGreaterThan(0);
      for (const c of row.candidates) expect(c.ship.vesselClass).toBe(row.cargo.vesselClass);
      const nm = row.candidates.map((c) => c.cell.ballastNm);
      expect(nm).toEqual([...nm].sort((a, b) => a - b));
    }
  });

  it('shows the contested ship under two enquiries', () => {
    const counts = new Map<string, number>();
    for (const row of rows) for (const c of row.candidates) if (c.cell.fit === 'fits') counts.set(c.ship.id, (counts.get(c.ship.id) ?? 0) + 1);
    expect([...counts.values()].some((n) => n >= 2)).toBe(true);
  });
});

