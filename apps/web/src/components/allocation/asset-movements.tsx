import { Trans } from "@lingui/react/macro";
import type { AllocationRow, TickerLedger } from "@portifolio-tracker/shared";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SideLabel } from "@/components/asset-labels";
import { Badge } from "@/components/ui/badge";
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
import {
  formatMoney,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
import { cn } from "@/lib/utils";

function signedMoney(
  value: string,
  currency: TickerLedger["currency"],
): string {
  if (!currency) {
    return value;
  }

  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}

/** Buys, sells, realized P&L and the remaining cost basis of one ticker. */
export function AssetMovements({
  row,
  ledger,
}: {
  row: AllocationRow;
  ledger: TickerLedger;
}) {
  const currency = ledger.currency ?? row.currency;
  // The API already consolidated the open result, its percentage and the
  // combined total against the ledger; the detail view only formats them.
  const unrealized = row.unrealizedPnl;
  const unrealizedPercent = row.unrealizedPnlPercent;
  const combined = row.totalResult;

  return (
    <div className="space-y-5">
      {ledger.trades.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans id="allocation.detailResult">Financial result</Trans>
            </CardTitle>
            <CardDescription>
              <Trans id="allocation.detailResultHint">
                Moving-average cost. Realized P&L locks in on sells; the open
                result is the remaining lot versus the market.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ResultStat
                label={<Trans id="allocation.detailInvested">Invested</Trans>}
                value={formatMoney(ledger.investedCost, currency)}
                hint={
                  <Trans id="allocation.detailInvestedHint">
                    Cost still held at the average price.
                  </Trans>
                }
              />
              <ResultStat
                label={
                  <Trans id="allocation.detailOpenResult">Open result</Trans>
                }
                value={
                  unrealized === null ? "—" : signedMoney(unrealized, currency)
                }
                hint={
                  unrealized !== null && unrealizedPercent ? (
                    <span className={pnlClassName(unrealized)}>
                      {formatSignedPercent(unrealizedPercent)}
                    </span>
                  ) : (
                    <Trans id="allocation.detailOpenResultHint">
                      Market minus remaining cost.
                    </Trans>
                  )
                }
                className={unrealized ? pnlClassName(unrealized) : undefined}
              />
              <ResultStat
                label={<Trans id="positions.realizedPnl">Realized P&L</Trans>}
                value={signedMoney(ledger.realizedPnl, currency)}
                hint={
                  <Trans id="positions.realizedPnlHint">
                    Result already locked in by your sells.
                  </Trans>
                }
                className={pnlClassName(ledger.realizedPnl)}
              />
              <ResultStat
                label={
                  <Trans id="allocation.detailTotalResult">Total result</Trans>
                }
                value={signedMoney(combined, currency)}
                hint={
                  unrealized === null ? (
                    <Trans id="allocation.detailTotalResultClosed">
                      Realized only — no open lot.
                    </Trans>
                  ) : (
                    <Trans id="allocation.detailTotalResultHint">
                      Open result plus realized P&L.
                    </Trans>
                  )
                }
                className={pnlClassName(combined)}
              />
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans id="allocation.detailMovements">Trades</Trans>
          </CardTitle>
          <CardDescription>
            {ledger.trades.length === 0 ? (
              <Trans id="allocation.detailMovementsHint">
                Every buy and sell that moved this position.
              </Trans>
            ) : (
              <Trans id="allocation.detailMovementsSummary">
                {ledger.buyCount} buys · {ledger.sellCount} sells ·{" "}
                {formatQuantity(ledger.buyQuantity)} bought ·{" "}
                {formatQuantity(ledger.sellQuantity)} sold
              </Trans>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ledger.trades.length === 0 ? (
            <EmptyTrades />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans id="transactions.colDate">Date</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans id="transactions.colSide">Side</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans id="transactions.colQuantity">Quantity</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans id="transactions.colPrice">Price</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans id="transactions.colFees">Fees</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans id="transactions.colTotal">Total</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans id="allocation.detailRealizedCol">Realized</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTradeDate(trade.tradedAt)}
                      {trade.notes ? (
                        <span className="block max-w-48 truncate text-xs font-normal">
                          {trade.notes}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          trade.side === "buy"
                            ? "border-gain/40 text-gain"
                            : "border-loss/40 text-loss"
                        }
                      >
                        <SideLabel side={trade.side} />
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(trade.quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(trade.price, trade.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(trade.fees, trade.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(trade.total, trade.currency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        trade.realizedPnl
                          ? pnlClassName(trade.realizedPnl)
                          : "text-muted-foreground",
                      )}
                    >
                      {trade.realizedPnl
                        ? signedMoney(trade.realizedPnl, trade.currency)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyTrades() {
  return (
    <div className="space-y-3 py-2 text-sm text-muted-foreground">
      <p>
        <Trans id="allocation.detailMovementsEmpty">
          No buys or sells yet for this ticker.
        </Trans>
      </p>
      <Button type="button" variant="outline" size="sm" asChild>
        <Link to="/transactions">
          <Trans id="positions.registerTrade">Register a trade</Trans>
        </Link>
      </Button>
    </div>
  );
}

function ResultStat({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-sm font-medium tabular-nums", className)}>
        {value}
      </dd>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
