// Picking each date's puzzle. Every date has a first draw (variant 0). If
// the solver rates it dull or unfair, the next variant is tried, up to a
// limit. All of it is seeded, so everyone still gets the same day.
//
// "Interesting" here means planning matters: a sensible but naive broker
// (soonest deadline first, best free ship each time, priced perfectly)
// would fall clearly short of the best possible day. About a quarter of raw
// draws are days where that naive plan is already the best.
//
// PLACEHOLDER: the thresholds and the number of tries are tuned by
// measuring a year of dates (most dates pass by the 3rd try; about 1% use
// up every try and get the most interesting draw seen).

import { DAY_END_HOUR, DAY_START_HOUR, generateInbox, type Email, type EnquiryEmail, type Inbox } from './inbox';
import { bestRate, solveDay, type BestDay } from './solver';

/** A day counts as interesting if the naive plan misses at least this share of the best score. */
export const MIN_TRAP_GAP = 0.05;
/** And as fair if the best plan fixes all the enquiries but at most this many. */
export const MAX_UNFIXABLE = 1;
/** Variants tried before settling for the most interesting fair one. */
export const MAX_VARIANTS = 16;

const lastHour = (email: Email) => Math.min(email.deadlineHour ?? DAY_END_HOUR, DAY_END_HOUR);

/**
 * A sensible but naive broker who prices perfectly: works through the
 * enquiries soonest deadline first (biggest first on a tie), gives each the
 * best-scoring free ship, and ignores the distraction.
 */
export function naiveScore(inbox: Inbox): number {
  const { market } = inbox;
  const enquiries = inbox.emails
    .filter((e): e is EnquiryEmail => e.kind === 'enquiry')
    .sort((a, b) => lastHour(a) - lastHour(b) || b.approxCommissionUsd - a.approxCommissionUsd);
  const used = new Set<string>();
  let clock = DAY_START_HOUR;
  let score = 0;
  for (const e of enquiries) {
    if (clock + e.effortHours > lastHour(e)) continue;
    const cargo = market.cargoes.find((c) => c.id === e.cargoId)!;
    let pick: { shipId: string; score: number } | null = null;
    for (const s of market.ships) {
      if (used.has(s.id)) continue;
      const r = bestRate(market, s, cargo);
      if (r && (!pick || r.score > pick.score)) pick = { shipId: s.id, score: r.score };
    }
    if (!pick) continue;
    used.add(pick.shipId);
    clock += e.effortHours;
    score += pick.score;
  }
  return score;
}

export interface DayRating {
  best: BestDay;
  naiveScore: number;
  /** Share of the best score the naive plan misses, 0-1. Higher means planning matters more. */
  trapGap: number;
  /** Enquiries even the best plan can't fix. */
  unfixable: number;
  interesting: boolean;
  fair: boolean;
}

export function rateDay(inbox: Inbox): DayRating {
  const best = solveDay(inbox);
  const naive = naiveScore(inbox);
  const trapGap = best.score > 0 ? Math.max(0, 1 - naive / best.score) : 0;
  const unfixable = inbox.emails.filter((e) => e.kind === 'enquiry').length - best.fixes.length;
  return {
    best,
    naiveScore: naive,
    trapGap,
    unfixable,
    interesting: trapGap >= MIN_TRAP_GAP,
    fair: unfixable <= MAX_UNFIXABLE,
  };
}

export interface DailyPuzzle {
  inbox: Inbox;
  rating: DayRating;
  /** Which draw was chosen (0 is the first). */
  variant: number;
}

/** The puzzle for a date: the first interesting and fair draw, else the most interesting fair one. */
export function dailyPuzzle(date: string): DailyPuzzle {
  let fallback: DailyPuzzle | null = null;
  for (let variant = 0; variant < MAX_VARIANTS; variant++) {
    const inbox = generateInbox(date, variant);
    const rating = rateDay(inbox);
    const candidate = { inbox, rating, variant };
    if (rating.fair && rating.interesting) return candidate;
    const better = (a: DailyPuzzle) =>
      Number(rating.fair) - Number(a.rating.fair) || rating.trapGap - a.rating.trapGap;
    if (!fallback || better(fallback) > 0) fallback = candidate;
  }
  return fallback!;
}
