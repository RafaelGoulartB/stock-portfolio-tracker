import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Runs `fn` with a fresh memo map that nested work can share. */
export async function runWithRequestMemo<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(new Map(), fn);
}

/**
 * Deduplicates async work for `key` within the current request. Outside a
 * {@link runWithRequestMemo} boundary the loader runs normally.
 */
export function memoizeRequest<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const memos = store.getStore();

  if (!memos) {
    return load();
  }

  const hit = memos.get(key);

  if (hit) {
    return hit as Promise<T>;
  }

  const result = load();
  memos.set(key, result);
  return result;
}
