/** Drops entries whose `expiresAt` has passed. Mutates and returns `cache`. */
export function pruneExpired<T extends { expiresAt: number }>(
  cache: Map<string, T>,
  now = Date.now(),
): Map<string, T> {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }

  return cache;
}

/**
 * Coalesces concurrent work for one key. The in-flight map is cleared in
 * `finally` so a failure can be retried by the next caller.
 */
export async function coalesce<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = pending.get(key);

  if (existing) {
    return existing;
  }

  const result = load();
  pending.set(key, result);

  try {
    return await result;
  } finally {
    pending.delete(key);
  }
}

/** Caps how many `fn` calls run at once; extra callers wait in FIFO order. */
export function createConcurrencyLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }

    active += 1;

    try {
      return await fn();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}
