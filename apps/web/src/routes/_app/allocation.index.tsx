import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  AllocationMarkColor,
  AllocationRow,
  NextResult,
} from "@portifolio-tracker/shared";
import {
  CASH_TICKER,
  nonNegativeDecimal,
  positiveDecimal,
  weightRatio,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AddAssetDialog,
  type AddAssetValues,
} from "@/components/allocation/add-asset-dialog";
import { AllocationDeepFinderButton } from "@/components/allocation/allocation-deep-finder";
import {
  type AllocationFilterState,
  matchesStatus,
  readStoredFilters,
  storeFilters,
} from "@/components/allocation/allocation-filters";
import {
  ALLOCATION_COLUMNS,
  type AllocationColumn,
  type AllocationSort,
  AllocationTable,
  compareRows,
  defaultSortDirection,
  summarizeVisibleRows,
} from "@/components/allocation/allocation-table";
import {
  AllocationToolbar,
  COLUMN_PRESETS,
  DEFAULT_QUARTER_COUNT,
  QUARTER_COUNTS,
} from "@/components/allocation/allocation-toolbar";
import { ContributionPlannerButton } from "@/components/allocation/contribution-planner";
import { PageContent } from "@/components/page-content";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  findReview,
  removeReviewFromList,
  restoreReviewInList,
  reviewFromUpsertInput,
  upsertReviewInList,
} from "@/lib/allocation-review-cache";
import { trpc } from "@/lib/api";
import {
  CATEGORY_ALL,
  CATEGORY_NONE,
  matchesCategory,
} from "@/lib/category-filter";
import { useFxQuote, useFxRequest } from "@/lib/fx";
import { parseDecimalInput, parsePercentInput } from "@/lib/numeric-input";
import {
  currentQuarter,
  type Quarter,
  quarterWindow,
  shiftQuarter,
  toQuarter,
} from "@/lib/quarters";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/allocation/")({
  component: AllocationPage,
});

const FREE_ORDER_KEY = "portfolio.allocation.freeOrder";
const QUARTER_COUNT_KEY = "portfolio.allocation.quarters";
const LEGACY_COLUMN_STORAGE_KEY = "portfolio.allocation.columns";
const COLUMN_STORAGE_KEY = "portfolio.allocation.columns.v2";

function initialColumns(): Set<AllocationColumn> {
  try {
    const stored = localStorage.getItem(COLUMN_STORAGE_KEY);
    const legacy = stored === null;
    const parsed: unknown = JSON.parse(
      stored ?? localStorage.getItem(LEGACY_COLUMN_STORAGE_KEY) ?? "null",
    );
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((value): value is AllocationColumn =>
        ALLOCATION_COLUMNS.includes(value as AllocationColumn),
      );
      if (valid.includes("ticker")) {
        if (legacy && !valid.includes("nextResult")) {
          valid.splice(valid.indexOf("score") + 1, 0, "nextResult");
        }
        return new Set(valid);
      }
    }
  } catch {
    // Storage is only a convenience; the standard preset remains available.
  }
  return new Set(COLUMN_PRESETS.standard);
}

function storedNumber(key: string, allowed: readonly number[]): number | null {
  try {
    const value = Number(localStorage.getItem(key));

    return allowed.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function storeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is a convenience; the choice still applies to this session.
  }
}

/**
 * Where the quarter grid ends by default: the newest quarter that already
 * has a review, which is how far the research has advanced. With nothing
 * reviewed yet it falls back to the last completed quarter, because the
 * current one has no earnings to grade. A watch-next flag on that newest
 * review pulls the following quarter into view so the empty cell is visible.
 */
function defaultQuarterEnd(rows: readonly AllocationRow[]): Quarter {
  const periods = rows.flatMap((row) =>
    row.reviews.map((review) => review.period),
  );
  const newest = periods.sort().at(-1);
  const current = currentQuarter();
  const fallback = shiftQuarter(current, -1);

  if (!newest) {
    return fallback;
  }

  const reviewed = toQuarter(newest);
  const end = reviewed.key > current.key ? fallback : reviewed;
  const watchExtends = rows.some((row) =>
    row.reviews.some((review) => review.period === end.key && review.watchNext),
  );

  return watchExtends ? shiftQuarter(end, 1) : end;
}

function AllocationPage() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const fx = useFxQuote();
  const fxRequest = useFxRequest();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<AllocationSort>({
    id: "score",
    direction: "desc",
  });
  const [freeOrder, setFreeOrder] = useState(() => {
    try {
      return localStorage.getItem(FREE_ORDER_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [quarterCount, setQuarterCount] = useState(
    () =>
      storedNumber(QUARTER_COUNT_KEY, QUARTER_COUNTS) ?? DEFAULT_QUARTER_COUNT,
  );
  const [quarterEndKey, setQuarterEndKey] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] =
    useState<Set<AllocationColumn>>(initialColumns);
  const [filters, setFilters] = useState<AllocationFilterState>(() =>
    readStoredFilters(),
  );

  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );

  const allocationListInput = useMemo(
    () => ({
      displayCurrency,
      ...fxRequest,
      quoteSource,
      manualPrices:
        quoteSource === "manual" &&
        Object.keys(sanitizedManualPrices).length > 0
          ? sanitizedManualPrices
          : undefined,
    }),
    [displayCurrency, fxRequest, quoteSource, sanitizedManualPrices],
  );

  const allocation = trpc.allocation.list.useQuery(allocationListInput);
  const categories = trpc.categories.list.useQuery();
  const shouldLoadNextResults =
    visibleColumns.has("nextResult") || sort.id === "nextResult";
  const nextResultsQuery = trpc.allocation.nextResults.useQuery(undefined, {
    enabled: shouldLoadNextResults,
    staleTime: 30 * 60 * 1_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const nextResults = useMemo(
    () =>
      new Map<string, NextResult>(
        (nextResultsQuery.data?.results ?? []).map((result) => [
          result.ticker.toUpperCase(),
          result,
        ]),
      ),
    [nextResultsQuery.data?.results],
  );
  /** Latest in-flight mark write per ticker — older failures must not rollback. */
  const markWriteGeneration = useRef(new Map<string, number>());

  const waitingForRate =
    !!allocation.error && isFxRateRequired(allocation.error) && fx.isPending;
  const fxFailed =
    !!allocation.error &&
    isFxRateRequired(allocation.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;

  async function refresh() {
    await Promise.all([
      utils.allocation.list.invalidate(),
      utils.allocation.history.invalidate(),
    ]);
  }

  async function refreshPortfolioValuations() {
    await Promise.all([
      refresh(),
      utils.positions.list.invalidate(),
      utils.positions.daily.invalidate(),
      utils.performance.history.invalidate(),
    ]);
  }

  function reportError(error: unknown) {
    toast.error(queryErrorMessage(error));
  }

  function updateColumns(next: Set<AllocationColumn>) {
    setVisibleColumns(next);
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // The preference still applies for the current session.
    }
  }

  function updateFilters(next: AllocationFilterState) {
    setFilters(next);
    storeFilters(next);
  }

  const upsertAsset = trpc.allocation.upsertAsset.useMutation({
    onSuccess: async (_result, input) => {
      await refresh();
      if (input.categoryId !== undefined) {
        await utils.categories.list.invalidate();
      }
      if (input.assetClass !== undefined) {
        await utils.allocation.nextResults.invalidate();
      }
    },
    onError: reportError,
  });
  const setMarkColor = trpc.allocation.upsertAsset.useMutation({
    onMutate: async ({ ticker, markColor }) => {
      if (markColor === undefined) {
        return undefined;
      }

      const generation = (markWriteGeneration.current.get(ticker) ?? 0) + 1;
      markWriteGeneration.current.set(ticker, generation);

      await utils.allocation.list.cancel(allocationListInput);
      const previous = utils.allocation.list.getData(allocationListInput);

      utils.allocation.list.setData(allocationListInput, (current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          rows: current.rows.map((row) =>
            row.ticker === ticker ? { ...row, markColor, tracked: true } : row,
          ),
        };
      });

      return { previous, ticker, generation };
    },
    onError: (error, _input, context) => {
      if (
        context &&
        markWriteGeneration.current.get(context.ticker) ===
          context.generation &&
        context.previous
      ) {
        utils.allocation.list.setData(allocationListInput, context.previous);
      }

      reportError(error);
    },
  });
  const removeAsset = trpc.allocation.removeAsset.useMutation({
    onSuccess: async (result) => {
      toast.success(
        i18n._(
          msg({
            id: "allocation.removed",
            message: "Asset removed from the table",
          }),
        ),
      );
      await Promise.all([refresh(), utils.allocation.nextResults.invalidate()]);

      return result;
    },
    onError: reportError,
  });
  const reorder = trpc.allocation.reorder.useMutation({
    onSuccess: refresh,
    onError: reportError,
  });
  const upsertReview = trpc.allocation.upsertReview.useMutation({
    onMutate: async (input) => {
      await utils.allocation.list.cancel(allocationListInput);
      const snapshot = utils.allocation.list.getData(allocationListInput);
      const previous = findReview(snapshot, input.ticker, input.period);

      utils.allocation.list.setData(allocationListInput, (current) =>
        upsertReviewInList(
          current,
          input.ticker,
          reviewFromUpsertInput(input, previous),
        ),
      );

      return { previous };
    },
    onError: (error, input, context) => {
      utils.allocation.list.setData(allocationListInput, (current) =>
        restoreReviewInList(
          current,
          input.ticker,
          input.period,
          context?.previous,
        ),
      );
      reportError(error);
    },
    onSettled: () => {
      void refresh();
    },
  });
  const removeReview = trpc.allocation.removeReview.useMutation({
    onMutate: async (input) => {
      await utils.allocation.list.cancel(allocationListInput);
      const snapshot = utils.allocation.list.getData(allocationListInput);
      const previous = findReview(snapshot, input.ticker, input.period);

      utils.allocation.list.setData(allocationListInput, (current) =>
        removeReviewFromList(current, input.ticker, input.period),
      );

      return { previous };
    },
    onError: (error, input, context) => {
      utils.allocation.list.setData(allocationListInput, (current) =>
        restoreReviewInList(
          current,
          input.ticker,
          input.period,
          context?.previous,
        ),
      );
      reportError(error);
    },
    onSettled: () => {
      void refresh();
    },
  });
  const setManualValue = trpc.allocation.setManualValue.useMutation({
    onSuccess: refreshPortfolioValuations,
    onError: reportError,
  });
  const setCashBalance = trpc.allocation.setCashBalance.useMutation({
    onSuccess: refreshPortfolioValuations,
    onError: reportError,
  });

  const saving =
    upsertAsset.isPending ||
    removeAsset.isPending ||
    reorder.isPending ||
    setManualValue.isPending ||
    setCashBalance.isPending;

  const allRows = allocation.data?.rows ?? [];
  const categoryOptions = categories.data?.categories ?? [];
  const categoryByTicker = useMemo(() => {
    const map = new Map<string, string | null>();

    for (const asset of categories.data?.assets ?? []) {
      map.set(asset.ticker, asset.categoryId);
    }

    return map;
  }, [categories.data?.assets]);

  // Drop a stale pick if the category was deleted elsewhere. Memoized so the
  // fallback object stays stable for the row filter below.
  const activeFilters = useMemo<AllocationFilterState>(
    () =>
      filters.category === CATEGORY_ALL ||
      filters.category === CATEGORY_NONE ||
      categoryOptions.some((category) => category.id === filters.category)
        ? filters
        : { ...filters, category: CATEGORY_ALL },
    [filters, categoryOptions],
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(i18n.locale);
    const filtered = allRows.filter((row) => {
      if (
        needle &&
        !row.ticker.toLocaleLowerCase(i18n.locale).includes(needle)
      ) {
        return false;
      }

      const categoryId = categoryByTicker.get(row.ticker) ?? null;

      return (
        matchesCategory(activeFilters.category, categoryId) &&
        matchesStatus(activeFilters, row.hasPosition)
      );
    });

    // Free order keeps the stored rank the API already sorted by.
    return freeOrder
      ? filtered
      : filtered.sort((a, b) => compareRows(a, b, sort, nextResults));
  }, [
    allRows,
    search,
    activeFilters,
    categoryByTicker,
    sort,
    nextResults,
    freeOrder,
    i18n.locale,
  ]);

  // Stable across unrelated renders (typing in the search box, sorting) so the
  // memoized quarter cells are not invalidated by a brand-new quarter object.
  const quarterEnd = useMemo(
    () =>
      quarterEndKey ? toQuarter(quarterEndKey) : defaultQuarterEnd(allRows),
    [quarterEndKey, allRows],
  );
  const quarters = useMemo(
    () => quarterWindow(quarterEnd, quarterCount),
    [quarterEnd, quarterCount],
  );
  const visibleSummary = allocation.data
    ? summarizeVisibleRows(
        rows,
        allocation.data.summary.displayCurrency,
        allocation.data.summary.scoreVersion,
      )
    : undefined;

  /** Percent cell edits: an empty value clears the field. */
  function editPercent(ticker: string, text: string) {
    if (text.trim().length === 0) {
      upsertAsset.mutate({ ticker, targetWeight: null });

      return;
    }

    const parsed = parsePercentInput(text);

    if (parsed === null || !weightRatio.safeParse(parsed).success) {
      toast.error(
        i18n._(
          msg({
            id: "allocation.invalidPercent",
            message: "Enter a percentage, e.g. 1,5 or -20",
          }),
        ),
      );

      return;
    }

    upsertAsset.mutate({ ticker, targetWeight: parsed });
  }

  /** Market value of an unquoted position. Empty clears the stored override. */
  function editValue(ticker: string, text: string) {
    if (ticker === CASH_TICKER) {
      const parsed = text.trim().length === 0 ? "0" : parseDecimalInput(text);

      if (parsed === null || !nonNegativeDecimal.safeParse(parsed).success) {
        toast.error(
          i18n._(
            msg({
              id: "allocation.invalidCashValue",
              message: "Enter a cash value of zero or more.",
            }),
          ),
        );
        return;
      }

      setCashBalance.mutate({
        marketValue: parsed,
        displayCurrency,
        usdBrlRate: fx.effectiveRate,
      });
      return;
    }

    if (text.trim().length === 0) {
      setManualValue.mutate({
        ticker,
        marketValue: null,
        displayCurrency,
        usdBrlRate: fx.effectiveRate,
      });

      return;
    }

    const parsed = parseDecimalInput(text);

    if (parsed === null || !positiveDecimal.safeParse(parsed).success) {
      toast.error(
        i18n._(
          msg({
            id: "allocation.invalidValue",
            message: "Enter a market value, e.g. 50000",
          }),
        ),
      );

      return;
    }

    setManualValue.mutate({
      ticker,
      marketValue: parsed,
      displayCurrency,
      usdBrlRate: fx.effectiveRate,
    });
  }

  async function addAsset(values: AddAssetValues) {
    await upsertAsset.mutateAsync(values);
    toast.success(
      i18n._(
        t({
          id: "allocation.added",
          message: `${values.ticker} is now on the table`,
        }),
      ),
    );
  }

  return (
    <PageContent width="wide" className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="allocation.title">Allocation</Trans>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            <Trans id="allocation.subtitle">
              Targets, quarterly grades and the contribution score in one place.
              Edit any cell in the table; the score reranks on save.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ContributionPlannerButton
            rows={allocation.data?.rows ?? []}
            displayCurrency={
              allocation.data?.summary.displayCurrency ?? displayCurrency
            }
            portfolioValue={allocation.data?.summary.totalMarketValue ?? "0"}
            fx={allocation.data?.fx}
            disabled={!allocation.data}
          />
          <AllocationDeepFinderButton
            rows={allocation.data?.rows ?? []}
            categories={categoryOptions}
            categoryByTicker={categoryByTicker}
            displayCurrency={
              allocation.data?.summary.displayCurrency ?? displayCurrency
            }
            usdBrlRate={fx.effectiveRate}
            quoteSource={quoteSource}
            manualPrices={
              quoteSource === "manual" &&
              Object.keys(sanitizedManualPrices).length > 0
                ? sanitizedManualPrices
                : undefined
            }
            disabled={!allocation.data || categories.isPending}
            onSetMarkColor={(ticker, markColor) =>
              setMarkColor.mutate({ ticker, markColor })
            }
          />
          <AddAssetDialog
            categories={categoryOptions}
            onSubmit={addAsset}
            saving={upsertAsset.isPending}
          />
        </div>
      </header>

      <AllocationToolbar
        search={search}
        onSearchChange={setSearch}
        filters={activeFilters}
        onFiltersChange={updateFilters}
        categories={categoryOptions}
        quarterStart={quarters[0] ?? quarterEnd}
        quarterEnd={quarterEnd}
        quarterCount={quarterCount}
        onQuarterEndChange={(quarter) => setQuarterEndKey(quarter.key)}
        onQuarterEndReset={() => setQuarterEndKey(null)}
        onQuarterCountChange={(count) => {
          setQuarterCount(count);
          storeValue(QUARTER_COUNT_KEY, String(count));
        }}
        visibleColumns={visibleColumns}
        onColumnsChange={updateColumns}
        freeOrder={freeOrder}
        onFreeOrderChange={(checked) => {
          setFreeOrder(checked);
          storeValue(FREE_ORDER_KEY, String(checked));
        }}
      />

      {allocation.isPending || waitingForRate ? <TableSkeleton /> : null}
      {fxFailed ? (
        <ErrorCard>
          <Trans id="positions.fxFailed">
            Could not fetch the exchange rate. Try another source or enter it
            manually.
          </Trans>
        </ErrorCard>
      ) : null}
      {allocation.error && !waitingForRate && !fxFailed ? (
        <ErrorCard>{queryErrorMessage(allocation.error)}</ErrorCard>
      ) : null}

      {allocation.data ? (
        <AllocationTable
          rows={rows}
          quarters={quarters}
          summary={visibleSummary}
          visibleColumns={visibleColumns}
          sort={sort}
          onSort={(id: AllocationColumn) =>
            setSort((current) =>
              current.id === id
                ? {
                    id,
                    direction: current.direction === "asc" ? "desc" : "asc",
                  }
                : { id, direction: defaultSortDirection(id) },
            )
          }
          freeOrder={freeOrder}
          onReorder={(tickers) => reorder.mutate({ tickers })}
          onEditTarget={(ticker, text) => editPercent(ticker, text)}
          onEditValue={(ticker, text) => editValue(ticker, text)}
          onClearAnalysis={(ticker) =>
            upsertAsset.mutate({
              ticker,
              targetWeight: null,
              valuationRef: null,
            })
          }
          onRemoveAsset={(row) => removeAsset.mutate({ ticker: row.ticker })}
          onSetMarkColor={(
            ticker: string,
            markColor: AllocationMarkColor | null,
          ) => setMarkColor.mutate({ ticker, markColor })}
          onSaveReview={upsertReview.mutate}
          onRemoveReview={removeReview.mutate}
          missing={allocation.data.quotes.missing}
          nextResults={nextResults}
          nextResultsLoading={
            shouldLoadNextResults && nextResultsQuery.isPending
          }
          saving={saving}
        />
      ) : null}

      {visibleSummary ? (
        <p className="text-xs text-muted-foreground">
          <Trans id="allocation.footnote">
            {visibleSummary.investedAssets} invested ·{" "}
            {visibleSummary.watchOnlyAssets} watch-only ·{" "}
            {visibleSummary.candidates} taking contributions ·{" "}
            {visibleSummary.blocked} blocked · score rules{" "}
            {visibleSummary.scoreVersion}
          </Trans>
        </p>
      ) : null}
    </PageContent>
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

function TableSkeleton() {
  const rows = ["one", "two", "three", "four", "five", "six", "seven"];

  return (
    <Card className="gap-3 p-5">
      <Skeleton className="h-8 w-full" />
      {rows.map((row) => (
        <Skeleton key={row} className="h-9 w-full" />
      ))}
    </Card>
  );
}
