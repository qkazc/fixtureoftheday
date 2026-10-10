import { describe, expect, it } from 'vitest';
import {
  CARGOES_PER_DAY,
  generateMarket,
  MARKET_COMMISSION_PCT,
  rateForTce,
  TRADES,
  TYPICAL_BALLAST_NM,
} from './market';
import { distanceNm, PORTS } from './ports';
import { VESSEL_CLASSES } from './vessels';
import { calculateVoyage } from './voyage';

// A spread of dates to check properties across many markets.
const DATES = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i * 6));
  return d.toISOString().slice(0, 10);
});

describe('generateMarket', () => {
  it('gives the same market for the same date', () => {
    expect(generateMarket('2026-10-10')).toEqual(generateMarket('2026-10-10'));
  });

  it('gives different markets on different dates', () => {
    expect(generateMarket('2026-10-10')).not.toEqual(generateMarket('2026-10-11'));
  });

  it('rejects badly formatted dates', () => {
    expect(() => generateMarket('10/10/2026')).toThrow(/YYYY-MM-DD/);
  });

  it.each(DATES)('builds a valid, solvable market for %s', (date) => {
    const m = generateMarket(date);
    expect(m.cargoes).toHaveLength(CARGOES_PER_DAY);
    expect(m.ships).toHaveLength(CARGOES_PER_DAY + 1);
    expect(m.bunkerPriceUsdPerTonne).toBeGreaterThanOrEqual(550);
    expect(m.bunkerPriceUsdPerTonne).toBeLessThanOrEqual(650);
    expect(new Set(m.ships.map((s) => s.name)).size).toBe(m.ships.length);

    // Every cargo can be matched to a different ship of its class.
    const freeShips = [...m.ships];
    for (const cargo of m.cargoes) {
      const i = freeShips.findIndex((s) => s.vesselClass === cargo.vesselClass);
      expect(i).toBeGreaterThanOrEqual(0);
      freeShips.splice(i, 1);
    }

    for (const cargo of m.cargoes) {
      const spec = VESSEL_CLASSES[cargo.vesselClass];
      expect(PORTS[cargo.loadPort].exports).toContain(cargo.commodity);
      expect(PORTS[cargo.dischargePort].imports).toContain(cargo.commodity);
      expect(cargo.quantityTonnes).toBeGreaterThanOrEqual(spec.cargoMinTonnes);
      expect(cargo.quantityTonnes).toBeLessThanOrEqual(spec.cargoMaxTonnes);
      expect(cargo.quantityTonnes % 1000).toBe(0);
      const cents = cargo.marketRateUsdPerTonne * 100;
      expect(Math.round(cents) % 5).toBe(0); // quoted to the nearest $0.05
      expect(cargo.marketRateUsdPerTonne).toBeGreaterThan(3);
      expect(cargo.marketRateUsdPerTonne).toBeLessThan(80);
    }
  });

  it('sets market rates so a ship with a typical ballast leg earns about the class market TCE', () => {
    for (const date of DATES) {
      const m = generateMarket(date);
      for (const cargo of m.cargoes) {
        const spec = VESSEL_CLASSES[cargo.vesselClass];
        const v = calculateVoyage(
          spec.vessel,
          {
            quantityTonnes: cargo.quantityTonnes,
            freightRateUsdPerTonne: cargo.marketRateUsdPerTonne,
            commissionPct: MARKET_COMMISSION_PCT,
          },
          {
            ballastDistanceNm: TYPICAL_BALLAST_NM,
            ladenDistanceNm: distanceNm(cargo.loadPort, cargo.dischargePort),
            portDays: spec.portDays,
            portCostsUsd: spec.portCostsUsd,
          },
          { bunkerPriceUsdPerTonne: m.bunkerPriceUsdPerTonne },
        );
        // ±10% noise, plus a little slack for rounding the rate to $0.05.
        expect(v.tceUsdPerDay).toBeGreaterThan(spec.marketTceUsdPerDay * 0.88);
        expect(v.tceUsdPerDay).toBeLessThan(spec.marketTceUsdPerDay * 1.12);
      }
    }
  });

  it('rateForTce gives exactly the target TCE before rounding', () => {
    const trade = TRADES[0]!;
    const spec = VESSEL_CLASSES[trade.vesselClass];
    const rate = rateForTce(trade, 160_000, 600, 20_000);
    const v = calculateVoyage(
      spec.vessel,
      { quantityTonnes: 160_000, freightRateUsdPerTonne: rate, commissionPct: MARKET_COMMISSION_PCT },
      {
        ballastDistanceNm: TYPICAL_BALLAST_NM,
        ladenDistanceNm: distanceNm(trade.loadPort, trade.dischargePort),
        portDays: spec.portDays,
        portCostsUsd: spec.portCostsUsd,
      },
      { bunkerPriceUsdPerTonne: 600 },
    );
    expect(v.tceUsdPerDay).toBeCloseTo(20_000, 6);
  });

  it('only uses trades whose ports handle the commodity', () => {
    for (const t of TRADES) {
      expect(PORTS[t.loadPort].exports).toContain(t.commodity);
      expect(PORTS[t.dischargePort].imports).toContain(t.commodity);
    }
  });
});
