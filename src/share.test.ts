import { describe, expect, it } from 'vitest';
import { attemptFix, endDay, generateInbox, isWorkable, negotiationLimits, startDay, summarizeDay, type EnquiryEmail } from '../engine';
import { resultSquares, shareText } from './share';

const inbox = generateInbox('2026-10-10');
const enquiries = inbox.emails.filter((e): e is EnquiryEmail => e.kind === 'enquiry');

describe('shareText', () => {
  it('summarises an empty day with one black square per enquiry', () => {
    const summary = summarizeDay(inbox, endDay(startDay()));
    expect(resultSquares(inbox, summary)).toBe('⬛'.repeat(enquiries.length));
    const text = shareText(inbox, summary);
    expect(text.split('\n')).toEqual([
      'Fixture of the Day · 10 Oct 2026',
      `⚓ 0/${enquiries.length} fixed · $0 commission`,
      'Owners – · Charterers – · Score 0',
      '⬛'.repeat(enquiries.length),
    ]);
  });

  it('marks a fixed enquiry, and gives away no ship names or rates', () => {
    const e = enquiries[0]!;
    const cargo = inbox.market.cargoes.find((c) => c.id === e.cargoId)!;
    const ship = inbox.market.ships.find((s) => isWorkable(inbox.market, s, cargo))!;
    const l = negotiationLimits(inbox.market, ship, cargo);
    const rate = (l.ownerFloorRate + l.chartererCeilingRate) / 2;
    const r = attemptFix(inbox, startDay(), e.id, ship.id, rate);
    if (!r.ok) throw new Error('fix blocked');
    const summary = summarizeDay(inbox, endDay(r.state));
    const squares = resultSquares(inbox, summary);
    expect([...squares].filter((c) => c === '🟩' || c === '🟨')).toHaveLength(1);
    const text = shareText(inbox, summary);
    expect(text).toContain(`1/${enquiries.length} fixed`);
    for (const s of inbox.market.ships) expect(text).not.toContain(s.name);
    expect(text).not.toContain(rate.toFixed(2));
  });
});
