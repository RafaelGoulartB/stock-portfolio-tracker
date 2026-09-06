import { zodResolver } from "@hookform/resolvers/zod";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  ASSET_CLASSES,
  CURRENCIES,
  CURRENCY_LABELS,
  createTransactionInput,
  TRANSACTION_SIDES,
  type Transaction,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import {
  AssetClassLabel,
  CurrencyBadge,
  SideLabel,
} from "@/components/asset-labels";
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
  createTradeErrorMessage,
  queryErrorMessage,
  removeTradeErrorMessage,
} from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/transactions")({
  component: TransactionsPage,
});

type FormValues = z.input<typeof createTransactionInput>;

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
  fees: "0",
  tradedAt: today(),
  notes: "",
});

function TransactionsPage() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const list = trpc.transactions.list.useQuery();

  const form = useForm<FormValues>({
    resolver: zodResolver(createTransactionInput),
    defaultValues: emptyForm(),
  });

  async function refresh() {
    await Promise.all([
      utils.transactions.list.invalidate(),
      utils.positions.list.invalidate(),
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          <Trans id="transactions.title">Transactions</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans id="transactions.subtitle">
            Register every buy and sell. Positions are consolidated from this
            log.
          </Trans>
        </p>
      </header>

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
                onSubmit={form.handleSubmit((values) => create.mutate(values))}
                noValidate
              >
                <FormField
                  control={form.control}
                  name="ticker"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans id="transactions.ticker">Ticker</Trans>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="PETR4"
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
                          <Trans id="transactions.unitPrice">Unit price</Trans>
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
                  <Trans id="transactions.register">Register trade</Trans>
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

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
      </div>
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
          <TableHead className="w-10" />
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
                {transaction.ticker}
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
                {formatQuantity(transaction.quantity)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(transaction.price, transaction.currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatMoney(transaction.fees, transaction.currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(transaction.total, transaction.currency)}
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={removeLabel}
                  disabled={removingId === transaction.id}
                  onClick={() => onRemove(transaction.id)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
