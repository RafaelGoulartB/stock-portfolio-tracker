import { zodResolver } from "@hookform/resolvers/zod";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  CONTRIBUTION_PLAN_LARGE_BOOK_VALUE,
  CONTRIBUTION_PLAN_SMALL_BOOK_VALUE,
  type ContributionPlanConfig,
  type ContributionPlanConfigUpdate,
  contributionPlanConfigUpdateSchema,
  DEFAULT_CONTRIBUTION_PLAN_CONFIG,
  FX_EXECUTION_IOF,
  FX_EXECUTION_SPREAD,
} from "@portifolio-tracker/shared";
import { Calculator, Loader2, RotateCcw, Save } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useForm, useFormContext, useWatch } from "react-hook-form";
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
import { formatPercentInput, parsePercentInput } from "@/lib/numeric-input";

function withoutVersion(
  config: ContributionPlanConfig,
): ContributionPlanConfigUpdate {
  const { version: _version, ...update } = config;
  return update;
}

function percentLabel(ratio: string): string {
  return `${Number(ratio) * 100}%`;
}

const fxSpread = percentLabel(FX_EXECUTION_SPREAD);
const fxIof = percentLabel(FX_EXECUTION_IOF);
const fxMarkup = (
  ((1 + Number(FX_EXECUTION_SPREAD)) * (1 + Number(FX_EXECUTION_IOF)) - 1) *
  100
).toFixed(4);

/** Contribution-planner methodology with live, editable policy knobs. */
export function ContributionPlanDocumentation() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const policy = trpc.contributionPlanConfig.get.useQuery();

  const form = useForm<ContributionPlanConfigUpdate>({
    resolver: zodResolver(contributionPlanConfigUpdateSchema),
    defaultValues: withoutVersion(DEFAULT_CONTRIBUTION_PLAN_CONFIG),
  });

  const watched = useWatch({ control: form.control });
  const preview: ContributionPlanConfigUpdate = {
    smallBookImpact:
      watched.smallBookImpact ??
      DEFAULT_CONTRIBUTION_PLAN_CONFIG.smallBookImpact,
    largeBookImpact:
      watched.largeBookImpact ??
      DEFAULT_CONTRIBUTION_PLAN_CONFIG.largeBookImpact,
    maxShare: watched.maxShare ?? DEFAULT_CONTRIBUTION_PLAN_CONFIG.maxShare,
    maxAssets: watched.maxAssets ?? DEFAULT_CONTRIBUTION_PLAN_CONFIG.maxAssets,
    starterFraction:
      watched.starterFraction ??
      DEFAULT_CONTRIBUTION_PLAN_CONFIG.starterFraction,
  };

  useEffect(() => {
    if (policy.data) {
      form.reset(withoutVersion(policy.data.config));
    }
  }, [policy.data, form]);

  const update = trpc.contributionPlanConfig.update.useMutation({
    onSuccess: async (result) => {
      form.reset(withoutVersion(result.config));
      await utils.contributionPlanConfig.get.invalidate();
      toast.success(
        i18n._(
          msg({
            id: "documentation.contribution.saveSuccess",
            message: "Contribution planner settings saved.",
          }),
        ),
      );
    },
    onError: (error) => {
      toast.error(
        error.message ||
          i18n._(
            msg({
              id: "documentation.contribution.saveError",
              message: "Could not save planner settings.",
            }),
          ),
      );
    },
  });

  const reset = trpc.contributionPlanConfig.reset.useMutation({
    onSuccess: async (result) => {
      form.reset(withoutVersion(result.config));
      await utils.contributionPlanConfig.get.invalidate();
      toast.success(
        i18n._(
          msg({
            id: "documentation.contribution.resetSuccess",
            message: "Contribution planner settings restored to defaults.",
          }),
        ),
      );
    },
    onError: (error) => {
      toast.error(
        error.message ||
          i18n._(
            msg({
              id: "documentation.contribution.resetError",
              message: "Could not restore planner defaults.",
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
          icon={Calculator}
          title={
            <Trans id="documentation.contribution.loadErrorTitle">
              Could not load planner settings
            </Trans>
          }
        >
          <Trans id="documentation.contribution.loadErrorDescription">
            Refresh the page and try again. The planner continues to use the
            last known policy on the server.
          </Trans>
        </Callout>
      </DocumentBody>
    );
  }

  const isCustom = policy.data.isCustom;
  const isBusy = update.isPending || reset.isPending;
  const smallImpact = percentLabel(preview.smallBookImpact);
  const largeImpact = percentLabel(preview.largeBookImpact);
  const shareCap = percentLabel(preview.maxShare);
  const starterShare = percentLabel(preview.starterFraction);
  const smallBook = Number(CONTRIBUTION_PLAN_SMALL_BOOK_VALUE).toLocaleString(
    i18n.locale,
  );
  const largeBook = Number(CONTRIBUTION_PLAN_LARGE_BOOK_VALUE).toLocaleString(
    i18n.locale,
  );

  return (
    <Form {...form}>
      <form
        className="contents"
        onSubmit={form.handleSubmit((values) => update.mutate(values))}
      >
        <DocumentBody>
          <Callout
            icon={Calculator}
            title={
              isCustom ? (
                <Trans id="documentation.contribution.customPolicy">
                  Custom contribution split
                </Trans>
              ) : (
                <Trans id="documentation.contribution.policyVersion">
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
                  <Trans id="documentation.contribution.resetDefaults">
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
                  <Trans id="documentation.contribution.save">Save</Trans>
                </Button>
              </>
            }
          >
            <Trans id="documentation.contribution.intro">
              The planner turns a contribution amount into suggested slices. The
              score still ranks who deserves capital; this method decides how
              many names that cheque can meaningfully move, and how much any one
              of them may take. Nothing is recorded until you register the
              trade.
            </Trans>
          </Callout>

          <Topic
            title={
              <Trans id="documentation.contribution.thresholdsTitle">
                Configurable thresholds
              </Trans>
            }
            description={
              <Trans id="documentation.contribution.thresholdsDescription">
                These knobs feed the split below. Values are saved to the
                database for this account.
              </Trans>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <PercentField
                name="smallBookImpact"
                label={
                  <Trans id="documentation.contribution.field.smallImpact">
                    Small-book weight impact
                  </Trans>
                }
                description={
                  <Trans id="documentation.contribution.field.smallImpactHint">
                    Minimum portfolio-weight move on a book of {smallBook} or
                    less. A second name needs about 1.5× this slice.
                  </Trans>
                }
              />
              <PercentField
                name="largeBookImpact"
                label={
                  <Trans id="documentation.contribution.field.largeImpact">
                    Large-book weight impact
                  </Trans>
                }
                description={
                  <Trans id="documentation.contribution.field.largeImpactHint">
                    Minimum portfolio-weight move on a book of {largeBook} or
                    more. Between the two sizes the impact is interpolated in
                    log space.
                  </Trans>
                }
              />
              <PercentField
                name="maxShare"
                label={
                  <Trans id="documentation.contribution.field.maxShare">
                    Maximum share per asset
                  </Trans>
                }
                description={
                  <Trans id="documentation.contribution.field.maxShareHint">
                    When two or more names sit at the table, no single asset
                    receives more than this fraction of the contribution.
                  </Trans>
                }
              />
              <FormField
                control={form.control}
                name="maxAssets"
                render={({ field }) => (
                  <FormItem className="rounded-lg border px-3.5 py-3">
                    <FormLabel>
                      <Trans id="documentation.contribution.field.maxAssets">
                        Maximum assets
                      </Trans>
                    </FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          step={1}
                          className="max-w-28"
                          value={field.value}
                          onChange={(event) =>
                            field.onChange(Number(event.target.value))
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          <Trans id="documentation.contribution.unit.assets">
                            names
                          </Trans>
                        </span>
                      </div>
                    </FormControl>
                    <FormDescription>
                      <Trans id="documentation.contribution.field.maxAssetsHint">
                        Diversification ceiling for a relatively large
                        contribution.
                      </Trans>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <PercentField
                name="starterFraction"
                label={
                  <Trans id="documentation.contribution.field.starterFraction">
                    Starter position size
                  </Trans>
                }
                description={
                  <Trans id="documentation.contribution.field.starterFractionHint">
                    Share of its target a not-yet-held asset may reach in one
                    contribution, so new positions are built over several
                    cheques.
                  </Trans>
                }
              />
            </div>
          </Topic>

          <Topic
            title={
              <Trans id="documentation.contribution.splitTitle">
                How the amount is split
              </Trans>
            }
          >
            <ol className="grid gap-2">
              <Rule
                number="1"
                title={
                  <Trans id="documentation.contribution.chooseCount">
                    Count how many names the cheque can move
                  </Trans>
                }
                badge={
                  <ThresholdChip>
                    {smallImpact}→{largeImpact}
                  </ThresholdChip>
                }
              >
                <Trans id="documentation.contribution.chooseCountDescription">
                  Compare the contribution C with the quoted portfolio V. The
                  minimum weight impact interpolates from {smallImpact} at{" "}
                  {smallBook} to {largeImpact} at {largeBook}. Round the ratio
                  so a second name opens at 1.5× a minimum slice, then clamp
                  between 1 and {preview.maxAssets}. An empty book is treated as
                  a large relative size so the first cheque can diversify. A
                  manual override skips this step.
                </Trans>
                <Formula>
                  <Trans id="documentation.formula.candidateCount">
                    N = clamp(round(C / (V × impact(V))), 1, {preview.maxAssets}
                    )
                  </Trans>
                </Formula>
              </Rule>
              <Rule
                number="2"
                title={
                  <Trans id="documentation.contribution.measureNeed">
                    Measure each need after the contribution
                  </Trans>
                }
              >
                <Trans id="documentation.contribution.measureNeedDescription">
                  A contribution dilutes every weight, so each candidate&apos;s
                  need is measured against the book after it: the money that
                  takes it exactly to its valuation-adjusted target. Room is
                  then limited by the weight ceilings of the score and, for an
                  asset not yet held, by the starter size of {starterShare} of
                  its target. Automatic mode seats the best-ranked names whose
                  room is at least a minimum-impact slice.
                </Trans>
                <Formula>
                  <Trans id="documentation.formula.postNeed">
                    need = adjusted target × (V + C) - held value
                  </Trans>
                </Formula>
              </Rule>
              <Rule
                number="3"
                title={
                  <Trans id="documentation.contribution.waterFilling">
                    Fill the emptiest targets first
                  </Trans>
                }
              >
                <Trans id="documentation.contribution.waterFillingDescription">
                  The split minimizes the priority-weighted squared distance to
                  target, relative to each target. The solution raises the
                  emptiest assets first until all funded names share the same
                  priority-weighted fill level, like water filling containers of
                  different heights. A higher priority ends closer to its
                  target. The level is solved exactly, not by iteration.
                </Trans>
                <Formula>
                  <Trans id="documentation.formula.waterFilling">
                    slice = clamp(need - level × target / priority, 0, room)
                  </Trans>
                </Formula>
              </Rule>
              <Rule
                number="4"
                title={
                  <Trans id="documentation.contribution.shareCap">
                    Cap concentration and scored need
                  </Trans>
                }
                badge={<ThresholdChip>{shareCap}</ThresholdChip>}
              >
                <Trans id="documentation.contribution.shareCapDescriptionV2">
                  With two or more names, nobody receives more than {shareCap}{" "}
                  of the contribution, and the level is solved again with that
                  cap. In automatic mode, a seat whose slice is below a
                  minimum-impact slice is released when the others can absorb
                  its money, keeping at least two names.
                </Trans>
              </Rule>
              <Rule
                number="5"
                title={
                  <Trans id="documentation.contribution.waterfall">
                    Waterfall leftover capital
                  </Trans>
                }
              >
                <Trans id="documentation.contribution.waterfallDescriptionV2">
                  When every seated name reached its room and money is left, the
                  next ranked name takes a seat and the split is solved again,
                  up to {preview.maxAssets} names. Only money no candidate has
                  room for is disclosed as unallocated.
                </Trans>
              </Rule>
              <Rule
                number="6"
                title={
                  <Trans id="documentation.contribution.moneyAndUnits">
                    Suggest money and units
                  </Trans>
                }
              >
                <Trans id="documentation.contribution.moneyAndUnitsDescription">
                  Each money slice is rounded independently to cents. Any
                  rounding difference is disclosed as an unallocated remainder.
                  Units are the slice divided by the asset&apos;s execution
                  price. B3 shares, FIIs, ETFs and BDRs held in BRL are bought
                  in whole units: each slice is floored to whole shares, the
                  freed money buys another share where the slice still has room,
                  and the rest is disclosed as unallocated.
                </Trans>
              </Rule>
            </ol>
          </Topic>

          <Topic
            title={
              <Trans id="documentation.contribution.examplesTitle">
                Worked examples
              </Trans>
            }
            description={
              <Trans id="documentation.contribution.examplesDescription">
                Defaults: {smallImpact} on books up to {smallBook},{" "}
                {largeImpact} from {largeBook}, {shareCap} share cap,{" "}
                {preview.maxAssets} names maximum.
              </Trans>
            }
          >
            <ul className="grid gap-2">
              <li className="rounded-lg border px-3.5 py-3">
                <p className="font-medium text-foreground">
                  <Trans id="documentation.contribution.exampleSmallTitle">
                    R$ 2,000 into a R$ 50,000 book
                  </Trans>
                </p>
                <p>
                  <Trans id="documentation.contribution.exampleSmallDescription">
                    The small-book impact is {smallImpact}, so a minimum slice
                    is R$ 1,000. Rounding 2,000 / 1,000 opens a second name.
                  </Trans>
                </p>
              </li>
              <li className="rounded-lg border px-3.5 py-3">
                <p className="font-medium text-foreground">
                  <Trans id="documentation.contribution.exampleLargeTitle">
                    R$ 2,000 into a R$ 1,000,000 book
                  </Trans>
                </p>
                <p>
                  <Trans id="documentation.contribution.exampleLargeDescription">
                    The large-book impact is {largeImpact}, so a minimum slice
                    is R$ 5,000. Two thousand reais stays in one name; N = 2
                    only from about R$ 7,500.
                  </Trans>
                </p>
              </li>
              <li className="rounded-lg border px-3.5 py-3">
                <p className="font-medium text-foreground">
                  <Trans id="documentation.contribution.exampleFillTitle">
                    Same gap, different targets
                  </Trans>
                </p>
                <p>
                  <Trans id="documentation.contribution.exampleFillDescription">
                    R$ 10,000 on a R$ 1,000,000 book: one asset is at 8% of a
                    10% target, another at 0.2% of a 2% target. Both miss 2
                    points, but the second is 90% empty, so it is funded first
                    and receives R$ 7,000 (the share cap) against R$ 3,000.
                  </Trans>
                </p>
              </li>
              <li className="rounded-lg border px-3.5 py-3">
                <p className="font-medium text-foreground">
                  <Trans id="documentation.contribution.exampleStarterTitle">
                    A brand-new position
                  </Trans>
                </p>
                <p>
                  <Trans id="documentation.contribution.exampleStarterDescription">
                    A watch-only asset with a 5% target on a R$ 1,000,000 book
                    receiving R$ 100,000 gets at most {starterShare} of 5% of R$
                    1,100,000 in this cheque; the rest of its target waits for
                    later contributions.
                  </Trans>
                </p>
              </li>
            </ul>
          </Topic>

          <Topic
            title={
              <Trans id="documentation.contribution.vetTitle">
                USD execution rate (VET)
              </Trans>
            }
          >
            <p>
              <Trans id="documentation.contribution.vetDescription">
                When a USD asset is sized in BRL, the suggested unit count
                includes the configured broker spread and IOF. These costs are
                compounded, not added. The planner reports USD asset
                contributions in USD using this VET; BRL assets remain in the
                BRL total.
              </Trans>
            </p>
            <Formula>
              <Trans id="documentation.formula.executionRate">
                execution USD/BRL = spot × (1 + {fxSpread} spread) × (1 +{" "}
                {fxIof} IOF)
              </Trans>
            </Formula>
            <p>
              <Trans id="documentation.contribution.vetPolicy">
                With the current policy, the execution rate is {fxMarkup}% above
                spot. VET is used for suggested units and USD asset contribution
                amounts. The planner splits its final totals by asset currency
                instead of converting the full contribution into both
                currencies. Portfolio value, allocation weights, results, and
                every other FX conversion continue to use spot.
              </Trans>
            </p>
          </Topic>

          <Topic
            title={
              <Trans id="documentation.contribution.missingPrices">
                Missing prices
              </Trans>
            }
          >
            <p>
              <Trans id="documentation.contribution.missingPricesDescription">
                A slice can still receive a money amount when its score is
                positive, but suggested units stay unavailable until a live or
                manual price is present. The application never substitutes zero
                for a missing quote.
              </Trans>
            </p>
          </Topic>
        </DocumentBody>
      </form>
    </Form>
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
  name: "smallBookImpact" | "largeBookImpact" | "maxShare" | "starterFraction";
  label: ReactNode;
  description: ReactNode;
}) {
  const form = useFormContext<ContributionPlanConfigUpdate>();

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
