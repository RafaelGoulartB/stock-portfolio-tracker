import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  positiveDecimal,
  type ValuedPosition,
} from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Columns3,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/api";
import {
  formatMoney,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
  formatTradeDate,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { formatMonthLabel, lastTwelveMonths } from "@/lib/months";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/detailed-positions")({
  component: DetailedPositionsPage,
});

const COLUMN_STORAGE_KEY = "portfolio.detailedPositions.columns";

const COLUMN_IDS = [
  "ticker",
  "assetClass",
  "currency",
  "quantity",
  "averagePrice",
  "investedCost",
  "marketPrice",
  "marketValue",
  "unrealizedPnl",
  "unrealizedPnlPercent",
  "weight",
  "realizedPnl",
  "transactionCount",
  "lastTradedAt",
  "quoteAsOf",
] as const;

type ColumnId = (typeof COLUMN_IDS)[number];
type SortDirection = "asc" | "desc";

const PRESETS: Record<"compact" | "standard" | "all", ColumnId[]> = {
  compact: [
    "ticker",
    "quantity",
    "averagePrice",
    "marketPrice",
    "marketValue",
    "unrealizedPnl",
  ],
  standard: [
    "ticker",
    "assetClass",
    "currency",
    "quantity",
    "averagePrice",
    "investedCost",
    "marketPrice",
    "marketValue",
    "unrealizedPnl",
    "unrealizedPnlPercent",
    "weight",
    "lastTradedAt",
  ],
  all: [...COLUMN_IDS],
};

function initialColumns(): Set<ColumnId> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(COLUMN_STORAGE_KEY) ?? "null",
    );
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((value): value is ColumnId =>
        COLUMN_IDS.includes(value as ColumnId),
      );
      if (valid.includes("ticker")) return new Set(valid);
    }
  } catch {
    // Storage is only a convenience; the standard preset remains available.
  }
  return new Set(PRESETS.standard);
}

function DetailedPositionsPage() {
  const { i18n } = useLingui();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const months = useMemo(() => lastTwelveMonths(), []);
  const [monthKey, setMonthKey] = useState(months[0]?.key ?? "");
  const [search, setSearch] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [visibleColumns, setVisibleColumns] =
    useState<Set<ColumnId>>(initialColumns);
  const [sort, setSort] = useState<{ id: ColumnId; direction: SortDirection }>({
    id: "marketValue",
    direction: "desc",
  });
  const selected = months.find((month) => month.key === monthKey) ?? months[0];
  const fx = useFxQuote(selected?.asOf);

  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );

  const positions = trpc.positions.list.useQuery({
    displayCurrency,
    usdBrlRate: fx.effectiveRate,
    asOf: selected?.asOf ?? undefined,
    quoteSource,
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  });

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
      if (!showClosed && Number(position.quantity) === 0) return false;
      if (!needle) return true;
      return `${position.ticker} ${position.assetClass} ${position.currency}`
        .toLocaleLowerCase(i18n.locale)
        .includes(needle);
    });
    return filtered.sort((a, b) =>
      comparePositions(a, b, sort.id, sort.direction),
    );
  }, [positions.data, search, showClosed, sort, i18n.locale]);

  function updateColumns(next: Set<ColumnId>) {
    setVisibleColumns(next);
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // The preference still applies for the current session.
    }
  }

  function applyPreset(preset: keyof typeof PRESETS) {
    updateColumns(new Set(PRESETS[preset]));
  }

  function toggleColumn(id: ColumnId) {
    if (id === "ticker") return;
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateColumns(next);
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
    <div className="space-y-5">
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
          <Button asChild size="sm">
            <Link to="/transactions">
              <Plus aria-hidden="true" />
              <Trans id="positions.registerTrade">Register a trade</Trans>
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={i18n._(
              t({
                id: "detailedPositions.searchLabel",
                message: "Search detailed positions",
              }),
            )}
            placeholder={i18n._(
              t({
                id: "detailedPositions.search",
                message: "Search ticker or class…",
              }),
            )}
            className="h-8 pl-8"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant={showClosed ? "secondary" : "outline"}
          aria-pressed={showClosed}
          onClick={() => setShowClosed((current) => !current)}
        >
          <Trans id="detailedPositions.showClosed">Show closed positions</Trans>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
            >
              <Columns3 aria-hidden="true" />
              <Trans id="detailedPositions.columns">Columns</Trans>
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <Trans id="detailedPositions.presets">View presets</Trans>
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => applyPreset("compact")}>
              <Trans id="detailedPositions.compact">Compact</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyPreset("standard")}>
              <Trans id="detailedPositions.standard">Standard</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyPreset("all")}>
              <Trans id="detailedPositions.all">All data</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <Trans id="detailedPositions.customize">Customize columns</Trans>
            </DropdownMenuLabel>
            {COLUMN_IDS.map((id) => (
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
              <Trans id="detailedPositions.reset">Reset to standard</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
          missing={positions.data.quotes.missing}
        />
      ) : null}
    </div>
  );
}

function columnLabels(i18n: I18n): Record<ColumnId, string> {
  return {
    ticker: i18n._(t({ id: "detailedPositions.colTicker", message: "Ticker" })),
    assetClass: i18n._(
      t({
        id: "detailedPositions.colClass",
        message: "Class",
      }),
    ),
    currency: i18n._(
      t({
        id: "detailedPositions.colCurrency",
        message: "Currency",
      }),
    ),
    quantity: i18n._(
      t({
        id: "detailedPositions.colQuantity",
        message: "Quantity",
      }),
    ),
    averagePrice: i18n._(
      t({
        id: "detailedPositions.colAvgPrice",
        message: "Avg. cost",
      }),
    ),
    investedCost: i18n._(
      t({
        id: "detailedPositions.colInvested",
        message: "Invested",
      }),
    ),
    marketPrice: i18n._(
      t({
        id: "detailedPositions.colPrice",
        message: "Market price",
      }),
    ),
    marketValue: i18n._(
      t({
        id: "detailedPositions.colValue",
        message: "Market value",
      }),
    ),
    unrealizedPnl: i18n._(
      t({
        id: "detailedPositions.colOpenResult",
        message: "Open result",
      }),
    ),
    unrealizedPnlPercent: i18n._(
      t({
        id: "detailedPositions.colReturn",
        message: "Return",
      }),
    ),
    weight: i18n._(
      t({
        id: "detailedPositions.colWeight",
        message: "Portfolio share",
      }),
    ),
    realizedPnl: i18n._(
      t({
        id: "detailedPositions.colRealized",
        message: "Realized P&L",
      }),
    ),
    transactionCount: i18n._(
      t({
        id: "detailedPositions.colTrades",
        message: "Trades",
      }),
    ),
    lastTradedAt: i18n._(
      t({
        id: "detailedPositions.colLastTrade",
        message: "Last trade",
      }),
    ),
    quoteAsOf: i18n._(
      t({
        id: "detailedPositions.colQuoteDate",
        message: "Quote date",
      }),
    ),
  };
}

function PositionsTable({
  rows,
  visibleColumns,
  labels,
  sort,
  onSort,
  displayCurrency,
  missing,
}: {
  rows: ValuedPosition[];
  visibleColumns: Set<ColumnId>;
  labels: Record<ColumnId, string>;
  sort: { id: ColumnId; direction: SortDirection };
  onSort: (id: ColumnId) => void;
  displayCurrency: "BRL" | "USD";
  missing: string[];
}) {
  const columns = COLUMN_IDS.filter((id) => visibleColumns.has(id));
  const openRows = rows.filter((position) => Number(position.quantity) > 0);
  const totals = {
    invested: openRows
      .reduce((sum, row) => sum + Number(row.convertedInvestedCost), 0)
      .toFixed(2),
    market: openRows
      .reduce((sum, row) => sum + Number(row.convertedMarketValue ?? 0), 0)
      .toFixed(2),
    unrealized: openRows
      .reduce((sum, row) => sum + Number(row.convertedUnrealizedPnl ?? 0), 0)
      .toFixed(2),
    realized: rows
      .reduce((sum, row) => sum + Number(row.convertedRealizedPnl), 0)
      .toFixed(2),
  };

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <Table className="text-xs">
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              {columns.map((id) => (
                <TableHead
                  key={id}
                  className={`${id === "ticker" ? "sticky left-0 z-10 bg-muted" : ""} h-9 px-3`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(id)}
                    className="flex w-full items-center gap-1 text-left font-medium"
                    aria-label={`${labels[id]}. Sort`}
                  >
                    {labels[id]}
                    {sort.id === id ? (
                      sort.direction === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3 opacity-40" />
                    )}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((position) => (
              <TableRow
                key={`${position.ticker}|${position.currency}`}
                className="h-10"
              >
                {columns.map((id) => (
                  <PositionCell
                    key={id}
                    id={id}
                    position={position}
                    missing={missing.includes(position.ticker)}
                  />
                ))}
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-28 text-center text-sm text-muted-foreground"
                >
                  <Trans id="detailedPositions.empty">
                    No positions match these filters.
                  </Trans>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          {rows.length > 0 ? (
            <TableFooter>
              <TableRow>
                {columns.map((id, index) => (
                  <TableCell
                    key={id}
                    className="px-3 py-2 text-right tabular-nums"
                  >
                    {index === 0 ? (
                      <span className="block text-left">
                        <Trans id="positions.total">Total</Trans>
                      </span>
                    ) : (
                      totalForColumn(id, totals, displayCurrency)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </CardContent>
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        <Trans id="detailedPositions.rowCount">
          {rows.length} positions · {columns.length} columns
        </Trans>
      </div>
    </Card>
  );
}

function PositionCell({
  id,
  position,
  missing,
}: {
  id: ColumnId;
  position: ValuedPosition;
  missing: boolean;
}) {
  let content: ReactNode;
  switch (id) {
    case "ticker":
      content = (
        <AssetLink
          ticker={position.ticker}
          className="flex items-center gap-2 font-semibold"
        >
          <AssetLogo
            ticker={position.ticker}
            assetClass={position.assetClass}
            currency={position.currency}
          />
          {position.ticker}
        </AssetLink>
      );
      break;
    case "assetClass":
      content = <AssetClassLabel assetClass={position.assetClass} />;
      break;
    case "currency":
      content = position.currency;
      break;
    case "quantity":
      content = formatQuantity(position.quantity);
      break;
    case "averagePrice":
      content = formatMoney(position.averagePrice, position.currency);
      break;
    case "investedCost":
      content = formatMoney(
        position.convertedInvestedCost,
        position.displayCurrency,
      );
      break;
    case "marketPrice":
      content =
        position.marketPrice == null ? (
          <Dash missing={missing} />
        ) : (
          formatMoney(position.marketPrice, position.currency)
        );
      break;
    case "marketValue":
      content =
        position.convertedMarketValue == null ? (
          <Dash missing={missing} />
        ) : (
          formatMoney(position.convertedMarketValue, position.displayCurrency)
        );
      break;
    case "unrealizedPnl":
      content =
        position.convertedUnrealizedPnl == null ? (
          <Dash missing={missing} />
        ) : (
          <span className={pnlClassName(position.convertedUnrealizedPnl)}>
            {formatSignedMoney(
              position.convertedUnrealizedPnl,
              position.displayCurrency,
            )}
          </span>
        );
      break;
    case "unrealizedPnlPercent":
      content =
        position.unrealizedPnlPercent == null ? (
          <Dash missing={missing} />
        ) : (
          <span className={pnlClassName(position.unrealizedPnlPercent)}>
            {formatSignedPercent(position.unrealizedPnlPercent)}
          </span>
        );
      break;
    case "weight":
      content =
        position.weight == null ? (
          <Dash missing={missing} />
        ) : (
          formatWeight(position.weight)
        );
      break;
    case "realizedPnl":
      content = (
        <span className={pnlClassName(position.convertedRealizedPnl)}>
          {formatSignedMoney(
            position.convertedRealizedPnl,
            position.displayCurrency,
          )}
        </span>
      );
      break;
    case "transactionCount":
      content = position.transactionCount;
      break;
    case "lastTradedAt":
      content = formatTradeDate(position.lastTradedAt);
      break;
    case "quoteAsOf":
      content = position.quoteAsOf ? (
        formatTradeDate(position.quoteAsOf)
      ) : (
        <Dash missing={missing} />
      );
      break;
  }
  return (
    <TableCell
      className={`${id === "ticker" ? "sticky left-0 z-10 bg-card text-left" : "text-right"} px-3 py-2 tabular-nums`}
    >
      {content}
    </TableCell>
  );
}

function Dash({ missing = false }: { missing?: boolean }) {
  return (
    <span
      className={
        missing ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
      }
      title={missing ? "Market quote unavailable" : undefined}
    >
      —
    </span>
  );
}

function totalForColumn(
  id: ColumnId,
  totals: {
    invested: string;
    market: string;
    unrealized: string;
    realized: string;
  },
  currency: "BRL" | "USD",
) {
  if (id === "investedCost") return formatMoney(totals.invested, currency);
  if (id === "marketValue") return formatMoney(totals.market, currency);
  if (id === "unrealizedPnl")
    return (
      <span className={pnlClassName(totals.unrealized)}>
        {formatSignedMoney(totals.unrealized, currency)}
      </span>
    );
  if (id === "realizedPnl")
    return (
      <span className={pnlClassName(totals.realized)}>
        {formatSignedMoney(totals.realized, currency)}
      </span>
    );
  if (id === "weight") return formatWeight("1");
  return null;
}

function comparePositions(
  a: ValuedPosition,
  b: ValuedPosition,
  id: ColumnId,
  direction: SortDirection,
) {
  const left = sortableValue(a, id);
  const right = sortableValue(b, id);
  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left ?? "").localeCompare(String(right ?? ""));
  return direction === "asc" ? result : -result;
}

function sortableValue(
  position: ValuedPosition,
  id: ColumnId,
): string | number | null {
  switch (id) {
    case "ticker":
      return position.ticker;
    case "assetClass":
      return position.assetClass;
    case "currency":
      return position.currency;
    case "quantity":
      return Number(position.quantity);
    case "averagePrice":
      return Number(position.averagePrice);
    case "investedCost":
      return Number(position.convertedInvestedCost);
    case "marketPrice":
      return position.marketPrice == null ? null : Number(position.marketPrice);
    case "marketValue":
      return position.convertedMarketValue == null
        ? null
        : Number(position.convertedMarketValue);
    case "unrealizedPnl":
      return position.convertedUnrealizedPnl == null
        ? null
        : Number(position.convertedUnrealizedPnl);
    case "unrealizedPnlPercent":
      return position.unrealizedPnlPercent == null
        ? null
        : Number(position.unrealizedPnlPercent);
    case "weight":
      return position.weight == null ? null : Number(position.weight);
    case "realizedPnl":
      return Number(position.convertedRealizedPnl);
    case "transactionCount":
      return position.transactionCount;
    case "lastTradedAt":
      return position.lastTradedAt;
    case "quoteAsOf":
      return position.quoteAsOf;
  }
}

function MonthSelector({
  months,
  selectedKey,
  onSelect,
  locale,
}: {
  months: ReturnType<typeof lastTwelveMonths>;
  selectedKey: string;
  onSelect: (key: string) => void;
  locale: string;
}) {
  return (
    <>
      <Label htmlFor="detailed-positions-month" className="sr-only">
        <Trans id="positions.month">Snapshot month</Trans>
      </Label>
      <Select value={selectedKey} onValueChange={onSelect}>
        <SelectTrigger
          id="detailed-positions-month"
          size="sm"
          className="w-[168px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((month) => (
            <SelectItem key={month.key} value={month.key}>
              {month.current ? (
                <Trans id="positions.currentMonth">
                  {formatMonthLabel(month, locale)} · Live
                </Trans>
              ) : (
                formatMonthLabel(month, locale)
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
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
