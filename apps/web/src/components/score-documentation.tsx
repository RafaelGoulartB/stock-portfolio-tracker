import { zodResolver } from "@hookform/resolvers/zod";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  DEFAULT_SCORE_CONFIG,
  type ScoreConfig,
  type ScoreConfigUpdate,
  scoreConfigUpdateSchema,
} from "@portifolio-tracker/shared";
import {
  ArrowRight,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Target,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import {
  useFieldArray,
  useForm,
  useFormContext,
  useWatch,
} from "react-hook-form";
import { toast } from "sonner";
import { ValuationSkillCard } from "@/components/allocation/valuation-skill-card";
import {
  Callout,
  DocumentBody,
  Formula,
  Rule,
  Topic,
} from "@/components/documentation-primitives";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllocationListInput } from "@/lib/allocation-query";
import { trpc } from "@/lib/api";
import {
  formatDecimalInput,
  formatPercentInput,
  parseDecimalInput,
  parsePercentInput,
} from "@/lib/numeric-input";

function withoutVersion(config: ScoreConfig): ScoreConfigUpdate {
  const { version: _version, ...update } = config;
  return update;
}

function percentLabel(ratio: string): string {
  const value = Number(ratio) * 100;
  return Number.isInteger(value) ? `${value}%` : `${value}%`;
}

/**
 * Live confidence in the user's fair values. Shares the allocation screen's
 * cached query; opened elsewhere it loads the allocation once.
 */
function ValuationTrackRecord() {
  const allocation = trpc.allocation.list.useQuery(useAllocationListInput());

  if (allocation.data) {
    return (
      <ValuationSkillCard
        skill={allocation.data.valuationSkill}
        config={allocation.data.scoreConfig}
      />
    );
  }

  return allocation.isPending ? (
    <Skeleton className="h-40 w-full rounded-xl" />
  ) : null;
}

/** Contribution-score methodology with live, editable policy knobs. */
export function ScoreDocumentation() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const policy = trpc.scoreConfig.get.useQuery();

  const form = useForm<ScoreConfigUpdate>({
    resolver: zodResolver(scoreConfigUpdateSchema),
    defaultValues: withoutVersion(DEFAULT_SCORE_CONFIG),
  });

  const bands = useFieldArray({
    control: form.control,
    name: "gradeBands",
  });

  const watched = useWatch({ control: form.control });
  const preview: ScoreConfigUpdate = {
    ...withoutVersion(DEFAULT_SCORE_CONFIG),
    ...Object.fromEntries(
      Object.entries(watched).filter(([, value]) => value !== undefined),
    ),
    gradeBands: (watched.gradeBands ?? DEFAULT_SCORE_CONFIG.gradeBands).map(
      (band) => ({
        minGrade: band.minGrade ?? "0",
        multiplier: band.multiplier ?? "1",
      }),
    ),
  };

  useEffect(() => {
    if (policy.data) {
      form.reset(withoutVersion(policy.data.config));
    }
  }, [policy.data, form]);

  const update = trpc.scoreConfig.update.useMutation({
    onSuccess: async (result) => {
      form.reset(withoutVersion(result.config));
      await Promise.all([
        utils.scoreConfig.get.invalidate(),
        utils.allocation.list.invalidate(),
      ]);
      toast.success(
        i18n._(
          msg({
            id: "documentation.score.saveSuccess",
            message: "Contribution score settings saved.",
          }),
        ),
      );
    },
    onError: (error) => {
      toast.error(
        error.message ||
          i18n._(
            msg({
              id: "documentation.score.saveError",
              message: "Could not save score settings.",
            }),
          ),
      );
    },
  });

  const reset = trpc.scoreConfig.reset.useMutation({
    onSuccess: async (result) => {
      form.reset(withoutVersion(result.config));
      await Promise.all([
        utils.scoreConfig.get.invalidate(),
        utils.allocation.list.invalidate(),
      ]);
      toast.success(
        i18n._(
          msg({
            id: "documentation.score.resetSuccess",
            message: "Contribution score settings restored to defaults.",
          }),
        ),
      );
    },
    onError: (error) => {
      toast.error(
        error.message ||
          i18n._(
            msg({
              id: "documentation.score.resetError",
              message: "Could not restore score defaults.",
            }),
          ),
      );
    },
  });

  if (policy.isLoading) {
    return (
      <DocumentBody>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </DocumentBody>
    );
  }

  if (policy.isError || !policy.data) {
    return (
      <DocumentBody>
        <Callout
          icon={Target}
          title={
            <Trans id="documentation.score.loadErrorTitle">
              Could not load score settings
            </Trans>
          }
        >
          <Trans id="documentation.score.loadErrorDescription">
            Refresh the page and try again. Allocation continues to use the last
            known policy on the server.
          </Trans>
        </Callout>
      </DocumentBody>
    );
  }

  const isCustom = policy.data.isCustom;
  const isBusy = update.isPending || reset.isPending;
  const scoreCap = percentLabel(preview.absoluteWeightCap);
  const overweightLimit = percentLabel(preview.overweightBlockFactor);
  const trimAbsolute = percentLabel(preview.trimAbsoluteBand);
  const trimRelative = percentLabel(preview.trimRelativeBand);
  const deadZone = percentLabel(preview.valuationDeadZone);

  return (
    <Form {...form}>
      <form
        className="contents"
        onSubmit={form.handleSubmit((values) => update.mutate(values))}
      >
        <DocumentBody>
          <ValuationTrackRecord />
          <Callout
            icon={Target}
            title={
              isCustom ? (
                <Trans id="documentation.score.customPolicy">
                  Custom contribution policy
                </Trans>
              ) : (
                <Trans id="documentation.score.policyVersion">
                  Policy version {policy.data.config.version}
                </Trans>
              )
            }
            actions={
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isCustom || isBusy}
                  onClick={() => reset.mutate()}
                >
                  {reset.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  <Trans id="documentation.score.resetDefaults">
                    Reset defaults
                  </Trans>
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!form.formState.isDirty || isBusy}
                >
                  {update.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  <Trans id="documentation.score.save">Save</Trans>
                </Button>
              </>
            }
          >
            <Trans id="documentation.score.introV2">
              The score answers how strongly an asset should compete for the
              next contribution. It is the share of the asset&apos;s
              valuation-adjusted target that is still missing, times its
              priority: 40% means 40% of the target is missing at full priority.
              Positive values are buy candidates, zero means skip, and a
              negative value is a trim signal. Thresholds below are yours to
              tune and persist with the account.
            </Trans>
          </Callout>

          <Topic
            title={
              <Trans id="documentation.score.pipelineTitle">
                Calculation pipeline
              </Trans>
            }
            description={
              <Trans id="documentation.score.pipelineDescriptionV2">
                Where to go, how much is missing, and how urgently are computed
                separately, so each input has one job.
              </Trans>
            }
          >
            <ol className="grid gap-2 sm:grid-cols-2">
              <PipelineStep
                step="1"
                title={
                  <Trans id="documentation.score.valuationSignal">
                    Valuation signal
                  </Trans>
                }
              >
                <Trans id="documentation.score.valuationSignalDescriptionV3">
                  The log distance between fair value and price, so half and
                  double the fair value weigh the same. A cheap USD asset must
                  also clear the FX spread and IOF, and an optional noise band
                  (now ±{deadZone}) can ignore small gaps. A missing fair value
                  or price means no signal.
                </Trans>
                <Formula>
                  <Trans id="documentation.formula.valuationSignal">
                    signal = ln(fair value / price) minus the noise band
                  </Trans>
                </Formula>
              </PipelineStep>
              <PipelineStep
                step="2"
                title={
                  <Trans id="documentation.score.tiltedTarget">
                    Valuation-adjusted target
                  </Trans>
                }
              >
                <Trans id="documentation.score.tiltedTargetDescriptionV3">
                  The signal tilts the target between ×{preview.tiltMin} and ×
                  {preview.tiltMax}. Its strength is learned: up to{" "}
                  {preview.valuationSensitivity} once your fair values prove
                  they anticipate returns (IC ≥ {preview.icReference}), half of
                  it before there is a track record, zero if they do not. A
                  stale fair value or a weak grade also counts less. Valuation
                  is rescaled only among assets with a fair value; a light
                  12-month trend then adjusts every target and keeps the total.
                </Trans>
                <Formula>
                  <Trans id="documentation.formula.tiltedTargetV3">
                    target × (FV ÷ price)^(k × confidence) × e^(w × trend z)
                  </Trans>
                </Formula>
              </PipelineStep>
              <PipelineStep
                step="3"
                title={
                  <Trans id="documentation.score.relativeGap">
                    Relative gap
                  </Trans>
                }
              >
                <Trans id="documentation.score.relativeGapDescription">
                  How much of the adjusted target is missing. An empty 2% target
                  outranks a 10% target that is already at 8%, even though both
                  miss 2 percentage points.
                </Trans>
                <Formula>
                  <Trans id="documentation.formula.relativeGap">
                    1 - current weight / adjusted target
                  </Trans>
                </Formula>
              </PipelineStep>
              <PipelineStep
                step="4"
                title={
                  <Trans id="documentation.score.priority">Priority</Trans>
                }
              >
                <Trans id="documentation.score.priorityDescription">
                  The grade multiplier times the cooldown ramp. Priority decides
                  who is filled first and how close to target a cheque takes
                  them; it never lowers the target itself.
                </Trans>
                <Formula>
                  <Trans id="documentation.formula.priority">
                    grade multiplier × cooldown ramp
                  </Trans>
                </Formula>
              </PipelineStep>
            </ol>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
              <Trans id="documentation.score.pipelineNextV2">
                The rule ladder then blocks, trims, or scores the relative gap
                times the priority.
              </Trans>
            </p>
          </Topic>

          <Topic
            title={
              <Trans id="documentation.score.thresholdsTitle">
                Configurable thresholds
              </Trans>
            }
            description={
              <Trans id="documentation.score.thresholdsDescription">
                These knobs feed every rule below. Values are saved to the
                database for this account.
              </Trans>
            }
          >
            <FieldGroup
              title={
                <Trans id="documentation.score.group.limits">
                  Ceilings and trims
                </Trans>
              }
            >
              <PercentField
                name="absoluteWeightCap"
                label={
                  <Trans id="documentation.score.field.absoluteCap">
                    Absolute weight cap
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.absoluteCapHintV2">
                    Highest weight a contribution may take an asset whose target
                    is at or below this ceiling.
                  </Trans>
                }
              />
              <PercentField
                name="overweightBlockFactor"
                label={
                  <Trans id="documentation.score.field.overweightBlock">
                    Target overweight block
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.overweightBlockHintV2">
                    Highest weight a contribution may reach, as a percent of the
                    asset&apos;s own target. Also bounds a generous valuation
                    tilt.
                  </Trans>
                }
              />
              <PercentField
                name="trimAbsoluteBand"
                label={
                  <Trans id="documentation.score.field.trimAbsolute">
                    Trim band (points)
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.trimAbsoluteHint">
                    Percentage points past the adjusted target that make an
                    expensive holding a trim candidate.
                  </Trans>
                }
              />
              <PercentField
                name="trimRelativeBand"
                label={
                  <Trans id="documentation.score.field.trimRelative">
                    Trim band (relative)
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.trimRelativeHint">
                    The same band as a share of the adjusted target. The tighter
                    of the two applies.
                  </Trans>
                }
              />
            </FieldGroup>

            <FieldGroup
              title={
                <Trans id="documentation.score.group.valuation">
                  Valuation
                </Trans>
              }
            >
              <DecimalField
                name="icReference"
                label={
                  <Trans id="documentation.score.field.icReference">
                    IC for full strength
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.icReferenceHint">
                    Correlation between your discounts and the next 12 months of
                    returns at which valuation reaches full strength.
                  </Trans>
                }
              />
              <DecimalField
                name="icPrior"
                label={
                  <Trans id="documentation.score.field.icPrior">
                    Starting IC
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.icPriorHint">
                    Assumed before any fair value has a 12-month outcome. Half
                    of the reference means half strength.
                  </Trans>
                }
              />
              <IntegerField
                name="icPriorPairs"
                min={0}
                unit={
                  <Trans id="documentation.score.unit.pairs">reviews</Trans>
                }
                label={
                  <Trans id="documentation.score.field.icPriorPairs">
                    Weight of the starting IC
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.icPriorPairsHint">
                    How many reviews with an outcome it takes for your own track
                    record to outweigh the starting IC.
                  </Trans>
                }
              />
              <PercentField
                name="valuationDeadZone"
                label={
                  <Trans id="documentation.score.field.deadZone">
                    Valuation noise band
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.deadZoneHint">
                    Mispricing this close to fair value does not tilt the
                    target.
                  </Trans>
                }
              />
              <DecimalField
                name="valuationSensitivity"
                label={
                  <Trans id="documentation.score.field.sensitivityV3">
                    Maximum valuation strength
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.sensitivityHintV3">
                    Exponent k reached with a proven track record. 0 ignores
                    valuation.
                  </Trans>
                }
              />
              <DecimalField
                name="tiltMin"
                label={
                  <Trans id="documentation.score.field.tiltMin">
                    Lowest tilt
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.tiltMinHint">
                    Smallest multiplier an expensive price may apply to a target
                    (at most 1).
                  </Trans>
                }
              />
              <DecimalField
                name="tiltMax"
                label={
                  <Trans id="documentation.score.field.tiltMax">
                    Highest tilt
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.tiltMaxHint">
                    Largest multiplier a cheap price may apply to a target (at
                    least 1).
                  </Trans>
                }
              />
              <IntegerField
                name="fairValueHalfLifeQuarters"
                min={1}
                unit={
                  <Trans id="documentation.score.unit.quarters">quarters</Trans>
                }
                label={
                  <Trans id="documentation.score.field.fairValueHalfLife">
                    Fair value half-life
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.fairValueHalfLifeHint">
                    Quarters after which a fair value that was not refreshed
                    counts half as much.
                  </Trans>
                }
              />
            </FieldGroup>

            <FieldGroup
              title={
                <Trans id="documentation.score.group.trendSales">
                  Trend, review and sales
                </Trans>
              }
            >
              <DecimalField
                name="momentumWeight"
                label={
                  <Trans id="documentation.score.field.momentumWeight">
                    Trend weight
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.momentumWeightHint">
                    Exponent on the 12-month trend z-score. 0.10 moves a target
                    at most ×0.82–×1.22; 0 turns the trend off.
                  </Trans>
                }
              />
              <DecimalField
                name="momentumZCap"
                label={
                  <Trans id="documentation.score.field.momentumZCap">
                    Trend cap
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.momentumZCapHint">
                    Largest trend z-score counted, so one huge rally cannot
                    dominate.
                  </Trans>
                }
              />
              <PercentField
                name="reviewDrift"
                label={
                  <Trans id="documentation.score.field.reviewDrift">
                    Review warning
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.reviewDriftHint">
                    Price move since the fair value's quarter end that asks you
                    to redo the valuation from scratch.
                  </Trans>
                }
              />
              <PercentField
                name="sellBand"
                label={
                  <Trans id="documentation.score.field.sellBand">
                    Sale band
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.sellBandHint">
                    An expensive position is a sale candidate once it runs this
                    far past its adjusted target.
                  </Trans>
                }
              />
              <PercentField
                name="sellConfidence"
                label={
                  <Trans id="documentation.score.field.sellConfidence">
                    Confidence to recommend sales
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.sellConfidenceHint">
                    Below it, sale suggestions are shown for information only.
                  </Trans>
                }
              />
            </FieldGroup>

            <FieldGroup
              title={
                <Trans id="documentation.score.group.priority">
                  Grades and cooldown
                </Trans>
              }
            >
              <IntegerField
                name="gradeWindowQuarters"
                min={1}
                unit={
                  <Trans id="documentation.score.unit.quarters">quarters</Trans>
                }
                label={
                  <Trans id="documentation.score.field.gradeWindow">
                    Grade window
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.gradeWindowHint">
                    How many of the newest graded quarters the average grade
                    uses.
                  </Trans>
                }
              />
              <IntegerField
                name="gradeHalfLifeQuarters"
                min={1}
                unit={
                  <Trans id="documentation.score.unit.quarters">quarters</Trans>
                }
                label={
                  <Trans id="documentation.score.field.gradeHalfLife">
                    Grade half-life
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.gradeHalfLifeHint">
                    Quarters after which a grade counts half as much as a fresh
                    one.
                  </Trans>
                }
              />
              <DecimalField
                name="gradePriorQuarters"
                label={
                  <Trans id="documentation.score.field.gradePrior">
                    Grade prior
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.gradePriorHint">
                    Quarters of neutral evidence mixed in, so one grade moves
                    the multiplier less than several consistent ones.
                  </Trans>
                }
              />
              <DecimalField
                name="ungradedMultiplier"
                label={
                  <Trans id="documentation.score.field.ungraded">
                    Ungraded multiplier
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.ungradedHint">
                    Applied when the asset has no graded quarter yet. Neutral is
                    1.
                  </Trans>
                }
              />
              <IntegerField
                name="cooldownDays"
                min={0}
                unit={<Trans id="documentation.score.unit.days">days</Trans>}
                label={
                  <Trans id="documentation.score.field.cooldownDays">
                    Contribution cooldown
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.cooldownDaysHintV2">
                    Days after a buy during which the asset&apos;s priority
                    ramps back to full.
                  </Trans>
                }
              />
              <DecimalField
                name="cooldownFloor"
                label={
                  <Trans id="documentation.score.field.cooldownFloor">
                    Priority right after a buy
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.cooldownFloorHint">
                    Priority multiplier on the day of a buy, rising linearly to
                    1. Use 0 for the strictest ramp.
                  </Trans>
                }
              />
            </FieldGroup>
          </Topic>

          <Topic
            title={
              <Trans id="documentation.score.gradeCurve">Grade curve</Trans>
            }
            description={
              <Trans id="documentation.score.gradeCurveDescription">
                Each row is a point of the curve; grades between two points are
                interpolated, so a tenth of a point never jumps the score. The
                average leans on recent quarters and is blended with ×
                {preview.ungradedMultiplier} by {preview.gradePriorQuarters}{" "}
                quarter(s) of prior evidence. Notes-only reviews are ignored.
                Points must be ascending by grade.
              </Trans>
            }
          >
            <div className="grid gap-2">
              {bands.fields.map((band, index) => (
                <div
                  key={band.id}
                  className="grid gap-3 rounded-lg border px-3.5 py-3 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <FormField
                    control={form.control}
                    name={`gradeBands.${index}.minGrade`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans id="documentation.score.gradePoint">
                            Grade {field.value}
                          </Trans>
                        </FormLabel>
                        <FormControl>
                          <Input
                            inputMode="decimal"
                            value={formatDecimalInput(field.value)}
                            onChange={(event) => {
                              const parsed = parseDecimalInput(
                                event.target.value,
                              );
                              if (parsed !== null) field.onChange(parsed);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`gradeBands.${index}.multiplier`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <Trans id="documentation.score.priorityMultiplier">
                            Priority ×{field.value}
                          </Trans>
                        </FormLabel>
                        <FormControl>
                          <Input
                            inputMode="decimal"
                            value={formatDecimalInput(field.value)}
                            onChange={(event) => {
                              const parsed = parseDecimalInput(
                                event.target.value,
                              );
                              if (parsed !== null) field.onChange(parsed);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={bands.fields.length <= 1 || isBusy}
                      aria-label={i18n._(
                        msg({
                          id: "documentation.score.removePoint",
                          message: "Remove grade point",
                        }),
                      )}
                      onClick={() => bands.remove(index)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={isBusy}
              onClick={() => {
                const last = preview.gradeBands[preview.gradeBands.length - 1];
                const nextMin = String(Number(last?.minGrade ?? "0") + 1);
                bands.append({
                  minGrade: nextMin,
                  multiplier: last?.multiplier ?? "1",
                });
              }}
            >
              <Plus className="size-4" />
              <Trans id="documentation.score.addPoint">Add grade point</Trans>
            </Button>
          </Topic>

          <Topic
            title={
              <Trans id="documentation.score.ruleLadder">Rule ladder</Trans>
            }
            description={
              <Trans id="documentation.score.ruleLadderDescription">
                Rules run in this exact order and the first match wins. This
                priority is part of the method; only the thresholds above are
                editable.
              </Trans>
            }
          >
            <ol className="grid gap-2">
              <Rule
                number="1"
                title={
                  <Trans id="documentation.score.noTarget">No target</Trans>
                }
              >
                <Trans id="documentation.score.noTargetDescription">
                  Score is zero because there is no allocation target to close.
                </Trans>
              </Rule>
              <Rule
                number="2"
                title={
                  <Trans id="documentation.score.noQuoteTitle">
                    Blocked without a price
                  </Trans>
                }
              >
                <Trans id="documentation.score.noQuoteDescription">
                  A held asset that no live or manual price can value has an
                  unknown weight, not a zero one. It is blocked instead of
                  looking like the largest gap in the portfolio; set a manual
                  value to score it again.
                </Trans>
              </Rule>
              <Rule
                number="3"
                title={
                  <Trans id="documentation.score.trimTitle">
                    Trim an expensive overweight position
                  </Trans>
                }
                badge={
                  <ThresholdChip>
                    <Trans id="documentation.score.trimBadgeV2">
                      {trimAbsolute} or {trimRelative}
                    </Trans>
                  </ThresholdChip>
                }
              >
                <Trans id="documentation.score.trimDescriptionV2">
                  If valuation tilts the target down and current weight runs
                  more than {trimAbsolute} points or {trimRelative} of the
                  adjusted target past it (whichever is tighter, the 5/25
                  tolerance-band rule), return the negative relative gap. This
                  rule precedes the blocking caps so it can produce a trim
                  signal.
                </Trans>
              </Rule>
              <Rule
                number="4"
                title={
                  <Trans id="documentation.score.absoluteCap">
                    Absolute weight cap
                  </Trans>
                }
                badge={<ThresholdChip>{scoreCap}</ThresholdChip>}
              >
                <Trans id="documentation.score.absoluteCapDescriptionV2">
                  Block new contributions when current weight is greater than{" "}
                  {scoreCap} of the portfolio, unless the asset has an explicit
                  target above that ceiling. The planner also never takes such
                  an asset past {scoreCap}.
                </Trans>
              </Rule>
              <Rule
                number="5"
                title={
                  <Trans id="documentation.score.targetCap">
                    Target-relative cap
                  </Trans>
                }
                badge={
                  <ThresholdChip>
                    <Trans id="documentation.score.overweightBadge">
                      {overweightLimit} of target
                    </Trans>
                  </ThresholdChip>
                }
              >
                <Trans id="documentation.score.targetCapDescriptionV2">
                  Block new contributions when current weight is greater than{" "}
                  {overweightLimit} of its own target; the planner never takes
                  an asset past it either.
                </Trans>
              </Rule>
              <Rule
                number="6"
                title={
                  <Trans id="documentation.score.cooldown">
                    Contribution cooldown
                  </Trans>
                }
                badge={
                  <ThresholdChip>
                    {preview.cooldownDays}{" "}
                    <Trans id="documentation.score.unit.days">days</Trans>
                  </ThresholdChip>
                }
              >
                <Trans id="documentation.score.cooldownDescriptionV2">
                  After a buy, priority starts at ×{preview.cooldownFloor} and
                  rises linearly to ×1 over {preview.cooldownDays} days. The
                  asset stays a candidate, so a small buy does not freeze it and
                  a large gap can still win. Sells do not reset the clock.
                </Trans>
              </Rule>
              <Rule
                number="7"
                title={
                  <Trans id="documentation.score.normalCandidate">
                    Normal candidate
                  </Trans>
                }
                badge={
                  <ThresholdChip>
                    <Trans id="documentation.score.ungradedBadge">
                      ×{preview.ungradedMultiplier} ungraded
                    </Trans>
                  </ThresholdChip>
                }
              >
                <Trans id="documentation.score.normalCandidateDescriptionV2">
                  Clamp a negative relative gap to zero, then apply the
                  priority.
                </Trans>
                <Formula>
                  <Trans id="documentation.formula.priorityGap">
                    max(relative gap, 0) × priority
                  </Trans>
                </Formula>
              </Rule>
            </ol>
          </Topic>
        </DocumentBody>
      </form>
    </Form>
  );
}

function PipelineStep({
  step,
  title,
  children,
}: {
  step: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="relative grid gap-2 rounded-lg border bg-background px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {step}
        </span>
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      <div className="grid gap-2 text-muted-foreground">{children}</div>
    </li>
  );
}

function ThresholdChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
      {children}
    </span>
  );
}

function FieldGroup({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function PercentField({
  name,
  label,
  description,
}: {
  name:
    | "absoluteWeightCap"
    | "overweightBlockFactor"
    | "trimAbsoluteBand"
    | "trimRelativeBand"
    | "valuationDeadZone"
    | "reviewDrift"
    | "sellBand"
    | "sellConfidence";
  label: ReactNode;
  description: ReactNode;
}) {
  const form = useFormContext<ScoreConfigUpdate>();

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="rounded-lg border px-3.5 py-3">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <div className="flex items-center gap-2">
              <Input
                inputMode="decimal"
                className="max-w-28"
                value={formatPercentInput(field.value)}
                onChange={(event) => {
                  const parsed = parsePercentInput(event.target.value);
                  if (parsed !== null) field.onChange(parsed);
                }}
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function DecimalField({
  name,
  label,
  description,
}: {
  name:
    | "ungradedMultiplier"
    | "valuationSensitivity"
    | "tiltMin"
    | "tiltMax"
    | "cooldownFloor"
    | "gradePriorQuarters"
    | "icReference"
    | "icPrior"
    | "momentumWeight"
    | "momentumZCap";
  label: ReactNode;
  description: ReactNode;
}) {
  const form = useFormContext<ScoreConfigUpdate>();

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="rounded-lg border px-3.5 py-3">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              inputMode="decimal"
              className="max-w-28"
              value={formatDecimalInput(field.value)}
              onChange={(event) => {
                const parsed = parseDecimalInput(event.target.value);
                if (parsed !== null) field.onChange(parsed);
              }}
            />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function IntegerField({
  name,
  min,
  unit,
  label,
  description,
}: {
  name:
    | "cooldownDays"
    | "gradeWindowQuarters"
    | "gradeHalfLifeQuarters"
    | "fairValueHalfLifeQuarters"
    | "icPriorPairs";
  min: number;
  unit: ReactNode;
  label: ReactNode;
  description: ReactNode;
}) {
  const form = useFormContext<ScoreConfigUpdate>();

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="rounded-lg border px-3.5 py-3">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={min}
                step={1}
                className="max-w-28"
                value={field.value}
                onChange={(event) => field.onChange(Number(event.target.value))}
              />
              <span className="text-xs text-muted-foreground">{unit}</span>
            </div>
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
