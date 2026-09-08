import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AssetClass } from "@portifolio-tracker/shared";
import { useMemo } from "react";
import { Bar, BarChart, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { AssetClassLabel, assetClassText } from "@/components/asset-labels";
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
import {
  type CurrencyCode,
  formatPercentAxis,
  formatSignedPercent,
  pnlClassName,
} from "@/lib/format";
import { NoReturnYet, TooltipRow } from "./performance-primitives";
import { type Category, type ClassBreakdown, signedOrZero } from "./types";

type CategoryReturnDatum = {
  assetClass: AssetClass;
  label: string;
  value: number;
  moneyLabel: string;
  color: string;
};

export function CategoryReturnCard({
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
