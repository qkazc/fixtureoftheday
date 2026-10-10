// The best possible day: what a broker who could see every client's hidden
// limits would do. It gives the player a par to measure against, and lets the
// daily picker rate how interesting a day is (see daily.ts).
//
// The search is exhaustive but small. A day has 3-4 enquiries and 5-6 ships,
// so it tries every set of enquiries (with and without the distraction),
// keeps the sets that fit the clock, and for each tries every way of giving
// them different ships.
//
// SIMPLIFICATIONS (see LEARNING.md):
// - Perfect information: the solver knows the hidden limits, so it never
//   researches and never has a fix refused. A real player can only match it
//   with good reading of the brief and some luck. It is a ceiling, not an
//   expectation.

import { DAY_END_HOUR, DAY_START_HOUR, type DistractionEmail, type Email, type EnquiryEmail, type Inbox } from './inbox';
import { acceptableQuotes, isWorkable, type CargoOrder, type DailyMarket, type ShipOffer } from './market';
import { scoreDay } from './scoring';

export interface BestRate {
  rateUsdPerTonne: number;
  /** The fixture's score at that rate (brokerage × satisfaction). */
  score: number;
}

/**
 * The quotable rate that scores best for this ship and cargo, inside both
 * hidden limits; null if the ship doesn't fit or no quotable rate is accepted.
 */
export function bestRate(market: DailyMarket, ship: ShipOffer, cargo: CargoOrder): BestRate | null {
  if (!isWorkable(market, ship, cargo)) return null;
  let best: BestRate | null = null;
  for (const rate of acceptableQuotes(market, ship, cargo)) {
    const score = scoreDay(market, [{ shipId: ship.id, cargoId: cargo.id, rateUsdPerTonne: rate }]).totalScore;
    if (!best || score > best.score) best = { rateUsdPerTonne: rate, score };
  }
  return best;
}

export interface PlannedFix {
  emailId: string;
  shipId: string;
  rateUsdPerTonne: number;
  score: number;
}

export interface BestDay {
  /** Total score, including the distraction's payout if handled. */
  score: number;
  commissionUsd: number;
  handlesDistraction: boolean;
  /** The fixes, in the order to do them (after the distraction, if handled). */
  fixes: PlannedFix[];
}

/** The latest the work on an email can finish: its deadline or the end of the day. */
const lastHour = (email: Email) => Math.min(email.deadlineHour ?? DAY_END_HOUR, DAY_END_HOUR);

/**
 * True if these jobs fit the day. Doing them soonest-deadline-first is enough
 * to check: if any order fits, that one does.
 */
function fitsTheDay(jobs: readonly Email[]): boolean {
  let clock = DAY_START_HOUR;
  for (const job of jobs) {
    clock += job.effortHours;
    if (clock > lastHour(job)) return false;
  }
  return true;
}

const byDeadline = (a: Email, b: Email) => lastHour(a) - lastHour(b) || a.id.localeCompare(b.id);

export function solveDay(inbox: Inbox): BestDay {
  const { market } = inbox;
  const enquiries = inbox.emails.filter((e): e is EnquiryEmail => e.kind === 'enquiry');
  const distraction = inbox.emails.find((e): e is DistractionEmail => e.kind === 'distraction');
  // Every ship that could fix each enquiry, at its best rate.
  const options = enquiries.map((e) => {
    const cargo = market.cargoes.find((c) => c.id === e.cargoId)!;
    return market.ships.flatMap((ship) => {
      const r = bestRate(market, ship, cargo);
      return r ? [{ shipId: ship.id, ...r }] : [];
    });
  });

  let best: BestDay = { score: 0, commissionUsd: 0, handlesDistraction: false, fixes: [] };
  for (let mask = 0; mask < 1 << enquiries.length; mask++) {
    const chosen = enquiries.map((_, i) => i).filter((i) => mask & (1 << i));
    const assignment = bestAssignment(chosen.map((i) => options[i]!));
    if (!assignment) continue;
    for (const withDistraction of distraction ? [false, true] : [false]) {
      const jobs: Email[] = [...chosen.map((i) => enquiries[i]!), ...(withDistraction ? [distraction!] : [])];
      if (!fitsTheDay([...jobs].sort(byDeadline))) continue;
      const payout = withDistraction ? distraction!.payoutUsd : 0;
      const score = assignment.score + payout;
      if (score <= best.score) continue;
      const fixes = chosen
        .map((i, k) => ({ emailId: enquiries[i]!.id, ...assignment.picks[k]! }))
        .sort((a, b) => byDeadline(enquiries.find((e) => e.id === a.emailId)!, enquiries.find((e) => e.id === b.emailId)!));
      const day = scoreDay(
        market,
        fixes.map((f) => ({ shipId: f.shipId, cargoId: enquiries.find((e) => e.id === f.emailId)!.cargoId, rateUsdPerTonne: f.rateUsdPerTonne })),
      );
      best = { score, commissionUsd: day.totalBrokerageUsd + payout, handlesDistraction: withDistraction, fixes };
    }
  }
  return best;
}

type Option = { shipId: string; rateUsdPerTonne: number; score: number };

/** The highest-scoring way to give each enquiry a different ship, or null if there is none. */
function bestAssignment(optionsPerEnquiry: readonly Option[][]): { score: number; picks: Option[] } | null {
  let best: { score: number; picks: Option[] } | null = null;
  const walk = (k: number, used: Set<string>, picks: Option[], score: number) => {
    if (k === optionsPerEnquiry.length) {
      if (!best || score > best.score) best = { score, picks: [...picks] };
      return;
    }
    for (const o of optionsPerEnquiry[k]!) {
      if (used.has(o.shipId)) continue;
      used.add(o.shipId);
      picks.push(o);
      walk(k + 1, used, picks, score + o.score);
      picks.pop();
      used.delete(o.shipId);
    }
  };
  walk(0, new Set(), [], 0);
  return best;
}
