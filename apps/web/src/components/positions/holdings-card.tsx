import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  PortfolioSummary,
  ValuedPosition,
} from "@portifolio-tracker/shared";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { sumDecimalStrings } from "@/components/detailed-positions/decimal-sum";
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
import type { AllocationFilter } from "./allocation-card";
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
  positions: allPositions,
  summary,
  missing,
  filter,
  onClearFilter,
}: {
  positions: ValuedPosition[];
  summary: PortfolioSummary;
  missing: string[];
  /** Allocation bucket the table is narrowed to, if any. */
  filter: AllocationFilter | null;
  onClearFilter: () => void;
}) {
  const { i18n } = useLingui();
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  // An empty cash balance only adds a row of zeros.
  const positions = useMemo(
    () =>
      allPositions.filter(
        (position) =>
          (position.assetClass !== "cash" ||
            Number(position.convertedMarketValue ?? 0) !== 0) &&
          (!filter ||
            filter.ids.has(`${position.ticker}|${position.currency}`)),
      ),
    [allPositions, filter],
  );
  const missingSet = useMemo(() => new Set(missing), [missing]);
  const totals = useMemo(
    () =>
      filter
        ? {
            value: sumDecimalStrings(
              positions.map((position) => position.convertedMarketValue),
            ),
            pnl: sumDecimalStrings(
              positions.map((position) =>
                position.assetClass === "fixed_income"
                  ? null
                  : position.convertedUnrealizedPnl,
              ),
            ),
            // Weights are ratios; the default two places would round 37.8%
            // up to 38%.
            weight: sumDecimalStrings(
              positions.map((position) => position.weight),
              8,
            ),
          }
        : {
            value: summary.totalMarketValue,
            pnl: summary.totalUnrealizedPnl,
            weight: summary.quotedPositions > 0 ? "1" : null,
          },
    [filter, positions, summary],
  );

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
      <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64 space-y-1.5">
          <CardTitle>
            <Trans id="positions.holdings">Holdings</Trans>
          </CardTitle>
          <CardDescription>
            <Trans id="positions.holdingsHint">
              Average cost and prices stay in the native currency of each asset;
              market value and result are consolidated.
            </Trans>
          </CardDescription>
        </div>
        {filter ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClearFilter}
            aria-label={i18n._(
              t({
                id: "positions.clearFilter",
                message: `Show every holding, not only ${filter.label}`,
              }),
            )}
          >
            <Trans id="positions.filteredBy">Only {filter.label}</Trans>
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table className="[&_tbody_td]:h-11 [&_tfoot_td]:h-11">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className="pl-4 text-muted-foreground sm:pl-2"
                aria-sort={ariaSort(sortKey === "ticker", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="positions.colTicker">Ticker</Trans>}
                  active={sortKey === "ticker"}
                  direction={sortDir}
                  onToggle={() => toggleSort("ticker")}
                />
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground md:table-cell">
                <Trans id="positions.colQuantity">Quantity</Trans>
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground md:table-cell">
                <Trans id="positions.colAvgCost">Avg. cost</Trans>
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
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
                className="hidden w-[132px] pr-4 text-right text-muted-foreground sm:table-cell sm:pr-2"
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
                <TableCell className="pl-4 sm:pl-2">
                  <div className="flex items-center gap-2.5">
                    <AssetLogo
                      ticker={position.ticker}
                      assetClass={position.assetClass}
                      currency={position.currency}
                    />
                    <div className="min-w-0 leading-tight">
                      <AssetLink
                        ticker={position.ticker}
                        className="font-medium"
                      >
                        {position.ticker}
                      </AssetLink>
                      <p className="truncate text-xs text-muted-foreground">
                        <AssetClassLabel assetClass={position.assetClass} />
                        {missingSet.has(position.ticker) &&
                        position.assetClass !== "fixed_income" ? (
                          <>
                            {" · "}
                            <span className="text-caution">
                              <Trans id="positions.noQuoteShort">
                                No quote
                              </Trans>
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {position.assetClass === "fixed_income" ||
                  position.assetClass === "cash" ? (
                    <Dash />
                  ) : (
                    formatQuantity(position.quantity)
                  )}
                </TableCell>
                <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                  {position.assetClass === "fixed_income" ? (
                    <Dash />
                  ) : (
                    formatMoney(position.averagePrice, position.currency)
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
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
                    <div
                      className={`leading-tight ${pnlClassName(position.convertedUnrealizedPnl)}`}
                    >
                      {signedOrZero(
                        position.convertedUnrealizedPnl,
                        position.displayCurrency,
                      )}
                      {position.unrealizedPnlPercent ? (
                        <p className="text-xs opacity-80">
                          {formatSignedPercent(position.unrealizedPnlPercent)}
                        </p>
                      ) : null}
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden pr-4 text-right tabular-nums sm:table-cell sm:pr-2">
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
              <TableCell className="pl-4 font-medium sm:pl-2">
                {filter ? (
                  <Trans id="positions.selectionTotal">
                    {filter.label} · {positions.length}
                  </Trans>
                ) : (
                  <Trans id="positions.total">Total</Trans>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(totals.value, summary.displayCurrency)}
              </TableCell>
              <TableCell
                className={`text-right font-medium tabular-nums ${pnlClassName(totals.pnl)}`}
              >
                {signedOrZero(totals.pnl, summary.displayCurrency)}
              </TableCell>
              <TableCell className="hidden pr-4 text-right font-medium tabular-nums sm:table-cell sm:pr-2">
                {totals.weight == null ? <Dash /> : formatWeight(totals.weight)}
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
