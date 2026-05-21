/**
 * In-process sliding-window rate limiter.
 *
 * Each key (user-scoped, route-scoped, sometimes both) has a small array
 * of hit timestamps. On `checkRateLimit`, expired hits drop off; if the
 * remaining count is below the cap, the new hit is recorded and the
 * request is allowed.
 *
 * Single-process by design — fine for the current deployment shape. When
 * we go multi-instance, swap this for Redis with the same surface. The
 * sliding-window math is identical; only the storage moves.
 *
 * Memory bound: the map only retains keys with at least one hit in the
 * current window. Buckets that fully drain are deleted on next check.
 * A periodic sweep is unnecessary at the volumes we're sized for.
 */

type Bucket = {
  hits: number[];
};

const BUCKETS = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** Cache key. Convention: `${routeKind}:${userId}` or include any other scope. */
  key: string;
  /** Sliding-window length in milliseconds. */
  windowMs: number;
  /** Max hits allowed within the window. */
  maxHits: number;
};

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Record a hit if under the cap; otherwise return the time-until-next-slot.
 * Side-effecting — only call this when you're about to perform the
 * rate-limited operation.
 */
export function checkRateLimit(opts: RateLimitOptions): RateLimitDecision {
  if (!Number.isFinite(opts.windowMs) || opts.windowMs <= 0) {
    throw new Error('checkRateLimit: windowMs must be a positive number');
  }
  if (!Number.isInteger(opts.maxHits) || opts.maxHits <= 0) {
    throw new Error('checkRateLimit: maxHits must be a positive integer');
  }

  const now = Date.now();
  const cutoff = now - opts.windowMs;
  const bucket = BUCKETS.get(opts.key) ?? { hits: [] };
  // Drop expired hits.
  const fresh: number[] = [];
  for (const t of bucket.hits) {
    if (t > cutoff) fresh.push(t);
  }

  if (fresh.length >= opts.maxHits) {
    // Soonest available slot = when the oldest in-window hit ages out.
    const oldest = fresh[0];
    const retryAfterMs = Math.max(0, opts.windowMs - (now - oldest));
    bucket.hits = fresh;
    BUCKETS.set(opts.key, bucket);
    return { allowed: false, retryAfterMs };
  }

  fresh.push(now);
  bucket.hits = fresh;
  BUCKETS.set(opts.key, bucket);
  return { allowed: true };
}

/**
 * Throws a Remix-compatible `Response` (HTTP 429 + Retry-After) when the
 * key is rate-limited. Otherwise records the hit and returns. Lets
 * server actions write:
 *
 *   enforceRateLimit({ key: `chat:${roomId}:${userId}`, windowMs: 10_000, maxHits: 5 });
 */
export function enforceRateLimit(opts: RateLimitOptions): void {
  const decision = checkRateLimit(opts);
  if (decision.allowed) return;
  const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
  throw new Response('rate limited', {
    status: 429,
    headers: { 'Retry-After': String(retryAfterSec) },
  });
}

/** Test-only — drop every bucket. */
export function _resetRateLimitState(): void {
  BUCKETS.clear();
}
