import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type { AllocationRow } from "@portifolio-tracker/shared";
import {
  formatMultiplier,
  formatWeightPrecise,
  pnlClassName,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/** Factors closer than this to ×1 are not worth a chip. */
const VISIBLE_FACTOR = 0.005;
/** Adjusted targets closer than this to the target read as unchanged. */
const VISIBLE_WEIGHT = 0.00005;

function moved(factor: string | null): factor is string {
  return factor !== null && Math.abs(Number(factor) - 1) >= VISIBLE_FACTOR;
}

/** Plain-language breakdown of how the target was adjusted. */
export function adjustedTargetExplanation(
  row: AllocationRow,
  i18n: I18n,
): string {
  const { score } = row;

  if (row.targetWeight === null || score.tiltedTarget === null) {
    return i18n._(
      t({
        id: "allocation.adjustedTargetNone",
        message: "No target, so nothing to adjust.",
      }),
    );
  }

  // Without a year of prices the asset has no trend of its own: its second
  // factor only rebalances the book around the other assets' trends.
  return score.momentumZ === null
    ? i18n._(
        t({
          id: "allocation.adjustedTargetExplainNoTrend",
          message: `Target ${formatWeightPrecise(row.targetWeight)} × valuation ${formatMultiplier(score.valuationTilt ?? "1")} × book rebalance ${formatMultiplier(score.momentumTilt ?? "1")} = ${formatWeightPrecise(score.tiltedTarget)}. This asset has no 12-month trend; the rebalance only keeps the targets summing up while other assets follow theirs.`,
        }),
      )
    : i18n._(
        t({
          id: "allocation.adjustedTargetExplain",
          message: `Target ${formatWeightPrecise(row.targetWeight)} × valuation ${formatMultiplier(score.valuationTilt ?? "1")} × 12-month trend ${formatMultiplier(score.momentumTilt ?? "1")} = ${formatWeightPrecise(score.tiltedTarget)}. Valuation shares weight only among assets with a fair value; the trend is a light tie-breaker across the book.`,
        }),
      );
}

/**
 * The target the score actually aims for, with the valuation and trend
 * factors spelled out so the adjustment is never hidden.
 */
export function AdjustedTargetCell({
  row,
  i18n,
}: {
  row: AllocationRow;
  i18n: I18n;
}) {
  const { score } = row;

  if (row.targetWeight === null || score.tiltedTarget === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const delta = String(Number(score.tiltedTarget) - Number(row.targetWeight));
  const changed = Math.abs(Number(delta)) >= VISIBLE_WEIGHT;
  const chips: string[] = [];

  if (moved(score.valuationTilt)) {
    chips.push(
      i18n._(
        t({
          id: "allocation.adjustedTargetValuation",
          message: `val ${formatMultiplier(score.valuationTilt)}`,
        }),
      ),
    );
  }
  if (moved(score.momentumTilt) && score.momentumZ !== null) {
    chips.push(
      i18n._(
        t({
          id: "allocation.adjustedTargetTrend",
          message: `trend ${formatMultiplier(score.momentumTilt)}`,
        }),
      ),
    );
  }
  // Small factors can still add up to a visible change; show their product
  // rather than claim nothing moved.
  if (changed && chips.length === 0 && score.tilt !== null) {
    chips.push(formatMultiplier(score.tilt));
  }

  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={cn("tabular-nums", changed && pnlClassName(delta))}>
        {formatWeightPrecise(score.tiltedTarget)}
      </span>
      <span className="text-[10px] whitespace-nowrap text-muted-foreground">
        {chips.length > 0
          ? chips.join(" · ")
          : i18n._(
              t({
                id: "allocation.adjustedTargetUnchanged",
                message: "no change",
              }),
            )}
      </span>
    </span>
  );
}
