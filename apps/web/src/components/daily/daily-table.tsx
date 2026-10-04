import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  DivergingBar,
  SortableHead,
  type SortDirection,
} from "@/components/analysis/primitives";
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
  formatSignedPercentPrecise,
  formatSignedWeightPrecise,
  formatTradeDate,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type DailyData,
  type DailyPosition,
  portfolioImpact,
  signedOrZero,
} from "./types";

type SortKey = "ticker" | "percent" | "change" | "value";

function metric(position: DailyPosition, key: SortKey): number | null {
  switch (key) {
    case "percent":
      return position.dailyChangePercent == null
        ? null
        : Number(position.dailyChangePercent);
    case "change":
      return position.dailyChange == null ? null : Number(position.dailyChange);
    case "value":
      return position.convertedMarketValue == null
        ? null
        : Number(position.convertedMarketValue);
    case "ticker":
      return null;
  }
}

export function DailyTable({ data }: { data: DailyData }) {
  const { i18n } = useLingui();
  const [sortKey, setSortKey] = useState<SortKey>("change");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const { summary } = data;
  // An empty cash balance only adds a row of zeros.
  const positions = useMemo(
    () =>
      data.positions.filter(
        (position) =>
          position.assetClass !== "cash" ||
          Number(position.convertedMarketValue ?? 0) !== 0,
      ),
    [data.positions],
  );
  const rows = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;

    return [...positions].sort((a, b) => {
      if (sortKey === "ticker") {
        return direction * a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      const left = metric(a, sortKey);
      const right = metric(b, sortKey);

      if (left == null || right == null) {
        if (left == null && right == null) {
          return a.ticker.localeCompare(b.ticker, i18n.locale);
        }

        return left == null ? 1 : -1;
      }

      return left === right
        ? a.ticker.localeCompare(b.ticker, i18n.locale)
        : direction * (left - right);
    });
  }, [positions, i18n.locale, sortDir, sortKey]);
  const largestImpact = Math.max(
    0,
    ...positions.map((position) =>
      Math.abs(portfolioImpact(position, summary.previousComparableValue) ?? 0),
    ),
  );
  const previousDay = positions.find(
    (position) => position.previousCloseAsOf,
  )?.previousCloseAsOf;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
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
          {summary.asOf ? (
            <Trans id="daily.assetsAsOf">
              Assets · {formatTradeDate(summary.asOf)}
            </Trans>
          ) : (
            <Trans id="daily.assets">Assets</Trans>
          )}
        </CardTitle>
        <CardDescription>
          {previousDay ? (
            <Trans id="daily.assetsVsPrevious">
              Change from the {formatTradeDate(previousDay)} close in{" "}
              {summary.displayCurrency}, FX included. Impact is the share of
              yesterday's portfolio each move represents.
            </Trans>
          ) : (
            <Trans id="daily.assetsHint">
              Change from the previous close in the display currency, including
              FX, and each asset's impact on yesterday's portfolio value.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table className="[&_tbody_td]:h-12 [&_tfoot_td]:h-11">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead
                label={<Trans id="daily.colTicker">Ticker</Trans>}
                active={sortKey === "ticker"}
                direction={sortDir}
                onToggle={() => toggleSort("ticker")}
                className="pl-4 sm:pl-2"
              />
              <TableHead className="hidden text-right text-muted-foreground md:table-cell">
                <Trans id="daily.colLastPrice">Last price</Trans>
              </TableHead>
              <SortableHead
                label={<Trans id="daily.colDayPercent">Day %</Trans>}
                active={sortKey === "percent"}
                direction={sortDir}
                align="right"
                onToggle={() => toggleSort("percent")}
              />
              <SortableHead
                label={<Trans id="daily.colDayChange">Day change</Trans>}
                active={sortKey === "change"}
                direction={sortDir}
                align="right"
                onToggle={() => toggleSort("change")}
              />
              <TableHead className="hidden text-right text-muted-foreground lg:table-cell">
                <Trans id="daily.colPortfolioImpact">Portfolio impact</Trans>
              </TableHead>
              <SortableHead
                label={<Trans id="daily.colMarketValue">Market value</Trans>}
                active={sortKey === "value"}
                direction={sortDir}
                align="right"
                onToggle={() => toggleSort("value")}
                className="hidden sm:table-cell"
              />
              <TableHead className="hidden pr-4 text-right text-muted-foreground sm:pr-2 xl:table-cell">
                <Trans id="daily.colWeight">Weight</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((position) => (
              <DailyRow
                key={`${position.ticker}|${position.currency}`}
                position={position}
                impact={portfolioImpact(
                  position,
                  summary.previousComparableValue,
                )}
                largestImpact={largestImpact}
              />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-4 font-medium sm:pl-2">
                <Trans id="daily.total">Portfolio total</Trans>
              </TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell
                className={cn(
                  "text-right font-semibold tabular-nums",
                  pnlClassName(summary.dailyChange ?? "0"),
                )}
              >
                {summary.dailyChangePercent
                  ? formatSignedPercentPrecise(summary.dailyChangePercent)
                  : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-semibold tabular-nums",
                  pnlClassName(summary.dailyChange ?? "0"),
                )}
              >
                {summary.dailyChange === null
                  ? "—"
                  : signedOrZero(summary.dailyChange, summary.displayCurrency)}
              </TableCell>
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="hidden text-right font-medium tabular-nums sm:table-cell">
                {formatMoney(summary.marketValue, summary.displayCurrency)}
              </TableCell>
              <TableCell className="hidden xl:table-cell" />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

function DailyRow({
  position,
  impact,
  largestImpact,
}: {
  position: DailyPosition;
  impact: number | null;
  largestImpact: number;
}) {
  return (
    <TableRow>
      <TableCell className="pl-4 sm:pl-2">
        <div className="flex items-center gap-2.5">
          <AssetLogo
            ticker={position.ticker}
            assetClass={position.assetClass}
            currency={position.currency}
          />
          <div className="min-w-0 leading-tight">
            <AssetLink ticker={position.ticker} className="font-medium">
              {position.ticker}
            </AssetLink>
            <p className="truncate text-xs text-muted-foreground">
              <AssetClassLabel assetClass={position.assetClass} />
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">
        <div className="leading-tight">
          {position.marketPrice == null
            ? "—"
            : formatMoney(position.marketPrice, position.currency)}
          {position.previousClose != null && position.assetClass !== "cash" ? (
            <p className="text-xs text-muted-foreground">
              <Trans id="daily.previousShort">
                prev. {formatMoney(position.previousClose, position.currency)}
              </Trans>
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-medium tabular-nums",
          position.dailyChangePercent
            ? pnlClassName(position.dailyChangePercent)
            : "text-muted-foreground",
        )}
      >
        {position.dailyChangePercent
          ? formatSignedPercentPrecise(position.dailyChangePercent)
          : "—"}
      </TableCell>
      <TableCell
        className={cn(
          "text-right tabular-nums",
          position.dailyChange == null
            ? "text-muted-foreground"
            : pnlClassName(position.dailyChange),
        )}
      >
        {position.dailyChange == null
          ? "—"
          : signedOrZero(position.dailyChange, position.displayCurrency)}
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <div className="flex items-center justify-end gap-3">
          <DivergingBar value={impact} max={largestImpact} className="w-20" />
          <span
            className={cn(
              "w-14 text-right text-xs tabular-nums",
              impact == null
                ? "text-muted-foreground"
                : pnlClassName(String(impact)),
            )}
          >
            {impact == null ? "—" : formatSignedWeightPrecise(String(impact))}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden text-right tabular-nums sm:table-cell">
        {position.convertedMarketValue == null
          ? "—"
          : formatMoney(
              position.convertedMarketValue,
              position.displayCurrency,
            )}
      </TableCell>
      <TableCell className="hidden pr-4 text-right text-muted-foreground tabular-nums sm:pr-2 xl:table-cell">
        {position.weight ? formatWeight(position.weight) : "—"}
      </TableCell>
    </TableRow>
  );
}
