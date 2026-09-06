import { zodResolver } from "@hookform/resolvers/zod";
import {
  ASSET_CLASS_LABELS,
  ASSET_CLASSES,
  createTransactionInput,
  TRANSACTION_SIDE_LABELS,
  TRANSACTION_SIDES,
  type Transaction,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
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
  assetClass: "stock",
  side: "buy",
  quantity: "",
  price: "",
  fees: "0",
  tradedAt: today(),
  notes: "",
});

function TransactionsPage() {
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
      toast.success(
        `${TRANSACTION_SIDE_LABELS[transaction.side]} of ${formatQuantity(transaction.quantity)} ${transaction.ticker} registered`,
      );
      form.reset({ ...emptyForm(), tradedAt: transaction.tradedAt });
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = trpc.transactions.remove.useMutation({
    onSuccess: async () => {
      toast.success("Transaction removed");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          Register every buy and sell. Positions are consolidated from this log.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New trade</CardTitle>
            <CardDescription>
              Fees are added to a buy and subtracted from a sell.
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
                      <FormLabel>Ticker</FormLabel>
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
                        <FormLabel>Side</FormLabel>
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
                                {TRANSACTION_SIDE_LABELS[side]}
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
                        <FormLabel>Class</FormLabel>
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
                            {ASSET_CLASSES.map((assetClass) => (
                              <SelectItem key={assetClass} value={assetClass}>
                                {ASSET_CLASS_LABELS[assetClass]}
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
                        <FormLabel>Quantity</FormLabel>
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
                        <FormLabel>Unit price</FormLabel>
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
                    name="fees"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fees</FormLabel>
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

                  <FormField
                    control={form.control}
                    name="tradedAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trade date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Optional"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormDescription>
                        Broker, strategy or anything worth remembering.
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
                  Register trade
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Most recent trades first.</CardDescription>
          </CardHeader>
          <CardContent>
            {list.isPending ? <Skeleton className="h-64" /> : null}

            {list.error ? (
              <p className="py-6 text-sm text-destructive">
                {list.error.message}
              </p>
            ) : null}

            {list.data?.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing registered yet.
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
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Ticker</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Fees</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((transaction) => (
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
                {TRANSACTION_SIDE_LABELS[transaction.side]}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatQuantity(transaction.quantity)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMoney(transaction.price)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatMoney(transaction.fees)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMoney(transaction.total)}
            </TableCell>
            <TableCell>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${transaction.ticker} trade from ${transaction.tradedAt}`}
                disabled={removingId === transaction.id}
                onClick={() => onRemove(transaction.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
