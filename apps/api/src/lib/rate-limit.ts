/**
 * Operational, in-memory rate limiter for authentication endpoints.
 *
 * This is a deliberately small, dependency-free defense: it slows credential
 * stuffing and registration abuse on a single API instance without a Redis or
 * any external service. It is a fixed-window counter keyed by an opaque string
 * (see `resolveClientKey`), and it is bounded on both axes:
 *
 *   - per key: at most `limit` attempts inside each `windowMs` window;
 *   - overall: at most `maxKeys` tracked keys, so a flood of distinct keys can
 *     never grow the map without limit. When full, the oldest-expiring key is
 *     evicted, which at worst gives an attacker a fresh window — never a leak.
 *
 * The clock is injectable so tests never sleep.
 */
export type RateLimiterOptions = {
  /** Maximum attempts allowed per key within a window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Hard cap on tracked keys, bounding memory. */
  maxKeys: number;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Attempts remaining in the current window (never negative). */
  remaining: number;
  /** Epoch millis when the current window resets. */
  resetAt: number;
};

type Window = { count: number; resetAt: number };

export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, Window>();

  constructor(options: RateLimiterOptions) {
    if (options.limit < 1 || options.windowMs < 1 || options.maxKeys < 1) {
      throw new Error("Rate limiter bounds must be positive");
    }
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys;
    this.now = options.now ?? Date.now;
  }

  /**
   * Records one attempt for `key` and reports whether it is allowed. A denied
   * attempt does not extend the window, so a caller cannot be locked out
   * forever by continuing to hammer the endpoint.
   */
  consume(key: string): RateLimitResult {
    const now = this.now();
    this.prune(now);

    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      this.evictIfFull();
      const window: Window = { count: 1, resetAt: now + this.windowMs };
      this.windows.set(key, window);
      return {
        allowed: true,
        remaining: this.limit - 1,
        resetAt: window.resetAt,
      };
    }

    if (existing.count >= this.limit) {
      return { allowed: false, remaining: 0, resetAt: existing.resetAt };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: this.limit - existing.count,
      resetAt: existing.resetAt,
    };
  }

  /** Clears a key, e.g. after a successful login, so a real user is not penalized. */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /** Number of currently tracked keys. Exposed for tests and diagnostics. */
  size(): number {
    return this.windows.size;
  }

  /** Drops every expired window; O(n) but only over live keys. */
  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }

  /** Evicts the soonest-expiring key when the map is at capacity. */
  private evictIfFull(): void {
    if (this.windows.size < this.maxKeys) {
      return;
    }
    let oldestKey: string | null = null;
    let oldestResetAt = Number.POSITIVE_INFINITY;
    for (const [key, window] of this.windows) {
      if (window.resetAt < oldestResetAt) {
        oldestResetAt = window.resetAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.windows.delete(oldestKey);
    }
  }
}

/**
 * Resolves the opaque rate-limiting key for a request. `X-Forwarded-For` is
 * client-controlled and trivially spoofed, so it is only honored when the
 * deployment explicitly declares a trusted proxy. Otherwise the direct socket
 * address is used, and an unknown address collapses to a shared bucket so an
 * unidentifiable flood is still bounded rather than unlimited.
 */
export function resolveClientKey(input: {
  forwardedFor: string | null | undefined;
  remoteAddress: string | null | undefined;
  trustProxy: boolean;
}): string {
  if (input.trustProxy && input.forwardedFor) {
    // The left-most entry is the original client behind a trusted proxy chain.
    const first = input.forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const remote = input.remoteAddress?.trim();
  return remote && remote.length > 0 ? remote : "unknown";
}
