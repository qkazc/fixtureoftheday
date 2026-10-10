// The inbox list as rows a person can scan: grouped into what needs action
// (sorted by deadline) and what is just for reference, with a short summary
// line instead of the full email subject.

import {
  DAY_END_HOUR,
  enquiryStatus,
  PORTS,
  type DayState,
  type Email,
  type Inbox,
} from '../engine';
import { formatClass, formatCommodity, formatTonnes } from './format';
import { clockLabel, hoursLabel, roughUsd } from './text';

export type RowTag = 'CARGO' | 'SHIPS' | 'NOTE' | 'URGENT';
export type RowStatus = 'FIXED' | 'LOST' | 'DONE' | 'MISSED' | null;

export interface InboxRow {
  id: string;
  group: 'action' | 'reference';
  tag: RowTag;
  from: string;
  /** One short line: what the email is about. */
  summary: string;
  /** "13:00", "no rush", or "" for reference emails. */
  due: string;
  /** True when the deadline is getting close (less than an hour of slack). */
  dueSoon: boolean;
  /** "2 h · ~$23k", or "" when there is nothing to do. */
  stakes: string;
  status: RowStatus;
}

const TAGS: Record<Email['kind'], RowTag> = {
  enquiry: 'CARGO',
  positionList: 'SHIPS',
  brokerNote: 'NOTE',
  distraction: 'URGENT',
};

export function inboxRows(inbox: Inbox, day: DayState): InboxRow[] {
  const rows = inbox.emails.map((e): InboxRow => {
    const action = e.kind === 'enquiry' || e.kind === 'distraction';
    let summary = e.subject;
    let status: RowStatus = null;
    if (e.kind === 'enquiry') {
      const c = inbox.market.cargoes.find((x) => x.id === e.cargoId)!;
      summary = `${formatClass(c.vesselClass)} · ${formatTonnes(c.quantityTonnes)} ${formatCommodity(c.commodity).toLowerCase()} · ${PORTS[c.loadPort].name} → ${PORTS[c.dischargePort].name}`;
      const s = enquiryStatus(day, e);
      status = s === 'fixed' ? 'FIXED' : s === 'lost' ? 'LOST' : null;
    } else if (e.kind === 'positionList') {
      summary = `${e.shipIds.length} ships open`;
    } else if (e.kind === 'brokerNote') {
      summary = 'Market colour';
    } else {
      summary = 'Small parcel needs a ship today';
      status = day.distractionHandled ? 'DONE' : day.clockHour + e.effortHours > (e.deadlineHour ?? DAY_END_HOUR) ? 'MISSED' : null;
    }
    const deadline = e.deadlineHour;
    const slack = deadline === null ? Infinity : deadline - e.effortHours - day.clockHour;
    return {
      id: e.id,
      group: action ? 'action' : 'reference',
      tag: TAGS[e.kind],
      from: e.from,
      summary,
      due: !action ? '' : deadline === null || deadline >= DAY_END_HOUR ? 'no rush' : clockLabel(deadline),
      dueSoon: action && status === null && slack >= 0 && slack < 1,
      stakes: e.effortHours > 0 ? `${hoursLabel(e.effortHours)} · ${roughUsd(e.approxCommissionUsd)}` : '',
      status,
    };
  });
  const deadlineOf = (id: string) => inbox.emails.find((e) => e.id === id)!.deadlineHour ?? DAY_END_HOUR;
  const action = rows.filter((r) => r.group === 'action').sort((a, b) => deadlineOf(a.id) - deadlineOf(b.id));
  const reference = rows.filter((r) => r.group === 'reference');
  return [...action, ...reference];
}
