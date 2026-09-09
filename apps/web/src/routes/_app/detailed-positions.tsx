import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { positiveDecimal } from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  columnLabels,
  initialColumns,
  persistColumns,
} from "@/components/detailed-positions/columns";
import { PositionsTable } from "@/components/detailed-positions/positions-table";
import { comparePositions } from "@/components/detailed-positions/sorting";
import {
  DetailedPositionsToolbar,
  ErrorCard,
  MonthSelector,
  TableSkeleton,
} from "@/components/detailed-positions/toolbar";
import type {
  ColumnId,
  SortState,
} from "@/components/detailed-positions/types";
import { PageContent } from "@/components/page-content";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/api";
import { CATEGORY_ALL, matchesCategory } from "@/lib/category-filter";
import { useFxQuote, useFxRequest } from "@/lib/fx";
import { lastTwelveMonths } from "@/lib/months";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/detailed-positions")({
  component: DetailedPositionsPage,
});

function DetailedPositionsPage() {
  const { i18n } = useLingui();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const months = useMemo(() => lastTwelveMonths(), []);
  const [monthKey, setMonthKey] = useState(months[0]?.key ?? "");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(CATEGORY_ALL);
  const [visibleColumns, setVisibleColumns] =
    useState<Set<ColumnId>>(initialColumns);
  const [sort, setSort] = useState<SortState>({
    id: "marketValue",
    direction: "desc",
  });
  const selected = months.find((month) => month.key === monthKey) ?? months[0];
  const fx = useFxQuote(selected?.asOf);
  const fxRequest = useFxRequest();
  const utils = trpc.useUtils();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );

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
    } catch (error) {
      toast.error(queryErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }
  const categoryList = trpc.categories.list.useQuery();
  const categoryByTicker = useMemo(
    () =>
      new Map(
        (categoryList.data?.assets ?? []).map((asset) => [
          asset.ticker,
          asset.categoryId,
        ]),
      ),
    [categoryList.data],
  );

  const waitingForRate =
    !!positions.error && isFxRateRequired(positions.error) && fx.isPending;
  const fxFailed =
    !!positions.error &&
    isFxRateRequired(positions.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;

  const labels = columnLabels(i18n);
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(i18n.locale);
    const filtered = (positions.data?.positions ?? []).filter((position) => {
      if (Number(position.quantity) === 0) return false;
      const categoryId = categoryByTicker.get(position.ticker) ?? null;

      if (categoryList.isSuccess && !matchesCategory(category, categoryId)) {
        return false;
      }

      if (!needle) return true;
      return `${position.ticker} ${position.assetClass} ${position.currency}`
        .toLocaleLowerCase(i18n.locale)
        .includes(needle);
    });
    return filtered.sort((a, b) =>
      comparePositions(a, b, sort.id, sort.direction),
    );
  }, [
    positions.data,
    categoryByTicker,
    categoryList.isSuccess,
    category,
    search,
    sort,
    i18n.locale,
  ]);

  function updateColumns(next: Set<ColumnId>) {
    setVisibleColumns(next);
    persistColumns(next);
  }

  function toggleSort(id: ColumnId) {
    setSort((current) =>
      current.id === id
        ? { id, direction: current.direction === "asc" ? "desc" : "asc" }
        : {
            id,
            direction:
              id === "ticker" || id === "assetClass" || id === "currency"
                ? "asc"
                : "desc",
          },
    );
  }

  return (
    <PageContent width="wide" className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="detailedPositions.title">Detailed positions</Trans>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            <Trans id="detailedPositions.subtitle">
              Inspect your holdings in a dense, customizable view. Choose a
              preset or select exactly which columns to display.
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
              <Plus aria-hidden="true" />
              <Trans id="positions.registerTrade">Register a trade</Trans>
            </Link>
          </Button>
        </div>
      </header>

      <DetailedPositionsToolbar
        search={search}
        onSearchChange={setSearch}
        category={category}
        categoryFilterReady={categoryList.isSuccess}
        categories={categoryList.data?.categories ?? []}
        onCategoryChange={setCategory}
        visibleColumns={visibleColumns}
        onColumnsChange={updateColumns}
      />

      {positions.isPending || waitingForRate ? <TableSkeleton /> : null}
      {fxFailed ? (
        <ErrorCard>
          <Trans id="positions.fxFailed">
            Could not fetch the exchange rate. Try another source or enter it
            manually.
          </Trans>
        </ErrorCard>
      ) : null}
      {positions.error && !waitingForRate && !fxFailed ? (
        <ErrorCard>{queryErrorMessage(positions.error)}</ErrorCard>
      ) : null}
      {positions.data ? (
        <PositionsTable
          rows={rows}
          visibleColumns={visibleColumns}
          labels={labels}
          sort={sort}
          onSort={toggleSort}
          displayCurrency={displayCurrency}
          summary={positions.data.summary}
          missing={positions.data.quotes.missing}
        />
      ) : null}
    </PageContent>
  );
}
