import { describe, expect, it } from 'vitest';
import { generateBriefing, previousDate } from './briefing';
import { contestPair, generateInbox } from './inbox';
import { bunkerPrice, chartererCeilingShare, ownerFloorShare, rateForTce, TRADES } from './market';
import { VESSEL_CLASSES } from './vessels';

const DATES = Array.from({ length: 100 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 1 + i * 4)).toISOString().slice(0, 10),
);
const BRIEFS = DATES.map((d) => ({ inbox: generateInbox(d), brief: generateBriefing(generateInbox(d)) }));

describe('generateBriefing', () => {
  it('gives everyone the same brief for the same date', () => {
    const inbox = generateInbox('2026-10-10');
    expect(generateBriefing(inbox)).toEqual(generateBriefing(generateInbox('2026-10-10')));
  });

  it('carries 3-4 news lines, always leading with the contest', () => {
    for (const { brief } of BRIEFS) {
      expect(brief.news.length).toBeGreaterThanOrEqual(3);
      expect(brief.news.length).toBeLessThanOrEqual(4);
      expect(brief.news[0]!.kind).toBe('contest');
      expect(new Set(brief.news.map((n) => n.kind)).size).toBe(brief.news.length);
    }
  });

  it('only prints hints that are true', () => {
    for (const { inbox, brief } of BRIEFS) {
      const { market } = inbox;
      for (const n of brief.news) {
        switch (n.kind) {
          case 'contest': {
            expect(n.cargoIds).toEqual(contestPair(market).map((c) => c.id));
            break;
          }
          case 'keenOwner': {
            const lowest = Math.min(...market.ships.map((s) => ownerFloorShare(market, s)));
            expect(ownerFloorShare(market, market.ships.find((s) => s.id === n.shipId)!)).toBe(lowest);
            break;
          }
          case 'eagerCharterer': {
            const highest = Math.max(...market.cargoes.map((c) => chartererCeilingShare(market, c)));
            const cargo = market.cargoes.find((c) => c.id === n.cargoIds![0])!;
            expect(chartererCeilingShare(market, cargo)).toBe(highest);
            break;
          }
          case 'lateShip': {
            const latest = Math.max(...market.ships.map((s) => s.openDay));
            expect(market.ships.find((s) => s.id === n.shipId)!.openDay).toBe(latest);
            break;
          }
          case 'bunkers': {
            const yesterday = bunkerPrice(previousDate(inbox.date));
            expect(brief.bunkerChangeUsdPerTonne).toBe(market.bunkerPriceUsdPerTonne - yesterday);
            expect(n.text).toContain(`$${market.bunkerPriceUsdPerTonne}/t`);
            break;
          }
        }
      }
    }
  });

  it('lists an indicative rate for every route, from rateForTce', () => {
    const { inbox, brief } = BRIEFS[0]!;
    expect(brief.routeRates).toHaveLength(TRADES.length);
    for (const r of brief.routeRates) {
      const spec = VESSEL_CLASSES[r.trade.vesselClass];
      const exact = rateForTce(r.trade, (spec.cargoMinTonnes + spec.cargoMaxTonnes) / 2, inbox.market.bunkerPriceUsdPerTonne, spec.marketTceUsdPerDay);
      expect(Math.abs(r.rateUsdPerTonne - exact)).toBeLessThanOrEqual(0.025 + 1e-9);
    }
  });

  it('moves rates with the fuel price: dearer bunkers, higher rates', () => {
    for (const { brief } of BRIEFS) {
      for (const r of brief.routeRates) {
        if (brief.bunkerChangeUsdPerTonne > 0) expect(r.changeUsdPerTonne).toBeGreaterThanOrEqual(0);
        if (brief.bunkerChangeUsdPerTonne < 0) expect(r.changeUsdPerTonne).toBeLessThanOrEqual(0);
      }
    }
  });

  it('shows every ship, soonest open first', () => {
    for (const { inbox, brief } of BRIEFS.slice(0, 20)) {
      expect(brief.positions.map((s) => s.id).sort()).toEqual(inbox.market.ships.map((s) => s.id).sort());
      const days = brief.positions.map((s) => s.openDay);
      expect(days).toEqual([...days].sort((a, b) => a - b));
    }
  });
});

describe('previousDate', () => {
  it('steps back across month and year ends', () => {
    expect(previousDate('2026-10-10')).toBe('2026-10-09');
    expect(previousDate('2026-03-01')).toBe('2026-02-28');
    expect(previousDate('2026-01-01')).toBe('2025-12-31');
  });
});
