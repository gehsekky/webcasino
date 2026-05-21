import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetRateLimitState, checkRateLimit, enforceRateLimit } from './rateLimit.server';

describe('checkRateLimit', () => {
  beforeEach(() => {
    _resetRateLimitState();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to maxHits within the window', () => {
    for (let i = 0; i < 5; i++) {
      const d = checkRateLimit({ key: 'k', windowMs: 1000, maxHits: 5 });
      expect(d.allowed).toBe(true);
    }
  });

  it('rejects the (maxHits + 1)th hit with the right retryAfter', () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit({ key: 'k', windowMs: 1000, maxHits: 3 });
      vi.advanceTimersByTime(100); // hits at 0, 100, 200
    }
    // Window is 1000ms. Oldest hit is at t=0; now is t=300. Retry-after
    // should be ~700ms.
    const d = checkRateLimit({ key: 'k', windowMs: 1000, maxHits: 3 });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.retryAfterMs).toBe(700);
    }
  });

  it('lets a hit through once the oldest expires', () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit({ key: 'k', windowMs: 1000, maxHits: 3 });
    }
    // Three at t=0 — all in window. Advance past the window edge.
    vi.advanceTimersByTime(1001);
    const d = checkRateLimit({ key: 'k', windowMs: 1000, maxHits: 3 });
    expect(d.allowed).toBe(true);
  });

  it('isolates buckets by key', () => {
    for (let i = 0; i < 3; i++) {
      const d = checkRateLimit({ key: 'a', windowMs: 1000, maxHits: 3 });
      expect(d.allowed).toBe(true);
    }
    // 'a' is full; 'b' is fresh.
    expect(checkRateLimit({ key: 'a', windowMs: 1000, maxHits: 3 }).allowed).toBe(false);
    expect(checkRateLimit({ key: 'b', windowMs: 1000, maxHits: 3 }).allowed).toBe(true);
  });

  it('rejects invalid options', () => {
    expect(() => checkRateLimit({ key: 'k', windowMs: 0, maxHits: 1 })).toThrow();
    expect(() => checkRateLimit({ key: 'k', windowMs: -1, maxHits: 1 })).toThrow();
    expect(() => checkRateLimit({ key: 'k', windowMs: 1000, maxHits: 0 })).toThrow();
    expect(() => checkRateLimit({ key: 'k', windowMs: 1000, maxHits: 1.5 })).toThrow();
  });
});

describe('enforceRateLimit', () => {
  beforeEach(() => {
    _resetRateLimitState();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns normally when under the cap', () => {
    expect(() => enforceRateLimit({ key: 'k', windowMs: 1000, maxHits: 2 })).not.toThrow();
  });

  it('throws a 429 Response with a Retry-After header when over the cap', () => {
    enforceRateLimit({ key: 'k', windowMs: 1000, maxHits: 1 });
    let thrown: unknown;
    try {
      enforceRateLimit({ key: 'k', windowMs: 1000, maxHits: 1 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    if (thrown instanceof Response) {
      expect(thrown.status).toBe(429);
      const retry = thrown.headers.get('Retry-After');
      expect(retry).not.toBeNull();
      expect(parseInt(retry ?? '0', 10)).toBeGreaterThanOrEqual(1);
    }
  });

  it('Retry-After rounds up to at least 1 second even on sub-second windows', () => {
    enforceRateLimit({ key: 'k', windowMs: 200, maxHits: 1 });
    let thrown: unknown;
    try {
      enforceRateLimit({ key: 'k', windowMs: 200, maxHits: 1 });
    } catch (e) {
      thrown = e;
    }
    if (thrown instanceof Response) {
      expect(parseInt(thrown.headers.get('Retry-After') ?? '0', 10)).toBe(1);
    }
  });
});
