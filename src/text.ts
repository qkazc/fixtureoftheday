// Plain-language text for the inbox UI and the end-of-day summary.
// Pure functions, unit-tested; the DOM code only places these strings.

import {
  DAY_END_HOUR,
  PORTS,
  type BlockReason,
  type CargoOrder,
  type FixOutcome,
  type FixtureSummary,
  type SkippedEnquiry,
  type VesselClass,
} from '../engine';
import { formatClass, formatCommodity, formatNm, formatTonnes, formatUsd, formatUsdPerDay } from './format';

/** 9.5 → "09:30". */
export function clockLabel(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function deadlineLabel(deadlineHour: number | null): string {
  if (deadlineHour === null || deadlineHour >= DAY_END_HOUR) return 'no rush';
  return `answer by ${clockLabel(deadlineHour)}`;
}

/** "$15k" style, for the inbox list. */
export function roughUsd(usd: number): string {
  if (usd >= 10_000) return `~$${Math.round(usd / 1000)}k`;
  if (usd >= 1000) return `~$${Number((usd / 1000).toFixed(1))}k`;
  return `~${formatUsd(usd)}`;
}

export function hoursLabel(hours: number): string {
  return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)} h`;
}

export function cargoLabel(c: CargoOrder): string {
  return `${formatTonnes(c.quantityTonnes)} ${formatCommodity(c.commodity).toLowerCase()}, ${PORTS[c.loadPort].name} to ${PORTS[c.dischargePort].name}`;
}

const BLOCK_MESSAGES: Record<BlockReason, string> = {
  dayOver: 'The day is over.',
  notEnoughHours: 'Not enough time left today for that.',
  deadlinePassed: 'Too late: there is no longer time to do that before the deadline.',
  alreadyFixed: 'This cargo is already fixed.',
  alreadyDone: 'Already done.',
  shipAlreadyFixed: 'That ship has already been fixed today.',
  wrongSize: 'That ship is the wrong size for this cargo.',
  missesLaycan: 'That ship cannot reach the load port before the laycan closes.',
  wrongEmail: 'That action does not apply to this email.',
  invalidRate: 'Enter a rate above zero.',
};

export const blockMessage = (reason: BlockReason): string => BLOCK_MESSAGES[reason];

export function fixOutcomeMessage(outcome: FixOutcome, rate: number): string {
  const r = `$${rate.toFixed(2)}/t`;
  switch (outcome) {
    case 'fixed':
      return `Fixed at ${r}.`;
    case 'refusedByOwner':
      return `The owner turned down ${r}: too low for them.`;
    case 'refusedByCharterer':
      return `The charterer turned down ${r}: more than they will pay.`;
  }
}

/** One plain line on why a fixture scored what it did. */
export function fixtureReasonText(f: FixtureSummary): string {
  const r = f.reason;
  switch (r.kind) {
    case 'longBallast':
      return `Owner earned only ${formatUsdPerDay(r.ownerTceUsdPerDay)} because the ballast leg was ${formatNm(r.ballastNm)}.`;
    case 'rateAboveIdea':
      return `Charterer paid ${Math.round(r.pctAboveIdea)}% over their rate idea, so they were less happy.`;
    case 'rateBelowMarket':
      return `Owner earned only ${formatUsdPerDay(r.ownerTceUsdPerDay)}: the rate was low for them.`;
    case 'goodFit':
      return `A good fit: the ship was ${formatNm(r.ballastNm)} from the load port, so the owner earned ${formatUsdPerDay(r.ownerTceUsdPerDay)} at a fair rate.`;
  }
}

/** "worth ~$15k. Ocean Plover, a Panamax 450 nm away, could have fixed it for about $13,900 commission." */
export function skippedText(s: SkippedEnquiry, vesselClass: (shipClass: VesselClass) => string = formatClass): string {
  const worth = `worth ${roughUsd(s.email.approxCommissionUsd)}`;
  const could = s.couldHaveFixed;
  if (!could) return `${worth}. No ship today could have fixed it.`;
  return `${worth}. ${could.ship.name}, a ${vesselClass(could.ship.vesselClass)} ${formatNm(could.ballastNm)} away, could have fixed it for about ${formatUsd(could.approxCommissionUsd)} commission.`;
}
