import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { TriangleAlert } from "lucide-react";
import { BreadthBar, Stat, StatStrip } from "@/components/analysis/primitives";
import {
  formatMoney,
  formatQuantity,
  formatSignedPercentPrecise,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { type DailyData, signedOrZero } from "./types";

export function DailySummary({ data }: { data: DailyData }) {
  const { i18n } = useLingui();
  const { summary } = data;
  const currency = summary.displayCurrency;
  const dailyChange = summary.dailyChange;
  const compared = summary.comparablePositions;
  const partialCoverage =
    summary.openPositions > 0 &&
    summary.comparablePositions < summary.openPositions;
  const asOf = summary.asOf ? formatTradeDate(summary.asOf) : null;
  const showFx = summary.usdBrlRate != null && summary.dailyFxChange != null;

  return (
    <StatStrip
      className={cn(
        "sm:grid-cols-2",
        showFx ? "lg:grid-cols-4" : "lg:grid-cols-3",
      )}
      footer={
        <p
          className={cn(
            "flex items-start gap-2",
            partialCoverage && "text-foreground",
          )}
        >
          {partialCoverage ? (
            <TriangleAlert
              className="mt-px size-3.5 shrink-0 text-caution"
              aria-hidden="true"
            />
          ) : null}
          <span>
            {i18n._(
              t({
                id: "daily.comparisonCoverageCount",
                message: plural(
                  { count: summary.openPositions },
                  {
                    one: `Daily change covers ${compared} of # open asset; cash is included in the value.`,
                    other: `Daily change covers ${compared} of # open assets; cash is included in the value.`,
                  },
                ),
              }),
            )}{" "}
            <Trans id="daily.comparisonConsolidation">
              Values are consolidated in {summary.displayCurrency}, with
              yesterday converted at that session's USD/BRL rate.
            </Trans>
          </span>
        </p>
      }
    >
      <Stat
        label={<Trans id="daily.dayChange">Day change</Trans>}
        value={dailyChange === null ? "—" : signedOrZero(dailyChange, currency)}
        valueClassName={cn(
          "text-2xl",
          dailyChange === null ? undefined : pnlClassName(dailyChange),
        )}
        hint={
          dailyChange === null ? (
            <Trans id="daily.insufficientData">
              Not enough data: no asset has a previous close to compare.
            </Trans>
          ) : summary.dailyChangePercent ? (
            <span
              className={cn(
                "font-medium",
                pnlClassName(summary.dailyChangePercent),
              )}
            >
              {formatSignedPercentPrecise(summary.dailyChangePercent)}
            </span>
          ) : null
        }
      />
      <Stat
        label={<Trans id="daily.portfolioValue">Portfolio value</Trans>}
        value={formatMoney(summary.marketValue, currency)}
        hint={
          asOf ? (
            <Trans id="daily.quotedAt">Latest quotes from {asOf}.</Trans>
          ) : (
            <Trans id="daily.noQuoteDate">No live quotes available.</Trans>
          )
        }
      />
      {showFx && summary.usdBrlRate ? (
        <Stat
          label={<Trans id="daily.usdBrl">Dollar (USD/BRL)</Trans>}
          value={formatQuantity(summary.usdBrlRate)}
          hint={
            <span className="space-x-1.5">
              {summary.usdBrlChangePercent ? (
                <span
                  className={cn(
                    "font-medium",
                    pnlClassName(summary.usdBrlChangePercent),
                  )}
                >
                  {formatSignedPercentPrecise(summary.usdBrlChangePercent)}
                </span>
              ) : null}
              <span>
                <Trans id="daily.fxEffect">
                  FX effect{" "}
                  {signedOrZero(summary.dailyFxChange ?? "0", currency)}
                </Trans>
              </span>
            </span>
          }
        />
      ) : null}
      <Stat
        label={<Trans id="daily.marketBreadth">Market breadth</Trans>}
        value={i18n._(
          t({
            id: "daily.assetsCompared",
            message: plural(
              { count: summary.comparablePositions },
              {
                one: "# asset compared",
                other: "# assets compared",
              },
            ),
          }),
        )}
        valueClassName="text-base"
      >
        <BreadthBar
          advancing={summary.advancing}
          declining={summary.declining}
          unchanged={summary.unchanged}
        />
      </Stat>
    </StatStrip>
  );
}
