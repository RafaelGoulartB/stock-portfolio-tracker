import { describe, expect, it } from "vitest";
import { RateLimiter, resolveClientKey } from "./rate-limit";

function fakeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("RateLimiter", () => {
  it("allows up to the limit within a window, then denies", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 3,
      windowMs: 1000,
      maxKeys: 10,
      now: clock.now,
    });

    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(true);
    const third = limiter.consume("a");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("reports remaining attempts", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 2,
      windowMs: 1000,
      maxKeys: 10,
      now: clock.now,
    });
    expect(limiter.consume("a").remaining).toBe(1);
    expect(limiter.consume("a").remaining).toBe(0);
  });

  it("resets after the window elapses", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 1000,
      maxKeys: 10,
      now: clock.now,
    });
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    clock.advance(1000);
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("does not extend the window while denying", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 1000,
      maxKeys: 10,
      now: clock.now,
    });
    const first = limiter.consume("a");
    limiter.consume("a"); // denied
    clock.advance(500);
    limiter.consume("a"); // still denied, must not push resetAt out
    clock.advance(500);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(first.resetAt).toBe(1000);
  });

  it("tracks keys independently", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 1000,
      maxKeys: 10,
      now: clock.now,
    });
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("frees a window on reset", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 1000,
      maxKeys: 10,
      now: clock.now,
    });
    limiter.consume("a");
    limiter.reset("a");
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("stays bounded to maxKeys under a flood of distinct keys", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 1000,
      maxKeys: 5,
      now: clock.now,
    });
    for (let i = 0; i < 100; i += 1) {
      limiter.consume(`key-${i}`);
    }
    expect(limiter.size()).toBeLessThanOrEqual(5);
  });

  it("prunes expired keys as time passes", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 1000,
      maxKeys: 10,
      now: clock.now,
    });
    limiter.consume("a");
    expect(limiter.size()).toBe(1);
    clock.advance(1001);
    limiter.consume("b");
    expect(limiter.size()).toBe(1);
  });

  it("rejects non-positive bounds", () => {
    expect(
      () => new RateLimiter({ limit: 0, windowMs: 1, maxKeys: 1 }),
    ).toThrow();
    expect(
      () => new RateLimiter({ limit: 1, windowMs: 0, maxKeys: 1 }),
    ).toThrow();
    expect(
      () => new RateLimiter({ limit: 1, windowMs: 1, maxKeys: 0 }),
    ).toThrow();
  });
});

describe("resolveClientKey", () => {
  it("ignores X-Forwarded-For when no proxy is trusted", () => {
    expect(
      resolveClientKey({
        forwardedFor: "1.2.3.4",
        remoteAddress: "10.0.0.1",
        trustProxy: false,
      }),
    ).toBe("10.0.0.1");
  });

  it("honors the left-most forwarded entry only when trusting a proxy", () => {
    expect(
      resolveClientKey({
        forwardedFor: "1.2.3.4, 5.6.7.8",
        remoteAddress: "10.0.0.1",
        trustProxy: true,
      }),
    ).toBe("1.2.3.4");
  });

  it("falls back to the socket address when the forwarded header is empty", () => {
    expect(
      resolveClientKey({
        forwardedFor: "   ",
        remoteAddress: "10.0.0.1",
        trustProxy: true,
      }),
    ).toBe("10.0.0.1");
  });

  it("collapses an unidentifiable client to a shared bucket", () => {
    expect(
      resolveClientKey({
        forwardedFor: null,
        remoteAddress: null,
        trustProxy: false,
      }),
    ).toBe("unknown");
  });
});
