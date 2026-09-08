import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  type AssetClass,
  type PerformanceWindow,
  positiveDecimal,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { CategoryReturnCard } from "@/components/performance/category-return-card";
import { CategoryTable } from "@/components/performance/category-table";
import { CompositionCard } from "@/components/performance/composition-card";
import { ContributorsCard } from "@/components/performance/contributors-card";
import {
  EmptyState,
  ErrorCard,
  PerformanceSkeleton,
  WindowSelector,
} from "@/components/performance/performance-primitives";
import {
  CumulativeReturnCard,
  MonthlyReturnCard,
} from "@/components/performance/return-cards";
import { SummaryStrip } from "@/components/performance/summary-strip";
import {
  axisMonthLabel,
  CATEGORY_COLORS,
  type Category,
  fullMonthLabel,
  type MonthRow,
} from "@/components/performance/types";
import { ValueCard } from "@/components/performance/value-card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/performance")({
  component: PerformancePage,
});

function PerformancePage() {
  const { i18n } = useLingui();
  const { displayCurrency, quoteSource, manualPrices, fxSource, manualRate } =
    useSettings();
  const [months, setMonths] = useState<PerformanceWindow>(12);

  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );
  const manualRateValid = positiveDecimal.safeParse(manualRate).success;

  const history = trpc.performance.history.useQuery(
    {
      displayCurrency,
      months,
      quoteSource,
      manualPrices:
        quoteSource === "manual" &&
        Object.keys(sanitizedManualPrices).length > 0
          ? sanitizedManualPrices
          : undefined,
      fxSource,
      manualRate: manualRateValid ? manualRate : undefined,
    },
    // A month-end history only changes when a new close lands.
    { staleTime: 30 * 60 * 1_000, gcTime: 30 * 60 * 1_000 },
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
        monthlyReturn:
          month.monthlyReturn == null ? null : Number(month.monthlyReturn),
        cumulativeReturn:
          month.cumulativeReturn == null
            ? null
            : Number(month.cumulativeReturn),
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
    fxSource === "manual" &&
    !manualRateValid;

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
          <WindowSelector months={months} onSelect={setMonths} />
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
        <>
          <SummaryStrip summary={data.summary} months={months} />

          <ValueCard rows={rows} currency={data.summary.displayCurrency} />

          <div className="grid gap-5 lg:grid-cols-2">
            <CumulativeReturnCard rows={rows} />
            <MonthlyReturnCard rows={rows} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <CompositionCard
              rows={rows}
              categories={categories}
              currency={data.summary.displayCurrency}
            />
            <CategoryReturnCard
              breakdown={data.byAssetClass}
              categories={categories}
              currency={data.summary.displayCurrency}
            />
          </div>

          <CategoryTable
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
        </>
      ) : null}
    </div>
  );
}
