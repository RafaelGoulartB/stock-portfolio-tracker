import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type { AllocationRow, NextResult } from "@portifolio-tracker/shared";
import { formatWeightPrecise } from "@/lib/format";

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
