// Negotiating a fixture: the broker sends one proposed rate to both sides at
// once, each side accepts or counters, and after MAX_ROUNDS without a deal
// the cargo is lost for the day. Before the final round a side accepts only a
// rate at least as good as its current position; in the final round ("last
// call") it accepts anything within its limit rather than lose the deal.
//
// Each owner has a hidden floor and each charterer a hidden ceiling, drawn
// from the day's seed, so the same day always negotiates the same way.
//
// SIMPLIFICATIONS (see LEARNING.md):
// - Sides concede a fixed share of the gap to their limit each round.
// - Nobody bluffs, remembers past days, or reacts to how far off you were.
// - One proposal goes to both sides at once; real brokers relay separately.
// PLACEHOLDER: limit ranges, opening margin and concession are tuned for play.

import { negotiationLimits, type DailyMarket, type NegotiationLimits } from './market';

export const MAX_ROUNDS = 3;
/** Each counter moves this share of the way from the current position to the limit. */
export const CONCESSION = 0.5;
/** Openings: owners ask this much above market (or their floor), charterers bid this much below. */
export const OPENING_MARGIN = 0.12;

export interface NegotiationRound {
  proposedRate: number;
  ownerAccepted: boolean;
  chartererAccepted: boolean;
  /** Positions after this round's replies. */
  ownerOffer: number;
  chartererBid: number;
}

export type NegotiationStatus = 'open' | 'agreed' | 'failed';

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
  limits: NegotiationLimits;
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
  const limits = negotiationLimits(market, ship, cargo);
  const market$ = cargo.marketRateUsdPerTonne;
  return {
    shipId,
    cargoId,
    status: 'open',
    ownerOffer: roundUp(Math.max(limits.ownerFloorRate, market$) * (1 + OPENING_MARGIN)),
    chartererBid: roundDown(Math.min(limits.chartererCeilingRate, market$) * (1 - OPENING_MARGIN)),
    agreedRate: null,
    history: [],
    limits,
  };
}

/** Sends one proposed rate to both sides and returns the negotiation after their replies. */
export function propose(n: Negotiation, rateUsdPerTonne: number): Negotiation {
  if (n.status !== 'open') throw new Error(`negotiation is already ${n.status}`);
  if (!Number.isFinite(rateUsdPerTonne) || rateUsdPerTonne <= 0) {
    throw new RangeError(`rate must be a positive number, got ${rateUsdPerTonne}`);
  }
  const { ownerFloorRate, chartererCeilingRate } = n.limits;
  const lastCall = isFinalRound(n);
  const ownerAccepted = rateUsdPerTonne >= (lastCall ? ownerFloorRate : n.ownerOffer);
  const chartererAccepted = rateUsdPerTonne <= (lastCall ? chartererCeilingRate : n.chartererBid);

  // A side that says no counters, moving part of the way towards its limit.
  const ownerOffer = ownerAccepted
    ? n.ownerOffer
    : Math.max(ownerFloorRate, roundUp(n.ownerOffer - (n.ownerOffer - ownerFloorRate) * CONCESSION));
  const chartererBid = chartererAccepted
    ? n.chartererBid
    : Math.min(chartererCeilingRate, roundDown(n.chartererBid + (chartererCeilingRate - n.chartererBid) * CONCESSION));

  const history = [
    ...n.history,
    { proposedRate: rateUsdPerTonne, ownerAccepted, chartererAccepted, ownerOffer, chartererBid },
  ];
  const agreed = ownerAccepted && chartererAccepted;
  const status: NegotiationStatus = agreed ? 'agreed' : history.length >= MAX_ROUNDS ? 'failed' : 'open';
  return {
    ...n,
    status,
    ownerOffer,
    chartererBid,
    agreedRate: agreed ? rateUsdPerTonne : null,
    history,
  };
}

export const roundsLeft = (n: Negotiation): number => MAX_ROUNDS - n.history.length;

/** True when the next proposal is the last call. */
export const isFinalRound = (n: Negotiation): boolean => n.status === 'open' && roundsLeft(n) === 1;
