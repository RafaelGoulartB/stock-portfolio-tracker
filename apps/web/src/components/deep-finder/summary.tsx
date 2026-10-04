import { Trans } from "@lingui/react/macro";
import type { DeepFinderWindow } from "@portifolio-tracker/shared";
import { BreadthBar, Stat, StatStrip } from "@/components/analysis/primitives";
import { AssetLink } from "@/components/asset-link";
import {
  formatSignedPercent,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  percentOf,
  signedOrZero,
  type WindowSummary,
  type WindowsRow,
} from "./types";

export function FinderSummary({
  window,
  summary,
  rows,
}: {
  window: DeepFinderWindow;
  summary: WindowSummary;
  rows: WindowsRow[];
}) {
  const totals = summary.summary;
  const currency = totals.displayCurrency;
  const hasComparison = totals.comparable > 0;
  const ranked = rows
    .filter((row) => percentOf(row, window) != null)
    .sort((a, b) => (percentOf(b, window) ?? 0) - (percentOf(a, window) ?? 0));
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  const startLabel = summary.windowStart
    ? formatTradeDate(summary.windowStart)
    : null;

  return (
    <StatStrip className="sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label={<Trans id="deepFinder.periodMove">Period move</Trans>}
        value={hasComparison ? signedOrZero(totals.totalChange, currency) : "—"}
        valueClassName={cn(
          "text-2xl",
          hasComparison && pnlClassName(totals.totalChange),
        )}
        hint={
          <span className="space-x-1.5">
            {totals.totalChangePercent ? (
              <span
                className={cn(
                  "font-medium",
                  pnlClassName(totals.totalChangePercent),
                )}
              >
                {formatSignedPercent(totals.totalChangePercent)}
              </span>
            ) : null}
            <span>
              {window === "cost" ? (
                <Trans id="deepFinder.costHint">
                  Market value versus moving average cost.
                </Trans>
              ) : (
                <Trans id="deepFinder.periodHint">
                  Compared with the close on or before {startLabel}.
                </Trans>
              )}
            </span>
          </span>
        }
      />
      <Stat
        label={<Trans id="deepFinder.breadth">Breadth</Trans>}
        value={
          <Trans id="deepFinder.comparableCount">
            {totals.comparable} of {totals.openPositions} compared
          </Trans>
        }
        valueClassName="text-base"
      >
        <BreadthBar
          advancing={totals.advancing}
          declining={totals.declining}
          unchanged={totals.unchanged}
        />
      </Stat>
      <MoverStat
        label={<Trans id="deepFinder.best">Best performer</Trans>}
        row={best}
        window={window}
      />
      <MoverStat
        label={<Trans id="deepFinder.worst">Worst performer</Trans>}
        row={worst}
        window={window}
      />
    </StatStrip>
  );
}

function MoverStat({
  label,
  row,
  window,
}: {
  label: React.ReactNode;
  row: WindowsRow | undefined;
  window: DeepFinderWindow;
}) {
  const move = row?.moves[window];

  return (
    <Stat
      label={label}
      value={
        row ? (
          <AssetLink ticker={row.ticker} className="font-semibold">
            {row.ticker}
          </AssetLink>
        ) : (
          "—"
        )
      }
      hint={
        row && move?.changePercent && move.change ? (
          <span className={pnlClassName(move.changePercent)}>
            {formatSignedPercent(move.changePercent)} ·{" "}
            {signedOrZero(move.change, row.displayCurrency)}
          </span>
        ) : null
      }
    />
  );
}
