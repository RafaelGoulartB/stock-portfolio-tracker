import { Trans } from "@lingui/react/macro";
import { Stat, StatStrip } from "@/components/analysis/primitives";
import {
  formatMoney,
  formatSignedPercent,
  formatTradeDate,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DividendData } from "./types";

export function Summary({ data }: { data: DividendData }) {
  const { summary, income } = data;
  const currency = summary.displayCurrency;
  const nativeTotals = summary.nativeTotals
    .map((item) => formatMoney(item.amount, item.currency))
    .join(" + ");
  const hasPrevious =
    income.previous12m != null && Number(income.previous12m) > 0;
  const total = formatMoney(summary.convertedTotal, currency);
  const eventCount = summary.eventCount;

  return (
    <StatStrip
      className="sm:grid-cols-2 lg:grid-cols-4"
      footer={
        <Trans id="dividends.summaryFooter">
          {eventCount} events in the window, {total} in total · native:{" "}
          {nativeTotals}
        </Trans>
      }
    >
      <Stat
        label={<Trans id="dividends.trailing12m">Last 12 months</Trans>}
        value={formatMoney(income.trailing12m, currency)}
        valueClassName="text-2xl"
        hint={
          hasPrevious && income.trailing12mChange ? (
            <span>
              <span
                className={cn(
                  "font-medium",
                  pnlClassName(income.trailing12mChange),
                )}
              >
                {formatSignedPercent(income.trailing12mChange)}
              </span>{" "}
              <Trans id="dividends.vsPrevious">vs the 12 months before</Trans>
            </span>
          ) : (
            <Trans id="dividends.receivedHint">
              Estimated gross income already paid.
            </Trans>
          )
        }
      />
      <Stat
        label={<Trans id="dividends.monthlyAverage">Monthly average</Trans>}
        value={formatMoney(income.monthlyAverage, currency)}
        hint={
          <Trans id="dividends.monthlyAverageHint">
            The last 12 months divided by 12.
          </Trans>
        }
      />
      <Stat
        label={<Trans id="dividends.yieldOnCost">Yield on cost</Trans>}
        value={income.yieldOnCost ? formatWeight(income.yieldOnCost) : "—"}
        hint={
          <Trans id="dividends.yieldOnCostHint">
            12-month income over the cost of what you hold.
          </Trans>
        }
      />
      <Stat
        label={<Trans id="dividends.upcoming">Upcoming</Trans>}
        value={formatMoney(summary.convertedUpcoming, currency)}
        hint={
          summary.nextPaymentDate ? (
            <Trans id="dividends.upcomingNext">
              {summary.upcomingCount} events · next on{" "}
              {formatTradeDate(summary.nextPaymentDate)}
            </Trans>
          ) : (
            <Trans id="dividends.noneAnnounced">Nothing announced yet.</Trans>
          )
        }
      />
    </StatStrip>
  );
}
