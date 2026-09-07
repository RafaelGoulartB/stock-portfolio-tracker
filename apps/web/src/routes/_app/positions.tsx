import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  type AssetClass,
  type Currency,
  type PortfolioSummary,
  positiveDecimal,
  type ValuedPosition,
} from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Plus,
  ScanSearch,
  Wallet,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Cell, Pie, PieChart, Sector } from "recharts";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLogo } from "@/components/asset-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/positions")({
  component: PositionsPage,
});

/** Categorical palette, assigned by market value so the ranking is stable. */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
];

const UNQUOTED_COLOR = "var(--muted-foreground)";

function PositionsPage() {
  // Subscribes this page to locale changes; amounts and dates below are
  // rendered with `Intl` using the active locale.
  const { i18n } = useLingui();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const months = useMemo(() => lastTwelveMonths(), []);
  const [monthKey, setMonthKey] = useState(months[0]?.key ?? "");
  const selected = months.find((month) => month.key === monthKey) ?? months[0];

  const fx = useFxQuote(selected?.asOf);

  // Manual prices are raw user input; only valid decimals travel to the API.
  const sanitizedManualPrices = useMemo(() => {
    const entries = Object.entries(manualPrices).filter(
      ([, price]) => positiveDecimal.safeParse(price).success,
    );

    return Object.fromEntries(entries);
  }, [manualPrices]);

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

  // The portfolio cannot consolidate mixed currencies until the quote
  // arrives; keep the skeleton instead of flashing a rate error.
  const waitingForRate =
    !!positions.error && isFxRateRequired(positions.error) && fx.isPending;
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

  /** One color per ticker, shared by the donut, the legend and the table. */
  const colorByTicker = useMemo(() => {
    const quoted = open
      .filter((position) => position.convertedMarketValue != null)
      .sort(
        (a, b) =>
          Number(b.convertedMarketValue ?? 0) -
          Number(a.convertedMarketValue ?? 0),
      );

    return new Map(
      quoted.map((position, index) => [
        position.ticker,
        CHART_COLORS[index % CHART_COLORS.length],
      ]),
    );
  }, [open]);

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
          <Button asChild size="sm">
            <Link to="/transactions">
              <Plus className="size-4" aria-hidden="true" />
              <Trans id="positions.registerTrade">Register a trade</Trans>
            </Link>
          </Button>
        </div>
      </header>

      {positions.isPending || waitingForRate ? <PositionsSkeleton /> : null}

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

      {positions.error && !waitingForRate && !fxFailed ? (
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
              <div className="grid gap-5 lg:grid-cols-5">
                <AllocationCard
                  className="h-full lg:col-span-3"
                  positions={open}
                  summary={data.summary}
                  colorByTicker={colorByTicker}
                  snapshotLabel={snapshotLabel}
                />
                <DeepFinderTeaser
                  className="h-full lg:col-span-2"
                  positions={open}
                  summary={data.summary}
                />
              </div>

              <HoldingsCard
                positions={open}
                summary={data.summary}
                colorByTicker={colorByTicker}
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
      <Label htmlFor="positions-month" className="sr-only">
        <Trans id="positions.month">Snapshot month</Trans>
      </Label>
      <Select value={selectedKey} onValueChange={onSelect}>
        <SelectTrigger
          id="positions-month"
          size="sm"
          className="w-full max-w-[168px] sm:w-[168px]"
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

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

/** One cell of the summary strip. Every cell keeps the same three lines. */
function Metric({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: ReactNode;
  value: string;
  valueClassName?: string;
  hint: ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1.5 text-xl font-semibold tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {hint}
      </p>
    </div>
  );
}

function SummaryStrip({
  summary,
  snapshotLabel,
}: {
  summary: PortfolioSummary;
  snapshotLabel: string;
}) {
  useLingui();

  const breakdown = summary.totalsByCurrency
    .map((total) => formatMoney(total.investedCost, total.currency))
    .join(" + ");

  const meta = [
    t({
      id: "positions.openCount",
      message: plural(
        { count: summary.openPositions },
        { one: "# open position", other: "# open positions" },
      ),
    }),
    summary.closedPositions > 0
      ? t({
          id: "positions.closedCount",
          message: plural(
            { count: summary.closedPositions },
            { one: "# closed position", other: "# closed positions" },
          ),
        })
      : null,
    summary.unquotedPositions > 0
      ? t({
          id: "positions.unquotedCount",
          message: plural(
            { count: summary.unquotedPositions },
            { one: "# without a quote", other: "# without a quote" },
          ),
        })
      : null,
    summary.usdBrlRate
      ? `1 USD = ${formatQuantity(summary.usdBrlRate)} BRL`
      : null,
    breakdown ? nativeTotalsLabel(breakdown) : null,
  ].filter((entry): entry is string => entry != null);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid divide-y sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
        <Metric
          label={<Trans id="positions.marketValue">Market value</Trans>}
          value={formatMoney(summary.totalMarketValue, summary.displayCurrency)}
          hint={
            <Trans id="positions.marketValueHint">
              Quoted equity at {snapshotLabel}.
            </Trans>
          }
        />
        <Metric
          label={<Trans id="positions.investedCost">Invested cost</Trans>}
          value={formatMoney(summary.totalInvested, summary.displayCurrency)}
          hint={
            <Trans id="positions.investedCostHint">
              Cost basis of everything you still hold.
            </Trans>
          }
        />
        <Metric
          label={<Trans id="positions.unrealizedPnl">Open result</Trans>}
          value={signedOrZero(
            summary.totalUnrealizedPnl,
            summary.displayCurrency,
          )}
          valueClassName={pnlClassName(summary.totalUnrealizedPnl)}
          hint={
            summary.totalUnrealizedPnlPercent ? (
              <span className={pnlClassName(summary.totalUnrealizedPnl)}>
                {formatSignedPercent(summary.totalUnrealizedPnlPercent)}
              </span>
            ) : (
              <Trans id="positions.unrealizedPnlHint">
                Market value against the cost of quoted assets.
              </Trans>
            )
          }
        />
        <Metric
          label={<Trans id="positions.realizedPnl">Realized P&L</Trans>}
          value={signedOrZero(
            summary.totalRealizedPnl,
            summary.displayCurrency,
          )}
          valueClassName={pnlClassName(summary.totalRealizedPnl)}
          hint={
            <Trans id="positions.realizedPnlHint">
              Result already locked in by your sells.
            </Trans>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
        {meta.map((entry, index) => (
          <span key={entry} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span className="tabular-nums">{entry}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

/** Zero amounts read better without a sign. */
function signedOrZero(value: string, currency: Currency): string {
  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}

/** Native subtotals line of the summary meta strip. */
function nativeTotalsLabel(breakdown: string): string {
  return t({
    id: "positions.nativeTotals",
    message: `Native totals: ${breakdown}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Allocation donut                                                           */
/* -------------------------------------------------------------------------- */

type SliceDatum = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  value: number;
  color: string;
  display: string;
  shareLabel: string | null;
};

/** Hovered slice grows so the active asset pops out of the ring. */
function DonutActiveShape(props: {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
}) {
  return (
    <Sector
      cx={props.cx ?? 0}
      cy={props.cy ?? 0}
      innerRadius={props.innerRadius ?? 0}
      outerRadius={(props.outerRadius ?? 0) + 6}
      startAngle={props.startAngle ?? 0}
      endAngle={props.endAngle ?? 0}
      cornerRadius={3}
      fill={props.fill}
    />
  );
}

function AllocationCard({
  className,
  positions,
  summary,
  colorByTicker,
  snapshotLabel,
}: {
  className?: string;
  positions: ValuedPosition[];
  summary: PortfolioSummary;
  colorByTicker: Map<string, string>;
  snapshotLabel: string;
}) {
  useLingui();
  // `hovered` previews a slice, `pinned` keeps it after the pointer leaves.
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  const [pinned, setPinned] = useState<number | undefined>(undefined);
  const activeIndex = hovered ?? pinned;

  const slices: SliceDatum[] = useMemo(
    () =>
      positions
        .filter((position) => position.convertedMarketValue != null)
        .sort(
          (a, b) =>
            Number(b.convertedMarketValue ?? 0) -
            Number(a.convertedMarketValue ?? 0),
        )
        .map((position) => ({
          ticker: position.ticker,
          assetClass: position.assetClass,
          currency: position.currency,
          value: Number(position.convertedMarketValue ?? 0),
          color: colorByTicker.get(position.ticker) ?? UNQUOTED_COLOR,
          display: formatMoney(
            position.convertedMarketValue ?? "0.00",
            summary.displayCurrency,
          ),
          shareLabel:
            position.weight == null ? null : formatWeight(position.weight),
        })),
    [positions, colorByTicker, summary.displayCurrency],
  );

  const chartConfig: ChartConfig = useMemo(
    () =>
      Object.fromEntries(
        slices.map((slice) => [
          slice.ticker,
          { label: slice.ticker, color: slice.color },
        ]),
      ),
    [slices],
  );

  const sliceByTicker = useMemo(
    () => new Map(slices.map((slice) => [slice.ticker, slice])),
    [slices],
  );

  const active = activeIndex == null ? undefined : slices[activeIndex];

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.allocation">Allocation</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.allocationHint">
            Market value at {snapshotLabel} and share of quoted equity.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            <Trans id="positions.noQuotes">
              No market quotes for this snapshot yet.
            </Trans>
          </p>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <ChartContainer
                config={chartConfig}
                className="mx-auto aspect-square max-h-[232px] w-full"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        hideLabel
                        formatter={(_value, name) => {
                          const slice = sliceByTicker.get(String(name));

                          if (!slice) {
                            return null;
                          }

                          return (
                            <div className="flex w-full items-center gap-2">
                              <span
                                className="size-2.5 shrink-0 rounded-[2px]"
                                style={{ backgroundColor: slice.color }}
                              />
                              <span className="font-medium">
                                {slice.ticker}
                              </span>
                              <span className="ml-3 tabular-nums">
                                {slice.display}
                              </span>
                              {slice.shareLabel ? (
                                <span className="text-muted-foreground tabular-nums">
                                  {slice.shareLabel}
                                </span>
                              ) : null}
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="ticker"
                    innerRadius="66%"
                    outerRadius="94%"
                    paddingAngle={1.5}
                    stroke="var(--card)"
                    strokeWidth={2}
                    activeShape={<DonutActiveShape />}
                    onMouseEnter={(_, index) => setHovered(index)}
                    onMouseLeave={() => setHovered(undefined)}
                  >
                    {slices.map((slice, index) => (
                      <Cell
                        key={slice.ticker}
                        fill={slice.color}
                        // Hovering the legend dims everything but one asset.
                        opacity={
                          activeIndex == null || activeIndex === index
                            ? 1
                            : 0.35
                        }
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>

              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="text-xs text-muted-foreground">
                  {active?.ticker ?? <Trans id="positions.total">Total</Trans>}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {active
                    ? active.display
                    : formatMoney(
                        summary.totalMarketValue,
                        summary.displayCurrency,
                      )}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {active?.shareLabel ?? ""}
                </p>
              </div>
            </div>

            <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {slices.map((slice, index) => (
                <li key={slice.ticker}>
                  <button
                    type="button"
                    className={`flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs transition-colors hover:bg-muted ${
                      pinned === index ? "bg-muted" : ""
                    }`}
                    aria-pressed={pinned === index}
                    onClick={() =>
                      setPinned((current) =>
                        current === index ? undefined : index,
                      )
                    }
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(undefined)}
                    onFocus={() => setHovered(index)}
                    onBlur={() => setHovered(undefined)}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: slice.color }}
                      aria-hidden="true"
                    />
                    <AssetLogo
                      ticker={slice.ticker}
                      assetClass={slice.assetClass}
                      currency={slice.currency}
                      className="size-5 rounded-sm"
                    />
                    <span className="truncate font-medium">{slice.ticker}</span>
                    <span className="ml-auto text-muted-foreground tabular-nums">
                      {slice.shareLabel}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary teaser (top movers → Deep Finder)                                  */
/* -------------------------------------------------------------------------- */

type MoverRow = {
  ticker: string;
  change: string | null;
  changePercent: string | null;
};

function pickTopMovers(rows: MoverRow[], limit = 3) {
  const comparable = rows.filter((row) => row.changePercent != null);
  const gainers = comparable
    .filter((row) => Number(row.changePercent) > 0)
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
    .slice(0, limit);
  const losers = comparable
    .filter((row) => Number(row.changePercent) < 0)
    .sort((a, b) => Number(a.changePercent) - Number(b.changePercent))
    .slice(0, limit);

  return { gainers, losers };
}

function DeepFinderTeaser({
  className,
  positions,
  summary,
}: {
  className?: string;
  positions: ValuedPosition[];
  summary: PortfolioSummary;
}) {
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const fx = useFxQuote();
  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );
  const month = trpc.positions.finder.useQuery({
    displayCurrency,
    usdBrlRate: fx.effectiveRate,
    quoteSource,
    window: "1m",
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  });

  const fallbackRows = useMemo<MoverRow[]>(
    () =>
      positions.map((position) => ({
        ticker: position.ticker,
        change: position.convertedUnrealizedPnl,
        changePercent: position.unrealizedPnlPercent,
      })),
    [positions],
  );

  const showSkeleton = month.isPending && !month.data;
  const movers = pickTopMovers(
    month.data?.positions ?? (month.isError ? fallbackRows : []),
  );
  const totalChange =
    month.data?.summary.totalChange ?? summary.totalUnrealizedPnl;
  const currency =
    month.data?.summary.displayCurrency ?? summary.displayCurrency;
  const rising =
    month.data?.summary.advancing ??
    fallbackRows.filter((row) => Number(row.changePercent) > 0).length;
  const falling =
    month.data?.summary.declining ??
    fallbackRows.filter((row) => Number(row.changePercent) < 0).length;

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.teaserTitle">Summary</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.teaserHint">
            Biggest percent moves over the last month. Open Deep Finder for
            every ticker and lookback window.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        {showSkeleton ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-4 w-36" />
          </div>
        ) : (
          <div>
            <p
              className={`text-2xl font-semibold tabular-nums ${pnlClassName(totalChange)}`}
            >
              {signedOrZero(totalChange, currency)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="text-foreground tabular-nums">{rising}</span>{" "}
              <Trans id="positions.teaserRising">rising</Trans>
              <span aria-hidden="true"> · </span>
              <span className="text-foreground tabular-nums">{falling}</span>{" "}
              <Trans id="positions.teaserFalling">falling</Trans>
            </p>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <MoverList
            title={<Trans id="positions.teaserGainers">Top gainers</Trans>}
            empty={
              <Trans id="positions.teaserEmptyUp">
                No rising holdings this month.
              </Trans>
            }
            rows={movers.gainers}
            currency={currency}
            loading={showSkeleton}
          />
          <MoverList
            title={<Trans id="positions.teaserLosers">Top losers</Trans>}
            empty={
              <Trans id="positions.teaserEmptyDown">
                No falling holdings this month.
              </Trans>
            }
            rows={movers.losers}
            currency={currency}
            loading={showSkeleton}
          />
        </div>
      </CardContent>
      <CardFooter className="mt-auto">
        <Button asChild className="w-full">
          <Link to="/deep-finder">
            <ScanSearch className="size-4" aria-hidden="true" />
            <Trans id="positions.openDeepFinder">Open Deep Finder</Trans>
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function MoverList({
  title,
  empty,
  rows,
  currency,
  loading,
}: {
  title: ReactNode;
  empty: ReactNode;
  rows: MoverRow[];
  currency: Currency;
  loading: boolean;
}) {
  return (
    <section>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {loading ? (
        <ul className="mt-2 space-y-2">
          <li>
            <Skeleton className="h-5 w-full" />
          </li>
          <li>
            <Skeleton className="h-5 w-full" />
          </li>
          <li>
            <Skeleton className="h-5 w-full" />
          </li>
        </ul>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.ticker} className="flex items-baseline gap-3 text-sm">
              <span className="font-medium">{row.ticker}</span>
              <span
                className={cn(
                  "ml-auto tabular-nums",
                  row.changePercent ? pnlClassName(row.changePercent) : "",
                )}
              >
                {row.changePercent
                  ? formatSignedPercent(row.changePercent)
                  : "—"}
              </span>
              <span
                className={cn(
                  "w-[7.25rem] text-right tabular-nums",
                  row.change ? pnlClassName(row.change) : "",
                )}
              >
                {row.change ? signedOrZero(row.change, currency) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Holdings table                                                             */
/* -------------------------------------------------------------------------- */

type SortKey = "ticker" | "value" | "share" | "pnl";
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

function HoldingsCard({
  positions,
  summary,
  colorByTicker,
  missing,
}: {
  positions: ValuedPosition[];
  summary: PortfolioSummary;
  colorByTicker: Map<string, string>;
  missing: string[];
}) {
  const { i18n } = useLingui();
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const rows = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;

    const metric = (position: ValuedPosition): number | null => {
      if (sortKey === "value") {
        return position.convertedMarketValue == null
          ? null
          : Number(position.convertedMarketValue);
      }

      if (sortKey === "pnl") {
        return position.convertedUnrealizedPnl == null
          ? null
          : Number(position.convertedUnrealizedPnl);
      }

      return position.weight == null ? null : Number(position.weight);
    };

    return [...positions].sort((a, b) => {
      if (sortKey === "ticker") {
        return direction * a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      const left = metric(a);
      const right = metric(b);

      // Assets without a quote always sink to the bottom.
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
  }, [positions, sortKey, sortDir, i18n.locale]);

  const maxWeight = useMemo(
    () =>
      positions.reduce(
        (max, position) => Math.max(max, Number(position.weight ?? 0)),
        0,
      ),
    [positions],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));

      return;
    }

    setSortKey(key);
    setSortDir(key === "ticker" ? "asc" : "desc");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.holdings">Holdings</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.holdingsHint">
            Average cost and prices stay in the native currency of each asset;
            market value and result are consolidated.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="[&_tbody_td]:h-11 [&_tfoot_td]:h-11">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className="text-muted-foreground"
                aria-sort={ariaSort(sortKey === "ticker", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="positions.colTicker">Ticker</Trans>}
                  active={sortKey === "ticker"}
                  direction={sortDir}
                  onToggle={() => toggleSort("ticker")}
                />
              </TableHead>
              <TableHead className="text-muted-foreground">
                <Trans id="positions.colClass">Class</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="positions.colQuantity">Quantity</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="positions.colAvgCost">Avg. cost</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="positions.colPrice">Price</Trans>
              </TableHead>
              <TableHead
                className="text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "value", sortDir)}
              >
                <SortHeaderButton
                  label={
                    <Trans id="positions.colMarketValue">Market value</Trans>
                  }
                  align="right"
                  active={sortKey === "value"}
                  direction={sortDir}
                  onToggle={() => toggleSort("value")}
                />
              </TableHead>
              <TableHead
                className="text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "pnl", sortDir)}
              >
                <SortHeaderButton
                  label={
                    <Trans id="positions.colOpenResult">Open result</Trans>
                  }
                  align="right"
                  active={sortKey === "pnl"}
                  direction={sortDir}
                  onToggle={() => toggleSort("pnl")}
                />
              </TableHead>
              <TableHead
                className="w-[132px] text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "share", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="positions.colShare">Share</Trans>}
                  align="right"
                  active={sortKey === "share"}
                  direction={sortDir}
                  onToggle={() => toggleSort("share")}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((position) => (
              <TableRow key={`${position.ticker}|${position.currency}`}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          colorByTicker.get(position.ticker) ?? "var(--border)",
                      }}
                      aria-hidden="true"
                    />
                    <AssetLogo
                      ticker={position.ticker}
                      assetClass={position.assetClass}
                      currency={position.currency}
                    />
                    {position.ticker}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <AssetClassLabel assetClass={position.assetClass} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(position.quantity)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatMoney(position.averagePrice, position.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.marketPrice == null ? (
                    <Dash />
                  ) : (
                    formatMoney(position.marketPrice, position.currency)
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {position.convertedMarketValue == null ? (
                    <Dash />
                  ) : (
                    formatMoney(
                      position.convertedMarketValue,
                      position.displayCurrency,
                    )
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.convertedUnrealizedPnl == null ? (
                    <Dash />
                  ) : (
                    <span
                      className={`flex items-center justify-end gap-2 ${pnlClassName(position.convertedUnrealizedPnl)}`}
                    >
                      {signedOrZero(
                        position.convertedUnrealizedPnl,
                        position.displayCurrency,
                      )}
                      {position.unrealizedPnlPercent ? (
                        <span className="text-xs opacity-80">
                          {formatSignedPercent(position.unrealizedPnlPercent)}
                        </span>
                      ) : null}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.weight == null ? (
                    <Dash />
                  ) : (
                    <span className="flex items-center justify-end gap-2">
                      {formatWeight(position.weight)}
                      <span
                        className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted"
                        aria-hidden="true"
                      >
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${weightBarWidth(position.weight, maxWeight)}%`,
                            backgroundColor:
                              colorByTicker.get(position.ticker) ??
                              "var(--border)",
                          }}
                        />
                      </span>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="font-medium">
                <Trans id="positions.total">Total</Trans>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(summary.totalMarketValue, summary.displayCurrency)}
              </TableCell>
              <TableCell
                className={`text-right font-medium tabular-nums ${pnlClassName(summary.totalUnrealizedPnl)}`}
              >
                {signedOrZero(
                  summary.totalUnrealizedPnl,
                  summary.displayCurrency,
                )}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {summary.quotedPositions > 0 ? formatWeight("1") : <Dash />}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>

        {missing.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            <Trans id="positions.missingQuotes">
              No quote for {missing.join(", ")}. Values and shares cover quoted
              assets only.
            </Trans>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

/** Bars are scaled against the largest holding, not against 100%. */
function weightBarWidth(weight: string, maxWeight: number): number {
  if (maxWeight <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(4, (Number(weight) / maxWeight) * 100));
}

/* -------------------------------------------------------------------------- */
/* Manual prices                                                              */
/* -------------------------------------------------------------------------- */

/** Per-ticker price editor backing the manual quote source. */
function ManualPricesCard({ positions }: { positions: ValuedPosition[] }) {
  const { manualPrices, setManualPrice } = useSettings();
  const open = positions.filter((position) => Number(position.quantity) > 0);

  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      open.map((position) => [
        position.ticker,
        manualPrices[position.ticker] ?? "",
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  if (open.length === 0) {
    return null;
  }

  function save() {
    const nextErrors: Record<string, boolean> = {};
    let valid = true;

    for (const position of open) {
      const raw = (drafts[position.ticker] ?? "").trim();

      if (raw.length === 0) {
        continue;
      }

      if (!positiveDecimal.safeParse(raw).success) {
        nextErrors[position.ticker] = true;
        valid = false;
      }
    }

    setErrors(nextErrors);

    if (!valid) {
      return;
    }

    for (const position of open) {
      setManualPrice(position.ticker, (drafts[position.ticker] ?? "").trim());
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.manualPrices">Manual prices</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.manualPricesHint">
            Native-currency price per unit. Manual prices apply to every month.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((position) => (
            <div key={position.ticker} className="grid gap-1.5">
              <Label
                htmlFor={`manual-price-${position.ticker}`}
                className="w-full justify-between text-xs"
              >
                <span>
                  {position.ticker} ({position.currency})
                </span>
                <span className="font-normal text-muted-foreground tabular-nums">
                  {position.marketPrice
                    ? formatMoney(position.marketPrice, position.currency)
                    : "—"}
                </span>
              </Label>
              <Input
                id={`manual-price-${position.ticker}`}
                inputMode="decimal"
                placeholder="0.00"
                value={drafts[position.ticker] ?? ""}
                aria-invalid={!!errors[position.ticker]}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [position.ticker]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
        </div>
        <Button type="button" size="sm" onClick={save}>
          <Trans id="positions.savePrices">Save prices</Trans>
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="rounded-full bg-muted p-3">
          <Wallet className="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
        <p className="max-w-sm text-sm text-muted-foreground">
          <Trans id="positions.empty">
            No positions yet. Register your first trade to see it here.
          </Trans>
        </p>
        <Button asChild size="sm">
          <Link to="/transactions">
            <Plus className="size-4" aria-hidden="true" />
            <Trans id="positions.registerTrade">Register a trade</Trans>
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function PositionsSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[136px]" />
      <div className="grid gap-5 lg:grid-cols-5">
        <Skeleton className="h-[360px] lg:col-span-2" />
        <Skeleton className="h-[360px] lg:col-span-3" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
