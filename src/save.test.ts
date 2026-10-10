import { describe, expect, it } from 'vitest';
import { generateInbox, isWorkable, negotiationLimits, startDay, type EnquiryEmail } from '../engine';
import { applyAction, loadDay, replay, saveDay, storageKey, type SavedAction, type StorageLike } from './save';

const inbox = generateInbox('2026-10-10');
const enquiries = inbox.emails.filter((e): e is EnquiryEmail => e.kind === 'enquiry');
const e = enquiries[0]!;
const cargo = inbox.market.cargoes.find((c) => c.id === e.cargoId)!;
const ship = inbox.market.ships.find((s) => isWorkable(inbox.market, s, cargo))!;
const l = negotiationLimits(inbox.market, ship, cargo);
const goodRate = (l.ownerFloorRate + l.chartererCeilingRate) / 2;

const actions: SavedAction[] = [
  { kind: 'research', emailId: e.id },
  { kind: 'fix', emailId: e.id, shipId: ship.id, rateUsdPerTonne: 0.5 }, // refused, still costs time
  { kind: 'fix', emailId: e.id, shipId: ship.id, rateUsdPerTonne: goodRate },
];

/** An in-memory stand-in for localStorage. */
function memoryStore(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('replay', () => {
  it('rebuilds exactly the state the actions produced', () => {
    let day = startDay();
    for (const a of actions) {
      const r = applyAction(inbox, day, a);
      expect(r.ok).toBe(true);
      day = r.state;
    }
    expect(replay(inbox, actions)).toEqual(day);
    expect(day.fixtures).toHaveLength(1);
  });

  it('gives null when an action no longer applies', () => {
    expect(replay(inbox, [{ kind: 'research', emailId: 'E99' } as SavedAction])).toBeNull();
    expect(replay(inbox, [{ kind: 'endDay' }, { kind: 'endDay' }])).toBeNull();
  });
});

describe('saveDay and loadDay', () => {
  it('round-trips a day through storage', () => {
    const store = memoryStore();
    saveDay(store, { date: inbox.date, started: true, read: [e.id], actions });
    const loaded = loadDay(store, inbox)!;
    expect(loaded.started).toBe(true);
    expect(loaded.read).toEqual([e.id]);
    expect(loaded.day).toEqual(replay(inbox, actions));
  });

  it('keeps each date separate', () => {
    const store = memoryStore();
    saveDay(store, { date: inbox.date, started: true, read: [], actions });
    expect(loadDay(store, generateInbox('2026-10-11'))).toBeNull();
  });

  it('ignores missing, corrupt, wrong-version or unreplayable saves', () => {
    const store = memoryStore();
    expect(loadDay(store, inbox)).toBeNull();
    store.setItem(storageKey(inbox.date), '{not json');
    expect(loadDay(store, inbox)).toBeNull();
    store.setItem(storageKey(inbox.date), JSON.stringify({ version: 2, date: inbox.date, actions: [] }));
    expect(loadDay(store, inbox)).toBeNull();
    store.setItem(storageKey(inbox.date), JSON.stringify({ version: 1, date: inbox.date, started: true, read: [], actions: [{ kind: 'research', emailId: 'E99' }] }));
    expect(loadDay(store, inbox)).toBeNull();
  });

  it('carries on when storage is missing or throws', () => {
    expect(loadDay(null, inbox)).toBeNull();
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadDay(broken, inbox)).toBeNull();
    expect(() => saveDay(broken, { date: inbox.date, started: true, read: [], actions })).not.toThrow();
  });
});
