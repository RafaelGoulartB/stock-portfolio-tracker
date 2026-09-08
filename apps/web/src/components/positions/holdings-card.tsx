import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  PortfolioSummary,
  ValuedPosition,
} from "@portifolio-tracker/shared";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatMoney,
  formatQuantity,
  formatSignedPercent,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { ShareBar, signedOrZero } from "./shared";

type SortKey = "ticker" | "value" | "share" | "pnl";
type SortDirection = "asc" | "desc";

function SortHeaderButton({
  label,
  align = "left",
  active,
  direction,
  onToggle,
}: {
  label: ReactNode;
  align?: "left" | "right";
  active: boolean;
  direction: SortDirection;
  onToggle: () => void;
}) {
  const Icon = !active
    ? ArrowUpDown
    : direction === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground ${
        align === "right" ? "flex-row-reverse" : ""
      } ${active ? "text-foreground" : ""}`}
    >
      {label}
      <Icon
        className={`size-3.5 shrink-0 transition-opacity ${
          active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}

function ariaSort(
  active: boolean,
  direction: SortDirection,
): "ascending" | "descending" | "none" {
  if (!active) {
    return "none";
  }

  return direction === "asc" ? "ascending" : "descending";
}

export function HoldingsCard({
  positions,
  summary,
  missing,
}: {
  positions: ValuedPosition[];
  summary: PortfolioSummary;
  missing: string[];
}) {
  const { i18n } = useLingui();
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const rows = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;

    const metric = (position: ValuedPosition): number | null => {
      if (sortKey === "value") {
        return position.convertedMarketValue == null
          ? null
          : Number(position.convertedMarketValue);
      }

      if (sortKey === "pnl") {
        return position.convertedUnrealizedPnl == null
          ? null
          : Number(position.convertedUnrealizedPnl);
      }

      return position.weight == null ? null : Number(position.weight);
    };

    return [...positions].sort((a, b) => {
      if (sortKey === "ticker") {
        return direction * a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      const left = metric(a);
      const right = metric(b);

      // Assets without a quote always sink to the bottom.
      if (left == null || right == null) {
        if (left == null && right == null) {
          return a.ticker.localeCompare(b.ticker, i18n.locale);
        }

        return left == null ? 1 : -1;
      }

      if (left === right) {
        return a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      return direction * (left - right);
    });
  }, [positions, sortKey, sortDir, i18n.locale]);

  const maxWeight = useMemo(
    () =>
      positions.reduce(
        (max, position) => Math.max(max, Number(position.weight ?? 0)),
        0,
      ),
    [positions],
  );

  function toggleSort(key: SortKey) {
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
          <Trans id="positions.holdings">Holdings</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.holdingsHint">
            Average cost and prices stay in the native currency of each asset;
            market value and result are consolidated.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="[&_tbody_td]:h-11 [&_tfoot_td]:h-11">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className="text-muted-foreground"
                aria-sort={ariaSort(sortKey === "ticker", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="positions.colTicker">Ticker</Trans>}
                  active={sortKey === "ticker"}
                  direction={sortDir}
                  onToggle={() => toggleSort("ticker")}
                />
              </TableHead>
              <TableHead className="text-muted-foreground">
                <Trans id="positions.colClass">Class</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="positions.colQuantity">Quantity</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="positions.colAvgCost">Avg. cost</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="positions.colPrice">Price</Trans>
              </TableHead>
              <TableHead
                className="text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "value", sortDir)}
              >
                <SortHeaderButton
                  label={
                    <Trans id="positions.colMarketValue">Market value</Trans>
                  }
                  align="right"
                  active={sortKey === "value"}
                  direction={sortDir}
                  onToggle={() => toggleSort("value")}
                />
              </TableHead>
              <TableHead
                className="text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "pnl", sortDir)}
              >
                <SortHeaderButton
                  label={
                    <Trans id="positions.colOpenResult">Open result</Trans>
                  }
                  align="right"
                  active={sortKey === "pnl"}
                  direction={sortDir}
                  onToggle={() => toggleSort("pnl")}
                />
              </TableHead>
              <TableHead
                className="w-[132px] text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "share", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="positions.colShare">Share</Trans>}
                  align="right"
                  active={sortKey === "share"}
                  direction={sortDir}
                  onToggle={() => toggleSort("share")}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((position) => (
              <TableRow key={`${position.ticker}|${position.currency}`}>
                <TableCell className="font-medium">
                  <AssetLink
                    ticker={position.ticker}
                    className="flex items-center gap-2"
                  >
                    <AssetLogo
                      ticker={position.ticker}
                      assetClass={position.assetClass}
                      currency={position.currency}
                    />
                    {position.ticker}
                  </AssetLink>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <AssetClassLabel assetClass={position.assetClass} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.assetClass === "fixed_income" ||
                  position.assetClass === "cash" ? (
                    <Dash />
                  ) : (
                    formatQuantity(position.quantity)
                  )}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {position.assetClass === "fixed_income" ? (
                    <Dash />
                  ) : (
                    formatMoney(position.averagePrice, position.currency)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.assetClass === "fixed_income" ||
                  position.marketPrice == null ? (
                    <Dash />
                  ) : (
                    formatMoney(position.marketPrice, position.currency)
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {position.convertedMarketValue == null ? (
                    <Dash />
                  ) : (
                    formatMoney(
                      position.convertedMarketValue,
                      position.displayCurrency,
                    )
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.assetClass === "fixed_income" ||
                  position.convertedUnrealizedPnl == null ? (
                    <Dash />
                  ) : (
                    <span
                      className={`flex items-center justify-end gap-2 ${pnlClassName(position.convertedUnrealizedPnl)}`}
                    >
                      {signedOrZero(
                        position.convertedUnrealizedPnl,
                        position.displayCurrency,
                      )}
                      {position.unrealizedPnlPercent ? (
                        <span className="text-xs opacity-80">
                          {formatSignedPercent(position.unrealizedPnlPercent)}
                        </span>
                      ) : null}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.weight == null ? (
                    <Dash />
                  ) : (
                    <span className="flex items-center justify-end gap-2">
                      {formatWeight(position.weight)}
                      <ShareBar
                        className="w-14 shrink-0"
                        fraction={
                          weightBarWidth(position.weight, maxWeight) / 100
                        }
                      />
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="font-medium">
                <Trans id="positions.total">Total</Trans>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(summary.totalMarketValue, summary.displayCurrency)}
              </TableCell>
              <TableCell
                className={`text-right font-medium tabular-nums ${pnlClassName(summary.totalUnrealizedPnl)}`}
              >
                {signedOrZero(
                  summary.totalUnrealizedPnl,
                  summary.displayCurrency,
                )}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {summary.quotedPositions > 0 ? formatWeight("1") : <Dash />}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>

        {missing.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            <Trans id="positions.missingQuotes">
              No quote for {missing.join(", ")}. Values and shares cover quoted
              assets only.
            </Trans>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

/** Bars are scaled against the largest holding, not against 100%. */
function weightBarWidth(weight: string, maxWeight: number): number {
  if (maxWeight <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(4, (Number(weight) / maxWeight) * 100));
}
