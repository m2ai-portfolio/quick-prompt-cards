// @vitest-environment node
import { describe, expect, it } from "vitest";
import { QueryClaimStore } from "./query-claim-store";

describe("QueryClaimStore", () => {
  it("creates a new claim for an unseen query_id", () => {
    const store = new QueryClaimStore();

    expect(store.claim("q1")).toEqual({ outcome: "created" });
  });

  it("reports duplicate_in_progress while a claim is still pending", () => {
    const store = new QueryClaimStore();
    store.claim("q1");

    expect(store.claim("q1")).toEqual({ outcome: "duplicate_in_progress" });
  });

  it("reports already_posted once a claim is marked posted", () => {
    const store = new QueryClaimStore();
    store.claim("q1");
    store.markPosted("q1");

    expect(store.claim("q1")).toEqual({ outcome: "already_posted" });
  });

  it("reports already_consumed once a claim is marked as a terminal error", () => {
    const store = new QueryClaimStore();
    store.claim("q1");
    store.markTerminalError("q1");

    expect(store.claim("q1")).toEqual({ outcome: "already_consumed" });
  });

  it("keeps independent claims per query_id", () => {
    const store = new QueryClaimStore();
    store.claim("q1");

    expect(store.claim("q2")).toEqual({ outcome: "created" });
  });

  it("evicts a claim once its TTL has elapsed, allowing a fresh claim", () => {
    let now = 0;
    const store = new QueryClaimStore({ ttlMs: 1000, clock: () => now });
    store.claim("q1");

    now = 1001;

    expect(store.claim("q1")).toEqual({ outcome: "created" });
  });

  it("does not evict a claim before its TTL has elapsed", () => {
    let now = 0;
    const store = new QueryClaimStore({ ttlMs: 1000, clock: () => now });
    store.claim("q1");

    now = 999;

    expect(store.claim("q1")).toEqual({ outcome: "duplicate_in_progress" });
  });
});
