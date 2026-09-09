/**
 * In-memory sliding-window rate limiter, single process. `hit()` records the
 * attempt only when it is allowed, so a denied call does not extend the
 * window. Keys are opaque strings (the caller passes the validated user id).
 * Keys with no hit inside the window are pruned at most once per window so
 * the map is bounded by the number of keys active in the last window, not by
 * every key ever seen.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  private lastPruneAt: number | undefined;

  constructor(options: {
    limit: number;
    windowMs: number;
    clock?: () => number;
  }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock ?? Date.now;
  }

  /** Number of keys currently tracked (test and diagnostics only). */
  get size(): number {
    return this.hits.size;
  }

  hit(key: string): boolean {
    const now = this.clock();
    const cutoff = now - this.windowMs;
    this.pruneIdle(now, cutoff);

    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  private pruneIdle(now: number, cutoff: number): void {
    if (
      this.lastPruneAt !== undefined &&
      now - this.lastPruneAt < this.windowMs
    ) {
      return;
    }
    this.lastPruneAt = now;
    for (const [key, times] of this.hits) {
      if (!times.some((at) => at > cutoff)) this.hits.delete(key);
    }
  }
}
