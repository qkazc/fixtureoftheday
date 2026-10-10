// Saving a day in the browser, so a refresh doesn't wipe it.
//
// We save the player's actions, not the engine's state: the engine is
// deterministic, so replaying the same actions on the same date rebuilds the
// same day. A save that no longer replays cleanly (e.g. after a game update)
// is discarded and the day starts fresh. Storage can be missing or throw
// (private windows, blocked site data), so every access is guarded and the
// game works without it.

import {
  attemptFix,
  endDay,
  handleDistraction,
  research,
  startDay,
  type BlockReason,
  type DayState,
  type FixOutcome,
  type Inbox,
  type ResearchRow,
} from '../engine';

export type SavedAction =
  | { kind: 'research'; emailId: string }
  | { kind: 'fix'; emailId: string; shipId: string; rateUsdPerTonne: number }
  | { kind: 'distraction'; emailId: string }
  | { kind: 'endDay' };

export interface SavedDay {
  version: 1;
  date: string;
  started: boolean;
  read: string[];
  actions: SavedAction[];
}

export type ActionOutcome = FixOutcome | ResearchRow[] | 'done' | 'ended';

export type AppliedAction =
  | { ok: true; state: DayState; outcome: ActionOutcome }
  | { ok: false; state: DayState; reason: BlockReason };

/** Runs one saved action through the engine. */
export function applyAction(inbox: Inbox, day: DayState, a: SavedAction): AppliedAction {
  switch (a.kind) {
    case 'research':
      return research(inbox, day, a.emailId);
    case 'fix':
      return attemptFix(inbox, day, a.emailId, a.shipId, a.rateUsdPerTonne);
    case 'distraction':
      return handleDistraction(inbox, day, a.emailId);
    case 'endDay':
      return day.ended ? { ok: false, state: day, reason: 'dayOver' } : { ok: true, state: endDay(day), outcome: 'ended' };
  }
}

/** Rebuilds the day from its actions, or null if any action no longer applies. */
export function replay(inbox: Inbox, actions: readonly SavedAction[]): DayState | null {
  let day = startDay();
  try {
    for (const a of actions) {
      const r = applyAction(inbox, day, a);
      if (!r.ok) return null;
      day = r.state;
    }
  } catch {
    // The engine throws on ids that don't exist (e.g. a save from an older game).
    return null;
  }
  return day;
}

/** The parts of the browser's Storage we use. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const storageKey = (date: string): string => `fixture-of-the-day:${date}`;

/** The browser's local storage, or null if it is unavailable. */
export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface LoadedDay {
  started: boolean;
  read: string[];
  actions: SavedAction[];
  day: DayState;
}

/** Loads and replays the saved day for this inbox's date, or null if there is none (or it is unusable). */
export function loadDay(store: StorageLike | null, inbox: Inbox): LoadedDay | null {
  if (!store) return null;
  try {
    const raw = store.getItem(storageKey(inbox.date));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedDay>;
    if (saved.version !== 1 || saved.date !== inbox.date || !Array.isArray(saved.actions)) return null;
    const day = replay(inbox, saved.actions);
    if (!day) return null;
    return {
      started: saved.started === true,
      read: Array.isArray(saved.read) ? saved.read.filter((x): x is string => typeof x === 'string') : [],
      actions: saved.actions,
      day,
    };
  } catch {
    return null;
  }
}

export function saveDay(store: StorageLike | null, saved: Omit<SavedDay, 'version'>): void {
  if (!store) return;
  try {
    store.setItem(storageKey(saved.date), JSON.stringify({ version: 1, ...saved }));
  } catch {
    // Storage full or blocked: the game carries on unsaved.
  }
}
