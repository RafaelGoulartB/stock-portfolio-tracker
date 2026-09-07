import { allocationRouter } from "./routers/allocation";
import { authRouter } from "./routers/auth";
import { categoriesRouter } from "./routers/categories";
import { contributionPlanConfigRouter } from "./routers/contribution-plan-config";
import { dataRouter } from "./routers/data";
import { devSeedRouter } from "./routers/dev-seed";
import { dividendsRouter } from "./routers/dividends";
import { fxRouter } from "./routers/fx";
import { performanceRouter } from "./routers/performance";
import { positionsRouter } from "./routers/positions";
import { quotesRouter } from "./routers/quotes";
import { scoreConfigRouter } from "./routers/score-config";
import { transactionsRouter } from "./routers/transactions";
import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  auth: authRouter,
  allocation: allocationRouter,
  categories: categoriesRouter,
  contributionPlanConfig: contributionPlanConfigRouter,
  data: dataRouter,
  dividends: dividendsRouter,
  fx: fxRouter,
  quotes: quotesRouter,
  scoreConfig: scoreConfigRouter,
  transactions: transactionsRouter,
  positions: positionsRouter,
  performance: performanceRouter,
  // DEV-ONLY test-data seeder. The procedure itself refuses to run in
  // production; it stays registered so the tRPC type stays stable.
  devSeed: devSeedRouter,
});

export type AppRouter = typeof appRouter;
