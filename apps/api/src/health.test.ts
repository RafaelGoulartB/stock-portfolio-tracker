import { expect, test } from "vitest";
import type { Context } from "./trpc/context";
import { appRouter } from "./trpc/router";

const anonymousContext: Context = {
  user: null,
  token: null,
  setSessionCookie: () => {},
  clearSessionCookie: () => {},
};

test("appRouter exports health", async () => {
  const caller = appRouter.createCaller(anonymousContext);
  await expect(caller.health()).resolves.toEqual({ ok: true });
});

test("protected procedures reject anonymous callers", async () => {
  const caller = appRouter.createCaller(anonymousContext);
  await expect(caller.transactions.list()).rejects.toThrow(/sign in/i);
  await expect(caller.positions.list()).rejects.toThrow(/sign in/i);
});
