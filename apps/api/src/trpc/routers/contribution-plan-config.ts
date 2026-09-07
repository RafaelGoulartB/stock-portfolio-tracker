import { contributionPlanConfigUpdateSchema } from "@portifolio-tracker/shared";
import {
  loadContributionPlanConfig,
  resetContributionPlanConfig,
  saveContributionPlanConfig,
} from "../../domain/contribution-plan-config";
import { protectedProcedure, router } from "../trpc";

export const contributionPlanConfigRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const { config, isCustom } = await loadContributionPlanConfig(ctx.user.id);

    return { config, isCustom };
  }),

  update: protectedProcedure
    .input(contributionPlanConfigUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const config = await saveContributionPlanConfig(ctx.user.id, input);

      return { config, isCustom: true as const };
    }),

  reset: protectedProcedure.mutation(async ({ ctx }) => {
    const config = await resetContributionPlanConfig(ctx.user.id);

    return { config, isCustom: false as const };
  }),
});
