// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "./rate-limit";

describe("SlidingWindowRateLimiter", () => {
  it("allows up to the limit inside the window and denies the next hit", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter({
      limit: 3,
      windowMs: 10_000,
      clock: () => now,
    });

    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(false);

    now += 5_000;
    expect(limiter.hit("u1")).toBe(false);
  });

  it("slides: the oldest hit falls out of the window and frees one slot", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter({
      limit: 2,
      windowMs: 10_000,
      clock: () => now,
    });

    limiter.hit("u1");
    now += 6_000;
    limiter.hit("u1");
    expect(limiter.hit("u1")).toBe(false);

    now += 4_001;
    expect(limiter.hit("u1")).toBe(true);
    expect(limiter.hit("u1")).toBe(false);
  });

  it("keeps keys independent", () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.hit("a")).toBe(true);
    expect(limiter.hit("b")).toBe(true);
    expect(limiter.hit("a")).toBe(false);
  });

  it("does not count a denied hit against the window", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
      clock: () => now,
    });

    limiter.hit("a");
    now = 500;
    limiter.hit("a");
    now = 1001;
    expect(limiter.hit("a")).toBe(true);
  });
});
