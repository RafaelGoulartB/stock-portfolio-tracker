import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  AllocationMarkColor,
  AllocationRow,
  AllocationSummary,
  AssetReview,
} from "@portifolio-tracker/shared";
import {
  ALLOCATION_MARK_COLORS,
  CASH_TICKER,
  nextAllocationMarkColor,
} from "@portifolio-tracker/shared";
import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Eraser,
  ExternalLink,
  Eye,
  GripVertical,
  MoreVertical,
  Timer,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { AssetLogo } from "@/components/asset-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatMoney,
  formatQuantity,
  formatSignedWeightPrecise,
  formatTradeDate,
  formatWeightPrecise,
  pnlClassName,
} from "@/lib/format";
import { formatDecimalInput, formatPercentInput } from "@/lib/numeric-input";
import { formatQuarterLabel, type Quarter } from "@/lib/quarters";
import { cn } from "@/lib/utils";
import { InlineEditCell } from "./inline-edit-cell";
import { QuarterReviewCell } from "./quarter-review-cell";

/** Sortable columns, in render order. The quarter grid follows them. */
export const ALLOCATION_COLUMNS = [
  "ticker",
  "targetWeight",
  "currentWeight",
  "gapWeight",
  "discount",
  "score",
  "lastContributionAt",
  "quantity",
  "marketValue",
  "averageGrade",
] as const;

export type AllocationColumn = (typeof ALLOCATION_COLUMNS)[number];
export type SortDirection = "asc" | "desc";
export type AllocationSort = { id: AllocationColumn; direction: SortDirection };

/** Columns that read better ascending on first click. */
const ASCENDING_FIRST: AllocationColumn[] = ["ticker", "lastContributionAt"];

export function defaultSortDirection(id: AllocationColumn): SortDirection {
  return ASCENDING_FIRST.includes(id) ? "asc" : "desc";
}

export function columnLabels(i18n: I18n): Record<AllocationColumn, string> {
  return {
    ticker: i18n._(t({ id: "allocation.colTicker", message: "Asset" })),
    targetWeight: i18n._(t({ id: "allocation.colTarget", message: "Target" })),
    currentWeight: i18n._(
      t({ id: "allocation.colCurrent", message: "Current" }),
    ),
    gapWeight: i18n._(t({ id: "allocation.colGap", message: "Gap" })),
    score: i18n._(t({ id: "allocation.colScore", message: "Score" })),
    averageGrade: i18n._(t({ id: "allocation.colGrade", message: "Grade" })),
    discount: i18n._(t({ id: "allocation.colDiscount", message: "Discount" })),
    lastContributionAt: i18n._(
      t({ id: "allocation.colLastBuy", message: "Last buy" }),
    ),
    quantity: i18n._(t({ id: "allocation.colQuantity", message: "Shares" })),
    marketValue: i18n._(t({ id: "allocation.colValue", message: "Value" })),
  };
}

export function sortableValue(
  row: AllocationRow,
  id: AllocationColumn,
): string | number | null {
  switch (id) {
    case "ticker":
      return row.ticker;
    case "targetWeight":
      return row.targetWeight === null ? null : Number(row.targetWeight);
    case "currentWeight":
      return Number(row.currentWeight);
    case "gapWeight":
      return row.gapWeight === null ? null : Number(row.gapWeight);
    case "score":
      return Number(row.score.value);
    case "averageGrade":
      return row.averageGrade === null ? null : Number(row.averageGrade);
    case "discount":
      return row.discount === null ? null : Number(row.discount);
    case "lastContributionAt":
      return row.lastContributionAt;
    case "quantity":
      return Number(row.quantity);
    case "marketValue":
      return row.marketValue === null ? null : Number(row.marketValue);
  }
}

/**
 * The default score view should focus capital allocation on owned assets with
 * a target. Watch-only tickers can still be scored and sorted, but trail those
 * actionable positions until the user chooses a different column or free order.
 */
function hasActionableTarget(row: AllocationRow): boolean {
  return row.hasPosition && row.targetWeight !== null;
}

/** Rows with no value for the sorted column always sink to the bottom. */
export function compareRows(
  a: AllocationRow,
  b: AllocationRow,
  sort: AllocationSort,
): number {
  if (sort.id === "score") {
    const targetPriority =
      Number(hasActionableTarget(b)) - Number(hasActionableTarget(a));

    if (targetPriority !== 0) {
      return targetPriority;
    }
  }

  const left = sortableValue(a, sort.id);
  const right = sortableValue(b, sort.id);

  if (left === null || right === null) {
    if (left === right) {
      return a.ticker.localeCompare(b.ticker);
    }

    return left === null ? 1 : -1;
  }

  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right));

  return (
    (sort.direction === "asc" ? result : -result) ||
    a.ticker.localeCompare(b.ticker)
  );
}

const SCALE = 100_000_000n;
const SCALE_PLACES = 8;

/** Parses a decimal string into a scaled bigint; empty/invalid becomes 0. */
function toScaled(value: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());

  if (!match) {
    return 0n;
  }

  const negative = match[1] === "-";
  const whole = BigInt(match[2] ?? "0");
  const frac = BigInt(
    (match[3] ?? "").padEnd(SCALE_PLACES, "0").slice(0, SCALE_PLACES),
  );
  const scaled = whole * SCALE + frac;

  return negative ? -scaled : scaled;
}

/** Renders a scaled bigint with `places` digits, rounding half away from zero. */
function fromScaled(value: bigint, places: number): string {
  const divisor = 10n ** BigInt(SCALE_PLACES - places);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  const digits = rounded.toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const fraction = places > 0 ? digits.slice(digits.length - places) : "";
  const text = fraction ? `${whole}.${fraction}` : whole;

  return negative && rounded !== 0n ? `-${text}` : text;
}

/** Average of scaled values, rounding half away from zero. */
function averageScaled(sum: bigint, count: number): bigint {
  const denominator = BigInt(count);
  const negative = sum < 0n;
  const absolute = negative ? -sum : sum;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;

  return negative && rounded !== 0n ? -rounded : rounded;
}

/**
 * Totals for the rows currently shown (search, category and radar filters).
 * Matches the server summary shape so the footer and footnote stay consistent.
 */
export function summarizeVisibleRows(
  rows: readonly AllocationRow[],
  displayCurrency: AllocationSummary["displayCurrency"],
  scoreVersion: string,
): AllocationSummary {
  let totalMarketValue = 0n;
  let totalTargetWeight = 0n;
  let totalCurrentWeight = 0n;
  let discountSum = 0n;
  let discountCount = 0;
  let investedAssets = 0;
  let watchOnlyAssets = 0;
  let candidates = 0;
  let blocked = 0;
  let trimCandidates = 0;

  for (const row of rows) {
    if (row.marketValue !== null) {
      totalMarketValue += toScaled(row.marketValue);
    }

    if (row.targetWeight !== null) {
      totalTargetWeight += toScaled(row.targetWeight);
    }

    totalCurrentWeight += toScaled(row.currentWeight);

    if (row.discount !== null) {
      discountSum += toScaled(row.discount);
      discountCount += 1;
    }

    if (row.hasPosition) {
      investedAssets += 1;
    } else {
      watchOnlyAssets += 1;
    }

    const score = Number(row.score.value);

    if (score > 0) {
      candidates += 1;
    } else if (score < 0) {
      trimCandidates += 1;
    }

    if (row.score.blocked) {
      blocked += 1;
    }
  }

  return {
    displayCurrency,
    totalMarketValue: fromScaled(totalMarketValue, 2),
    totalTargetWeight: fromScaled(totalTargetWeight, 8),
    totalCurrentWeight: fromScaled(totalCurrentWeight, 8),
    averageDiscount:
      discountCount === 0
        ? null
        : fromScaled(averageScaled(discountSum, discountCount), 8),
    investedAssets,
    watchOnlyAssets,
    candidates,
    blocked,
    trimCandidates,
    scoreVersion,
  };
}

/** Plain-language reason behind a score, shown on hover. */
export function scoreReason(row: AllocationRow, i18n: I18n): string {
  const { score } = row;

  switch (score.ruleId) {
    case "no-target":
      return i18n._(
        t({
          id: "allocation.reasonNoTarget",
          message: "No target weight set, so there is no gap to close.",
        }),
      );
    case "trim-overweight":
      return i18n._(
        t({
          id: "allocation.reasonTrim",
          message:
            "Above target and no longer cheap: consider trimming instead of buying.",
        }),
      );
    case "weight-cap":
      return i18n._(
        t({
          id: "allocation.reasonWeightCap",
          message: "Past the portfolio weight ceiling for a single asset.",
        }),
      );
    case "target-overweight":
      return i18n._(
        t({
          id: "allocation.reasonOverweight",
          message: "Already past its own target by more than the block factor.",
        }),
      );
    case "cooldown":
      return i18n._(
        t({
          id: "allocation.reasonCooldown",
          message: `Bought recently; free again on ${score.cooldownUntil ?? ""}.`,
        }),
      );
    case "gap-weighted":
      return i18n._(
        t({
          id: "allocation.reasonGap",
          message: `Discount-adjusted target ${score.adjustedTarget === null ? "" : formatWeightPrecise(score.adjustedTarget)} against ${formatWeightPrecise(row.currentWeight)} held, times ${score.multiplier} for quality.`,
        }),
      );
  }
}

export type AllocationTableProps = {
  rows: AllocationRow[];
  quarters: Quarter[];
  summary: AllocationSummary | undefined;
  /** Columns the user chose to display; `ticker` is always included. */
  visibleColumns: Set<AllocationColumn>;
  sort: AllocationSort;
  onSort: (id: AllocationColumn) => void;
  /** Free order replaces sorting with the stored manual rank. */
  freeOrder: boolean;
  onReorder: (tickers: string[]) => void;
  /** Raw cell text; the page owns parsing and validation. */
  onEditTarget: (ticker: string, text: string) => void;
  /** Display-currency market value for an unquoted position. Empty clears. */
  onEditValue: (ticker: string, text: string) => void;
  onClearAnalysis: (ticker: string) => void;
  onRemoveAsset: (row: AllocationRow) => void;
  /** Soft row mark; `null` clears. */
  onSetMarkColor: (
    ticker: string,
    markColor: AllocationMarkColor | null,
  ) => void;
  onSaveReview: (input: {
    ticker: string;
    period: string;
    grade: string | null;
    notes: string | null;
    fairValue: string | null;
    fairValueRef: string | null;
  }) => void;
  onRemoveReview: (input: { ticker: string; period: string }) => void;
  missing: string[];
  saving?: boolean;
};

const FOCUS_QUARTERS_KEY = "portfolio.allocation.focusQuarters";
const FOCUS_QUARTER_COL = "bg-blue-400/[0.04]";

/**
 * Soft mark tint mixed into `--card` so sticky ticker and the rest of the
 * row share the same opaque wash. Hover deepens the same hue slightly
 * instead of swapping to muted grey.
 */
const MARK_ROW: Record<AllocationMarkColor, string> = {
  blue: "bg-[color-mix(in_oklab,var(--color-blue-400)_7%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-blue-400)_10%,var(--card))]",
  yellow:
    "bg-[color-mix(in_oklab,var(--color-yellow-400)_10%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-yellow-400)_13%,var(--card))]",
  red: "bg-[color-mix(in_oklab,var(--color-red-400)_7%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-red-400)_10%,var(--card))]",
  orange:
    "bg-[color-mix(in_oklab,var(--color-orange-400)_10%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-orange-400)_13%,var(--card))]",
  green:
    "bg-[color-mix(in_oklab,var(--color-green-400)_7%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-green-400)_10%,var(--card))]",
};

/** Same wash as {@link MARK_ROW}, driven by `group-hover` for the sticky cell. */
const MARK_STICKY: Record<AllocationMarkColor, string> = {
  blue: "bg-[color-mix(in_oklab,var(--color-blue-400)_7%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-blue-400)_10%,var(--card))]",
  yellow:
    "bg-[color-mix(in_oklab,var(--color-yellow-400)_10%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-yellow-400)_13%,var(--card))]",
  red: "bg-[color-mix(in_oklab,var(--color-red-400)_7%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-red-400)_10%,var(--card))]",
  orange:
    "bg-[color-mix(in_oklab,var(--color-orange-400)_10%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-orange-400)_13%,var(--card))]",
  green:
    "bg-[color-mix(in_oklab,var(--color-green-400)_7%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-green-400)_10%,var(--card))]",
};

const MARK_DOT: Record<AllocationMarkColor, string> = {
  blue: "bg-blue-400",
  yellow: "bg-yellow-400",
  red: "bg-red-400",
  orange: "bg-orange-400",
  green: "bg-green-400",
};

function initialFocusQuarters(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(FOCUS_QUARTERS_KEY) ?? "null",
    );

    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value) => typeof value === "string"));
    }
  } catch {
    // Storage is only a convenience; nothing is focused by default.
  }

  return new Set();
}

export function AllocationTable({
  rows,
  quarters,
  summary,
  visibleColumns,
  sort,
  onSort,
  freeOrder,
  onReorder,
  onEditTarget,
  onEditValue,
  onClearAnalysis,
  onRemoveAsset,
  onSetMarkColor,
  onSaveReview,
  onRemoveReview,
  missing,
  saving = false,
}: AllocationTableProps) {
  const { i18n } = useLingui();
  const labels = columnLabels(i18n);
  const visible = ALLOCATION_COLUMNS.filter((id) => visibleColumns.has(id));
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [focusQuarters, setFocusQuarters] =
    useState<Set<string>>(initialFocusQuarters);
  const highestScore = rows.reduce(
    (highest, row) => Math.max(highest, Number(row.score.value)),
    0,
  );

  /** Moves `ticker` to the slot currently held by `target`. */
  function move(ticker: string, target: string) {
    const order = rows.map((row) => row.ticker);
    const from = order.indexOf(ticker);
    const to = order.indexOf(target);

    if (from < 0 || to < 0 || from === to) {
      return;
    }

    order.splice(from, 1);
    order.splice(to, 0, ticker);
    onReorder(order);
  }

  function moveBy(ticker: string, offset: number) {
    const order = rows.map((row) => row.ticker);
    const from = order.indexOf(ticker);
    const target = order[from + offset];

    if (target !== undefined) {
      move(ticker, target);
    }
  }

  function toggleFocusQuarter(key: string) {
    setFocusQuarters((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      try {
        localStorage.setItem(FOCUS_QUARTERS_KEY, JSON.stringify([...next]));
      } catch {
        // The mark still applies for this session.
      }

      return next;
    });
  }

  return (
    <Card className="gap-0 overflow-hidden rounded-md py-0 shadow-none">
      <CardContent className="overflow-x-auto p-0">
        <Table className="text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 w-8 px-1" />
              {visible.map((id) => (
                <TableHead
                  key={id}
                  className={cn(
                    "h-10 px-2.5 whitespace-nowrap",
                    id === "ticker"
                      ? "sticky left-0 z-10 w-40 max-w-40 bg-muted/50"
                      : "text-right",
                  )}
                >
                  {freeOrder ? (
                    <span className="font-medium">{labels[id]}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSort(id)}
                      className={cn(
                        "flex w-full items-center gap-1 font-medium",
                        id !== "ticker" && "justify-end",
                      )}
                      aria-label={i18n._(
                        t({
                          id: "allocation.sortBy",
                          message: `Sort by ${labels[id]}`,
                        }),
                      )}
                    >
                      {labels[id]}
                      {sort.id === id ? (
                        sort.direction === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown
                          className="size-3 opacity-40"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  )}
                </TableHead>
              ))}
              {quarters.map((quarter) => {
                const focused = focusQuarters.has(quarter.key);

                return (
                  <TableHead
                    key={quarter.key}
                    className={cn(
                      "h-10 w-14 px-1 text-center whitespace-nowrap",
                      focused && FOCUS_QUARTER_COL,
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={focused}
                      onClick={() => toggleFocusQuarter(quarter.key)}
                      title={i18n._(
                        focused
                          ? t({
                              id: "allocation.unfocusQuarter",
                              message: `Stop marking ${formatQuarterLabel(quarter)} as the quarter you are working on`,
                            })
                          : t({
                              id: "allocation.focusQuarter",
                              message: `Mark ${formatQuarterLabel(quarter)} as the quarter you are working on`,
                            }),
                      )}
                      className={cn(
                        "w-full rounded-sm py-1 font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        focused && "text-blue-400",
                      )}
                    >
                      {formatQuarterLabel(quarter)}
                    </button>
                  </TableHead>
                );
              })}
              <TableHead className="h-10 w-8 px-1" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row, index) => {
              const reviewByPeriod = new Map<string, AssetReview>(
                row.reviews.map((review) => [review.period, review]),
              );
              const scoreValue = Number(row.score.value);

              return (
                <TableRow
                  key={row.ticker}
                  className={cn(
                    "group h-12",
                    row.markColor ? MARK_ROW[row.markColor] : undefined,
                    dragging === row.ticker && "opacity-50",
                    dropTarget === row.ticker && "border-t-2 border-t-ring",
                  )}
                  onDragOver={
                    freeOrder && row.ticker !== CASH_TICKER
                      ? (event) => {
                          event.preventDefault();
                          setDropTarget(row.ticker);
                        }
                      : undefined
                  }
                  onDragLeave={
                    freeOrder && row.ticker !== CASH_TICKER
                      ? () =>
                          setDropTarget((current) =>
                            current === row.ticker ? null : current,
                          )
                      : undefined
                  }
                  onDrop={
                    freeOrder && row.ticker !== CASH_TICKER
                      ? (event) => {
                          event.preventDefault();
                          setDropTarget(null);

                          if (dragging && dragging !== row.ticker) {
                            move(dragging, row.ticker);
                          }

                          setDragging(null);
                        }
                      : undefined
                  }
                >
                  <TableCell className="px-1.5 py-2.5">
                    {freeOrder && row.ticker !== CASH_TICKER ? (
                      <button
                        type="button"
                        draggable
                        onDragStart={() => setDragging(row.ticker)}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            moveBy(row.ticker, -1);
                          }

                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            moveBy(row.ticker, 1);
                          }
                        }}
                        aria-label={i18n._(
                          t({
                            id: "allocation.dragHandle",
                            message: `Reorder ${row.ticker}. Use the arrow keys to move it.`,
                          }),
                        )}
                        className="flex size-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
                      >
                        <GripVertical className="size-3.5" aria-hidden="true" />
                      </button>
                    ) : row.ticker === CASH_TICKER ? (
                      <span className="flex size-6 items-center justify-center text-xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          onSetMarkColor(
                            row.ticker,
                            nextAllocationMarkColor(row.markColor),
                          )
                        }
                        aria-label={i18n._(
                          t({
                            id: "allocation.cycleMark",
                            message: `Cycle highlight color for ${row.ticker}`,
                          }),
                        )}
                        title={i18n._(
                          t({
                            id: "allocation.cycleMarkHint",
                            message: "Click to cycle highlight color",
                          }),
                        )}
                        className="flex size-6 items-center justify-center rounded-sm text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {index + 1}
                      </button>
                    )}
                  </TableCell>

                  {visibleColumns.has("ticker") ? (
                    <TableCell
                      className={cn(
                        "sticky left-0 z-10 w-40 max-w-40 px-2.5 py-2.5",
                        row.markColor
                          ? MARK_STICKY[row.markColor]
                          : "bg-card group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <AssetLogo
                          ticker={row.ticker}
                          assetClass={row.assetClass}
                          currency={row.currency}
                        />
                        {row.ticker === CASH_TICKER ? (
                          <span className="min-w-0 truncate font-semibold">
                            <Trans id="allocation.cash">Cash</Trans>
                          </span>
                        ) : (
                          <Link
                            to="/assets/$ticker"
                            params={{ ticker: row.ticker }}
                            title={row.ticker}
                            className="min-w-0 truncate font-semibold hover:underline underline-offset-2"
                          >
                            {row.ticker}
                          </Link>
                        )}
                        {row.hasPosition ? null : (
                          <Badge
                            variant="outline"
                            className="h-4 shrink-0 px-1 text-[10px] font-normal"
                          >
                            <Trans id="allocation.watchBadge">Watch</Trans>
                          </Badge>
                        )}
                        {missing.includes(row.ticker) ? (
                          <TriangleAlert
                            className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                            aria-label={i18n._(
                              t({
                                id: "allocation.quoteMissing",
                                message: "No market quote for this ticker",
                              }),
                            )}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("targetWeight") ? (
                    <TableCell className="px-2.5 py-2.5">
                      {row.ticker === CASH_TICKER ? (
                        <span
                          className="block h-8 px-1.5 text-right text-sm tabular-nums leading-8"
                          title={i18n._(
                            t({
                              id: "allocation.cashTargetHint",
                              message:
                                "Automatically fills the part not assigned to other assets.",
                            }),
                          )}
                        >
                          {formatWeightPrecise(row.targetWeight ?? "0")}
                        </span>
                      ) : (
                        <InlineEditCell
                          display={
                            row.targetWeight === null
                              ? null
                              : formatWeightPrecise(row.targetWeight)
                          }
                          text={formatPercentInput(
                            row.targetWeight,
                            i18n.locale,
                          )}
                          label={i18n._(
                            t({
                              id: "allocation.editTarget",
                              message: `Target weight of ${row.ticker}, in percent`,
                            }),
                          )}
                          onCommit={(text) => onEditTarget(row.ticker, text)}
                        />
                      )}
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("currentWeight") ? (
                    <TableCell className="px-2.5 py-2.5 text-right tabular-nums">
                      {formatWeightPrecise(row.currentWeight)}
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("gapWeight") ? (
                    <TableCell className="px-2.5 py-2.5 text-right tabular-nums">
                      {row.gapWeight === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={pnlClassName(row.gapWeight)}>
                          {formatSignedWeightPrecise(row.gapWeight)}
                        </span>
                      )}
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("discount") ? (
                    <TableCell
                      className={cn(
                        "px-2.5 py-2.5 text-right tabular-nums",
                        row.discount === null
                          ? "text-muted-foreground"
                          : pnlClassName(row.discount),
                      )}
                      title={
                        row.fairValue === null
                          ? i18n._(
                              t({
                                id: "allocation.discountEmptyTooltip",
                                message:
                                  "Set a fair value on a quarterly review",
                              }),
                            )
                          : row.marketPrice === null
                            ? i18n._(
                                t({
                                  id: "allocation.discountTooltipFairOnly",
                                  message: `Fair value ${formatMoney(row.fairValue, row.currency)} (${row.fairValuePeriod ?? ""})`,
                                }),
                              )
                            : i18n._(
                                t({
                                  id: "allocation.discountTooltip",
                                  message: `Market ${formatMoney(row.marketPrice, row.currency)} vs fair value ${formatMoney(row.fairValue, row.currency)} (${row.fairValuePeriod ?? ""})`,
                                }),
                              )
                      }
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        {row.discount !== null
                          ? formatSignedWeightPrecise(row.discount)
                          : row.fairValue !== null
                            ? formatMoney(row.fairValue, row.currency)
                            : "—"}
                        {row.fairValueRef ? (
                          <a
                            href={row.fairValueRef}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={i18n._(
                              t({
                                id: "allocation.openFairValueRef",
                                message: `Open fair value reference for ${row.ticker}`,
                              }),
                            )}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ExternalLink
                              className="size-3"
                              aria-hidden="true"
                            />
                          </a>
                        ) : null}
                      </span>
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("score") ? (
                    <TableCell
                      className="px-2.5 py-2.5 text-right tabular-nums"
                      title={scoreReason(row, i18n)}
                    >
                      <ScoreCell
                        value={row.score.value}
                        blocked={row.score.blocked}
                        share={
                          highestScore > 0 && scoreValue > 0
                            ? scoreValue / highestScore
                            : 0
                        }
                      />
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("lastContributionAt") ? (
                    <TableCell className="px-2.5 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {row.lastContributionAt === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {row.score.cooldownUntil === null ? null : (
                            <Timer
                              className="size-3 text-muted-foreground"
                              aria-label={i18n._(
                                t({
                                  id: "allocation.cooldownIcon",
                                  message: `In cooldown until ${row.score.cooldownUntil}`,
                                }),
                              )}
                            />
                          )}
                          {formatTradeDate(row.lastContributionAt)}
                        </span>
                      )}
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("quantity") ? (
                    <TableCell className="px-2.5 py-2.5 text-right tabular-nums">
                      {row.assetClass === "cash" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : row.hasPosition ? (
                        formatQuantity(row.quantity)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("marketValue") ? (
                    <TableCell className="px-2.5 py-2.5">
                      {row.valueSource === "quote" &&
                      row.marketValue !== null ? (
                        <span
                          className="block h-8 px-1.5 text-right text-sm tabular-nums leading-8"
                          title={i18n._(
                            t({
                              id: "allocation.valueQuotedTooltip",
                              message: "Quantity × market price",
                            }),
                          )}
                        >
                          {formatMoney(row.marketValue, row.displayCurrency)}
                        </span>
                      ) : row.hasPosition ? (
                        <InlineEditCell
                          display={
                            row.marketValue === null
                              ? null
                              : formatMoney(
                                  row.marketValue,
                                  row.displayCurrency,
                                )
                          }
                          text={formatDecimalInput(
                            row.marketValue,
                            i18n.locale,
                          )}
                          label={i18n._(
                            t({
                              id: "allocation.editValue",
                              message: `Market value of ${row.ticker}`,
                            }),
                          )}
                          title={
                            row.assetClass === "cash"
                              ? i18n._(
                                  t({
                                    id: "allocation.cashValueHint",
                                    message:
                                      "Cash is entered manually and included in total net worth.",
                                  }),
                                )
                              : row.valueSource === "manual"
                                ? i18n._(
                                    t({
                                      id: "allocation.valueManualTooltip",
                                      message:
                                        "No public quote. This value is set by you. Clear the cell to remove it.",
                                    }),
                                  )
                                : i18n._(
                                    t({
                                      id: "allocation.valueMissingTooltip",
                                      message:
                                        "No public quote. Enter the position's market value.",
                                    }),
                                  )
                          }
                          placeholder={i18n._(
                            t({
                              id: "allocation.valuePlaceholder",
                              message: "Set value",
                            }),
                          )}
                          onCommit={(text) => onEditValue(row.ticker, text)}
                        />
                      ) : (
                        <span className="block h-8 px-1.5 text-right text-sm leading-8 text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("averageGrade") ? (
                    <TableCell className="px-2.5 py-2.5 text-right tabular-nums">
                      {row.averageGrade === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          title={i18n._(
                            t({
                              id: "allocation.gradeTooltip",
                              message: `Average of ${row.gradedQuarters} graded quarters`,
                            }),
                          )}
                        >
                          {formatDecimalInput(row.averageGrade, i18n.locale)}
                        </span>
                      )}
                    </TableCell>
                  ) : null}

                  {quarters.map((quarter) => (
                    <TableCell
                      key={quarter.key}
                      className={cn(
                        "px-1.5 py-2.5",
                        focusQuarters.has(quarter.key) && FOCUS_QUARTER_COL,
                      )}
                    >
                      {row.ticker === CASH_TICKER ? (
                        <span className="block text-center text-muted-foreground">
                          —
                        </span>
                      ) : (
                        <QuarterReviewCell
                          ticker={row.ticker}
                          quarter={quarter}
                          review={reviewByPeriod.get(quarter.key)}
                          saving={saving}
                          onSave={onSaveReview}
                          onRemove={onRemoveReview}
                        />
                      )}
                    </TableCell>
                  ))}

                  <TableCell className="px-1.5 py-2.5">
                    {row.ticker === CASH_TICKER ? null : (
                      <RowMenu
                        row={row}
                        freeOrder={freeOrder}
                        onMove={(offset) => moveBy(row.ticker, offset)}
                        onClear={() => onClearAnalysis(row.ticker)}
                        onRemove={() => onRemoveAsset(row)}
                        onSetMarkColor={(markColor) =>
                          onSetMarkColor(row.ticker, markColor)
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}

            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visible.length + quarters.length + 2}
                  className="h-28 text-center text-sm text-muted-foreground"
                >
                  <Trans id="allocation.empty">
                    Nothing to allocate yet. Register a trade or add an asset to
                    follow.
                  </Trans>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>

          {rows.length > 0 && summary ? (
            <TableFooter>
              <TableRow>
                <TableCell className="px-1.5 py-2.5" />
                {visible.map((id) => {
                  if (id === "ticker") {
                    return (
                      <TableCell
                        key={id}
                        className="sticky left-0 z-10 w-40 max-w-40 bg-muted px-2.5 py-2.5 font-medium"
                      >
                        <Trans id="allocation.total">Total</Trans>
                      </TableCell>
                    );
                  }

                  if (id === "targetWeight") {
                    return (
                      <TableCell
                        key={id}
                        className="px-2.5 py-2.5 text-right tabular-nums"
                      >
                        {formatWeightPrecise(summary.totalTargetWeight)}
                      </TableCell>
                    );
                  }

                  if (id === "currentWeight") {
                    return (
                      <TableCell
                        key={id}
                        className="px-2.5 py-2.5 text-right tabular-nums"
                      >
                        {formatWeightPrecise(summary.totalCurrentWeight)}
                      </TableCell>
                    );
                  }

                  if (id === "marketValue") {
                    return (
                      <TableCell
                        key={id}
                        className="px-2.5 py-2.5 text-right tabular-nums"
                      >
                        {formatMoney(
                          summary.totalMarketValue,
                          summary.displayCurrency,
                        )}
                      </TableCell>
                    );
                  }

                  if (id === "discount") {
                    return (
                      <TableCell
                        key={id}
                        className={cn(
                          "px-2.5 py-2.5 text-right tabular-nums",
                          summary.averageDiscount === null
                            ? "text-muted-foreground"
                            : pnlClassName(summary.averageDiscount),
                        )}
                      >
                        {summary.averageDiscount === null
                          ? "—"
                          : formatSignedWeightPrecise(summary.averageDiscount)}
                      </TableCell>
                    );
                  }

                  return <TableCell key={id} />;
                })}
                {quarters.map((quarter) => (
                  <TableCell
                    key={quarter.key}
                    className={
                      focusQuarters.has(quarter.key)
                        ? FOCUS_QUARTER_COL
                        : undefined
                    }
                  />
                ))}
                <TableCell />
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </CardContent>
    </Card>
  );
}

/** Score with a proportional bar, so the ranking is readable at a glance. */
function ScoreCell({
  value,
  blocked,
  share,
}: {
  value: string;
  blocked: boolean;
  share: number;
}) {
  const numeric = Number(value);

  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-foreground/60"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </span>
      <span
        className={cn(
          "w-14 text-right",
          numeric > 0 && "font-medium",
          numeric < 0 && "text-loss",
          numeric === 0 && "text-muted-foreground",
        )}
      >
        {blocked ? "—" : formatSignedWeightPrecise(value)}
      </span>
    </div>
  );
}

function RowMenu({
  row,
  freeOrder,
  onMove,
  onClear,
  onRemove,
  onSetMarkColor,
}: {
  row: AllocationRow;
  freeOrder: boolean;
  onMove: (offset: number) => void;
  onClear: () => void;
  onRemove: () => void;
  onSetMarkColor: (markColor: AllocationMarkColor | null) => void;
}): ReactNode {
  const { i18n } = useLingui();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
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
        <DropdownMenuItem asChild>
          <Link to="/assets/$ticker" params={{ ticker: row.ticker }}>
            <Eye aria-hidden="true" />
            <Trans id="allocation.viewDetails">View details</Trans>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          <Trans id="allocation.markColor">Highlight</Trans>
        </DropdownMenuLabel>
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          {ALLOCATION_MARK_COLORS.map((color) => {
            const selected = row.markColor === color;

            return (
              <button
                key={color}
                type="button"
                aria-label={i18n._(
                  t({
                    id: "allocation.markAs",
                    message: `Mark ${row.ticker} ${color}`,
                  }),
                )}
                aria-pressed={selected}
                onClick={() => onSetMarkColor(color)}
                className={cn(
                  "flex size-5 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected &&
                    "ring-2 ring-foreground/40 ring-offset-1 ring-offset-popover",
                )}
              >
                <span
                  className={cn("size-3.5 rounded-full", MARK_DOT[color])}
                  aria-hidden="true"
                />
              </button>
            );
          })}
          <button
            type="button"
            aria-label={i18n._(
              t({
                id: "allocation.clearMark",
                message: `Clear highlight on ${row.ticker}`,
              }),
            )}
            disabled={row.markColor === null}
            onClick={() => onSetMarkColor(null)}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <DropdownMenuSeparator />
        {freeOrder ? (
          <>
            <DropdownMenuItem onSelect={() => onMove(-1)}>
              <ChevronUp aria-hidden="true" />
              <Trans id="allocation.moveUp">Move up</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(1)}>
              <ChevronDown aria-hidden="true" />
              <Trans id="allocation.moveDown">Move down</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={onClear} disabled={!row.tracked}>
          <Eraser aria-hidden="true" />
          <Trans id="allocation.clearAnalysis">Clear target</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={onRemove}
          disabled={row.hasPosition || !row.tracked}
        >
          <Trash2 aria-hidden="true" />
          <Trans id="allocation.removeAsset">Stop following</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
