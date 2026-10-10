// The shareable result line for a finished day. Spoiler-free: no ship
// names or rates, so it doesn't give the day away to someone yet to play.

import { calendarDay, type DaySummary, type EnquiryEmail, type Inbox } from '../engine';
import { formatUsd } from './format';

/**
 * One square per enquiry, soonest deadline first:
 * 🟩 fixed with both sides at least content (50+), 🟨 fixed, ⬛ missed.
 */
export function resultSquares(inbox: Inbox, summary: DaySummary): string {
  const enquiries = inbox.emails
    .filter((e): e is EnquiryEmail => e.kind === 'enquiry')
    .sort((a, b) => (a.deadlineHour ?? 24) - (b.deadlineHour ?? 24));
  return enquiries
    .map((e) => {
      const f = summary.fixtures.find((x) => x.fixture.emailId === e.id);
      if (!f) return '⬛';
      return f.result.ownerSatisfaction >= 50 && f.result.chartererSatisfaction >= 50 ? '🟩' : '🟨';
    })
    .join('');
}

export function shareText(inbox: Inbox, summary: DaySummary): string {
  const enquiries = inbox.emails.filter((e) => e.kind === 'enquiry').length;
  const pct = (v: number | null) => (v === null ? '–' : String(Math.round(v)));
  return [
    `Fixture of the Day · ${calendarDay(inbox.date, 0)} ${inbox.date.slice(0, 4)}`,
    `⚓ ${summary.fixtures.length}/${enquiries} fixed · ${formatUsd(summary.totalCommissionUsd)} commission`,
    `Owners ${pct(summary.avgOwnerSatisfaction)} · Charterers ${pct(summary.avgChartererSatisfaction)} · Score ${Math.round(summary.totalScore).toLocaleString('en-US')}`,
    resultSquares(inbox, summary),
  ].join('\n');
}
