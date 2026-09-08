import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { PerformanceWindow } from "@portifolio-tracker/shared";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import {
  formatMoney,
  formatQuantity,
  formatSignedPercent,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
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
  ].filter((entry): entry is string => entry != null);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid divide-y sm:grid-cols-2 sm:divide-x lg:grid-cols-5 lg:divide-y-0">
        <Metric
          label={<Trans id="performance.portfolioValue">Portfolio value</Trans>}
          value={formatMoney(summary.currentValue, currency)}
          hint={<Trans id="performance.valuedAt">Valued at {asOf}.</Trans>}
        />
        <Metric
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
            summary.annualizedReturn == null ? (
              <Trans id="performance.timeWeighted">
                Time-weighted, contributions removed.
              </Trans>
            ) : (
              <Trans id="performance.annualized">
                {formatSignedPercent(summary.annualizedReturn)} per year.
              </Trans>
            )
          }
        />
        <Metric
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
        <Metric
          label={<Trans id="performance.netInvested">Net contributions</Trans>}
          value={formatMoney(summary.netInvested, currency)}
          hint={
            <Trans id="performance.realizedInWindow">
              {signedOrZero(summary.realizedPnl, currency)} realized.
            </Trans>
          }
        />
        <Metric
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
      </div>
      <div className="border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
        {meta.join(" · ")}
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: ReactNode;
  value: string;
  valueClassName?: string;
  hint: ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1.5 text-xl font-semibold tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {hint}
      </p>
    </div>
  );
}
