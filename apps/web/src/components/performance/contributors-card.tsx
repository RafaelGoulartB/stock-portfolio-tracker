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
import {
  type CurrencyCode,
  formatSignedPercent,
  pnlClassName,
} from "@/lib/format";
import { type AssetBreakdown, signedOrZero } from "./types";

const CONTRIBUTOR_LIMIT = 5;

export function ContributorsCard({
  assets,
  currency,
}: {
  assets: AssetBreakdown[];
  currency: CurrencyCode;
}) {
  const winners = assets
    .filter((asset) => Number(asset.unrealizedPnl) > 0)
    .slice(0, CONTRIBUTOR_LIMIT);
  const losers = assets
    .filter((asset) => Number(asset.unrealizedPnl) < 0)
    .slice(-CONTRIBUTOR_LIMIT)
    .reverse();

  const largest = Math.max(
    0,
    ...[...winners, ...losers].map((asset) =>
      Math.abs(Number(asset.contribution ?? 0)),
    ),
  );

  if (winners.length === 0 && losers.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="performance.contributorsTitle">
            What moves the result
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="performance.contributorsHint">
            Assets with the largest open result, and what each one adds to the
            portfolio return.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <ContributorList
          title={<Trans id="performance.topGains">Top gains</Trans>}
          assets={winners}
          currency={currency}
          largest={largest}
        />
        <ContributorList
          title={<Trans id="performance.topLosses">Top losses</Trans>}
          assets={losers}
          currency={currency}
          largest={largest}
        />
      </CardContent>
    </Card>
  );
}

function ContributorList({
  title,
  assets,
  currency,
  largest,
}: {
  title: ReactNode;
  assets: AssetBreakdown[];
  currency: CurrencyCode;
  largest: number;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans id="performance.noneYet">None yet.</Trans>
        </p>
      ) : (
        <ul className="space-y-2.5">
          {assets.map((asset) => (
            <li key={asset.ticker} className="space-y-1">
              <div className="flex items-center gap-2.5 text-sm">
                <AssetLogo
                  ticker={asset.ticker}
                  assetClass={asset.assetClass}
                  currency={asset.currency}
                />
                <div className="min-w-0 leading-tight">
                  <AssetLink ticker={asset.ticker} className="font-medium">
                    {asset.ticker}
                  </AssetLink>
                  <p className="truncate text-xs text-muted-foreground">
                    <AssetClassLabel assetClass={asset.assetClass} />
                  </p>
                </div>
                <span
                  className={`ml-auto tabular-nums ${pnlClassName(asset.unrealizedPnl)}`}
                >
                  {signedOrZero(asset.unrealizedPnl, currency)}
                </span>
                <span
                  className={`w-14 text-right text-xs tabular-nums ${asset.unrealizedPnlPercent == null ? "text-muted-foreground" : pnlClassName(asset.unrealizedPnlPercent)}`}
                >
                  {asset.unrealizedPnlPercent == null
                    ? "—"
                    : formatSignedPercent(asset.unrealizedPnlPercent)}
                </span>
              </div>
              <div className="flex items-center gap-2.5 pl-9">
                <DivergingBar
                  value={
                    asset.contribution == null
                      ? null
                      : Number(asset.contribution)
                  }
                  max={largest}
                />
                <span className="w-32 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                  {asset.contribution == null ? (
                    "—"
                  ) : (
                    <Trans id="performance.contributionShort">
                      {formatSignedPercent(asset.contribution)} of the return
                    </Trans>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
