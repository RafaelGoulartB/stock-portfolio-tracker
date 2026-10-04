import { zodResolver } from "@hookform/resolvers/zod";
import { msg, plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  ASSET_CLASSES,
  type BookHoldingRow,
  CURRENCIES,
  createTransactionInput,
  isoDate,
  TRANSACTION_SIDES,
  type Transaction,
} from "@portifolio-tracker/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { AssetClassLabel, SideLabel } from "@/components/asset-labels";
import { BookHoldingsPanel } from "@/components/transactions/book-holdings-panel";
import { BrokerNoteImport } from "@/components/transactions/broker-note-import";
import { BrokerNoteList } from "@/components/transactions/broker-note-list";
import {
  type HistoryFilters,
  TransactionHistory,
} from "@/components/transactions/transaction-history";
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
import { trpc } from "@/lib/api";
import { currencyText } from "@/lib/display-labels";
import { formatQuantity, formatTradeDate } from "@/lib/format";
import { trpcQueryUtils } from "@/lib/route-prefetch";
import { useSettings } from "@/lib/settings";
import {
  bookHoldingsErrorMessage,
  createTradeErrorMessage,
  fillTradeFxErrorMessage,
  removeTradeErrorMessage,
  updateTradeErrorMessage,
} from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

export const Route = createFileRoute("/_app/transactions")({
  // The first, unfiltered page is what the screen opens with.
  loader: ({ preload }) => {
    if (preload) return;
    void trpcQueryUtils.transactions.list
      .prefetch({ page: 0, pageSize: PAGE_SIZE, ticker: undefined })
      .catch(() => undefined);
    void trpcQueryUtils.transactions.tradeFxStatus
      .prefetch()
      .catch(() => undefined);
  },
  component: TransactionsPage,
});

type FormValues = z.input<typeof createTransactionInput>;
type EntryMode = "trade" | "book" | "notes";

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
  usdBrlRate: "",
  notes: "",
});

/** `"10.50000000"` from the API becomes `"10.5"` for editing. */
function editableDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function formFromTransaction(transaction: Transaction): FormValues {
  return {
    ticker: transaction.ticker,
    assetClass: transaction.assetClass,
    currency: transaction.currency,
    side: transaction.side,
    quantity: editableDecimal(transaction.quantity),
    price: editableDecimal(transaction.price),
    value: "",
    fees: editableDecimal(transaction.fees),
    tradedAt: transaction.tradedAt,
    usdBrlRate: transaction.usdBrlRate
      ? editableDecimal(transaction.usdBrlRate)
      : "",
    notes: transaction.notes ?? "",
  };
}

/** Waits for typing to settle before a filter hits the API. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);

    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function TransactionsPage() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const { displayCurrency } = useSettings();
  const [page, setPage] = useState(0);
  const [tickerFilter, setTickerFilter] = useState("");
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({});
  const tickerQuery = useDebounced(tickerFilter.trim(), 250);
  const list = trpc.transactions.list.useQuery(
    {
      page,
      pageSize: PAGE_SIZE,
      ticker: tickerQuery || undefined,
      ...historyFilters,
    },
    { placeholderData: keepPreviousData },
  );
  const fxStatus = trpc.transactions.tradeFxStatus.useQuery();
  const [mode, setMode] = useState<EntryMode>("trade");
  const [openingDate, setOpeningDate] = useState(today);
  const [bookEpoch, setBookEpoch] = useState(0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const formCardRef = useRef<HTMLDivElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(createTransactionInput),
    defaultValues: emptyForm(),
  });
  const isFixedIncome = form.watch("assetClass") === "fixed_income";
  const tradeCurrency = form.watch("currency");
  const tradedAt = form.watch("tradedAt");
  const showTradeFx = !isFixedIncome && tradeCurrency === "USD";
  const tradeFx = trpc.fx.tradeRate.useQuery(
    { tradedAt },
    {
      enabled: showTradeFx && isoDate.safeParse(tradedAt).success,
      retry: false,
      staleTime: 60 * 60 * 1000,
    },
  );
  const missingFx =
    fxStatus.data?.missingByCurrency[
      displayCurrency === "BRL" ? "USD" : "BRL"
    ] ?? 0;

  // A stored rate belongs to the stored date: moving the trade to another
  // day drops it so the API resolves that day's PTAX, unless the user typed
  // a rate themselves.
  useEffect(() => {
    if (
      editing &&
      tradedAt !== editing.tradedAt &&
      !form.getFieldState("usdBrlRate").isDirty
    ) {
      form.setValue("usdBrlRate", "");
    }
  }, [editing, tradedAt, form]);

  async function refresh() {
    await Promise.all([
      utils.transactions.list.invalidate(),
      utils.transactions.tradeFxStatus.invalidate(),
      utils.positions.list.invalidate(),
      utils.positions.daily.invalidate(),
      utils.positions.finder.invalidate(),
      utils.positions.finderWindows.invalidate(),
      utils.allocation.list.invalidate(),
      // Asset detail shows the newest trade; watch-only finder rows and the
      // categories screen both depend on which tickers are held.
      utils.allocation.history.invalidate(),
      utils.allocation.finder.invalidate(),
      utils.categories.list.invalidate(),
      utils.performance.history.invalidate(),
      utils.dividends.history.invalidate(),
      utils.transactions.forTicker.invalidate(),
      utils.brokerNotes.list.invalidate(),
      utils.brokerNotes.get.invalidate(),
      utils.data.summary.invalidate(),
      utils.incomeTax.invalidate(),
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
      setPage(0);
      await refresh();
    },
    onError: (error) => toast.error(createTradeErrorMessage(error)),
  });

  const update = trpc.transactions.update.useMutation({
    onSuccess: async (transaction) => {
      const ticker = transaction.ticker;

      toast.success(
        t({
          id: "transactions.updated",
          message: `${ticker} trade updated`,
        }),
      );
      stopEditing();
      await refresh();
    },
    onError: (error) => toast.error(updateTradeErrorMessage(error)),
  });

  const fillFx = trpc.transactions.fillTradeFx.useMutation({
    onSuccess: async (result) => {
      const updated = result.updated;
      const missing = result.missing;

      if (missing > 0) {
        toast.warning(
          t({
            id: "transactions.fxFilledPartial",
            message: `Filled ${updated} trades. ${missing} still have no published PTAX.`,
          }),
        );
      } else {
        toast.success(
          t({
            id: "transactions.fxFilled",
            message: `Filled the trade-date PTAX of ${updated} trades`,
          }),
        );
      }

      await refresh();
    },
    onError: (error) => toast.error(fillTradeFxErrorMessage(error)),
  });

  function startEditing(transaction: Transaction) {
    setMode("trade");
    setEditing(transaction);
    form.reset(formFromTransaction(transaction));
    formCardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    window.setTimeout(() => form.setFocus("ticker"), 0);
  }

  function stopEditing() {
    setEditing(null);
    form.reset(emptyForm());
  }

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
      setPage(0);
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
      setPage(0);
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
    <div className="min-w-0 space-y-4">
      {missingFx > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-caution/40 bg-caution/10 px-4 py-3 text-sm"
        >
          <TriangleAlert
            className="size-4 shrink-0 text-caution"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1">
            {t({
              id: "transactions.fxMissing",
              message: plural(
                { count: missingFx },
                {
                  one: "# trade has no trade-date USD/BRL yet, so its cost converts at today's rate.",
                  other:
                    "# trades have no trade-date USD/BRL yet, so their cost converts at today's rate.",
                },
              ),
            })}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={fillFx.isPending}
            onClick={() => fillFx.mutate()}
          >
            {fillFx.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            <Trans id="transactions.fxFill">Fill from BCB PTAX</Trans>
          </Button>
        </div>
      ) : null}
      <TransactionHistory
        data={list.data}
        error={list.error}
        isFetching={list.isFetching}
        isPending={list.isPending}
        page={page}
        removing={remove.isPending}
        editingId={editing?.id}
        tickerFilter={tickerFilter}
        onTickerFilterChange={(value) => {
          setTickerFilter(value);
          setPage(0);
        }}
        filters={historyFilters}
        onFiltersChange={(next) => {
          setHistoryFilters(next);
          setPage(0);
        }}
        onPageChange={setPage}
        onEdit={startEditing}
        onRemove={(id) => remove.mutateAsync({ id }).then(() => undefined)}
      />
    </div>
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
            onClick={() => {
              if (editing) stopEditing();
              setMode("book");
            }}
          >
            <Trans id="transactions.modeBook">Book holdings</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            role="tab"
            aria-selected={mode === "notes"}
            variant={mode === "notes" ? "default" : "ghost"}
            className={cn(mode !== "notes" && "text-muted-foreground")}
            onClick={() => {
              if (editing) stopEditing();
              setMode("notes");
            }}
          >
            <Trans id="transactions.modeNotes">Broker notes</Trans>
          </Button>
        </div>
      </header>

      {mode === "trade" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <Card
            ref={formCardRef}
            // Sticky below the app header, so the form stays at hand while
            // the history scrolls.
            className={cn(
              "h-fit scroll-mt-20 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto",
              editing && "border-primary/60",
            )}
          >
            <CardHeader>
              <CardTitle>
                {editing ? (
                  <Trans id="transactions.editTrade">Edit trade</Trans>
                ) : (
                  <Trans id="transactions.newTrade">New trade</Trans>
                )}
              </CardTitle>
              <CardDescription>
                {editing ? (
                  <Trans id="transactions.editingHint">
                    Editing the {editing.ticker} trade from{" "}
                    {formatTradeDate(editing.tradedAt)}. Positions and results
                    are recalculated when you save.
                  </Trans>
                ) : (
                  <Trans id="transactions.feesHint">
                    Fees are added to a buy and subtracted from a sell.
                  </Trans>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  className="space-y-4"
                  onSubmit={form.handleSubmit((values) =>
                    editing
                      ? update.mutate({ id: editing.id, trade: values })
                      : create.mutate(values),
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
                              {ASSET_CLASSES.filter(
                                (assetClass) =>
                                  assetClass !== "cash" &&
                                  // Fixed-income balances live in Allocation.
                                  !(editing && assetClass === "fixed_income"),
                              ).map((assetClass) => (
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
                                  {currencyText(currency, i18n)}
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

                  {showTradeFx ? (
                    <FormField
                      control={form.control}
                      name="usdBrlRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <Trans id="transactions.tradeFx">
                              USD/BRL on the trade date
                            </Trans>
                          </FormLabel>
                          <FormControl>
                            <Input
                              inputMode="decimal"
                              placeholder={tradeFx.data?.rate ?? "5.4321"}
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormDescription>
                            {tradeFx.data ? (
                              <Trans id="transactions.tradeFxPtax">
                                BCB PTAX of {formatTradeDate(tradeFx.data.asOf)}
                                : {formatQuantity(tradeFx.data.rate)}. Leave
                                blank to use it, or type your broker&apos;s
                                rate.
                              </Trans>
                            ) : tradeFx.isFetching ? (
                              <Trans id="transactions.tradeFxLoading">
                                Looking up the BCB PTAX…
                              </Trans>
                            ) : (
                              <Trans id="transactions.tradeFxPending">
                                No PTAX published for this date yet. Leave blank
                                to fill it later, or type a rate.
                              </Trans>
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}

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
                    disabled={create.isPending || update.isPending}
                  >
                    {create.isPending || update.isPending ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    {editing ? (
                      <Trans id="transactions.saveEdit">Save changes</Trans>
                    ) : isFixedIncome ? (
                      <Trans id="transactions.registerFixedIncome">
                        Register fixed income
                      </Trans>
                    ) : (
                      <Trans id="transactions.register">Register trade</Trans>
                    )}
                  </Button>
                  {editing ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={update.isPending}
                      onClick={stopEditing}
                    >
                      <Trans id="transactions.cancelEdit">Cancel editing</Trans>
                    </Button>
                  ) : null}
                </form>
              </Form>
            </CardContent>
          </Card>

          {history}
        </div>
      ) : mode === "notes" ? (
        <div className="space-y-6">
          <BrokerNoteImport
            onImported={async () => {
              setPage(0);
              await refresh();
            }}
          />
          <BrokerNoteList onRemoved={refresh} />
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
