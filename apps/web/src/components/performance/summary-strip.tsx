import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { PerformanceWindow } from "@portifolio-tracker/shared";
import { Stat, StatStrip } from "@/components/analysis/primitives";
import {
  formatMoney,
  formatQuantity,
  formatSignedPercent,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { type PerformanceSummary, signedOrZero } from "./types";

export function SummaryStrip({
  summary,
  months,
}: {
  summary: PerformanceSummary;
  months: PerformanceWindow;
}) {
  const { i18n } = useLingui();
  const currency = summary.displayCurrency;
  const asOf = formatTradeDate(summary.asOf);
  const cash = formatMoney(summary.cashValue, currency);
  const fixedIncome = formatMoney(summary.fixedIncomeValue, currency);

  const meta = [
    i18n._(
      t({
        id: "performance.monthsCovered",
        message: plural(
          { count: summary.monthsWithReturn },
          { one: "# month with return", other: "# months with return" },
        ),
      }),
    ),
    summary.positiveMonths + summary.negativeMonths > 0
      ? `${summary.positiveMonths} ↑ · ${summary.negativeMonths} ↓`
      : null,
    summary.unquotedPositions > 0
      ? i18n._(
          t({
            id: "performance.atCostCount",
            message: plural(
              { count: summary.unquotedPositions },
              {
                one: "# asset carried at cost",
                other: "# assets carried at cost",
              },
            ),
          }),
        )
      : null,
    summary.usdBrlRate
      ? `1 USD = ${formatQuantity(summary.usdBrlRate)} BRL`
      : null,
    Number(summary.cashValue) !== 0
      ? i18n._(
          t({
            id: "performance.cashIncluded",
            message: `Today's totals include ${cash} of cash; monthly charts and returns do not, because only the current cash balance is stored`,
          }),
        )
      : null,
    Number(summary.fixedIncomeValue) !== 0
      ? i18n._(
          t({
            id: "performance.fixedIncomeIncluded",
            message: `Fixed income (${fixedIncome}) counts in today's value only: it is a balance you maintain, with no calculated return or monthly history`,
          }),
        )
      : null,
  ].filter((entry): entry is string => entry != null);

  return (
    <StatStrip
      className="sm:grid-cols-2 lg:grid-cols-5"
      footer={meta.join(" · ")}
    >
      <Stat
        label={<Trans id="performance.portfolioValue">Portfolio value</Trans>}
        value={formatMoney(summary.currentValue, currency)}
        hint={<Trans id="performance.valuedAt">Valued at {asOf}.</Trans>}
      />
      <Stat
        label={
          <Trans id="performance.windowReturn">Return in the window</Trans>
        }
        value={
          summary.cumulativeReturn == null
            ? "—"
            : formatSignedPercent(summary.cumulativeReturn)
        }
        valueClassName={
          summary.cumulativeReturn == null
            ? undefined
            : pnlClassName(summary.cumulativeReturn)
        }
        hint={
          <span className="space-x-1.5">
            {summary.windowResult ? (
              <span
                className={cn(
                  "font-medium",
                  pnlClassName(summary.windowResult),
                )}
              >
                {signedOrZero(summary.windowResult, currency)}
              </span>
            ) : null}
            <span>
              {summary.annualizedReturn == null ? (
                <Trans id="performance.timeWeighted">
                  Time-weighted, contributions removed.
                </Trans>
              ) : (
                <Trans id="performance.annualized">
                  {formatSignedPercent(summary.annualizedReturn)} per year.
                </Trans>
              )}
            </span>
          </span>
        }
      />
      <Stat
        label={<Trans id="performance.openResult">Open result</Trans>}
        value={signedOrZero(summary.unrealizedPnl, currency)}
        valueClassName={pnlClassName(summary.unrealizedPnl)}
        hint={
          summary.unrealizedPnlPercent == null ? (
            <Trans id="performance.overCost">Over the cost basis.</Trans>
          ) : (
            <span className={pnlClassName(summary.unrealizedPnl)}>
              {formatSignedPercent(summary.unrealizedPnlPercent)}
            </span>
          )
        }
      />
      <Stat
        label={<Trans id="performance.netInvested">Net contributions</Trans>}
        value={formatMoney(summary.netInvested, currency)}
        hint={
          <Trans id="performance.realizedInWindow">
            {signedOrZero(summary.realizedPnl, currency)} realized.
          </Trans>
        }
      />
      <Stat
        label={<Trans id="performance.maxDrawdown">Max drawdown</Trans>}
        value={
          summary.maxDrawdown == null
            ? "—"
            : formatSignedPercent(summary.maxDrawdown)
        }
        valueClassName={
          summary.maxDrawdown == null || Number(summary.maxDrawdown) === 0
            ? undefined
            : "text-loss"
        }
        hint={
          summary.worstMonth ? (
            <Trans id="performance.worstMonth">
              Worst month{" "}
              {formatSignedPercent(summary.worstMonth.returnPercent)}.
            </Trans>
          ) : (
            <Trans id="performance.lastMonths">
              Over the last {months} months.
            </Trans>
          )
        }
      />
    </StatStrip>
  );
}
