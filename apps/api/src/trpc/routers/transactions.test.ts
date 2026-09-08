import { describe, expect, it, vi } from "vitest";
import { lockTickers } from "./transactions";

/**
 * `lockTickers` must acquire advisory locks in a stable, deduplicated order so
 * two concurrent transactions touching the same tickers can never deadlock by
 * locking them in opposite orders. The SQL text carries the lock key, so we
 * capture the rendered queries from a stub executor instead of a live DB.
 */
function captureLockKeys() {
  const keys: string[] = [];
  const execute = vi.fn(async (query: unknown) => {
    // Drizzle renders sql`` into `queryChunks`: literal `StringChunk`s carry a
    // string[] value, while an interpolated primitive (our `user:ticker` lock
    // key) is stored directly as a string chunk.
    const chunks = (query as { queryChunks?: unknown[] }).queryChunks;

    for (const chunk of chunks ?? []) {
      if (typeof chunk === "string") {
        keys.push(chunk);
      }
    }

    return { rows: [] };
  });

  // The helper only ever calls `.execute`, so a partial stub is enough.
  const executor = { execute } as unknown as Parameters<typeof lockTickers>[0];

  return { keys, execute, executor };
}

describe("lockTickers", () => {
  it("locks tickers in a stable sorted order regardless of input order", async () => {
    const forward = captureLockKeys();
    const reverse = captureLockKeys();

    await lockTickers(forward.executor, "user-1", ["AAPL", "MGLU3", "PETR4"]);
    await lockTickers(reverse.executor, "user-1", ["PETR4", "AAPL", "MGLU3"]);

    expect(forward.keys).toEqual([
      "user-1:AAPL",
      "user-1:MGLU3",
      "user-1:PETR4",
    ]);
    // Same set, opposite input order, identical lock acquisition order.
    expect(reverse.keys).toEqual(forward.keys);
  });

  it("deduplicates repeated tickers into a single lock", async () => {
    const { keys, execute, executor } = captureLockKeys();

    await lockTickers(executor, "user-9", ["PETR4", "PETR4", "PETR4"]);

    expect(keys).toEqual(["user-9:PETR4"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("scopes the lock key to the account", async () => {
    const { keys, executor } = captureLockKeys();

    await lockTickers(executor, "account-abc", ["VALE3"]);

    expect(keys).toEqual(["account-abc:VALE3"]);
  });

  it("acquires no locks for an empty ticker list", async () => {
    const { execute, executor } = captureLockKeys();

    await lockTickers(executor, "user-1", []);

    expect(execute).not.toHaveBeenCalled();
  });
});
