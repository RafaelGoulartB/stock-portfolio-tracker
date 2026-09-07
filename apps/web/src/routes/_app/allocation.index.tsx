import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  AllocationMarkColor,
  AllocationRow,
} from "@portifolio-tracker/shared";
import {
  CASH_TICKER,
  nonNegativeDecimal,
  positiveDecimal,
  weightRatio,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  RotateCcw,
  Search,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AddAssetDialog,
  type AddAssetValues,
} from "@/components/allocation/add-asset-dialog";
import {
  ALLOCATION_COLUMNS,
  type AllocationColumn,
  type AllocationSort,
  AllocationTable,
  columnLabels,
  compareRows,
  defaultSortDirection,
  summarizeVisibleRows,
} from "@/components/allocation/allocation-table";
import { ContributionPlannerButton } from "@/components/allocation/contribution-planner";
import { PageContent } from "@/components/page-content";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/api";
import { useFxQuote } from "@/lib/fx";
import { parseDecimalInput, parsePercentInput } from "@/lib/numeric-input";
import {
  currentQuarter,
  formatQuarterLabel,
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
const QUARTER_COUNTS = [3, 4, 5, 8] as const;
const DEFAULT_QUARTER_COUNT = 4;
const COLUMN_STORAGE_KEY = "portfolio.allocation.columns";
/** Category filter sentinels — match the categories screen. */
const CATEGORY_ALL = "all";
const CATEGORY_NONE = "none";
const RADAR_ALL = "all";
const RADAR_ON = "on";
const RADAR_OFF = "off";

const COLUMN_PRESETS: Record<
  "compact" | "standard" | "all",
  AllocationColumn[]
> = {
  compact: [
    "ticker",
    "targetWeight",
    "currentWeight",
    "gapWeight",
    "score",
    "marketValue",
  ],
  standard: [
    "ticker",
    "targetWeight",
    "currentWeight",
    "gapWeight",
    "discount",
    "score",
    "marketValue",
    "averageGrade",
  ],
  all: [...ALLOCATION_COLUMNS],
};

function initialColumns(): Set<AllocationColumn> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(COLUMN_STORAGE_KEY) ?? "null",
    );
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((value): value is AllocationColumn =>
        ALLOCATION_COLUMNS.includes(value as AllocationColumn),
      );
      if (valid.includes("ticker")) return new Set(valid);
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
 * current one has no earnings to grade.
 */
function defaultQuarterEnd(rows: readonly AllocationRow[]): Quarter {
  const periods = rows.flatMap((row) =>
    row.reviews.map((review) => review.period),
  );
  const newest = periods.sort().at(-1);
  const fallback = shiftQuarter(currentQuarter(), -1);

  if (!newest) {
    return fallback;
  }

  const reviewed = toQuarter(newest);

  return reviewed.key > currentQuarter().key ? fallback : reviewed;
}

function AllocationPage() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const fx = useFxQuote();

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
  const [categoryFilter, setCategoryFilter] = useState(CATEGORY_ALL);
  const [radarFilter, setRadarFilter] = useState(RADAR_ALL);

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
      usdBrlRate: fx.effectiveRate,
      quoteSource,
      manualPrices:
        quoteSource === "manual" &&
        Object.keys(sanitizedManualPrices).length > 0
          ? sanitizedManualPrices
          : undefined,
    }),
    [displayCurrency, fx.effectiveRate, quoteSource, sanitizedManualPrices],
  );

  const allocation = trpc.allocation.list.useQuery(allocationListInput);
  const categories = trpc.categories.list.useQuery();
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

  function applyPreset(preset: keyof typeof COLUMN_PRESETS) {
    updateColumns(new Set(COLUMN_PRESETS[preset]));
  }

  function toggleColumn(id: AllocationColumn) {
    if (id === "ticker") return;
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateColumns(next);
  }

  const upsertAsset = trpc.allocation.upsertAsset.useMutation({
    onSuccess: refresh,
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
      await refresh();

      return result;
    },
    onError: reportError,
  });
  const reorder = trpc.allocation.reorder.useMutation({
    onSuccess: refresh,
    onError: reportError,
  });
  const upsertReview = trpc.allocation.upsertReview.useMutation({
    onSuccess: refresh,
    onError: reportError,
  });
  const removeReview = trpc.allocation.removeReview.useMutation({
    onSuccess: refresh,
    onError: reportError,
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
    upsertReview.isPending ||
    removeReview.isPending ||
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

  // Drop a stale pick if the category was deleted elsewhere.
  const activeCategoryFilter =
    categoryFilter === CATEGORY_ALL ||
    categoryFilter === CATEGORY_NONE ||
    categoryOptions.some((category) => category.id === categoryFilter)
      ? categoryFilter
      : CATEGORY_ALL;

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

      if (activeCategoryFilter === CATEGORY_NONE) {
        if (categoryId !== null) {
          return false;
        }
      } else if (activeCategoryFilter !== CATEGORY_ALL) {
        if (categoryId !== activeCategoryFilter) {
          return false;
        }
      }

      if (radarFilter === RADAR_ON) {
        return !row.hasPosition;
      }

      if (radarFilter === RADAR_OFF) {
        return row.hasPosition;
      }

      return true;
    });

    // Free order keeps the stored rank the API already sorted by.
    return freeOrder
      ? filtered
      : filtered.sort((a, b) => compareRows(a, b, sort));
  }, [
    allRows,
    search,
    activeCategoryFilter,
    categoryByTicker,
    radarFilter,
    sort,
    freeOrder,
    i18n.locale,
  ]);

  const quarterEnd = quarterEndKey
    ? toQuarter(quarterEndKey)
    : defaultQuarterEnd(allRows);
  const quarters = quarterWindow(quarterEnd, quarterCount);
  const labels = columnLabels(i18n);
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
          <AddAssetDialog onSubmit={addAsset} saving={upsertAsset.isPending} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={i18n._(
              t({ id: "allocation.searchLabel", message: "Search assets" }),
            )}
            placeholder={i18n._(
              t({ id: "allocation.search", message: "Search ticker…" }),
            )}
            className="h-8 pl-8"
          />
        </div>

        <Select value={activeCategoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger
            size="sm"
            className="w-44"
            aria-label={i18n._(
              t({
                id: "allocation.categoryFilter",
                message: "Filter by category",
              }),
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CATEGORY_ALL}>
              <Trans id="allocation.categoryAll">All categories</Trans>
            </SelectItem>
            <SelectItem value={CATEGORY_NONE}>
              <Trans id="allocation.categoryNone">Uncategorized</Trans>
            </SelectItem>
            {categoryOptions.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={radarFilter} onValueChange={setRadarFilter}>
          <SelectTrigger
            size="sm"
            className="w-36"
            aria-label={i18n._(
              t({
                id: "allocation.radarFilter",
                message: "Filter by investment status",
              }),
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={RADAR_ALL}>
              <Trans id="allocation.radarAll">All assets</Trans>
            </SelectItem>
            <SelectItem value={RADAR_ON}>
              <Trans id="allocation.radarOn">On radar</Trans>
            </SelectItem>
            <SelectItem value={RADAR_OFF}>
              <Trans id="allocation.radarOff">Invested</Trans>
            </SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 rounded-md border px-1 py-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={i18n._(
              t({
                id: "allocation.quartersBack",
                message: "Show earlier quarters",
              }),
            )}
            onClick={() => setQuarterEndKey(shiftQuarter(quarterEnd, -1).key)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="min-w-28 text-center text-xs text-muted-foreground tabular-nums">
            {formatQuarterLabel(quarters[0] ?? quarterEnd)} —{" "}
            {formatQuarterLabel(quarterEnd)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={i18n._(
              t({
                id: "allocation.quartersForward",
                message: "Show later quarters",
              }),
            )}
            onClick={() => setQuarterEndKey(shiftQuarter(quarterEnd, 1).key)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <Label htmlFor="allocation-quarter-count" className="sr-only">
          <Trans id="allocation.quarterCount">Quarters shown</Trans>
        </Label>
        <Select
          value={String(quarterCount)}
          onValueChange={(value) => {
            setQuarterCount(Number(value));
            storeValue(QUARTER_COUNT_KEY, value);
          }}
        >
          <SelectTrigger
            id="allocation-quarter-count"
            size="sm"
            className="w-32"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUARTER_COUNTS.map((count) => (
              <SelectItem key={count} value={String(count)}>
                <Trans id="allocation.quartersOption">{count} quarters</Trans>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              <Columns3 aria-hidden="true" />
              <Trans id="allocation.columns">Columns</Trans>
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <Trans id="allocation.presets">View presets</Trans>
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => applyPreset("compact")}>
              <Trans id="allocation.compact">Compact</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyPreset("standard")}>
              <Trans id="allocation.standard">Standard</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyPreset("all")}>
              <Trans id="allocation.all">All data</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <Trans id="allocation.customize">Customize columns</Trans>
            </DropdownMenuLabel>
            {ALLOCATION_COLUMNS.map((id) => (
              <DropdownMenuCheckboxItem
                key={id}
                checked={visibleColumns.has(id)}
                disabled={id === "ticker"}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggleColumn(id)}
              >
                {labels[id]}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => applyPreset("standard")}>
              <RotateCcw aria-hidden="true" />
              <Trans id="allocation.reset">Reset to standard</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="allocation-free-order" className="text-xs">
            <Trans id="allocation.freeOrder">Free order</Trans>
          </Label>
          <Switch
            id="allocation-free-order"
            checked={freeOrder}
            onCheckedChange={(checked) => {
              setFreeOrder(checked);
              storeValue(FREE_ORDER_KEY, String(checked));
            }}
          />
        </div>
      </div>

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
          onSaveReview={(input) => upsertReview.mutate(input)}
          onRemoveReview={(input) => removeReview.mutate(input)}
          missing={allocation.data.quotes.missing}
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
