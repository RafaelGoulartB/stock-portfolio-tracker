import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  AllocationRow,
  AllocationSummary,
  AssetReview,
} from "@portifolio-tracker/shared";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Eraser,
  GripVertical,
  MoreVertical,
  Timer,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  "fairValue",
  "averageGrade",
] as const;

export type AllocationColumn = (typeof ALLOCATION_COLUMNS)[number];
export type SortDirection = "asc" | "desc";
export type AllocationSort = { id: AllocationColumn; direction: SortDirection };

/** Columns that read better ascending on first click. */
const ASCENDING_FIRST: AllocationColumn[] = [
  "ticker",
  "lastContributionAt",
];

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
    fairValue: i18n._(
      t({ id: "allocation.colFairValue", message: "Fair value" }),
    ),
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
    case "fairValue":
      return row.fairValue === null ? null : Number(row.fairValue);
  }
}

/** Rows with no value for the sorted column always sink to the bottom. */
export function compareRows(
  a: AllocationRow,
  b: AllocationRow,
  sort: AllocationSort,
): number {
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

/** Plain-language reason behind a score, shown on hover. */
function scoreReason(row: AllocationRow, i18n: I18n): string {
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
  onEditFairValue: (ticker: string, text: string) => void;
  onClearAnalysis: (ticker: string) => void;
  onRemoveAsset: (row: AllocationRow) => void;
  onSaveReview: (input: {
    ticker: string;
    period: string;
    grade: string | null;
    notes: string | null;
  }) => void;
  onRemoveReview: (input: { ticker: string; period: string }) => void;
  missing: string[];
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
  onEditFairValue,
  onClearAnalysis,
  onRemoveAsset,
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
                      ? "sticky left-0 z-10 bg-muted/50"
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
              {quarters.map((quarter) => (
                <TableHead
                  key={quarter.key}
                  className="h-10 w-14 px-1 text-center font-medium whitespace-nowrap"
                >
                  {formatQuarterLabel(quarter)}
                </TableHead>
              ))}
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
                    "h-12",
                    dragging === row.ticker && "opacity-50",
                    dropTarget === row.ticker && "border-t-2 border-t-ring",
                  )}
                  onDragOver={
                    freeOrder
                      ? (event) => {
                          event.preventDefault();
                          setDropTarget(row.ticker);
                        }
                      : undefined
                  }
                  onDragLeave={
                    freeOrder
                      ? () =>
                          setDropTarget((current) =>
                            current === row.ticker ? null : current,
                          )
                      : undefined
                  }
                  onDrop={
                    freeOrder
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
                    {freeOrder ? (
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
                    ) : (
                      <span className="flex size-6 items-center justify-center text-xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                    )}
                  </TableCell>

                  {visibleColumns.has("ticker") ? (
                    <TableCell className="sticky left-0 z-10 bg-card px-2.5 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{row.ticker}</span>
                        {row.hasPosition ? null : (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[10px] font-normal"
                          >
                            <Trans id="allocation.watchBadge">Watch</Trans>
                          </Badge>
                        )}
                        {missing.includes(row.ticker) ? (
                          <TriangleAlert
                            className="size-3 text-amber-600 dark:text-amber-400"
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
                      <InlineEditCell
                        display={
                          row.targetWeight === null
                            ? null
                            : formatWeightPrecise(row.targetWeight)
                        }
                        text={formatPercentInput(row.targetWeight, i18n.locale)}
                        label={i18n._(
                          t({
                            id: "allocation.editTarget",
                            message: `Target weight of ${row.ticker}, in percent`,
                          }),
                        )}
                        onCommit={(text) => onEditTarget(row.ticker, text)}
                      />
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
                    <TableCell className="px-2.5 py-2.5">
                      <InlineEditCell
                        display={
                          row.discount !== null
                            ? formatSignedWeightPrecise(row.discount)
                            : row.fairValue !== null
                              ? formatMoney(row.fairValue, row.currency)
                              : null
                        }
                        text={formatDecimalInput(row.fairValue, i18n.locale)}
                        label={i18n._(
                          t({
                            id: "allocation.editFairValue",
                            message: `Fair value of ${row.ticker} in ${row.currency}`,
                          }),
                        )}
                        placeholder={i18n._(
                          t({
                            id: "allocation.fairValuePlaceholder",
                            message: "Fair value",
                          }),
                        )}
                        className={
                          row.discount === null
                            ? ""
                            : pnlClassName(row.discount)
                        }
                        title={
                          row.fairValue === null
                            ? undefined
                            : row.marketPrice === null
                              ? i18n._(
                                  t({
                                    id: "allocation.discountTooltipFairOnly",
                                    message: `Fair value ${formatMoney(row.fairValue, row.currency)}`,
                                  }),
                                )
                              : i18n._(
                                  t({
                                    id: "allocation.discountTooltip",
                                    message: `Market ${formatMoney(row.marketPrice, row.currency)} vs fair value ${formatMoney(row.fairValue, row.currency)}`,
                                  }),
                                )
                        }
                        onCommit={(text) => onEditFairValue(row.ticker, text)}
                      />
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
                      {row.hasPosition ? (
                        formatQuantity(row.quantity)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("marketValue") ? (
                    <TableCell className="px-2.5 py-2.5 text-right tabular-nums">
                      {row.marketValue === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatMoney(row.marketValue, row.displayCurrency)
                      )}
                    </TableCell>
                  ) : null}

                  {visibleColumns.has("fairValue") ? (
                    <TableCell className="px-2.5 py-2.5">
                      <InlineEditCell
                        display={
                          row.fairValue === null
                            ? null
                            : formatMoney(row.fairValue, row.currency)
                        }
                        text={formatDecimalInput(row.fairValue, i18n.locale)}
                        label={i18n._(
                          t({
                            id: "allocation.editFairValue",
                            message: `Fair value of ${row.ticker} in ${row.currency}`,
                          }),
                        )}
                        onCommit={(text) => onEditFairValue(row.ticker, text)}
                      />
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
                    <TableCell key={quarter.key} className="px-1.5 py-2.5">
                      <QuarterReviewCell
                        ticker={row.ticker}
                        quarter={quarter}
                        review={reviewByPeriod.get(quarter.key)}
                        saving={saving}
                        onSave={onSaveReview}
                        onRemove={onRemoveReview}
                      />
                    </TableCell>
                  ))}

                  <TableCell className="px-1.5 py-2.5">
                    <RowMenu
                      row={row}
                      freeOrder={freeOrder}
                      onMove={(offset) => moveBy(row.ticker, offset)}
                      onClear={() => onClearAnalysis(row.ticker)}
                      onRemove={() => onRemoveAsset(row)}
                    />
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
                        className="sticky left-0 z-10 bg-muted px-2.5 py-2.5 font-medium"
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

                  return <TableCell key={id} />;
                })}
                {quarters.map((quarter) => (
                  <TableCell key={quarter.key} />
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
}: {
  row: AllocationRow;
  freeOrder: boolean;
  onMove: (offset: number) => void;
  onClear: () => void;
  onRemove: () => void;
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
          <Trans id="allocation.clearAnalysis">Clear target & fair value</Trans>
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
