// Renders the day's market and the fixture builder. The static parts are
// built once; on each change only the dropdowns, results and totals update,
// so typing in a rate box never loses focus.

import { distanceNm, PORTS, type DailyMarket, type FixtureResult } from '../engine';
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
import { availableShips, evaluate, initialSelections, type Selections } from './state';

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
  score: 'Score: brokerage × (owner + charterer satisfaction) ÷ 100. A refused fixture scores nothing.',
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
  const selections: Selections = initialSelections(market);

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

  // Fixture builder: one row per cargo.
  const selects = new Map<string, HTMLSelectElement>();
  const resultCells = new Map<string, HTMLTableCellElement[]>();
  const rows = market.cargoes.map((c) => {
    const select = el('select', { 'aria-label': `Ship for ${c.id}` });
    select.addEventListener('change', () => {
      selections[c.id]!.shipId = select.value || null;
      update();
    });
    selects.set(c.id, select);

    const rate = el('input', {
      type: 'number',
      min: '0',
      step: '0.05',
      value: c.marketRateUsdPerTonne.toFixed(2),
      'aria-label': `Rate for ${c.id} in dollars per tonne`,
    });
    rate.addEventListener('input', () => {
      selections[c.id]!.rateUsdPerTonne = rate.valueAsNumber;
      update();
    });

    const cells = Array.from({ length: 7 }, () => el('td', { class: 'num' }));
    resultCells.set(c.id, cells);
    return el('tr', {}, el('td', {}, c.id), el('td', {}, select), el('td', {}, rate), ...cells);
  });

  const totalBrokerage = el('strong');
  const totalScore = el('strong');
  root.append(
    el('h2', {}, 'Your fixtures'),
    el(
      'div',
      { class: 'scroll' },
      el(
        'table',
        { class: 'fixtures' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            ...['Cargo', 'Ship', 'Rate $/t', term('Ballast', HINTS.ballast), 'Days',
              term('Owner TCE', HINTS.tce), term('Owner', HINTS.owner),
              term('Charterer', HINTS.charterer), term('Brokerage', HINTS.brokerage),
              term('Score', HINTS.score)].map((h) => el('th', {}, h)),
          ),
        ),
        el('tbody', {}, ...rows),
      ),
    ),
    el(
      'p',
      { class: 'totals' },
      'Total brokerage ',
      totalBrokerage,
      ' · Day score ',
      totalScore,
    ),
  );

  function update(): void {
    // Refresh each dropdown so a ship can't be chosen for two cargoes.
    for (const c of market.cargoes) {
      const select = selects.get(c.id)!;
      const chosen = selections[c.id]!.shipId;
      select.replaceChildren(
        el('option', { value: '' }, '— no ship —'),
        ...availableShips(market, selections, c.id).map((s) =>
          el('option', { value: s.id }, `${s.name} (open ${portName(s.openPort)})`),
        ),
      );
      select.value = chosen ?? '';
    }

    const e = evaluate(market, selections);
    for (const c of market.cargoes) {
      fillResult(market, resultCells.get(c.id)!, e.byCargo[c.id] ?? null);
    }
    totalBrokerage.textContent = formatUsd(e.totalBrokerageUsd);
    totalScore.textContent = whole(e.totalScore);
  }

  update();
}

const whole = (n: number) => Math.round(n).toLocaleString('en-US');

function refusal(status: 'refusedByOwner' | 'refusedByCharterer'): HTMLElement {
  return status === 'refusedByOwner'
    ? el('span', { class: 'refused', title: 'The owner would earn too little on this voyage.' }, 'Owner refuses')
    : el('span', { class: 'refused', title: 'The charterer won’t pay this much.' }, 'Charterer refuses');
}

function fillResult(market: DailyMarket, cells: HTMLTableCellElement[], r: FixtureResult | null): void {
  if (!r) {
    for (const cell of cells) cell.replaceChildren('–');
    return;
  }
  const v = r.voyage;
  const ship = market.ships.find((s) => s.id === r.fixture.shipId)!;
  const cargo = market.cargoes.find((c) => c.id === r.fixture.cargoId)!;
  const values: (Node | string)[] = [
    formatNm(distanceNm(ship.openPort, cargo.loadPort)),
    formatDays(v.totalDays),
    formatUsdPerDay(v.tceUsdPerDay),
    satisfactionBadge(r.ownerSatisfaction),
    satisfactionBadge(r.chartererSatisfaction),
    formatUsd(r.brokerageUsd),
    r.status === 'fixed' ? whole(r.score) : refusal(r.status),
  ];
  cells.forEach((cell, i) => cell.replaceChildren(values[i]!));
}
