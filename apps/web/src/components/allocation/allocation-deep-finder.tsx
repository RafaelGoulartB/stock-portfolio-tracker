import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  AllocationMarkColor,
  AllocationRow,
  Currency,
  DeepFinderWindow,
  QuoteSource,
} from "@portifolio-tracker/shared";
import { ALLOCATION_MARK_COLORS } from "@portifolio-tracker/shared";
import {
  ArrowDown,
  ArrowUp,
  MoreVertical,
  ScanSearch,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTitleIcon,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  formatMoney,
  formatSignedPercent,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
import { queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

const CATEGORY_ALL = "all";
const CATEGORY_NONE = "none";
const WINDOWS: DeepFinderWindow[] = ["1d", "1w", "1m", "3m", "ytd", "1y"];
type Breadth = "all" | "up" | "down";
type SortDirection = "asc" | "desc";

const MARK_ROW: Record<AllocationMarkColor, string> = {
  blue: "bg-blue-400/[0.07] hover:bg-blue-400/[0.10]",
  yellow: "bg-yellow-400/[0.10] hover:bg-yellow-400/[0.13]",
  red: "bg-red-400/[0.07] hover:bg-red-400/[0.10]",
  orange: "bg-orange-400/[0.10] hover:bg-orange-400/[0.13]",
  green: "bg-green-400/[0.07] hover:bg-green-400/[0.10]",
};

const MARK_DOT: Record<AllocationMarkColor, string> = {
  blue: "bg-blue-400",
  yellow: "bg-yellow-400",
  red: "bg-red-400",
  orange: "bg-orange-400",
  green: "bg-green-400",
};

type CategoryOption = { id: string; name: string };

/** Picks the first category with the largest number of tracked assets. */
function defaultFinderCategory(
  rows: readonly AllocationRow[],
  categories: readonly CategoryOption[],
  categoryByTicker: ReadonlyMap<string, string | null>,
): string {
  let selected = CATEGORY_ALL;
  let largest = 0;

  for (const category of categories) {
    const count = rows.filter(
      (row) =>
        row.tracked &&
        !row.hasPosition &&
        categoryByTicker.get(row.ticker) === category.id,
    ).length;

    if (count > largest) {
      selected = category.id;
      largest = count;
    }
  }

  return selected;
}

function windowLabel(window: DeepFinderWindow) {
  switch (window) {
    case "cost":
      return null;
    case "1d":
      return <Trans id="deepFinder.window1d">1 day</Trans>;
    case "1w":
      return <Trans id="deepFinder.window1w">1 week</Trans>;
    case "1m":
      return <Trans id="deepFinder.window1m">1 month</Trans>;
    case "3m":
      return <Trans id="deepFinder.window3m">3 months</Trans>;
    case "ytd":
      return <Trans id="deepFinder.windowYtd">YTD</Trans>;
    case "1y":
      return <Trans id="deepFinder.window1y">1 year</Trans>;
  }
}

export function AllocationDeepFinderButton({
  rows,
  categories,
  categoryByTicker,
  displayCurrency,
  usdBrlRate,
  quoteSource,
  manualPrices,
  disabled = false,
  onSetMarkColor,
}: {
  rows: AllocationRow[];
  categories: CategoryOption[];
  categoryByTicker: ReadonlyMap<string, string | null>;
  displayCurrency: Currency;
  usdBrlRate?: string;
  quoteSource: QuoteSource;
  manualPrices?: Record<string, string>;
  disabled?: boolean;
  onSetMarkColor: (
    ticker: string,
    markColor: AllocationMarkColor | null,
  ) => void;
}) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [window, setWindow] = useState<DeepFinderWindow>("1m");
  const [breadth, setBreadth] = useState<Breadth>("all");
  const [variationSort, setVariationSort] = useState<SortDirection>("desc");
  const [search, setSearch] = useState("");
  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const defaultCategory = useMemo(
    () => defaultFinderCategory(rows, categories, categoryByTicker),
    [rows, categories, categoryByTicker],
  );
  const category = categoryChoice ?? defaultCategory;
  const watchRows = useMemo(
    () =>
      new Map(
        rows
          .filter((row) => row.tracked && !row.hasPosition)
          .map((row) => [row.ticker, row]),
      ),
    [rows],
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const row of rows) {
      if (!row.tracked || row.hasPosition) continue;
      const categoryId = categoryByTicker.get(row.ticker) ?? CATEGORY_NONE;
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }

    return counts;
  }, [rows, categoryByTicker]);
  const finder = trpc.allocation.finder.useQuery(
    {
      displayCurrency,
      usdBrlRate,
      quoteSource,
      window,
      manualPrices,
      ...(category === CATEGORY_ALL
        ? {}
        : { categoryId: category === CATEGORY_NONE ? null : category }),
    },
    { enabled: open },
  );
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(i18n.locale);

    const filtered = (finder.data?.positions ?? []).filter((row) => {
      if (
        needle &&
        !row.ticker.toLocaleLowerCase(i18n.locale).includes(needle)
      ) {
        return false;
      }

      if (breadth === "all") return true;
      if (row.changePercent === null) return false;
      return breadth === "up"
        ? Number(row.changePercent) > 0
        : Number(row.changePercent) < 0;
    });

    return filtered.sort((left, right) => {
      if (left.changePercent === null || right.changePercent === null) {
        if (left.changePercent === right.changePercent) {
          return left.ticker.localeCompare(right.ticker, i18n.locale);
        }

        return left.changePercent === null ? 1 : -1;
      }

      const difference =
        Number(left.changePercent) - Number(right.changePercent);

      return (
        (variationSort === "asc" ? difference : -difference) ||
        left.ticker.localeCompare(right.ticker, i18n.locale)
      );
    });
  }, [breadth, finder.data?.positions, i18n.locale, search, variationSort]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <ScanSearch aria-hidden="true" />
          <Trans id="allocation.finderOpen">Deep Finder</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <DialogTitleIcon>
              <ScanSearch aria-hidden="true" />
            </DialogTitleIcon>
            <Trans id="allocation.finderTitle">Watchlist Deep Finder</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="allocation.finderDescription">
              Compare price movement for every asset that is still on your
              radar.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={category} onValueChange={setCategoryChoice}>
              <SelectTrigger
                size="sm"
                className="w-52"
                aria-label={i18n._(
                  t({
                    id: "allocation.finderCategory",
                    message: "Filter Deep Finder by category",
                  }),
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CATEGORY_ALL}>
                  <Trans id="allocation.categoryAll">All categories</Trans> (
                  {watchRows.size})
                </SelectItem>
                <SelectItem value={CATEGORY_NONE}>
                  <Trans id="allocation.categoryNone">Uncategorized</Trans> (
                  {categoryCounts.get(CATEGORY_NONE) ?? 0})
                </SelectItem>
                {categories.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} ({categoryCounts.get(item.id) ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative min-w-40 flex-1 sm:max-w-56">
              <Search
                className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 pl-8"
                placeholder={i18n._(
                  t({ id: "allocation.search", message: "Search ticker…" }),
                )}
                aria-label={i18n._(
                  t({ id: "allocation.searchLabel", message: "Search assets" }),
                )}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {WINDOWS.map((id) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={window === id ? "default" : "outline"}
                aria-pressed={window === id}
                onClick={() => setWindow(id)}
              >
                {windowLabel(id)}
              </Button>
            ))}
            <span className="mx-1 hidden h-8 w-px bg-border sm:block" />
            <Button
              type="button"
              size="sm"
              variant={breadth === "all" ? "secondary" : "ghost"}
              aria-pressed={breadth === "all"}
              onClick={() => setBreadth("all")}
            >
              <Trans id="deepFinder.filterAll">All</Trans>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={breadth === "up" ? "secondary" : "ghost"}
              aria-pressed={breadth === "up"}
              onClick={() => setBreadth("up")}
            >
              <ArrowUp aria-hidden="true" />
              <Trans id="deepFinder.filterUp">Rising</Trans>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={breadth === "down" ? "secondary" : "ghost"}
              aria-pressed={breadth === "down"}
              onClick={() => setBreadth("down")}
            >
              <ArrowDown aria-hidden="true" />
              <Trans id="deepFinder.filterDown">Falling</Trans>
            </Button>
          </div>

          {finder.isPending ? <Skeleton className="h-72" /> : null}
          {finder.error ? (
            <p className="rounded-md border px-4 py-6 text-sm text-destructive">
              {queryErrorMessage(finder.error)}
            </p>
          ) : null}
          {finder.data ? (
            <div className="min-h-0 overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>
                      <Trans id="deepFinder.colTicker">Ticker</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans id="allocation.finderCurrent">Current price</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans id="allocation.finderBaseline">
                        Starting price
                      </Trans>
                    </TableHead>
                    <TableHead
                      className="text-right"
                      aria-sort={
                        variationSort === "asc" ? "ascending" : "descending"
                      }
                    >
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                        aria-label={i18n._(
                          t({
                            id: "allocation.finderSortVariation",
                            message: "Sort by variation",
                          }),
                        )}
                        onClick={() =>
                          setVariationSort((current) =>
                            current === "asc" ? "desc" : "asc",
                          )
                        }
                      >
                        <Trans id="allocation.finderVariation">Variation</Trans>
                        {variationSort === "asc" ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="w-9" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => {
                    const allocationRow = watchRows.get(row.ticker);

                    return (
                      <TableRow
                        key={row.ticker}
                        className={
                          allocationRow?.markColor
                            ? MARK_ROW[allocationRow.markColor]
                            : undefined
                        }
                      >
                        <TableCell>
                          <div className="flex items-center gap-2 font-medium">
                            <AssetLogo
                              ticker={row.ticker}
                              assetClass={row.assetClass}
                              currency={row.currency}
                            />
                            <AssetLink ticker={row.ticker}>
                              {row.ticker}
                            </AssetLink>
                            {allocationRow && !allocationRow.hasPosition ? (
                              <Badge
                                variant="outline"
                                className="h-4 px-1 text-[10px] font-normal"
                              >
                                <Trans id="allocation.watchBadge">Watch</Trans>
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {row.marketPrice === null
                            ? "—"
                            : formatMoney(row.marketPrice, row.currency)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          <span className="block">
                            {row.baselinePrice === null
                              ? "—"
                              : formatMoney(row.baselinePrice, row.currency)}
                          </span>
                          {row.baselineAsOf ? (
                            <span className="block text-xs text-muted-foreground">
                              {formatTradeDate(row.baselineAsOf)}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            row.changePercent &&
                              pnlClassName(row.changePercent),
                          )}
                        >
                          {row.changePercent === null
                            ? "—"
                            : formatSignedPercent(row.changePercent)}
                        </TableCell>
                        <TableCell className="px-1">
                          {allocationRow ? (
                            <MarkMenu
                              row={allocationRow}
                              onSetMarkColor={onSetMarkColor}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {visible.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  <Trans id="allocation.finderEmpty">
                    No tracked assets match these filters.
                  </Trans>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MarkMenu({
  row,
  onSetMarkColor,
}: {
  row: AllocationRow;
  onSetMarkColor: (ticker: string, color: AllocationMarkColor | null) => void;
}) {
  const { i18n } = useLingui();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={i18n._(
            t({
              id: "allocation.rowMenu",
              message: `Actions for ${row.ticker}`,
            }),
          )}
        >
          <MoreVertical className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          <Trans id="allocation.markColor">Highlight</Trans>
        </DropdownMenuLabel>
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          {ALLOCATION_MARK_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={i18n._(
                t({
                  id: "allocation.markAs",
                  message: `Mark ${row.ticker} ${color}`,
                }),
              )}
              aria-pressed={row.markColor === color}
              onClick={() => onSetMarkColor(row.ticker, color)}
              className={cn(
                "flex size-5 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                row.markColor === color &&
                  "ring-2 ring-foreground/40 ring-offset-1 ring-offset-popover",
              )}
            >
              <span
                className={cn("size-3.5 rounded-full", MARK_DOT[color])}
                aria-hidden="true"
              />
            </button>
          ))}
          <button
            type="button"
            aria-label={i18n._(
              t({
                id: "allocation.clearMark",
                message: `Clear highlight on ${row.ticker}`,
              }),
            )}
            disabled={row.markColor === null}
            onClick={() => onSetMarkColor(row.ticker, null)}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
