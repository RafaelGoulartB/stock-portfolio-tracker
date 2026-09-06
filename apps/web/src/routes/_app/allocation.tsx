import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AllocationRow } from "@portifolio-tracker/shared";
import {
  fairValueSchema,
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
import { type ReactNode, useMemo, useState } from "react";
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
} from "@/components/allocation/allocation-table";
import { ContributionPlannerButton } from "@/components/allocation/contribution-planner";
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

export const Route = createFileRoute("/_app/allocation")({
  component: AllocationPage,
});

const FREE_ORDER_KEY = "portfolio.allocation.freeOrder";
const QUARTER_COUNT_KEY = "portfolio.allocation.quarters";
const QUARTER_COUNTS = [3, 5, 8] as const;
const DEFAULT_QUARTER_COUNT = 5;
const COLUMN_STORAGE_KEY = "portfolio.allocation.columns";

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

  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );

  const allocation = trpc.allocation.list.useQuery({
    displayCurrency,
    usdBrlRate: fx.effectiveRate,
    quoteSource,
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  });

  const waitingForRate =
    !!allocation.error && isFxRateRequired(allocation.error) && fx.isPending;
  const fxFailed =
    !!allocation.error &&
    isFxRateRequired(allocation.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;

  async function refresh() {
    await utils.allocation.list.invalidate();
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

  const saving =
    upsertAsset.isPending ||
    removeAsset.isPending ||
    reorder.isPending ||
    upsertReview.isPending ||
    removeReview.isPending;

  const allRows = allocation.data?.rows ?? [];
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(i18n.locale);
    const filtered = needle
      ? allRows.filter((row) =>
          row.ticker.toLocaleLowerCase(i18n.locale).includes(needle),
        )
      : [...allRows];

    // Free order keeps the stored rank the API already sorted by.
    return freeOrder
      ? filtered
      : filtered.sort((a, b) => compareRows(a, b, sort));
  }, [allRows, search, sort, freeOrder, i18n.locale]);

  const quarterEnd = quarterEndKey
    ? toQuarter(quarterEndKey)
    : defaultQuarterEnd(allRows);
  const quarters = quarterWindow(quarterEnd, quarterCount);
  const labels = columnLabels(i18n);

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

  function editFairValue(ticker: string, text: string) {
    if (text.trim().length === 0) {
      upsertAsset.mutate({ ticker, fairValue: null });

      return;
    }

    const parsed = parseDecimalInput(text);

    if (parsed === null || !fairValueSchema.safeParse(parsed).success) {
      toast.error(
        i18n._(
          msg({
            id: "allocation.invalidFairValue",
            message: "Enter a positive fair value, e.g. 45,50",
          }),
        ),
      );

      return;
    }

    upsertAsset.mutate({ ticker, fairValue: parsed });
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
    <div className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 space-y-4 px-3 sm:px-4 lg:px-6">
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
          summary={allocation.data.summary}
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
          onEditFairValue={editFairValue}
          onClearAnalysis={(ticker) =>
            upsertAsset.mutate({
              ticker,
              targetWeight: null,
              fairValue: null,
              valuationRef: null,
            })
          }
          onRemoveAsset={(row) => removeAsset.mutate({ ticker: row.ticker })}
          onSaveReview={(input) => upsertReview.mutate(input)}
          onRemoveReview={(input) => removeReview.mutate(input)}
          missing={allocation.data.quotes.missing}
          saving={saving}
        />
      ) : null}

      {allocation.data ? (
        <p className="text-xs text-muted-foreground">
          <Trans id="allocation.footnote">
            {allocation.data.summary.investedAssets} invested ·{" "}
            {allocation.data.summary.watchOnlyAssets} watch-only ·{" "}
            {allocation.data.summary.candidates} taking contributions ·{" "}
            {allocation.data.summary.blocked} blocked · score rules{" "}
            {allocation.data.summary.scoreVersion}
          </Trans>
        </p>
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
