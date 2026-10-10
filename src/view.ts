// The broker's inbox: plain text and buttons. An inbox list, the open email
// with its actions, and the end-of-day summary once the day is over.
// All rules live in engine/day.ts; this file only shows state and calls it.

import {
  attemptFix,
  calendarDay,
  DISTRACTION_PAYOUT_USD,
  endDay,
  enquiryStatus,
  handleDistraction,
  hoursLeft,
  research,
  researchRows,
  startDay,
  summarizeDay,
  PORTS,
  type BlockReason,
  type DayState,
  type Email,
  type EnquiryEmail,
  type Inbox,
} from '../engine';
import { formatClass, formatNm, formatUsd, formatUsdPerDay } from './format';
import {
  blockMessage,
  cargoLabel,
  clockLabel,
  deadlineLabel,
  fixOutcomeMessage,
  fixtureReasonText,
  hoursLabel,
  roughUsd,
  skippedText,
} from './text';

type Attrs = Record<string, string>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function button(label: string, onClick: () => void, attrs: Attrs = {}): HTMLButtonElement {
  const b = el('button', { type: 'button', ...attrs }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function renderGame(root: HTMLElement, inbox: Inbox): void {
  let day: DayState = startDay();
  let openId: string | null = null;
  const read = new Set<string>();
  /** Last message shown under each email (the result of its last action). */
  const messages = new Map<string, string>();
  const shipChoice = new Map<string, string>();
  const rateChoice = new Map<string, string>();

  function apply(emailId: string, result: { ok: true; state: DayState } | { ok: false; reason: BlockReason }, okText: string): void {
    if (result.ok) {
      day = result.state;
      messages.set(emailId, okText);
    } else {
      messages.set(emailId, blockMessage(result.reason));
    }
    render();
  }

  function render(): void {
    root.replaceChildren(
      el('h1', {}, 'Fixture of the Day'),
      el(
        'p',
        {},
        `${calendarDay(inbox.date, 0)} ${inbox.date.slice(0, 4)} · ${clockLabel(day.clockHour)} · ${hoursLabel(hoursLeft(day))} left `,
        day.ended ? '' : button('End day', () => ((day = endDay(day)), render())),
      ),
      ...(day.ended ? [summaryView()] : [inboxList(), openId ? emailView(openId) : el('p', {}, 'Open an email to read it.')]),
    );
  }

  function statusOf(e: Email): string {
    if (e.kind === 'enquiry') {
      const s = enquiryStatus(day, e);
      return s === 'fixed' ? 'FIXED' : s === 'lost' ? 'LOST' : '';
    }
    if (e.kind === 'distraction') return day.distractionHandled ? 'DONE' : day.clockHour + e.effortHours > (e.deadlineHour ?? 17) ? 'MISSED' : '';
    return '';
  }

  function inboxList(): HTMLElement {
    return el(
      'section',
      { 'aria-label': 'Inbox' },
      el('h2', {}, 'Inbox'),
      el(
        'ul',
        {},
        ...inbox.emails.map((e) => {
          const meta = [
            deadlineLabel(e.deadlineHour),
            e.effortHours > 0 ? hoursLabel(e.effortHours) : 'read only',
            e.approxCommissionUsd > 0 ? roughUsd(e.approxCommissionUsd) : '',
            statusOf(e),
          ].filter(Boolean);
          const label = `${read.has(e.id) ? '' : '• '}${e.from}: ${e.subject} [${meta.join(' · ')}]`;
          return el('li', {}, button(label, () => ((openId = e.id), read.add(e.id), render()), { 'aria-current': String(openId === e.id) }));
        }),
      ),
    );
  }

  function emailView(id: string): HTMLElement {
    const e = inbox.emails.find((x) => x.id === id)!;
    const view = el(
      'section',
      { 'aria-label': 'Email' },
      el('h2', {}, e.subject),
      el('p', {}, `From: ${e.from}`),
      el(
        'p',
        {},
        `Deadline: ${deadlineLabel(e.deadlineHour)} · Effort: ${e.effortHours > 0 ? hoursLabel(e.effortHours) : 'none'}` +
          (e.approxCommissionUsd > 0 ? ` · Commission: ${roughUsd(e.approxCommissionUsd)}` : ''),
      ),
      el('pre', {}, e.body.join('\n')),
    );
    if (e.kind === 'positionList') {
      const fixed = new Set(day.fixtures.map((f) => f.shipId));
      const gone = e.shipIds.filter((s) => fixed.has(s)).map((s) => inbox.market.ships.find((x) => x.id === s)!.name);
      if (gone.length) view.append(el('p', {}, `Already fixed today: ${gone.join(', ')}.`));
    }
    if (e.kind === 'enquiry') view.append(...enquiryActions(e));
    if (e.kind === 'distraction' && !day.distractionHandled) {
      view.append(
        el(
          'p',
          {},
          button(`Handle it (${hoursLabel(e.effortHours)})`, () =>
            apply(e.id, handleDistraction(inbox, day, e.id), `Handled. ${formatUsd(e.payoutUsd)} commission.`),
          ),
        ),
      );
    }
    const msg = messages.get(id);
    if (msg) view.append(el('p', { role: 'status' }, msg));
    return view;
  }

  function enquiryActions(e: EnquiryEmail): HTMLElement[] {
    const cargo = inbox.market.cargoes.find((c) => c.id === e.cargoId)!;
    const status = enquiryStatus(day, e);
    if (status === 'fixed') {
      const f = day.fixtures.find((x) => x.emailId === e.id)!;
      const ship = inbox.market.ships.find((s) => s.id === f.shipId)!;
      return [el('p', {}, `Fixed: ${ship.name} at $${f.rateUsdPerTonne.toFixed(2)}/t.`)];
    }
    if (status === 'lost') return [el('p', {}, 'Lost: there is no longer time to fix this before its deadline.')];

    const out: HTMLElement[] = [];
    if (day.researched.includes(e.id)) {
      out.push(researchTable(e));
    } else {
      out.push(
        el(
          'p',
          {},
          button(`Research voyage estimates (${hoursLabel(0.5)})`, () => apply(e.id, research(inbox, day, e.id), 'Estimates ready.')),
        ),
      );
    }

    // Fix controls: a ship from the position lists, and a rate slider.
    const used = new Set(day.fixtures.map((f) => f.shipId));
    const ships = inbox.market.ships.filter((s) => !used.has(s.id));
    const select = el('select', { id: `ship-${e.id}`, 'aria-label': 'Ship' }, el('option', { value: '' }, 'Choose a ship'));
    for (const s of ships) {
      select.append(el('option', { value: s.id }, `${s.name} (${formatClass(s.vesselClass)}, open ${PORTS[s.openPort].name} ${calendarDay(inbox.date, s.openDay)})`));
    }
    select.value = shipChoice.get(e.id) ?? '';
    select.addEventListener('change', () => shipChoice.set(e.id, select.value));

    const idea = cargo.marketRateUsdPerTonne;
    const startRate = rateChoice.get(e.id) ?? idea.toFixed(2);
    const slider = el('input', {
      type: 'range',
      id: `rate-${e.id}`,
      'aria-label': 'Freight rate in dollars per tonne',
      // Ends on the $0.05 grid so every slider position is a quotable rate.
      min: (Math.round(idea * 0.7 * 20) / 20).toFixed(2),
      max: (Math.round(idea * 1.3 * 20) / 20).toFixed(2),
      step: '0.05',
      value: startRate,
    });
    const shown = el('output', { for: `rate-${e.id}` }, `$${Number(startRate).toFixed(2)}/t`);
    slider.addEventListener('input', () => {
      rateChoice.set(e.id, slider.value);
      shown.textContent = `$${Number(slider.value).toFixed(2)}/t`;
    });

    const fix = button(`Fix (${hoursLabel(e.effortHours)})`, () => {
      const shipId = select.value;
      if (!shipId) {
        messages.set(e.id, 'Choose a ship first.');
        render();
        return;
      }
      const rate = Number(slider.value);
      const r = attemptFix(inbox, day, e.id, shipId, rate);
      apply(e.id, r, r.ok ? fixOutcomeMessage(r.outcome, rate) : '');
    });

    out.push(
      el('p', {}, `Rate idea: $${idea.toFixed(2)}/t · ${cargoLabel(cargo)}`),
      el('p', {}, el('label', { for: `ship-${e.id}` }, 'Ship: '), select),
      el('p', {}, el('label', { for: `rate-${e.id}` }, 'Rate: '), slider, ' ', shown),
      el('p', {}, fix),
    );
    return out;
  }

  function researchTable(e: EnquiryEmail): HTMLElement {
    const cargo = inbox.market.cargoes.find((c) => c.id === e.cargoId)!;
    const rows = researchRows(inbox, day, e.id);
    const laycan = `${calendarDay(inbox.date, cargo.laycanStartDay)} to ${calendarDay(inbox.date, cargo.laycanEndDay)}`;
    return el(
      'div',
      {},
      el('p', {}, `Voyage estimates at the rate idea (laycan ${laycan}):`),
      el(
        'table',
        {},
        el('thead', {}, el('tr', {}, ...['Ship', 'Size', 'Ballast', 'Arrives', 'Owner TCE', 'Fits?'].map((h) => el('th', {}, h)))),
        el(
          'tbody',
          {},
          ...rows.map((r) =>
            el(
              'tr',
              {},
              el('td', {}, r.ship.name),
              el('td', {}, `${formatClass(r.ship.vesselClass)}`),
              el('td', {}, formatNm(r.ballastNm)),
              el('td', {}, calendarDay(inbox.date, Math.ceil(r.arrivalDay))),
              el('td', {}, r.estTceUsdPerDay === null ? '–' : formatUsdPerDay(r.estTceUsdPerDay)),
              el('td', {}, r.fits ? 'yes' : r.problem === 'wrongSize' ? 'wrong size' : 'misses laycan'),
            ),
          ),
        ),
      ),
    );
  }

  function summaryView(): HTMLElement {
    const s = summarizeDay(inbox, day);
    const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v)}/100`);
    const shipName = (id: string) => inbox.market.ships.find((x) => x.id === id)!.name;
    const cargoOf = (cargoId: string) => inbox.market.cargoes.find((c) => c.id === cargoId)!;
    const skippedEmails = s.skippedEnquiries.length + (s.distractionSkipped ? 1 : 0);
    return el(
      'section',
      { 'aria-label': 'End of day' },
      el('h2', {}, 'End of day'),
      el(
        'ul',
        {},
        el('li', {}, `Fixtures made: ${s.fixtures.length}`),
        el('li', {}, `Commission earned: ${formatUsd(s.totalCommissionUsd)}`),
        el('li', {}, `Owner satisfaction: ${pct(s.avgOwnerSatisfaction)} · Charterer satisfaction: ${pct(s.avgChartererSatisfaction)}`),
        el('li', {}, `Score: ${Math.round(s.totalScore).toLocaleString('en-US')}`),
        el('li', {}, `Emails skipped: ${skippedEmails}`),
      ),
      el('h3', {}, 'Fixtures'),
      s.fixtures.length === 0
        ? el('p', {}, 'None today.')
        : el(
            'ul',
            {},
            ...s.fixtures.map((f) =>
              el(
                'li',
                {},
                `${cargoLabel(cargoOf(f.fixture.cargoId))} with ${shipName(f.fixture.shipId)} at $${f.fixture.rateUsdPerTonne.toFixed(2)}/t: ` +
                  `${formatUsd(f.result.brokerageUsd)} commission, owner ${Math.round(f.result.ownerSatisfaction)}, charterer ${Math.round(f.result.chartererSatisfaction)}. ` +
                  fixtureReasonText(f),
              ),
            ),
          ),
      el('h3', {}, 'Skipped'),
      s.skippedEnquiries.length === 0 && !s.distractionSkipped
        ? el('p', {}, 'Nothing.')
        : el(
            'ul',
            {},
            ...s.skippedEnquiries.map((x) => el('li', {}, `${cargoLabel(cargoOf(x.email.cargoId))}: ${skippedText(x)}`)),
            ...(s.distractionSkipped ? [el('li', {}, `The urgent small parcel: worth only about ${formatUsd(DISTRACTION_PAYOUT_USD)}, so skipping it was cheap.`)] : []),
          ),
    );
  }

  render();
}
