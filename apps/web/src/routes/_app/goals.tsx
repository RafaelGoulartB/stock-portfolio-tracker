import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { Flag, Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ContributionsCard } from "@/components/goals/contributions-card";
import { GoalDialog } from "@/components/goals/goal-dialog";
import { GoalSummary } from "@/components/goals/goal-summary";
import { ProjectionCard } from "@/components/goals/projection-card";
import {
  ErrorCard,
  PerformanceSkeleton,
} from "@/components/performance/performance-primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePortfolioQueryInput } from "@/lib/allocation-query";
import { trpc } from "@/lib/api";
import { prefetchPortfolio, trpcQueryUtils } from "@/lib/route-prefetch";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

/** Live values move with quotes; the projection itself is cheap to rebuild. */
const OVERVIEW_FRESH_MS = 5 * 60 * 1_000;

export const Route = createFileRoute("/_app/goals")({
  loader: ({ preload }) =>
    prefetchPortfolio(preload, (input) => [
      trpcQueryUtils.goals.overview.prefetch(input, {
        staleTime: OVERVIEW_FRESH_MS,
      }),
    ]),
  component: GoalsPage,
});

/** Whole currency units of a decimal string, for a friendlier suggestion. */
function wholeUnits(value: string | null): string | null {
  if (value === null || value.startsWith("-")) {
    return null;
  }

  const whole = value.split(".")[0] ?? "0";

  return whole === "0" ? null : whole;
}

function GoalsPage() {
  const portfolioInput = usePortfolioQueryInput();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const overview = trpc.goals.overview.useQuery(portfolioInput, {
    staleTime: OVERVIEW_FRESH_MS,
    placeholderData: (previous) => previous,
  });
  const data = overview.data;
  const missingManualRate =
    !!overview.error &&
    isFxRateRequired(overview.error) &&
    portfolioInput.fxSource === "manual" &&
    !portfolioInput.manualRate;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="goals.title">Goals</Trans>
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            <Trans id="goals.subtitle">
              Where your contributions are taking the portfolio, in today&apos;s
              money, and how steadily you have been making them.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw
              className={cn("size-4", overview.isFetching && "animate-spin")}
              aria-hidden="true"
            />
            <Trans id="goals.refresh">Refresh</Trans>
          </Button>
          {data ? (
            <Button type="button" size="sm" onClick={() => setEditing(true)}>
              {data.goal ? (
                <>
                  <Pencil aria-hidden="true" />
                  <Trans id="goals.edit">Edit goal</Trans>
                </>
              ) : (
                <>
                  <Flag aria-hidden="true" />
                  <Trans id="goals.create">Set a goal</Trans>
                </>
              )}
            </Button>
          ) : null}
        </div>
      </header>

      {overview.isPending ? <PerformanceSkeleton /> : null}

      {missingManualRate ? (
        <ErrorCard>
          <Trans id="goals.manualRateMissing">
            Set a manual USD/BRL rate in the settings to consolidate the
            portfolio.
          </Trans>
        </ErrorCard>
      ) : null}

      {overview.error && !missingManualRate ? (
        <ErrorCard>{queryErrorMessage(overview.error)}</ErrorCard>
      ) : null}

      {data ? (
        <div
          className={cn(
            "space-y-5 transition-opacity",
            overview.isFetching && overview.isPlaceholderData && "opacity-60",
          )}
        >
          {data.goal ? (
            <>
              <GoalSummary overview={data} />
              <ProjectionCard overview={data} />
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Flag
                  className="size-6 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="max-w-md space-y-1">
                  <p className="font-medium">
                    <Trans id="goals.emptyTitle">No goal yet</Trans>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <Trans id="goals.emptyDescription">
                      Say what the portfolio should pay you each month, or the
                      value you want to reach, and how much you plan to add
                      monthly. The projection shows when you get there.
                    </Trans>
                  </p>
                </div>
                <Button size="sm" onClick={() => setEditing(true)}>
                  <Flag aria-hidden="true" />
                  <Trans id="goals.create">Set a goal</Trans>
                </Button>
              </CardContent>
            </Card>
          )}

          <ContributionsCard
            contributions={data.contributions}
            planned={data.plannedMonthlyContribution}
          />
        </div>
      ) : null}

      {editing && data ? (
        <GoalDialog
          goal={data.goal}
          displayCurrency={data.displayCurrency}
          suggestedContribution={wholeUnits(
            data.contributions.recent.monthlyAverage,
          )}
          onClose={() => setEditing(false)}
          onSaved={() => utils.goals.invalidate()}
        />
      ) : null}
    </div>
  );
}
