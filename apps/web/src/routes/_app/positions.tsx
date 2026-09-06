import {
  ASSET_CLASS_LABELS,
  type PortfolioSummary,
} from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
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

export const Route = createFileRoute("/_app/positions")({
  component: PositionsPage,
});

function PositionsPage() {
  const positions = trpc.positions.list.useQuery();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Positions</h1>
          <p className="text-sm text-muted-foreground">
            Consolidated by ticker using the moving average cost of every trade
            you registered.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/transactions">Register a trade</Link>
        </Button>
      </header>

      {positions.isPending ? <PositionsSkeleton /> : null}

      {positions.error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {positions.error.message}
          </CardContent>
        </Card>
      ) : null}

      {positions.data ? (
        <>
          <SummaryCards summary={positions.data.summary} />

          <Card>
            <CardHeader>
              <CardTitle>Holdings</CardTitle>
              <CardDescription>
                Average price and cost include the fees paid on each buy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {positions.data.positions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No positions yet. Register your first trade to see it here.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Avg. price</TableHead>
                      <TableHead className="text-right">Invested</TableHead>
                      <TableHead className="text-right">Realized P&L</TableHead>
                      <TableHead className="text-right">Last trade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.data.positions.map((position) => {
                      const isOpen = Number(position.quantity) > 0;

                      return (
                        <TableRow key={position.ticker}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {position.ticker}
                              {isOpen ? null : (
                                <Badge variant="outline">Closed</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {ASSET_CLASS_LABELS[position.assetClass]}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatQuantity(position.quantity)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {isOpen ? formatMoney(position.averagePrice) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(position.investedCost)}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${pnlClassName(position.realizedPnl)}`}
                          >
                            {Number(position.realizedPnl) === 0
                              ? formatMoney(position.realizedPnl)
                              : formatSignedMoney(position.realizedPnl)}
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

function SummaryCards({ summary }: { summary: PortfolioSummary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader>
          <CardDescription>Invested cost</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {formatMoney(summary.totalInvested)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Cost basis of everything you still hold.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Realized P&L</CardDescription>
          <CardTitle
            className={`text-2xl tabular-nums ${pnlClassName(summary.totalRealizedPnl)}`}
          >
            {Number(summary.totalRealizedPnl) === 0
              ? formatMoney(summary.totalRealizedPnl)
              : formatSignedMoney(summary.totalRealizedPnl)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Result already locked in by your sells.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Assets</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {summary.openPositions}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {summary.closedPositions} closed{" "}
          {summary.closedPositions === 1 ? "position" : "positions"}.
        </CardContent>
      </Card>
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
