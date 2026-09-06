import { authRouter } from "./routers/auth";
import { positionsRouter } from "./routers/positions";
import { transactionsRouter } from "./routers/transactions";
import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  auth: authRouter,
  transactions: transactionsRouter,
  positions: positionsRouter,
});

export type AppRouter = typeof appRouter;
