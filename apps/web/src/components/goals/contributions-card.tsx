import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { TooltipRow } from "@/components/performance/performance-primitives";
import { axisMonthLabel, fullMonthLabel } from "@/components/performance/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type CurrencyCode,
  formatCompactMoney,
  formatMoney,
  formatSignedMoney,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContributionHistory } from "./types";

/** Months shown in the bar chart; the yearly table covers the rest. */
const CHART_MONTHS = 24;

type ContributionRow = {
  key: string;
  label: string;
  fullLabel: string;
  amount: number;
};

function Figure({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint ? (
        <p className="text-xs text-muted-foreground tabular-nums">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * New money per month, derived from the trade log, against the planned
 * monthly contribution when a goal is set.
 */
export function ContributionsCard({
  contributions,
  planned,
}: {
  contributions: ContributionHistory;
  /** Planned monthly contribution in the display currency, if any. */
  planned: string | null;
}) {
  const { i18n } = useLingui();
  const currency = contributions.displayCurrency as CurrencyCode;
  const recent = contributions.recent;

  const rows = useMemo<ContributionRow[]>(
    () =>
      contributions.months.slice(-CHART_MONTHS).map((month) => ({
        key: month.key,
        label: axisMonthLabel(month.key, i18n.locale),
        fullLabel: fullMonthLabel(month.key, i18n.locale),
        amount: Number(month.amount),
      })),
    [contributions.months, i18n.locale],
  );

  const config: ChartConfig = {
    amount: {
      label: t({ id: "goals.contributed", message: "Contributed" }),
      color: "var(--chart-primary)",
    },
  };
  const plannedValue = planned === null ? null : Number(planned);

  const notes = [
    contributions.approximatedTrades > 0
      ? i18n._(
          t({
            id: "goals.contributionsApproximated",
            message: plural(
              { count: contributions.approximatedTrades },
              {
                one: "# foreign trade without its own rate is converted at today's rate.",
                other:
                  "# foreign trades without their own rate are converted at today's rate.",
              },
            ),
          }),
        )
      : null,
    contributions.unconvertedTrades > 0
      ? i18n._(
          t({
            id: "goals.contributionsUnconverted",
            message: plural(
              { count: contributions.unconvertedTrades },
              {
                one: "# foreign trade is left out: no USD/BRL rate is available.",
                other:
                  "# foreign trades are left out: no USD/BRL rate is available.",
              },
            ),
          }),
        )
      : null,
  ].filter((note): note is string => note !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="goals.contributionsTitle">Contributions</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="goals.contributionsDescription">
            New money per month, from your transactions: buys with fees minus
            sale proceeds.
          </Trans>
        </CardDescription>
      </CardHeader>
      {contributions.months.length === 0 ? (
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            <Trans id="goals.noContributions">
              No transactions yet, so there is no contribution history.
            </Trans>
          </p>
          <Button asChild size="sm">
            <Link to="/transactions">
              <Plus className="size-4" aria-hidden="true" />
              <Trans id="performance.registerTrade">Register a trade</Trans>
            </Link>
          </Button>
        </CardContent>
      ) : (
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              label={
                <Trans id="goals.recentTotal">
                  Last {recent.months} full months
                </Trans>
              }
              value={formatMoney(recent.total, currency)}
            />
            <Figure
              label={<Trans id="goals.monthlyAverage">Monthly average</Trans>}
              value={
                recent.monthlyAverage === null
                  ? "—"
                  : formatMoney(recent.monthlyAverage, currency)
              }
              hint={
                planned === null ? null : (
                  <Trans id="goals.plannedHint">
                    Planned: {formatMoney(planned, currency)}
                  </Trans>
                )
              }
            />
            <Figure
              label={
                <Trans id="goals.monthsWithContribution">
                  Months with new money
                </Trans>
              }
              value={
                <Trans id="goals.monthsOf">
                  {recent.monthsWithContribution} of {recent.months}
                </Trans>
              }
            />
            <Figure
              label={<Trans id="goals.thisMonth">This month so far</Trans>}
              value={formatSignedMoney(contributions.currentMonth, currency)}
            />
          </div>

          <ChartContainer
            config={config}
            className="aspect-auto h-[240px] w-full"
            role="img"
            aria-label={i18n._(
              t({
                id: "goals.contributionsChartLabel",
                message:
                  "Net contribution per month; the yearly table below lists the same totals",
              }),
            )}
          >
            <BarChart data={rows} margin={{ left: 4, right: 12, top: 12 }}>
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
                width={62}
                tickCount={5}
                tickFormatter={(value: number) =>
                  formatCompactMoney(value, currency)
                }
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              {plannedValue !== null && plannedValue > 0 ? (
                <ReferenceLine
                  y={plannedValue}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={{
                    value: t({ id: "goals.planLine", message: "Plan" }),
                    position: "insideTopRight",
                    fill: "var(--muted-foreground)",
                    fontSize: 11,
                  }}
                />
              ) : null}
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_label, payload) =>
                      (payload?.[0]?.payload as ContributionRow | undefined)
                        ?.fullLabel ?? ""
                    }
                    formatter={(_value, _name, item) => {
                      const row = item.payload as ContributionRow | undefined;

                      if (!row) {
                        return null;
                      }

                      return (
                        <div className="w-full space-y-1.5">
                          <TooltipRow
                            color={
                              row.amount < 0
                                ? "var(--loss)"
                                : "var(--chart-primary)"
                            }
                            label={
                              <Trans id="goals.contributed">Contributed</Trans>
                            }
                            value={formatSignedMoney(
                              String(row.amount),
                              currency,
                            )}
                          />
                          {planned !== null ? (
                            <TooltipRow
                              color="var(--muted-foreground)"
                              dashed
                              label={<Trans id="goals.planLine">Plan</Trans>}
                              value={formatMoney(planned, currency)}
                            />
                          ) : null}
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey="amount" radius={2} maxBarSize={28}>
                {rows.map((row) => (
                  <Cell
                    key={row.key}
                    fill={
                      row.amount < 0 ? "var(--loss)" : "var(--chart-primary)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans id="goals.table.year">Year</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans id="goals.contributed">Contributed</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...contributions.years].reverse().map((year) => (
                  <TableRow key={year.year}>
                    <TableCell className="tabular-nums">{year.year}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        year.amount.startsWith("-") && "text-loss",
                      )}
                    >
                      {formatMoney(year.amount, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                <Trans id="goals.contributionsCaveat">
                  There is no cash ledger, so a sale reinvested in a later month
                  shows as money taken out and then put back, and reinvested
                  dividends count as new money. Cash balance changes are not
                  trades and do not count.
                </Trans>
              </p>
              {notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
