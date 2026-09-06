import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
});

export type AppRouter = typeof appRouter;
