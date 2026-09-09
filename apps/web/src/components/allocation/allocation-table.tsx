import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  AllocationMarkColor,
  AllocationRow,
  AllocationSummary,
  AssetReview,
  NextResult,
} from "@portifolio-tracker/shared";
import {
  CASH_TICKER,
  nextAllocationMarkColor,
} from "@portifolio-tracker/shared";
import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  GripVertical,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { AssetLogo } from "@/components/asset-logo";
import { ExternalAssetLinksMenu } from "@/components/external-asset-links-menu";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  formatMoney,
  formatQuantity,
  formatSignedWeightPrecise,
  formatTradeDate,
  formatWeightPrecise,
  pnlClassName,
} from "@/lib/format";
import { formatDecimalInput, formatPercentInput } from "@/lib/numeric-input";
import { formatQuarterLabel, type Quarter, shiftQuarter } from "@/lib/quarters";
import { cn } from "@/lib/utils";
import { InlineEditCell } from "./inline-edit-cell";
import { QuarterReviewCell } from "./quarter-review-cell";
import {
  ALLOCATION_COLUMNS,
  type AllocationColumn,
  type AllocationSort,
  columnLabels,
} from "./table/columns";
import {
  FOCUS_QUARTER_COL,
  FOCUS_QUARTERS_KEY,
  initialFocusQuarters,
  MARK_ROW,
  MARK_STICKY,
} from "./table/marks";
import { RowMenu } from "./table/row-menu";
import { ScoreCell } from "./table/score-cell";
import { resultDateTitle, scoreReason } from "./table/score-reason";

export {
  ALLOCATION_COLUMNS,
  type AllocationColumn,
  type AllocationSort,
  columnLabels,
  defaultSortDirection,
  type SortDirection,
} from "./table/columns";
export { scoreReason } from "./table/score-reason";
export { compareRows, sortableValue } from "./table/sorting";
export { summarizeVisibleRows } from "./table/summary";

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
    watchNext: boolean;
  }) => void;
  onRemoveReview: (input: { ticker: string; period: string }) => void;
  missing: string[];
  nextResults: ReadonlyMap<string, NextResult>;
  nextResultsLoading?: boolean;
  saving?: boolean;
};

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
  nextResults,
  nextResultsLoading = false,
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
                      ? "sticky left-0 z-10 w-52 max-w-52 bg-muted/50"
                      : "text-right",
                  )}
                  aria-sort={
                    freeOrder
                      ? undefined
                      : sort.id === id
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                  }
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
              const nextResult = nextResults.get(row.ticker.toUpperCase());
              const supportsNextResult =
                row.assetClass === "stock_br" || row.assetClass === "stock_us";

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
                        "sticky left-0 z-10 w-52 max-w-52 px-2.5 py-2.5",
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
                        {row.ticker === CASH_TICKER ? null : (
                          <ExternalAssetLinksMenu
                            ticker={row.ticker}
                            assetClass={row.assetClass}
                            currency={row.currency}
                            className="shrink-0 opacity-60 transition-opacity focus:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                          />
                        )}
                        {row.hasPosition ? null : (
                          <Badge
                            variant="outline"
                            className="ml-auto h-4 shrink-0 px-1 text-[10px] font-normal"
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

                  {visibleColumns.has("nextResult") ? (
                    <TableCell
                      className="px-2.5 py-2.5 text-right whitespace-nowrap tabular-nums"
                      title={
                        nextResult
                          ? resultDateTitle(nextResult, i18n)
                          : supportsNextResult && !nextResultsLoading
                            ? i18n._(
                                t({
                                  id: "allocation.resultUnavailable",
                                  message:
                                    "Result date temporarily unavailable",
                                }),
                              )
                            : undefined
                      }
                    >
                      {nextResultsLoading && supportsNextResult ? (
                        <Skeleton className="ml-auto h-4 w-20" />
                      ) : nextResult ? (
                        formatTradeDate(nextResult.date)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
                          watched={
                            reviewByPeriod.get(shiftQuarter(quarter, -1).key)
                              ?.watchNext === true
                          }
                          watchedGrade={
                            reviewByPeriod.get(shiftQuarter(quarter, -1).key)
                              ?.grade ?? null
                          }
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
                        className="sticky left-0 z-10 w-52 max-w-52 bg-muted px-2.5 py-2.5 font-medium"
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
