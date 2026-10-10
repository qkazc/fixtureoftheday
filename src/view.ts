// Renders the day: the market board (ships against cargoes) on top, the deal
// desk (one card per cargo, with its negotiation) underneath. Everything is
// re-rendered after each action; typing in a rate box doesn't trigger a render.

import {
  isFinalRound,
  MAX_ROUNDS,
  PORTS,
  PROPOSALS_PER_DAY,
  type CargoOrder,
  type DailyMarket,
  type FixtureResult,
  type NegotiationRound,
  type ShipOffer,
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
  boardCell,
  budgetLeft,
  chooseShip,
  evaluate,
  initialSelections,
  isLocked,
  sendFirmOffer,
  sendProposal,
  voyageOutline,
  type BoardCell,
  type Selection,
  type Selections,
} from './state';

// Short definitions shown on hover. Fuller ones live in GLOSSARY.md.
const HINTS = {
  board: 'Market board: each cell is a quick voyage estimate for that ship carrying that cargo at the market rate.',
  ballast: 'Ballast leg: sailing empty from where the ship is free to the load port. The owner pays for it but earns nothing.',
  tce: 'TCE (Time Charter Equivalent): (freight − fuel, port costs and commissions) ÷ voyage days.',
  estTce: 'Estimated owner TCE if the cargo went at its market rate. Green beats the class market, amber is within 20% below, red is worse.',
  brokerage: 'Brokerage: your commission, 1.25% of the gross freight.',
  marketRate: 'The going freight rate for this cargo, in US dollars per tonne.',
  open: 'Open position: the port where the ship becomes free for its next job.',
  bunkers: 'Bunkers: ship fuel. Usually the biggest voyage cost.',
  owner: 'Shipowner satisfaction: 50 means they earn the market TCE for their class; ±20% takes it to 100 or 0.',
  charterer: 'Charterer satisfaction: 50 means they pay the market rate; 20% cheaper is 100, 20% dearer is 0.',
  score: 'Score: brokerage × (owner + charterer satisfaction) ÷ 100.',
  offer: 'Offer: the rate the owner is currently asking. Owners offer; charterers bid.',
  bid: 'Bid: the rate the charterer is currently willing to pay.',
  firm: 'Firm offer: take it or leave it. Closes the deal if both sides can live with the rate; if either can’t, the deal is dead.',
  budget: 'A broker’s day is limited: every proposal or firm offer, on any cargo, uses one.',
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
const whole = (n: number) => Math.round(n).toLocaleString('en-US');

function satisfactionBadge(value: number): HTMLElement {
  const level = value >= 50 ? 'good' : value >= 25 ? 'ok' : 'bad';
  return el('span', { class: `badge ${level}` }, String(Math.round(value)));
}

const STATUS_LABELS: Record<BoardCell['status'], string> = {
  free: '',
  talking: 'In talks',
  fixed: 'Fixed',
  failed: 'No deal',
  busy: '',
};

export function renderGame(root: HTMLElement, market: DailyMarket): void {
  let selections: Selections = initialSelections(market);
  const draftRates = new Map<string, string>();

  const board = el('div', { class: 'scroll' });
  const budget = el('p', { class: 'budget' });
  const desk = el('div', { class: 'desk' });
  const totals = el('p', { class: 'totals' });

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
    el('h2', {}, term('Market board', HINTS.board)),
    el('p', { class: 'hint' }, 'Pick a cell to open talks for that ship and cargo.'),
    board,
    el('h2', {}, 'Deal desk'),
    budget,
    desk,
    totals,
  );

  function act(next: Selections): void {
    selections = next;
    render();
  }

  function render(): void {
    board.replaceChildren(marketBoard());
    const left = budgetLeft(selections);
    budget.className = left === 0 ? 'budget empty' : 'budget';
    budget.replaceChildren(
      term('Proposals left today', HINTS.budget),
      ': ',
      el('strong', {}, `${left} of ${PROPOSALS_PER_DAY}`),
    );
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

  function marketBoard(): HTMLTableElement {
    const head = el(
      'tr',
      {},
      el('th', {}, 'Ship', el('br'), el('span', { class: 'sub' }, term('Open at', HINTS.open))),
      ...market.cargoes.map((c) =>
        el(
          'th',
          { scope: 'col' },
          `${c.id} · ${formatClass(c.vesselClass)}`,
          el('br'),
          el('span', { class: 'sub' }, `${formatTonnes(c.quantityTonnes)} ${formatCommodity(c.commodity).toLowerCase()}`),
          el('br'),
          el('span', { class: 'sub' }, `${portName(c.loadPort)} → ${portName(c.dischargePort)}`),
          el('br'),
          el('span', { class: 'sub' }, term('Market', HINTS.marketRate), ` ${formatRate(c.marketRateUsdPerTonne)}`),
        ),
      ),
    );
    const rows = market.ships.map((ship) =>
      el(
        'tr',
        {},
        el(
          'th',
          { scope: 'row' },
          ship.name,
          el('br'),
          el('span', { class: 'sub' }, `${formatClass(ship.vesselClass)} · ${portName(ship.openPort)}`),
        ),
        ...market.cargoes.map((c) => el('td', {}, boardButton(ship, c))),
      ),
    );
    return el('table', { class: 'board' }, el('thead', {}, head), el('tbody', {}, ...rows));
  }

  function boardButton(ship: ShipOffer, cargo: CargoOrder): HTMLElement {
    const cell = boardCell(market, selections, ship.id, cargo.id);
    if (!cell.fits) {
      return el('span', { class: 'cell nofit', title: `${ship.name} is the wrong size for ${cargo.id}` }, '—');
    }
    const level = cell.estTceRatio! >= 1 ? 'good' : cell.estTceRatio! >= 0.8 ? 'ok' : 'bad';
    const button = el(
      'button',
      {
        type: 'button',
        class: `cell ${level} ${cell.status}`,
        'aria-label': `${ship.name} for ${cargo.id}: ${formatNm(cell.ballastNm)} ballast, estimated ${formatUsdPerDay(cell.estTceUsdPerDay!)}`,
        title: HINTS.estTce,
      },
      el('span', {}, formatNm(cell.ballastNm)),
      el('span', { class: 'tce' }, formatUsdPerDay(cell.estTceUsdPerDay!)),
      el('span', { class: 'status' }, STATUS_LABELS[cell.status]),
    );
    const sel = selections[cargo.id]!;
    button.disabled = cell.status === 'busy' || isLocked(sel) || sel.negotiation?.status === 'failed';
    button.addEventListener('click', () => {
      // Clicking the cell in talks again releases the ship (before any proposal).
      const next = sel.shipId === ship.id ? null : ship.id;
      act(chooseShip(market, selections, cargo.id, next));
    });
    return button;
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

    const n = sel.negotiation;
    if (!sel.shipId || !n) {
      card.append(el('p', { class: 'hint' }, 'Pick a ship for this cargo on the market board.'));
      return card;
    }

    const ship = market.ships.find((s) => s.id === sel.shipId)!;
    const outline = voyageOutline(market, sel.shipId, c.id);
    card.append(
      el('p', {}, el('strong', {}, ship.name), `, open ${portName(ship.openPort)}`),
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
            ? 'Last call: your offer is firm. Each side takes it if they can live with it.'
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
      const outOfBudget = budgetLeft(selections) === 0;
      const final = isFinalRound(n);
      const proposeButton = el('button', { type: 'submit', value: 'propose' }, 'Send proposal');
      const firmButton = el('button', { type: 'submit', value: 'firm', title: HINTS.firm }, final ? 'Firm offer (last call)' : 'Firm offer');
      const form = el('form', { class: 'propose' }, input, ...(final ? [firmButton] : [proposeButton, firmButton]));
      for (const b of [input, proposeButton, firmButton]) b.disabled = outOfBudget;
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const rate = input.valueAsNumber;
        if (!Number.isFinite(rate) || rate <= 0) return;
        draftRates.delete(c.id);
        const firm = (ev.submitter as HTMLButtonElement | null)?.value === 'firm';
        act(firm ? sendFirmOffer(selections, c.id, rate) : sendProposal(selections, c.id, rate));
      });
      card.append(form);
      if (outOfBudget) card.append(el('p', { class: 'hint' }, 'No proposals left today.'));
    } else if (n.status === 'agreed') {
      card.append(el('p', { class: 'outcome good' }, `Fixed at ${formatRate(n.agreedRate!)} in round ${n.history.length}`));
    } else {
      const last = n.history.at(-1)!;
      const refusedBy = [!last.ownerAccepted && 'the owner', !last.chartererAccepted && 'the charterer']
        .filter(Boolean)
        .join(' and ');
      card.append(el('p', { class: 'outcome bad' }, `No deal: ${refusedBy} turned down your firm offer.`));
    }

    if (n.history.length > 0) card.append(historyList(n.history));
    if (result) card.append(resultList(result));
    return card;
  }

  render();
}

function historyList(history: readonly NegotiationRound[]): HTMLElement {
  const reply = (r: NegotiationRound, accepted: boolean, side: string, position: number) =>
    accepted ? `${side} accepts` : r.kind === 'firm' ? `${side} declines` : `${side} counters ${formatRate(position)}`;
  return el(
    'ol',
    { class: 'history' },
    ...history.map((r) =>
      el(
        'li',
        {},
        r.kind === 'firm' ? `Firm offer ${formatRate(r.proposedRate)}: ` : `You proposed ${formatRate(r.proposedRate)}: `,
        reply(r, r.ownerAccepted, 'owner', r.ownerOffer),
        ', ',
        reply(r, r.chartererAccepted, 'charterer', r.chartererBid),
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
