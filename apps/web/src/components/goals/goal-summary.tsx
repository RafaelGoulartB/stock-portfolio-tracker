import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Stat, StatStrip } from "@/components/analysis/primitives";
import { formatMoney, formatPercentAxis, formatWeight } from "@/lib/format";
import { durationLabel, type GoalOverview, monthKeyLabel } from "./types";

/** The goal, how far today's value is from it, and when it is reached. */
export function GoalSummary({ overview }: { overview: GoalOverview }) {
  const { i18n } = useLingui();
  const projection = overview.projection;
  const goal = overview.goal;

  if (!projection || !goal) {
    return null;
  }

  const currency = overview.displayCurrency;
  const progress = Math.min(1, Math.max(0, Number(projection.progress)));
  const withdrawal = formatPercentAxis(Number(goal.withdrawalRate));
  const income = formatMoney(projection.targetMonthlyIncome, currency);
  const base = projection.scenarios.find((entry) => entry.scenario === "base");
  const baseReturn = base ? formatPercentAxis(Number(base.annualReturn)) : "";
  const targetMonth = goal.targetMonth
    ? monthKeyLabel(goal.targetMonth, i18n.locale)
    : null;

  return (
    <StatStrip
      className="sm:grid-cols-2 xl:grid-cols-4"
      footer={
        overview.unquotedPositions > 0
          ? i18n._(
              t({
                id: "goals.unquoted",
                message: plural(
                  { count: overview.unquotedPositions },
                  {
                    one: "# asset without a quote is left out of today's value.",
                    other:
                      "# assets without a quote are left out of today's value.",
                  },
                ),
              }),
            )
          : undefined
      }
    >
      <Stat
        label={<Trans id="goals.target">Goal</Trans>}
        value={formatMoney(projection.targetValue, currency)}
        hint={
          <Trans id="goals.targetHint">
            Pays {income} a month at a {withdrawal} yearly withdrawal.
          </Trans>
        }
      />
      <Stat
        label={<Trans id="goals.today">Portfolio today</Trans>}
        value={formatMoney(overview.currentValue, currency)}
        hint={
          <Trans id="goals.progressHint">
            {formatWeight(projection.progress)} of the goal.
          </Trans>
        }
      >
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label={i18n._(
            t({ id: "goals.progressLabel", message: "Progress to the goal" }),
          )}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </Stat>
      <Stat
        label={<Trans id="goals.incomeToday">Income it pays today</Trans>}
        value={
          <Trans id="goals.perMonthValue">
            {formatMoney(projection.sustainableMonthlyIncome, currency)}/mo
          </Trans>
        }
        hint={
          <Trans id="goals.incomeTodayHint">
            At the same {withdrawal} withdrawal, of {income} wanted.
          </Trans>
        }
      />
      <Stat
        label={<Trans id="goals.baseReach">Base scenario reaches it</Trans>}
        value={
          base?.monthsToTarget === 0 ? (
            <Trans id="goals.reached">Reached</Trans>
          ) : base?.reachMonth ? (
            monthKeyLabel(base.reachMonth, i18n.locale)
          ) : (
            <Trans id="goals.notReached">Beyond 60 years</Trans>
          )
        }
        hint={
          <span className="space-y-0.5">
            {base?.monthsToTarget ? (
              <span className="block">
                <Trans id="goals.reachIn">
                  In {durationLabel(base.monthsToTarget, i18n)}, at {baseReturn}{" "}
                  real a year.
                </Trans>
              </span>
            ) : null}
            {targetMonth && base?.onTrack != null ? (
              <span
                className={
                  base.onTrack
                    ? "flex items-center gap-1 text-gain"
                    : "flex items-center gap-1 text-loss"
                }
              >
                {base.onTrack ? (
                  <CircleCheck className="size-3.5" aria-hidden="true" />
                ) : (
                  <CircleAlert className="size-3.5" aria-hidden="true" />
                )}
                {base.onTrack ? (
                  <Trans id="goals.onTrack">On track for {targetMonth}.</Trans>
                ) : (
                  <Trans id="goals.behind">
                    Behind the {targetMonth} target.
                  </Trans>
                )}
              </span>
            ) : null}
          </span>
        }
      />
    </StatStrip>
  );
}
