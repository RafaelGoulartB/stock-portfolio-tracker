import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
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
  formatPercentAxis,
  formatSignedPercent,
  pnlClassName,
} from "@/lib/format";
import { NoReturnYet, TooltipRow } from "./performance-primitives";
import type { MonthRow } from "./types";

export function CumulativeReturnCard({ rows }: { rows: MonthRow[] }) {
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

export function MonthlyReturnCard({ rows }: { rows: MonthRow[] }) {
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
