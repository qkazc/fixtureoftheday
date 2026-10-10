import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, pick, randomInt, shuffle } from './random';

describe('hashSeed', () => {
  it('is stable and distinguishes similar text', () => {
    expect(hashSeed('2026-10-10')).toBe(hashSeed('2026-10-10'));
    expect(hashSeed('2026-10-10')).not.toBe(hashSeed('2026-10-11'));
  });
});

describe('createRng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('gives different sequences for different seeds', () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });

  it('stays in [0, 1) and averages about 0.5', () => {
    const rng = createRng(7);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 10_000).toBeCloseTo(0.5, 1);
  });
});

describe('helpers', () => {
  it('randomInt covers both ends of the range and nothing outside', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1_000; i++) seen.add(randomInt(rng, 1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('pick returns an item from the list and rejects an empty list', () => {
    expect(['a', 'b']).toContain(pick(createRng(5), ['a', 'b']));
    expect(() => pick(createRng(5), [])).toThrow();
  });

  it('shuffle keeps the same items and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(createRng(9), input);
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
