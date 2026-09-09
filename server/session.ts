import { createHash, randomBytes } from "node:crypto";
import { POCKET_LIMITS } from "../shared/pocket-contract.js";
import type { PocketStore } from "./pocket-store.js";

export type SessionVerification = { ok: true; userId: number } | { ok: false };

const TOKEN_BYTES = 32;
const MAX_TOKEN_CHARS = 128;
const HOUR_MS = 60 * 60 * 1000;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Opaque bearer sessions per contracts/shared-pocket-v1.md "Session": 32
 * random bytes, base64url on the wire, sha256 at rest, 24 h lifetime, bound
 * to the bot key that minted them (audience check on every verify).
 */
export class SessionService {
  private readonly store: PocketStore;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    store: PocketStore,
    options: { now?: () => number; ttlMs?: number } = {},
  ) {
    this.store = store;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? POCKET_LIMITS.sessionTtlMs;
  }

  mint(
    userId: number,
    botKey: string,
  ): { sessionToken: string; expiresAt: string } {
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + this.ttlMs).toISOString();
    const sessionToken = randomBytes(TOKEN_BYTES).toString("base64url");

    this.store.upsertUser(userId, nowIso);
    this.store.insertSession({
      tokenHash: hashSessionToken(sessionToken),
      userId,
      botKey,
      createdAt: nowIso,
      expiresAt,
    });

    return { sessionToken, expiresAt };
  }

  verify(token: unknown, botKey: unknown): SessionVerification {
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > MAX_TOKEN_CHARS ||
      typeof botKey !== "string"
    ) {
      return { ok: false };
    }
    const row = this.store.getSession(hashSessionToken(token));
    if (!row || row.botKey !== botKey) {
      return { ok: false };
    }
    const expiresAtMs = Date.parse(row.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= this.now()) {
      return { ok: false };
    }
    return { ok: true, userId: row.userId };
  }

  logout(token: string): void {
    this.store.deleteSession(hashSessionToken(token));
  }

  sweepExpired(): number {
    return this.store.deleteExpiredSessions(new Date(this.now()).toISOString());
  }
}

/** Hourly expiry sweep; the timer is unref'd so it never keeps the process up. */
export function startSessionSweep(
  service: SessionService,
  intervalMs: number = HOUR_MS,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      service.sweepExpired();
    } catch {
      // A failed sweep is retried on the next tick; nothing else to do here.
    }
  }, intervalMs);
  timer.unref();
  return timer;
}
