/**
 * Process-wide memory of Alpha Vantage refusing work. The free key allows a
 * small daily budget, and quota or burst refusals arrive as HTTP 200 JSON
 * (`Information` / `Note`). Without this, every page load after the budget is
 * gone would keep calling, once per US ticker, and still fall back to Yahoo.
 */
let blockedUntil = 0;
let blockedReason = "";

/** A short pause for per-second burst refusals. */
const BURST_BACKOFF_MS = 60 * 1_000;

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
}

/** The refusal message while calls are paused, otherwise `null`. */
export function alphaVantageBlocked(now = Date.now()): string | null {
  return blockedUntil > now ? blockedReason : null;
}

/**
 * Records a quota-style refusal. A daily-limit message pauses calls until the
 * next UTC day; anything else (per-second burst, premium notice) only briefly.
 */
export function noteAlphaVantageRefusal(
  message: string,
  now = Date.now(),
): void {
  const daily = /per day|daily|25 requests/i.test(message);
  const until = daily ? nextUtcMidnight(now) : now + BURST_BACKOFF_MS;

  if (until > blockedUntil) {
    blockedUntil = until;
    blockedReason = message;
  }
}

/** Forgets any pause. Exported for tests. */
export function resetAlphaVantageQuota(): void {
  blockedUntil = 0;
  blockedReason = "";
}
