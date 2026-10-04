import { Trans } from "@lingui/react/macro";
import type { DeepFinderWindow } from "@portifolio-tracker/shared";
import type { ReactNode } from "react";
import { DivergingBar } from "@/components/analysis/primitives";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatSignedPercent, pnlClassName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { signedOrZero, type WindowsRow, windowLabel } from "./types";

const MOVER_LIMIT = 5;

function changeOf(row: WindowsRow, window: DeepFinderWindow): number | null {
  const change = row.moves[window].change;

  return change == null ? null : Number(change);
}

/** Holdings that added or removed the most money over the window. */
export function MoneyMovers({
  rows,
  window,
}: {
  rows: WindowsRow[];
  window: DeepFinderWindow;
}) {
  const compared = rows
    .filter((row) => changeOf(row, window) != null)
    .sort((a, b) => (changeOf(b, window) ?? 0) - (changeOf(a, window) ?? 0));
  const gains = compared
    .filter((row) => (changeOf(row, window) ?? 0) > 0)
    .slice(0, MOVER_LIMIT);
  const losses = compared
    .filter((row) => (changeOf(row, window) ?? 0) < 0)
    .slice(-MOVER_LIMIT)
    .reverse();
  const largest = Math.max(
    0,
    ...[...gains, ...losses].map((row) => Math.abs(changeOf(row, window) ?? 0)),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="deepFinder.moversTitle">Where the money moved</Trans>
        </CardTitle>
        <CardDescription>
          {window === "cost" ? (
            <Trans id="deepFinder.moversCostHint">
              Holdings with the largest open result in money. A big position
              moving a little can matter more than a small one moving a lot.
            </Trans>
          ) : (
            <Trans id="deepFinder.moversHint">
              Holdings that added or removed the most value over{" "}
              {windowLabel(window)}. A big position moving a little can matter
              more than a small one moving a lot.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <MoverColumn
          title={<Trans id="deepFinder.topGains">Largest gains</Trans>}
          rows={gains}
          window={window}
          largest={largest}
          empty={
            <Trans id="deepFinder.noGains">No holding gained value.</Trans>
          }
        />
        <MoverColumn
          title={<Trans id="deepFinder.topLosses">Largest losses</Trans>}
          rows={losses}
          window={window}
          largest={largest}
          empty={<Trans id="deepFinder.noLosses">No holding lost value.</Trans>}
        />
      </CardContent>
    </Card>
  );
}

function MoverColumn({
  title,
  rows,
  window,
  largest,
  empty,
}: {
  title: ReactNode;
  rows: WindowsRow[];
  window: DeepFinderWindow;
  largest: number;
  empty: ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const move = row.moves[window];

            return (
              <li key={row.ticker} className="space-y-1">
                <div className="flex items-center gap-2.5 text-sm">
                  <AssetLogo
                    ticker={row.ticker}
                    assetClass={row.assetClass}
                    currency={row.currency}
                  />
                  <AssetLink ticker={row.ticker} className="font-medium">
                    {row.ticker}
                  </AssetLink>
                  <span
                    className={cn(
                      "ml-auto tabular-nums",
                      pnlClassName(move.change ?? "0"),
                    )}
                  >
                    {signedOrZero(move.change ?? "0", row.displayCurrency)}
                  </span>
                  <span
                    className={cn(
                      "w-14 text-right text-xs tabular-nums",
                      pnlClassName(move.changePercent ?? "0"),
                    )}
                  >
                    {move.changePercent
                      ? formatSignedPercent(move.changePercent)
                      : "—"}
                  </span>
                </div>
                <DivergingBar
                  value={move.change == null ? null : Number(move.change)}
                  max={largest}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
