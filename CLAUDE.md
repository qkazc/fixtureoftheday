# Fixture of the Day

A daily-challenge browser game where the player is a **dry bulk shipbroker**.
Each day a seeded market offers a few cargoes and open ships. The player
matches them, negotiates terms, and is scored on commission earned and on how
satisfied both the shipowner and the cargo owner (charterer) are. An isometric
visual scene comes later; the engine comes first.

This is a side project for learning how the shipping industry works. The
owner is a beginner in shipping, so teaching is part of every change.

## How we work

- **Plan before coding.** For any non-trivial feature, show a plan (inputs,
  outputs, formulas, simplifications, test cases) and wait for agreement
  before writing it.
- **Small steps.** One focused change at a time, each with its tests, each
  committed separately.
- **Explain shipping terms.** Whenever a shipping term is introduced (laycan,
  TCE, demurrage...), explain it in one or two plain sentences in the
  conversation **and** add it to `GLOSSARY.md` (alphabetical order).
- **Flag simplifications.** Say clearly where the model simplifies reality.
  Record them in code comments next to the logic, and note the bigger ones in
  `LEARNING.md`.
- **Simple over precise.** This is a hypothetical game. Prefer simple,
  plausible, clearly-labelled numbers over precision (e.g. a hand-written
  distance table, not a routing model). Keep modules small.
- **Ask before adding any dependency or dataset**, including dev-only ones.
- **Label placeholder numbers.** If a number is a made-up or rough value
  rather than a sourced real-world figure, say so, and mark it in code with a
  `// PLACEHOLDER:` comment. Real figures should note their source or basis.

## Architecture

- `engine/`: all game and shipping logic. **Pure TypeScript**: no DOM, no
  network, no `Date.now()` or `Math.random()` (randomness comes from a seed
  passed in, so a day's market is reproducible). Deterministic functions,
  plain data in and out. Every module has unit tests next to it
  (`foo.ts` + `foo.test.ts`).
  - `engine/tsconfig.json` drops the DOM libs, so using `window`,
    `document`, etc. in the engine fails typechecking.
- `src/`: UI only (Vite app, plain TypeScript + DOM, no framework). It
  imports from `engine/`; the engine never imports from `src/`. Pure UI
  logic (`state.ts`, `format.ts`) is unit-tested; DOM code (`view.ts`) stays
  thin. The UI picks the day: today's date, or `?date=YYYY-MM-DD`.

## Conventions

- Units in names where ambiguous: `distanceNm`, `speedKnots`,
  `fuelTonnesPerDay`, `costUsd`, `rateUsdPerTonne`, `days`.
- Money in US dollars (the industry's currency). Quantities in metric tonnes.
- Validate inputs at engine boundaries and throw clear errors on nonsense
  (negative distance, zero speed).

## Commands

- `npm run dev`: start the Vite dev server
- `npm test`: run unit tests once (Vitest)
- `npm run test:watch`: tests in watch mode
- `npm run typecheck`: typecheck the app and, separately, the engine (no DOM)
- `npm run build`: typecheck and production build

Run `npm run typecheck && npm test` before every commit.

## Docs

- `GLOSSARY.md`: shipping terms in plain English.
- `LEARNING.md`: running log of what we've learned about the industry,
  simplifications we've chosen, and placeholder numbers to revisit.
