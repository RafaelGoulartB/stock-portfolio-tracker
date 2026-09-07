import { zodResolver } from "@hookform/resolvers/zod";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  ASSET_CLASSES,
  type BookHoldingRow,
  CURRENCIES,
  CURRENCY_LABELS,
  createTransactionInput,
  TRANSACTION_SIDES,
  type Transaction,
} from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import {
  AssetClassLabel,
  CurrencyBadge,
  SideLabel,
} from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { BookHoldingsPanel } from "@/components/transactions/book-holdings-panel";
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
import { trpc } from "@/lib/api";
import { formatMoney, formatQuantity, formatTradeDate } from "@/lib/format";
import {
  bookHoldingsErrorMessage,
  createTradeErrorMessage,
  queryErrorMessage,
  removeTradeErrorMessage,
} from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/transactions")({
  component: TransactionsPage,
});

type FormValues = z.input<typeof createTransactionInput>;
type EntryMode = "trade" | "book";

function today(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;

  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

const emptyForm = (): FormValues => ({
  ticker: "",
  assetClass: "stock_br",
  currency: "BRL",
  side: "buy",
  quantity: "",
  price: "",
  value: "",
  fees: "0",
  tradedAt: today(),
  notes: "",
});

function TransactionsPage() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const list = trpc.transactions.list.useQuery();
  const [mode, setMode] = useState<EntryMode>("trade");
  const [openingDate, setOpeningDate] = useState(today);
  const [bookEpoch, setBookEpoch] = useState(0);

  const form = useForm<FormValues>({
    resolver: zodResolver(createTransactionInput),
    defaultValues: emptyForm(),
  });
  const isFixedIncome = form.watch("assetClass") === "fixed_income";

  async function refresh() {
    await Promise.all([
      utils.transactions.list.invalidate(),
      utils.positions.list.invalidate(),
      utils.allocation.list.invalidate(),
      utils.performance.history.invalidate(),
    ]);
  }

  const create = trpc.transactions.create.useMutation({
    onSuccess: async (transaction) => {
      const side =
        transaction.side === "buy"
          ? i18n._(msg({ id: "side.buy", message: "Buy" }))
          : i18n._(msg({ id: "side.sell", message: "Sell" }));
      const quantity = formatQuantity(transaction.quantity);
      const ticker = transaction.ticker;

      toast.success(
        t({
          id: "transactions.registered",
          message: `${side} of ${quantity} ${ticker} registered`,
        }),
      );
      form.reset({ ...emptyForm(), tradedAt: transaction.tradedAt });
      await refresh();
    },
    onError: (error) => toast.error(createTradeErrorMessage(error)),
  });

  const book = trpc.transactions.bookHoldings.useMutation({
    onSuccess: async (created) => {
      const count = created.length;
      toast.success(
        t({
          id: "transactions.booked",
          message: `${count} holdings booked as buys`,
        }),
      );
      setBookEpoch((value) => value + 1);
      await refresh();
    },
    onError: (error) => toast.error(bookHoldingsErrorMessage(error)),
  });

  const remove = trpc.transactions.remove.useMutation({
    onSuccess: async () => {
      toast.success(
        i18n._(
          msg({
            id: "transactions.removed",
            message: "Transaction removed",
          }),
        ),
      );
      await refresh();
    },
    onError: (error) => toast.error(removeTradeErrorMessage(error)),
  });

  function bookHoldings(holdings: BookHoldingRow[], tradedAt: string) {
    book.mutate({
      tradedAt,
      holdings,
      notes: "Opening position",
    });
  }

  const history = (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="transactions.history">History</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="transactions.historyHint">Most recent trades first.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {list.isPending ? <Skeleton className="h-64" /> : null}

        {list.error ? (
          <p className="py-6 text-sm text-destructive">
            {queryErrorMessage(list.error)}
          </p>
        ) : null}

        {list.data?.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            <Trans id="transactions.empty">Nothing registered yet.</Trans>
          </p>
        ) : null}

        {list.data && list.data.length > 0 ? (
          <HistoryTable
            transactions={list.data}
            onRemove={(id) => remove.mutate({ id })}
            removingId={remove.isPending ? remove.variables?.id : undefined}
          />
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="transactions.title">Transactions</Trans>
          </h1>
          <p className="text-sm text-muted-foreground">
            <Trans id="transactions.subtitle">
              Register every buy and sell. Positions are consolidated from this
              log.
            </Trans>
          </p>
        </div>

        <div
          className="inline-flex rounded-lg border bg-muted/40 p-1"
          role="tablist"
          aria-label={i18n._(
            msg({
              id: "transactions.entryMode",
              message: "Entry mode",
            }),
          )}
        >
          <Button
            type="button"
            size="sm"
            role="tab"
            aria-selected={mode === "trade"}
            variant={mode === "trade" ? "default" : "ghost"}
            className={cn(mode !== "trade" && "text-muted-foreground")}
            onClick={() => setMode("trade")}
          >
            <Trans id="transactions.modeTrade">New trade</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            role="tab"
            aria-selected={mode === "book"}
            variant={mode === "book" ? "default" : "ghost"}
            className={cn(mode !== "book" && "text-muted-foreground")}
            onClick={() => setMode("book")}
          >
            <Trans id="transactions.modeBook">Book holdings</Trans>
          </Button>
        </div>
      </header>

      {mode === "trade" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>
                <Trans id="transactions.newTrade">New trade</Trans>
              </CardTitle>
              <CardDescription>
                <Trans id="transactions.feesHint">
                  Fees are added to a buy and subtracted from a sell.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  className="space-y-4"
                  onSubmit={form.handleSubmit((values) =>
                    create.mutate(values),
                  )}
                  noValidate
                >
                  <FormField
                    control={form.control}
                    name="ticker"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {isFixedIncome ? (
                            <Trans id="transactions.fixedIncomeName">
                              Name
                            </Trans>
                          ) : (
                            <Trans id="transactions.ticker">Ticker</Trans>
                          )}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={
                              isFixedIncome ? "Tesouro Selic 2031" : "PETR4"
                            }
                            autoComplete="off"
                            className="uppercase"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    {!isFixedIncome ? (
                      <FormField
                        control={form.control}
                        name="side"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <Trans id="transactions.side">Side</Trans>
                            </FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {TRANSACTION_SIDES.map((side) => (
                                  <SelectItem key={side} value={side}>
                                    <SideLabel side={side} />
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : (
                      <div />
                    )}

                    <FormField
                      control={form.control}
                      name="assetClass"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <Trans id="transactions.class">Class</Trans>
                          </FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              // Stocks imply their home currency; the user can
                              // still override it below.
                              if (value === "stock_us") {
                                form.setValue("currency", "USD");
                              } else if (value === "stock_br") {
                                form.setValue("currency", "BRL");
                              } else if (value === "fixed_income") {
                                form.setValue("side", "buy");
                              }
                            }}
                          >
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {ASSET_CLASSES.map((assetClass) => (
                                <SelectItem key={assetClass} value={assetClass}>
                                  <AssetClassLabel assetClass={assetClass} />
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {isFixedIncome ? (
                    <FormField
                      control={form.control}
                      name="value"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <Trans id="transactions.currentValue">
                              Current value
                            </Trans>
                          </FormLabel>
                          <FormControl>
                            <Input
                              inputMode="decimal"
                              placeholder="10000.00"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            <Trans id="transactions.fixedIncomeValueHint">
                              This value is maintained by you. Update it later
                              from the Allocation page; no return is calculated
                              for fixed income.
                            </Trans>
                            <Link
                              to="/allocation"
                              className="mt-1 block w-fit text-primary underline-offset-4 hover:underline"
                            >
                              <Trans id="transactions.updateFixedIncomeValue">
                                Update current value
                              </Trans>
                            </Link>
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="quantity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <Trans id="transactions.quantity">Quantity</Trans>
                            </FormLabel>
                            <FormControl>
                              <Input
                                inputMode="decimal"
                                placeholder="100"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="price"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <Trans id="transactions.unitPrice">
                                Unit price
                              </Trans>
                            </FormLabel>
                            <FormControl>
                              <Input
                                inputMode="decimal"
                                placeholder="32.15"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="currency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <Trans id="transactions.currency">Currency</Trans>
                          </FormLabel>
                          <Select
                            value={field.value ?? "BRL"}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {CURRENCIES.map((currency) => (
                                <SelectItem key={currency} value={currency}>
                                  {CURRENCY_LABELS[currency]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            <Trans id="transactions.currencyLockHint">
                              A ticker always uses the currency of its first
                              trade.
                            </Trans>
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {isFixedIncome ? (
                      <div />
                    ) : (
                      <FormField
                        control={form.control}
                        name="fees"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <Trans id="transactions.fees">Fees</Trans>
                            </FormLabel>
                            <FormControl>
                              <Input
                                inputMode="decimal"
                                placeholder="0"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>

                  <FormField
                    control={form.control}
                    name="tradedAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans id="transactions.tradeDate">Trade date</Trans>
                        </FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans id="transactions.notes">Notes</Trans>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={i18n._(
                              msg({
                                id: "transactions.notesHint",
                                message: "Optional",
                              }),
                            )}
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormDescription>
                          <Trans id="transactions.notesDescription">
                            Broker, strategy or anything worth remembering.
                          </Trans>
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={create.isPending}
                  >
                    {create.isPending ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    {isFixedIncome ? (
                      <Trans id="transactions.registerFixedIncome">
                        Register fixed income
                      </Trans>
                    ) : (
                      <Trans id="transactions.register">Register trade</Trans>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          {history}
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans id="transactions.bookTitle">Book holdings</Trans>
              </CardTitle>
              <CardDescription>
                <Trans id="transactions.bookHint">
                  Enter average cost and quantity for many tickers at once, or
                  import a CSV/TXT. Each row becomes a buy on the opening date.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BookHoldingsPanel
                key={bookEpoch}
                tradedAt={openingDate}
                onTradedAtChange={setOpeningDate}
                saving={book.isPending}
                onSubmit={bookHoldings}
              />
            </CardContent>
          </Card>

          {history}
        </div>
      )}
    </div>
  );
}

type HistoryTableProps = {
  transactions: Transaction[];
  onRemove: (id: string) => void;
  removingId: string | undefined;
};

function HistoryTable({
  transactions,
  onRemove,
  removingId,
}: HistoryTableProps) {
  // Subscribes this table to locale changes; amounts and dates below are
  // rendered with `Intl` using the active locale.
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
            message: `Remove ${ticker} trade from ${date}`,
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
                  onClick={() => onRemove(transaction.id)}
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
