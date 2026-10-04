import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { DivergingBar } from "@/components/analysis/primitives";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  formatCompactMoney,
  formatMoney,
  formatSignedPercentPrecise,
  pnlClassName,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type DailyData,
  type DailyPosition,
  marketPositions,
  signedOrZero,
} from "./types";

const MOVER_LIMIT = 3;

/** Day move per asset class, and how much of it the dollar explains. */
export function ClassBreakdown({ data }: { data: DailyData }) {
  const { summary } = data;
  const currency = summary.displayCurrency;
  const classes = summary.byAssetClass.filter(
    (entry) => entry.assetClass !== "cash" || Number(entry.marketValue) !== 0,
  );
  const largest = Math.max(
    0,
    ...classes.map((entry) => Math.abs(Number(entry.dailyChange ?? 0))),
  );
  const showSplit =
    summary.dailyFxChange != null && summary.dailyPriceChange != null;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          <Trans id="daily.byClassTitle">By category</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="daily.byClassHint">
            What each category added to today's change.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-3">
          {classes.map((entry) => (
            <li key={entry.assetClass} className="space-y-1.5">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">
                  <AssetClassLabel assetClass={entry.assetClass} />
                </span>
                <span
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                  title={formatMoney(entry.marketValue, currency)}
                >
                  {formatCompactMoney(Number(entry.marketValue), currency)}
                </span>
                <span
                  className={cn(
                    "ml-auto shrink-0 tabular-nums",
                    entry.dailyChange == null
                      ? "text-muted-foreground"
                      : pnlClassName(entry.dailyChange),
                  )}
                >
                  {entry.dailyChange == null
                    ? "—"
                    : signedOrZero(entry.dailyChange, currency)}
                </span>
                <span
                  className={cn(
                    "w-14 text-right text-xs tabular-nums",
                    entry.dailyChangePercent
                      ? pnlClassName(entry.dailyChangePercent)
                      : "text-muted-foreground",
                  )}
                >
                  {entry.dailyChangePercent
                    ? formatSignedPercentPrecise(entry.dailyChangePercent)
                    : "—"}
                </span>
              </div>
              <DivergingBar
                value={
                  entry.dailyChange == null ? null : Number(entry.dailyChange)
                }
                max={largest}
              />
            </li>
          ))}
        </ul>

        {showSplit ? (
          <>
            <Separator />
            <dl className="space-y-1.5 text-sm">
              <SplitRow
                label={<Trans id="daily.priceEffect">Price move</Trans>}
                value={summary.dailyPriceChange ?? "0"}
                currency={currency}
              />
              <SplitRow
                label={<Trans id="daily.fxEffectLabel">Dollar move</Trans>}
                value={summary.dailyFxChange ?? "0"}
                currency={currency}
              />
              <p className="pt-1 text-xs text-muted-foreground">
                <Trans id="daily.splitHint">
                  The dollar move is what USD/BRL alone did to foreign assets
                  and cash; the rest came from prices.
                </Trans>
              </p>
            </dl>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SplitRow({
  label,
  value,
  currency,
}: {
  label: ReactNode;
  value: string;
  currency: DailyData["summary"]["displayCurrency"];
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium tabular-nums", pnlClassName(value))}>
        {signedOrZero(value, currency)}
      </dd>
    </div>
  );
}

/** The few assets that moved the portfolio most, in money, each way. */
export function BiggestMovers({ data }: { data: DailyData }) {
  const compared = marketPositions(data).filter(
    (position) => position.dailyChange != null,
  );
  const sorted = [...compared].sort(
    (a, b) => Number(b.dailyChange) - Number(a.dailyChange),
  );
  const up = sorted
    .filter((position) => Number(position.dailyChange) > 0)
    .slice(0, MOVER_LIMIT);
  const down = sorted
    .filter((position) => Number(position.dailyChange) < 0)
    .slice(-MOVER_LIMIT)
    .reverse();

  if (up.length === 0 && down.length === 0) {
    return null;
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          <Trans id="daily.moversTitle">Biggest impact</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="daily.moversHint">
            The assets that moved the portfolio most today, in money.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <MoverList
          positions={up}
          empty={<Trans id="daily.noRisers">No asset rose today.</Trans>}
        />
        <Separator />
        <MoverList
          positions={down}
          empty={<Trans id="daily.noFallers">No asset fell today.</Trans>}
        />
      </CardContent>
    </Card>
  );
}

function MoverList({
  positions,
  empty,
}: {
  positions: DailyPosition[];
  empty: ReactNode;
}) {
  if (positions.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className="space-y-2">
      {positions.map((position) => (
        <li key={position.ticker} className="flex items-center gap-2.5 text-sm">
          <AssetLogo
            ticker={position.ticker}
            assetClass={position.assetClass}
            currency={position.currency}
          />
          <AssetLink ticker={position.ticker} className="font-medium">
            {position.ticker}
          </AssetLink>
          <span
            className={cn(
              "ml-auto tabular-nums",
              pnlClassName(position.dailyChange ?? "0"),
            )}
          >
            {signedOrZero(
              position.dailyChange ?? "0",
              position.displayCurrency,
            )}
          </span>
          <span
            className={cn(
              "w-14 text-right text-xs tabular-nums",
              pnlClassName(position.dailyChangePercent ?? "0"),
            )}
          >
            {position.dailyChangePercent
              ? formatSignedPercentPrecise(position.dailyChangePercent)
              : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
