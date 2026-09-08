import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { PortfolioSummary } from "@portifolio-tracker/shared";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import {
  formatMoney,
  formatQuantity,
  formatSignedPercent,
  pnlClassName,
} from "@/lib/format";
import { signedOrZero } from "./shared";

/** One cell of the summary strip. Every cell keeps the same three lines. */
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

export function SummaryStrip({
  summary,
  snapshotLabel,
}: {
  summary: PortfolioSummary;
  snapshotLabel: string;
}) {
  useLingui();

  const breakdown = summary.totalsByCurrency
    .map((total) => formatMoney(total.investedCost, total.currency))
    .join(" + ");

  const meta = [
    t({
      id: "positions.openCount",
      message: plural(
        { count: summary.openPositions },
        { one: "# open position", other: "# open positions" },
      ),
    }),
    summary.closedPositions > 0
      ? t({
          id: "positions.closedCount",
          message: plural(
            { count: summary.closedPositions },
            { one: "# closed position", other: "# closed positions" },
          ),
        })
      : null,
    summary.unquotedPositions > 0
      ? t({
          id: "positions.unquotedCount",
          message: plural(
            { count: summary.unquotedPositions },
            { one: "# without a quote", other: "# without a quote" },
          ),
        })
      : null,
    summary.usdBrlRate
      ? `1 USD = ${formatQuantity(summary.usdBrlRate)} BRL`
      : null,
    breakdown ? nativeTotalsLabel(breakdown) : null,
  ].filter((entry): entry is string => entry != null);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid divide-y sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
        <Metric
          label={<Trans id="positions.marketValue">Market value</Trans>}
          value={formatMoney(summary.totalMarketValue, summary.displayCurrency)}
          hint={
            <Trans id="positions.marketValueHint">
              Quoted equity at {snapshotLabel}.
            </Trans>
          }
        />
        <Metric
          label={<Trans id="positions.investedCost">Invested cost</Trans>}
          value={formatMoney(summary.totalInvested, summary.displayCurrency)}
          hint={
            <Trans id="positions.investedCostHint">
              Cost basis of everything you still hold.
            </Trans>
          }
        />
        <Metric
          label={<Trans id="positions.unrealizedPnl">Open result</Trans>}
          value={signedOrZero(
            summary.totalUnrealizedPnl,
            summary.displayCurrency,
          )}
          valueClassName={pnlClassName(summary.totalUnrealizedPnl)}
          hint={
            summary.totalUnrealizedPnlPercent ? (
              <span className={pnlClassName(summary.totalUnrealizedPnl)}>
                {formatSignedPercent(summary.totalUnrealizedPnlPercent)}
              </span>
            ) : (
              <Trans id="positions.unrealizedPnlHint">
                Market value against the cost of quoted assets.
              </Trans>
            )
          }
        />
        <Metric
          label={<Trans id="positions.realizedPnl">Realized P&L</Trans>}
          value={signedOrZero(
            summary.totalRealizedPnl,
            summary.displayCurrency,
          )}
          valueClassName={pnlClassName(summary.totalRealizedPnl)}
          hint={
            <Trans id="positions.realizedPnlHint">
              Result already locked in by your sells.
            </Trans>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
        {meta.map((entry, index) => (
          <span key={entry} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span className="tabular-nums">{entry}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

/** Native subtotals line of the summary meta strip. */
function nativeTotalsLabel(breakdown: string): string {
  return t({
    id: "positions.nativeTotals",
    message: `Native totals: ${breakdown}`,
  });
}
