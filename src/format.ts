// Display formatting for numbers and labels.

import type { Commodity, VesselClass } from '../engine';

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const formatUsd = (usd: number): string =>
  `${usd < 0 ? '−' : ''}$${whole.format(Math.abs(usd))}`;

export const formatRate = (usdPerTonne: number): string => `$${usdPerTonne.toFixed(2)}/t`;

export const formatUsdPerDay = (usd: number): string => `${formatUsd(usd)}/day`;

export const formatTonnes = (t: number): string => `${whole.format(t)} t`;

export const formatNm = (nm: number): string => `${whole.format(nm)} nm`;

export const formatDays = (days: number): string => `${days.toFixed(1)} days`;

const COMMODITY_LABELS: Record<Commodity, string> = {
  ironOre: 'Iron ore',
  coal: 'Coal',
  grain: 'Grain',
  bauxite: 'Bauxite',
};

export const formatCommodity = (c: Commodity): string => COMMODITY_LABELS[c];

const CLASS_LABELS: Record<VesselClass, string> = {
  supramax: 'Supramax',
  panamax: 'Panamax',
  capesize: 'Capesize',
};

export const formatClass = (c: VesselClass): string => CLASS_LABELS[c];

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
