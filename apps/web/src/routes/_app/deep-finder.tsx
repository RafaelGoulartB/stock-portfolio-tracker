import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  DEEP_FINDER_WINDOWS,
  DEFAULT_DEEP_FINDER_WINDOW,
  type DeepFinderWindow,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, ScanSearch } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  HoldingsMatrix,
  type MatrixSort,
} from "@/components/deep-finder/matrix";
import { MoneyMovers } from "@/components/deep-finder/movers";
import { FinderSummary } from "@/components/deep-finder/summary";
import { windowLabel } from "@/components/deep-finder/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePortfolioQueryInput } from "@/lib/allocation-query";
import { trpc } from "@/lib/api";
import { useFxQuote } from "@/lib/fx";
import { prefetchPortfolio, trpcQueryUtils } from "@/lib/route-prefetch";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/deep-finder")({
  loader: ({ preload }) =>
    prefetchPortfolio(preload, (input) => [
      trpcQueryUtils.positions.finderWindows.prefetch(input),
    ]),
  component: DeepFinderPage,
});

function DeepFinderPage() {
  const { i18n } = useLingui();
  const fx = useFxQuote();
  const utils = trpc.useUtils();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [window, setWindow] = useState<DeepFinderWindow>(
    DEFAULT_DEEP_FINDER_WINDOW,
  );
  const [sort, setSort] = useState<MatrixSort>({
    key: DEFAULT_DEEP_FINDER_WINDOW,
    direction: "desc",
  });
  const queryInput = usePortfolioQueryInput();
  // Every window arrives at once, so switching is instant and offline.
  const finder = trpc.positions.finderWindows.useQuery(queryInput);

  function selectWindow(next: DeepFinderWindow) {
    setWindow(next);
    setSort({ key: next, direction: "desc" });
  }

  function changeSort(next: MatrixSort) {
    setSort(next);

    if ((DEEP_FINDER_WINDOWS as readonly string[]).includes(next.key)) {
      setWindow(next.key as DeepFinderWindow);
    }
  }

  async function refreshQuotes() {
    const forcedInput = { ...queryInput, forceRefresh: true };
    setIsRefreshing(true);
    try {
      await utils.positions.finderWindows.invalidate(forcedInput);
      const refreshed = await utils.positions.finderWindows.fetch(forcedInput);
      utils.positions.finderWindows.setData(queryInput, refreshed);
    } catch (error) {
      toast.error(queryErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }
  const waitingForRate =
    !!finder.error && isFxRateRequired(finder.error) && fx.isPending;
  const fxFailed =
    !!finder.error &&
    isFxRateRequired(finder.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;
  const busy = finder.isFetching || isRefreshing;
  const data = finder.data;
  const selected = data?.windows.find((entry) => entry.window === window);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="deepFinder.title">Deep Finder</Trans>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            <Trans id="deepFinder.subtitleShort">
              Find which holdings are rising or falling, over any period, and
              how much money each one moved.
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

      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={window}
          onValueChange={(value) =>
            value && selectWindow(value as DeepFinderWindow)
          }
          aria-label={i18n._(t({ id: "deepFinder.window", message: "Window" }))}
        >
          {DEEP_FINDER_WINDOWS.map((id) => (
            <ToggleGroupItem
              key={id}
              value={id}
              className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {windowLabel(id)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {finder.isPending || waitingForRate ? <FinderSkeleton /> : null}

      {fxFailed ? (
        <ErrorCard>
          <Trans id="deepFinder.fxFailed">
            Could not fetch the exchange rate. Try another source or enter it
            manually.
          </Trans>
        </ErrorCard>
      ) : null}

      {finder.error && !waitingForRate && !fxFailed ? (
        <ErrorCard>{queryErrorMessage(finder.error)}</ErrorCard>
      ) : null}

      {data ? (
        data.positions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <ScanSearch className="size-8" aria-hidden="true" />
              <Trans id="deepFinder.empty">
                Register a trade to start ranking open holdings.
              </Trans>
            </CardContent>
          </Card>
        ) : (
          <div
            className={cn(
              "space-y-5 transition-opacity",
              isRefreshing && "opacity-60",
            )}
          >
            {selected ? (
              <FinderSummary
                window={window}
                summary={selected}
                rows={data.positions}
              />
            ) : null}
            <MoneyMovers rows={data.positions} window={window} />
            <HoldingsMatrix
              rows={data.positions}
              windows={data.windows}
              window={window}
              sort={sort}
              onSort={changeSort}
              missing={data.quotes.missing}
            />
          </div>
        )
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

function FinderSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Skeleton className="h-28" />
      <Skeleton className="h-64" />
      <Skeleton className="h-96" />
    </div>
  );
}
