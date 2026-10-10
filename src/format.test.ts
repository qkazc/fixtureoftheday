import { describe, expect, it } from 'vitest';
import { formatCommodity, formatDays, formatNm, formatRate, formatTonnes, formatUsd, isoDate } from './format';

describe('format', () => {
  it('formats money with thousands separators and a proper minus sign', () => {
    expect(formatUsd(1234567.8)).toBe('$1,234,568');
    expect(formatUsd(-4589)).toBe('−$4,589');
  });

  it('formats rates, tonnes, distances and days', () => {
    expect(formatRate(7.7)).toBe('$7.70/t');
    expect(formatTonnes(157000)).toBe('157,000 t');
    expect(formatNm(3800)).toBe('3,800 nm');
    expect(formatDays(28.833)).toBe('28.8 days');
  });

  it('labels commodities', () => {
    expect(formatCommodity('ironOre')).toBe('Iron ore');
  });

  it('gives a local date as YYYY-MM-DD', () => {
    expect(isoDate(new Date(2026, 9, 5))).toBe('2026-10-05');
  });
});
