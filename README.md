# Fixture of the Day

A daily challenge where you play a dry bulk shipbroker. Each day a seeded
market gives you a morning brief, an inbox of cargo enquiries and owners'
position lists, and eight working hours. Match ships to cargoes, set freight
rates both sides will accept, and get the deals done before their deadlines.
You're scored on the commission you earn and on how satisfied the shipowners
and charterers are.

Everyone playing the same date gets the same day.

It's a side project for learning how the shipping industry works, so it
favours plausible, clearly labelled numbers over precision. See
[`GLOSSARY.md`](GLOSSARY.md) for the shipping terms and
[`LEARNING.md`](LEARNING.md) for what the game simplifies and which numbers
are placeholders.

## How a day plays

1. **Morning brief** (before 09:00, free): overnight news with vague but true
   hints, today's indicative freight rates, and where the ships are.
2. **Inbox** (09:00 to 17:00): reading is free; acting costs time.
   - *Research* an enquiry (0.5 h) to see voyage estimates for every ship.
   - *Fix* it: pick a ship and a rate. It closes if the rate is inside both
     clients' hidden limits; if not, you hear who refused and can try again
     while time allows.
   - Ships can only be fixed once a day, and enquiries are lost when there's
     no longer time to finish them before their deadline.
3. **End of day**: what you fixed and why it scored what it did, what you
   missed and which ship could have fixed it.

You get one attempt per day. Progress is saved in your browser (so a refresh
doesn't lose it, but it doesn't follow you to another device), and the end
of day gives a spoiler-free result to copy and share.

## Running it

Requires Node 22 or later.

```sh
npm install
npm run dev          # play at the URL Vite prints
```

Open a specific day with `?date=2026-10-10` (or `#2026-10-10`).

```sh
npm test             # unit tests (Vitest)
npm run typecheck    # the app, then the engine on its own (no DOM)
npm run build        # typecheck and production build into dist/
npm run build:page   # build, then pack it into one HTML file:
                     # dist/fixture-of-the-day.html
```

Every pull request and push to `main` runs the typecheck, the tests and the
build on GitHub Actions (`.github/workflows/ci.yml`).

## Code layout

- `engine/`: all game and shipping logic, in pure TypeScript with unit tests
  next to each module. No DOM, no clock, no `Math.random()`: randomness comes
  from the date seed, so a day is reproducible.
  - `voyage.ts`: voyage calculator (days, costs, TCE)
  - `ports.ts`, `vessels.ts`: the ports, the distance table, the ship sizes
  - `market.ts`: the day's cargoes and ships, laycans, hidden limits
  - `scoring.ts`: commission and owner/charterer satisfaction
  - `inbox.ts`: the day's emails
  - `day.ts`: the 09:00-17:00 day as a pure state machine, plus the summary
  - `briefing.ts`: the morning brief
  - `random.ts`: the seeded random number generator
- `src/`: the browser UI, in plain TypeScript and DOM with no framework.
  `view.ts` draws the screens, and `text.ts` builds the plain-language
  sentences (tested). `save.ts` keeps the day in local storage by saving the
  player's actions and replaying them; `share.ts` builds the result text.
- `scripts/build-page.mjs`: packs the build into one self-contained page.

[`CLAUDE.md`](CLAUDE.md) holds the working rules for the project.
