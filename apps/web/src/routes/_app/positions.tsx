import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { positiveDecimal } from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AllocationCard } from "@/components/positions/allocation-card";
import { DeepFinderTeaser } from "@/components/positions/deep-finder-teaser";
import { HoldingsCard } from "@/components/positions/holdings-card";
import { ManualPricesCard } from "@/components/positions/manual-prices-card";
import { MonthSelector } from "@/components/positions/month-selector";
import { EmptyState, PositionsSkeleton } from "@/components/positions/states";
import { SummaryStrip } from "@/components/positions/summary-strip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/api";
import { formatTradeDate } from "@/lib/format";
import { useFxQuote, useFxRequest } from "@/lib/fx";
import { lastTwelveMonths } from "@/lib/months";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/positions")({
  component: PositionsPage,
});

function PositionsPage() {
  // Subscribes this page to locale changes; amounts and dates below are
  // rendered with `Intl` using the active locale.
  const { i18n } = useLingui();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const months = useMemo(() => lastTwelveMonths(), []);
  const [monthKey, setMonthKey] = useState(months[0]?.key ?? "");
  const selected = months.find((month) => month.key === monthKey) ?? months[0];

  const fx = useFxQuote(selected?.asOf);
  const fxRequest = useFxRequest();
  const utils = trpc.useUtils();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Manual prices are raw user input; only valid decimals travel to the API.
  const sanitizedManualPrices = useMemo(() => {
    const entries = Object.entries(manualPrices).filter(
      ([, price]) => positiveDecimal.safeParse(price).success,
    );

    return Object.fromEntries(entries);
  }, [manualPrices]);

  const queryInput = useMemo(
    () => ({
      displayCurrency,
      ...fxRequest,
      asOf: selected?.asOf ?? undefined,
      quoteSource,
      manualPrices:
        quoteSource === "manual" &&
        Object.keys(sanitizedManualPrices).length > 0
          ? sanitizedManualPrices
          : undefined,
    }),
    [
      displayCurrency,
      fxRequest,
      quoteSource,
      sanitizedManualPrices,
      selected?.asOf,
    ],
  );
  const positions = trpc.positions.list.useQuery(queryInput);

  async function refreshQuotes() {
    const forcedInput = { ...queryInput, forceRefresh: true };
    setIsRefreshing(true);
    try {
      await utils.positions.list.invalidate(forcedInput);
      const refreshed = await utils.positions.list.fetch(forcedInput);
      utils.positions.list.setData(queryInput, refreshed);
      await utils.positions.finder.invalidate();
    } catch (error) {
      toast.error(queryErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  // The portfolio cannot consolidate mixed currencies until the quote
  // arrives; keep the skeleton instead of flashing a rate error.
  const waitingForRate =
    !!positions.error && isFxRateRequired(positions.error) && fx.isPending;
  const manualRateInvalid =
    !!positions.error &&
    isFxRateRequired(positions.error) &&
    fx.manualRateInvalid;
  const fxFailed =
    !!positions.error &&
    isFxRateRequired(positions.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;

  const data = positions.data;

  const open = useMemo(
    () =>
      data?.positions.filter((position) => Number(position.quantity) > 0) ?? [],
    [data],
  );

  const snapshotLabel = selected?.asOf
    ? formatTradeDate(selected.asOf)
    : i18n._(t({ id: "positions.live", message: "Live" }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="positions.title">Positions</Trans>
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            <Trans id="positions.subtitle">
              Month snapshots valued at each period close using the moving
              average cost of every trade you registered.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthSelector
            months={months}
            selectedKey={selected?.key ?? ""}
            onSelect={setMonthKey}
            locale={i18n.locale}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshQuotes()}
            disabled={positions.isFetching || isRefreshing}
          >
            <RefreshCw
              className={`size-4 ${positions.isFetching || isRefreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <Trans id="quotes.refresh">Refresh quotes</Trans>
          </Button>
          <Button asChild size="sm">
            <Link to="/transactions">
              <Plus className="size-4" aria-hidden="true" />
              <Trans id="positions.registerTrade">Register a trade</Trans>
            </Link>
          </Button>
        </div>
      </header>

      {positions.isPending || waitingForRate ? <PositionsSkeleton /> : null}

      {manualRateInvalid ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            <Trans id="positions.fxManualRateRequired">
              Enter a valid USD/BRL rate in Settings to consolidate this
              portfolio.
            </Trans>
          </CardContent>
        </Card>
      ) : null}

      {fxFailed ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            <Trans id="positions.fxFailed">
              Could not fetch the exchange rate. Try another source or enter it
              manually.
            </Trans>
          </CardContent>
        </Card>
      ) : null}

      {positions.error && !waitingForRate && !manualRateInvalid && !fxFailed ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {queryErrorMessage(positions.error)}
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <>
          <SummaryStrip summary={data.summary} snapshotLabel={snapshotLabel} />

          {open.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <AllocationCard
                positions={open}
                summary={data.summary}
                snapshotLabel={snapshotLabel}
              />

              <DeepFinderTeaser positions={open} summary={data.summary} />

              <HoldingsCard
                positions={open}
                summary={data.summary}
                missing={data.quotes.missing}
              />
            </>
          )}

          {quoteSource === "manual" ? (
            <ManualPricesCard
              key={data.positions.map((position) => position.ticker).join(",")}
              positions={data.positions}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
