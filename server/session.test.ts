// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PocketStore } from "./pocket-store";
import { SessionService, hashSessionToken } from "./session";

const NOW_MS = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

let store: PocketStore;
let now: number;

beforeEach(() => {
  store = PocketStore.inMemory();
  now = NOW_MS;
});

afterEach(() => {
  store.close();
});

function service(): SessionService {
  return new SessionService(store, { now: () => now });
}

describe("SessionService", () => {
  it("mints a base64url token of 32 random bytes and stores only its sha256", () => {
    const sessions = service();
    const minted = sessions.mint(1001, "hermes1");

    expect(minted.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(minted.sessionToken, "base64url")).toHaveLength(32);
    expect(minted.expiresAt).toBe(new Date(NOW_MS + DAY_MS).toISOString());

    const expectedHash = createHash("sha256")
      .update(minted.sessionToken)
      .digest("hex");
    expect(hashSessionToken(minted.sessionToken)).toBe(expectedHash);
    expect(store.getSession(expectedHash)).toMatchObject({
      userId: 1001,
      botKey: "hermes1",
    });
    expect(store.getSession(minted.sessionToken)).toBeUndefined();
  });

  it("mints distinct tokens on each call", () => {
    const sessions = service();
    const a = sessions.mint(1, "hermes1").sessionToken;
    const b = sessions.mint(1, "hermes1").sessionToken;
    expect(a).not.toBe(b);
  });

  it("verifies a live token for its own bot key", () => {
    const sessions = service();
    const { sessionToken } = sessions.mint(1001, "hermes1");

    expect(sessions.verify(sessionToken, "hermes1")).toEqual({
      ok: true,
      userId: 1001,
    });
  });

  it("rejects a token presented with a different bot key (audience check)", () => {
    const sessions = service();
    const { sessionToken } = sessions.mint(1001, "hermes1");

    expect(sessions.verify(sessionToken, "beth")).toEqual({ ok: false });
  });

  it("rejects an expired token and lets a new session mint normally", () => {
    const sessions = service();
    const { sessionToken } = sessions.mint(1001, "hermes1");

    now += DAY_MS + 1;
    expect(sessions.verify(sessionToken, "hermes1")).toEqual({ ok: false });

    const fresh = sessions.mint(1001, "hermes1");
    expect(sessions.verify(fresh.sessionToken, "hermes1")).toEqual({
      ok: true,
      userId: 1001,
    });
  });

  it("rejects unknown, empty, malformed, and non-string tokens", () => {
    const sessions = service();
    sessions.mint(1001, "hermes1");

    expect(sessions.verify("not-a-real-token", "hermes1")).toEqual({
      ok: false,
    });
    expect(sessions.verify("", "hermes1")).toEqual({ ok: false });
    expect(sessions.verify(undefined, "hermes1")).toEqual({ ok: false });
    expect(sessions.verify(123, "hermes1")).toEqual({ ok: false });
    expect(sessions.verify("x".repeat(5000), "hermes1")).toEqual({ ok: false });
  });

  it("logout deletes the session so the token stops verifying", () => {
    const sessions = service();
    const { sessionToken } = sessions.mint(1001, "hermes1");

    sessions.logout(sessionToken);

    expect(sessions.verify(sessionToken, "hermes1")).toEqual({ ok: false });
  });

  it("sweepExpired removes only expired sessions", () => {
    const sessions = service();
    const old = sessions.mint(1001, "hermes1").sessionToken;
    now += DAY_MS / 2;
    const fresh = sessions.mint(1001, "beth").sessionToken;
    now += DAY_MS / 2 + 1;

    expect(sessions.sweepExpired()).toBe(1);
    expect(store.getSession(hashSessionToken(old))).toBeUndefined();
    expect(store.getSession(hashSessionToken(fresh))).toBeDefined();
  });

  it("upserts the user row on mint", () => {
    const sessions = service();
    sessions.mint(4242, "hermes1");
    expect(store.getUser(4242)).toMatchObject({ telegramUserId: 4242 });
  });
});
