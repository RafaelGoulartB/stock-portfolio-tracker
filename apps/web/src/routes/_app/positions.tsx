import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { Currency, PortfolioSummary } from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AssetClassLabel, CurrencyBadge } from "@/components/asset-labels";
import { Badge } from "@/components/ui/badge";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/api";
import {
  formatMoney,
  formatQuantity,
  formatSignedMoney,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/positions")({
  component: PositionsPage,
});

function PositionsPage() {
  // Subscribes this page to locale changes; amounts and dates below are
  // rendered with `Intl` using the active locale.
  useLingui();
  const { displayCurrency } = useSettings();
  const fx = useFxQuote();
  const positions = trpc.positions.list.useQuery({
    displayCurrency,
    usdBrlRate: fx.effectiveRate,
  });

  // The portfolio cannot consolidate mixed currencies until the quote
  // arrives; keep the skeleton instead of flashing a rate error.
  const waitingForRate =
    !!positions.error && isFxRateRequired(positions.error) && fx.isPending;
  const fxFailed =
    !!positions.error &&
    isFxRateRequired(positions.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="positions.title">Positions</Trans>
          </h1>
          <p className="text-sm text-muted-foreground">
            <Trans id="positions.subtitle">
              Consolidated by ticker and currency using the moving average cost
              of every trade you registered.
            </Trans>
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/transactions">
            <Trans id="positions.registerTrade">Register a trade</Trans>
          </Link>
        </Button>
      </header>

      {positions.isPending || waitingForRate ? <PositionsSkeleton /> : null}

      {fxFailed ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            <Trans id="positions.fxFailed">
              Could not fetch the exchange rate. Try another source or enter it
              manually.
            </Trans>
          </CardContent>
        </Card>
      ) : null}

      {positions.error && !waitingForRate && !fxFailed ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {queryErrorMessage(positions.error)}
          </CardContent>
        </Card>
      ) : null}

      {positions.data ? (
        <>
          <SummaryCards summary={positions.data.summary} />

          <Card>
            <CardHeader>
              <CardTitle>
                <Trans id="positions.holdings">Holdings</Trans>
              </CardTitle>
              <CardDescription>
                <Trans id="positions.holdingsHint">
                  Average price and cost include the fees paid on each buy.
                  Foreign amounts convert at the rate from Settings.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {positions.data.positions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  <Trans id="positions.empty">
                    No positions yet. Register your first trade to see it here.
                  </Trans>
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <Trans id="positions.colTicker">Ticker</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans id="positions.colClass">Class</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans id="positions.colCurrency">Ccy</Trans>
                      </TableHead>
                      <TableHead className="text-right">
                        <Trans id="positions.colQuantity">Quantity</Trans>
                      </TableHead>
                      <TableHead className="text-right">
                        <Trans id="positions.colAvgPrice">Avg. price</Trans>
                      </TableHead>
                      <TableHead className="text-right">
                        <Trans id="positions.colInvested">Invested</Trans>
                      </TableHead>
                      <TableHead className="text-right">
                        <Trans id="positions.colRealized">Realized P&L</Trans>
                      </TableHead>
                      <TableHead className="text-right">
                        <Trans id="positions.colLastTrade">Last trade</Trans>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.data.positions.map((position) => {
                      const isOpen = Number(position.quantity) > 0;

                      return (
                        <TableRow
                          key={`${position.ticker}|${position.currency}`}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {position.ticker}
                              {isOpen ? null : (
                                <Badge variant="outline">
                                  <Trans id="positions.closed">Closed</Trans>
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <AssetClassLabel assetClass={position.assetClass} />
                          </TableCell>
                          <TableCell>
                            <CurrencyBadge currency={position.currency} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatQuantity(position.quantity)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {isOpen ? (
                              <ConvertedMoney
                                native={position.averagePrice}
                                nativeCurrency={position.currency}
                                converted={position.convertedAveragePrice}
                                displayCurrency={position.displayCurrency}
                              />
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <ConvertedMoney
                              native={position.investedCost}
                              nativeCurrency={position.currency}
                              converted={position.convertedInvestedCost}
                              displayCurrency={position.displayCurrency}
                            />
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${pnlClassName(position.convertedRealizedPnl)}`}
                          >
                            {Number(position.convertedRealizedPnl) === 0 ? (
                              formatMoney(
                                position.convertedRealizedPnl,
                                position.displayCurrency,
                              )
                            ) : (
                              <ConvertedMoney
                                native={position.realizedPnl}
                                nativeCurrency={position.currency}
                                converted={position.convertedRealizedPnl}
                                displayCurrency={position.displayCurrency}
                                signed
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatTradeDate(position.lastTradedAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** Display-currency amount with the native amount underneath when converted. */
function ConvertedMoney({
  native,
  nativeCurrency,
  converted,
  displayCurrency,
  signed = false,
}: {
  native: string;
  nativeCurrency: Currency;
  converted: string;
  displayCurrency: Currency;
  signed?: boolean;
}) {
  const primary = signed
    ? formatSignedMoney(converted, displayCurrency)
    : formatMoney(converted, displayCurrency);

  if (nativeCurrency === displayCurrency) {
    return primary;
  }

  return (
    <span>
      {primary}
      <span className="block text-xs font-normal text-muted-foreground">
        {formatMoney(native, nativeCurrency)}
      </span>
    </span>
  );
}

function SummaryCards({ summary }: { summary: PortfolioSummary }) {
  useLingui();
  const breakdown = summary.totalsByCurrency
    .map(
      (total) =>
        `${formatMoney(total.investedCost, total.currency)} ${total.currency}`,
    )
    .join(" + ");

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>
              <Trans id="positions.investedCost">Invested cost</Trans>
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMoney(summary.totalInvested, summary.displayCurrency)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Trans id="positions.investedCostHint">
              Cost basis of everything you still hold.
            </Trans>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>
              <Trans id="positions.realizedPnl">Realized P&L</Trans>
            </CardDescription>
            <CardTitle
              className={`text-2xl tabular-nums ${pnlClassName(summary.totalRealizedPnl)}`}
            >
              {Number(summary.totalRealizedPnl) === 0
                ? formatMoney(summary.totalRealizedPnl, summary.displayCurrency)
                : formatSignedMoney(
                    summary.totalRealizedPnl,
                    summary.displayCurrency,
                  )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Trans id="positions.realizedPnlHint">
              Result already locked in by your sells.
            </Trans>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>
              <Trans id="positions.assets">Assets</Trans>
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {summary.openPositions}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t({
              id: "positions.closedCount",
              message: plural(
                { count: summary.closedPositions },
                {
                  one: "# closed position",
                  other: "# closed positions",
                },
              ),
            })}
            .
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        {summary.usdBrlRate ? (
          <>
            <Trans id="positions.consolidationRate">
              Consolidated at 1 USD = {formatQuantity(summary.usdBrlRate)} BRL.
            </Trans>{" "}
          </>
        ) : null}
        {breakdown ? (
          <Trans id="positions.nativeBreakdown">
            Native totals: {breakdown}.
          </Trans>
        ) : null}
      </p>
    </div>
  );
}

function PositionsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
