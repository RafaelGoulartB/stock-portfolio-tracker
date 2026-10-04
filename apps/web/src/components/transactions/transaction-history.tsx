import { msg, plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  ASSET_CLASSES,
  type AssetClass,
  type Transaction,
  type TransactionList,
  type TransactionSide,
} from "@portifolio-tracker/shared";
import { FileText, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import {
  AssetClassLabel,
  assetClassText,
  SideLabel,
} from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { TableSearch } from "@/components/table-toolbar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMoney, formatQuantity, formatTradeDate } from "@/lib/format";
import { queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";
import { brokerName } from "./broker-note-labels";

/** Server-side narrowing of the history besides the ticker search. */
export type HistoryFilters = {
  side?: TransactionSide;
  assetClass?: AssetClass;
};

const ALL = "all";

type TransactionHistoryProps = {
  data: TransactionList | undefined;
  error: unknown;
  isFetching: boolean;
  isPending: boolean;
  page: number;
  removing: boolean;
  /** Trade currently loaded into the form, highlighted in the table. */
  editingId: string | undefined;
  tickerFilter: string;
  onTickerFilterChange: (value: string) => void;
  filters: HistoryFilters;
  onFiltersChange: (filters: HistoryFilters) => void;
  onPageChange: (page: number) => void;
  onEdit: (transaction: Transaction) => void;
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
  editingId,
  tickerFilter,
  onTickerFilterChange,
  filters,
  onFiltersChange,
  onPageChange,
  onEdit,
  onRemove,
}: TransactionHistoryProps) {
  const filtered =
    tickerFilter.trim() !== "" ||
    filters.side !== undefined ||
    filters.assetClass !== undefined;
  const { i18n } = useLingui();
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
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <TableSearch
              value={tickerFilter}
              onChange={(event) => onTickerFilterChange(event.target.value)}
              placeholder={i18n._(
                msg({
                  id: "transactions.filterPlaceholder",
                  message: "Filter by ticker",
                }),
              )}
              ariaLabel={i18n._(
                msg({
                  id: "transactions.filterLabel",
                  message: "Filter trades by ticker",
                }),
              )}
            />
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={filters.side ?? ALL}
              onValueChange={(value) => {
                if (!value) return;
                onFiltersChange({
                  ...filters,
                  side: value === ALL ? undefined : (value as TransactionSide),
                });
              }}
              aria-label={i18n._(
                msg({ id: "transactions.sideFilter", message: "Side" }),
              )}
            >
              <ToggleGroupItem value={ALL} className="px-3">
                <Trans id="transactions.sideAll">All</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem value="buy" className="px-3">
                <Trans id="transactions.sideBuys">Buys</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem value="sell" className="px-3">
                <Trans id="transactions.sideSells">Sells</Trans>
              </ToggleGroupItem>
            </ToggleGroup>
            <Select
              value={filters.assetClass ?? ALL}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  assetClass: value === ALL ? undefined : (value as AssetClass),
                })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-[168px]"
                aria-label={i18n._(
                  msg({ id: "transactions.classFilter", message: "Class" }),
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  <Trans id="transactions.allClasses">All classes</Trans>
                </SelectItem>
                {ASSET_CLASSES.filter((entry) => entry !== "cash").map(
                  (entry) => (
                    <SelectItem key={entry} value={entry}>
                      {assetClassText(entry, i18n)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            {data ? (
              <p className="ml-auto text-xs text-muted-foreground tabular-nums">
                {i18n._(
                  msg({
                    id: "transactions.sideCounts",
                    message: `${data.sides.buy} buys · ${data.sides.sell} sells`,
                  }),
                )}
              </p>
            ) : null}
          </div>

          {isPending ? <Skeleton className="h-64" /> : null}

          {error ? (
            <p className="py-6 text-sm text-destructive">
              {queryErrorMessage(error)}
            </p>
          ) : null}

          {data?.total === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {filtered ? (
                <Trans id="transactions.emptyFilters">
                  No trades match these filters.
                </Trans>
              ) : (
                <Trans id="transactions.empty">Nothing registered yet.</Trans>
              )}
            </p>
          ) : null}

          {data && data.items.length > 0 ? (
            <div className="space-y-4">
              <HistoryTable
                transactions={data.items}
                editingId={editingId}
                removingId={removing ? selected?.id : undefined}
                onEdit={onEdit}
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

/** `YYYY-MM` of a trade day, the grouping key of the history. */
function monthOf(day: string): string {
  return day.slice(0, 7);
}

function monthHeading(key: string, locale: string): string {
  const [year, month] = key.split("-").map(Number);

  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function HistoryTable({
  transactions,
  editingId,
  onEdit,
  onRequestRemove,
  removingId,
}: {
  transactions: Transaction[];
  editingId: string | undefined;
  onEdit: (transaction: Transaction) => void;
  onRequestRemove: (transaction: Transaction) => void;
  removingId: string | undefined;
}) {
  const { i18n } = useLingui();
  type MonthRow = { kind: "month"; key: string; count: number };
  const rows: Array<MonthRow | { kind: "trade"; transaction: Transaction }> =
    [];
  let heading: MonthRow | undefined;

  // Trades arrive newest first, so a month starts whenever the key changes.
  // A month split across pages counts only the trades on this page.
  for (const transaction of transactions) {
    const key = monthOf(transaction.tradedAt);

    if (heading?.key !== key) {
      heading = { kind: "month", key, count: 0 };
      rows.push(heading);
    }

    heading.count += 1;
    rows.push({ kind: "trade", transaction });
  }

  return (
    <Table className="[&_tbody_td]:py-2">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-muted-foreground">
            <Trans id="transactions.colDate">Date</Trans>
          </TableHead>
          <TableHead className="text-muted-foreground">
            <Trans id="transactions.colTicker">Ticker</Trans>
          </TableHead>
          <TableHead className="text-muted-foreground">
            <Trans id="transactions.colSide">Side</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="transactions.colQuantity">Quantity</Trans>
          </TableHead>
          <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
            <Trans id="transactions.colPrice">Price</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="transactions.colTotal">Total</Trans>
          </TableHead>
          <TableHead className="w-[84px]">
            <span className="sr-only">
              <Trans id="transactions.colActions">Actions</Trans>
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          if (row.kind === "month") {
            return (
              <TableRow
                key={`month-${row.key}`}
                className="bg-muted/30 hover:bg-muted/30"
              >
                <TableCell
                  colSpan={7}
                  className="h-8 py-1 text-xs font-medium text-muted-foreground"
                >
                  <span className="capitalize">
                    {monthHeading(row.key, i18n.locale)}
                  </span>
                  <span className="ml-2 font-normal">
                    {i18n._(
                      msg({
                        id: "transactions.monthCount",
                        message: plural(
                          { count: row.count },
                          { one: "# trade", other: "# trades" },
                        ),
                      }),
                    )}
                  </span>
                </TableCell>
              </TableRow>
            );
          }

          const { transaction } = row;
          const ticker = transaction.ticker;
          const date = transaction.tradedAt;
          const removeLabel = t({
            id: "transactions.remove",
            message: `Review deletion of ${ticker} trade from ${date}`,
          });
          const editLabel = t({
            id: "transactions.editLabel",
            message: `Edit ${ticker} trade from ${date}`,
          });
          const isFixedIncome = transaction.assetClass === "fixed_income";
          const note = transaction.brokerNote;
          const hasFees = !isFixedIncome && Number(transaction.fees) !== 0;

          return (
            <TableRow
              key={transaction.id}
              data-state={editingId === transaction.id ? "selected" : undefined}
            >
              <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                {formatTradeDate(transaction.tradedAt)}
              </TableCell>
              <TableCell className="max-w-[220px]">
                <div className="flex items-center gap-2.5">
                  <AssetLogo
                    ticker={transaction.ticker}
                    assetClass={transaction.assetClass}
                    currency={transaction.currency}
                  />
                  <div className="min-w-0 leading-tight">
                    <AssetLink
                      ticker={transaction.ticker}
                      className="font-medium"
                    >
                      {transaction.ticker}
                    </AssetLink>
                    {note ? (
                      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <FileText
                          className="size-3 shrink-0"
                          aria-hidden="true"
                        />
                        {brokerName(note.format)}
                        {note.noteNumber ? ` · ${note.noteNumber}` : ""}
                      </span>
                    ) : transaction.notes ? (
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={transaction.notes}
                      >
                        {transaction.notes}
                      </span>
                    ) : (
                      <span className="block text-xs text-muted-foreground">
                        <AssetClassLabel assetClass={transaction.assetClass} />
                      </span>
                    )}
                  </div>
                </div>
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
              <TableCell className="text-right tabular-nums">
                {isFixedIncome ? "—" : formatQuantity(transaction.quantity)}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">
                {isFixedIncome
                  ? "—"
                  : formatMoney(transaction.price, transaction.currency)}
                {transaction.currency === "USD" ? (
                  <TradeFxLabel rate={transaction.usdBrlRate} />
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <span className="font-medium">
                  {formatMoney(transaction.total, transaction.currency)}
                </span>
                {hasFees ? (
                  <span className="block text-xs text-muted-foreground">
                    <Trans id="transactions.feesShort">
                      fees {formatMoney(transaction.fees, transaction.currency)}
                    </Trans>
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                {note ? (
                  <span
                    className="flex justify-end text-muted-foreground"
                    title={i18n._(
                      msg({
                        id: "transactions.importedFromNoteHint",
                        message:
                          "Imported from a broker note: delete the whole note to change it.",
                      }),
                    )}
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    <span className="sr-only">
                      <Trans id="transactions.importedFromNote">
                        Imported from a broker note
                      </Trans>
                    </span>
                  </span>
                ) : (
                  <div className="flex justify-end gap-1">
                    {isFixedIncome ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={editLabel}
                        title={editLabel}
                        aria-pressed={editingId === transaction.id}
                        onClick={() => onEdit(transaction)}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      aria-label={removeLabel}
                      title={removeLabel}
                      disabled={removingId === transaction.id}
                      onClick={() => onRequestRemove(transaction)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The trade-date USD/BRL a USD trade's BRL cost converts at. */
function TradeFxLabel({ rate }: { rate: string | null }) {
  return (
    <span
      className={cn(
        "block text-xs",
        rate === null ? "text-caution" : "text-muted-foreground",
      )}
    >
      {rate === null ? (
        <Trans id="transactions.fxPending">FX pending</Trans>
      ) : (
        <Trans id="transactions.fxAt">USD/BRL {formatQuantity(rate)}</Trans>
      )}
    </span>
  );
}
