import { describe, expect, it } from 'vitest';
import { generateMarket } from '../engine';
import { availableShips, evaluate, initialSelections, toFixtures } from './state';

const market = generateMarket('2026-10-10');
// That day: C4 is Tubarão iron ore (Capesize); S3 is a Capesize open at Tubarão.

describe('initialSelections', () => {
  it('starts with no ships chosen and market rates filled in', () => {
    const s = initialSelections(market);
    for (const c of market.cargoes) {
      expect(s[c.id]).toEqual({ shipId: null, rateUsdPerTonne: c.marketRateUsdPerTonne });
    }
  });
});

describe('availableShips', () => {
  it('offers only ships of the cargo class', () => {
    const ships = availableShips(market, initialSelections(market), 'C4');
    expect(ships.length).toBeGreaterThan(0);
    for (const s of ships) expect(s.vesselClass).toBe('capesize');
  });

  it('hides a ship already chosen for another cargo, but not for its own', () => {
    const s = initialSelections(market);
    s['C4']!.shipId = 'S3';
    expect(availableShips(market, s, 'C1').map((x) => x.id)).not.toContain('S3');
    expect(availableShips(market, s, 'C4').map((x) => x.id)).toContain('S3');
  });

  it('returns nothing for an unknown cargo', () => {
    expect(availableShips(market, initialSelections(market), 'C99')).toEqual([]);
  });
});

describe('toFixtures and evaluate', () => {
  it('scores nothing before any ship is chosen', () => {
    const e = evaluate(market, initialSelections(market));
    expect(e.totalScore).toBe(0);
    expect(Object.values(e.byCargo).every((r) => r === null)).toBe(true);
  });

  it('scores a chosen ship and leaves the other cargoes empty', () => {
    const s = initialSelections(market);
    s['C4']!.shipId = 'S3';
    const e = evaluate(market, s);
    expect(e.byCargo['C4']?.fixture.shipId).toBe('S3');
    expect(e.byCargo['C1']).toBeNull();
    expect(e.totalScore).toBeGreaterThan(0);
    expect(e.totalBrokerageUsd).toBeCloseTo(e.byCargo['C4']!.brokerageUsd, 6);
  });

  it('gives no brokerage or score for a refused fixture', () => {
    const s = initialSelections(market);
    s['C4'] = { shipId: 'S3', rateUsdPerTonne: 3000 };
    const e = evaluate(market, s);
    expect(e.byCargo['C4']?.status).toBe('refusedByCharterer');
    expect(e.totalBrokerageUsd).toBe(0);
    expect(e.totalScore).toBe(0);
  });

  it('skips rows whose rate is blank, zero or negative', () => {
    const s = initialSelections(market);
    s['C4'] = { shipId: 'S3', rateUsdPerTonne: Number.NaN };
    expect(toFixtures(s)).toEqual([]);
    s['C4'] = { shipId: 'S3', rateUsdPerTonne: 0 };
    expect(toFixtures(s)).toEqual([]);
  });
});
