import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  type CurrencyCode,
  formatPercentAxis,
  formatSignedPercent,
  pnlClassName,
} from "@/lib/format";
import { NoReturnYet, TooltipRow } from "./performance-primitives";
import { type MonthRow, signedOrZero } from "./types";

/**
 * Compounded time-weighted return, with the distance from its running peak
 * shaded underneath. Both are percentages, so they share one axis.
 */
export function CumulativeChart({ rows }: { rows: MonthRow[] }) {
  const points = rows.filter((row) => row.cumulativeReturn != null);
  const config: ChartConfig = {
    cumulativeReturn: {
      label: t({
        id: "performance.cumulativeReturn",
        message: "Cumulative return",
      }),
      color: "var(--chart-primary)",
    },
    drawdown: {
      label: t({ id: "performance.drawdown", message: "Drawdown" }),
      color: "var(--loss)",
    },
  };

  if (points.length === 0) {
    return <NoReturnYet />;
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-[288px] w-full">
      <ComposedChart data={points} margin={{ left: 4, right: 8, top: 8 }}>
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
        <ReferenceLine
          y={0}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.5}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) =>
                (payload?.[0]?.payload as MonthRow | undefined)?.fullLabel ?? ""
              }
              formatter={(_value, name, item) => {
                const row = item.payload as MonthRow | undefined;

                if (!row) {
                  return null;
                }

                if (name === "drawdown") {
                  return row.drawdown == null ? null : (
                    <TooltipRow
                      color="var(--loss)"
                      label={
                        <Trans id="performance.drawdownFromPeak">
                          From the peak
                        </Trans>
                      }
                      value={formatSignedPercent(String(row.drawdown))}
                    />
                  );
                }

                return row.cumulativeReturn == null ? null : (
                  <TooltipRow
                    color="var(--chart-primary)"
                    label={
                      <Trans id="performance.cumulativeReturn">
                        Cumulative return
                      </Trans>
                    }
                    value={formatSignedPercent(String(row.cumulativeReturn))}
                    valueClassName={pnlClassName(String(row.cumulativeReturn))}
                  />
                );
              }}
            />
          }
        />
        <Area
          dataKey="drawdown"
          type="monotone"
          stroke="var(--loss)"
          strokeOpacity={0.5}
          strokeWidth={1}
          fill="var(--loss)"
          fillOpacity={0.14}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="cumulativeReturn"
          type="monotone"
          stroke="var(--chart-primary)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

/** One bar per month: its own return, contributions removed. */
export function MonthlyReturnChart({
  rows,
  currency,
}: {
  rows: MonthRow[];
  currency: CurrencyCode;
}) {
  const points = rows.filter((row) => row.monthlyReturn != null);
  const config: ChartConfig = {
    monthlyReturn: {
      label: t({ id: "performance.monthlyReturn", message: "Monthly return" }),
    },
  };

  if (points.length === 0) {
    return <NoReturnYet />;
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
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
                (payload?.[0]?.payload as MonthRow | undefined)?.fullLabel ?? ""
              }
              formatter={(_value, _name, item) => {
                const row = item.payload as MonthRow | undefined;

                if (!row || row.monthlyReturn == null) {
                  return null;
                }

                return (
                  <div className="w-full space-y-1.5">
                    <TooltipRow
                      color={
                        row.monthlyReturn < 0 ? "var(--loss)" : "var(--gain)"
                      }
                      label={
                        <Trans id="performance.monthlyReturn">
                          Monthly return
                        </Trans>
                      }
                      value={formatSignedPercent(String(row.monthlyReturn))}
                      valueClassName={pnlClassName(String(row.monthlyReturn))}
                    />
                    {row.result != null ? (
                      <TooltipRow
                        color="var(--border)"
                        label={
                          <Trans id="performance.monthResult">Result</Trans>
                        }
                        value={signedOrZero(String(row.result), currency)}
                        valueClassName={pnlClassName(String(row.result))}
                      />
                    ) : null}
                  </div>
                );
              }}
            />
          }
        />
        <Bar
          dataKey="monthlyReturn"
          radius={[4, 4, 4, 4]}
          maxBarSize={26}
          isAnimationActive={false}
        >
          {points.map((row) => (
            <Cell
              key={row.key}
              fill={
                (row.monthlyReturn ?? 0) < 0 ? "var(--loss)" : "var(--gain)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
