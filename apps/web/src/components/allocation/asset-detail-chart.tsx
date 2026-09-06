import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type {
  AllocationHistoryPoint,
  Currency,
} from "@portifolio-tracker/shared";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCompactMoney, formatMoney, formatTradeDate } from "@/lib/format";

type ChartRow = {
  asOf: string;
  label: string;
  close: number;
  fairValue: number | null;
};

function toChartRows(series: readonly AllocationHistoryPoint[]): ChartRow[] {
  return series.map((point) => ({
    asOf: point.asOf,
    label: point.asOf.slice(2, 7),
    close: Number(point.close),
    fairValue: point.fairValue === null ? null : Number(point.fairValue),
  }));
}

export function AssetDetailChart({
  series,
  currency,
}: {
  series: AllocationHistoryPoint[];
  currency: Currency;
}) {
  const rows = toChartRows(series);
  const hasFairValue = rows.some((row) => row.fairValue !== null);
  const config: ChartConfig = {
    close: {
      label: t({ id: "allocation.detailPrice", message: "Market" }),
      color: "var(--chart-1)",
    },
    fairValue: {
      label: t({ id: "allocation.detailFairValue", message: "Fair value" }),
      color: "var(--chart-2)",
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="allocation.detailChartTitle">Market vs fair value</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="allocation.detailChartHint">
            Daily close in the asset currency. Fair value steps forward from
            each reviewed quarter until the next valuation.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            <Trans id="allocation.detailChartEmpty">
              No price history for this ticker yet.
            </Trans>
          </p>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-[288px] w-full"
          >
            <LineChart data={rows} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={68}
                tickCount={5}
                domain={[
                  (min: number) => min - Math.abs(min) * 0.08,
                  (max: number) => max + Math.abs(max) * 0.08,
                ]}
                tickFormatter={(value: number) =>
                  formatCompactMoney(value, currency)
                }
              />
              <ChartTooltip
                cursor={{ stroke: "var(--border)" }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_label, payload) => {
                      const row = payload?.[0]?.payload as ChartRow | undefined;

                      return row ? formatTradeDate(row.asOf) : "";
                    }}
                    formatter={(value, name) => {
                      if (typeof value !== "number") {
                        return null;
                      }

                      return (
                        <span className="font-medium tabular-nums">
                          {formatMoney(value.toFixed(2), currency)}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {name === "fairValue"
                              ? t({
                                  id: "allocation.detailFairValue",
                                  message: "Fair value",
                                })
                              : t({
                                  id: "allocation.detailPrice",
                                  message: "Market",
                                })}
                          </span>
                        </span>
                      );
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                type="monotone"
                dataKey="close"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={false}
                name="close"
              />
              {hasFairValue ? (
                <Line
                  type="stepAfter"
                  dataKey="fairValue"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  name="fairValue"
                />
              ) : null}
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
