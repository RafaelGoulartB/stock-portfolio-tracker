import { expect, test } from "vitest";
import { appRouter } from "./trpc/router";

test("appRouter exports health", async () => {
  const caller = appRouter.createCaller({});
  await expect(caller.health()).resolves.toEqual({ ok: true });
});
