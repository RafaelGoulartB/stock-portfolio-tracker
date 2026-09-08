import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  formatCompactMoney,
  formatMoney,
} from "@/lib/format";
import { NoReturnYet, TooltipRow } from "./performance-primitives";
import type { Category, MonthRow } from "./types";

export function CompositionCard({
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
