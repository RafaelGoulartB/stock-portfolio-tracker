import { scoreConfigUpdateSchema } from "@portifolio-tracker/shared";
import {
  loadScoreConfig,
  resetScoreConfig,
  saveScoreConfig,
} from "../../domain/score-config";
import { protectedProcedure, router } from "../trpc";

export const scoreConfigRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const { config, isCustom } = await loadScoreConfig(ctx.user.id);

    return { config, isCustom };
  }),

  update: protectedProcedure
    .input(scoreConfigUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const config = await saveScoreConfig(ctx.user.id, input);

      return { config, isCustom: true as const };
    }),

  reset: protectedProcedure.mutation(async ({ ctx }) => {
    const config = await resetScoreConfig(ctx.user.id);

    return { config, isCustom: false as const };
  }),
});
