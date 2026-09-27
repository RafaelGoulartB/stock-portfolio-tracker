import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type { AllocationRow, NextResult } from "@portifolio-tracker/shared";
import {
  formatMultiplier,
  formatSignedWeightPrecise,
  formatWeightPrecise,
} from "@/lib/format";
import { formatQuarterTitle, toQuarter } from "@/lib/quarters";

/**
 * Warning that the price drifted far enough from the fair value's reference
 * close to warrant a fresh valuation, or `null` when no review is suggested.
 */
export function reviewNote(row: AllocationRow, i18n: I18n): string | null {
  const drift = row.score.priceSinceFairValue;
  if (!row.score.reviewSuggested || drift === null) return null;

  const period = row.fairValuePeriod
    ? formatQuarterTitle(toQuarter(row.fairValuePeriod))
    : "";

  return i18n._(
    t({
      id: "allocation.reviewSuggested",
      message: `Price moved ${formatSignedWeightPrecise(drift)} since the ${period} fair value: redo the valuation from scratch`,
    }),
  );
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
    case "no-quote":
      return i18n._(
        t({
          id: "allocation.reasonNoQuote",
          message:
            "No live or manual price, so its weight is unknown. Set a manual value to score it.",
        }),
      );
    case "trim-overweight":
      return i18n._(
        t({
          id: "allocation.reasonTrimV2",
          message: `Expensive and past the tolerance band around its valuation-adjusted target of ${weight(score.tiltedTarget)}: consider trimming instead of buying.`,
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
          id: "allocation.reasonCooldownV2",
          message: `Bought recently: priority ${formatMultiplier(score.recencyMultiplier)} until ${score.cooldownUntil ?? ""}. ${weight(score.relativeGap)} of its valuation-adjusted target is still missing.`,
        }),
      );
    case "gap-weighted":
      if (score.relativeGap === null || Number(score.relativeGap) <= 0) {
        return i18n._(
          t({
            id: "allocation.reasonAtTarget",
            message: `At or above its valuation-adjusted target of ${weight(score.tiltedTarget)}.`,
          }),
        );
      }

      return i18n._(
        t({
          id: "allocation.reasonGapV3",
          message: `Target ${weight(row.targetWeight)} adjusted to ${weight(score.tiltedTarget)} (valuation ${formatMultiplier(score.valuationTilt ?? "1")}, trend ${formatMultiplier(score.momentumTilt ?? "1")}); ${formatWeightPrecise(row.currentWeight)} held leaves ${weight(score.relativeGap)} of it missing, at priority ${formatMultiplier(score.priority)}.`,
        }),
      );
  }
}

function weight(value: string | null): string {
  return value === null ? "—" : formatWeightPrecise(value);
}

export function resultDateTitle(
  result: NextResult | undefined,
  i18n: I18n,
): string | undefined {
  if (!result) return undefined;

  const source =
    result.source === "cvm_b3"
      ? i18n._(t({ id: "allocation.resultSourceCvm", message: "CVM/B3" }))
      : result.source === "alpha_vantage"
        ? i18n._(
            t({
              id: "allocation.resultSourceAlpha",
              message: "Alpha Vantage",
            }),
          )
        : i18n._(
            t({ id: "allocation.resultSourceYahoo", message: "Yahoo Finance" }),
          );
  const details = [source, result.period].filter(Boolean);

  if (result.estimated) {
    details.push(
      i18n._(
        t({ id: "allocation.resultEstimated", message: "Estimated date" }),
      ),
    );
  }

  return details.join(" · ");
}
