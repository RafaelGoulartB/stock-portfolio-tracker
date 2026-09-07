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
                  N = clamp(round(C / (V × impact(V))), 1, {preview.maxAssets})
                </Formula>
              </Rule>
              <Rule
                number="2"
                title={
                  <Trans id="documentation.contribution.inviteNames">
                    Invite names with enough scored need
                  </Trans>
                }
              >
                <Trans id="documentation.contribution.inviteNamesDescription">
                  Keep assets with a score above zero, ranked highest first.
                  Automatic mode then skips a name whose scored need is smaller
                  than a minimum-impact slice of the current book, so a dominant
                  score cannot sprinkle crumbs. If nobody qualifies, the top
                  name still sits at the table. Manual and &quot;every
                  candidate&quot; keep the ranked list intact.
                </Trans>
                <Formula>scored need = score × (V + C) ≥ V × impact(V)</Formula>
              </Rule>
              <Rule
                number="3"
                title={
                  <Trans id="documentation.contribution.proportionalShare">
                    Assign a proportional share
                  </Trans>
                }
              >
                <Trans id="documentation.contribution.proportionalShareDescription">
                  Each invited asset starts with its score divided by the sum of
                  the invited scores.
                </Trans>
                <Formula>
                  asset share = asset score / invited score total
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
                <Trans id="documentation.contribution.shareCapDescription">
                  With two or more names, nobody receives more than {shareCap}{" "}
                  of the contribution. Independently, nobody receives more than
                  their scored need. Excess is redistributed to invited names
                  that still have room.
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
                <Trans id="documentation.contribution.waterfallDescription">
                  Money the first club cannot absorb still flows down the ranked
                  list, one name at a time, up to {preview.maxAssets}. A name is
                  skipped when its scored need is below one cent. Only leftover
                  after that walk is disclosed as unallocated.
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
                  price.
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
                  <Trans id="documentation.contribution.exampleCrumbTitle">
                    Tiny scored need and leftover capital
                  </Trans>
                </p>
                <p>
                  <Trans id="documentation.contribution.exampleCrumbDescription">
                    Three names at 0.001 on a R$ 1,000,000 book with a R$ 50,000
                    cheque: each need is filled in score order, then leftover
                    that nobody can absorb stays unallocated.
                  </Trans>
                </p>
              </li>
              <li className="rounded-lg border px-3.5 py-3">
                <p className="font-medium text-foreground">
                  <Trans id="documentation.contribution.exampleCapTitle">
                    A large cheque with one very high score
                  </Trans>
                </p>
                <p>
                  <Trans id="documentation.contribution.exampleCapDescription">
                    When the unconstrained split would give one name more than{" "}
                    {shareCap}, that name is pinned at the cap and the rest is
                    redistributed by score.
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
              execution USD/BRL = spot × (1 + {fxSpread} spread) × (1 + {fxIof}{" "}
              IOF)
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
  name: "smallBookImpact" | "largeBookImpact" | "maxShare";
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
