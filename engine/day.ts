// The broker's day: a clock from 09:00 to 17:00 and actions that cost hours.
// Reading email is free. Researching, fixing and handling the distraction
// move the clock on. Pure functions: each action returns a new state.
//
// Fixing is one firm rate per attempt: it closes if the rate is inside both
// clients' hidden limits (the same limits as the deal zone). If not, the
// reply says who refused, the hours are spent, and the player may try again
// while time and the deadline allow.
//
// SIMPLIFICATIONS (see LEARNING.md):
// - Only the player's own actions move the clock; nothing else happens
//   during the day.
// - A refusal says who said no, but not by how much.

import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  RESEARCH_HOURS,
  findEmail,
  type EnquiryEmail,
  type Email,
  type Inbox,
} from './inbox';
import {
  fitCheck,
  isWorkable,
  negotiationLimits,
  TYPICAL_BALLAST_NM,
  type CargoOrder,
  type FitProblem,
  type ShipOffer,
} from './market';
import { distanceNm } from './ports';
import { BROKERAGE_PCT, estimateVoyage, scoreDay, type FixtureResult } from './scoring';

export interface FixRecord {
  emailId: string;
  cargoId: string;
  shipId: string;
  rateUsdPerTonne: number;
  atHour: number;
}

export type FixOutcome = 'fixed' | 'refusedByOwner' | 'refusedByCharterer';

export interface LogEntry {
  atHour: number;
  emailId: string;
  action: 'research' | 'fix' | 'distraction';
  outcome: FixOutcome | 'done';
  shipId?: string;
  rateUsdPerTonne?: number;
}

export interface DayState {
  clockHour: number;
  researched: string[];
  fixtures: FixRecord[];
  distractionHandled: boolean;
  log: LogEntry[];
  ended: boolean;
  /** Who ended the day: the player, or the game because nothing was left to do. */
  endedBy: 'player' | 'nothingLeft' | null;
}

export type BlockReason =
  | 'dayOver'
  | 'notEnoughHours'
  | 'deadlinePassed'
  | 'alreadyFixed'
  | 'alreadyDone'
  | 'shipAlreadyFixed'
  | FitProblem
  | 'wrongEmail'
  | 'invalidRate';

export type ActionResult<T> =
  | { ok: true; state: DayState; outcome: T }
  | { ok: false; state: DayState; reason: BlockReason };

export function startDay(): DayState {
  return {
    clockHour: DAY_START_HOUR,
    researched: [],
    fixtures: [],
    distractionHandled: false,
    log: [],
    ended: false,
    endedBy: null,
  };
}

export const hoursLeft = (state: DayState): number => DAY_END_HOUR - state.clockHour;

export type EnquiryStatus = 'open' | 'fixed' | 'lost';

/** Fixed, still open, or lost (not enough time left before its deadline to fix it). */
export function enquiryStatus(state: DayState, email: EnquiryEmail): EnquiryStatus {
  if (state.fixtures.some((f) => f.emailId === email.id)) return 'fixed';
  return state.clockHour + email.effortHours > lastHour(email) ? 'lost' : 'open';
}

/** The latest the work on an email can finish: its deadline or the end of the day. */
const lastHour = (email: Email) => Math.min(email.deadlineHour ?? DAY_END_HOUR, DAY_END_HOUR);

const usedShipIds = (state: DayState) => new Set(state.fixtures.map((f) => f.shipId));

/** Ships not yet fixed today. A ship can only be fixed once. */
export function availableShips(inbox: Inbox, state: DayState): ShipOffer[] {
  const used = usedShipIds(state);
  return inbox.market.ships.filter((s) => !used.has(s.id));
}

const cargoOf = (inbox: Inbox, email: EnquiryEmail): CargoOrder =>
  inbox.market.cargoes.find((c) => c.id === email.cargoId)!;

function asEnquiry(inbox: Inbox, emailId: string): EnquiryEmail | null {
  const e = findEmail(inbox, emailId);
  return e.kind === 'enquiry' ? e : null;
}

/** Advances the clock and ends the day once no action fits in the time left. */
function spend(inbox: Inbox, state: DayState, hours: number, entry: Omit<LogEntry, 'atHour'>): DayState {
  const next: DayState = {
    ...state,
    clockHour: state.clockHour + hours,
    log: [...state.log, { ...entry, atHour: state.clockHour }],
  };
  return anyActionPossible(inbox, next) ? next : { ...next, ended: true, endedBy: 'nothingLeft' };
}

export interface ResearchRow {
  ship: ShipOffer;
  ballastNm: number;
  /** Day the ship would reach the load port. */
  arrivalDay: number;
  fits: boolean;
  problem: FitProblem | null;
  /** Owner's TCE at the rate idea; null if the ship is the wrong size. */
  estTceUsdPerDay: number | null;
}

/** Voyage estimates for one enquiry against every ship still available. */
export function researchRows(inbox: Inbox, state: DayState, emailId: string): ResearchRow[] {
  const email = asEnquiry(inbox, emailId);
  if (!email) return [];
  const cargo = cargoOf(inbox, email);
  return availableShips(inbox, state).map((ship) => {
    const fit = fitCheck(ship, cargo);
    return {
      ship,
      ballastNm: distanceNm(ship.openPort, cargo.loadPort),
      arrivalDay: fit.arrivalDay,
      fits: fit.fits,
      problem: fit.problem,
      estTceUsdPerDay:
        fit.problem === 'wrongSize' ? null : estimateVoyage(inbox.market, ship, cargo, cargo.marketRateUsdPerTonne).tceUsdPerDay,
    };
  });
}

/** Spend RESEARCH_HOURS running voyage estimates for an enquiry. */
export function research(inbox: Inbox, state: DayState, emailId: string): ActionResult<ResearchRow[]> {
  const email = asEnquiry(inbox, emailId);
  if (!email) return { ok: false, state, reason: 'wrongEmail' };
  if (state.ended) return { ok: false, state, reason: 'dayOver' };
  if (state.researched.includes(emailId)) return { ok: false, state, reason: 'alreadyDone' };
  if (enquiryStatus(state, email) === 'fixed') return { ok: false, state, reason: 'alreadyFixed' };
  if (state.clockHour + RESEARCH_HOURS > DAY_END_HOUR) return { ok: false, state, reason: 'notEnoughHours' };
  if (state.clockHour + RESEARCH_HOURS > lastHour(email)) return { ok: false, state, reason: 'deadlinePassed' };
  const next = spend(inbox, { ...state, researched: [...state.researched, emailId] }, RESEARCH_HOURS, {
    emailId,
    action: 'research',
    outcome: 'done',
  });
  return { ok: true, state: next, outcome: researchRows(inbox, next, emailId) };
}

/** Try to fix an enquiry with a ship at a rate. Costs the enquiry's effort hours either way. */
export function attemptFix(
  inbox: Inbox,
  state: DayState,
  emailId: string,
  shipId: string,
  rateUsdPerTonne: number,
): ActionResult<FixOutcome> {
  const email = asEnquiry(inbox, emailId);
  if (!email) return { ok: false, state, reason: 'wrongEmail' };
  if (state.ended) return { ok: false, state, reason: 'dayOver' };
  if (!Number.isFinite(rateUsdPerTonne) || rateUsdPerTonne <= 0) return { ok: false, state, reason: 'invalidRate' };
  if (enquiryStatus(state, email) === 'fixed') return { ok: false, state, reason: 'alreadyFixed' };
  if (state.clockHour + email.effortHours > DAY_END_HOUR) return { ok: false, state, reason: 'notEnoughHours' };
  if (state.clockHour + email.effortHours > lastHour(email)) return { ok: false, state, reason: 'deadlinePassed' };
  if (usedShipIds(state).has(shipId)) return { ok: false, state, reason: 'shipAlreadyFixed' };
  const ship = inbox.market.ships.find((s) => s.id === shipId);
  if (!ship) throw new RangeError(`unknown ship id: ${shipId}`);
  const cargo = cargoOf(inbox, email);
  const fit = fitCheck(ship, cargo);
  if (!fit.fits) return { ok: false, state, reason: fit.problem! };

  // A firm offer against the hidden limits that define the deal zone.
  const { ownerFloorRate, chartererCeilingRate } = negotiationLimits(inbox.market, ship, cargo);
  const outcome: FixOutcome =
    rateUsdPerTonne > chartererCeilingRate ? 'refusedByCharterer'
    : rateUsdPerTonne < ownerFloorRate ? 'refusedByOwner'
    : 'fixed';
  const withFix: DayState =
    outcome === 'fixed'
      ? {
          ...state,
          fixtures: [...state.fixtures, { emailId, cargoId: cargo.id, shipId, rateUsdPerTonne, atHour: state.clockHour }],
        }
      : state;
  const next = spend(inbox, withFix, email.effortHours, { emailId, action: 'fix', outcome, shipId, rateUsdPerTonne });
  return { ok: true, state: next, outcome };
}

/** Deal with the urgent-looking small email. Pays a little, costs an hour. */
export function handleDistraction(inbox: Inbox, state: DayState, emailId: string): ActionResult<'done'> {
  const email = findEmail(inbox, emailId);
  if (email.kind !== 'distraction') return { ok: false, state, reason: 'wrongEmail' };
  if (state.ended) return { ok: false, state, reason: 'dayOver' };
  if (state.distractionHandled) return { ok: false, state, reason: 'alreadyDone' };
  if (state.clockHour + email.effortHours > DAY_END_HOUR) return { ok: false, state, reason: 'notEnoughHours' };
  if (state.clockHour + email.effortHours > lastHour(email)) return { ok: false, state, reason: 'deadlinePassed' };
  const next = spend(inbox, { ...state, distractionHandled: true }, email.effortHours, {
    emailId,
    action: 'distraction',
    outcome: 'done',
  });
  return { ok: true, state: next, outcome: 'done' };
}

/** The player chooses to stop for the day. */
export const endDay = (state: DayState): DayState =>
  state.ended ? state : { ...state, ended: true, endedBy: 'player' };

/** Why an unfixed enquiry can no longer be acted on, or null if it still can. */
export type EnquiryBlocker = 'deadline' | 'endOfDay' | 'noShip';

export function enquiryBlocker(inbox: Inbox, state: DayState, email: EnquiryEmail): EnquiryBlocker | null {
  if (state.clockHour + email.effortHours > DAY_END_HOUR) return 'endOfDay';
  if (state.clockHour + email.effortHours > lastHour(email)) return 'deadline';
  const cargo = cargoOf(inbox, email);
  if (!availableShips(inbox, state).some((s) => fitCheck(s, cargo).fits)) return 'noShip';
  return null;
}

/** True if at least one action could still be taken in the time left. */
export function anyActionPossible(inbox: Inbox, state: DayState): boolean {
  if (state.ended) return false;
  const ships = availableShips(inbox, state);
  return inbox.emails.some((email) => {
    if (email.kind === 'distraction') {
      return !state.distractionHandled && state.clockHour + email.effortHours <= lastHour(email);
    }
    if (email.kind !== 'enquiry' || enquiryStatus(state, email) !== 'open') return false;
    const cargo = cargoOf(inbox, email);
    return ships.some((s) => fitCheck(s, cargo).fits);
  });
}

// ---------------------------------------------------------------------------
// End-of-day summary: structured data; the UI turns it into sentences.

export type FixtureReason =
  /** The owner lost out mainly because the ship sailed a long way empty. */
  | { kind: 'longBallast'; ballastNm: number; ownerTceUsdPerDay: number }
  /** The charterer paid above its rate idea. */
  | { kind: 'rateAboveIdea'; pctAboveIdea: number }
  /** The owner earned below market because the rate was low. */
  | { kind: 'rateBelowMarket'; ownerTceUsdPerDay: number }
  /** Both sides did at least as well as the market. */
  | { kind: 'goodFit'; ballastNm: number; ownerTceUsdPerDay: number };

export interface FixtureSummary {
  fixture: FixRecord;
  result: FixtureResult;
  reason: FixtureReason;
}

export interface SkippedEnquiry {
  email: EnquiryEmail;
  /** Why it could no longer be acted on when the day ended (null if it still could). */
  blocker: EnquiryBlocker | null;
  /** A ship that could have fixed it, with a rough commission, or null if none could. */
  couldHaveFixed: { ship: ShipOffer; ballastNm: number; approxCommissionUsd: number } | null;
}

export interface DaySummary {
  endedAtHour: number;
  endedBy: DayState['endedBy'];
  fixtures: FixtureSummary[];
  /** Brokerage on fixtures plus the distraction's payout. */
  totalCommissionUsd: number;
  totalScore: number;
  /** Averages over the day's fixtures; null with no fixtures. */
  avgOwnerSatisfaction: number | null;
  avgChartererSatisfaction: number | null;
  skippedEnquiries: SkippedEnquiry[];
  distractionSkipped: boolean;
}

export function summarizeDay(inbox: Inbox, state: DayState): DaySummary {
  const day = scoreDay(
    inbox.market,
    state.fixtures.map((f) => ({ shipId: f.shipId, cargoId: f.cargoId, rateUsdPerTonne: f.rateUsdPerTonne })),
  );
  const fixtures = state.fixtures.map((fixture, i) => {
    const result = day.fixtures[i]!;
    return { fixture, result, reason: explain(inbox, fixture, result) };
  });
  const distractionUsd = state.distractionHandled
    ? inbox.emails.reduce((sum, e) => sum + (e.kind === 'distraction' ? e.payoutUsd : 0), 0)
    : 0;
  const avg = (pick: (r: FixtureResult) => number) =>
    fixtures.length === 0 ? null : fixtures.reduce((s, f) => s + pick(f.result), 0) / fixtures.length;

  const used = usedShipIds(state);
  const skippedEnquiries = inbox.emails
    .filter((e): e is EnquiryEmail => e.kind === 'enquiry' && enquiryStatus(state, e) !== 'fixed')
    .map((email) => ({
      email,
      blocker: enquiryBlocker(inbox, state, email),
      couldHaveFixed: bestShipFor(inbox, email, used),
    }));

  return {
    endedAtHour: state.clockHour,
    endedBy: state.endedBy,
    fixtures,
    totalCommissionUsd: day.totalBrokerageUsd + distractionUsd,
    totalScore: day.totalScore + distractionUsd,
    avgOwnerSatisfaction: avg((r) => r.ownerSatisfaction),
    avgChartererSatisfaction: avg((r) => r.chartererSatisfaction),
    skippedEnquiries,
    distractionSkipped: !state.distractionHandled,
  };
}

/** The workable ship with the best estimated TCE, preferring ones the player left free. */
function bestShipFor(inbox: Inbox, email: EnquiryEmail, used: Set<string>): SkippedEnquiry['couldHaveFixed'] {
  const cargo = cargoOf(inbox, email);
  const ranked = inbox.market.ships
    .filter((s) => isWorkable(inbox.market, s, cargo))
    .map((s) => ({ s, tce: estimateVoyage(inbox.market, s, cargo, cargo.marketRateUsdPerTonne).tceUsdPerDay }))
    .sort((a, b) => Number(used.has(a.s.id)) - Number(used.has(b.s.id)) || b.tce - a.tce);
  const best = ranked[0];
  if (!best) return null;
  const { ownerFloorRate, chartererCeilingRate } = negotiationLimits(inbox.market, best.s, cargo);
  const midRate = (ownerFloorRate + chartererCeilingRate) / 2;
  return {
    ship: best.s,
    ballastNm: distanceNm(best.s.openPort, cargo.loadPort),
    approxCommissionUsd: Math.round((cargo.quantityTonnes * midRate * (BROKERAGE_PCT / 100)) / 100) * 100,
  };
}

function explain(inbox: Inbox, fixture: FixRecord, result: FixtureResult): FixtureReason {
  const ship = inbox.market.ships.find((s) => s.id === fixture.shipId)!;
  const cargo = inbox.market.cargoes.find((c) => c.id === fixture.cargoId)!;
  const ballastNm = distanceNm(ship.openPort, cargo.loadPort);
  const ownerTceUsdPerDay = result.voyage.tceUsdPerDay;
  if (result.ownerSatisfaction < 50 && ballastNm > TYPICAL_BALLAST_NM) {
    return { kind: 'longBallast', ballastNm, ownerTceUsdPerDay };
  }
  if (result.chartererSatisfaction < 50) {
    return { kind: 'rateAboveIdea', pctAboveIdea: (fixture.rateUsdPerTonne / cargo.marketRateUsdPerTonne - 1) * 100 };
  }
  if (result.ownerSatisfaction < 50) return { kind: 'rateBelowMarket', ownerTceUsdPerDay };
  return { kind: 'goodFit', ballastNm, ownerTceUsdPerDay };
}
