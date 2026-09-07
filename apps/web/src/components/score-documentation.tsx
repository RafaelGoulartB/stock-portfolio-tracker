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
    absoluteWeightCap:
      watched.absoluteWeightCap ?? DEFAULT_SCORE_CONFIG.absoluteWeightCap,
    overweightBlockFactor:
      watched.overweightBlockFactor ??
      DEFAULT_SCORE_CONFIG.overweightBlockFactor,
    trimFactor: watched.trimFactor ?? DEFAULT_SCORE_CONFIG.trimFactor,
    cooldownDays: watched.cooldownDays ?? DEFAULT_SCORE_CONFIG.cooldownDays,
    gradeWindowQuarters:
      watched.gradeWindowQuarters ?? DEFAULT_SCORE_CONFIG.gradeWindowQuarters,
    gradeBands: (watched.gradeBands ?? DEFAULT_SCORE_CONFIG.gradeBands).map(
      (band) => ({
        minGrade: band.minGrade ?? "0",
        multiplier: band.multiplier ?? "1",
      }),
    ),
    ungradedMultiplier:
      watched.ungradedMultiplier ?? DEFAULT_SCORE_CONFIG.ungradedMultiplier,
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
  const trimLimit = percentLabel(preview.trimFactor);

  return (
    <Form {...form}>
      <form
        className="contents"
        onSubmit={form.handleSubmit((values) => update.mutate(values))}
      >
        <DocumentBody>
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
            <Trans id="documentation.score.intro">
              The score answers how strongly an asset should compete for the
              next contribution. It is expressed in portfolio-weight units: a
              score of 0.0075 means 0.75 percentage points. Positive values are
              buy candidates, zero means skip, and a negative value is a trim
              signal. Thresholds below are yours to tune and persist with the
              account.
            </Trans>
          </Callout>

          <Topic
            title={
              <Trans id="documentation.score.pipelineTitle">
                Calculation pipeline
              </Trans>
            }
            description={
              <Trans id="documentation.score.pipelineDescription">
                Every asset walks the same path before the rule ladder decides
                the final score.
              </Trans>
            }
          >
            <ol className="grid gap-2 sm:grid-cols-3">
              <PipelineStep
                step="1"
                title={
                  <Trans id="documentation.score.fairValueDiscount">
                    Fair-value discount
                  </Trans>
                }
              >
                <Trans id="documentation.score.fairValueDiscountDescription">
                  Positive when the market price is below the newest quarterly
                  Fair value; negative when it is above it. A missing Fair value
                  or price is treated as a zero discount by the score.
                </Trans>
                <Formula>(fair value - market price) / fair value</Formula>
              </PipelineStep>
              <PipelineStep
                step="2"
                title={
                  <Trans id="documentation.score.adjustedTarget">
                    Adjusted target
                  </Trans>
                }
              >
                <Trans id="documentation.score.adjustedTargetDescription">
                  A discount raises the target used for this decision; a premium
                  lowers it.
                </Trans>
                <Formula>target weight × (1 + discount)</Formula>
              </PipelineStep>
              <PipelineStep
                step="3"
                title={<Trans id="documentation.score.rawGap">Raw gap</Trans>}
              >
                <Trans id="documentation.score.rawGapDescription">
                  The distance between the adjusted target and the asset&apos;s
                  current portfolio weight.
                </Trans>
                <Formula>adjusted target - current weight</Formula>
              </PipelineStep>
            </ol>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
              <Trans id="documentation.score.pipelineNext">
                The rule ladder then either blocks, trims, or scales that gap by
                the grade multiplier.
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
            <div className="grid gap-3 sm:grid-cols-2">
              <PercentField
                name="absoluteWeightCap"
                label={
                  <Trans id="documentation.score.field.absoluteCap">
                    Absolute weight cap
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.absoluteCapHint">
                    Block new buys once weight exceeds this share of the whole
                    portfolio.
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
                  <Trans id="documentation.score.field.overweightBlockHint">
                    Block when current weight exceeds this percent of the
                    asset&apos;s own target.
                  </Trans>
                }
              />
              <PercentField
                name="trimFactor"
                label={
                  <Trans id="documentation.score.field.trimFactor">
                    Trim threshold
                  </Trans>
                }
                description={
                  <Trans id="documentation.score.field.trimFactorHint">
                    Expensive holdings above this percent of target become trim
                    candidates.
                  </Trans>
                }
              />
              <FormField
                control={form.control}
                name="cooldownDays"
                render={({ field }) => (
                  <FormItem className="rounded-lg border px-3.5 py-3">
                    <FormLabel>
                      <Trans id="documentation.score.field.cooldownDays">
                        Contribution cooldown
                      </Trans>
                    </FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          className="max-w-28"
                          value={field.value}
                          onChange={(event) =>
                            field.onChange(Number(event.target.value))
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          <Trans id="documentation.score.unit.days">days</Trans>
                        </span>
                      </div>
                    </FormControl>
                    <FormDescription>
                      <Trans id="documentation.score.field.cooldownDaysHint">
                        Days after a buy during which the asset takes no new
                        contribution.
                      </Trans>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gradeWindowQuarters"
                render={({ field }) => (
                  <FormItem className="rounded-lg border px-3.5 py-3">
                    <FormLabel>
                      <Trans id="documentation.score.field.gradeWindow">
                        Grade window
                      </Trans>
                    </FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          className="max-w-28"
                          value={field.value}
                          onChange={(event) =>
                            field.onChange(Number(event.target.value))
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          <Trans id="documentation.score.unit.quarters">
                            quarters
                          </Trans>
                        </span>
                      </div>
                    </FormControl>
                    <FormDescription>
                      <Trans id="documentation.score.field.gradeWindowHint">
                        How many of the newest graded quarters the average grade
                        uses.
                      </Trans>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
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
            </div>
          </Topic>

          <Topic
            title={
              <Trans id="documentation.score.gradeMultiplier">
                Quarterly grade multiplier
              </Trans>
            }
            description={
              <Trans id="documentation.score.gradeDescription">
                The grade is the average of the newest{" "}
                {preview.gradeWindowQuarters} quarters that actually contain a
                grade. Notes-only reviews are ignored. An asset with no grades
                uses a ×{preview.ungradedMultiplier} multiplier. Bands must be
                ascending by minimum grade.
              </Trans>
            }
          >
            <div className="grid gap-2">
              {bands.fields.map((band, index) => {
                const next = preview.gradeBands[index + 1];

                return (
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
                            {next ? (
                              <Trans id="documentation.score.gradeRange">
                                Grade ≥ {field.value} and &lt; {next.minGrade}
                              </Trans>
                            ) : (
                              <Trans id="documentation.score.gradeMinimum">
                                Grade ≥ {field.value}
                              </Trans>
                            )}
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
                            <Trans id="documentation.score.gapMultiplier">
                              Gap multiplier ×{field.value}
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
                            id: "documentation.score.removeBand",
                            message: "Remove grade band",
                          }),
                        )}
                        onClick={() => bands.remove(index)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
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
              <Trans id="documentation.score.addBand">Add grade band</Trans>
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
                  <Trans id="documentation.score.trimTitle">
                    Trim an expensive overweight position
                  </Trans>
                }
                badge={
                  <ThresholdChip>
                    <Trans id="documentation.score.trimBadge">
                      {trimLimit} of target
                    </Trans>
                  </ThresholdChip>
                }
              >
                <Trans id="documentation.score.trimDescription">
                  If the discount is negative and current weight is above{" "}
                  {trimLimit} of target, return the signed raw gap. This rule
                  precedes the blocking caps so it can produce a negative trim
                  signal.
                </Trans>
              </Rule>
              <Rule
                number="3"
                title={
                  <Trans id="documentation.score.absoluteCap">
                    Absolute weight cap
                  </Trans>
                }
                badge={<ThresholdChip>{scoreCap}</ThresholdChip>}
              >
                <Trans id="documentation.score.absoluteCapDescription">
                  Block new contributions when current weight is greater than{" "}
                  {scoreCap} of the portfolio.
                </Trans>
              </Rule>
              <Rule
                number="4"
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
                <Trans id="documentation.score.targetCapDescription">
                  Block new contributions when current weight is greater than{" "}
                  {overweightLimit} of its own target.
                </Trans>
              </Rule>
              <Rule
                number="5"
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
                <Trans id="documentation.score.cooldownDescription">
                  Block the asset for {preview.cooldownDays} days after its
                  latest buy. Sells do not reset the clock; the asset is
                  eligible again on day {preview.cooldownDays}.
                </Trans>
              </Rule>
              <Rule
                number="6"
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
                <Trans id="documentation.score.normalCandidateDescription">
                  Clamp a negative gap to zero, then apply the grade multiplier.
                </Trans>
                <Formula>max(raw gap, 0) × grade multiplier</Formula>
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

function PercentField({
  name,
  label,
  description,
}: {
  name: "absoluteWeightCap" | "overweightBlockFactor" | "trimFactor";
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
  name: "ungradedMultiplier";
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
