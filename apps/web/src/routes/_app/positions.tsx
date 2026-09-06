import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  type Currency,
  type PortfolioSummary,
  positiveDecimal,
  type ValuedPosition,
} from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  formatMoney,
  formatQuantity,
  formatSignedMoney,
  formatTradeDate,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { formatMonthLabel, lastTwelveMonths } from "@/lib/months";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/positions")({
  component: PositionsPage,
});

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
];

/** Slices below this share skip the outer label; they stay in the tooltip. */
const DONUT_LABEL_THRESHOLD = 0.02;

function PositionsPage() {
  // Subscribes this page to locale changes; amounts and dates below are
  // rendered with `Intl` using the active locale.
  const { i18n } = useLingui();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const months = useMemo(() => lastTwelveMonths(), []);
  const [monthKey, setMonthKey] = useState(months[0]?.key ?? "");
  const selected = months.find((month) => month.key === monthKey) ?? months[0];

  const fx = useFxQuote(selected?.asOf);

  // Manual prices are raw user input; only valid decimals travel to the API.
  const sanitizedManualPrices = useMemo(() => {
    const entries = Object.entries(manualPrices).filter(
      ([, price]) => positiveDecimal.safeParse(price).success,
    );

    return Object.fromEntries(entries);
  }, [manualPrices]);

  const positions = trpc.positions.list.useQuery({
    displayCurrency,
    usdBrlRate: fx.effectiveRate,
    asOf: selected?.asOf ?? undefined,
    quoteSource,
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  });

  // The portfolio cannot consolidate mixed currencies until the quote
  // arrives; keep the skeleton instead of flashing a rate error.
  const waitingForRate =
    !!positions.error && isFxRateRequired(positions.error) && fx.isPending;
  const fxFailed =
    !!positions.error &&
    isFxRateRequired(positions.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="positions.title">Positions</Trans>
          </h1>
          <p className="text-sm text-muted-foreground">
            <Trans id="positions.subtitle">
              Month snapshots valued at each period close using the moving
              average cost of every trade you registered.
            </Trans>
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/transactions">
            <Trans id="positions.registerTrade">Register a trade</Trans>
          </Link>
        </Button>
      </header>

      <MonthSelector
        months={months}
        selectedKey={selected?.key ?? ""}
        onSelect={setMonthKey}
        locale={i18n.locale}
      />

      {positions.isPending || waitingForRate ? <PositionsSkeleton /> : null}

      {fxFailed ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            <Trans id="positions.fxFailed">
              Could not fetch the exchange rate. Try another source or enter it
              manually.
            </Trans>
          </CardContent>
        </Card>
      ) : null}

      {positions.error && !waitingForRate && !fxFailed ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {queryErrorMessage(positions.error)}
          </CardContent>
        </Card>
      ) : null}

      {positions.data ? (
        <>
          <SummaryCards summary={positions.data.summary} />

          <AllocationCard
            positions={positions.data.positions}
            summary={positions.data.summary}
            missing={positions.data.quotes.missing}
            snapshotLabel={
              selected?.asOf
                ? formatTradeDate(selected.asOf)
                : i18n._(t({ id: "positions.live", message: "Live" }))
            }
          />

          {quoteSource === "manual" ? (
            <ManualPricesCard
              key={positions.data.positions.map((p) => p.ticker).join(",")}
              positions={positions.data.positions}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MonthSelector({
  months,
  selectedKey,
  onSelect,
  locale,
}: {
  months: ReturnType<typeof lastTwelveMonths>;
  selectedKey: string;
  onSelect: (key: string) => void;
  locale: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="positions-month" className="sr-only">
        <Trans id="positions.month">Snapshot month</Trans>
      </Label>
      <Select value={selectedKey} onValueChange={onSelect}>
        <SelectTrigger id="positions-month" className="w-full max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((month) => (
            <SelectItem key={month.key} value={month.key}>
              {month.current ? (
                <Trans id="positions.currentMonth">
                  {formatMonthLabel(month, locale)} · Live
                </Trans>
              ) : (
                formatMonthLabel(month, locale)
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type SliceDatum = {
  ticker: string;
  value: number;
  share: string | null;
  display: string;
};

type SortKey = "ticker" | "value" | "share";
type SortDirection = "asc" | "desc";

/** Outer slice label with a leader line, like a fund factsheet. */
function DonutSliceLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number | string;
  name?: unknown;
  percent?: number;
}) {
  const { cx = 0, cy = 0, midAngle = 0, percent = 0 } = props;
  const outer = typeof props.outerRadius === "number" ? props.outerRadius : 0;
  const name = typeof props.name === "string" ? props.name : "";

  if (percent < DONUT_LABEL_THRESHOLD || !name) {
    return null;
  }

  const RADIAN = Math.PI / 180;
  const cos = Math.cos(-midAngle * RADIAN);
  const sin = Math.sin(-midAngle * RADIAN);
  const lineStart = outer + 4;
  const lineEnd = outer + 14;

  return (
    <g>
      <line
        x1={cx + lineStart * cos}
        y1={cy + lineStart * sin}
        x2={cx + lineEnd * cos}
        y2={cy + lineEnd * sin}
        stroke="var(--border)"
        strokeWidth={1}
      />
      <text
        x={cx + (lineEnd + 6) * cos}
        y={cy + (lineEnd + 6) * sin}
        textAnchor={cos >= 0 ? "start" : "end"}
        dominantBaseline="central"
        fontSize={12}
        className="fill-muted-foreground"
      >
        {name}
      </text>
    </g>
  );
}

/** Hovered slice grows so the active asset pops out of the ring. */
function DonutActiveShape(props: {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
}) {
  return (
    <Sector
      cx={props.cx ?? 0}
      cy={props.cy ?? 0}
      innerRadius={props.innerRadius ?? 0}
      outerRadius={(props.outerRadius ?? 0) + 8}
      startAngle={props.startAngle ?? 0}
      endAngle={props.endAngle ?? 0}
      cornerRadius={4}
      fill={props.fill}
    />
  );
}

function AllocationTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: SliceDatum }[];
}) {
  const datum = active ? payload?.[0]?.payload : undefined;

  if (!datum) {
    return null;
  }

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{datum.ticker}</p>
      <p className="tabular-nums">{datum.display}</p>
      {datum.share != null ? (
        <p className="text-muted-foreground tabular-nums">
          {formatWeight(datum.share)}
        </p>
      ) : null}
    </div>
  );
}

function SortHeaderButton({
  label,
  align = "left",
  active,
  direction,
  onToggle,
}: {
  label: ReactNode;
  align?: "left" | "right";
  active: boolean;
  direction: SortDirection;
  onToggle: () => void;
}) {
  const Icon =
    active === false ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex cursor-pointer items-center gap-1 hover:text-foreground ${
        align === "right" ? "flex-row-reverse" : ""
      }`}
    >
      {label}
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}

function AllocationCard({
  positions,
  summary,
  missing,
  snapshotLabel,
}: {
  positions: ValuedPosition[];
  summary: PortfolioSummary;
  missing: string[];
  snapshotLabel: string;
}) {
  const { i18n } = useLingui();
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const open = useMemo(
    () => positions.filter((position) => Number(position.quantity) > 0),
    [positions],
  );

  const rows = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;

    return [...open].sort((a, b) => {
      if (sortKey === "ticker") {
        return direction * a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      const left =
        sortKey === "value" ? a.convertedMarketValue : (a.weight ?? null);
      const right =
        sortKey === "value" ? b.convertedMarketValue : (b.weight ?? null);

      // Assets without a quote always sink to the bottom.
      if (left == null && right == null) {
        return a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      if (left == null) {
        return 1;
      }

      if (right == null) {
        return -1;
      }

      if (left === right) {
        return a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      return direction * (Number(left) - Number(right));
    });
  }, [open, sortKey, sortDir, i18n.locale]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "ticker" ? "asc" : "desc");
    }
  }

  const slices: SliceDatum[] = useMemo(
    () =>
      open
        .filter((position) => position.convertedMarketValue != null)
        .sort(
          (a, b) =>
            Number(b.convertedMarketValue ?? 0) -
            Number(a.convertedMarketValue ?? 0),
        )
        .map((position) => ({
          ticker: position.ticker,
          value: Number(position.convertedMarketValue ?? 0),
          share: position.weight,
          display: formatMoney(
            position.convertedMarketValue ?? "0.00",
            summary.displayCurrency,
          ),
        })),
    [open, summary.displayCurrency],
  );

  const activeSlice = activeIndex != null ? slices[activeIndex] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.allocation">Allocation</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.allocationHint">
            Market value at {snapshotLabel} and share of quoted equity.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {open.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            <Trans id="positions.empty">
              No positions yet. Register your first trade to see it here.
            </Trans>
          </p>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <div>
              {slices.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  <Trans id="positions.noQuotes">
                    No market quotes for this snapshot yet.
                  </Trans>
                </p>
              ) : (
                <div className="relative">
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart
                        margin={{ top: 16, right: 56, bottom: 16, left: 56 }}
                      >
                        <Pie
                          data={slices}
                          dataKey="value"
                          nameKey="ticker"
                          innerRadius="55%"
                          outerRadius="70%"
                          paddingAngle={2}
                          stroke="var(--card)"
                          strokeWidth={2}
                          label={<DonutSliceLabel />}
                          labelLine={false}
                          activeShape={<DonutActiveShape />}
                          onMouseEnter={(_, index) => setActiveIndex(index)}
                          onMouseLeave={() => setActiveIndex(undefined)}
                        >
                          {slices.map((slice, index) => (
                            <Cell
                              key={slice.ticker}
                              fill={PIE_COLORS[index % PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<AllocationTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <p className="max-w-36 truncate text-sm font-medium">
                      {activeSlice?.ticker ?? (
                        <Trans id="positions.total">Total</Trans>
                      )}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {activeSlice
                        ? activeSlice.display
                        : formatMoney(
                            summary.totalMarketValue,
                            summary.displayCurrency,
                          )}
                    </p>
                    {activeSlice?.share != null ? (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatWeight(activeSlice.share)}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    aria-sort={
                      sortKey === "ticker"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <SortHeaderButton
                      label={<Trans id="positions.colTicker">Ticker</Trans>}
                      active={sortKey === "ticker"}
                      direction={sortDir}
                      onToggle={() => toggleSort("ticker")}
                    />
                  </TableHead>
                  <TableHead
                    className="text-right"
                    aria-sort={
                      sortKey === "value"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <SortHeaderButton
                      label={
                        <Trans id="positions.colMarketValue">
                          Market value
                        </Trans>
                      }
                      align="right"
                      active={sortKey === "value"}
                      direction={sortDir}
                      onToggle={() => toggleSort("value")}
                    />
                  </TableHead>
                  <TableHead
                    className="text-right"
                    aria-sort={
                      sortKey === "share"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <SortHeaderButton
                      label={<Trans id="positions.colShare">Share</Trans>}
                      align="right"
                      active={sortKey === "share"}
                      direction={sortDir}
                      onToggle={() => toggleSort("share")}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((position) => (
                  <TableRow key={`${position.ticker}|${position.currency}`}>
                    <TableCell className="font-medium">
                      {position.ticker}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {position.convertedMarketValue == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ConvertedMoney
                          native={position.marketValue ?? "0.00"}
                          nativeCurrency={position.currency}
                          converted={position.convertedMarketValue}
                          displayCurrency={position.displayCurrency}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {position.weight == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatWeight(position.weight)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {missing.length > 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            <Trans id="positions.missingQuotes">
              No quote for {missing.join(", ")}. Values and shares cover quoted
              assets only.
            </Trans>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Per-ticker price editor backing the manual quote source. */
function ManualPricesCard({ positions }: { positions: ValuedPosition[] }) {
  const { manualPrices, setManualPrice } = useSettings();
  const open = positions.filter((position) => Number(position.quantity) > 0);

  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      open.map((position) => [
        position.ticker,
        manualPrices[position.ticker] ?? "",
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  if (open.length === 0) {
    return null;
  }

  function save() {
    const nextErrors: Record<string, boolean> = {};
    let valid = true;

    for (const position of open) {
      const raw = (drafts[position.ticker] ?? "").trim();

      if (raw.length === 0) {
        continue;
      }

      if (!positiveDecimal.safeParse(raw).success) {
        nextErrors[position.ticker] = true;
        valid = false;
      }
    }

    setErrors(nextErrors);

    if (!valid) {
      return;
    }

    for (const position of open) {
      setManualPrice(position.ticker, (drafts[position.ticker] ?? "").trim());
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.manualPrices">Manual prices</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.manualPricesHint">
            Native-currency price per unit. Manual prices apply to every month.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {open.map((position) => (
          <div
            key={position.ticker}
            className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <div className="grid gap-2">
              <Label htmlFor={`manual-price-${position.ticker}`}>
                {position.ticker} ({position.currency})
              </Label>
              <Input
                id={`manual-price-${position.ticker}`}
                inputMode="decimal"
                placeholder="0.00"
                value={drafts[position.ticker] ?? ""}
                aria-invalid={!!errors[position.ticker]}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [position.ticker]: event.target.value,
                  }))
                }
              />
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">
              {position.marketPrice
                ? formatMoney(position.marketPrice, position.currency)
                : "—"}
            </p>
          </div>
        ))}
        <Button type="button" size="sm" onClick={save}>
          <Trans id="positions.savePrices">Save prices</Trans>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Display-currency amount with the native amount underneath when converted. */
function ConvertedMoney({
  native,
  nativeCurrency,
  converted,
  displayCurrency,
  signed = false,
}: {
  native: string;
  nativeCurrency: Currency;
  converted: string;
  displayCurrency: Currency;
  signed?: boolean;
}) {
  const primary = signed
    ? formatSignedMoney(converted, displayCurrency)
    : formatMoney(converted, displayCurrency);

  if (nativeCurrency === displayCurrency) {
    return primary;
  }

  return (
    <span>
      {primary}
      <span className="block text-xs font-normal text-muted-foreground">
        {formatMoney(native, nativeCurrency)}
      </span>
    </span>
  );
}

function SummaryCards({ summary }: { summary: PortfolioSummary }) {
  useLingui();
  const breakdown = summary.totalsByCurrency
    .map(
      (total) =>
        `${formatMoney(total.investedCost, total.currency)} ${total.currency}`,
    )
    .join(" + ");

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>
              <Trans id="positions.investedCost">Invested cost</Trans>
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMoney(summary.totalInvested, summary.displayCurrency)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Trans id="positions.investedCostHint">
              Cost basis of everything you still hold.
            </Trans>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>
              <Trans id="positions.realizedPnl">Realized P&L</Trans>
            </CardDescription>
            <CardTitle
              className={`text-2xl tabular-nums ${pnlClassName(summary.totalRealizedPnl)}`}
            >
              {Number(summary.totalRealizedPnl) === 0
                ? formatMoney(summary.totalRealizedPnl, summary.displayCurrency)
                : formatSignedMoney(
                    summary.totalRealizedPnl,
                    summary.displayCurrency,
                  )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Trans id="positions.realizedPnlHint">
              Result already locked in by your sells.
            </Trans>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>
              <Trans id="positions.assets">Assets</Trans>
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {summary.openPositions}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t({
              id: "positions.closedCount",
              message: plural(
                { count: summary.closedPositions },
                {
                  one: "# closed position",
                  other: "# closed positions",
                },
              ),
            })}
            .
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        {summary.usdBrlRate ? (
          <>
            <Trans id="positions.consolidationRate">
              Consolidated at 1 USD = {formatQuantity(summary.usdBrlRate)} BRL.
            </Trans>{" "}
          </>
        ) : null}
        {breakdown ? (
          <Trans id="positions.nativeBreakdown">
            Native totals: {breakdown}.
          </Trans>
        ) : null}
      </p>
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
