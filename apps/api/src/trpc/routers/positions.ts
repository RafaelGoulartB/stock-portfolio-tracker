import {
  consolidatePositions,
  summarizePositions,
} from "../../domain/positions";
import { protectedProcedure, router } from "../trpc";
import { loadTransactions } from "./transactions";

export const positionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const positions = consolidatePositions(await loadTransactions(ctx.user.id));

    return { positions, summary: summarizePositions(positions) };
  }),
});
