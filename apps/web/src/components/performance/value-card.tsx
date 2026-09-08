import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  pnlClassName,
} from "@/lib/format";
import { TooltipRow } from "./performance-primitives";
import { type MonthRow, signedOrZero } from "./types";

export function ValueCard({
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
