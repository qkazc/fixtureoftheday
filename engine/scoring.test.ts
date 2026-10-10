import { describe, expect, it } from 'vitest';
import { rateForTce, type CargoOrder, type DailyMarket, type Trade } from './market';
import { BROKERAGE_PCT, scoreDay, type Fixture } from './scoring';
import { VESSEL_CLASSES } from './vessels';

// A small hand-built market: one Supramax coal cargo, Richards Bay to Mundra,
// whose market rate gives a typically-placed Supramax exactly $13,000/day.
const coalTrade: Trade = {
  commodity: 'coal',
  loadPort: 'richardsBay',
  dischargePort: 'mundra',
  vesselClass: 'supramax',
};
const marketRate = rateForTce(coalTrade, 50_000, 600, VESSEL_CLASSES.supramax.marketTceUsdPerDay);
const coal: CargoOrder = {
  ...coalTrade,
  id: 'C1',
  quantityTonnes: 50_000,
  marketRateUsdPerTonne: marketRate,
  laycanStartDay: 5,
  laycanEndDay: 8,
};
const market: DailyMarket = {
  date: '2026-10-10',
  bunkerPriceUsdPerTonne: 600,
  cargoes: [coal],
  ships: [
    { id: 'atLoadPort', name: 'Amber Tern', vesselClass: 'supramax', openPort: 'richardsBay', openDay: 0, dwt: 58_000 },
    { id: 'farAway', name: 'Blue Heron', vesselClass: 'supramax', openPort: 'qingdao', openDay: 0, dwt: 58_000 },
    { id: 'cape', name: 'Cape Lark', vesselClass: 'capesize', openPort: 'richardsBay', openDay: 0, dwt: 180_000 },
  ],
};

const fix = (shipId: string, rateUsdPerTonne: number, cargoId = 'C1'): Fixture => ({
  shipId,
  cargoId,
  rateUsdPerTonne,
});
const scoreOne = (f: Fixture) => scoreDay(market, [f]).fixtures[0]!;

describe('scoreDay', () => {
  it('scores nothing for an empty day', () => {
    expect(scoreDay(market, [])).toEqual({ fixtures: [], totalBrokerageUsd: 0, totalScore: 0 });
  });

  it('pays brokerage of 1.25% of gross freight', () => {
    const r = scoreOne(fix('atLoadPort', 20));
    expect(BROKERAGE_PCT).toBe(1.25);
    expect(r.brokerageUsd).toBeCloseTo(50_000 * 20 * 0.0125, 6);
  });

  it('leaves the charterer at exactly 50 when paying the market rate', () => {
    expect(scoreOne(fix('atLoadPort', marketRate)).chartererSatisfaction).toBeCloseTo(50, 9);
  });

  it('maps owner satisfaction linearly: 50 at market TCE, ±20% to 100 or 0', () => {
    const r = scoreOne(fix('atLoadPort', marketRate));
    const ratio = r.voyage.tceUsdPerDay / VESSEL_CLASSES.supramax.marketTceUsdPerDay;
    expect(r.ownerSatisfaction).toBeCloseTo(Math.min(100, 50 + ((ratio - 1) / 0.2) * 50), 9);
  });

  it('lets a well-placed ship leave both sides happy at a below-market rate', () => {
    // No ballast leg, so the owner beats the market TCE even after a discount.
    const r = scoreOne(fix('atLoadPort', marketRate * 0.95));
    expect(r.ownerSatisfaction).toBeGreaterThan(50);
    expect(r.chartererSatisfaction).toBeGreaterThan(50);
    expect(r.score).toBeGreaterThan(r.brokerageUsd);
  });

  it('leaves the owner of a far-away ship unhappy at the market rate', () => {
    // 7,250 nm ballast from Qingdao versus the 2,000 nm the market assumes.
    expect(scoreOne(fix('farAway', marketRate)).ownerSatisfaction).toBeLessThan(50);
  });

  it('clamps satisfaction to 0–100', () => {
    const greedy = scoreOne(fix('atLoadPort', marketRate * 2));
    expect(greedy.ownerSatisfaction).toBe(100);
    expect(greedy.chartererSatisfaction).toBe(0);
    const cheap = scoreOne(fix('farAway', marketRate * 0.5));
    expect(cheap.ownerSatisfaction).toBe(0);
    expect(cheap.chartererSatisfaction).toBe(100);
  });

  it('scores brokerage × (owner + charterer satisfaction) / 100', () => {
    const r = scoreOne(fix('farAway', marketRate * 1.05));
    expect(r.score).toBeCloseTo(
      r.brokerageUsd * ((r.ownerSatisfaction + r.chartererSatisfaction) / 100),
      6,
    );
  });

  it('adds up fixtures into day totals', () => {
    const twoCargoMarket: DailyMarket = {
      ...market,
      cargoes: [coal, { ...coal, id: 'C2' }],
    };
    const day = scoreDay(twoCargoMarket, [fix('atLoadPort', 20), fix('farAway', 22, 'C2')]);
    const [a, b] = day.fixtures;
    expect(day.totalBrokerageUsd).toBeCloseTo(a!.brokerageUsd + b!.brokerageUsd, 6);
    expect(day.totalScore).toBeCloseTo(a!.score + b!.score, 6);
  });

  describe('refusals', () => {
    it('agrees a fixture inside both limits', () => {
      expect(scoreOne(fix('atLoadPort', marketRate)).status).toBe('fixed');
    });

    it('has the charterer refuse more than 20% above the market rate', () => {
      expect(scoreOne(fix('atLoadPort', marketRate * 1.19)).status).toBe('fixed');
      const r = scoreOne(fix('atLoadPort', marketRate * 1.21));
      expect(r.status).toBe('refusedByCharterer');
      expect(r.brokerageUsd).toBe(0);
      expect(r.score).toBe(0);
    });

    it('stops an absurd rate from farming brokerage', () => {
      const day = scoreDay(market, [fix('atLoadPort', 3000)]);
      expect(day.fixtures[0]!.status).toBe('refusedByCharterer');
      expect(day.totalBrokerageUsd).toBe(0);
      expect(day.totalScore).toBe(0);
    });

    it('has the owner refuse a voyage earning under 80% of market TCE', () => {
      // 7,250 nm empty from Qingdao: far too little at the market rate.
      const r = scoreOne(fix('farAway', marketRate));
      expect(r.voyage.tceUsdPerDay).toBeLessThan(VESSEL_CLASSES.supramax.marketTceUsdPerDay * 0.8);
      expect(r.status).toBe('refusedByOwner');
      expect(r.score).toBe(0);
    });

    it('says which side refused', () => {
      expect(scoreOne(fix('farAway', marketRate * 0.5)).status).toBe('refusedByOwner');
      expect(scoreOne(fix('farAway', marketRate * 1.25)).status).toBe('refusedByCharterer');
    });
  });

  describe('rejects invalid fixtures', () => {
    it('ship class that does not match the cargo', () => {
      expect(() => scoreDay(market, [fix('cape', 20)])).toThrow(/needs a supramax/);
    });

    it('the same cargo fixed twice', () => {
      expect(() => scoreDay(market, [fix('atLoadPort', 20), fix('farAway', 20)])).toThrow(
        /cargo C1 is fixed twice/,
      );
    });

    it('the same ship fixed twice', () => {
      const twoCargoMarket = { ...market, cargoes: [coal, { ...coal, id: 'C2' }] };
      expect(() =>
        scoreDay(twoCargoMarket, [fix('atLoadPort', 20), fix('atLoadPort', 20, 'C2')]),
      ).toThrow(/ship atLoadPort is fixed twice/);
    });

    it('unknown ids', () => {
      expect(() => scoreDay(market, [fix('ghost', 20)])).toThrow(/unknown ship id/);
      expect(() => scoreDay(market, [fix('atLoadPort', 20, 'C9')])).toThrow(/unknown cargo id/);
    });

    it('a zero or negative rate', () => {
      expect(() => scoreDay(market, [fix('atLoadPort', 0)])).toThrow(/rate must be a positive number/);
    });
  });
});
