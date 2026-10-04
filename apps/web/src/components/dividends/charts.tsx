import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AssetClass } from "@portifolio-tracker/shared";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { AssetClassLabel, assetClassText } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
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
} from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ASSET_CLASS_COLORS } from "@/lib/asset-class-colors";
import { formatCompactMoney, formatMoney } from "@/lib/format";
import { currentMonth, eventDay, monthLabel } from "./calendar-utils";
import type { DividendData } from "./types";

type View = "month" | "year";

type MonthDatum = {
  key: string;
  label: string;
  /** Months after the current one hold announced events only. */
  future: boolean;
  total: number;
} & Partial<Record<AssetClass, number>>;

/** Income per month stacked by class, or per calendar year. */
export function IncomeChart({
  data,
  className,
}: {
  data: DividendData;
  className?: string;
}) {
  const { i18n } = useLingui();
  const [view, setView] = useState<View>("month");
  const currency = data.summary.displayCurrency;
  const thisMonth = currentMonth();
  const thisYear = Number(thisMonth.slice(0, 4));

  const classes = useMemo(() => {
    const totals = new Map<AssetClass, number>();

    for (const month of data.monthly) {
      for (const entry of month.byAssetClass) {
        totals.set(
          entry.assetClass,
          (totals.get(entry.assetClass) ?? 0) + Number(entry.amount),
        );
      }
    }

    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([assetClass]) => assetClass);
  }, [data.monthly]);

  const months = useMemo<MonthDatum[]>(
    () =>
      data.monthly.map((month) => ({
        key: month.month,
        label: monthLabel(month.month),
        future: month.month > thisMonth,
        total: Number(month.amount),
        ...Object.fromEntries(
          month.byAssetClass.map((entry) => [
            entry.assetClass,
            Number(entry.amount),
          ]),
        ),
      })),
    [data.monthly, thisMonth],
  );
  const years = data.income.byYear.map((entry) => ({
    key: String(entry.year),
    label: String(entry.year),
    future: false,
    partial: entry.year === thisYear,
    total: Number(entry.amount),
  }));

  const config: ChartConfig = Object.fromEntries(
    classes.map((assetClass) => [
      assetClass,
      {
        label: assetClassText(assetClass, i18n),
        color: ASSET_CLASS_COLORS[assetClass],
      },
    ]),
  );

  return (
    <Card className={className}>
      <Tabs value={view} onValueChange={(value) => setView(value as View)}>
        <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <CardTitle>
              {view === "month" ? (
                <Trans id="dividends.chartTitle">Income by month</Trans>
              ) : (
                <Trans id="dividends.chartYearTitle">Income by year</Trans>
              )}
            </CardTitle>
            <CardDescription>
              <Trans id="dividends.chartStackedHint">
                Estimated gross income in {currency}, by payment date when
                known. Faded bars are announced, not paid yet.
              </Trans>
            </CardDescription>
          </div>
          <TabsList>
            <TabsTrigger value="month">
              <Trans id="dividends.tabMonth">Month</Trans>
            </TabsTrigger>
            <TabsTrigger value="year">
              <Trans id="dividends.tabYear">Year</Trans>
            </TabsTrigger>
          </TabsList>
        </CardHeader>
      </Tabs>
      <CardContent className="space-y-3">
        <ChartContainer
          config={config}
          className="aspect-auto h-[260px] w-full"
        >
          {view === "month" ? (
            <BarChart data={months} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={10}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={64}
                tickCount={5}
                tickFormatter={(value: number) =>
                  formatCompactMoney(value, currency)
                }
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as MonthDatum | undefined;

                  return active && row ? (
                    <MonthTooltip
                      row={row}
                      classes={classes}
                      currency={currency}
                    />
                  ) : null;
                }}
              />
              {classes.map((assetClass, index) => (
                <Bar
                  key={assetClass}
                  dataKey={assetClass}
                  stackId="income"
                  fill={ASSET_CLASS_COLORS[assetClass]}
                  // A hairline of the surface keeps stacked classes apart.
                  stroke="var(--card)"
                  strokeWidth={1}
                  maxBarSize={28}
                  isAnimationActive={false}
                  radius={
                    index === classes.length - 1 ? [4, 4, 0, 0] : undefined
                  }
                >
                  {months.map((row) => (
                    <Cell key={row.key} fillOpacity={row.future ? 0.35 : 1} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          ) : (
            <BarChart data={years} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={64}
                tickCount={5}
                tickFormatter={(value: number) =>
                  formatCompactMoney(value, currency)
                }
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as
                    | (typeof years)[number]
                    | undefined;

                  return active && row ? (
                    <div className="grid gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                      <span className="font-medium">{row.label}</span>
                      <span className="tabular-nums">
                        {formatMoney(row.total.toFixed(2), currency)}
                      </span>
                      {row.partial ? (
                        <span className="text-muted-foreground">
                          <Trans id="dividends.yearSoFar">
                            So far, announced events included.
                          </Trans>
                        </span>
                      ) : null}
                    </div>
                  ) : null;
                }}
              />
              <Bar
                dataKey="total"
                fill="var(--chart-primary)"
                maxBarSize={56}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              >
                {years.map((row) => (
                  <Cell key={row.key} fillOpacity={row.partial ? 0.6 : 1} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ChartContainer>
        {view === "month" && classes.length > 1 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {classes.map((assetClass) => (
              <li
                key={assetClass}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: ASSET_CLASS_COLORS[assetClass] }}
                  aria-hidden="true"
                />
                <AssetClassLabel assetClass={assetClass} />
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MonthTooltip({
  row,
  classes,
  currency,
}: {
  row: MonthDatum;
  classes: AssetClass[];
  currency: DividendData["summary"]["displayCurrency"];
}) {
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium capitalize">
          {monthLabel(row.key, "long")}
        </span>
        {row.future ? (
          <span className="text-muted-foreground">
            <Trans id="dividends.announced">Announced</Trans>
          </span>
        ) : null}
      </div>
      {classes
        .filter((assetClass) => (row[assetClass] ?? 0) > 0)
        .map((assetClass) => (
          <div key={assetClass} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: ASSET_CLASS_COLORS[assetClass] }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              <AssetClassLabel assetClass={assetClass} />
            </span>
            <span className="ml-auto pl-3 font-medium tabular-nums">
              {formatMoney((row[assetClass] ?? 0).toFixed(2), currency)}
            </span>
          </div>
        ))}
      <div className="flex items-center justify-between border-t pt-1.5 font-medium">
        <Trans id="dividends.tooltipTotal">Total</Trans>
        <span className="tabular-nums">
          {formatMoney(row.total.toFixed(2), currency)}
        </span>
      </div>
    </div>
  );
}

/** Next announced or scheduled events, soonest first. Hidden when empty. */
export function UpcomingCard({ data }: { data: DividendData }) {
  const upcoming = data.events
    .filter((event) => event.status !== "estimated_paid")
    .sort((a, b) => eventDay(a).localeCompare(eventDay(b)))
    .slice(0, 6);
  const classOf = new Map(
    data.income.byAsset.map((asset) => [
      `${asset.ticker}|${asset.currency}`,
      asset.assetClass,
    ]),
  );

  if (upcoming.length === 0) {
    return null;
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <Trans id="dividends.upcomingTitle">Upcoming events</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="dividends.upcomingDescription">
            Announced events for positions that appear eligible.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {upcoming.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md bg-muted text-xs">
                <span className="font-semibold">
                  {eventDay(event).slice(8, 10)}
                </span>
                <span className="uppercase text-muted-foreground">
                  {monthLabel(eventDay(event).slice(0, 7), "short")}
                </span>
              </div>
              <AssetLogo
                ticker={event.ticker}
                assetClass={
                  classOf.get(`${event.ticker}|${event.currency}`) ?? "other"
                }
                currency={event.currency}
              />
              <div className="min-w-0 flex-1">
                <AssetLink ticker={event.ticker} className="font-medium">
                  {event.ticker}
                </AssetLink>
                <p className="text-xs text-muted-foreground">
                  {event.paymentDate ? (
                    <Trans id="dividends.paymentDate">Payment date</Trans>
                  ) : (
                    <Trans id="dividends.exDate">Ex-date</Trans>
                  )}
                </p>
              </div>
              <p className="font-medium tabular-nums">
                {formatMoney(event.grossAmount, event.currency)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
