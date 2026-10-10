import { describe, expect, it } from 'vitest';
import { generateMarket, MAX_ROUNDS, PROPOSALS_PER_DAY, type Negotiation } from '../engine';
import {
  availableShips,
  boardCell,
  budgetLeft,
  chooseShip,
  evaluate,
  initialSelections,
  isLocked,
  sendFirmOffer,
  sendProposal,
  toFixtures,
  voyageOutline,
} from './state';

/**
 * Finds a day with what these tests need: a cargo with a ship already at its
 * load port, a second ship of the same class elsewhere, and a second cargo
 * of that class. Searching keeps the tests independent of any one day.
 */
function findDay() {
  for (let i = 0; i < 365; i++) {
    const market = generateMarket(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    for (const cargo of market.cargoes) {
      const atPort = market.ships.find((s) => s.vesselClass === cargo.vesselClass && s.openPort === cargo.loadPort);
      const other = market.ships.find((s) => s.vesselClass === cargo.vesselClass && s.openPort !== cargo.loadPort);
      const otherCargo = market.cargoes.find((c) => c !== cargo && c.vesselClass === cargo.vesselClass);
      if (atPort && other && otherCargo) {
        return { market, CARGO: cargo.id, AT_PORT: atPort.id, OTHER: other.id, OTHER_CARGO: otherCargo.id };
      }
    }
  }
  throw new Error('no suitable day found');
}

const { market, CARGO, AT_PORT, OTHER, OTHER_CARGO } = findDay();
const cargoClass = market.cargoes.find((c) => c.id === CARGO)!.vesselClass;

/** Plays the last call at a rate inside both hidden limits, so the deal closes. */
function closeDeal(selections: ReturnType<typeof initialSelections>, cargoId: string) {
  let s = selections;
  for (let i = 0; i < MAX_ROUNDS - 1; i++) s = sendProposal(s, cargoId, 0.05);
  const n = s[cargoId]!.negotiation as Negotiation;
  return sendProposal(s, cargoId, (n.limits.ownerFloorRate + n.limits.chartererCeilingRate) / 2);
}

/** Lowballs until the talks fail. */
function failDeal(selections: ReturnType<typeof initialSelections>, cargoId: string) {
  let s = selections;
  for (let i = 0; i < MAX_ROUNDS; i++) s = sendProposal(s, cargoId, 0.05);
  return s;
}

describe('choosing ships', () => {
  it('offers only ships of the cargo class', () => {
    const ships = availableShips(market, initialSelections(market), CARGO);
    expect(ships.length).toBeGreaterThan(0);
    for (const s of ships) expect(s.vesselClass).toBe(cargoClass);
  });

  it('opens talks when a ship is chosen, and hides that ship from other cargoes', () => {
    const s = chooseShip(market, initialSelections(market), CARGO, AT_PORT);
    expect(s[CARGO]!.negotiation?.status).toBe('open');
    expect(availableShips(market, s, OTHER_CARGO).map((x) => x.id)).not.toContain(AT_PORT);
    expect(availableShips(market, s, CARGO).map((x) => x.id)).toContain(AT_PORT);
  });

  it('locks the ship once a proposal has been sent', () => {
    let s = chooseShip(market, initialSelections(market), CARGO, AT_PORT);
    expect(isLocked(s[CARGO]!)).toBe(false);
    s = sendProposal(s, CARGO, 0.05);
    expect(isLocked(s[CARGO]!)).toBe(true);
    expect(chooseShip(market, s, CARGO, OTHER)).toBe(s);
  });

  it('frees the ship for other cargoes if talks fail', () => {
    const s = failDeal(chooseShip(market, initialSelections(market), CARGO, AT_PORT), CARGO);
    expect(s[CARGO]!.negotiation?.status).toBe('failed');
    expect(availableShips(market, s, OTHER_CARGO).map((x) => x.id)).toContain(AT_PORT);
  });

  it('gives the ballast distance and voyage days before any rate is agreed', () => {
    const o = voyageOutline(market, AT_PORT, CARGO);
    expect(o.ballastNm).toBe(0);
    expect(o.days).toBeGreaterThan(10);
  });
});

describe('scoring', () => {
  it('scores nothing before any deal is agreed', () => {
    const s = chooseShip(market, initialSelections(market), CARGO, AT_PORT);
    expect(toFixtures(s)).toEqual([]);
    expect(evaluate(market, s).totalScore).toBe(0);
  });

  it('scores an agreed deal at the agreed rate', () => {
    const s = closeDeal(chooseShip(market, initialSelections(market), CARGO, AT_PORT), CARGO);
    expect(s[CARGO]!.negotiation?.status).toBe('agreed');
    const [fixture] = toFixtures(s);
    expect(fixture).toEqual({ cargoId: CARGO, shipId: AT_PORT, rateUsdPerTonne: s[CARGO]!.negotiation!.agreedRate });
    const e = evaluate(market, s);
    expect(e.byCargo[CARGO]?.status).toBe('fixed');
    expect(e.totalScore).toBeGreaterThan(0);
  });

  it('ignores proposals for a cargo with no open talks', () => {
    const s = initialSelections(market);
    expect(sendProposal(s, CARGO, 10)).toBe(s);
  });
});

describe('boardCell', () => {
  it('marks wrong-class pairs as not fitting', () => {
    const s = initialSelections(market);
    const wrong = market.ships.find((x) => x.vesselClass !== cargoClass)!;
    const cell = boardCell(market, s, wrong.id, CARGO);
    expect(cell.fits).toBe(false);
    expect(cell.estTceUsdPerDay).toBeNull();
  });

  it('estimates owner TCE at the market rate, best for a ship at the load port', () => {
    const s = initialSelections(market);
    const atPort = boardCell(market, s, AT_PORT, CARGO);
    expect(atPort.ballastNm).toBe(0);
    expect(atPort.estTceRatio).toBeGreaterThan(1);
    const elsewhere = boardCell(market, s, OTHER, CARGO);
    expect(elsewhere.estTceUsdPerDay!).toBeLessThan(atPort.estTceUsdPerDay!);
  });

  it('tracks talks: talking, busy elsewhere, fixed and failed', () => {
    let s = chooseShip(market, initialSelections(market), CARGO, AT_PORT);
    expect(boardCell(market, s, AT_PORT, CARGO).status).toBe('talking');
    expect(boardCell(market, s, AT_PORT, OTHER_CARGO).status).toBe('busy');
    expect(boardCell(market, s, OTHER, OTHER_CARGO).status).toBe('free');
    s = closeDeal(s, CARGO);
    expect(boardCell(market, s, AT_PORT, CARGO).status).toBe('fixed');

    const f = failDeal(chooseShip(market, initialSelections(market), CARGO, OTHER), CARGO);
    expect(boardCell(market, f, OTHER, CARGO).status).toBe('failed');
    expect(boardCell(market, f, AT_PORT, CARGO).status).toBe('busy'); // the cargo is lost for the day
  });
});

describe('firm offers and the daily budget', () => {
  it('closes a deal with a firm offer inside both limits', () => {
    const s = chooseShip(market, initialSelections(market), CARGO, AT_PORT);
    const { ownerFloorRate, chartererCeilingRate } = s[CARGO]!.negotiation!.limits;
    const done = sendFirmOffer(s, CARGO, (ownerFloorRate + chartererCeilingRate) / 2);
    expect(done[CARGO]!.negotiation?.status).toBe('agreed');
  });

  it('spends one unit of budget per proposal or firm offer, across cargoes', () => {
    let s = chooseShip(market, initialSelections(market), CARGO, AT_PORT);
    s = chooseShip(market, s, OTHER_CARGO, OTHER);
    expect(budgetLeft(s)).toBe(PROPOSALS_PER_DAY);
    s = sendProposal(s, CARGO, 0.05);
    s = sendProposal(s, OTHER_CARGO, 0.05);
    expect(budgetLeft(s)).toBe(PROPOSALS_PER_DAY - 2);
  });

  it('ignores proposals and firm offers once the budget is spent', () => {
    // Lowball every cargo in turn until the day's budget runs out.
    let s = initialSelections(market);
    let stuck: string | null = null;
    for (const cargo of market.cargoes) {
      if (budgetLeft(s) === 0) break;
      const ship = availableShips(market, s, cargo.id)[0];
      if (!ship) continue;
      s = chooseShip(market, s, cargo.id, ship.id);
      for (let i = 0; i < MAX_ROUNDS && budgetLeft(s) > 0; i++) s = sendProposal(s, cargo.id, 0.05);
      if (s[cargo.id]!.negotiation?.status === 'open') stuck = cargo.id;
    }
    expect(budgetLeft(s)).toBe(0);
    expect(stuck).not.toBeNull();
    expect(sendProposal(s, stuck!, 10)).toBe(s);
    expect(sendFirmOffer(s, stuck!, 10)).toBe(s);
  });
});
