import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { PortfolioSummary } from "@portifolio-tracker/shared";
import { Stat, StatStrip } from "@/components/analysis/primitives";
import {
  formatMoney,
  formatQuantity,
  formatSignedPercent,
  pnlClassName,
} from "@/lib/format";
import { signedOrZero } from "./shared";

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
    <StatStrip
      className="sm:grid-cols-2 lg:grid-cols-4"
      footer={
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {meta.map((entry, index) => (
            <span key={entry} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              <span className="tabular-nums">{entry}</span>
            </span>
          ))}
        </div>
      }
    >
      <Stat
        label={<Trans id="positions.marketValue">Market value</Trans>}
        value={formatMoney(summary.totalMarketValue, summary.displayCurrency)}
        hint={
          <Trans id="positions.marketValueHint">
            Quoted equity at {snapshotLabel}.
          </Trans>
        }
      />
      <Stat
        label={<Trans id="positions.investedCost">Invested cost</Trans>}
        value={formatMoney(summary.totalInvested, summary.displayCurrency)}
        hint={
          <Trans id="positions.investedCostHint">
            Cost basis of everything you still hold.
          </Trans>
        }
      />
      <Stat
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
      <Stat
        label={<Trans id="positions.realizedPnl">Realized P&L</Trans>}
        value={signedOrZero(summary.totalRealizedPnl, summary.displayCurrency)}
        valueClassName={pnlClassName(summary.totalRealizedPnl)}
        hint={
          <Trans id="positions.realizedPnlHint">
            Result already locked in by your sells.
          </Trans>
        }
      />
    </StatStrip>
  );
}

/** Native subtotals line of the summary meta strip. */
function nativeTotalsLabel(breakdown: string): string {
  return t({
    id: "positions.nativeTotals",
    message: `Native totals: ${breakdown}`,
  });
}
