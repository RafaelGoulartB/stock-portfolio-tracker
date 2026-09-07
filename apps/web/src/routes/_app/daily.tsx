import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { positiveDecimal } from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { AssetLogo } from "@/components/asset-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type RouterOutputs, trpc } from "@/lib/api";
import {
  formatMoney,
  formatSignedMoney,
  formatSignedPercent,
  formatSignedWeightPrecise,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/daily")({
  component: DailyPage,
});

type DailyData = RouterOutputs["positions"]["daily"];
type DailyPosition = DailyData["positions"][number];
type SortKey = "ticker" | "value" | "change" | "impact";
type SortDirection = "asc" | "desc";

function DailyPage() {
  const { i18n } = useLingui();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const fx = useFxQuote();
  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );
  const daily = trpc.positions.daily.useQuery({
    displayCurrency,
    usdBrlRate: fx.effectiveRate,
    quoteSource,
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  });
  const waitingForRate =
    !!daily.error && isFxRateRequired(daily.error) && fx.isPending;
  const fxFailed =
    !!daily.error &&
    isFxRateRequired(daily.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="daily.title">Daily performance</Trans>
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            <Trans id="daily.subtitle">
              Follow the portfolio's latest daily movement and see which assets
              are driving the change.
            </Trans>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => daily.refetch()}
          disabled={daily.isFetching}
        >
          <RefreshCw
            className={`size-4 ${daily.isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <Trans id="daily.refresh">Refresh quotes</Trans>
        </Button>
      </header>

      {daily.isPending || waitingForRate ? <DailySkeleton /> : null}

      {fxFailed ? (
        <ErrorCard>
          <Trans id="daily.fxFailed">
            Could not fetch the exchange rate. Try another source or enter it
            manually.
          </Trans>
        </ErrorCard>
      ) : null}

      {daily.error && !waitingForRate && !fxFailed ? (
        <ErrorCard>{queryErrorMessage(daily.error)}</ErrorCard>
      ) : null}

      {daily.data ? (
        <>
          <DailySummary data={daily.data} />
          {daily.data.positions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                <Trans id="daily.empty">
                  Register a trade to start tracking daily performance.
                </Trans>
              </CardContent>
            </Card>
          ) : (
            <DailyTable data={daily.data} locale={i18n.locale} />
          )}
        </>
      ) : null}
    </div>
  );
}

function ErrorCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-6 text-sm text-destructive">
        {children}
      </CardContent>
    </Card>
  );
}

function DailySummary({ data }: { data: DailyData }) {
  const { summary } = data;
  const hasComparison = summary.comparablePositions > 0;
  const asOf = summary.asOf ? formatTradeDate(summary.asOf) : null;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Metric
          label={<Trans id="daily.portfolioValue">Portfolio value</Trans>}
          value={formatMoney(summary.marketValue, summary.displayCurrency)}
          hint={
            asOf ? (
              <Trans id="daily.quotedAt">Latest quotes from {asOf}.</Trans>
            ) : (
              <Trans id="daily.noQuoteDate">No live quotes available.</Trans>
            )
          }
        />
        <Metric
          label={<Trans id="daily.dayChange">Day change</Trans>}
          value={
            hasComparison
              ? signedOrZero(summary.dailyChange, summary.displayCurrency)
              : "—"
          }
          valueClassName={
            hasComparison ? pnlClassName(summary.dailyChange) : undefined
          }
          hint={
            summary.dailyChangePercent ? (
              <span className={pnlClassName(summary.dailyChange)}>
                {formatSignedPercent(summary.dailyChangePercent)}
              </span>
            ) : (
              <Trans id="daily.previousCloseComparison">
                Compared with the previous close.
              </Trans>
            )
          }
        />
        <Metric
          label={<Trans id="daily.marketBreadth">Market breadth</Trans>}
          value={`${summary.advancing} ↑  ${summary.declining} ↓`}
          hint={
            <Trans id="daily.marketBreadthHint">
              {summary.comparablePositions} assets with daily comparison.
            </Trans>
          }
        />
      </div>
      <div className="border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
        <Trans id="daily.comparisonCoverage">
          Daily change covers {summary.comparablePositions} of{" "}
          {summary.openPositions} open assets. Values are consolidated in{" "}
          {summary.displayCurrency}.
        </Trans>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: ReactNode;
  value: string;
  valueClassName?: string;
  hint: ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1.5 text-xl font-semibold tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {hint}
      </p>
    </div>
  );
}

function DailyTable({ data, locale }: { data: DailyData; locale: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("change");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const rows = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;

    return [...data.positions].sort((a, b) => {
      if (sortKey === "ticker") {
        return direction * a.ticker.localeCompare(b.ticker, locale);
      }

      const left = Number(
        sortKey === "value" ? a.convertedMarketValue : a.dailyChange,
      );
      const right = Number(
        sortKey === "value" ? b.convertedMarketValue : b.dailyChange,
      );
      const leftMissing =
        sortKey === "value"
          ? a.convertedMarketValue == null
          : a.dailyChange == null;
      const rightMissing =
        sortKey === "value"
          ? b.convertedMarketValue == null
          : b.dailyChange == null;

      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) {
          return a.ticker.localeCompare(b.ticker, locale);
        }
        return leftMissing ? 1 : -1;
      }

      return left === right
        ? a.ticker.localeCompare(b.ticker, locale)
        : direction * (left - right);
    });
  }, [data.positions, locale, sortDir, sortKey]);

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
          {data.summary.asOf ? (
            <Trans id="daily.assetsAsOf">
              Assets · {formatTradeDate(data.summary.asOf)}
            </Trans>
          ) : (
            <Trans id="daily.assets">Assets</Trans>
          )}
        </CardTitle>
        <CardDescription>
          <Trans id="daily.assetsHint">
            Price change from the previous close and its impact on your current
            position.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="[&_tbody_td]:h-11 [&_tfoot_td]:h-11">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead
                label={<Trans id="daily.colTicker">Ticker</Trans>}
                active={sortKey === "ticker"}
                direction={sortDir}
                onToggle={() => toggleSort("ticker")}
              />
              <TableHead className="text-right text-muted-foreground">
                <Trans id="daily.colPreviousClose">Previous close</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="daily.colLastPrice">Last price</Trans>
              </TableHead>
              <SortableHead
                label={<Trans id="daily.colMarketValue">Market value</Trans>}
                active={sortKey === "value"}
                direction={sortDir}
                align="right"
                onToggle={() => toggleSort("value")}
              />
              <SortableHead
                label={<Trans id="daily.colDayChange">Day change</Trans>}
                active={sortKey === "change"}
                direction={sortDir}
                align="right"
                onToggle={() => toggleSort("change")}
              />
              <SortableHead
                label={
                  <Trans id="daily.colPortfolioImpact">Portfolio impact</Trans>
                }
                active={sortKey === "impact"}
                direction={sortDir}
                align="right"
                onToggle={() => toggleSort("impact")}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((position) => (
              <DailyRow
                key={`${position.ticker}|${position.currency}`}
                position={position}
                portfolioValue={data.summary.marketValue}
              />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                <Trans id="daily.total">Comparable total</Trans>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(
                  data.summary.currentComparableValue,
                  data.summary.displayCurrency,
                )}
              </TableCell>
              <TableCell
                className={`text-right font-semibold tabular-nums ${pnlClassName(data.summary.dailyChange)}`}
              >
                {data.summary.comparablePositions > 0
                  ? signedOrZero(
                      data.summary.dailyChange,
                      data.summary.displayCurrency,
                    )
                  : "—"}
              </TableCell>
              <TableCell
                className={`text-right font-semibold tabular-nums ${pnlClassName(data.summary.dailyChange)}`}
              >
                {data.summary.comparablePositions > 0 &&
                Number(data.summary.marketValue) !== 0
                  ? formatSignedWeightPrecise(
                      String(
                        Number(data.summary.dailyChange) /
                          Number(data.summary.marketValue),
                      ),
                    )
                  : "—"}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

function DailyRow({
  position,
  portfolioValue,
}: {
  position: DailyPosition;
  portfolioValue: string;
}) {
  const portfolioImpact =
    position.dailyChange != null && Number(portfolioValue) !== 0
      ? Number(position.dailyChange) / Number(portfolioValue)
      : null;

  return (
    <TableRow>
      <TableCell className="font-medium">
        <span className="flex items-center gap-2">
          <AssetLogo
            ticker={position.ticker}
            assetClass={position.assetClass}
            currency={position.currency}
          />
          {position.ticker}
        </span>
      </TableCell>
      <TableCell className="text-right text-muted-foreground tabular-nums">
        {position.previousClose == null
          ? "—"
          : formatMoney(position.previousClose, position.currency)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {position.marketPrice == null
          ? "—"
          : formatMoney(position.marketPrice, position.currency)}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {position.convertedMarketValue == null
          ? "—"
          : formatMoney(
              position.convertedMarketValue,
              position.displayCurrency,
            )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {position.dailyChange == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={`flex items-center justify-end gap-2 ${pnlClassName(position.dailyChange)}`}
          >
            {signedOrZero(position.dailyChange, position.displayCurrency)}
            {position.dailyChangePercent ? (
              <span className="text-xs opacity-80">
                {formatSignedPercent(position.dailyChangePercent)}
              </span>
            ) : null}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {portfolioImpact == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={pnlClassName(position.dailyChange ?? "0")}>
            {formatSignedWeightPrecise(String(portfolioImpact))}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function SortableHead({
  label,
  active,
  direction,
  align = "left",
  onToggle,
}: {
  label: ReactNode;
  active: boolean;
  direction: SortDirection;
  align?: "left" | "right";
  onToggle: () => void;
}) {
  const ariaLabel = useLingui().i18n._(
    t({ id: "daily.sortColumn", message: "Sort this column" }),
  );
  const Icon = active
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <TableHead
      className={`${align === "right" ? "text-right" : ""} text-muted-foreground`}
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        className={`inline-flex w-full items-center gap-1.5 hover:text-foreground ${align === "right" ? "justify-end" : ""}`}
        onClick={onToggle}
        aria-label={ariaLabel}
      >
        {label}
        <Icon className="size-3.5" aria-hidden="true" />
      </button>
    </TableHead>
  );
}

function signedOrZero(value: string, currency: "BRL" | "USD"): string {
  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}

function DailySkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[0, 1, 2].map((item) => (
            <div key={item} className="space-y-2 px-5 py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-36" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-11 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
