import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { ScoreConfig, ValuationSkill } from "@portifolio-tracker/shared";
import { Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatMultiplier, formatWeight } from "@/lib/format";
import { formatDecimalInput } from "@/lib/numeric-input";

type SkillState = "learning" | "right" | "neutral" | "wrong";

function skillState(skill: ValuationSkill, config: ScoreConfig): SkillState {
  if (skill.pairs === 0) return "learning";
  if (Number(skill.shrunkIc) < 0) return "wrong";
  if (Number(skill.confidence) >= Number(config.sellConfidence)) return "right";
  return "neutral";
}

/**
 * Shows how much the score currently trusts the investor's fair values and
 * why, together with the other active adjustments, so nothing about the
 * target tilts happens out of sight. Lives in the score documentation, next
 * to the knobs it explains, so it never pushes the allocation table down.
 */
export function ValuationSkillCard({
  skill,
  config,
}: {
  skill: ValuationSkill;
  config: ScoreConfig;
}) {
  const { i18n } = useLingui();
  const state = skillState(skill, config);
  const confidence = Number(skill.confidence);
  const maxStrength = Number(config.valuationSensitivity);
  const strength = formatDecimalInput(
    Number(skill.strength).toFixed(2),
    i18n.locale,
  );
  const maxLabel = formatDecimalInput(maxStrength.toFixed(2), i18n.locale);
  const trendRange = `${formatMultiplier(String(Math.exp(-Number(config.momentumWeight) * Number(config.momentumZCap))))}–${formatMultiplier(String(Math.exp(Number(config.momentumWeight) * Number(config.momentumZCap))))}`;
  const drift = formatWeight(config.reviewDrift);
  const sellBar = formatWeight(config.sellConfidence);

  return (
    <Card className="gap-0 py-0">
      <CardContent className="grid gap-4 px-5 py-4">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Target
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold">
              <Trans id="allocation.skill.title">
                Does your valuation work?
              </Trans>
            </h2>
            <Badge variant={state === "wrong" ? "destructive" : "secondary"}>
              {state === "learning" ? (
                <Trans id="allocation.skill.learning">Learning</Trans>
              ) : state === "right" ? (
                <Trans id="allocation.skill.right">Proven</Trans>
              ) : state === "wrong" ? (
                <Trans id="allocation.skill.wrong">
                  Not anticipating returns
                </Trans>
              ) : (
                <Trans id="allocation.skill.neutral">Inconclusive</Trans>
              )}
            </Badge>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.round(confidence * 100)}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {state === "learning" ? (
              <Trans id="allocation.skill.learningText">
                Confidence {formatWeight(skill.confidence)}: no fair value has a
                12-month outcome yet ({skill.pending} waiting). Until then the
                valuation weighs at strength {strength} of {maxLabel}, and sales
                stay informational.
              </Trans>
            ) : (
              <Trans id="allocation.skill.trackText">
                Confidence {formatWeight(skill.confidence)} from {skill.pairs}{" "}
                reviews with a 12-month outcome across {skill.periods} quarters
                (IC {skill.ic ?? "—"}). Valuation strength is {strength} of{" "}
                {maxLabel}.
              </Trans>
            )}
          </p>
        </div>
        <ul className="grid gap-1.5 text-xs text-muted-foreground">
          <li>
            <Trans id="allocation.skill.ruleValuation">
              <strong className="text-foreground">Valuation:</strong> target ×
              (fair value ÷ price)^{strength}, shared only among assets with a
              fair value.
            </Trans>
          </li>
          <li>
            <Trans id="allocation.skill.ruleTrend">
              <strong className="text-foreground">12-month trend:</strong> a
              light tie-breaker from {trendRange}; falling assets remain
              candidates.
            </Trans>
          </li>
          <li>
            <Trans id="allocation.skill.ruleReview">
              <strong className="text-foreground">Review:</strong> ↻ marks
              prices that moved more than {drift} since their fair value.
            </Trans>
          </li>
          <li>
            <Trans id="allocation.skill.ruleSales">
              <strong className="text-foreground">Sales:</strong> recommended
              only from {sellBar} confidence; before that they are shown for
              information.
            </Trans>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
