import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { Transaction, TransactionList } from "@portifolio-tracker/shared";
import { Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { CurrencyBadge, SideLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTitleIcon,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatQuantity, formatTradeDate } from "@/lib/format";
import { queryErrorMessage } from "@/lib/trpcErrors";

type TransactionHistoryProps = {
  data: TransactionList | undefined;
  error: unknown;
  isFetching: boolean;
  isPending: boolean;
  page: number;
  removing: boolean;
  onPageChange: (page: number) => void;
  onRemove: (id: string) => Promise<void>;
};

/** Paginated ledger history with a deliberate confirmation before deletion. */
export function TransactionHistory({
  data,
  error,
  isFetching,
  isPending,
  page,
  removing,
  onPageChange,
  onRemove,
}: TransactionHistoryProps) {
  const [selected, setSelected] = useState<Transaction | null>(null);

  async function confirmRemove() {
    if (!selected || removing) return;

    try {
      await onRemove(selected.id);
      setSelected(null);
    } catch {
      // The mutation owns localized error feedback; keep the dialog open so
      // the user can review the rejected destructive action or cancel it.
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans id="transactions.history">History</Trans>
          </CardTitle>
          <CardDescription>
            <Trans id="transactions.historyHint">
              Most recent trades first.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? <Skeleton className="h-64" /> : null}

          {error ? (
            <p className="py-6 text-sm text-destructive">
              {queryErrorMessage(error)}
            </p>
          ) : null}

          {data?.total === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              <Trans id="transactions.empty">Nothing registered yet.</Trans>
            </p>
          ) : null}

          {data && data.items.length > 0 ? (
            <div className="space-y-4">
              <HistoryTable
                transactions={data.items}
                removingId={removing ? selected?.id : undefined}
                onRequestRemove={setSelected}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  <Trans id="transactions.pageSummary">
                    {page * data.pageSize + 1}–
                    {Math.min((page + 1) * data.pageSize, data.total)} of{" "}
                    {data.total}
                  </Trans>
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page === 0 || isFetching}
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                  >
                    <Trans id="transactions.previous">Previous</Trans>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      isFetching || (page + 1) * data.pageSize >= data.total
                    }
                    onClick={() => onPageChange(page + 1)}
                  >
                    <Trans id="transactions.next">Next</Trans>
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <RemoveTransactionDialog
        transaction={selected}
        removing={removing}
        onCancel={() => setSelected(null)}
        onConfirm={confirmRemove}
      />
    </>
  );
}

function RemoveTransactionDialog({
  transaction,
  removing,
  onCancel,
  onConfirm,
}: {
  transaction: Transaction | null;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useLingui();

  return (
    <Dialog
      open={transaction !== null}
      onOpenChange={(open) => {
        if (!open && !removing) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <DialogTitleIcon className="border-destructive/30 bg-destructive/10 text-destructive">
              <TriangleAlert aria-hidden="true" />
            </DialogTitleIcon>
            <Trans id="transactions.removeTitle">Delete transaction?</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="transactions.removeDescription">
              This permanently removes the trade and recalculates positions and
              results. This action cannot be undone.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        {transaction ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
            <dt className="text-muted-foreground">
              <Trans id="transactions.colTicker">Ticker</Trans>
            </dt>
            <dd className="text-right font-medium">{transaction.ticker}</dd>
            <dt className="text-muted-foreground">
              <Trans id="transactions.colDate">Date</Trans>
            </dt>
            <dd className="text-right">
              {formatTradeDate(transaction.tradedAt)}
            </dd>
            <dt className="text-muted-foreground">
              <Trans id="transactions.colSide">Side</Trans>
            </dt>
            <dd className="text-right">
              <SideLabel side={transaction.side} />
            </dd>
            <dt className="text-muted-foreground">
              <Trans id="transactions.colQuantity">Quantity</Trans>
            </dt>
            <dd className="text-right tabular-nums">
              {transaction.assetClass === "fixed_income"
                ? "—"
                : formatQuantity(transaction.quantity)}
            </dd>
            <dt className="text-muted-foreground">
              <Trans id="transactions.colTotal">Total</Trans>
            </dt>
            <dd className="text-right font-medium tabular-nums">
              {formatMoney(transaction.total, transaction.currency)}
            </dd>
          </dl>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={removing}
            onClick={onCancel}
          >
            <Trans id="common.cancel">Cancel</Trans>
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={removing}
            onClick={onConfirm}
          >
            <Trash2 aria-hidden="true" />
            {removing ? (
              <Trans id="transactions.removing">Deleting…</Trans>
            ) : (
              <Trans id="transactions.removeConfirm">Delete transaction</Trans>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryTable({
  transactions,
  onRequestRemove,
  removingId,
}: {
  transactions: Transaction[];
  onRequestRemove: (transaction: Transaction) => void;
  removingId: string | undefined;
}) {
  useLingui();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Trans id="transactions.colDate">Date</Trans>
          </TableHead>
          <TableHead>
            <Trans id="transactions.colTicker">Ticker</Trans>
          </TableHead>
          <TableHead>
            <Trans id="transactions.colSide">Side</Trans>
          </TableHead>
          <TableHead>
            <Trans id="transactions.colCurrency">Ccy</Trans>
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
          <TableHead className="w-[104px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((transaction) => {
          const ticker = transaction.ticker;
          const date = transaction.tradedAt;
          const removeLabel = t({
            id: "transactions.remove",
            message: `Review deletion of ${ticker} trade from ${date}`,
          });

          return (
            <TableRow key={transaction.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatTradeDate(transaction.tradedAt)}
              </TableCell>
              <TableCell className="font-medium">
                <AssetLink ticker={transaction.ticker}>
                  {transaction.ticker}
                </AssetLink>
                {transaction.notes ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {transaction.notes}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    transaction.side === "buy"
                      ? "border-gain/40 text-gain"
                      : "border-loss/40 text-loss"
                  }
                >
                  <SideLabel side={transaction.side} />
                </Badge>
              </TableCell>
              <TableCell>
                <CurrencyBadge currency={transaction.currency} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {transaction.assetClass === "fixed_income"
                  ? "—"
                  : formatQuantity(transaction.quantity)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {transaction.assetClass === "fixed_income"
                  ? "—"
                  : formatMoney(transaction.price, transaction.currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {transaction.assetClass === "fixed_income"
                  ? "—"
                  : formatMoney(transaction.fees, transaction.currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(transaction.total, transaction.currency)}
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={removeLabel}
                  title={removeLabel}
                  disabled={removingId === transaction.id}
                  onClick={() => onRequestRemove(transaction)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  <Trans id="transactions.delete">Delete</Trans>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
