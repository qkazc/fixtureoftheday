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
