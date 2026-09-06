import { authRouter } from "./routers/auth";
import { fxRouter } from "./routers/fx";
import { positionsRouter } from "./routers/positions";
import { transactionsRouter } from "./routers/transactions";
import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  auth: authRouter,
  fx: fxRouter,
  transactions: transactionsRouter,
  positions: positionsRouter,
});

export type AppRouter = typeof appRouter;
