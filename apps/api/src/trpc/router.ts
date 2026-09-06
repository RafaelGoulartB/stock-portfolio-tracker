import { authRouter } from "./routers/auth";
import { devSeedRouter } from "./routers/dev-seed";
import { fxRouter } from "./routers/fx";
import { positionsRouter } from "./routers/positions";
import { quotesRouter } from "./routers/quotes";
import { transactionsRouter } from "./routers/transactions";
import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  auth: authRouter,
  fx: fxRouter,
  quotes: quotesRouter,
  transactions: transactionsRouter,
  positions: positionsRouter,
  // DEV-ONLY test-data seeder. The procedure itself refuses to run in
  // production; it stays registered so the tRPC type stays stable.
  devSeed: devSeedRouter,
});

export type AppRouter = typeof appRouter;
