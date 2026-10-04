import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  SortableHead,
  type SortDirection,
} from "@/components/analysis/primitives";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { ShareBar } from "@/components/positions/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatTradeDate, formatWeight } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DividendData } from "./types";

type IncomeAsset = DividendData["income"]["byAsset"][number];
type SortKey = "ticker" | "trailing" | "window" | "yield" | "last";

const COLLAPSED_ROWS = 10;

function metric(asset: IncomeAsset, key: SortKey): number | string | null {
  switch (key) {
    case "trailing":
      return Number(asset.trailing12m);
    case "window":
      return Number(asset.windowTotal);
    case "yield":
      return asset.yieldOnCost == null ? null : Number(asset.yieldOnCost);
    case "last":
      return asset.lastIncomeDay;
    case "ticker":
      return asset.ticker;
  }
}

/** Which assets pay the income, ranked by the last 12 months. */
export function IncomeByAssetTable({ data }: { data: DividendData }) {
  const { i18n } = useLingui();
  const [sortKey, setSortKey] = useState<SortKey>("trailing");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [expanded, setExpanded] = useState(false);
  const currency = data.summary.displayCurrency;
  const assets = data.income.byAsset;
  const largest = Math.max(
    0,
    ...assets.map((asset) => Number(asset.trailing12m)),
  );
  const trailingTotal = Number(data.income.trailing12m);

  const rows = useMemo(() => {
    const sign = sortDir === "asc" ? 1 : -1;

    return [...assets].sort((a, b) => {
      const left = metric(a, sortKey);
      const right = metric(b, sortKey);

      if (left == null || right == null) {
        if (left == null && right == null) {
          return a.ticker.localeCompare(b.ticker, i18n.locale);
        }

        return left == null ? 1 : -1;
      }

      if (typeof left === "string" || typeof right === "string") {
        return sign * String(left).localeCompare(String(right), i18n.locale);
      }

      return left === right
        ? a.ticker.localeCompare(b.ticker, i18n.locale)
        : sign * (left - right);
    });
  }, [assets, sortDir, sortKey, i18n.locale]);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDir(key === "ticker" ? "asc" : "desc");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="dividends.byAssetTitle">Income by asset</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="dividends.byAssetHint">
            Who pays your income. Yield on cost is each asset's own 12-month
            income over what you paid for it, in its native currency.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table className="[&_tbody_td]:h-12">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead
                label={<Trans id="dividends.ticker">Ticker</Trans>}
                active={sortKey === "ticker"}
                direction={sortDir}
                onToggle={() => toggle("ticker")}
                className="pl-4 sm:pl-2"
              />
              <SortableHead
                label={<Trans id="dividends.trailing12mShort">12 months</Trans>}
                active={sortKey === "trailing"}
                direction={sortDir}
                align="right"
                onToggle={() => toggle("trailing")}
              />
              <TableHead className="hidden w-[132px] text-right text-muted-foreground md:table-cell">
                <Trans id="dividends.shareOfIncome">Share</Trans>
              </TableHead>
              <SortableHead
                label={<Trans id="dividends.yieldOnCost">Yield on cost</Trans>}
                active={sortKey === "yield"}
                direction={sortDir}
                align="right"
                onToggle={() => toggle("yield")}
              />
              <SortableHead
                label={<Trans id="dividends.windowTotal">Whole window</Trans>}
                active={sortKey === "window"}
                direction={sortDir}
                align="right"
                onToggle={() => toggle("window")}
                className="hidden sm:table-cell"
              />
              <SortableHead
                label={<Trans id="dividends.lastIncome">Last income</Trans>}
                active={sortKey === "last"}
                direction={sortDir}
                align="right"
                onToggle={() => toggle("last")}
                className="hidden pr-4 sm:pr-2 lg:table-cell"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((asset) => {
              const trailing = Number(asset.trailing12m);
              const share = trailingTotal > 0 ? trailing / trailingTotal : 0;

              return (
                <TableRow key={`${asset.ticker}|${asset.currency}`}>
                  <TableCell className="pl-4 sm:pl-2">
                    <div className="flex items-center gap-2.5">
                      <AssetLogo
                        ticker={asset.ticker}
                        assetClass={asset.assetClass}
                        currency={asset.currency}
                      />
                      <div className="min-w-0 leading-tight">
                        <AssetLink
                          ticker={asset.ticker}
                          className="font-medium"
                        >
                          {asset.ticker}
                        </AssetLink>
                        <p className="truncate text-xs text-muted-foreground">
                          <AssetClassLabel assetClass={asset.assetClass} />
                          {asset.held ? null : (
                            <>
                              {" · "}
                              <Trans id="dividends.sold">sold</Trans>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium tabular-nums",
                      trailing === 0 && "text-muted-foreground",
                    )}
                  >
                    {formatMoney(asset.trailing12m, currency)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center justify-end gap-2">
                      <span className="w-11 text-right text-xs text-muted-foreground tabular-nums">
                        {trailing > 0 ? formatWeight(String(share)) : "—"}
                      </span>
                      <ShareBar
                        className="w-16 shrink-0"
                        fraction={largest > 0 ? trailing / largest : 0}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {asset.yieldOnCost ? (
                      formatWeight(asset.yieldOnCost)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                    {formatMoney(asset.windowTotal, currency)}
                    <span className="block text-xs">
                      <Trans id="dividends.eventsShort">
                        {asset.events} events
                      </Trans>
                    </span>
                  </TableCell>
                  <TableCell className="hidden pr-4 text-right text-muted-foreground tabular-nums sm:pr-2 lg:table-cell">
                    {formatTradeDate(asset.lastIncomeDay)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length > COLLAPSED_ROWS ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-muted-foreground"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <Trans id="dividends.showFewer">Show fewer</Trans>
            ) : (
              <Trans id="dividends.showAllAssets">Show all {rows.length}</Trans>
            )}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
