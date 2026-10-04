import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { HeatLegend } from "@/components/analysis/primitives";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type CurrencyCode,
  formatMoney,
  formatSignedPercent,
  pnlClassName,
} from "@/lib/format";
import { heatTint } from "@/lib/heat";
import { cn } from "@/lib/utils";
import { NoReturnYet } from "./performance-primitives";
import { MonthlyReturnChart } from "./return-cards";
import {
  MONTH_HEAT_CAP,
  type MonthRow,
  type PerformanceSummary,
  type PerformanceYear,
  shortMonthName,
  signedOrZero,
} from "./types";

type View = "calendar" | "statement" | "chart";

const MONTHS = Array.from({ length: 12 }, (_, index) => index);

/**
 * Month-by-month returns three ways: a year × month calendar, a statement
 * with the money behind each month, and a bar chart.
 */
export function MonthlyReturnsCard({
  rows,
  years,
  summary,
}: {
  rows: MonthRow[];
  years: PerformanceYear[];
  summary: PerformanceSummary;
}) {
  const [view, setView] = useState<View>("calendar");
  const currency = summary.displayCurrency;
  const hasReturns = rows.some((row) => row.monthlyReturn != null);

  return (
    <Card>
      <Tabs value={view} onValueChange={(value) => setView(value as View)}>
        <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <CardTitle>
              <Trans id="performance.monthlyTitle">Monthly return</Trans>
            </CardTitle>
            <CardDescription>
              <Trans id="performance.monthlyHint">
                How each month performed on its own, contributions weighted by
                the days they were invested.
              </Trans>
            </CardDescription>
          </div>
          <div className="shrink-0">
            <TabsList>
              <TabsTrigger value="calendar">
                <Trans id="performance.tabCalendar">Calendar</Trans>
              </TabsTrigger>
              <TabsTrigger value="statement">
                <Trans id="performance.tabStatement">Statement</Trans>
              </TabsTrigger>
              <TabsTrigger value="chart">
                <Trans id="performance.tabChart">Chart</Trans>
              </TabsTrigger>
            </TabsList>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {!hasReturns ? (
            <NoReturnYet />
          ) : (
            <>
              <TabsContent value="calendar" className="space-y-3">
                <ReturnCalendar rows={rows} years={years} currency={currency} />
                <div className="flex justify-end">
                  <HeatLegend cap={MONTH_HEAT_CAP} />
                </div>
              </TabsContent>
              <TabsContent value="statement">
                <MonthlyStatement rows={rows} summary={summary} />
              </TabsContent>
              <TabsContent value="chart">
                <MonthlyReturnChart rows={rows} currency={currency} />
              </TabsContent>
            </>
          )}
        </CardContent>
      </Tabs>
    </Card>
  );
}

function ReturnCalendar({
  rows,
  years,
  currency,
}: {
  rows: MonthRow[];
  years: PerformanceYear[];
  currency: CurrencyCode;
}) {
  const { i18n } = useLingui();
  const byKey = useMemo(
    () => new Map(rows.map((row) => [row.key, row])),
    [rows],
  );
  const ordered = [...years].sort((a, b) => b.year - a.year);

  return (
    <Table className="[&_td]:h-11 [&_td]:px-1 [&_th]:px-1">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-14 text-muted-foreground">
            <Trans id="performance.colYear">Year</Trans>
          </TableHead>
          {MONTHS.map((month) => (
            <TableHead
              key={month}
              className="text-center text-muted-foreground capitalize"
            >
              {shortMonthName(month, i18n.locale).replace(".", "")}
            </TableHead>
          ))}
          <TableHead className="text-center text-foreground">
            <Trans id="performance.colYearTotal">Year</Trans>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordered.map((year) => (
          <TableRow key={year.year} className="hover:bg-transparent">
            <TableCell className="font-medium tabular-nums">
              {year.year}
            </TableCell>
            {MONTHS.map((month) => {
              const key = `${year.year}-${String(month + 1).padStart(2, "0")}`;
              const row = byKey.get(key);
              const value = row?.monthlyReturn ?? null;

              return (
                <TableCell key={key} className="p-0.5">
                  <div
                    className={cn(
                      "flex h-9 min-w-12 items-center justify-center rounded-md text-xs tabular-nums",
                      value == null && "text-muted-foreground/50",
                    )}
                    style={{
                      backgroundColor:
                        heatTint(value, MONTH_HEAT_CAP) ??
                        (value == null ? undefined : "var(--muted)"),
                    }}
                    title={
                      row && value != null && row.result != null
                        ? `${row.fullLabel}: ${formatSignedPercent(String(value))} · ${signedOrZero(String(row.result), currency)}`
                        : undefined
                    }
                  >
                    {value == null ? "·" : formatSignedPercent(String(value))}
                  </div>
                </TableCell>
              );
            })}
            <TableCell className="p-0.5">
              <div
                className={cn(
                  "flex h-9 min-w-14 flex-col items-center justify-center rounded-md border text-xs font-semibold tabular-nums",
                  pnlClassName(year.return),
                )}
                title={signedOrZero(year.result, currency)}
              >
                {formatSignedPercent(year.return)}
                {year.months < 12 ? (
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {i18n._(
                      t({
                        id: "performance.partialYearMonths",
                        message: plural(
                          { count: year.months },
                          { one: "# month", other: "# months" },
                        ),
                      }),
                    )}
                  </span>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MonthlyStatement({
  rows,
  summary,
}: {
  rows: MonthRow[];
  summary: PerformanceSummary;
}) {
  const currency = summary.displayCurrency;
  const ordered = [...rows].reverse();

  return (
    <Table className="[&_tbody_td]:h-10 [&_tfoot_td]:h-10">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-muted-foreground">
            <Trans id="performance.colMonth">Month</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colEndValue">Value at month end</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colContributions">Contributions</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.monthResult">Result</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colReturn">Return</Trans>
          </TableHead>
          <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
            <Trans id="performance.colAccumulated">Accumulated</Trans>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordered.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="font-medium capitalize">
              {row.fullLabel}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMoney(String(row.marketValue), currency)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">
              {row.netFlow === 0
                ? "—"
                : signedOrZero(String(row.netFlow), currency)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                row.result == null
                  ? "text-muted-foreground"
                  : pnlClassName(String(row.result)),
              )}
            >
              {row.result == null
                ? "—"
                : signedOrZero(String(row.result), currency)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-medium tabular-nums",
                row.monthlyReturn == null
                  ? "text-muted-foreground"
                  : pnlClassName(String(row.monthlyReturn)),
              )}
            >
              {row.monthlyReturn == null
                ? "—"
                : formatSignedPercent(String(row.monthlyReturn))}
            </TableCell>
            <TableCell
              className={cn(
                "hidden text-right tabular-nums sm:table-cell",
                row.cumulativeReturn == null
                  ? "text-muted-foreground"
                  : pnlClassName(String(row.cumulativeReturn)),
              )}
            >
              {row.cumulativeReturn == null
                ? "—"
                : formatSignedPercent(String(row.cumulativeReturn))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-medium">
            <Trans id="performance.windowTotal">Window</Trans>
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {ordered[0]
              ? formatMoney(String(ordered[0].marketValue), currency)
              : "—"}
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {signedOrZero(summary.netInvested, currency)}
          </TableCell>
          <TableCell
            className={cn(
              "text-right font-semibold tabular-nums",
              summary.windowResult
                ? pnlClassName(summary.windowResult)
                : "text-muted-foreground",
            )}
          >
            {summary.windowResult
              ? signedOrZero(summary.windowResult, currency)
              : "—"}
          </TableCell>
          <TableCell
            className={cn(
              "text-right font-semibold tabular-nums",
              summary.cumulativeReturn
                ? pnlClassName(summary.cumulativeReturn)
                : "text-muted-foreground",
            )}
          >
            {summary.cumulativeReturn
              ? formatSignedPercent(summary.cumulativeReturn)
              : "—"}
          </TableCell>
          <TableCell className="hidden sm:table-cell" />
        </TableRow>
      </TableFooter>
    </Table>
  );
}
