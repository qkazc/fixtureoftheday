// The broker's inbox: plain text and buttons. An inbox list, the open email
// with its actions, and the end-of-day summary once the day is over.
// All rules live in engine/day.ts; this file only shows state and calls it.

import {
  calendarDay,
  DISTRACTION_PAYOUT_USD,
  enquiryStatus,
  generateBriefing,
  quoteRange,
  hoursLeft,
  startDay,
  summarizeDay,
  PORTS,
  type DayState,
  type EnquiryEmail,
  type FixOutcome,
  type Inbox,
} from '../engine';
import { compactUsd, formatClass, formatCommodity, formatNm, formatUsd } from './format';
import { matchRows, type BoardCell } from './board';
import { inboxRows } from './inboxRows';
import { drawMap } from './mapView';
import {
  applyAction,
  browserStorage,
  loadDay,
  saveDay,
  type ActionOutcome,
  type SavedAction,
  type StorageLike,
} from './save';
import { shareText } from './share';
import {
  blockMessage,
  cargoLabel,
  clockLabel,
  deadlineLabel,
  endOfDayText,
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

/** A titled pane on the broker's desk. `area` places it in the screen's grid. */
function pane(title: string, area: string, ...content: (Node | string)[]): HTMLElement {
  return el(
    'section',
    { class: `pane area-${area}`, 'aria-label': title },
    el('header', { class: 'pane-title' }, title),
    el('div', { class: 'pane-body' }, ...content),
  );
}

export function renderGame(root: HTMLElement, inbox: Inbox, store: StorageLike | null = browserStorage()): void {
  // Pick up where the player left off today, if this browser saved the day.
  const saved = loadDay(store, inbox);
  let day: DayState = saved?.day ?? startDay();
  /** The morning brief comes first; the inbox opens when the day starts. */
  let started = saved?.started ?? false;
  let openId: string | null = null;
  const read = new Set<string>(saved?.read ?? []);
  /** Every action taken today, in order: what gets saved and replayed. */
  const actions: SavedAction[] = [...(saved?.actions ?? [])];
  /** Last message shown under each email (the result of its last action). */
  const messages = new Map<string, string>();
  const shipChoice = new Map<string, string>();
  /** Which view the day's market board shows. */
  let boardTab: 'positions' | 'index' = 'positions';
  const rateChoice = new Map<string, string>();

  /** Runs an action through the engine, records it for saving, and shows its message. */
  function perform(emailId: string | null, action: SavedAction, okText: (outcome: ActionOutcome) => string): void {
    const r = applyAction(inbox, day, action);
    if (r.ok) {
      day = r.state;
      actions.push(action);
      if (emailId) messages.set(emailId, okText(r.outcome));
    } else if (emailId) {
      messages.set(emailId, blockMessage(r.reason));
    }
    render();
  }

  function render(): void {
    saveDay(store, { date: inbox.date, started, read: [...read], actions });
    const screen = !started ? 'brief' : day.ended ? 'summary' : 'day';
    const panes =
      screen === 'brief'
        ? [
            pane('Overnight news', 'news', newsList()),
            pane('Map', 'map', mapView()),
            pane('Market board · freight index', 'board', rateIndex()),
          ]
        : screen === 'summary'
          ? [pane('End of day', 'summary', summaryView())]
          : [
              pane('Map', 'map', mapView()),
              pane('Inbox', 'inbox', inboxList()),
              pane('Market board', 'board', dayBoard()),
              pane('Email', 'email', openId ? emailView(openId) : el('p', { class: 'muted' }, 'Open an email to read it.')),
            ];
    root.replaceChildren(topBar(screen), el('main', { class: `desk desk-${screen}` }, ...panes));
  }

  function topBar(screen: 'brief' | 'day' | 'summary'): HTMLElement {
    const date = `${calendarDay(inbox.date, 0)} ${inbox.date.slice(0, 4)}`;
    const status =
      screen === 'brief'
        ? 'Morning brief · before 09:00'
        : screen === 'day'
          ? `${clockLabel(day.clockHour)} · ${hoursLabel(hoursLeft(day))} left`
          : `Day over · ${clockLabel(day.clockHour)}`;
    const action =
      screen === 'brief'
        ? button('Start the day (09:00)', () => ((started = true), render()), { class: 'primary' })
        : screen === 'day'
          ? button('End day', () => perform(null, { kind: 'endDay' }, () => ''))
          : '';
    return el(
      'header',
      { class: 'topbar' },
      el('span', { class: 'brand' }, 'FIXTURE OF THE DAY'),
      el('span', {}, date),
      el('span', { class: 'clock' }, status),
      action,
    );
  }

  function mapView(): HTMLElement {
    const open = openId ? inbox.emails.find((e) => e.id === openId) : undefined;
    const cargo =
      started && open?.kind === 'enquiry' ? inbox.market.cargoes.find((c) => c.id === open.cargoId)! : null;
    const legend = cargo
      ? el(
          'p',
          { class: 'legend' },
          el('span', { class: 'key voyage' }, '━ voyage'),
          el('span', { class: 'key ballast' }, '┅ ballast, can make laycan'),
          el('span', { class: 'key late' }, '┅ too late for laycan'),
        )
      : el('p', { class: 'legend muted' }, started ? 'Open an enquiry to see its voyage and the ships that could take it.' : '▲ ship · open date');
    return el('div', {}, drawMap(inbox, { cargo, fixedShipIds: new Set(day.fixtures.map((f) => f.shipId)) }), legend);
  }

  function dayBoard(): HTMLElement {
    const tab = (id: typeof boardTab, label: string) =>
      button(label, () => ((boardTab = id), render()), { class: boardTab === id ? 'tab active' : 'tab', 'aria-pressed': String(boardTab === id) });
    return el(
      'div',
      {},
      el('p', { class: 'tabs' }, tab('positions', 'Matches'), tab('index', 'Freight index')),
      boardTab === 'index' ? rateIndex() : positionsBoard(),
    );
  }

  function positionsBoard(): HTMLElement {
    const rows = matchRows(inbox, day);
    return el(
      'div',
      {},
      el(
        'ul',
        { class: 'matches' },
        ...rows.map((row) => {
          const closed = row.status !== 'open';
          return el(
            'li',
            { class: `match${openId === row.email.id ? ' focus' : ''}${closed ? ' closed' : ''}` },
            el(
              'div',
              { class: 'match-head' },
              el('span', { class: 'what' }, `${formatClass(row.cargo.vesselClass)} ${formatCommodity(row.cargo.commodity).toLowerCase()} · ${PORTS[row.cargo.loadPort].name} → ${PORTS[row.cargo.dischargePort].name}`),
              el(
                'span',
                { class: 'when' },
                closed
                  ? el('span', { class: `chip chip-${row.status}` }, row.status.toUpperCase())
                  : `due ${deadlineLabel(row.email.deadlineHour).replace('answer by ', '')}${row.researched ? '' : ' · not researched'}`,
              ),
            ),
            el('div', { class: 'chips' }, ...row.candidates.map((c) => shipChip(row.email, c.ship.id, c.cell))),
          );
        }),
      ),
      el('p', { class: 'legend muted' }, 'Ships of the right size, nearest first. Research an enquiry to see each owner’s estimated daily earnings: green beats the market, amber is within 20%, red is worse. Pick a ship to work that deal.'),
    );
  }

  function shipChip(e: EnquiryEmail, shipId: string, cell: BoardCell): HTMLElement {
    const ship = inbox.market.ships.find((s) => s.id === shipId)!;
    const level = cell.estTceRatio === null ? '' : cell.estTceRatio >= 1 ? 'good' : cell.estTceRatio >= 0.8 ? 'ok' : 'bad';
    const parts: (Node | string)[] = [el('span', { class: 'name' }, ship.name), el('span', { class: 'nm' }, formatNm(cell.ballastNm))];
    if (cell.estTceUsdPerDay !== null) parts.push(el('span', { class: `tce ${level}` }, `${compactUsd(cell.estTceUsdPerDay)}/d`));
    if (cell.fit === 'missesLaycan') parts.push(el('span', { class: 'late' }, 'too late'));
    if (cell.state === 'fixedHere') parts.push(el('span', { class: 'fixed' }, 'FIXED'));
    if (cell.state === 'shipTaken') parts.push(el('span', { class: 'muted' }, 'taken'));
    const b = button('', () => {
      openId = e.id;
      read.add(e.id);
      shipChoice.set(e.id, shipId);
      render();
    }, {
      class: `ship-chip ${level} ${cell.state}${openId === e.id && shipChoice.get(e.id) === shipId ? ' chosen' : ''}`,
      'aria-label': `${ship.name} for ${e.subject}`,
    });
    b.replaceChildren(...parts);
    b.disabled = cell.state !== 'open';
    return b;
  }

  function newsList(): HTMLElement {
    return el('ul', { class: 'news' }, ...generateBriefing(inbox).news.map((n) => el('li', {}, n.text)));
  }

  function rateIndex(): HTMLElement {
    const b = generateBriefing(inbox);
    const signed = (n: number) => (n === 0 ? '0.00' : `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`);
    return el(
      'div',
      {},
      el(
        'table',
        {},
        el('thead', {}, el('tr', {}, ...['Route', 'Cargo', 'Size', '$/t', 'Chg'].map((h) => el('th', {}, h)))),
        el(
          'tbody',
          {},
          ...b.routeRates.map((r) =>
            el(
              'tr',
              {},
              el('td', {}, `${PORTS[r.trade.loadPort].name} to ${PORTS[r.trade.dischargePort].name}`),
              el('td', {}, formatCommodity(r.trade.commodity)),
              el('td', {}, formatClass(r.trade.vesselClass)),
              el('td', { class: 'num' }, `$${r.rateUsdPerTonne.toFixed(2)}`),
              el('td', { class: `num ${r.changeUsdPerTonne > 0 ? 'up' : r.changeUsdPerTonne < 0 ? 'down' : ''}` }, signed(r.changeUsdPerTonne)),
            ),
          ),
        ),
      ),
    );
  }

  function inboxList(): HTMLElement {
    const rows = inboxRows(inbox, day);
    const group = (title: string, which: 'action' | 'reference') =>
      el(
        'div',
        { class: 'mail-group' },
        el('h3', {}, title),
        el(
          'ul',
          { class: 'inbox' },
          ...rows
            .filter((r) => r.group === which)
            .map((r) => {
              const b = button('', () => ((openId = r.id), read.add(r.id), render()), {
                'aria-current': String(openId === r.id),
                class: `mail${read.has(r.id) ? '' : ' unread'}${r.status ? ' done' : ''}`,
              });
              b.replaceChildren(
                el('span', { class: `tag tag-${r.tag.toLowerCase()}` }, r.tag),
                el('span', { class: 'from' }, r.from),
                el('span', { class: `due${r.dueSoon ? ' soon' : ''}` }, r.due),
                el('span', { class: 'summary' }, r.summary),
                el(
                  'span',
                  { class: 'stakes' },
                  r.status ? el('span', { class: `chip chip-${r.status.toLowerCase()}` }, r.status) : r.stakes,
                ),
              );
              return el('li', {}, b);
            }),
        ),
      );
    return el('div', {}, group('Needs action', 'action'), group('For reference', 'reference'));
  }

  function emailView(id: string): HTMLElement {
    const e = inbox.emails.find((x) => x.id === id)!;
    const view = el(
      'div',
      { class: 'email' },
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
            perform(e.id, { kind: 'distraction', emailId: e.id }, () => `Handled. ${formatUsd(e.payoutUsd)} commission.`),
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
      out.push(el('p', { class: 'muted' }, 'Researched: voyage estimates are on the market board.'));
    } else {
      out.push(
        el(
          'p',
          {},
          button(`Research voyage estimates (${hoursLabel(0.5)})`, () => perform(e.id, { kind: 'research', emailId: e.id }, () => 'Estimates ready.')),
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
      min: quoteRange(idea).min.toFixed(2),
      max: quoteRange(idea).max.toFixed(2),
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
      perform(e.id, { kind: 'fix', emailId: e.id, shipId, rateUsdPerTonne: rate }, (o) => fixOutcomeMessage(o as FixOutcome, rate));
    });

    out.push(
      el('p', {}, `Rate idea: $${idea.toFixed(2)}/t · ${cargoLabel(cargo)}`),
      el('p', {}, el('label', { for: `ship-${e.id}` }, 'Ship: '), select),
      el('p', {}, el('label', { for: `rate-${e.id}` }, 'Rate: '), slider, ' ', shown),
      el('p', {}, fix),
    );
    return out;
  }

  /** The spoiler-free result, with a button to copy it for sharing. */
  function shareBox(summary: ReturnType<typeof summarizeDay>): HTMLElement {
    const text = shareText(inbox, summary);
    const pre = el('pre', { class: 'share', id: 'share-text' }, text);
    const status = el('span', { class: 'muted', role: 'status' });
    const selectText = () => {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    const fallback = () => {
      selectText();
      status.textContent = 'Couldn’t copy automatically: the text is selected, so copy it yourself.';
    };
    const copy = button('Copy result', () => {
      // Use the clipboard inside the click; if it's missing or refused, select the text instead.
      if (!navigator.clipboard) return fallback();
      navigator.clipboard.writeText(text).then(() => (status.textContent = 'Copied. Paste it anywhere to share.'), fallback);
    }, { class: 'primary' });
    return el(
      'div',
      { class: 'share-box' },
      el('h3', {}, 'Your result'),
      pre,
      el('p', {}, copy, ' ', status),
      el('p', { class: 'muted' }, 'One attempt per day: come back tomorrow for a new market.'),
    );
  }

  function summaryView(): HTMLElement {
    const s = summarizeDay(inbox, day);
    const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v)}/100`);
    const shipName = (id: string) => inbox.market.ships.find((x) => x.id === id)!.name;
    const cargoOf = (cargoId: string) => inbox.market.cargoes.find((c) => c.id === cargoId)!;
    const skippedEmails = s.skippedEnquiries.length + (s.distractionSkipped ? 1 : 0);
    return el(
      'div',
      {},
      shareBox(s),
      ...endOfDayText(s, cargoOf).map((line) => el('p', {}, line)),
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
