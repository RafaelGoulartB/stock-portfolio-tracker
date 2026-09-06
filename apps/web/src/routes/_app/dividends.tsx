import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  DIVIDEND_SOURCE_LABELS,
  DIVIDEND_WINDOWS,
  type DividendSource,
  type DividendWindow,
} from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Plus,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { i18n } from "@/i18n";
import { type RouterOutputs, trpc } from "@/lib/api";
import {
  formatCompactMoney,
  formatMoney,
  formatQuantity,
  formatTradeDate,
} from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { useSettings } from "@/lib/settings";
import { queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/dividends")({
  component: DividendsPage,
});

type DividendData = RouterOutputs["dividends"]["history"];
type DividendEvent = DividendData["events"][number];

const chartConfig = {
  amount: { label: "Income", color: "var(--chart-2)" },
} satisfies ChartConfig;

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function DividendsPage() {
  const { displayCurrency } = useSettings();
  const fx = useFxQuote();
  const [source, setSource] = useState<DividendSource>("auto");
  const [years, setYears] = useState<DividendWindow>(3);
  const dividends = trpc.dividends.history.useQuery(
    {
      source,
      years,
      displayCurrency,
      usdBrlRate: fx.effectiveRate,
    },
    { staleTime: 6 * 60 * 60 * 1_000 },
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="dividends.title">Income</Trans>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            <Trans id="dividends.subtitle">
              Estimated dividends based on the shares held before each ex-date.
              Payment dates appear when the provider publishes them.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={String(years)}
            onValueChange={(value) => setYears(Number(value) as DividendWindow)}
          >
            <SelectTrigger size="sm" className="w-[116px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIVIDEND_WINDOWS.map((window) => (
                <SelectItem key={window} value={String(window)}>
                  {window}{" "}
                  {window === 1 ? (
                    <Trans id="dividends.year">year</Trans>
                  ) : (
                    <Trans id="dividends.years">years</Trans>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={source}
            onValueChange={(value) => setSource(value as DividendSource)}
          >
            <SelectTrigger size="sm" className="w-[245px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DIVIDEND_SOURCE_LABELS) as DividendSource[]).map(
                (provider) => (
                  <SelectItem key={provider} value={provider}>
                    <DividendSourceLabel source={provider} />
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => dividends.refetch()}
            disabled={dividends.isFetching}
          >
            <RefreshCw
              className={`size-4 ${dividends.isFetching ? "animate-spin" : ""}`}
            />
            <Trans id="dividends.refresh">Refresh</Trans>
          </Button>
        </div>
      </header>

      {dividends.isPending ? <DividendsSkeleton /> : null}
      {dividends.error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {queryErrorMessage(dividends.error)}
          </CardContent>
        </Card>
      ) : null}
      {dividends.data ? <DividendsContent data={dividends.data} /> : null}
    </div>
  );
}

function DividendSourceLabel({ source }: { source: DividendSource }) {
  if (source === "auto") {
    return (
      <Trans id="dividends.sourceAuto">
        Automatic (Alpha Vantage + Yahoo fallback)
      </Trans>
    );
  }
  if (source === "alpha_vantage") {
    return (
      <Trans id="dividends.sourceAlpha">Alpha Vantage (free API key)</Trans>
    );
  }
  return <Trans id="dividends.sourceYahoo">Yahoo Finance (free)</Trans>;
}

function DividendsContent({ data }: { data: DividendData }) {
  if (data.events.length === 0) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <CircleDollarSign className="size-9 text-muted-foreground" />
            <div>
              <p className="font-medium">
                <Trans id="dividends.emptyTitle">No income events found</Trans>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <Trans id="dividends.emptyDescription">
                  Register stock or ETF trades, or try a longer history window.
                </Trans>
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/transactions">
                <Plus className="size-4" />
                <Trans id="dividends.addTrade">Register a trade</Trans>
              </Link>
            </Button>
          </CardContent>
        </Card>
        <ProviderNotice data={data} />
      </>
    );
  }

  return (
    <>
      <Summary data={data} />
      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <IncomeChart data={data} />
        <UpcomingCard data={data} />
      </div>
      <IncomeCalendar events={data.events} />
      <HistoryTable
        key={`${data.provider.requested}|${data.range.start}|${data.range.end}`}
        data={data}
      />
      <ProviderNotice data={data} />
    </>
  );
}

function Summary({ data }: { data: DividendData }) {
  const { summary } = data;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <Metric
          icon={WalletCards}
          label={<Trans id="dividends.total">Estimated income</Trans>}
          value={formatMoney(summary.convertedTotal, summary.displayCurrency)}
          hint={<Trans id="dividends.selectedPeriod">Selected period</Trans>}
        />
        <Metric
          icon={Clock3}
          label={<Trans id="dividends.upcoming">Upcoming</Trans>}
          value={formatMoney(
            summary.convertedUpcoming,
            summary.displayCurrency,
          )}
          hint={
            <Trans id="dividends.eventCount">
              {summary.upcomingCount} events
            </Trans>
          }
        />
        <Metric
          icon={CalendarDays}
          label={<Trans id="dividends.nextDate">Next relevant date</Trans>}
          value={
            summary.nextPaymentDate
              ? formatTradeDate(summary.nextPaymentDate)
              : "—"
          }
          hint={
            <Trans id="dividends.paymentOrExDate">Payment or ex-date</Trans>
          }
        />
        <Metric
          icon={CircleDollarSign}
          label={<Trans id="dividends.events">Income events</Trans>}
          value={String(summary.eventCount)}
          hint={summary.nativeTotals
            .map((item) => formatMoney(item.amount, item.currency))
            .join(" · ")}
        />
      </div>
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof CalendarDays;
  label: ReactNode;
  value: string;
  hint: ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function IncomeChart({ data }: { data: DividendData }) {
  const rows = data.monthly.map((item) => ({
    ...item,
    amount: Number(item.amount),
    label: monthLabel(item.month),
  }));

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <Trans id="dividends.chartTitle">Income by month</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="dividends.chartDescription">
            Estimated gross income in the portfolio display currency.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[250px] w-full">
          <BarChart data={rows} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={(value) =>
                formatCompactMoney(value, data.summary.displayCurrency)
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) =>
                    formatMoney(String(value), data.summary.displayCurrency)
                  }
                />
              }
            />
            <Bar
              dataKey="amount"
              fill="var(--color-amount)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function UpcomingCard({ data }: { data: DividendData }) {
  const upcoming = data.events
    .filter((event) => event.status !== "estimated_paid")
    .sort((a, b) => eventDay(a).localeCompare(eventDay(b)))
    .slice(0, 5);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <Trans id="dividends.upcomingTitle">Upcoming events</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="dividends.upcomingDescription">
            Announced events for positions that appear eligible.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            <Trans id="dividends.noUpcoming">
              No upcoming events were published by the selected source.
            </Trans>
          </p>
        ) : (
          <div className="divide-y">
            {upcoming.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md bg-muted text-xs">
                  <span className="font-semibold">
                    {eventDay(event).slice(8, 10)}
                  </span>
                  <span className="uppercase text-muted-foreground">
                    {monthLabel(eventDay(event).slice(0, 7), "short")}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{event.ticker}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.paymentDate ? (
                      <Trans id="dividends.paymentDate">Payment date</Trans>
                    ) : (
                      <Trans id="dividends.exDate">Ex-date</Trans>
                    )}
                  </p>
                </div>
                <p className="font-medium tabular-nums">
                  {formatMoney(event.grossAmount, event.currency)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IncomeCalendar({ events }: { events: DividendEvent[] }) {
  const [month, setMonth] = useState(currentMonth);
  const [selectedEvent, setSelectedEvent] = useState<DividendEvent | null>(
    null,
  );
  const byDay = useMemo(() => {
    const result = new Map<string, DividendEvent[]>();
    for (const event of events) {
      const day = eventDay(event);
      result.set(day, [...(result.get(day) ?? []), event]);
    }
    return result;
  }, [events]);
  const cells = calendarCells(month);
  const monthEvents = events
    .filter((event) => eventDay(event).startsWith(month))
    .sort((a, b) => eventDay(a).localeCompare(eventDay(b)));

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>
            <Trans id="dividends.calendarTitle">Income calendar</Trans>
          </CardTitle>
          <CardDescription>
            <Trans id="dividends.calendarDescription">
              Payment dates when known; otherwise, the ex-date.
            </Trans>
          </CardDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setMonth(moveMonth(month, -1))}
            aria-label={i18n._(
              msg({
                id: "dividends.previousMonth",
                message: "Previous month",
              }),
            )}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="w-32 text-center text-sm font-medium">
            {monthLabel(month, "long")}
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setMonth(moveMonth(month, 1))}
            aria-label={i18n._(
              msg({ id: "dividends.nextMonth", message: "Next month" }),
            )}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="grid grid-cols-7 border-b text-center text-xs text-muted-foreground">
            {weekdays().map((day) => (
              <div key={day} className="py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell) => {
              const dayEvents = byDay.get(cell.day) ?? [];
              return (
                <div
                  key={cell.day}
                  className={`min-h-20 border-b border-r p-2 text-sm first:border-l ${cell.inMonth ? "" : "bg-muted/25 text-muted-foreground"}`}
                >
                  <span
                    className={
                      cell.day === new Date().toISOString().slice(0, 10)
                        ? "flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
                        : ""
                    }
                  >
                    {Number(cell.day.slice(8, 10))}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        title={`${event.ticker} · ${formatMoney(event.grossAmount, event.currency)}`}
                        aria-label={`${event.ticker} · ${formatMoney(event.grossAmount, event.currency)}`}
                        className="flex size-6 items-center justify-center rounded-full outline-none hover:bg-gain/15 focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setSelectedEvent(event)}
                      >
                        <span className="size-2.5 rounded-full bg-gain" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="font-medium">{monthLabel(month, "long")}</p>
          {monthEvents.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              <Trans id="dividends.calendarEmpty">No events this month.</Trans>
            </p>
          ) : (
            <div className="mt-2 divide-y">
              {monthEvents.map((event) => (
                <div key={event.id} className="flex items-center gap-3 py-3">
                  <span className="w-7 text-sm font-semibold tabular-nums">
                    {eventDay(event).slice(8, 10)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{event.ticker}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.paymentDate ? (
                        <Trans id="dividends.payment">Payment</Trans>
                      ) : (
                        <Trans id="dividends.exDate">Ex-date</Trans>
                      )}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums">
                    {formatMoney(event.grossAmount, event.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
      <DividendDetailsDialog
        event={selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
      />
    </Card>
  );
}

function DividendDetailsDialog({
  event,
  onOpenChange,
}: {
  event: DividendEvent | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={event !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {event ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <DialogTitleIcon>
                  <CircleDollarSign aria-hidden="true" />
                </DialogTitleIcon>
                <span>
                  {event.ticker} ·{" "}
                  <Trans id="dividends.details">Income details</Trans>
                </span>
              </DialogTitle>
              <DialogDescription>
                <Trans id="dividends.detailsDescription">
                  Estimated gross income based on the position held before the
                  ex-date.
                </Trans>
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-lg border bg-muted/30 px-4 py-4 text-sm">
              <DividendDetail
                label={<Trans id="dividends.estimated">Estimated</Trans>}
                value={formatMoney(event.grossAmount, event.currency)}
                prominent
              />
              <DividendDetail
                label={<Trans id="dividends.status">Status</Trans>}
                value={<StatusBadge status={event.status} />}
              />
              <DividendDetail
                label={<Trans id="dividends.shares">Shares</Trans>}
                value={formatQuantity(event.eligibleQuantity)}
              />
              <DividendDetail
                label={<Trans id="dividends.perShare">Per share</Trans>}
                value={formatMoney(event.amountPerShare, event.currency)}
              />
              <DividendDetail
                label={
                  <Trans id="dividends.declarationDate">Declaration</Trans>
                }
                value={formatOptionalDate(event.declarationDate)}
              />
              <DividendDetail
                label={<Trans id="dividends.exDate">Ex-date</Trans>}
                value={formatTradeDate(event.exDate)}
              />
              <DividendDetail
                label={<Trans id="dividends.recordDate">Record date</Trans>}
                value={formatOptionalDate(event.recordDate)}
              />
              <DividendDetail
                label={<Trans id="dividends.paymentDate">Payment date</Trans>}
                value={formatOptionalDate(event.paymentDate)}
              />
              <DividendDetail
                label={<Trans id="dividends.source">Source</Trans>}
                value={<DividendSourceLabel source={event.source} />}
              />
            </dl>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DividendDetail({
  label,
  value,
  prominent = false,
}: {
  label: ReactNode;
  value: ReactNode;
  prominent?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          prominent ? "text-lg font-semibold tabular-nums" : "font-medium"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function HistoryTable({ data }: { data: DividendData }) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(data.events.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const firstRow = safePage * pageSize;
  const visibleEvents = data.events.slice(firstRow, firstRow + pageSize);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="dividends.historyTitle">Income history</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="dividends.historyDescription">
            Gross estimates. Confirm net credits against your broker statement.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead>
                <Trans id="dividends.exDate">Ex-date</Trans>
              </TableHead>
              <TableHead>
                <Trans id="dividends.payment">Payment</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="dividends.shares">Shares</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="dividends.perShare">Per share</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="dividends.estimated">Estimated</Trans>
              </TableHead>
              <TableHead>
                <Trans id="dividends.status">Status</Trans>
              </TableHead>
              <TableHead>
                <Trans id="dividends.source">Source</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleEvents.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-medium">{event.ticker}</TableCell>
                <TableCell>{formatTradeDate(event.exDate)}</TableCell>
                <TableCell>
                  {event.paymentDate ? formatTradeDate(event.paymentDate) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(event.eligibleQuantity)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(event.amountPerShare, event.currency)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(event.grossAmount, event.currency)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={event.status} />
                </TableCell>
                <TableCell className="capitalize text-muted-foreground">
                  {event.source.replace("_", " ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
          <p className="text-muted-foreground">
            <Trans id="dividends.rowsShown">
              Showing {firstRow + 1}–
              {Math.min(firstRow + pageSize, data.events.length)} of{" "}
              {data.events.length}
            </Trans>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              <Trans id="dividends.rowsPerPage">Rows per page</Trans>
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPage(0);
              }}
            >
              <SelectTrigger size="sm" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="min-w-24 text-center tabular-nums">
              <Trans id="dividends.pageCount">
                Page {safePage + 1} of {pageCount}
              </Trans>
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={safePage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              aria-label={i18n._(
                msg({ id: "dividends.previousPage", message: "Previous page" }),
              )}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={safePage >= pageCount - 1}
              onClick={() =>
                setPage((current) => Math.min(pageCount - 1, current + 1))
              }
              aria-label={i18n._(
                msg({ id: "dividends.nextPage", message: "Next page" }),
              )}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: DividendEvent["status"] }) {
  if (status === "announced")
    return (
      <Badge variant="outline">
        <Trans id="dividends.announced">Announced</Trans>
      </Badge>
    );
  if (status === "scheduled")
    return (
      <Badge variant="secondary">
        <Trans id="dividends.scheduled">Scheduled</Trans>
      </Badge>
    );
  return (
    <Badge variant="outline">
      <Trans id="dividends.estimatedPaid">Estimated paid</Trans>
    </Badge>
  );
}

function ProviderNotice({ data }: { data: DividendData }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        <Trans id="dividends.disclaimer">
          Provider events do not confirm a broker credit. Amounts exclude taxes
          and broker adjustments.
        </Trans>
      </p>
      {data.provider.requested === "auto" &&
      !data.provider.alphaVantageConfigured ? (
        <p>
          <Trans id="dividends.alphaHint">
            Automatic mode is currently using Yahoo only. Set
            ALPHA_VANTAGE_API_KEY on the API to enrich US events with payment
            dates and future declarations.
          </Trans>
        </p>
      ) : null}
      {data.provider.requested === "alpha_vantage" &&
      !data.provider.alphaVantageConfigured ? (
        <p>
          <Trans id="dividends.alphaNotConfigured">
            Alpha Vantage is not configured. Set ALPHA_VANTAGE_API_KEY on the
            API or select Automatic to use the Yahoo fallback.
          </Trans>
        </p>
      ) : null}
      {data.provider.missing.length > 0 ? (
        <p>
          <Trans id="dividends.unavailable">
            Unavailable tickers: {data.provider.missing.join(", ")}.
          </Trans>
        </p>
      ) : null}
      {data.summary.unconvertedEvents > 0 ? (
        <p>
          <Trans id="dividends.unconverted">
            {data.summary.unconvertedEvents} events could not be converted.
          </Trans>
        </p>
      ) : null}
    </div>
  );
}

function DividendsSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function eventDay(event: DividendEvent): string {
  return event.paymentDate ?? event.exDate;
}

function formatOptionalDate(day: string | null): string {
  return day ? formatTradeDate(day) : "—";
}

function monthLabel(month: string, width: "short" | "long" = "short"): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(i18n.locale, {
    month: width,
    year: width === "long" ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function weekdays(): string[] {
  const formatter = new Intl.DateTimeFormat(i18n.locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const sunday = new Date(Date.UTC(2024, 0, 7));

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(sunday);
    day.setUTCDate(sunday.getUTCDate() + index);
    return formatter.format(day);
  });
}

function moveMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function calendarCells(
  month: string,
): Array<{ day: string; inMonth: boolean }> {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      day: date.toISOString().slice(0, 10),
      inMonth: date.getUTCMonth() === monthNumber - 1,
    };
  });
}
