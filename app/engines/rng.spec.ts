import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { defaultRng, seededRng } from './rng';

describe('defaultRng (CSPRNG)', () => {
  it('returns an integer in [0, maxExclusive)', () => {
    for (let i = 0; i < 1000; i++) {
      const v = defaultRng.randInt(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('covers each output at least once over many trials (sanity check)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      seen.add(defaultRng.randInt(5));
    }
    expect(seen.size).toBe(5);
  });

  it('rejects invalid maxExclusive', () => {
    expect(() => defaultRng.randInt(0)).toThrow();
    expect(() => defaultRng.randInt(-3)).toThrow();
    expect(() => defaultRng.randInt(1.5)).toThrow();
  });

  it('property: output is always in range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (n) => {
        const v = defaultRng.randInt(n);
        return v >= 0 && v < n && Number.isInteger(v);
      }),
    );
  });
});

describe('seededRng', () => {
  it('returns queued values in order', () => {
    const rng = seededRng([3, 0, 2]);
    expect(rng.randInt(5)).toBe(3);
    expect(rng.randInt(5)).toBe(0);
    expect(rng.randInt(5)).toBe(2);
  });

  it('throws when out of values', () => {
    const rng = seededRng([1]);
    rng.randInt(5);
    expect(() => rng.randInt(5)).toThrow();
  });

  it('throws when seeded value out of range', () => {
    const rng = seededRng([10]);
    expect(() => rng.randInt(5)).toThrow();
  });
});
