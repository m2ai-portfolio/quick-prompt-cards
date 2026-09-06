export type ClaimOutcome =
  | { outcome: "created" }
  | { outcome: "duplicate_in_progress" }
  | { outcome: "already_posted" }
  | { outcome: "already_consumed" };

type ClaimState = "pending" | "posted" | "telegram_error";

type ClaimEntry = {
  state: ClaimState;
  createdAt: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * In-memory atomic claim store for the query_id idempotency key defined in
 * contracts/prompt-run-v1.md. `claim()` is fully synchronous, so on Node's
 * single-threaded event loop it behaves as an atomic compare-and-set: no
 * other claim() call can interleave between the read and the write.
 */
export class QueryClaimStore {
  private readonly claims = new Map<string, ClaimEntry>();
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(options?: { ttlMs?: number; clock?: () => number }) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    this.clock = options?.clock ?? Date.now;
  }

  claim(queryId: string): ClaimOutcome {
    this.evictExpired();
    const existing = this.claims.get(queryId);
    if (!existing) {
      this.claims.set(queryId, { state: "pending", createdAt: this.clock() });
      return { outcome: "created" };
    }
    if (existing.state === "pending") {
      return { outcome: "duplicate_in_progress" };
    }
    if (existing.state === "posted") {
      return { outcome: "already_posted" };
    }
    return { outcome: "already_consumed" };
  }

  markPosted(queryId: string): void {
    const entry = this.claims.get(queryId);
    if (entry) {
      entry.state = "posted";
    }
  }

  markTerminalError(queryId: string): void {
    const entry = this.claims.get(queryId);
    if (entry) {
      entry.state = "telegram_error";
    }
  }

  /**
   * Drops a still-pending claim so the same query_id can be claimed again.
   * Only valid when the holder proves no Telegram call was attempted (for
   * example a rate-limit rejection); a terminal claim is never released.
   */
  release(queryId: string): void {
    const entry = this.claims.get(queryId);
    if (entry && entry.state === "pending") {
      this.claims.delete(queryId);
    }
  }

  private evictExpired(): void {
    const now = this.clock();
    for (const [queryId, entry] of this.claims) {
      if (now - entry.createdAt > this.ttlMs) {
        this.claims.delete(queryId);
      }
    }
  }
}
