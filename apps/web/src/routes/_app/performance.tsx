import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  type AssetClass,
  PERFORMANCE_WINDOWS,
  type PerformanceWindow,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { CategoriesCard } from "@/components/performance/categories-card";
import { ContributorsCard } from "@/components/performance/contributors-card";
import { EvolutionCard } from "@/components/performance/evolution-card";
import { MonthlyReturnsCard } from "@/components/performance/monthly-returns-card";
import {
  EmptyState,
  ErrorCard,
  PerformanceSkeleton,
} from "@/components/performance/performance-primitives";
import { SummaryStrip } from "@/components/performance/summary-strip";
import {
  axisMonthLabel,
  CATEGORY_COLORS,
  type Category,
  fullMonthLabel,
  type MonthRow,
} from "@/components/performance/types";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePortfolioQueryInput } from "@/lib/allocation-query";
import { trpc } from "@/lib/api";
import { prefetchPortfolio, trpcQueryUtils } from "@/lib/route-prefetch";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

/** A month-end history only changes when a new close lands. */
const HISTORY_FRESH_MS = 30 * 60 * 1_000;
const DEFAULT_MONTHS: PerformanceWindow = 12;

export const Route = createFileRoute("/_app/performance")({
  loader: ({ preload }) =>
    prefetchPortfolio(preload, (input) => [
      trpcQueryUtils.performance.history.prefetch(
        { ...input, months: DEFAULT_MONTHS },
        { staleTime: HISTORY_FRESH_MS, gcTime: HISTORY_FRESH_MS },
      ),
    ]),
  component: PerformancePage,
});

function PerformancePage() {
  const { i18n } = useLingui();
  const [months, setMonths] = useState<PerformanceWindow>(DEFAULT_MONTHS);
  const portfolioInput = usePortfolioQueryInput();

  const history = trpc.performance.history.useQuery(
    { ...portfolioInput, months },
    {
      staleTime: HISTORY_FRESH_MS,
      gcTime: HISTORY_FRESH_MS,
      // Changing the window keeps the last history on screen, dimmed.
      placeholderData: (previous) => previous,
    },
  );

  const data = history.data;

  const rows = useMemo<MonthRow[]>(
    () =>
      (data?.months ?? []).map((month) => ({
        key: month.key,
        label: axisMonthLabel(month.key, i18n.locale),
        fullLabel: fullMonthLabel(month.key, i18n.locale),
        marketValue: Number(month.marketValue),
        investedCost: Number(month.investedCost),
        netFlow: Number(month.netFlow),
        cumulativeNetFlow: Number(month.cumulativeNetFlow),
        unrealizedPnl: Number(month.unrealizedPnl),
        result: month.result == null ? null : Number(month.result),
        monthlyReturn:
          month.monthlyReturn == null ? null : Number(month.monthlyReturn),
        cumulativeReturn:
          month.cumulativeReturn == null
            ? null
            : Number(month.cumulativeReturn),
        drawdown: month.drawdown == null ? null : Number(month.drawdown),
        ...Object.fromEntries(
          month.byAssetClass.map((entry) => [
            entry.assetClass,
            Number(entry.marketValue),
          ]),
        ),
      })),
    [data?.months, i18n.locale],
  );

  /** Categories ordered by their largest value, so stacking stays stable. */
  const categories = useMemo<Category[]>(() => {
    const peaks = new Map<AssetClass, number>();

    for (const month of data?.months ?? []) {
      for (const entry of month.byAssetClass) {
        const value = Number(entry.marketValue);

        peaks.set(
          entry.assetClass,
          Math.max(peaks.get(entry.assetClass) ?? 0, value),
        );
      }
    }

    return [...peaks.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([assetClass], index) => ({
        assetClass,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      }));
  }, [data?.months]);

  const empty =
    !!data &&
    data.byAsset.length === 0 &&
    Number(data.summary.currentValue) === 0;
  const missingManualRate =
    !!history.error &&
    isFxRateRequired(history.error) &&
    portfolioInput.fxSource === "manual" &&
    !portfolioInput.manualRate;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="performance.title">Performance</Trans>
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            <Trans id="performance.subtitle">
              Month-end history of what the portfolio was worth, how much of it
              is result, and where that result comes from.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(months)}
            onValueChange={(value) =>
              value && setMonths(Number(value) as PerformanceWindow)
            }
            aria-label={i18n._(
              t({ id: "performance.window", message: "History window" }),
            )}
          >
            {PERFORMANCE_WINDOWS.map((option) => (
              <ToggleGroupItem
                key={option}
                value={String(option)}
                className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                aria-label={i18n._(
                  t({
                    id: "performance.windowMonths",
                    message: plural(
                      { count: option },
                      { one: "Last # month", other: "Last # months" },
                    ),
                  }),
                )}
              >
                <Trans id="performance.windowShort">{option}M</Trans>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => history.refetch()}
            disabled={history.isFetching}
          >
            <RefreshCw
              className={`size-4 ${history.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <Trans id="performance.refresh">Refresh</Trans>
          </Button>
        </div>
      </header>

      {history.isPending ? <PerformanceSkeleton /> : null}

      {missingManualRate ? (
        <ErrorCard>
          <Trans id="performance.manualRateMissing">
            Set a manual USD/BRL rate in the settings to consolidate this
            history.
          </Trans>
        </ErrorCard>
      ) : null}

      {history.error && !missingManualRate ? (
        <ErrorCard>{queryErrorMessage(history.error)}</ErrorCard>
      ) : null}

      {data && empty ? <EmptyState /> : null}

      {data && !empty ? (
        <div
          className={cn(
            "space-y-5 transition-opacity",
            history.isFetching && history.isPlaceholderData && "opacity-60",
          )}
        >
          <SummaryStrip summary={data.summary} months={months} />

          <EvolutionCard rows={rows} currency={data.summary.displayCurrency} />

          <MonthlyReturnsCard
            rows={rows}
            years={data.years}
            summary={data.summary}
          />

          <CategoriesCard
            rows={rows}
            breakdown={data.byAssetClass}
            summary={data.summary}
            categories={categories}
          />

          <ContributorsCard
            assets={data.byAsset}
            currency={data.summary.displayCurrency}
          />

          {data.quotes.missing.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              <Trans id="performance.missingQuotes">
                No price history for {data.quotes.missing.join(", ")}. These
                assets are carried at cost, so they add value without adding
                return.
              </Trans>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
