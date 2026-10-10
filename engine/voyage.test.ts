import { describe, expect, it } from 'vitest';
import { buildRoute, calculateVoyage, type Cargo, type Market, type Route, type Vessel } from './voyage';

// PLACEHOLDER: all figures below are plausible for a Supramax but chosen by
// hand, not sourced from real market data.
const supramax: Vessel = {
  dwt: 58_000,
  speedKnots: 13,
  fuelAtSeaTonnesPerDay: 30,
  fuelInPortTonnesPerDay: 5,
  opexUsdPerDay: 5_500,
};
const cargo: Cargo = { quantityTonnes: 55_000, freightRateUsdPerTonne: 20, commissionPct: 5 };
const route: Route = {
  ballastDistanceNm: 500,
  ladenDistanceNm: 6_000,
  portDays: 8,
  portCostsUsd: 150_000,
};
const market: Market = { bunkerPriceUsdPerTonne: 600 };

describe('calculateVoyage', () => {
  it('matches the hand-worked Supramax example', () => {
    const r = calculateVoyage(supramax, cargo, route, market);

    // 6,500 nm / (13 kn * 24 h) = 20.833 sea days, + 8 port days
    expect(r.seaDays).toBeCloseTo(20.8333, 4);
    expect(r.portDays).toBe(8);
    expect(r.totalDays).toBeCloseTo(28.8333, 4);
    // 20.833 * 30 + 8 * 5 = 625 + 40
    expect(r.fuelTonnes).toBeCloseTo(665, 6);
    expect(r.fuelCostUsd).toBeCloseTo(399_000, 6);
    expect(r.portCostsUsd).toBe(150_000);
    expect(r.grossFreightUsd).toBe(1_100_000);
    expect(r.commissionUsd).toBeCloseTo(55_000, 6);
    expect(r.voyageCostsUsd).toBeCloseTo(604_000, 6);
    expect(r.netResultUsd).toBeCloseTo(496_000, 6);
    // 496,000 / 28.8333
    expect(r.tceUsdPerDay).toBeCloseTo(17_202.31, 2);
    expect(r.opexUsd).toBeCloseTo(158_583.33, 2);
    expect(r.dailyProfitUsd).toBeCloseTo(11_702.31, 2);
  });

  it('handles a voyage with no ballast leg and no port time', () => {
    // 3,120 nm at 13 kn is exactly 10 days.
    const r = calculateVoyage(
      supramax,
      cargo,
      { ballastDistanceNm: 0, ladenDistanceNm: 3_120, portDays: 0, portCostsUsd: 0 },
      market,
    );
    expect(r.seaDays).toBeCloseTo(10, 10);
    expect(r.totalDays).toBeCloseTo(10, 10);
    expect(r.fuelTonnes).toBeCloseTo(300, 10);
    // (1,100,000 - 180,000 fuel - 55,000 commission) / 10
    expect(r.tceUsdPerDay).toBeCloseTo(86_500, 6);
  });

  it('keeps opex out of TCE', () => {
    const cheap = calculateVoyage({ ...supramax, opexUsdPerDay: 0 }, cargo, route, market);
    const dear = calculateVoyage({ ...supramax, opexUsdPerDay: 10_000 }, cargo, route, market);
    expect(dear.tceUsdPerDay).toBe(cheap.tceUsdPerDay);
    expect(dear.dailyProfitUsd).toBeCloseTo(cheap.dailyProfitUsd - 10_000, 6);
  });

  it('can produce a negative TCE when freight does not cover voyage costs', () => {
    const r = calculateVoyage(supramax, { ...cargo, freightRateUsdPerTonne: 5 }, route, market);
    expect(r.tceUsdPerDay).toBeLessThan(0);
  });

  describe('sensitivities', () => {
    const base = calculateVoyage(supramax, cargo, route, market);

    it('TCE rises with the freight rate', () => {
      const r = calculateVoyage(supramax, { ...cargo, freightRateUsdPerTonne: 22 }, route, market);
      expect(r.tceUsdPerDay).toBeGreaterThan(base.tceUsdPerDay);
    });

    it('TCE falls as bunker prices rise', () => {
      const r = calculateVoyage(supramax, cargo, route, { bunkerPriceUsdPerTonne: 800 });
      expect(r.tceUsdPerDay).toBeLessThan(base.tceUsdPerDay);
    });

    it('a longer ballast leg costs time and fuel', () => {
      const r = calculateVoyage(supramax, cargo, { ...route, ballastDistanceNm: 2_000 }, market);
      expect(r.totalDays).toBeGreaterThan(base.totalDays);
      expect(r.fuelCostUsd).toBeGreaterThan(base.fuelCostUsd);
      expect(r.tceUsdPerDay).toBeLessThan(base.tceUsdPerDay);
    });

    it('higher commission lowers TCE', () => {
      const r = calculateVoyage(supramax, { ...cargo, commissionPct: 6.25 }, route, market);
      expect(r.tceUsdPerDay).toBeLessThan(base.tceUsdPerDay);
    });
  });

  describe('input validation', () => {
    it('rejects cargo heavier than the ship can carry', () => {
      expect(() =>
        calculateVoyage(supramax, { ...cargo, quantityTonnes: 60_000 }, route, market),
      ).toThrow(/exceeds vessel DWT/);
    });

    it('rejects zero speed', () => {
      expect(() => calculateVoyage({ ...supramax, speedKnots: 0 }, cargo, route, market)).toThrow(
        /speedKnots/,
      );
    });

    it('rejects a zero laden distance', () => {
      expect(() =>
        calculateVoyage(supramax, cargo, { ...route, ladenDistanceNm: 0 }, market),
      ).toThrow(/ladenDistanceNm/);
    });

    it('rejects negative values', () => {
      expect(() =>
        calculateVoyage(supramax, cargo, { ...route, portCostsUsd: -1 }, market),
      ).toThrow(/portCostsUsd/);
      expect(() =>
        calculateVoyage(supramax, cargo, route, { bunkerPriceUsdPerTonne: -600 }),
      ).toThrow(/bunkerPriceUsdPerTonne/);
    });

    it('rejects non-finite numbers', () => {
      expect(() =>
        calculateVoyage({ ...supramax, dwt: Number.NaN }, cargo, route, market),
      ).toThrow(/dwt/);
      expect(() =>
        calculateVoyage(supramax, cargo, { ...route, portDays: Infinity }, market),
      ).toThrow(/portDays/);
    });

    it('rejects commission above 100%', () => {
      expect(() =>
        calculateVoyage(supramax, { ...cargo, commissionPct: 101 }, route, market),
      ).toThrow(/commissionPct/);
    });
  });
});

describe('buildRoute', () => {
  it('takes ballast and laden distances from the port table', () => {
    const r = buildRoute(
      { openPort: 'qingdao', loadPort: 'richardsBay', dischargePort: 'mundra' },
      8,
      150_000,
    );
    expect(r).toEqual({
      ballastDistanceNm: 7_250,
      ladenDistanceNm: 3_850,
      portDays: 8,
      portCostsUsd: 150_000,
    });
  });

  it('has no ballast leg when the ship opens at the load port', () => {
    const r = buildRoute(
      { openPort: 'richardsBay', loadPort: 'richardsBay', dischargePort: 'mundra' },
      8,
      150_000,
    );
    expect(r.ballastDistanceNm).toBe(0);
  });

  it('rejects loading and discharging at the same port', () => {
    expect(() =>
      buildRoute({ openPort: 'qingdao', loadPort: 'mundra', dischargePort: 'mundra' }, 8, 0),
    ).toThrow(/load and discharge port/);
  });

  it('shows that a nearby ship earns more on the same cargo', () => {
    // Richards Bay coal to India: a ship open in Mundra (3,850 nm ballast)
    // beats one open in Qingdao (7,250 nm ballast).
    const coal: Cargo = { quantityTonnes: 55_000, freightRateUsdPerTonne: 18, commissionPct: 5 };
    const tce = (openPort: 'mundra' | 'qingdao') =>
      calculateVoyage(
        supramax,
        coal,
        buildRoute({ openPort, loadPort: 'richardsBay', dischargePort: 'mundra' }, 8, 150_000),
        market,
      ).tceUsdPerDay;
    expect(tce('mundra')).toBeGreaterThan(tce('qingdao'));
  });
});
