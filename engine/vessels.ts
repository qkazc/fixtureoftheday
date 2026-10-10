// Ship classes: the three dry bulk sizes used in the game.
//
// PLACEHOLDER: every figure here is plausible for the class but chosen by
// hand, not sourced. Real ships within a class vary a lot.
// SIMPLIFICATION: all ships of a class are identical, and port time and
// port costs are fixed per class rather than per port.

import type { Vessel } from './voyage';

export type VesselClass = 'supramax' | 'panamax' | 'capesize';

export interface VesselClassSpec {
  id: VesselClass;
  name: string;
  vessel: Vessel;
  /** Typical cargo size range for this class, in tonnes. */
  cargoMinTonnes: number;
  cargoMaxTonnes: number;
  /** Total load + discharge port days for a voyage. */
  portDays: number;
  /** Total port costs for a voyage. */
  portCostsUsd: number;
  /** Daily earnings the market currently pays this class (sets freight rates). */
  marketTceUsdPerDay: number;
}

export const VESSEL_CLASSES: Readonly<Record<VesselClass, VesselClassSpec>> = {
  supramax: {
    id: 'supramax',
    name: 'Supramax',
    vessel: {
      dwt: 58_000,
      speedKnots: 13,
      fuelAtSeaTonnesPerDay: 30,
      fuelInPortTonnesPerDay: 5,
      opexUsdPerDay: 5_500,
    },
    cargoMinTonnes: 40_000,
    cargoMaxTonnes: 55_000,
    portDays: 8,
    portCostsUsd: 150_000,
    marketTceUsdPerDay: 13_000,
  },
  panamax: {
    id: 'panamax',
    name: 'Panamax',
    vessel: {
      dwt: 82_000,
      speedKnots: 13,
      fuelAtSeaTonnesPerDay: 35,
      fuelInPortTonnesPerDay: 5,
      opexUsdPerDay: 6_000,
    },
    cargoMinTonnes: 60_000,
    cargoMaxTonnes: 75_000,
    portDays: 7,
    portCostsUsd: 180_000,
    marketTceUsdPerDay: 14_000,
  },
  capesize: {
    id: 'capesize',
    name: 'Capesize',
    vessel: {
      dwt: 180_000,
      speedKnots: 12.5,
      fuelAtSeaTonnesPerDay: 50,
      fuelInPortTonnesPerDay: 6,
      opexUsdPerDay: 7_500,
    },
    cargoMinTonnes: 150_000,
    cargoMaxTonnes: 170_000,
    portDays: 6,
    portCostsUsd: 250_000,
    marketTceUsdPerDay: 20_000,
  },
};

export const VESSEL_CLASS_IDS = Object.keys(VESSEL_CLASSES) as VesselClass[];
