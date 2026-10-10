import { describe, expect, it } from 'vitest';
import { VESSEL_CLASS_IDS, VESSEL_CLASSES } from './vessels';

describe('vessel classes', () => {
  it('keys each class by its own id', () => {
    for (const id of VESSEL_CLASS_IDS) expect(VESSEL_CLASSES[id].id).toBe(id);
  });

  it('has cargo ranges that fit within the ship', () => {
    for (const id of VESSEL_CLASS_IDS) {
      const c = VESSEL_CLASSES[id];
      expect(c.cargoMinTonnes).toBeGreaterThan(0);
      expect(c.cargoMinTonnes).toBeLessThanOrEqual(c.cargoMaxTonnes);
      expect(c.cargoMaxTonnes).toBeLessThan(c.vessel.dwt);
    }
  });

  it('orders classes by size: Supramax < Panamax < Capesize', () => {
    const { supramax, panamax, capesize } = VESSEL_CLASSES;
    expect(supramax.vessel.dwt).toBeLessThan(panamax.vessel.dwt);
    expect(panamax.vessel.dwt).toBeLessThan(capesize.vessel.dwt);
  });
});
