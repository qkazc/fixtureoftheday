import { describe, expect, it } from 'vitest';
import { distanceNm, PORT_IDS, PORTS, type PortId } from './ports';

describe('port catalogue', () => {
  it('keys each port by its own id', () => {
    for (const id of PORT_IDS) expect(PORTS[id].id).toBe(id);
  });

  it('gives every exported commodity at least one importing port', () => {
    for (const id of PORT_IDS) {
      for (const c of PORTS[id].exports) {
        expect(PORT_IDS.some((other) => PORTS[other].imports.includes(c))).toBe(true);
      }
    }
  });
});

describe('distanceNm', () => {
  it('has a distance for every pair of different ports, rounded to 50 nm', () => {
    for (const a of PORT_IDS) {
      for (const b of PORT_IDS) {
        if (a === b) continue;
        const nm = distanceNm(a, b);
        expect(nm).toBeGreaterThan(0);
        expect(nm % 50).toBe(0);
      }
    }
  });

  it('is the same in both directions', () => {
    expect(distanceNm('tubarao', 'qingdao')).toBe(11150);
    expect(distanceNm('qingdao', 'tubarao')).toBe(11150);
  });

  it('is zero from a port to itself', () => {
    expect(distanceNm('rotterdam', 'rotterdam')).toBe(0);
  });

  it('rejects unknown ports', () => {
    expect(() => distanceNm('atlantis' as PortId, 'qingdao')).toThrow(/unknown port id/);
  });
});
