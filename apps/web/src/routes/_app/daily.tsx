import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { BiggestMovers, ClassBreakdown } from "@/components/daily/breakdown";
import { DailyTable } from "@/components/daily/daily-table";
import { MarketMap } from "@/components/daily/market-map";
import { DailySummary } from "@/components/daily/summary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortfolioQueryInput } from "@/lib/allocation-query";
import { trpc } from "@/lib/api";
import { useFxQuote } from "@/lib/fx";
import { prefetchPortfolio, trpcQueryUtils } from "@/lib/route-prefetch";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/daily")({
  loader: ({ preload }) =>
    prefetchPortfolio(preload, (input) => [
      trpcQueryUtils.positions.daily.prefetch(input),
    ]),
  component: DailyPage,
});

function DailyPage() {
  const fx = useFxQuote();
  const utils = trpc.useUtils();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryInput = usePortfolioQueryInput();
  const daily = trpc.positions.daily.useQuery(queryInput);

  async function refreshQuotes() {
    const forcedInput = { ...queryInput, forceRefresh: true };
    setIsRefreshing(true);
    try {
      await utils.positions.daily.invalidate(forcedInput);
      const refreshed = await utils.positions.daily.fetch(forcedInput);
      utils.positions.daily.setData(queryInput, refreshed);
    } catch (error) {
      toast.error(queryErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }
  const waitingForRate =
    !!daily.error && isFxRateRequired(daily.error) && fx.isPending;
  const fxFailed =
    !!daily.error &&
    isFxRateRequired(daily.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;
  const busy = daily.isFetching || isRefreshing;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="daily.title">Daily performance</Trans>
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            <Trans id="daily.subtitleShort">
              How the portfolio moved in the latest session, which holdings
              drove it and how much came from the dollar.
            </Trans>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refreshQuotes()}
          disabled={busy}
        >
          <RefreshCw
            className={`size-4 ${busy ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <Trans id="quotes.refresh">Refresh quotes</Trans>
        </Button>
      </header>

      {daily.isPending || waitingForRate ? <DailySkeleton /> : null}

      {fxFailed ? (
        <ErrorCard>
          <Trans id="daily.fxFailed">
            Could not fetch the exchange rate. Try another source or enter it
            manually.
          </Trans>
        </ErrorCard>
      ) : null}

      {daily.error && !waitingForRate && !fxFailed ? (
        <ErrorCard>{queryErrorMessage(daily.error)}</ErrorCard>
      ) : null}

      {daily.data ? (
        <div
          className={cn(
            "space-y-5 transition-opacity",
            isRefreshing && "opacity-60",
          )}
        >
          <DailySummary data={daily.data} />
          {daily.data.positions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                <Trans id="daily.empty">
                  Register a trade to start tracking daily performance.
                </Trans>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-3">
                {/* The map keeps a fixed height; the side column fills the
                    row instead, so toggling its grouping never resizes it. */}
                <MarketMap data={daily.data} className="lg:col-span-2" />
                <div className="flex flex-col gap-5">
                  <ClassBreakdown data={daily.data} />
                  <BiggestMovers data={daily.data} className="flex-1" />
                </div>
              </div>
              <DailyTable data={daily.data} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ErrorCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-6 text-sm text-destructive">
        {children}
      </CardContent>
    </Card>
  );
}

function DailySkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="space-y-2 bg-card px-5 py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-36" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[340px] w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
