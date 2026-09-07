import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  DEEP_FINDER_WINDOWS,
  DEFAULT_DEEP_FINDER_WINDOW,
  type DeepFinderWindow,
  positiveDecimal,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, ScanSearch } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLogo } from "@/components/asset-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type RouterOutputs, trpc } from "@/lib/api";
import {
  formatMoney,
  formatSignedMoney,
  formatSignedPercent,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/deep-finder")({
  component: DeepFinderPage,
});

type FinderData = RouterOutputs["positions"]["finder"];
type FinderRow = FinderData["positions"][number];
type Breadth = "all" | "up" | "down";

type ChartDatum = {
  ticker: string;
  value: number;
  display: string;
  percentLabel: string | null;
};

function DeepFinderPage() {
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const fx = useFxQuote();
  const [window, setWindow] = useState<DeepFinderWindow>(
    DEFAULT_DEEP_FINDER_WINDOW,
  );
  const [breadth, setBreadth] = useState<Breadth>("all");
  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );
  const finder = trpc.positions.finder.useQuery({
    displayCurrency,
    usdBrlRate: fx.effectiveRate,
    quoteSource,
    window,
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  });
  const waitingForRate =
    !!finder.error && isFxRateRequired(finder.error) && fx.isPending;
  const fxFailed =
    !!finder.error &&
    isFxRateRequired(finder.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          <Trans id="deepFinder.title">Deep Finder</Trans>
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          <Trans id="deepFinder.subtitle">
            See which open holdings are rising or falling over a period. Cost is
            the open result versus the moving average; the other windows compare
            today's book to a past close.
          </Trans>
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {DEEP_FINDER_WINDOWS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={window === id ? "default" : "outline"}
            aria-pressed={window === id}
            onClick={() => setWindow(id)}
          >
            {windowLabel(id)}
          </Button>
        ))}
      </div>

      {finder.isPending || waitingForRate ? <FinderSkeleton /> : null}

      {fxFailed ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            <Trans id="deepFinder.fxFailed">
              Could not fetch the exchange rate. Try another source or enter it
              manually.
            </Trans>
          </CardContent>
        </Card>
      ) : null}

      {finder.error && !waitingForRate && !fxFailed ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {queryErrorMessage(finder.error)}
          </CardContent>
        </Card>
      ) : null}

      {finder.data ? (
        finder.data.positions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <ScanSearch className="size-8" aria-hidden="true" />
              <Trans id="deepFinder.empty">
                Register a trade to start ranking open holdings.
              </Trans>
            </CardContent>
          </Card>
        ) : (
          <>
            <SummaryStrip data={finder.data} />
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={breadth === "all" ? "secondary" : "ghost"}
                aria-pressed={breadth === "all"}
                onClick={() => setBreadth("all")}
              >
                <Trans id="deepFinder.filterAll">All</Trans>
              </Button>
              <Button
                type="button"
                size="sm"
                variant={breadth === "up" ? "secondary" : "ghost"}
                aria-pressed={breadth === "up"}
                onClick={() => setBreadth("up")}
              >
                <ArrowUp className="size-3.5" aria-hidden="true" />
                <Trans id="deepFinder.filterUp">Rising</Trans>
              </Button>
              <Button
                type="button"
                size="sm"
                variant={breadth === "down" ? "secondary" : "ghost"}
                aria-pressed={breadth === "down"}
                onClick={() => setBreadth("down")}
              >
                <ArrowDown className="size-3.5" aria-hidden="true" />
                <Trans id="deepFinder.filterDown">Falling</Trans>
              </Button>
            </div>
            <ResultChart
              rows={filterRows(finder.data.positions, breadth)}
              currency={finder.data.summary.displayCurrency}
              window={finder.data.window}
            />
            <ResultTable
              rows={filterRows(finder.data.positions, breadth)}
              currency={finder.data.summary.displayCurrency}
              missing={finder.data.quotes.missing}
            />
          </>
        )
      ) : null}
    </div>
  );
}

function windowLabel(window: DeepFinderWindow): ReactNode {
  switch (window) {
    case "cost":
      return <Trans id="deepFinder.windowCost">Vs cost</Trans>;
    case "1d":
      return <Trans id="deepFinder.window1d">1 day</Trans>;
    case "1w":
      return <Trans id="deepFinder.window1w">1 week</Trans>;
    case "1m":
      return <Trans id="deepFinder.window1m">1 month</Trans>;
    case "3m":
      return <Trans id="deepFinder.window3m">3 months</Trans>;
    case "ytd":
      return <Trans id="deepFinder.windowYtd">YTD</Trans>;
    case "1y":
      return <Trans id="deepFinder.window1y">1 year</Trans>;
  }
}

function filterRows(rows: FinderRow[], breadth: Breadth): FinderRow[] {
  if (breadth === "all") {
    return rows;
  }

  return rows.filter((row) => {
    if (row.changePercent == null) {
      return false;
    }

    const change = Number(row.changePercent);

    return breadth === "up" ? change > 0 : change < 0;
  });
}

function signedOrZero(
  value: string,
  currency: FinderData["summary"]["displayCurrency"],
): string {
  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}

function SummaryStrip({ data }: { data: FinderData }) {
  const { summary, windowStart, window } = data;
  const hasComparison = summary.comparable > 0;
  const startLabel = windowStart ? formatTradeDate(windowStart) : null;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-4">
          <p className="text-xs font-medium text-muted-foreground">
            <Trans id="deepFinder.periodMove">Period move</Trans>
          </p>
          <p
            className={cn(
              "mt-1.5 text-xl font-semibold tabular-nums",
              hasComparison ? pnlClassName(summary.totalChange) : "",
            )}
          >
            {hasComparison
              ? signedOrZero(summary.totalChange, summary.displayCurrency)
              : "—"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {summary.totalChangePercent ? (
              <span className={pnlClassName(summary.totalChange)}>
                {formatSignedPercent(summary.totalChangePercent)}
              </span>
            ) : window === "cost" ? (
              <Trans id="deepFinder.costHint">
                Market value versus moving average cost.
              </Trans>
            ) : (
              <Trans id="deepFinder.periodHint">
                Compared with the close on or before {startLabel}.
              </Trans>
            )}
          </p>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs font-medium text-muted-foreground">
            <Trans id="deepFinder.breadth">Breadth</Trans>
          </p>
          <p className="mt-1.5 text-xl font-semibold tabular-nums">
            {summary.advancing} ↑ {summary.declining} ↓
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t({
              id: "deepFinder.breadthHint",
              message: plural(
                { count: summary.comparable },
                {
                  one: "# holding with a comparable quote",
                  other: "# holdings with a comparable quote",
                },
              ),
            })}
          </p>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs font-medium text-muted-foreground">
            <Trans id="deepFinder.window">Window</Trans>
          </p>
          <p className="mt-1.5 text-xl font-semibold">{windowLabel(window)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {window === "cost" ? (
              <Trans id="deepFinder.windowCostMeta">Open result vs cost</Trans>
            ) : (
              <Trans id="deepFinder.windowSince">Since {startLabel}</Trans>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

function ResultChart({
  rows,
  currency,
  window,
}: {
  rows: FinderRow[];
  currency: FinderRow["displayCurrency"];
  window: DeepFinderWindow;
}) {
  const charted = rows.filter((row) => row.changePercent !== null);
  const data: ChartDatum[] = charted.map((row) => ({
    ticker: row.ticker,
    value: Number(row.changePercent ?? 0),
    display: signedOrZero(row.change ?? "0", currency),
    percentLabel:
      row.changePercent == null ? null : formatSignedPercent(row.changePercent),
  }));
  const bound = {
    min: Math.min(0, ...data.map((row) => row.value)) * 1.12,
    max: Math.max(0, ...data.map((row) => row.value)) * 1.12,
  };
  const height = Math.max(280, data.length * 28);
  const chartConfig: ChartConfig = {
    value: {
      label: t({ id: "deepFinder.periodMove", message: "Period move" }),
    },
  };

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          <Trans id="deepFinder.noMatches">
            No holdings match this filter for the selected window.
          </Trans>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="deepFinder.chartTitle">Open result by asset</Trans>
        </CardTitle>
        <CardDescription>
          {window === "cost" ? (
            <Trans id="deepFinder.chartCostHint">
              Every open ticker, ranked by open result percent.
            </Trans>
          ) : (
            <Trans id="deepFinder.chartPeriodHint">
              Percent move of the current book over the selected window.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="aspect-auto w-full"
          style={{ height }}
        >
          <BarChart
            accessibilityLayer
            data={data}
            layout="vertical"
            margin={{ left: 0, right: 16, top: 4, bottom: 0 }}
            barCategoryGap={8}
          >
            <XAxis
              type="number"
              domain={[bound.min, bound.max]}
              tickLine={false}
              axisLine={false}
              tickCount={5}
              tickFormatter={(value: number) =>
                formatSignedPercent(String(value))
              }
            />
            <YAxis
              type="category"
              dataKey="ticker"
              width={76}
              interval={0}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
            />
            <ReferenceLine x={0} stroke="var(--border)" />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
              content={
                <ChartTooltipContent
                  formatter={(_value, _name, item) => {
                    const row = item.payload as ChartDatum | undefined;

                    if (!row) {
                      return null;
                    }

                    return (
                      <div className="flex w-full items-center gap-3">
                        <span className="font-medium">{row.ticker}</span>
                        {row.percentLabel ? (
                          <span
                            className={`ml-auto font-medium tabular-nums ${pnlClassName(String(row.value))}`}
                          >
                            {row.percentLabel}
                          </span>
                        ) : null}
                        <span className="text-muted-foreground tabular-nums">
                          {row.display}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            <Bar dataKey="value" radius={3} maxBarSize={18}>
              {data.map((row) => (
                <Cell
                  key={row.ticker}
                  fill={row.value < 0 ? "var(--loss)" : "var(--gain)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

type TableSortKey = "ticker" | "class" | "value" | "percent" | "change";
type SortDirection = "asc" | "desc";

function SortHeaderButton({
  label,
  align = "left",
  active,
  direction,
  onToggle,
}: {
  label: ReactNode;
  align?: "left" | "right";
  active: boolean;
  direction: SortDirection;
  onToggle: () => void;
}) {
  const Icon = !active
    ? ArrowUpDown
    : direction === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground ${
        align === "right" ? "flex-row-reverse" : ""
      } ${active ? "text-foreground" : ""}`}
    >
      {label}
      <Icon
        className={`size-3.5 shrink-0 transition-opacity ${
          active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}

function ariaSort(
  active: boolean,
  direction: SortDirection,
): "ascending" | "descending" | "none" {
  if (!active) {
    return "none";
  }

  return direction === "asc" ? "ascending" : "descending";
}

function ResultTable({
  rows,
  currency,
  missing,
}: {
  rows: FinderRow[];
  currency: FinderRow["displayCurrency"];
  missing: string[];
}) {
  const { i18n } = useLingui();
  const missingSet = new Set(missing);
  const [sortKey, setSortKey] = useState<TableSortKey>("percent");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const sorted = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;

    const metric = (row: FinderRow): number | null => {
      if (sortKey === "value") {
        return row.marketValue == null ? null : Number(row.marketValue);
      }

      if (sortKey === "change") {
        return row.change == null ? null : Number(row.change);
      }

      return row.changePercent == null ? null : Number(row.changePercent);
    };

    return [...rows].sort((a, b) => {
      if (sortKey === "ticker") {
        return direction * a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      if (sortKey === "class") {
        const byClass = a.assetClass.localeCompare(b.assetClass, i18n.locale);

        if (byClass !== 0) {
          return direction * byClass;
        }

        return a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      const left = metric(a);
      const right = metric(b);

      if (left == null || right == null) {
        if (left == null && right == null) {
          return a.ticker.localeCompare(b.ticker, i18n.locale);
        }

        return left == null ? 1 : -1;
      }

      if (left === right) {
        return a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      return direction * (left - right);
    });
  }, [i18n.locale, rows, sortDir, sortKey]);

  function toggleSort(key: TableSortKey) {
    if (key === sortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));

      return;
    }

    setSortKey(key);
    setSortDir(key === "ticker" || key === "class" ? "asc" : "desc");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="deepFinder.tableTitle">Holdings</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="deepFinder.tableHint">
            Click a column to sort. Missing quotes sit at the bottom.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className="text-muted-foreground"
                aria-sort={ariaSort(sortKey === "ticker", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="deepFinder.colTicker">Ticker</Trans>}
                  active={sortKey === "ticker"}
                  direction={sortDir}
                  onToggle={() => toggleSort("ticker")}
                />
              </TableHead>
              <TableHead
                className="hidden text-muted-foreground sm:table-cell"
                aria-sort={ariaSort(sortKey === "class", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="deepFinder.colClass">Class</Trans>}
                  active={sortKey === "class"}
                  direction={sortDir}
                  onToggle={() => toggleSort("class")}
                />
              </TableHead>
              <TableHead
                className="text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "value", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="deepFinder.colValue">Value</Trans>}
                  align="right"
                  active={sortKey === "value"}
                  direction={sortDir}
                  onToggle={() => toggleSort("value")}
                />
              </TableHead>
              <TableHead
                className="text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "percent", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="deepFinder.colPercent">%</Trans>}
                  align="right"
                  active={sortKey === "percent"}
                  direction={sortDir}
                  onToggle={() => toggleSort("percent")}
                />
              </TableHead>
              <TableHead
                className="text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "change", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="deepFinder.colChange">Change</Trans>}
                  align="right"
                  active={sortKey === "change"}
                  direction={sortDir}
                  onToggle={() => toggleSort("change")}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.ticker}>
                <TableCell className="font-medium">
                  <div className="flex flex-wrap items-center gap-2">
                    <AssetLogo
                      ticker={row.ticker}
                      assetClass={row.assetClass}
                      currency={row.currency}
                    />
                    {row.ticker}
                    {missingSet.has(row.ticker) ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        <Trans id="deepFinder.unquoted">No quote</Trans>
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <AssetClassLabel assetClass={row.assetClass} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.marketValue
                    ? formatMoney(row.marketValue, currency)
                    : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    row.changePercent ? pnlClassName(row.changePercent) : "",
                  )}
                >
                  {row.changePercent
                    ? formatSignedPercent(row.changePercent)
                    : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    row.change ? pnlClassName(row.change) : "",
                  )}
                >
                  {row.change ? signedOrZero(row.change, currency) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            <Trans id="deepFinder.noMatches">
              No holdings match this filter for the selected window.
            </Trans>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FinderSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28" />
      <Skeleton className="h-80" />
    </div>
  );
}
