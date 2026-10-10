// Renders the day's market and the fixture builder. The static parts are
// built once; on each change only the dropdowns, results and totals update,
// so typing in a rate box never loses focus.

import {
  distanceNm,
  isFinalRound,
  MAX_ROUNDS,
  PORTS,
  type CargoOrder,
  type DailyMarket,
  type FixtureResult,
  type NegotiationRound,
} from '../engine';
import {
  formatClass,
  formatCommodity,
  formatDays,
  formatNm,
  formatRate,
  formatTonnes,
  formatUsd,
  formatUsdPerDay,
} from './format';
import {
  availableShips,
  chooseShip,
  evaluate,
  initialSelections,
  isLocked,
  sendProposal,
  voyageOutline,
  type Selection,
  type Selections,
} from './state';

// Short definitions shown on hover. Fuller ones live in GLOSSARY.md.
const HINTS = {
  ballast: 'Ballast leg: sailing empty from where the ship is free to the load port. The owner pays for it but earns nothing.',
  tce: 'TCE (Time Charter Equivalent): (freight − fuel, port costs and commissions) ÷ voyage days.',
  brokerage: 'Brokerage: your commission, 1.25% of the gross freight.',
  marketRate: 'The going freight rate for this cargo, in US dollars per tonne.',
  open: 'Open position: the port where the ship becomes free for its next job.',
  bunkers: 'Bunkers: ship fuel. Usually the biggest voyage cost.',
  owner: 'Shipowner satisfaction: 50 means they earn the market TCE for their class; ±20% takes it to 100 or 0.',
  charterer: 'Charterer satisfaction: 50 means they pay the market rate; 20% cheaper is 100, 20% dearer is 0.',
  score: 'Score: brokerage × (owner + charterer satisfaction) ÷ 100.',
  offer: 'Offer: the rate the owner is currently asking. Owners offer; charterers bid.',
  bid: 'Bid: the rate the charterer is currently willing to pay.',
} as const;

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

const term = (label: string, hint: string) => el('abbr', { title: hint }, label);
const portName = (id: keyof typeof PORTS) => PORTS[id].name;

/** A simple table, wrapped so it scrolls sideways on narrow screens. */
function table(headers: (Node | string)[], rows: (Node | string)[][]): HTMLElement {
  return el(
    'div',
    { class: 'scroll' },
    el(
      'table',
      {},
      el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, c))))),
    ),
  );
}

function satisfactionBadge(value: number): HTMLElement {
  const level = value >= 50 ? 'good' : value >= 25 ? 'ok' : 'bad';
  return el('span', { class: `badge ${level}` }, String(Math.round(value)));
}

export function renderGame(root: HTMLElement, market: DailyMarket): void {
  root.replaceChildren(
    el(
      'header',
      {},
      el('h1', {}, 'Fixture of the Day'),
      el(
        'p',
        { class: 'meta' },
        `${market.date} · `,
        term('Bunkers', HINTS.bunkers),
        ` ${formatUsd(market.bunkerPriceUsdPerTonne)}/t`,
      ),
    ),
  );

  root.append(
    el('h2', {}, 'Cargoes'),
    table(
      ['ID', 'Cargo', 'Route', 'Needs', term('Market rate', HINTS.marketRate)],
      market.cargoes.map((c) => [
        c.id,
        `${formatTonnes(c.quantityTonnes)} ${formatCommodity(c.commodity).toLowerCase()}`,
        `${portName(c.loadPort)} → ${portName(c.dischargePort)}`,
        formatClass(c.vesselClass),
        formatRate(c.marketRateUsdPerTonne),
      ]),
    ),
    el('h2', {}, 'Ships'),
    table(
      ['ID', 'Name', 'Class', term('Open at', HINTS.open)],
      market.ships.map((s) => [s.id, s.name, formatClass(s.vesselClass), portName(s.openPort)]),
    ),
  );

  // Deal desk: one card per cargo with the ship choice and the negotiation.
  let selections: Selections = initialSelections(market);
  const draftRates = new Map<string, string>();
  const desk = el('div', { class: 'desk' });
  const totals = el('p', { class: 'totals' });
  root.append(el('h2', {}, 'Deal desk'), desk, totals);

  function act(next: Selections): void {
    selections = next;
    render();
  }

  function render(): void {
    const e = evaluate(market, selections);
    desk.replaceChildren(
      ...market.cargoes.map((c) => dealCard(c, selections[c.id]!, e.byCargo[c.id] ?? null)),
    );
    totals.replaceChildren(
      'Total brokerage ',
      el('strong', {}, formatUsd(e.totalBrokerageUsd)),
      ' · Day score ',
      el('strong', {}, whole(e.totalScore)),
    );
  }

  function dealCard(c: CargoOrder, sel: Selection, result: FixtureResult | null): HTMLElement {
    const card = el(
      'section',
      { class: 'card', 'aria-label': `Cargo ${c.id}` },
      el('h3', {}, `${c.id} · ${formatTonnes(c.quantityTonnes)} ${formatCommodity(c.commodity).toLowerCase()}`),
      el(
        'p',
        { class: 'meta' },
        `${portName(c.loadPort)} → ${portName(c.dischargePort)} · ${formatClass(c.vesselClass)} · market ${formatRate(c.marketRateUsdPerTonne)}`,
      ),
    );

    // Ship choice, with each ship's empty-sail distance to the load port.
    const select = el('select', { id: `ship-${c.id}`, 'aria-label': `Ship for ${c.id}` });
    select.append(
      el('option', { value: '' }, '— choose a ship —'),
      ...availableShips(market, selections, c.id).map((s) =>
        el('option', { value: s.id }, `${s.name}, open ${portName(s.openPort)}, ${formatNm(distanceNm(s.openPort, c.loadPort))} away`),
      ),
    );
    select.value = sel.shipId ?? '';
    select.disabled = isLocked(sel);
    select.addEventListener('change', () => act(chooseShip(market, selections, c.id, select.value || null)));
    card.append(select);

    const n = sel.negotiation;
    if (!sel.shipId || !n) {
      card.append(el('p', { class: 'hint' }, 'Choose a ship to open talks with its owner and the charterer.'));
      return card;
    }

    const outline = voyageOutline(market, sel.shipId, c.id);
    card.append(
      el('p', { class: 'meta' }, term('Ballast', HINTS.ballast), ` ${formatNm(outline.ballastNm)} · about ${formatDays(outline.days)}`),
    );

    if (n.status === 'open') {
      card.append(
        el(
          'p',
          { class: 'positions' },
          term('Owners offer', HINTS.offer), ' ', el('strong', {}, formatRate(n.ownerOffer)),
          ' · ',
          term('Charterers bid', HINTS.bid), ' ', el('strong', {}, formatRate(n.chartererBid)),
        ),
        el(
          'p',
          { class: isFinalRound(n) ? 'round last' : 'round' },
          isFinalRound(n)
            ? 'Last call: each side will take any rate it can live with.'
            : `Round ${n.history.length + 1} of ${MAX_ROUNDS}`,
        ),
      );
      const input = el('input', {
        id: `rate-${c.id}`,
        type: 'number',
        min: '0',
        step: '0.05',
        'aria-label': `Proposed rate for ${c.id} in dollars per tonne`,
      });
      input.value = draftRates.get(c.id) ?? ((n.ownerOffer + n.chartererBid) / 2).toFixed(2);
      input.addEventListener('input', () => draftRates.set(c.id, input.value));
      const send = el('button', { type: 'submit' }, 'Send proposal');
      const form = el('form', { class: 'propose' }, input, send);
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const rate = input.valueAsNumber;
        if (!Number.isFinite(rate) || rate <= 0) return;
        draftRates.delete(c.id);
        act(sendProposal(selections, c.id, rate));
      });
      card.append(form);
    } else if (n.status === 'agreed') {
      card.append(el('p', { class: 'outcome good' }, `Fixed at ${formatRate(n.agreedRate!)} in round ${n.history.length}`));
    } else {
      card.append(el('p', { class: 'outcome bad' }, `No deal: talks ended after ${MAX_ROUNDS} rounds.`));
    }

    if (n.history.length > 0) card.append(historyList(n.history));
    if (result) card.append(resultList(result));
    return card;
  }

  render();
}

const whole = (n: number) => Math.round(n).toLocaleString('en-US');

function historyList(history: readonly NegotiationRound[]): HTMLElement {
  const reply = (accepted: boolean, side: string, position: number) =>
    accepted ? `${side} accepts` : `${side} counters ${formatRate(position)}`;
  return el(
    'ol',
    { class: 'history' },
    ...history.map((r) =>
      el(
        'li',
        {},
        `You proposed ${formatRate(r.proposedRate)}: `,
        reply(r.ownerAccepted, 'owner', r.ownerOffer),
        ', ',
        reply(r.chartererAccepted, 'charterer', r.chartererBid),
      ),
    ),
  );
}

function resultList(r: FixtureResult): HTMLElement {
  const row = (label: Node | string, value: Node | string) => [el('dt', {}, label), el('dd', {}, value)];
  return el(
    'dl',
    { class: 'results' },
    ...row(term('Owner TCE', HINTS.tce), formatUsdPerDay(r.voyage.tceUsdPerDay)),
    ...row(term('Owner', HINTS.owner), satisfactionBadge(r.ownerSatisfaction)),
    ...row(term('Charterer', HINTS.charterer), satisfactionBadge(r.chartererSatisfaction)),
    ...row(term('Brokerage', HINTS.brokerage), formatUsd(r.brokerageUsd)),
    ...row(term('Score', HINTS.score), whole(r.score)),
  );
}
