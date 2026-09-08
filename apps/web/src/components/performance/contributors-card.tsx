import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
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
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <ContributorList
          title={<Trans id="performance.topGains">Top gains</Trans>}
          assets={winners}
          currency={currency}
        />
        <ContributorList
          title={<Trans id="performance.topLosses">Top losses</Trans>}
          assets={losers}
          currency={currency}
        />
      </CardContent>
    </Card>
  );
}

function ContributorList({
  title,
  assets,
  currency,
}: {
  title: ReactNode;
  assets: AssetBreakdown[];
  currency: CurrencyCode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans id="performance.noneYet">None yet.</Trans>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {assets.map((asset) => (
            <li
              key={asset.ticker}
              className="flex items-baseline gap-3 text-sm"
            >
              <AssetLink ticker={asset.ticker} className="font-medium">
                {asset.ticker}
              </AssetLink>
              <span className="text-xs text-muted-foreground">
                <AssetClassLabel assetClass={asset.assetClass} />
              </span>
              <span
                className={`ml-auto tabular-nums ${pnlClassName(asset.unrealizedPnl)}`}
              >
                {signedOrZero(asset.unrealizedPnl, currency)}
              </span>
              <span
                className={`w-16 text-right text-xs tabular-nums ${asset.unrealizedPnlPercent == null ? "text-muted-foreground" : pnlClassName(asset.unrealizedPnlPercent)}`}
              >
                {asset.unrealizedPnlPercent == null
                  ? "—"
                  : formatSignedPercent(asset.unrealizedPnlPercent)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
