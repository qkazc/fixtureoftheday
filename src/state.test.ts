import { describe, expect, it } from 'vitest';
import { generateMarket, MAX_ROUNDS, type Negotiation } from '../engine';
import {
  availableShips,
  boardCell,
  chooseShip,
  evaluate,
  initialSelections,
  isLocked,
  sendProposal,
  toFixtures,
  voyageOutline,
} from './state';

const market = generateMarket('2026-10-10');
// That day: C4 is Tubarão iron ore (Capesize); S3 is a Capesize open at Tubarão.

/** Plays the last call at a rate inside both hidden limits, so the deal closes. */
function closeDeal(selections: ReturnType<typeof initialSelections>, cargoId: string) {
  let s = selections;
  for (let i = 0; i < MAX_ROUNDS - 1; i++) s = sendProposal(s, cargoId, 0.05);
  const n = s[cargoId]!.negotiation as Negotiation;
  return sendProposal(s, cargoId, (n.limits.ownerFloorRate + n.limits.chartererCeilingRate) / 2);
}

describe('choosing ships', () => {
  it('offers only ships of the cargo class', () => {
    const ships = availableShips(market, initialSelections(market), 'C4');
    expect(ships.length).toBeGreaterThan(0);
    for (const s of ships) expect(s.vesselClass).toBe('capesize');
  });

  it('opens talks when a ship is chosen, and hides that ship from other cargoes', () => {
    const s = chooseShip(market, initialSelections(market), 'C4', 'S3');
    expect(s['C4']!.negotiation?.status).toBe('open');
    expect(availableShips(market, s, 'C1').map((x) => x.id)).not.toContain('S3');
    expect(availableShips(market, s, 'C4').map((x) => x.id)).toContain('S3');
  });

  it('locks the ship once a proposal has been sent', () => {
    let s = chooseShip(market, initialSelections(market), 'C4', 'S3');
    expect(isLocked(s['C4']!)).toBe(false);
    s = sendProposal(s, 'C4', 1);
    expect(isLocked(s['C4']!)).toBe(true);
    expect(chooseShip(market, s, 'C4', 'S2')).toBe(s);
  });

  it('frees the ship for other cargoes if talks fail', () => {
    let s = chooseShip(market, initialSelections(market), 'C4', 'S3');
    for (let i = 0; i < MAX_ROUNDS; i++) s = sendProposal(s, 'C4', 0.05);
    expect(s['C4']!.negotiation?.status).toBe('failed');
    expect(availableShips(market, s, 'C1').map((x) => x.id)).toContain('S3');
  });

  it('gives the ballast distance and voyage days before any rate is agreed', () => {
    const o = voyageOutline(market, 'S3', 'C4');
    expect(o.ballastNm).toBe(0); // S3 is already at Tubarão
    expect(o.days).toBeGreaterThan(10);
  });
});

describe('scoring', () => {
  it('scores nothing before any deal is agreed', () => {
    const s = chooseShip(market, initialSelections(market), 'C4', 'S3');
    expect(toFixtures(s)).toEqual([]);
    expect(evaluate(market, s).totalScore).toBe(0);
  });

  it('scores an agreed deal at the agreed rate', () => {
    const s = closeDeal(chooseShip(market, initialSelections(market), 'C4', 'S3'), 'C4');
    expect(s['C4']!.negotiation?.status).toBe('agreed');
    const [fixture] = toFixtures(s);
    expect(fixture).toEqual({ cargoId: 'C4', shipId: 'S3', rateUsdPerTonne: s['C4']!.negotiation!.agreedRate });
    const e = evaluate(market, s);
    expect(e.byCargo['C4']?.status).toBe('fixed');
    expect(e.totalScore).toBeGreaterThan(0);
  });

  it('ignores proposals for a cargo with no open talks', () => {
    const s = initialSelections(market);
    expect(sendProposal(s, 'C4', 10)).toBe(s);
  });
});

describe('boardCell', () => {
  it('marks wrong-class pairs as not fitting', () => {
    const s = initialSelections(market);
    const c = market.cargoes[0]!;
    const wrong = market.ships.find((x) => x.vesselClass !== c.vesselClass)!;
    const cell = boardCell(market, s, wrong.id, c.id);
    expect(cell.fits).toBe(false);
    expect(cell.estTceUsdPerDay).toBeNull();
  });

  it('estimates owner TCE at the market rate, best for a ship at the load port', () => {
    const s = initialSelections(market);
    const atPort = boardCell(market, s, 'S3', 'C4'); // S3 is at Tubarão
    expect(atPort.ballastNm).toBe(0);
    expect(atPort.estTceRatio).toBeGreaterThan(1);
    const far = boardCell(market, s, 'S4', 'C4'); // S4 is at Qingdao
    expect(far.estTceUsdPerDay!).toBeLessThan(atPort.estTceUsdPerDay!);
  });

  it('tracks talks: talking, busy elsewhere, fixed and failed', () => {
    let s = chooseShip(market, initialSelections(market), 'C4', 'S3');
    expect(boardCell(market, s, 'S3', 'C4').status).toBe('talking');
    expect(boardCell(market, s, 'S3', 'C1').status).toBe('busy');
    expect(boardCell(market, s, 'S2', 'C1').status).toBe('free');
    s = closeDeal(s, 'C4');
    expect(boardCell(market, s, 'S3', 'C4').status).toBe('fixed');

    let f = chooseShip(market, initialSelections(market), 'C3', 'S4');
    for (let i = 0; i < MAX_ROUNDS; i++) f = sendProposal(f, 'C3', 0.05);
    expect(boardCell(market, f, 'S4', 'C3').status).toBe('failed');
    expect(boardCell(market, f, 'S2', 'C3').status).toBe('busy'); // cargo C3 is lost for the day
  });
});

