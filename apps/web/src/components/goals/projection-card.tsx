import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { GoalScenario } from "@portifolio-tracker/shared";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { TooltipRow } from "@/components/performance/performance-primitives";
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
  formatPercentAxis,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { durationLabel, type GoalOverview, monthKeyLabel } from "./types";

type ProjectionRow = {
  month: string;
  /** Calendar year of the point; one point per year. */
  label: string;
  conservative: number;
  base: number;
  optimistic: number;
  /** Conservative to optimistic, drawn as one band. */
  band: [number, number];
};

function scenarioLabel(scenario: GoalScenario): ReactNode {
  switch (scenario) {
    case "conservative":
      return <Trans id="goals.scenario.conservative">Conservative</Trans>;
    case "base":
      return <Trans id="goals.scenario.base">Base</Trans>;
    case "optimistic":
      return <Trans id="goals.scenario.optimistic">Optimistic</Trans>;
  }
}

function LegendSwatch({ kind }: { kind: "line" | "band" | "dashed" }) {
  if (kind === "band") {
    return (
      <span
        className="h-2.5 w-4 rounded-[2px] bg-[var(--chart-primary)] opacity-25"
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className={cn(
        "w-4 border-t-2",
        kind === "dashed"
          ? "border-dashed border-muted-foreground"
          : "border-[var(--chart-primary)]",
      )}
      aria-hidden="true"
    />
  );
}

/**
 * Where the planned contribution takes the portfolio under each real-return
 * scenario: the base case as a line, conservative to optimistic as a band.
 */
export function ProjectionCard({ overview }: { overview: GoalOverview }) {
  const { i18n } = useLingui();
  const projection = overview.projection;
  const goal = overview.goal;
  const currency = overview.displayCurrency as CurrencyCode;

  const rows = useMemo<ProjectionRow[]>(() => {
    if (!projection) {
      return [];
    }

    const byScenario = new Map(
      projection.scenarios.map((entry) => [entry.scenario, entry.points]),
    );
    const base = byScenario.get("base") ?? [];

    return base.map((point, index) => {
      const value = (scenario: GoalScenario) =>
        Number(byScenario.get(scenario)?.[index]?.value ?? point.value);
      const conservative = value("conservative");
      const optimistic = value("optimistic");

      return {
        month: point.month,
        label: point.month.slice(0, 4),
        conservative,
        base: Number(point.value),
        optimistic,
        band: [conservative, optimistic],
      };
    });
  }, [projection]);

  if (!projection || !goal) {
    return null;
  }

  const target = Number(projection.targetValue);
  const targetYear = goal.targetMonth?.slice(0, 4) ?? null;
  const targetMonth = goal.targetMonth
    ? monthKeyLabel(goal.targetMonth, i18n.locale)
    : null;
  const planned = overview.plannedMonthlyContribution
    ? formatMoney(overview.plannedMonthlyContribution, currency)
    : formatMoney("0", currency);
  const dated =
    projection.monthsToTargetMonth !== null &&
    projection.monthsToTargetMonth > 0;

  const config: ChartConfig = {
    base: {
      label: t({ id: "goals.scenario.base", message: "Base" }),
      color: "var(--chart-primary)",
    },
    band: {
      label: t({ id: "goals.range", message: "Conservative to optimistic" }),
      color: "var(--chart-primary)",
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="goals.projectionTitle">Projection</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="goals.projectionDescription">
            {planned} a month on top of today&apos;s portfolio. Returns are real
            (above inflation), so every amount is in today&apos;s money.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <LegendSwatch kind="line" />
            <Trans id="goals.legendBase">Base scenario</Trans>
          </li>
          <li className="flex items-center gap-1.5">
            <LegendSwatch kind="band" />
            <Trans id="goals.range">Conservative to optimistic</Trans>
          </li>
          <li className="flex items-center gap-1.5">
            <LegendSwatch kind="dashed" />
            <Trans id="goals.legendGoal">Goal</Trans>
          </li>
        </ul>

        <ChartContainer
          config={config}
          className="aspect-auto h-[300px] w-full"
          role="img"
          aria-label={i18n._(
            t({
              id: "goals.chartLabel",
              message:
                "Projected portfolio value per year under three real-return scenarios, with the goal as a horizontal line",
            }),
          )}
        >
          <ComposedChart data={rows} margin={{ left: 4, right: 12, top: 12 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={16}
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
            <Area
              dataKey="band"
              type="monotone"
              stroke="none"
              fill="var(--chart-primary)"
              fillOpacity={0.14}
              activeDot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="base"
              type="monotone"
              stroke="var(--chart-primary)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <ReferenceLine
              y={target}
              stroke="var(--muted-foreground)"
              strokeDasharray="5 4"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
            />
            {targetYear && rows.some((row) => row.label === targetYear) ? (
              <ReferenceLine
                x={targetYear}
                stroke="var(--muted-foreground)"
                strokeOpacity={0.6}
                label={{
                  value: targetMonth ?? "",
                  position: "insideTopLeft",
                  fill: "var(--muted-foreground)",
                  fontSize: 11,
                }}
              />
            ) : null}
            <ChartTooltip
              cursor={{ stroke: "var(--border)" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_label, payload) => {
                    const row = payload?.[0]?.payload as
                      | ProjectionRow
                      | undefined;

                    return row ? monthKeyLabel(row.month, i18n.locale) : "";
                  }}
                  formatter={(_value, name, item) => {
                    const row = item.payload as ProjectionRow | undefined;

                    // One block for the whole point, attached to the line.
                    if (!row || name !== "base") {
                      return null;
                    }

                    return (
                      <div className="w-full space-y-1.5">
                        <TooltipRow
                          color="var(--chart-primary)"
                          label={scenarioLabel("optimistic")}
                          value={formatMoney(String(row.optimistic), currency)}
                        />
                        <TooltipRow
                          color="var(--chart-primary)"
                          label={scenarioLabel("base")}
                          value={formatMoney(String(row.base), currency)}
                        />
                        <TooltipRow
                          color="var(--chart-primary)"
                          label={scenarioLabel("conservative")}
                          value={formatMoney(
                            String(row.conservative),
                            currency,
                          )}
                        />
                        <TooltipRow
                          color="var(--muted-foreground)"
                          dashed
                          label={<Trans id="goals.legendGoal">Goal</Trans>}
                          value={formatMoney(projection.targetValue, currency)}
                        />
                      </div>
                    );
                  }}
                />
              }
            />
          </ComposedChart>
        </ChartContainer>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans id="goals.table.scenario">Scenario</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="goals.table.return">Real return</Trans>
                </TableHead>
                <TableHead>
                  <Trans id="goals.table.reaches">Reaches the goal</Trans>
                </TableHead>
                {dated ? (
                  <>
                    <TableHead className="text-right">
                      <Trans id="goals.table.valueAt">
                        Value in {targetMonth}
                      </Trans>
                    </TableHead>
                    <TableHead className="text-right">
                      <Trans id="goals.table.needed">
                        Needed per month for {targetMonth}
                      </Trans>
                    </TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {projection.scenarios.map((entry) => (
                <TableRow key={entry.scenario}>
                  <TableCell className="font-medium">
                    {scenarioLabel(entry.scenario)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Trans id="goals.perYear">
                      {formatPercentAxis(Number(entry.annualReturn))} a year
                    </Trans>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {entry.monthsToTarget === 0 ? (
                      <Trans id="goals.reached">Reached</Trans>
                    ) : entry.reachMonth && entry.monthsToTarget ? (
                      <span>
                        {monthKeyLabel(entry.reachMonth, i18n.locale)}{" "}
                        <span className="text-muted-foreground">
                          ({durationLabel(entry.monthsToTarget, i18n)})
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        <Trans id="goals.notReached">Beyond 60 years</Trans>
                      </span>
                    )}
                  </TableCell>
                  {dated ? (
                    <>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          entry.onTrack ? "text-gain" : undefined,
                        )}
                      >
                        {entry.valueAtTargetMonth
                          ? formatMoney(entry.valueAtTargetMonth, currency)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {entry.requiredMonthlyContribution
                          ? formatMoney(
                              entry.requiredMonthlyContribution,
                              currency,
                            )
                          : "—"}
                      </TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {projection.monthsToTargetMonth !== null &&
        projection.monthsToTargetMonth < 0 ? (
          <p className="text-xs text-muted-foreground">
            <Trans id="goals.targetPast">
              The target month {targetMonth} has passed; set a new one to see
              what it takes to get there.
            </Trans>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
