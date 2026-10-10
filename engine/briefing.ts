// The morning brief, read before the day starts (it costs no time): a few
// lines of overnight news, today's indicative rates by route, and where the
// ships are. Every news line is built from the day's real data, so it is
// always true, but vague: the player has to work out what it means.
//
// PLACEHOLDER: which hints appear and their wording are tuned for play.

import { CLASS_NAMES, COMMODITY_NAMES, REGIONS, calendarDay, contestPair, type Inbox } from './inbox';
import {
  bunkerPrice,
  chartererCeilingShare,
  ownerFloorShare,
  rateForTce,
  TRADES,
  type ShipOffer,
  type Trade,
} from './market';
import { PORTS } from './ports';
import { createRng, hashSeed, randomInt, shuffle } from './random';
import { VESSEL_CLASSES } from './vessels';

export type NewsKind = 'contest' | 'keenOwner' | 'eagerCharterer' | 'lateShip' | 'bunkers';

export interface NewsItem {
  kind: NewsKind;
  text: string;
  /** What the hint is about, for tests and later UI (e.g. highlighting). */
  shipId?: string;
  cargoIds?: string[];
}

export interface RouteRate {
  trade: Trade;
  /** Today's indicative rate for a typical cargo and ballast leg. */
  rateUsdPerTonne: number;
  changeUsdPerTonne: number;
}

export interface Briefing {
  date: string;
  bunkerPriceUsdPerTonne: number;
  bunkerChangeUsdPerTonne: number;
  news: NewsItem[];
  routeRates: RouteRate[];
  /** Every ship on the market today, soonest open first. */
  positions: ShipOffer[];
}

/** The calendar day before a YYYY-MM-DD date. */
export function previousDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** A route's indicative rate: a mid-size cargo, typical ballast, the size's market TCE. */
function indicativeRate(trade: Trade, bunkerPriceUsdPerTonne: number): number {
  const spec = VESSEL_CLASSES[trade.vesselClass];
  const tonnes = (spec.cargoMinTonnes + spec.cargoMaxTonnes) / 2;
  return Math.round(rateForTce(trade, tonnes, bunkerPriceUsdPerTonne, spec.marketTceUsdPerDay) * 20) / 20;
}

export function generateBriefing(inbox: Inbox): Briefing {
  const { market, date } = inbox;
  const yesterdayBunkers = bunkerPrice(previousDate(date));
  const bunkerChange = market.bunkerPriceUsdPerTonne - yesterdayBunkers;
  const ownerOf = (shipId: string) =>
    inbox.emails.find((e) => e.kind === 'positionList' && e.shipIds.includes(shipId))?.from ?? 'Owners';
  const chartererOf = (cargoId: string) =>
    inbox.emails.find((e) => e.kind === 'enquiry' && e.cargoId === cargoId)?.from ?? 'A charterer';

  // The contest: always in the news.
  const [a, b] = contestPair(market);
  const contest: NewsItem = {
    kind: 'contest',
    text: `${CLASS_NAMES[a.vesselClass]} ships look tight around ${REGIONS[a.loadPort]}: more cargo than tonnage this week.`,
    cargoIds: [a.id, b.id],
  };

  // The keenest owner: the lowest hidden floor today.
  const keen = [...market.ships].sort((x, y) => ownerFloorShare(market, x) - ownerFloorShare(market, y))[0]!;
  // The most eager charterer: the highest hidden ceiling today.
  const eager = [...market.cargoes].sort((x, y) => chartererCeilingShare(market, y) - chartererCeilingShare(market, x))[0]!;
  // The ship that opens last.
  const late = [...market.ships].sort((x, y) => y.openDay - x.openDay)[0]!;

  const optional: NewsItem[] = [
    { kind: 'keenOwner', text: `Word is ${ownerOf(keen.id)} would like to fix ${keen.name} quickly.`, shipId: keen.id },
    {
      kind: 'eagerCharterer',
      text: `${chartererOf(eager.id)} is under pressure to get its ${COMMODITY_NAMES[eager.commodity]} moving.`,
      cargoIds: [eager.id],
    },
    {
      kind: 'lateShip',
      text: `${late.name} has been held up: now open ${PORTS[late.openPort].name} ${calendarDay(date, late.openDay)}.`,
      shipId: late.id,
    },
    {
      kind: 'bunkers',
      text:
        bunkerChange === 0
          ? `Bunkers steady at $${market.bunkerPriceUsdPerTonne}/t.`
          : `Bunkers $${market.bunkerPriceUsdPerTonne}/t, ${bunkerChange > 0 ? 'up' : 'down'} $${Math.abs(bunkerChange)} overnight.`,
    },
  ];
  const rng = createRng(hashSeed(`${market.seed}|brief`));
  const news = [contest, ...shuffle(rng, optional).slice(0, randomInt(rng, 2, 3))];

  return {
    date,
    bunkerPriceUsdPerTonne: market.bunkerPriceUsdPerTonne,
    bunkerChangeUsdPerTonne: bunkerChange,
    news,
    routeRates: TRADES.map((trade) => {
      const rate = indicativeRate(trade, market.bunkerPriceUsdPerTonne);
      return { trade, rateUsdPerTonne: rate, changeUsdPerTonne: rate - indicativeRate(trade, yesterdayBunkers) };
    }),
    positions: [...market.ships].sort((x, y) => x.openDay - y.openDay),
  };
}
