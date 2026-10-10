import { describe, expect, it } from 'vitest';
import {
  CARGOES_PER_DAY_RANGE,
  fitCheck,
  isWorkable,
  CHARTERER_CEILING_RANGE,
  negotiationLimits,
  OWNER_FLOOR_RANGE,
  generateMarket,
  CLOSE_OPEN_NM,
  MARKET_COMMISSION_PCT,
  NEARBY_OPEN_NM,
  rateForTce,
  TRADES,
  TYPICAL_BALLAST_NM,
  type CargoOrder,
  type ShipOffer,
} from './market';
import { distanceNm, PORTS } from './ports';
import { VESSEL_CLASSES } from './vessels';
import { calculateVoyage } from './voyage';

// 100 dates to check properties across many markets.
const DATES = Array.from({ length: 100 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i * 4));
  return d.toISOString().slice(0, 10);
});

function hasNearbyMatching(cargoes: readonly CargoOrder[], ships: readonly ShipOffer[]): boolean {
  const [cargo, ...rest] = cargoes;
  if (!cargo) return true;
  return ships.some(
    (ship, i) =>
      ship.vesselClass === cargo.vesselClass &&
      distanceNm(ship.openPort, cargo.loadPort) <= NEARBY_OPEN_NM &&
      hasNearbyMatching(rest, ships.filter((_, j) => j !== i)),
  );
}

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
    expect(m.cargoes.length).toBeGreaterThanOrEqual(CARGOES_PER_DAY_RANGE[0]);
    expect(m.cargoes.length).toBeLessThanOrEqual(CARGOES_PER_DAY_RANGE[1]);
    // One ship per cargo, plus the shared contest ship and a decoy.
    expect(m.ships).toHaveLength(m.cargoes.length + 2);
    for (const c of m.cargoes) {
      expect(c.laycanStartDay).toBeGreaterThanOrEqual(1);
      expect(c.laycanEndDay).toBeGreaterThanOrEqual(c.laycanStartDay);
    }
    expect(m.bunkerPriceUsdPerTonne).toBeGreaterThanOrEqual(550);
    expect(m.bunkerPriceUsdPerTonne).toBeLessThanOrEqual(650);
    expect(new Set(m.ships.map((s) => s.name)).size).toBe(m.ships.length);

    // Every cargo can be matched to a different ship of its class that is
    // open nearby (checked by trying every assignment; the market is tiny).
    expect(hasNearbyMatching(m.cargoes, m.ships)).toBe(true);

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

  it('gives every cargo at least one ship with a positive deal zone, on 100 dates', () => {
    // Deal zone: some rate is at or above the owner's hidden floor and at or
    // below the charterer's hidden ceiling (see negotiationLimits).
    for (const date of DATES) {
      const m = generateMarket(date);
      for (const cargo of m.cargoes) {
        // Right size, makes the laycan, and has a positive deal zone.
        const winnable = m.ships.some((ship) => isWorkable(m, ship, cargo));
        expect(winnable, `${date} cargo ${cargo.id}`).toBe(true);
      }
    }
  });

  it('keeps hidden limits inside their ranges', () => {
    for (const date of DATES.slice(0, 20)) {
      const m = generateMarket(date);
      for (const cargo of m.cargoes) {
        for (const ship of m.ships.filter((s) => s.vesselClass === cargo.vesselClass)) {
          const l = negotiationLimits(m, ship, cargo);
          const ceilingShare = l.chartererCeilingRate / cargo.marketRateUsdPerTonne;
          expect(ceilingShare).toBeGreaterThanOrEqual(CHARTERER_CEILING_RANGE[0]);
          expect(ceilingShare).toBeLessThanOrEqual(CHARTERER_CEILING_RANGE[1]);
          // The owner's floor rate earns a TCE inside the floor range.
          const spec = VESSEL_CLASSES[ship.vesselClass];
          const floorRateAtMin = rateForTce(cargo, cargo.quantityTonnes, m.bunkerPriceUsdPerTonne,
            spec.marketTceUsdPerDay * OWNER_FLOOR_RANGE[0], distanceNm(ship.openPort, cargo.loadPort));
          const floorRateAtMax = rateForTce(cargo, cargo.quantityTonnes, m.bunkerPriceUsdPerTonne,
            spec.marketTceUsdPerDay * OWNER_FLOOR_RANGE[1], distanceNm(ship.openPort, cargo.loadPort));
          expect(l.ownerFloorRate).toBeGreaterThanOrEqual(floorRateAtMin - 1e-9);
          expect(l.ownerFloorRate).toBeLessThanOrEqual(floorRateAtMax + 1e-9);
        }
      }
    }
  });

  it('spreads matching ships between close and medium distances', () => {
    const ballasts = DATES.flatMap((date) => {
      const m = generateMarket(date);
      return m.cargoes.flatMap((c) =>
        m.ships
          .filter((s) => s.vesselClass === c.vesselClass)
          .map((s) => distanceNm(s.openPort, c.loadPort)),
      );
    });
    expect(ballasts.some((nm) => nm <= CLOSE_OPEN_NM)).toBe(true);
    expect(ballasts.some((nm) => nm > CLOSE_OPEN_NM && nm <= NEARBY_OPEN_NM)).toBe(true);
  });

  it('makes ships compete: every day one ship is a workable fit for two cargoes', () => {
    for (const date of DATES) {
      const m = generateMarket(date);
      const shared = m.ships.some((ship) => m.cargoes.filter((c) => isWorkable(m, ship, c)).length >= 2);
      expect(shared, date).toBe(true);
    }
  });

  it('only lets a ship fit a cargo if it is the right size and can make the laycan', () => {
    for (const date of DATES.slice(0, 30)) {
      const m = generateMarket(date);
      for (const c of m.cargoes) {
        for (const s of m.ships) {
          const f = fitCheck(s, c);
          expect(f.fits).toBe(s.vesselClass === c.vesselClass && f.arrivalDay <= c.laycanEndDay);
          if (s.vesselClass !== c.vesselClass) expect(f.problem).toBe('wrongSize');
        }
      }
    }
  });

  it('only uses trades whose ports handle the commodity', () => {
    for (const t of TRADES) {
      expect(PORTS[t.loadPort].exports).toContain(t.commodity);
      expect(PORTS[t.dischargePort].imports).toContain(t.commodity);
    }
  });
});
