import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  type AssetClass,
  PERFORMANCE_WINDOWS,
  type PerformanceWindow,
  positiveDecimal,
} from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, RefreshCw } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { AssetClassLabel, assetClassText } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
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
import { type RouterOutputs, trpc } from "@/lib/api";
import {
  type CurrencyCode,
  formatCompactMoney,
  formatMoney,
  formatPercentAxis,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
  formatTradeDate,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/performance")({
  component: PerformancePage,
});

type PerformanceData = RouterOutputs["performance"]["history"];
type PerformanceSummary = PerformanceData["summary"];
type ClassBreakdown = PerformanceData["byAssetClass"][number];
type AssetBreakdown = PerformanceData["byAsset"][number];

/** Same categorical palette as the allocation donut. */
const CATEGORY_COLORS = [
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

type MonthRow = {
  key: string;
  /** Axis label: short month, with the year on every January. */
  label: string;
  /** Tooltip label: month and year. */
  fullLabel: string;
  marketValue: number;
  investedCost: number;
  netFlow: number;
  cumulativeNetFlow: number;
  unrealizedPnl: number;
  monthlyReturn: number | null;
  cumulativeReturn: number | null;
} & Partial<Record<AssetClass, number>>;

type Category = { assetClass: AssetClass; color: string };

function monthDate(key: string): Date {
  const [year, month] = key.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, 1));
}

function fullMonthLabel(key: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthDate(key));
}

/** Short month for a dense axis; January carries the year to stay readable. */
function axisMonthLabel(key: string, locale: string): string {
  const date = monthDate(key);
  const month = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  }).format(date);

  return date.getUTCMonth() === 0
    ? `${month} ${String(date.getUTCFullYear()).slice(2)}`
    : month;
}

function PerformancePage() {
  const { i18n } = useLingui();
  const { displayCurrency, quoteSource, manualPrices, fxSource, manualRate } =
    useSettings();
  const [months, setMonths] = useState<PerformanceWindow>(12);

  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );
  const manualRateValid = positiveDecimal.safeParse(manualRate).success;

  const history = trpc.performance.history.useQuery(
    {
      displayCurrency,
      months,
      quoteSource,
      manualPrices:
        quoteSource === "manual" &&
        Object.keys(sanitizedManualPrices).length > 0
          ? sanitizedManualPrices
          : undefined,
      fxSource,
      manualRate: manualRateValid ? manualRate : undefined,
    },
    // A month-end history only changes when a new close lands.
    { staleTime: 30 * 60 * 1_000, gcTime: 30 * 60 * 1_000 },
  );

  const data = history.data;

  const rows = useMemo<MonthRow[]>(
    () =>
      (data?.months ?? []).map((month) => ({
        key: month.key,
        label: axisMonthLabel(month.key, i18n.locale),
        fullLabel: fullMonthLabel(month.key, i18n.locale),
        marketValue: Number(month.marketValue),
        investedCost: Number(month.investedCost),
        netFlow: Number(month.netFlow),
        cumulativeNetFlow: Number(month.cumulativeNetFlow),
        unrealizedPnl: Number(month.unrealizedPnl),
        monthlyReturn:
          month.monthlyReturn == null ? null : Number(month.monthlyReturn),
        cumulativeReturn:
          month.cumulativeReturn == null
            ? null
            : Number(month.cumulativeReturn),
        ...Object.fromEntries(
          month.byAssetClass.map((entry) => [
            entry.assetClass,
            Number(entry.marketValue),
          ]),
        ),
      })),
    [data?.months, i18n.locale],
  );

  /** Categories ordered by their largest value, so stacking stays stable. */
  const categories = useMemo<Category[]>(() => {
    const peaks = new Map<AssetClass, number>();

    for (const month of data?.months ?? []) {
      for (const entry of month.byAssetClass) {
        const value = Number(entry.marketValue);

        peaks.set(
          entry.assetClass,
          Math.max(peaks.get(entry.assetClass) ?? 0, value),
        );
      }
    }

    return [...peaks.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([assetClass], index) => ({
        assetClass,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      }));
  }, [data?.months]);

  const empty =
    !!data &&
    data.byAsset.length === 0 &&
    Number(data.summary.currentValue) === 0;
  const missingManualRate =
    !!history.error &&
    isFxRateRequired(history.error) &&
    fxSource === "manual" &&
    !manualRateValid;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="performance.title">Performance</Trans>
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            <Trans id="performance.subtitle">
              Month-end history of what the portfolio was worth, how much of it
              is result, and where that result comes from.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WindowSelector months={months} onSelect={setMonths} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => history.refetch()}
            disabled={history.isFetching}
          >
            <RefreshCw
              className={`size-4 ${history.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <Trans id="performance.refresh">Refresh</Trans>
          </Button>
        </div>
      </header>

      {history.isPending ? <PerformanceSkeleton /> : null}

      {missingManualRate ? (
        <ErrorCard>
          <Trans id="performance.manualRateMissing">
            Set a manual USD/BRL rate in the settings to consolidate this
            history.
          </Trans>
        </ErrorCard>
      ) : null}

      {history.error && !missingManualRate ? (
        <ErrorCard>{queryErrorMessage(history.error)}</ErrorCard>
      ) : null}

      {data && empty ? <EmptyState /> : null}

      {data && !empty ? (
        <>
          <SummaryStrip summary={data.summary} months={months} />

          <ValueCard rows={rows} currency={data.summary.displayCurrency} />

          <div className="grid gap-5 lg:grid-cols-2">
            <CumulativeReturnCard rows={rows} />
            <MonthlyReturnCard rows={rows} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <CompositionCard
              rows={rows}
              categories={categories}
              currency={data.summary.displayCurrency}
            />
            <CategoryReturnCard
              breakdown={data.byAssetClass}
              categories={categories}
              currency={data.summary.displayCurrency}
            />
          </div>

          <CategoryTable
            breakdown={data.byAssetClass}
            summary={data.summary}
            categories={categories}
          />

          <ContributorsCard
            assets={data.byAsset}
            currency={data.summary.displayCurrency}
          />

          {data.quotes.missing.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              <Trans id="performance.missingQuotes">
                No price history for {data.quotes.missing.join(", ")}. These
                assets are carried at cost, so they add value without adding
                return.
              </Trans>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function WindowSelector({
  months,
  onSelect,
}: {
  months: PerformanceWindow;
  onSelect: (months: PerformanceWindow) => void;
}) {
  const { i18n } = useLingui();

  return (
    <>
      <Label htmlFor="performance-window" className="sr-only">
        <Trans id="performance.window">History window</Trans>
      </Label>
      <Select
        value={String(months)}
        onValueChange={(value) => onSelect(Number(value) as PerformanceWindow)}
      >
        <SelectTrigger
          id="performance-window"
          size="sm"
          className="w-full max-w-[152px] sm:w-[152px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERFORMANCE_WINDOWS.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {i18n._(
                t({
                  id: "performance.windowMonths",
                  message: plural(
                    { count: option },
                    { one: "Last # month", other: "Last # months" },
                  ),
                }),
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

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <p className="text-sm text-muted-foreground">
          <Trans id="performance.empty">
            Register trades to build a performance history.
          </Trans>
        </p>
        <Button asChild size="sm">
          <Link to="/transactions">
            <Plus className="size-4" aria-hidden="true" />
            <Trans id="performance.registerTrade">Register a trade</Trans>
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

function SummaryStrip({
  summary,
  months,
}: {
  summary: PerformanceSummary;
  months: PerformanceWindow;
}) {
  const { i18n } = useLingui();
  const currency = summary.displayCurrency;
  const asOf = formatTradeDate(summary.asOf);

  const meta = [
    i18n._(
      t({
        id: "performance.monthsCovered",
        message: plural(
          { count: summary.monthsWithReturn },
          { one: "# month with return", other: "# months with return" },
        ),
      }),
    ),
    summary.positiveMonths + summary.negativeMonths > 0
      ? `${summary.positiveMonths} ↑ · ${summary.negativeMonths} ↓`
      : null,
    summary.unquotedPositions > 0
      ? i18n._(
          t({
            id: "performance.atCostCount",
            message: plural(
              { count: summary.unquotedPositions },
              {
                one: "# asset carried at cost",
                other: "# assets carried at cost",
              },
            ),
          }),
        )
      : null,
    summary.usdBrlRate
      ? `1 USD = ${formatQuantity(summary.usdBrlRate)} BRL`
      : null,
  ].filter((entry): entry is string => entry != null);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid divide-y sm:grid-cols-2 sm:divide-x lg:grid-cols-5 lg:divide-y-0">
        <Metric
          label={<Trans id="performance.portfolioValue">Portfolio value</Trans>}
          value={formatMoney(summary.currentValue, currency)}
          hint={<Trans id="performance.valuedAt">Valued at {asOf}.</Trans>}
        />
        <Metric
          label={
            <Trans id="performance.windowReturn">Return in the window</Trans>
          }
          value={
            summary.cumulativeReturn == null
              ? "—"
              : formatSignedPercent(summary.cumulativeReturn)
          }
          valueClassName={
            summary.cumulativeReturn == null
              ? undefined
              : pnlClassName(summary.cumulativeReturn)
          }
          hint={
            summary.annualizedReturn == null ? (
              <Trans id="performance.timeWeighted">
                Time-weighted, contributions removed.
              </Trans>
            ) : (
              <Trans id="performance.annualized">
                {formatSignedPercent(summary.annualizedReturn)} per year.
              </Trans>
            )
          }
        />
        <Metric
          label={<Trans id="performance.openResult">Open result</Trans>}
          value={signedOrZero(summary.unrealizedPnl, currency)}
          valueClassName={pnlClassName(summary.unrealizedPnl)}
          hint={
            summary.unrealizedPnlPercent == null ? (
              <Trans id="performance.overCost">Over the cost basis.</Trans>
            ) : (
              <span className={pnlClassName(summary.unrealizedPnl)}>
                {formatSignedPercent(summary.unrealizedPnlPercent)}
              </span>
            )
          }
        />
        <Metric
          label={<Trans id="performance.netInvested">Net contributions</Trans>}
          value={formatMoney(summary.netInvested, currency)}
          hint={
            <Trans id="performance.realizedInWindow">
              {signedOrZero(summary.realizedPnl, currency)} realized.
            </Trans>
          }
        />
        <Metric
          label={<Trans id="performance.maxDrawdown">Max drawdown</Trans>}
          value={
            summary.maxDrawdown == null
              ? "—"
              : formatSignedPercent(summary.maxDrawdown)
          }
          valueClassName={
            summary.maxDrawdown == null || Number(summary.maxDrawdown) === 0
              ? undefined
              : "text-loss"
          }
          hint={
            summary.worstMonth ? (
              <Trans id="performance.worstMonth">
                Worst month{" "}
                {formatSignedPercent(summary.worstMonth.returnPercent)}.
              </Trans>
            ) : (
              <Trans id="performance.lastMonths">
                Over the last {months} months.
              </Trans>
            )
          }
        />
      </div>
      <div className="border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
        {meta.join(" · ")}
      </div>
    </Card>
  );
}

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

/* -------------------------------------------------------------------------- */
/* Value vs cost                                                              */
/* -------------------------------------------------------------------------- */

/** One tooltip row: colored marker, label and a right-aligned amount. */
function TooltipRow({
  color,
  label,
  value,
  valueClassName,
  dashed = false,
}: {
  color: string;
  label: ReactNode;
  value: string;
  valueClassName?: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <span
        className={`size-2.5 shrink-0 rounded-[2px] ${dashed ? "border-[1.5px] border-dashed" : ""}`}
        style={
          dashed
            ? { borderColor: color, backgroundColor: "transparent" }
            : { backgroundColor: color }
        }
        aria-hidden="true"
      />
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`ml-auto pl-3 font-medium tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function ValueCard({
  rows,
  currency,
}: {
  rows: MonthRow[];
  currency: CurrencyCode;
}) {
  const config: ChartConfig = {
    marketValue: {
      label: t({ id: "performance.value", message: "Portfolio value" }),
      color: "var(--chart-1)",
    },
    investedCost: {
      label: t({ id: "performance.cost", message: "Cost basis" }),
      color: "var(--muted-foreground)",
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="performance.valueTitle">Value and cost basis</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="performance.valueHint">
            The gap between the two lines is the open result: value above cost
            is gain, below is loss. In {currency}.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={config}
          className="aspect-auto h-[288px] w-full"
        >
          <AreaChart data={rows} margin={{ left: 4, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="performanceValue" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--chart-1)"
                  stopOpacity={0.35}
                />
                <stop
                  offset="100%"
                  stopColor="var(--chart-1)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={12}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={62}
              tickCount={5}
              tickFormatter={(value: number) =>
                formatCompactMoney(value, currency)
              }
            />
            <ChartTooltip
              cursor={{ stroke: "var(--border)" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_label, payload) =>
                    (payload?.[0]?.payload as MonthRow | undefined)
                      ?.fullLabel ?? ""
                  }
                  formatter={(_value, name, item) => {
                    const row = item.payload as MonthRow | undefined;

                    if (!row) {
                      return null;
                    }

                    if (name === "investedCost") {
                      return (
                        <div className="w-full space-y-1.5">
                          <TooltipRow
                            color="var(--muted-foreground)"
                            dashed
                            label={
                              <Trans id="performance.cost">Cost basis</Trans>
                            }
                            value={formatMoney(
                              String(row.investedCost),
                              currency,
                            )}
                          />
                          <TooltipRow
                            color={
                              row.unrealizedPnl < 0
                                ? "var(--loss)"
                                : "var(--gain)"
                            }
                            label={
                              <Trans id="performance.openResult">
                                Open result
                              </Trans>
                            }
                            value={signedOrZero(
                              String(row.unrealizedPnl),
                              currency,
                            )}
                            valueClassName={pnlClassName(
                              String(row.unrealizedPnl),
                            )}
                          />
                          {row.netFlow !== 0 ? (
                            <TooltipRow
                              color="var(--border)"
                              label={
                                <Trans id="performance.netFlow">
                                  Contributions
                                </Trans>
                              }
                              value={signedOrZero(
                                String(row.netFlow),
                                currency,
                              )}
                            />
                          ) : null}
                        </div>
                      );
                    }

                    return (
                      <TooltipRow
                        color="var(--chart-1)"
                        label={
                          <Trans id="performance.value">Portfolio value</Trans>
                        }
                        value={formatMoney(String(row.marketValue), currency)}
                      />
                    );
                  }}
                />
              }
            />
            <Area
              dataKey="marketValue"
              type="monotone"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#performanceValue)"
              dot={false}
              activeDot={{ r: 3 }}
            />
            <Area
              dataKey="investedCost"
              type="monotone"
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              fill="none"
              dot={false}
              activeDot={{ r: 3 }}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Returns                                                                    */
/* -------------------------------------------------------------------------- */

function CumulativeReturnCard({ rows }: { rows: MonthRow[] }) {
  const points = rows.filter((row) => row.cumulativeReturn != null);
  const config: ChartConfig = {
    cumulativeReturn: {
      label: t({
        id: "performance.cumulativeReturn",
        message: "Cumulative return",
      }),
      color: "var(--chart-1)",
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="performance.cumulativeTitle">Cumulative return</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="performance.cumulativeHint">
            Time-weighted return since the start of the window, so contributions
            never inflate it.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <NoReturnYet />
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-[236px] w-full"
          >
            <LineChart data={points} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={12}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tickCount={5}
                tickFormatter={(value: number) => formatPercentAxis(value)}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <ChartTooltip
                cursor={{ stroke: "var(--border)" }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_label, payload) =>
                      (payload?.[0]?.payload as MonthRow | undefined)
                        ?.fullLabel ?? ""
                    }
                    formatter={(_value, _name, item) => {
                      const row = item.payload as MonthRow | undefined;

                      if (!row || row.cumulativeReturn == null) {
                        return null;
                      }

                      return (
                        <TooltipRow
                          color="var(--chart-1)"
                          label={
                            <Trans id="performance.cumulativeReturn">
                              Cumulative return
                            </Trans>
                          }
                          value={formatSignedPercent(
                            String(row.cumulativeReturn),
                          )}
                          valueClassName={pnlClassName(
                            String(row.cumulativeReturn),
                          )}
                        />
                      );
                    }}
                  />
                }
              />
              <Line
                dataKey="cumulativeReturn"
                type="monotone"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function MonthlyReturnCard({ rows }: { rows: MonthRow[] }) {
  const points = rows.filter((row) => row.monthlyReturn != null);
  const config: ChartConfig = {
    monthlyReturn: {
      label: t({ id: "performance.monthlyReturn", message: "Monthly return" }),
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="performance.monthlyTitle">Monthly return</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="performance.monthlyHint">
            How each month performed on its own, contributions weighted by the
            days they were invested.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <NoReturnYet />
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-[236px] w-full"
          >
            <BarChart data={points} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tickCount={5}
                tickFormatter={(value: number) => formatPercentAxis(value)}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_label, payload) =>
                      (payload?.[0]?.payload as MonthRow | undefined)
                        ?.fullLabel ?? ""
                    }
                    formatter={(_value, _name, item) => {
                      const row = item.payload as MonthRow | undefined;

                      if (!row || row.monthlyReturn == null) {
                        return null;
                      }

                      return (
                        <TooltipRow
                          color={
                            row.monthlyReturn < 0
                              ? "var(--loss)"
                              : "var(--gain)"
                          }
                          label={
                            <Trans id="performance.monthlyReturn">
                              Monthly return
                            </Trans>
                          }
                          value={formatSignedPercent(String(row.monthlyReturn))}
                          valueClassName={pnlClassName(
                            String(row.monthlyReturn),
                          )}
                        />
                      );
                    }}
                  />
                }
              />
              <Bar dataKey="monthlyReturn" radius={3} maxBarSize={26}>
                {points.map((row) => (
                  <Cell
                    key={row.key}
                    fill={
                      (row.monthlyReturn ?? 0) < 0
                        ? "var(--loss)"
                        : "var(--gain)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function NoReturnYet() {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      <Trans id="performance.noReturnYet">
        Not enough history yet: a return needs a month that starts with a
        position.
      </Trans>
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

function CompositionCard({
  rows,
  categories,
  currency,
}: {
  rows: MonthRow[];
  categories: Category[];
  currency: CurrencyCode;
}) {
  const { i18n } = useLingui();
  const config: ChartConfig = Object.fromEntries(
    categories.map((category) => [
      category.assetClass,
      {
        label: assetClassText(category.assetClass, i18n),
        color: category.color,
      },
    ]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="performance.compositionTitle">
            Value by category over time
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="performance.compositionHint">
            How the mix of categories evolved, in {currency}.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {categories.length === 0 ? (
          <NoReturnYet />
        ) : (
          <>
            <ChartContainer
              config={config}
              className="aspect-auto h-[236px] w-full"
            >
              <AreaChart data={rows} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={12}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={62}
                  tickCount={5}
                  tickFormatter={(value: number) =>
                    formatCompactMoney(value, currency)
                  }
                />
                <ChartTooltip
                  cursor={{ stroke: "var(--border)" }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_label, payload) =>
                        (payload?.[0]?.payload as MonthRow | undefined)
                          ?.fullLabel ?? ""
                      }
                      formatter={(value, name) => {
                        const category = categories.find(
                          (entry) => entry.assetClass === name,
                        );

                        if (!category) {
                          return null;
                        }

                        return (
                          <TooltipRow
                            color={category.color}
                            label={
                              <AssetClassLabel
                                assetClass={category.assetClass}
                              />
                            }
                            value={formatMoney(String(value), currency)}
                          />
                        );
                      }}
                    />
                  }
                />
                {categories.map((category) => (
                  <Area
                    key={category.assetClass}
                    dataKey={category.assetClass}
                    type="monotone"
                    stackId="composition"
                    stroke={category.color}
                    strokeWidth={1.5}
                    fill={category.color}
                    fillOpacity={0.28}
                    dot={false}
                  />
                ))}
              </AreaChart>
            </ChartContainer>

            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {categories.map((category) => (
                <li
                  key={category.assetClass}
                  className="flex items-center gap-2 text-xs"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: category.color }}
                    aria-hidden="true"
                  />
                  <AssetClassLabel assetClass={category.assetClass} />
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type CategoryReturnDatum = {
  assetClass: AssetClass;
  label: string;
  value: number;
  moneyLabel: string;
  color: string;
};

function CategoryReturnCard({
  breakdown,
  categories,
  currency,
}: {
  breakdown: ClassBreakdown[];
  categories: Category[];
  currency: CurrencyCode;
}) {
  const { i18n } = useLingui();
  const colorByClass = useMemo(
    () =>
      new Map(
        categories.map((category) => [category.assetClass, category.color]),
      ),
    [categories],
  );

  const rows = useMemo<CategoryReturnDatum[]>(
    () =>
      breakdown
        .filter((entry) => entry.unrealizedPnlPercent != null)
        .map((entry) => ({
          assetClass: entry.assetClass,
          label: assetClassText(entry.assetClass, i18n),
          value: Number(entry.unrealizedPnlPercent),
          moneyLabel: signedOrZero(entry.unrealizedPnl, currency),
          color:
            colorByClass.get(entry.assetClass) ?? "var(--muted-foreground)",
        }))
        .sort((a, b) => b.value - a.value),
    [breakdown, colorByClass, currency, i18n],
  );

  const bound = useMemo(() => {
    const values = rows.map((row) => row.value);

    return {
      min: Math.min(0, ...values) * 1.2,
      max: Math.max(0, ...values) * 1.2,
    };
  }, [rows]);

  const config: ChartConfig = {
    value: {
      label: t({ id: "performance.categoryReturn", message: "Return" }),
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="performance.categoryReturnTitle">Return by category</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="performance.categoryReturnHint">
            Open result over the cost basis of each category.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <NoReturnYet />
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-[236px] w-full"
          >
            <BarChart
              accessibilityLayer
              data={rows}
              layout="vertical"
              margin={{ left: 0, right: 12, top: 4 }}
              barCategoryGap="24%"
            >
              <XAxis
                type="number"
                domain={[bound.min, bound.max]}
                tickLine={false}
                axisLine={false}
                tickCount={5}
                tickFormatter={(value: number) => formatPercentAxis(value)}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={104}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
              />
              <ReferenceLine x={0} stroke="var(--border)" />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(_value, _name, item) => {
                      const row = item.payload as
                        | CategoryReturnDatum
                        | undefined;

                      if (!row) {
                        return null;
                      }

                      return (
                        <div className="w-full space-y-1.5">
                          <TooltipRow
                            color={row.color}
                            label={
                              <AssetClassLabel assetClass={row.assetClass} />
                            }
                            value={formatSignedPercent(String(row.value))}
                            valueClassName={pnlClassName(String(row.value))}
                          />
                          <TooltipRow
                            color={
                              row.value < 0 ? "var(--loss)" : "var(--gain)"
                            }
                            label={
                              <Trans id="performance.openResult">
                                Open result
                              </Trans>
                            }
                            value={row.moneyLabel}
                            valueClassName={pnlClassName(String(row.value))}
                          />
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey="value" radius={3} maxBarSize={22}>
                {rows.map((row) => (
                  <Cell
                    key={row.assetClass}
                    fill={row.value < 0 ? "var(--loss)" : "var(--gain)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function CategoryTable({
  breakdown,
  summary,
  categories,
}: {
  breakdown: ClassBreakdown[];
  summary: PerformanceSummary;
  categories: Category[];
}) {
  const currency = summary.displayCurrency;
  const colorByClass = useMemo(
    () =>
      new Map(
        categories.map((category) => [category.assetClass, category.color]),
      ),
    [categories],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="performance.categoryTableTitle">Categories today</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="performance.categoryTableHint">
            Contribution is how many percentage points of the portfolio result
            come from each category.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="[&_tbody_td]:h-11 [&_tfoot_td]:h-11">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-muted-foreground">
                <Trans id="performance.colCategory">Category</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="performance.colAssets">Assets</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="performance.colInvested">Cost basis</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="performance.colValue">Value</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="performance.colWeight">Weight</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="performance.colOpenResult">Open result</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="performance.colReturn">Return</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="performance.colContribution">Contribution</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {breakdown.map((entry) => (
              <TableRow key={entry.assetClass}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          colorByClass.get(entry.assetClass) ??
                          "var(--muted-foreground)",
                      }}
                      aria-hidden="true"
                    />
                    <AssetClassLabel assetClass={entry.assetClass} />
                  </span>
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {entry.positions}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(entry.investedCost, currency)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(entry.marketValue, currency)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {entry.weight == null ? "—" : formatWeight(entry.weight)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${pnlClassName(entry.unrealizedPnl)}`}
                >
                  {signedOrZero(entry.unrealizedPnl, currency)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${entry.unrealizedPnlPercent == null ? "" : pnlClassName(entry.unrealizedPnlPercent)}`}
                >
                  {entry.unrealizedPnlPercent == null
                    ? "—"
                    : formatSignedPercent(entry.unrealizedPnlPercent)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${entry.contribution == null ? "" : pnlClassName(entry.contribution)}`}
                >
                  {entry.contribution == null
                    ? "—"
                    : formatSignedPercent(entry.contribution)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-medium">
                <Trans id="performance.total">Portfolio</Trans>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(summary.investedCost, currency)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(summary.currentValue, currency)}
              </TableCell>
              <TableCell />
              <TableCell
                className={`text-right font-semibold tabular-nums ${pnlClassName(summary.unrealizedPnl)}`}
              >
                {signedOrZero(summary.unrealizedPnl, currency)}
              </TableCell>
              <TableCell
                className={`text-right font-semibold tabular-nums ${summary.unrealizedPnlPercent == null ? "" : pnlClassName(summary.unrealizedPnlPercent)}`}
              >
                {summary.unrealizedPnlPercent == null
                  ? "—"
                  : formatSignedPercent(summary.unrealizedPnlPercent)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Contributors                                                               */
/* -------------------------------------------------------------------------- */

const CONTRIBUTOR_LIMIT = 5;

function ContributorsCard({
  assets,
  currency,
}: {
  assets: AssetBreakdown[];
  currency: CurrencyCode;
}) {
  const winners = assets
    .filter((asset) => Number(asset.unrealizedPnl) > 0)
    .slice(0, CONTRIBUTOR_LIMIT);
  const losers = assets
    .filter((asset) => Number(asset.unrealizedPnl) < 0)
    .slice(-CONTRIBUTOR_LIMIT)
    .reverse();

  if (winners.length === 0 && losers.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="performance.contributorsTitle">
            What moves the result
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="performance.contributorsHint">
            Assets with the largest open result, and what each one adds to the
            portfolio return.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <ContributorList
          title={<Trans id="performance.topGains">Top gains</Trans>}
          assets={winners}
          currency={currency}
        />
        <ContributorList
          title={<Trans id="performance.topLosses">Top losses</Trans>}
          assets={losers}
          currency={currency}
        />
      </CardContent>
    </Card>
  );
}

function ContributorList({
  title,
  assets,
  currency,
}: {
  title: ReactNode;
  assets: AssetBreakdown[];
  currency: CurrencyCode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans id="performance.noneYet">None yet.</Trans>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {assets.map((asset) => (
            <li
              key={asset.ticker}
              className="flex items-baseline gap-3 text-sm"
            >
              <AssetLink ticker={asset.ticker} className="font-medium">
                {asset.ticker}
              </AssetLink>
              <span className="text-xs text-muted-foreground">
                <AssetClassLabel assetClass={asset.assetClass} />
              </span>
              <span
                className={`ml-auto tabular-nums ${pnlClassName(asset.unrealizedPnl)}`}
              >
                {signedOrZero(asset.unrealizedPnl, currency)}
              </span>
              <span
                className={`w-16 text-right text-xs tabular-nums ${asset.unrealizedPnlPercent == null ? "text-muted-foreground" : pnlClassName(asset.unrealizedPnlPercent)}`}
              >
                {asset.unrealizedPnlPercent == null
                  ? "—"
                  : formatSignedPercent(asset.unrealizedPnlPercent)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function signedOrZero(value: string, currency: CurrencyCode): string {
  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}

function PerformanceSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="grid divide-y sm:grid-cols-2 sm:divide-x lg:grid-cols-5 lg:divide-y-0">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="space-y-2 px-5 py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[288px] w-full" />
        </CardContent>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((item) => (
          <Card key={item}>
            <CardHeader>
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[236px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
