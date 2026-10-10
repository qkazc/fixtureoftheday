// The broker's inbox: the day's market, delivered as emails. Same date, same
// inbox for everyone.
//
// Emails per day:
// - 3-4 cargo enquiries from charterers (one per cargo in the market)
// - 2 owner position lists sharing out the day's ships
// - 1 note from a senior broker: a hint about the day, not a rule
// - 1 distraction that looks urgent but pays little
//
// PLACEHOLDER: deadlines, effort hours, the research cost and the
// distraction's hours and payout are tuned for play.

import { BROKERAGE_PCT } from './scoring';
import { generateMarket, NEARBY_OPEN_NM, type CargoOrder, type DailyMarket, type ShipOffer } from './market';
import { distanceNm, PORTS, type PortId } from './ports';
import { createRng, hashSeed, pick, shuffle } from './random';
import type { VesselClass } from './vessels';

/** The working day runs 09:00 to 17:00. */
export const DAY_START_HOUR = 9;
export const DAY_END_HOUR = 17;
/** Running voyage estimates for one enquiry. */
export const RESEARCH_HOURS = 0.5;
/** Hours to fix a cargo, by ship size: bigger deals take more work. */
export const FIX_EFFORT_HOURS: Readonly<Record<VesselClass, number>> = {
  supramax: 1,
  panamax: 2,
  capesize: 3,
};
/** Deadlines an enquiry can carry (17:00 means "no rush"). */
export const DEADLINE_HOURS = [11, 13, 15, 17] as const;
export const DISTRACTION_HOURS = 1;
export const DISTRACTION_DEADLINE_HOUR = 10;
export const DISTRACTION_PAYOUT_USD = 1_500;

interface EmailBase {
  id: string;
  from: string;
  subject: string;
  body: string[];
  /** Hour of the day the email must be acted on by, or null for no deadline. */
  deadlineHour: number | null;
  /** Hours the main action takes (0 if there's nothing to do). */
  effortHours: number;
  /** Rough commission at stake, for prioritising. 0 if none. */
  approxCommissionUsd: number;
}

export interface EnquiryEmail extends EmailBase {
  kind: 'enquiry';
  cargoId: string;
}
export interface PositionListEmail extends EmailBase {
  kind: 'positionList';
  shipIds: string[];
}
export interface BrokerNoteEmail extends EmailBase {
  kind: 'brokerNote';
}
export interface DistractionEmail extends EmailBase {
  kind: 'distraction';
  payoutUsd: number;
}
export type Email = EnquiryEmail | PositionListEmail | BrokerNoteEmail | DistractionEmail;

export interface Inbox {
  date: string;
  market: DailyMarket;
  emails: Email[];
}

// Made-up company names for flavour.
const CHARTERERS: Record<CargoOrder['commodity'], readonly string[]> = {
  ironOre: ['Southgate Ore Trading', 'Redline Iron Ore'],
  coal: ['Highveld Coal Sales', 'Coral Coast Energy'],
  grain: ['Pampas Grain Co', 'Prairie Harvest Grain'],
  bauxite: ['Kestrel Bauxite'],
};
const OWNERS = ['Albatross Bulk', 'Tern Shipping', 'Harbour Light Carriers', 'Westwind Bulk'];
export const REGIONS: Record<PortId, string> = {
  portHedland: 'Western Australia',
  newcastle: 'eastern Australia',
  tubarao: 'Brazil',
  santos: 'Brazil',
  richardsBay: 'South Africa',
  kamsar: 'West Africa',
  usGulf: 'the US Gulf',
  qingdao: 'North China',
  mundra: 'India',
  rotterdam: 'northern Europe',
};
export const CLASS_NAMES: Record<VesselClass, string> = { supramax: 'Supramax', panamax: 'Panamax', capesize: 'Capesize' };
export const COMMODITY_NAMES: Record<CargoOrder['commodity'], string> = {
  ironOre: 'iron ore',
  coal: 'coal',
  grain: 'grain',
  bauxite: 'bauxite',
};

const thousands = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Oct" for a day counted from the inbox date. */
export function calendarDay(date: string, dayOffset: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const when = new Date(Date.UTC(y, m - 1, d + dayOffset));
  return `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]}`;
}

/** Rough commission on a cargo at its rate idea, rounded to the nearest $1,000. */
export function approxCommission(cargo: CargoOrder): number {
  const exact = cargo.quantityTonnes * cargo.marketRateUsdPerTonne * (BROKERAGE_PCT / 100);
  return Math.max(1000, Math.round(exact / 1000) * 1000);
}

export function generateInbox(date: string): Inbox {
  const market = generateMarket(date);
  // A separate random stream, so the market itself is unchanged by the inbox.
  const rng = createRng(hashSeed(`${date}|inbox`));
  const port = (id: PortId) => PORTS[id].name;

  const enquiries: Omit<EnquiryEmail, 'id'>[] = market.cargoes.map((c) => {
    const effortHours = FIX_EFFORT_HOURS[c.vesselClass];
    // Leave time to research and fix before the deadline.
    const deadlineHour = pick(rng, DEADLINE_HOURS.filter((h) => h >= DAY_START_HOUR + RESEARCH_HOURS + effortHours));
    const what = `${thousands.format(c.quantityTonnes)} t ${COMMODITY_NAMES[c.commodity]}`;
    return {
      kind: 'enquiry',
      cargoId: c.id,
      from: pick(rng, CHARTERERS[c.commodity]),
      subject: `Ship wanted: ${what}, ${port(c.loadPort)} to ${port(c.dischargePort)}`,
      body: [
        `Cargo: ${what}`,
        `Load ${port(c.loadPort)}, discharge ${port(c.dischargePort)}`,
        `Laycan ${calendarDay(date, c.laycanStartDay)} to ${calendarDay(date, c.laycanEndDay)}`,
        `Needs a ${CLASS_NAMES[c.vesselClass]}`,
        `Rate idea about $${c.marketRateUsdPerTonne.toFixed(2)}/t`,
      ],
      deadlineHour,
      effortHours,
      approxCommissionUsd: approxCommission(c),
    };
  });

  // Share the ships out between two owners' position lists.
  const ships = shuffle(rng, market.ships);
  const half = Math.ceil(ships.length / 2);
  const [ownerA, ownerB] = shuffle(rng, OWNERS) as [string, string];
  const positionLists: Omit<PositionListEmail, 'id'>[] = [
    [ownerA, ships.slice(0, half)],
    [ownerB, ships.slice(half)],
  ].map(([owner, list]) => ({
    kind: 'positionList',
    shipIds: (list as ShipOffer[]).map((s) => s.id),
    from: owner as string,
    subject: 'Open tonnage',
    body: (list as ShipOffer[]).map(
      (s) =>
        `${s.name}, ${CLASS_NAMES[s.vesselClass]} ${thousands.format(s.dwt)} dwt, open ${port(s.openPort)} ${calendarDay(date, s.openDay)}`,
    ),
    deadlineHour: null,
    effortHours: 0,
    approxCommissionUsd: 0,
  }));

  const note: Omit<BrokerNoteEmail, 'id'> = {
    kind: 'brokerNote',
    from: 'Sam, senior broker',
    subject: 'Market colour',
    body: [brokerTip(market, enquiries)],
    deadlineHour: null,
    effortHours: 0,
    approxCommissionUsd: 0,
  };

  const distraction: Omit<DistractionEmail, 'id'> = {
    kind: 'distraction',
    from: 'Quayside Agencies',
    subject: 'URGENT!! Small parcel needs a ship TODAY',
    body: [
      '3,500 t of fertiliser in bags needs lifting this week.',
      'Can you find something quickly? Please call ASAP!!',
    ],
    deadlineHour: DISTRACTION_DEADLINE_HOUR,
    effortHours: DISTRACTION_HOURS,
    approxCommissionUsd: DISTRACTION_PAYOUT_USD,
    payoutUsd: DISTRACTION_PAYOUT_USD,
  };

  const emails = shuffle(rng, [...enquiries, ...positionLists, note, distraction]).map(
    (e, i) => ({ ...e, id: `E${i + 1}` }) as Email,
  );
  return { date, market, emails };
}

/**
 * The senior broker's one line: points at the biggest commission on the
 * desk today. A nudge to prioritise, not a rule. (The overnight news in the
 * morning brief carries the other hints.)
 */
function brokerTip(market: DailyMarket, enquiries: readonly Omit<EnquiryEmail, 'id'>[]): string {
  const biggest = [...enquiries].sort((a, b) => b.approxCommissionUsd - a.approxCommissionUsd)[0]!;
  const cargo = market.cargoes.find((c) => c.id === biggest.cargoId)!;
  return `Biggest commission on the desk today is the ${COMMODITY_NAMES[cargo.commodity]} from ${PORTS[cargo.loadPort].name} to ${PORTS[cargo.dischargePort].name}. Don't let it slip.`;
}

/**
 * The day's contest pair: two same-size cargoes loading near each other,
 * which one well-placed ship suits. The market guarantees one exists.
 */
export function contestPair(market: DailyMarket): [CargoOrder, CargoOrder] {
  for (const a of market.cargoes) {
    const b = market.cargoes.find(
      (c) => c !== a && c.vesselClass === a.vesselClass && distanceNm(c.loadPort, a.loadPort) <= NEARBY_OPEN_NM,
    );
    if (b) return [a, b];
  }
  throw new Error(`no contest pair on ${market.date}`);
}

export function findEmail(inbox: Inbox, id: string): Email {
  const email = inbox.emails.find((e) => e.id === id);
  if (!email) throw new RangeError(`unknown email id: ${id}`);
  return email;
}

/** The enquiry email for a cargo. */
export function enquiryFor(inbox: Inbox, cargoId: string): EnquiryEmail {
  const e = inbox.emails.find((x): x is EnquiryEmail => x.kind === 'enquiry' && x.cargoId === cargoId);
  if (!e) throw new RangeError(`no enquiry for cargo ${cargoId}`);
  return e;
}
