// Negotiating a fixture. Each round the broker either:
// - sends a proposal: each side works out its counter (part of the way from
//   its current position towards its hidden limit) and accepts if the
//   proposal is at least that good, otherwise replies with the counter; or
// - makes a firm offer: each side accepts if it's within their hidden limit,
//   and if either says no, the deal is dead.
// The final round is always a last call, so a proposal there works like a
// firm offer. After MAX_ROUNDS without a deal the cargo is lost for the day.
// Every proposal or firm offer uses one of the day's PROPOSALS_PER_DAY.
//
// Each client has a hidden limit, an opening margin and a concession share,
// all drawn from the day's seed, so the same day always negotiates the same
// way, but meeting in the middle is not reliably the best play.
//
// SIMPLIFICATIONS (see LEARNING.md):
// - Each client concedes the same share of the gap every round.
// - Nobody bluffs, remembers past days, or reacts to how far off you were.
// - One message goes to both sides at once; real brokers relay separately.
// PLACEHOLDER: all ranges and counts here are tuned for play.

import {
  negotiationLimits,
  seededShare,
  type DailyMarket,
  type NegotiationLimits,
} from './market';

export const MAX_ROUNDS = 3;
/** Proposals and firm offers the broker can send in a day, across all cargoes. */
export const PROPOSALS_PER_DAY = 8;
/** How far from its limit each side opens, as a share of the limit. */
export const OPENING_MARGIN_RANGE: readonly [number, number] = [0.1, 0.35];
/** Share of the gap to its limit a side gives up with each counter. */
export const CONCESSION_RANGE: readonly [number, number] = [0.35, 0.65];

export type RoundKind = 'proposal' | 'firm';

export interface NegotiationRound {
  kind: RoundKind;
  proposedRate: number;
  ownerAccepted: boolean;
  chartererAccepted: boolean;
  /** Positions after this round's replies. */
  ownerOffer: number;
  chartererBid: number;
}

export type NegotiationStatus = 'open' | 'agreed' | 'failed';

/** Hidden per-client behaviour. The UI must not show any of this. */
export interface NegotiationSecrets extends NegotiationLimits {
  ownerConcession: number;
  chartererConcession: number;
}

export interface Negotiation {
  shipId: string;
  cargoId: string;
  status: NegotiationStatus;
  /** The owner's current asking rate ($/t). */
  ownerOffer: number;
  /** The charterer's current bid ($/t). */
  chartererBid: number;
  agreedRate: number | null;
  history: NegotiationRound[];
  /** Kept for the engine; the UI must not show these. */
  limits: NegotiationSecrets;
}

const roundUp = (rate: number) => Math.ceil(rate * 20 - 1e-9) / 20;
const roundDown = (rate: number) => Math.floor(rate * 20 + 1e-9) / 20;

export function startNegotiation(market: DailyMarket, shipId: string, cargoId: string): Negotiation {
  const ship = market.ships.find((s) => s.id === shipId);
  const cargo = market.cargoes.find((c) => c.id === cargoId);
  if (!ship) throw new RangeError(`unknown ship id: ${shipId}`);
  if (!cargo) throw new RangeError(`unknown cargo id: ${cargoId}`);
  if (ship.vesselClass !== cargo.vesselClass) {
    throw new Error(`ship ${ship.id} is a ${ship.vesselClass} but cargo ${cargo.id} needs a ${cargo.vesselClass}`);
  }
  const { ownerFloorRate, chartererCeilingRate } = negotiationLimits(market, ship, cargo);
  const key = `${market.date}|${ship.id}|${cargo.id}`;
  const ownerMargin = seededShare(`${key}|ownerOpening`, OPENING_MARGIN_RANGE);
  const chartererMargin = seededShare(`${key}|chartererOpening`, OPENING_MARGIN_RANGE);
  return {
    shipId,
    cargoId,
    status: 'open',
    ownerOffer: roundUp(ownerFloorRate * (1 + ownerMargin)),
    chartererBid: roundDown(chartererCeilingRate * (1 - chartererMargin)),
    agreedRate: null,
    history: [],
    limits: {
      ownerFloorRate,
      chartererCeilingRate,
      ownerConcession: seededShare(`${key}|ownerConcession`, CONCESSION_RANGE),
      chartererConcession: seededShare(`${key}|chartererConcession`, CONCESSION_RANGE),
    },
  };
}

/** Sends a proposal to both sides. In the final round it works like a firm offer. */
export function propose(n: Negotiation, rateUsdPerTonne: number): Negotiation {
  return isFinalRound(n) ? firmOffer(n, rateUsdPerTonne) : play(n, rateUsdPerTonne, 'proposal');
}

/** Take it or leave it: agreed if inside both hidden limits, otherwise the deal is dead. */
export function firmOffer(n: Negotiation, rateUsdPerTonne: number): Negotiation {
  return play(n, rateUsdPerTonne, 'firm');
}

function play(n: Negotiation, rate: number, kind: RoundKind): Negotiation {
  if (n.status !== 'open') throw new Error(`negotiation is already ${n.status}`);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`rate must be a positive number, got ${rate}`);
  }
  const s = n.limits;
  const firm = kind === 'firm';
  // Where each side would move to if it countered this round.
  const ownerCounter = Math.max(s.ownerFloorRate, roundUp(n.ownerOffer - (n.ownerOffer - s.ownerFloorRate) * s.ownerConcession));
  const chartererCounter = Math.min(s.chartererCeilingRate, roundDown(n.chartererBid + (s.chartererCeilingRate - n.chartererBid) * s.chartererConcession));
  // A side takes a proposal at least as good as its own counter (so it never
  // counters past what you offered). A firm offer is judged against the limit.
  const ownerAccepted = rate >= (firm ? s.ownerFloorRate : ownerCounter);
  const chartererAccepted = rate <= (firm ? s.chartererCeilingRate : chartererCounter);
  const agreed = ownerAccepted && chartererAccepted;

  // A side that says no to a proposal replies with its counter. A firm
  // offer gets no counters: it either closes or ends the talks.
  const counter = !firm && !agreed;
  const ownerOffer = counter && !ownerAccepted ? ownerCounter : n.ownerOffer;
  const chartererBid = counter && !chartererAccepted ? chartererCounter : n.chartererBid;

  const history = [...n.history, { kind, proposedRate: rate, ownerAccepted, chartererAccepted, ownerOffer, chartererBid }];
  const status: NegotiationStatus = agreed
    ? 'agreed'
    : firm || history.length >= MAX_ROUNDS
      ? 'failed'
      : 'open';
  return { ...n, status, ownerOffer, chartererBid, agreedRate: agreed ? rate : null, history };
}

export const roundsLeft = (n: Negotiation): number => MAX_ROUNDS - n.history.length;

/** True when the next message is the last call. */
export const isFinalRound = (n: Negotiation): boolean => n.status === 'open' && roundsLeft(n) === 1;

/** Proposals and firm offers left today, given every negotiation so far. */
export function proposalsLeft(negotiations: readonly Negotiation[]): number {
  return PROPOSALS_PER_DAY - negotiations.reduce((sum, n) => sum + n.history.length, 0);
}
