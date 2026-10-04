import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { BrokerNoteSummary } from "@portifolio-tracker/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { Eye, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SideLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
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
import { trpc } from "@/lib/api";
import {
  formatMoney,
  formatPreciseMoney,
  formatQuantity,
  formatTradeDate,
} from "@/lib/format";
import {
  queryErrorMessage,
  removeBrokerNoteErrorMessage,
} from "@/lib/trpcErrors";
import { brokerName } from "./broker-note-labels";

const PAGE_SIZE = 50;

/** Imported notes, newest trade date first, with details and deletion. */
export function BrokerNoteList({
  onRemoved,
}: {
  onRemoved: () => Promise<void>;
}) {
  useLingui();
  const [page, setPage] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BrokerNoteSummary | null>(null);
  const list = trpc.brokerNotes.list.useQuery(
    { page, pageSize: PAGE_SIZE },
    { placeholderData: keepPreviousData },
  );
  const remove = trpc.brokerNotes.remove.useMutation({
    onSuccess: async (result) => {
      const count = result.transactions;
      toast.success(
        t({
          id: "brokerNotes.removed",
          message: plural(
            { count },
            {
              one: "Note deleted with its # trade",
              other: "Note deleted with its # trades",
            },
          ),
        }),
      );
      setRemoving(null);
      setPage(0);
      await onRemoved();
    },
    onError: (error) => toast.error(removeBrokerNoteErrorMessage(error)),
  });

  const data = list.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="brokerNotes.listTitle">Imported notes</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="brokerNotes.listHint">
            Deleting a note removes every trade imported from it.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.isPending ? <Skeleton className="h-32" /> : null}
        {list.error ? (
          <p className="py-6 text-sm text-destructive">
            {queryErrorMessage(list.error)}
          </p>
        ) : null}
        {data?.total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            <Trans id="brokerNotes.empty">No broker note imported yet.</Trans>
          </p>
        ) : null}

        {data && data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans id="brokerNotes.colTradeDate">Trade date</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans id="brokerNotes.colBroker">Broker</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans id="brokerNotes.colTrades">Trades</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans id="brokerNotes.fees">Costs</Trans>
                  </TableHead>
                  <TableHead className="text-right">
                    <Trans id="brokerNotes.net">Net</Trans>
                  </TableHead>
                  <TableHead className="w-[196px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((note) => {
                  const date = formatTradeDate(note.tradeDate);
                  const broker = brokerName(note.format);

                  return (
                    <TableRow key={note.id}>
                      <TableCell className="whitespace-nowrap">
                        {date}
                      </TableCell>
                      <TableCell>
                        <span className="block">{broker}</span>
                        <span className="block max-w-64 truncate text-xs text-muted-foreground">
                          {note.noteNumber ? `${note.noteNumber} · ` : ""}
                          {note.fileName}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {note.tradeCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatMoney(note.feesTotal, note.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(note.netAmount, note.currency)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={t({
                              id: "brokerNotes.viewLabel",
                              message: `View the ${broker} note of ${date}`,
                            })}
                            onClick={() => setViewing(note.id)}
                          >
                            <Eye className="size-4" aria-hidden="true" />
                            <Trans id="brokerNotes.view">View</Trans>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={t({
                              id: "brokerNotes.deleteLabel",
                              message: `Review deletion of the ${broker} note of ${date}`,
                            })}
                            onClick={() => setRemoving(note)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            <Trans id="transactions.delete">Delete</Trans>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {data && data.total > data.pageSize ? (
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
                disabled={page === 0 || list.isFetching}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                <Trans id="transactions.previous">Previous</Trans>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  list.isFetching || (page + 1) * data.pageSize >= data.total
                }
                onClick={() => setPage((value) => value + 1)}
              >
                <Trans id="transactions.next">Next</Trans>
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <BrokerNoteDetailDialog id={viewing} onClose={() => setViewing(null)} />

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <DialogTitleIcon className="border-destructive/30 bg-destructive/10 text-destructive">
                <TriangleAlert aria-hidden="true" />
              </DialogTitleIcon>
              <Trans id="brokerNotes.removeTitle">Delete broker note?</Trans>
            </DialogTitle>
            <DialogDescription>
              {removing
                ? t({
                    id: "brokerNotes.removeDescription",
                    message: plural(
                      { count: removing.tradeCount },
                      {
                        one: "This permanently removes the note and its # trade, and recalculates positions and results. You can import the PDF again later.",
                        other:
                          "This permanently removes the note and its # trades, and recalculates positions and results. You can import the PDF again later.",
                      },
                    ),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          {removing ? (
            <p className="rounded-lg border bg-muted/40 p-4 text-sm">
              {formatTradeDate(removing.tradeDate)} ·{" "}
              {brokerName(removing.format)} · {removing.fileName}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setRemoving(null)}
            >
              <Trans id="common.cancel">Cancel</Trans>
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending || removing === null}
              onClick={() => {
                if (removing) remove.mutate({ id: removing.id });
              }}
            >
              <Trash2 aria-hidden="true" />
              {remove.isPending ? (
                <Trans id="transactions.removing">Deleting…</Trans>
              ) : (
                <Trans id="brokerNotes.removeConfirm">Delete note</Trans>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function BrokerNoteDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  useLingui();
  const detail = trpc.brokerNotes.get.useQuery(
    { id: id ?? "" },
    { enabled: id !== null },
  );
  const note = id !== null ? detail.data : undefined;
  const lines = note?.details.lines ?? [];

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {note ? (
              <>
                {brokerName(note.format)} · {formatTradeDate(note.tradeDate)}
              </>
            ) : (
              <Trans id="brokerNotes.detailTitle">Broker note</Trans>
            )}
          </DialogTitle>
          <DialogDescription>
            {note ? <span className="break-all">{note.fileName}</span> : null}
          </DialogDescription>
        </DialogHeader>

        {detail.isPending && id !== null ? <Skeleton className="h-40" /> : null}
        {detail.error ? (
          <p className="text-sm text-destructive">
            {queryErrorMessage(detail.error)}
          </p>
        ) : null}

        {note ? (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              {note.noteNumber ? (
                <>
                  <dt className="text-muted-foreground">
                    <Trans id="brokerNotes.colNumber">Note number</Trans>
                  </dt>
                  <dd>{note.noteNumber}</dd>
                </>
              ) : null}
              {note.settlementDate ? (
                <>
                  <dt className="text-muted-foreground">
                    <Trans id="brokerNotes.settlement">Settlement</Trans>
                  </dt>
                  <dd>{formatTradeDate(note.settlementDate)}</dd>
                </>
              ) : null}
              {note.account ? (
                <>
                  <dt className="text-muted-foreground">
                    <Trans id="brokerNotes.account">Account</Trans>
                  </dt>
                  <dd>{note.account}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">
                <Trans id="brokerNotes.purchases">Purchases</Trans>
              </dt>
              <dd className="tabular-nums">
                {formatMoney(note.purchasesTotal, note.currency)}
              </dd>
              <dt className="text-muted-foreground">
                <Trans id="brokerNotes.sales">Sales</Trans>
              </dt>
              <dd className="tabular-nums">
                {formatMoney(note.salesTotal, note.currency)}
              </dd>
              <dt className="text-muted-foreground">
                <Trans id="brokerNotes.fees">Costs</Trans>
              </dt>
              <dd className="tabular-nums">
                {formatMoney(note.feesTotal, note.currency)}
              </dd>
              <dt className="text-muted-foreground">
                <Trans id="brokerNotes.withheldTax">IRRF withheld</Trans>
              </dt>
              <dd className="tabular-nums">
                {formatMoney(note.withheldTax, note.currency)}
              </dd>
              <dt className="text-muted-foreground">
                <Trans id="brokerNotes.net">Net</Trans>
              </dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(note.netAmount, note.currency)}
              </dd>
            </dl>

            {note.details.fees.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {note.details.fees
                  .map(
                    (fee) =>
                      `${fee.label}: ${formatMoney(fee.amount, note.currency)}`,
                  )
                  .join(" · ")}
              </p>
            ) : null}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Trans id="brokerNotes.colSecurity">Security</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans id="transactions.colTicker">Ticker</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans id="transactions.colSide">Side</Trans>
                    </TableHead>
                    <TableHead className="text-right">
                      <Trans id="transactions.colQuantity">Quantity</Trans>
                    </TableHead>
                    <TableHead className="text-right">
                      <Trans id="brokerNotes.colExecutionPrice">
                        Note price
                      </Trans>
                    </TableHead>
                    <TableHead className="text-right">
                      <Trans id="brokerNotes.colGross">Value</Trans>
                    </TableHead>
                    <TableHead className="text-right">
                      <Trans id="transactions.colFees">Fees</Trans>
                    </TableHead>
                    <TableHead className="text-right">
                      <Trans id="transactions.colTotal">Total</Trans>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {note.trades.map((trade, index) => {
                    const line = lines[index];

                    return (
                      <TableRow key={trade.id}>
                        <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                          {line?.description ?? "—"}
                        </TableCell>
                        <TableCell className="font-medium">
                          <AssetLink ticker={trade.ticker}>
                            {trade.ticker}
                          </AssetLink>
                        </TableCell>
                        <TableCell>
                          <SideLabel side={trade.side} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatQuantity(trade.quantity)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPreciseMoney(
                            line?.executionPrice ?? trade.price,
                            note.currency,
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line
                            ? formatMoney(line.grossValue, note.currency)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatPreciseMoney(trade.fees, note.currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(trade.total, note.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              SHA-256 {note.fileSha256}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
