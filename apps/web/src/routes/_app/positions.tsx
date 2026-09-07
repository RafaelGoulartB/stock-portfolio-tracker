import type { I18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  type AssetClass,
  type Category,
  type Currency,
  type PortfolioSummary,
  positiveDecimal,
  type ValuedPosition,
} from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Plus,
  ScanSearch,
  Wallet,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { AssetClassLabel, assetClassText } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/api";
import {
  formatCompactMoney,
  formatMoney,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
  formatTradeDate,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { formatMonthLabel, lastTwelveMonths } from "@/lib/months";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/positions")({
  component: PositionsPage,
});

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

  const data = positions.data;

  const open = useMemo(
    () =>
      data?.positions.filter((position) => Number(position.quantity) > 0) ?? [],
    [data],
  );

  const snapshotLabel = selected?.asOf
    ? formatTradeDate(selected.asOf)
    : i18n._(t({ id: "positions.live", message: "Live" }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="positions.title">Positions</Trans>
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            <Trans id="positions.subtitle">
              Month snapshots valued at each period close using the moving
              average cost of every trade you registered.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthSelector
            months={months}
            selectedKey={selected?.key ?? ""}
            onSelect={setMonthKey}
            locale={i18n.locale}
          />
          <Button asChild size="sm">
            <Link to="/transactions">
              <Plus className="size-4" aria-hidden="true" />
              <Trans id="positions.registerTrade">Register a trade</Trans>
            </Link>
          </Button>
        </div>
      </header>

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

      {data ? (
        <>
          <SummaryStrip summary={data.summary} snapshotLabel={snapshotLabel} />

          {open.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <AllocationCard
                positions={open}
                summary={data.summary}
                snapshotLabel={snapshotLabel}
              />

              <DeepFinderTeaser positions={open} summary={data.summary} />

              <HoldingsCard
                positions={open}
                summary={data.summary}
                missing={data.quotes.missing}
              />
            </>
          )}

          {quoteSource === "manual" ? (
            <ManualPricesCard
              key={data.positions.map((position) => position.ticker).join(",")}
              positions={data.positions}
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
    <>
      <Label htmlFor="positions-month" className="sr-only">
        <Trans id="positions.month">Snapshot month</Trans>
      </Label>
      <Select value={selectedKey} onValueChange={onSelect}>
        <SelectTrigger
          id="positions-month"
          size="sm"
          className="w-full max-w-[168px] sm:w-[168px]"
        >
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
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

/** One cell of the summary strip. Every cell keeps the same three lines. */
function Metric({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: ReactNode;
  value: string;
  valueClassName?: string;
  hint: ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1.5 text-xl font-semibold tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {hint}
      </p>
    </div>
  );
}

function SummaryStrip({
  summary,
  snapshotLabel,
}: {
  summary: PortfolioSummary;
  snapshotLabel: string;
}) {
  useLingui();

  const breakdown = summary.totalsByCurrency
    .map((total) => formatMoney(total.investedCost, total.currency))
    .join(" + ");

  const meta = [
    t({
      id: "positions.openCount",
      message: plural(
        { count: summary.openPositions },
        { one: "# open position", other: "# open positions" },
      ),
    }),
    summary.closedPositions > 0
      ? t({
          id: "positions.closedCount",
          message: plural(
            { count: summary.closedPositions },
            { one: "# closed position", other: "# closed positions" },
          ),
        })
      : null,
    summary.unquotedPositions > 0
      ? t({
          id: "positions.unquotedCount",
          message: plural(
            { count: summary.unquotedPositions },
            { one: "# without a quote", other: "# without a quote" },
          ),
        })
      : null,
    summary.usdBrlRate
      ? `1 USD = ${formatQuantity(summary.usdBrlRate)} BRL`
      : null,
    breakdown ? nativeTotalsLabel(breakdown) : null,
  ].filter((entry): entry is string => entry != null);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid divide-y sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
        <Metric
          label={<Trans id="positions.marketValue">Market value</Trans>}
          value={formatMoney(summary.totalMarketValue, summary.displayCurrency)}
          hint={
            <Trans id="positions.marketValueHint">
              Quoted equity at {snapshotLabel}.
            </Trans>
          }
        />
        <Metric
          label={<Trans id="positions.investedCost">Invested cost</Trans>}
          value={formatMoney(summary.totalInvested, summary.displayCurrency)}
          hint={
            <Trans id="positions.investedCostHint">
              Cost basis of everything you still hold.
            </Trans>
          }
        />
        <Metric
          label={<Trans id="positions.unrealizedPnl">Open result</Trans>}
          value={signedOrZero(
            summary.totalUnrealizedPnl,
            summary.displayCurrency,
          )}
          valueClassName={pnlClassName(summary.totalUnrealizedPnl)}
          hint={
            summary.totalUnrealizedPnlPercent ? (
              <span className={pnlClassName(summary.totalUnrealizedPnl)}>
                {formatSignedPercent(summary.totalUnrealizedPnlPercent)}
              </span>
            ) : (
              <Trans id="positions.unrealizedPnlHint">
                Market value against the cost of quoted assets.
              </Trans>
            )
          }
        />
        <Metric
          label={<Trans id="positions.realizedPnl">Realized P&L</Trans>}
          value={signedOrZero(
            summary.totalRealizedPnl,
            summary.displayCurrency,
          )}
          valueClassName={pnlClassName(summary.totalRealizedPnl)}
          hint={
            <Trans id="positions.realizedPnlHint">
              Result already locked in by your sells.
            </Trans>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
        {meta.map((entry, index) => (
          <span key={entry} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span className="tabular-nums">{entry}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

/** Zero amounts read better without a sign. */
function signedOrZero(value: string, currency: Currency): string {
  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}

/** Native subtotals line of the summary meta strip. */
function nativeTotalsLabel(breakdown: string): string {
  return t({
    id: "positions.nativeTotals",
    message: `Native totals: ${breakdown}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Allocation                                                                 */
/* -------------------------------------------------------------------------- */

/** How the composition panel buckets the portfolio. */
type AllocationGroupBy = "class" | "currency" | "category";

/** Assets listed before the panel asks to be expanded. */
const COLLAPSED_ASSET_ROWS = 24;

/** Bucket holding every asset the user has not filed under a category. */
const UNCATEGORIZED = "uncategorized";

type GroupRow = {
  key: string;
  label: string;
  /** CSS color of the bar. Categories carry the color the user picked. */
  color?: string;
  /** Share of quoted equity, `0`–`1`. */
  share: number;
  shareLabel: string;
  display: string;
  count: number;
  /** Row ids in the bucket, so hovering it can highlight the asset list. */
  assetIds: Set<string>;
};

type AssetRow = {
  /** Ticker and currency, matching the holdings table row identity. */
  id: string;
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  /** Share of quoted equity, `0`–`1`. */
  share: number;
  shareLabel: string;
  display: string;
};

/** Bucket name for the active grouping, as a plain string for the tile. */
function bucketLabel(
  position: ValuedPosition,
  groupBy: AllocationGroupBy,
  category: Category | undefined,
  i18n: I18n,
): string {
  if (groupBy === "class") {
    return assetClassText(position.assetClass, i18n);
  }

  if (groupBy === "currency") {
    return position.currency;
  }

  return (
    category?.name ??
    i18n._(t({ id: "positions.allocUncategorized", message: "Uncategorized" }))
  );
}

/** Same row identity the holdings table uses: a ticker per currency. */
function assetRowId(position: ValuedPosition): string {
  return `${position.ticker}|${position.currency}`;
}

/**
 * One bar on a full-width track. The track is the comparison baseline, so
 * every bar of a list has to share the same track width — keep the wrapper
 * flexible and let the grid column decide how wide that is.
 */
function ShareBar({
  fraction,
  color,
  className,
}: {
  fraction: number;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block h-2 overflow-hidden rounded-[3px] bg-muted",
        className,
      )}
      aria-hidden="true"
    >
      <span
        className={cn("block h-full rounded-r-[3px]", !color && "bg-chart-1")}
        style={{
          // A sliver keeps sub-percent rows visible instead of blank.
          width: `${Math.max(fraction * 100, 1.2)}%`,
          backgroundColor: color,
        }}
      />
    </span>
  );
}

/** Heading and scale caption shared by both allocation sections. */
function PanelHeading({
  title,
  caption,
}: {
  title: ReactNode;
  caption: ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground/70">{caption}</p>
    </div>
  );
}

function AllocationCard({
  positions,
  summary,
  snapshotLabel,
}: {
  positions: ValuedPosition[];
  summary: PortfolioSummary;
  snapshotLabel: string;
}) {
  const { i18n } = useLingui();
  const [groupBy, setGroupBy] = useState<AllocationGroupBy>("class");
  // `hovered` previews a bucket, `pinned` keeps it after the pointer leaves.
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [pinned, setPinned] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const activeGroup = hovered ?? pinned;

  // Categories are the user's own buckets; the tab only shows up once at
  // least one exists.
  const categoryList = trpc.categories.list.useQuery();
  const categories = categoryList.data?.categories ?? [];
  const categoryByTicker = useMemo(() => {
    const map = new Map<string, string>();

    for (const asset of categoryList.data?.assets ?? []) {
      if (asset.categoryId) {
        map.set(asset.ticker, asset.categoryId);
      }
    }

    return map;
  }, [categoryList.data?.assets]);

  // Falls back to classes when the last category is deleted elsewhere.
  const activeGroupBy: AllocationGroupBy =
    groupBy === "category" && categories.length === 0 ? "class" : groupBy;

  const quoted = useMemo(
    () => positions.filter((position) => position.convertedMarketValue != null),
    [positions],
  );

  const total = useMemo(
    () =>
      quoted.reduce(
        (sum, position) => sum + Number(position.convertedMarketValue ?? 0),
        0,
      ),
    [quoted],
  );

  const assets: AssetRow[] = useMemo(
    () =>
      quoted
        .map((position) => {
          const value = Number(position.convertedMarketValue ?? 0);
          const share =
            position.weight != null
              ? Number(position.weight)
              : total > 0
                ? value / total
                : 0;

          return {
            id: assetRowId(position),
            ticker: position.ticker,
            assetClass: position.assetClass,
            currency: position.currency,
            share,
            shareLabel: formatWeight(String(share)),
            display: formatCompactMoney(value, summary.displayCurrency),
          };
        })
        .sort((a, b) => b.share - a.share),
    [quoted, total, summary.displayCurrency],
  );

  const groups: GroupRow[] = useMemo(() => {
    const categoryById = new Map(
      categories.map((category) => [category.id, category]),
    );
    const buckets = new Map<
      string,
      {
        label: string;
        color?: string;
        value: number;
        count: number;
        assetIds: Set<string>;
      }
    >();

    for (const position of quoted) {
      const category =
        activeGroupBy === "category"
          ? categoryById.get(categoryByTicker.get(position.ticker) ?? "")
          : undefined;
      const key =
        activeGroupBy === "class"
          ? position.assetClass
          : activeGroupBy === "currency"
            ? position.currency
            : (category?.id ?? UNCATEGORIZED);
      const bucket = buckets.get(key) ?? {
        label: bucketLabel(position, activeGroupBy, category, i18n),
        // Categories wear the color the user picked; the residual bucket
        // stays neutral so it never reads as one of them.
        color:
          activeGroupBy === "category"
            ? (category && `var(--${category.color})`) ||
              "var(--muted-foreground)"
            : undefined,
        value: 0,
        count: 0,
        assetIds: new Set<string>(),
      };

      bucket.value += Number(position.convertedMarketValue ?? 0);
      bucket.count += 1;
      bucket.assetIds.add(assetRowId(position));
      buckets.set(key, bucket);
    }

    return (
      [...buckets]
        .map(([key, bucket]) => {
          const share = total > 0 ? bucket.value / total : 0;

          return {
            key,
            label: bucket.label,
            color: bucket.color,
            share,
            shareLabel: formatWeight(String(share)),
            display: formatMoney(
              bucket.value.toFixed(2),
              summary.displayCurrency,
            ),
            count: bucket.count,
            assetIds: bucket.assetIds,
          };
        })
        // The residual bucket trails the real ones however big it is.
        .sort((a, b) => {
          if (a.key === UNCATEGORIZED || b.key === UNCATEGORIZED) {
            return a.key === UNCATEGORIZED ? 1 : -1;
          }

          return b.share - a.share;
        })
    );
  }, [
    quoted,
    activeGroupBy,
    categories,
    categoryByTicker,
    total,
    summary.displayCurrency,
    i18n,
  ]);

  // Clicking a bucket filters the list; hovering one only previews it, so the
  // rows never reflow under the pointer.
  const pinnedGroup = groups.find((group) => group.key === pinned);
  const previewedIds =
    !pinnedGroup && hovered
      ? groups.find((group) => group.key === hovered)?.assetIds
      : undefined;

  const listedAssets = pinnedGroup
    ? assets.filter((asset) => pinnedGroup.assetIds.has(asset.id))
    : assets;

  // Bars in the asset list are relative to the largest holding of the whole
  // portfolio: shares of the total are too small to compare at this scale, and
  // a fixed reference keeps a bar the same length whatever the filter is.
  const largestShare = assets[0]?.share ?? 0;
  const visibleAssets = expanded
    ? listedAssets
    : listedAssets.slice(0, COLLAPSED_ASSET_ROWS);

  const groupings: { id: AllocationGroupBy; label: ReactNode }[] = [
    { id: "class", label: <Trans id="positions.allocByClass">Class</Trans> },
    {
      id: "currency",
      label: <Trans id="positions.allocByCurrency">Currency</Trans>,
    },
    ...(categories.length > 0
      ? [
          {
            id: "category" as const,
            label: <Trans id="positions.allocByCategory">Category</Trans>,
          },
        ]
      : []),
  ];

  function toggleGroup(key: string) {
    setPinned((current) => (current === key ? undefined : key));
  }

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
        {quoted.length > 0 ? (
          <CardAction>
            <fieldset className="inline-flex rounded-lg border bg-muted/40 p-1">
              <legend className="sr-only">
                <Trans id="positions.allocGroupBy">Group by</Trans>
              </legend>
              {groupings.map((grouping) => (
                <Button
                  key={grouping.id}
                  type="button"
                  size="sm"
                  aria-pressed={activeGroupBy === grouping.id}
                  variant={activeGroupBy === grouping.id ? "default" : "ghost"}
                  className={cn(
                    activeGroupBy !== grouping.id && "text-muted-foreground",
                  )}
                  onClick={() => {
                    setGroupBy(grouping.id);
                    setPinned(undefined);
                  }}
                >
                  {grouping.label}
                </Button>
              ))}
            </fieldset>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {quoted.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            <Trans id="positions.noQuotes">
              No market quotes for this snapshot yet.
            </Trans>
          </p>
        ) : (
          <div className="space-y-7">
            <section className="space-y-3">
              <PanelHeading
                title={
                  activeGroupBy === "class" ? (
                    <Trans id="positions.allocGroupsClass">By class</Trans>
                  ) : activeGroupBy === "currency" ? (
                    <Trans id="positions.allocGroupsCurrency">
                      By currency
                    </Trans>
                  ) : (
                    <Trans id="positions.allocGroupsCategory">
                      By category
                    </Trans>
                  )
                }
                caption={
                  <Trans id="positions.allocGroupsCaption">
                    Share of quoted equity.
                  </Trans>
                }
              />
              {/* Auto-fit keeps the row full whatever the bucket count is. The
                  negative margin lets the hover surface bleed out so labels
                  still line up with the heading. */}
              <ul className="-mx-2 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-x-10 gap-y-2">
                {groups.map((group) => (
                  <li key={group.key}>
                    <button
                      type="button"
                      className={cn(
                        "w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60",
                        pinned === group.key && "bg-muted/60",
                        activeGroup && activeGroup !== group.key
                          ? "opacity-40"
                          : "",
                      )}
                      aria-pressed={pinned === group.key}
                      onClick={() => toggleGroup(group.key)}
                      onMouseEnter={() => setHovered(group.key)}
                      onMouseLeave={() => setHovered(undefined)}
                      onFocus={() => setHovered(group.key)}
                      onBlur={() => setHovered(undefined)}
                    >
                      <span className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate font-medium">
                          {group.label}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">
                          {group.shareLabel}
                        </span>
                      </span>
                      <ShareBar
                        className="mt-1.5"
                        color={group.color}
                        fraction={group.share}
                      />
                      <span className="mt-1 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {i18n._(
                            t({
                              id: "positions.allocGroupCount",
                              message: plural(
                                { count: group.count },
                                { one: "# asset", other: "# assets" },
                              ),
                            }),
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {group.display}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-3 border-t pt-6">
              <PanelHeading
                title={
                  <Trans id="positions.allocAssets">
                    By asset · {listedAssets.length}
                  </Trans>
                }
                caption={
                  <Trans id="positions.allocAssetsCaption">
                    Bars relative to the largest position.
                  </Trans>
                }
              />
              {/* Two columns at most: a third one starves the bars. */}
              <ul className="-mx-2 grid gap-x-8 gap-y-0.5 md:grid-cols-2">
                {visibleAssets.map((asset) => (
                  <li
                    key={asset.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1 text-sm transition-opacity",
                      previewedIds && !previewedIds.has(asset.id)
                        ? "opacity-30"
                        : "",
                    )}
                  >
                    <AssetLogo
                      ticker={asset.ticker}
                      assetClass={asset.assetClass}
                      currency={asset.currency}
                      className="size-6 shrink-0 rounded-sm"
                    />
                    <AssetLink
                      ticker={asset.ticker}
                      className="w-[76px] shrink-0 truncate font-medium"
                      title={asset.ticker}
                    >
                      {asset.ticker}
                    </AssetLink>
                    <ShareBar
                      className="min-w-8 flex-1"
                      fraction={
                        largestShare > 0 ? asset.share / largestShare : 0
                      }
                    />
                    <span className="w-11 shrink-0 text-right tabular-nums">
                      {asset.shareLabel}
                    </span>
                    {/* The amount is a bonus: it only shows where the bar can
                        spare the width, and the holdings table always has it. */}
                    <span className="hidden w-20 shrink-0 text-right text-muted-foreground tabular-nums xl:block">
                      {asset.display}
                    </span>
                  </li>
                ))}
              </ul>
              {listedAssets.length > COLLAPSED_ASSET_ROWS ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setExpanded((current) => !current)}
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="size-4" aria-hidden="true" />
                      <Trans id="positions.allocShowLess">Show fewer</Trans>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="size-4" aria-hidden="true" />
                      <Trans id="positions.allocShowAll">
                        Show all {listedAssets.length}
                      </Trans>
                    </>
                  )}
                </Button>
              ) : null}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary teaser (top movers → Deep Finder)                                  */
/* -------------------------------------------------------------------------- */

type MoverRow = {
  ticker: string;
  change: string | null;
  changePercent: string | null;
};

function pickTopMovers(rows: MoverRow[], limit = 3) {
  const comparable = rows.filter((row) => row.changePercent != null);
  const gainers = comparable
    .filter((row) => Number(row.changePercent) > 0)
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
    .slice(0, limit);
  const losers = comparable
    .filter((row) => Number(row.changePercent) < 0)
    .sort((a, b) => Number(a.changePercent) - Number(b.changePercent))
    .slice(0, limit);

  return { gainers, losers };
}

function DeepFinderTeaser({
  className,
  positions,
  summary,
}: {
  className?: string;
  positions: ValuedPosition[];
  summary: PortfolioSummary;
}) {
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const fx = useFxQuote();
  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );
  const month = trpc.positions.finder.useQuery({
    displayCurrency,
    usdBrlRate: fx.effectiveRate,
    quoteSource,
    window: "1m",
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  });

  const fallbackRows = useMemo<MoverRow[]>(
    () =>
      positions.map((position) => ({
        ticker: position.ticker,
        change: position.convertedUnrealizedPnl,
        changePercent: position.unrealizedPnlPercent,
      })),
    [positions],
  );

  const showSkeleton = month.isPending && !month.data;
  const movers = pickTopMovers(
    month.data?.positions ?? (month.isError ? fallbackRows : []),
  );
  const totalChange =
    month.data?.summary.totalChange ?? summary.totalUnrealizedPnl;
  const currency =
    month.data?.summary.displayCurrency ?? summary.displayCurrency;
  const rising =
    month.data?.summary.advancing ??
    fallbackRows.filter((row) => Number(row.changePercent) > 0).length;
  const falling =
    month.data?.summary.declining ??
    fallbackRows.filter((row) => Number(row.changePercent) < 0).length;

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.teaserTitle">Summary</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.teaserHint">
            Biggest percent moves over the last month. Open Deep Finder for
            every ticker and lookback window.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5 lg:grid lg:grid-cols-3 lg:items-start lg:gap-10">
        {showSkeleton ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-4 w-36" />
          </div>
        ) : (
          <div>
            <p
              className={`text-2xl font-semibold tabular-nums ${pnlClassName(totalChange)}`}
            >
              {signedOrZero(totalChange, currency)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="text-foreground tabular-nums">{rising}</span>{" "}
              <Trans id="positions.teaserRising">rising</Trans>
              <span aria-hidden="true"> · </span>
              <span className="text-foreground tabular-nums">{falling}</span>{" "}
              <Trans id="positions.teaserFalling">falling</Trans>
            </p>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-5 lg:col-span-2 lg:flex-row lg:gap-10">
          <MoverList
            className="lg:flex-1"
            title={<Trans id="positions.teaserGainers">Top gainers</Trans>}
            empty={
              <Trans id="positions.teaserEmptyUp">
                No rising holdings this month.
              </Trans>
            }
            rows={movers.gainers}
            currency={currency}
            loading={showSkeleton}
          />
          <MoverList
            title={<Trans id="positions.teaserLosers">Top losers</Trans>}
            empty={
              <Trans id="positions.teaserEmptyDown">
                No falling holdings this month.
              </Trans>
            }
            className="lg:flex-1"
            rows={movers.losers}
            currency={currency}
            loading={showSkeleton}
          />
        </div>
      </CardContent>
      <CardFooter className="mt-auto">
        <Button asChild className="w-full sm:w-auto">
          <Link to="/deep-finder">
            <ScanSearch className="size-4" aria-hidden="true" />
            <Trans id="positions.openDeepFinder">Open Deep Finder</Trans>
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function MoverList({
  className,
  title,
  empty,
  rows,
  currency,
  loading,
}: {
  className?: string;
  title: ReactNode;
  empty: ReactNode;
  rows: MoverRow[];
  currency: Currency;
  loading: boolean;
}) {
  return (
    <section className={className}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {loading ? (
        <ul className="mt-2 space-y-2">
          <li>
            <Skeleton className="h-5 w-full" />
          </li>
          <li>
            <Skeleton className="h-5 w-full" />
          </li>
          <li>
            <Skeleton className="h-5 w-full" />
          </li>
        </ul>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.ticker} className="flex items-baseline gap-3 text-sm">
              <AssetLink ticker={row.ticker} className="font-medium">
                {row.ticker}
              </AssetLink>
              <span
                className={cn(
                  "ml-auto tabular-nums",
                  row.changePercent ? pnlClassName(row.changePercent) : "",
                )}
              >
                {row.changePercent
                  ? formatSignedPercent(row.changePercent)
                  : "—"}
              </span>
              <span
                className={cn(
                  "w-[7.25rem] text-right tabular-nums",
                  row.change ? pnlClassName(row.change) : "",
                )}
              >
                {row.change ? signedOrZero(row.change, currency) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Holdings table                                                             */
/* -------------------------------------------------------------------------- */

type SortKey = "ticker" | "value" | "share" | "pnl";
type SortDirection = "asc" | "desc";

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
  const Icon = !active
    ? ArrowUpDown
    : direction === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground ${
        align === "right" ? "flex-row-reverse" : ""
      } ${active ? "text-foreground" : ""}`}
    >
      {label}
      <Icon
        className={`size-3.5 shrink-0 transition-opacity ${
          active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}

function ariaSort(
  active: boolean,
  direction: SortDirection,
): "ascending" | "descending" | "none" {
  if (!active) {
    return "none";
  }

  return direction === "asc" ? "ascending" : "descending";
}

function HoldingsCard({
  positions,
  summary,
  missing,
}: {
  positions: ValuedPosition[];
  summary: PortfolioSummary;
  missing: string[];
}) {
  const { i18n } = useLingui();
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const rows = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;

    const metric = (position: ValuedPosition): number | null => {
      if (sortKey === "value") {
        return position.convertedMarketValue == null
          ? null
          : Number(position.convertedMarketValue);
      }

      if (sortKey === "pnl") {
        return position.convertedUnrealizedPnl == null
          ? null
          : Number(position.convertedUnrealizedPnl);
      }

      return position.weight == null ? null : Number(position.weight);
    };

    return [...positions].sort((a, b) => {
      if (sortKey === "ticker") {
        return direction * a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      const left = metric(a);
      const right = metric(b);

      // Assets without a quote always sink to the bottom.
      if (left == null || right == null) {
        if (left == null && right == null) {
          return a.ticker.localeCompare(b.ticker, i18n.locale);
        }

        return left == null ? 1 : -1;
      }

      if (left === right) {
        return a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      return direction * (left - right);
    });
  }, [positions, sortKey, sortDir, i18n.locale]);

  const maxWeight = useMemo(
    () =>
      positions.reduce(
        (max, position) => Math.max(max, Number(position.weight ?? 0)),
        0,
      ),
    [positions],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));

      return;
    }

    setSortKey(key);
    setSortDir(key === "ticker" ? "asc" : "desc");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.holdings">Holdings</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.holdingsHint">
            Average cost and prices stay in the native currency of each asset;
            market value and result are consolidated.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="[&_tbody_td]:h-11 [&_tfoot_td]:h-11">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className="text-muted-foreground"
                aria-sort={ariaSort(sortKey === "ticker", sortDir)}
              >
                <SortHeaderButton
                  label={<Trans id="positions.colTicker">Ticker</Trans>}
                  active={sortKey === "ticker"}
                  direction={sortDir}
                  onToggle={() => toggleSort("ticker")}
                />
              </TableHead>
              <TableHead className="text-muted-foreground">
                <Trans id="positions.colClass">Class</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="positions.colQuantity">Quantity</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="positions.colAvgCost">Avg. cost</Trans>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <Trans id="positions.colPrice">Price</Trans>
              </TableHead>
              <TableHead
                className="text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "value", sortDir)}
              >
                <SortHeaderButton
                  label={
                    <Trans id="positions.colMarketValue">Market value</Trans>
                  }
                  align="right"
                  active={sortKey === "value"}
                  direction={sortDir}
                  onToggle={() => toggleSort("value")}
                />
              </TableHead>
              <TableHead
                className="text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "pnl", sortDir)}
              >
                <SortHeaderButton
                  label={
                    <Trans id="positions.colOpenResult">Open result</Trans>
                  }
                  align="right"
                  active={sortKey === "pnl"}
                  direction={sortDir}
                  onToggle={() => toggleSort("pnl")}
                />
              </TableHead>
              <TableHead
                className="w-[132px] text-right text-muted-foreground"
                aria-sort={ariaSort(sortKey === "share", sortDir)}
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
                  <AssetLink
                    ticker={position.ticker}
                    className="flex items-center gap-2"
                  >
                    <AssetLogo
                      ticker={position.ticker}
                      assetClass={position.assetClass}
                      currency={position.currency}
                    />
                    {position.ticker}
                  </AssetLink>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <AssetClassLabel assetClass={position.assetClass} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.assetClass === "fixed_income" ? (
                    <Dash />
                  ) : (
                    formatQuantity(position.quantity)
                  )}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {position.assetClass === "fixed_income" ? (
                    <Dash />
                  ) : (
                    formatMoney(position.averagePrice, position.currency)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.assetClass === "fixed_income" ||
                  position.marketPrice == null ? (
                    <Dash />
                  ) : (
                    formatMoney(position.marketPrice, position.currency)
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {position.convertedMarketValue == null ? (
                    <Dash />
                  ) : (
                    formatMoney(
                      position.convertedMarketValue,
                      position.displayCurrency,
                    )
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.assetClass === "fixed_income" ||
                  position.convertedUnrealizedPnl == null ? (
                    <Dash />
                  ) : (
                    <span
                      className={`flex items-center justify-end gap-2 ${pnlClassName(position.convertedUnrealizedPnl)}`}
                    >
                      {signedOrZero(
                        position.convertedUnrealizedPnl,
                        position.displayCurrency,
                      )}
                      {position.unrealizedPnlPercent ? (
                        <span className="text-xs opacity-80">
                          {formatSignedPercent(position.unrealizedPnlPercent)}
                        </span>
                      ) : null}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {position.weight == null ? (
                    <Dash />
                  ) : (
                    <span className="flex items-center justify-end gap-2">
                      {formatWeight(position.weight)}
                      <ShareBar
                        className="w-14 shrink-0"
                        fraction={
                          weightBarWidth(position.weight, maxWeight) / 100
                        }
                      />
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="font-medium">
                <Trans id="positions.total">Total</Trans>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(summary.totalMarketValue, summary.displayCurrency)}
              </TableCell>
              <TableCell
                className={`text-right font-medium tabular-nums ${pnlClassName(summary.totalUnrealizedPnl)}`}
              >
                {signedOrZero(
                  summary.totalUnrealizedPnl,
                  summary.displayCurrency,
                )}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {summary.quotedPositions > 0 ? formatWeight("1") : <Dash />}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>

        {missing.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
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

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

/** Bars are scaled against the largest holding, not against 100%. */
function weightBarWidth(weight: string, maxWeight: number): number {
  if (maxWeight <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(4, (Number(weight) / maxWeight) * 100));
}

/* -------------------------------------------------------------------------- */
/* Manual prices                                                              */
/* -------------------------------------------------------------------------- */

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((position) => (
            <div key={position.ticker} className="grid gap-1.5">
              <Label
                htmlFor={`manual-price-${position.ticker}`}
                className="w-full justify-between text-xs"
              >
                <span>
                  {position.ticker} ({position.currency})
                </span>
                <span className="font-normal text-muted-foreground tabular-nums">
                  {position.marketPrice
                    ? formatMoney(position.marketPrice, position.currency)
                    : "—"}
                </span>
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
          ))}
        </div>
        <Button type="button" size="sm" onClick={save}>
          <Trans id="positions.savePrices">Save prices</Trans>
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="rounded-full bg-muted p-3">
          <Wallet className="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
        <p className="max-w-sm text-sm text-muted-foreground">
          <Trans id="positions.empty">
            No positions yet. Register your first trade to see it here.
          </Trans>
        </p>
        <Button asChild size="sm">
          <Link to="/transactions">
            <Plus className="size-4" aria-hidden="true" />
            <Trans id="positions.registerTrade">Register a trade</Trans>
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function PositionsSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[136px]" />
      <Skeleton className="h-[420px]" />
      <Skeleton className="h-[248px]" />
      <Skeleton className="h-72" />
    </div>
  );
}
