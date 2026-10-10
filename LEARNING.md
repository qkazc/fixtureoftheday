# Learning log

A running record of what we learn about dry bulk shipping while building the
game. Newest entries at the top.

## Simplifications

Places where the game deliberately differs from reality, and why.

### Voyage calculator (`engine/voyage.ts`)
- **Constant speed, no sea margin.** Real voyage estimates add about 5% to
  sea time for weather, and currents help or hinder. We sail at a fixed speed.
- **One fuel, one price.** Real ships burn cheaper high-sulphur fuel (with a
  scrubber) or very-low-sulphur fuel, and must switch to pricier low-sulphur
  fuel in emission control areas. Fuel prices differ by port.
- **Port time is a lump sum.** In reality, port days come from the agreed
  loading/discharge rates (for example 10,000 t/day), plus waiting time, weekends
  and holidays, and weather. Overruns cost demurrage. We just take a number of days.
- **Port costs are a lump sum.** Real port costs vary by port, ship size and
  length of stay.
- **Cargo limited only by DWT.** Really, the ship's fuel, water and stores
  use up part of the DWT. Light cargoes (grain, woodchips) fill the holds by
  volume before they reach the weight limit. Shallow ports limit how deep
  the ship can sit in the water (draft), so it can't be loaded full.
- **No canals.** Suez/Panama tolls and waiting times are ignored.

### Ports and distances (`engine/ports.ts`)
- **Ten ports, one distance per pair.** Real voyages have route choices
  (Suez or the Cape, Panama or not), and canals limit ship size: a loaded
  Capesize can't fit through Panama. We use one fixed distance per pair.
- **Areas as ports.** "US Gulf" stands for many Mississippi River grain
  terminals, and Kamsar for the wider Guinea bauxite coast.

### Daily market (`engine/market.ts`, `engine/vessels.ts`)
- **Simple timing.** Ships open on a day 0-6 days from now, and a ship fits
  a cargo if it can sail straight to the load port by the end of the
  laycan. Arriving early is fine. Real laycans are tighter, and arriving
  early can mean costly waiting or a cancelled booking.
- **A staged contest.** Every day includes two same-size cargoes loading
  near each other, plus one ship placed to suit both, and a decoy ship. Real markets
  produce this naturally: ships and cargoes cluster in the same regions
  (the Atlantic, the Pacific, the Indian Ocean), so brokers compete for the
  same well-placed ships every day.
- **One class per trade.** Each cargo needs exactly its trade's class. In
  reality a bigger ship can take a smaller cargo (usually at a worse rate),
  and cargo sizes are quoted with a tolerance such as "10% more or less".
- **Identical sister ships.** All ships of a class share the same specs,
  port days and port costs.
- **Market rates come from a target TCE.** Each class has a daily figure
  "the market pays". A cargo's rate is whatever gives a ship with a typical
  2,000 nm ballast leg that figure (±10%). Real rates come from supply and
  demand on each route, and they do price in the repositioning a typical
  ship needs, which is why a well-placed ship can beat the market.

### Scoring (`engine/scoring.ts`)
- **Backstop limits.** Scoring refuses any rate below 80% of market TCE or
  above 120% of the market rate. Negotiation's hidden limits sit inside
  these, so an agreed rate is never refused.
- **Satisfaction is only about money.** Real relationships also depend on
  reliability, timing and how disputes were handled.
- **One broker, fixed 1.25%.** Deals often go through two or more brokers
  who split the commission.

### Hidden limits (`engine/market.ts`)
- **Moods last a day.** Each owner's floor and charterer's ceiling come from
  the day's seed. Real clients remember how you treated them.
- **No haggling.** An earlier version had rounds of counter-offers; the
  inbox replaced them with one firm rate per fix attempt, with time as the
  budget.

### The broker's day (`engine/inbox.ts`, `engine/day.ts`)
- **Only you move the clock.** Time passes only when you research, fix or
  handle the distraction. Real days bring new emails, chasers and
  cancellations as they go.
- **One firm rate per attempt.** A fix closes if the rate is inside both
  hidden limits. A refusal says who said no but not by how much. Real
  fixtures are negotiated, then go "on subjects" (conditions to clear)
  before they are final.
- **Fixed effort by ship size.** Real effort depends on the client, the
  cargo's complications, and how many people are chasing the same ship.

### Morning brief (`engine/briefing.ts`)
- **Hints are always true.** Each news line comes from the day's real data
  (the contest, the keenest owner, the most eager charterer, the latest
  ship, the fuel price). Real market gossip is often wrong or self-serving.
- **The index only moves with fuel.** Indicative rates change day to day
  only because bunker prices change. Real indices move with supply and
  demand: ships, cargoes, weather, congestion and sentiment.

### Daily puzzles (`engine/solver.ts`, `engine/daily.ts`)
- **The best day assumes perfect information.** The solver knows every
  hidden limit, so it never researches and never has a fix refused. It is a
  ceiling to measure against, not what a careful player should expect.
- **"Interesting" means one thing.** A day is kept if a naive plan (soonest
  deadline first, best free ship each time, ignore the distraction) misses
  at least 5% of the best score. That captures the contest and the
  deadline squeeze, but not, for example, how hard the pricing is.
- **Re-rolled days.** About three in four first draws are re-rolled.
  Real markets aren't curated, of course: some real days are dull.

### The desk map (`src/mapData.ts`, `src/mapGeometry.ts`)
- **Hand-drawn, low-poly world.** Continents are a few dozen points each,
  and ports are placed by rough coordinates.
- **Drawn lanes, not real routing.** Voyage and ballast lines follow about
  60 hand-placed sea waypoints (Gibraltar, Suez, the Cape, Malacca, Panama
  and so on), taking the shortest way through them. This is drawing only:
  voyage distances still come from the game's distance table. Every lane
  can use Suez and Panama, whatever the ship's size.

## Placeholder numbers

Values we made up or estimated roughly, to replace with better-sourced
figures later.

- **Supramax test vessel** (`engine/voyage.test.ts`): 58,000 DWT, 13 knots,
  30 t/day fuel at sea, 5 t/day in port, $5,500/day opex. Plausible for the
  ship type, but chosen by hand.
- **Test voyage**: 55,000 t at $20/t, 5% commission, 500 nm ballast +
  6,000 nm laden, 8 port days, $150,000 port costs, bunkers $600/t.
  Plausible, not sourced.
- **Port distances** (`engine/ports.ts`): game estimates, approximate,
  rounded to the nearest 50 nm. Plausible for the usual routes but not from
  official distance tables.
- **Ship classes** (`engine/vessels.ts`): DWT, speed, fuel burn, opex,
  cargo ranges, port days and costs, and market TCE (Supramax $13,000,
  Panamax $14,000, Capesize $20,000 a day). Plausible, hand-picked.
- **Market** (`engine/market.ts`): bunkers $550–650/t, 5% commission, ±10%
  rate noise, 2,000 nm typical ballast leg, 50% chance of adding a contested
  pair on days without one. Each cargo's matching ship opens
  within 4,000 nm of the load port (half within 1,000 nm). Hand-picked.
- **Scoring** (`engine/scoring.ts`): ±20% satisfaction bands, tuned for
  gameplay. Brokerage of 1.25% is a common real-world figure, not sourced
  for this project.
- **Hidden limits** (`engine/market.ts`): owner floors 80–95% of market
  TCE, charterer ceilings 105–120% of market rate.
- **Inbox and day** (`engine/inbox.ts`, `engine/market.ts`): 8 working
  hours (09:00-17:00); research 0.5 h; fixing takes 1 h (Supramax), 2 h
  (Panamax) or 3 h (Capesize); deadlines 11:00, 13:00, 15:00 or 17:00; the
  distraction takes 1 h, is due by 10:00 and pays $1,500; ships open 0-6
  days out; laycans are 3 days wide and end 1-4 days after the matching
  ship can arrive.
- **Morning brief** (`engine/briefing.ts`): 3-4 news lines (always the
  contest, plus 2-3 of the others); indicative rates use a mid-size cargo
  and the 2,000 nm typical ballast leg.
- **Puzzle picker** (`engine/daily.ts`): a day must leave at least 5% on
  the table for the naive plan, and the best plan may miss at most one
  enquiry; up to 16 draws per date. Tuned by measuring a year of dates.
- **Map geography** (`src/mapData.ts`): hand-drawn continent outlines and
  approximate port coordinates.

## Notes

### TCE leaves out opex
TCE = (freight − voyage costs) ÷ voyage days. Opex is left out on purpose.
TCE exists so an owner can compare a voyage-charter offer (paid per tonne,
owner pays fuel and ports) with a time-charter offer (paid per day,
charterer pays fuel and ports). The owner pays opex in both cases, so it
doesn't change which offer is better. The calculator reports
`dailyProfitUsd = TCE − opex` separately.

### The ballast leg is paid for by the owner
A ship rarely finishes one job where the next one starts. It has to sail
there empty, earning nothing while still burning fuel. A cargo with a high
freight rate can be worse for a ship than a lower-paying one nearby, because
of the long ballast leg. This is a big part of why matching ships to cargoes
is a skill.

### Commissions come off the top
Freight is quoted gross, but the owner pays commissions out of it: address
commission back to the charterer and brokerage to brokers. These count as
voyage costs, so they lower TCE.

### The broker's conflict of interest
Brokerage is a percentage of the freight, so a higher rate pays the broker
more, but it also upsets the charterer, who is just as much a client. In this
game the score multiplies commission by both clients' satisfaction, so
squeezing either side costs you.

### Ships and cargoes cluster by region
Trades share load ports and regions: Brazil ships ore to both China and
Europe, Richards Bay ships coal to India and Europe, Santos ships grain to
both too. So the ships near one cargo are usually near another, and a good
broker decides which cargo each well-placed ship should take, not just
which ship suits each cargo.

