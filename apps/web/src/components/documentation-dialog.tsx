import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  DEFAULT_SCORE_CONFIG,
  FX_EXECUTION_IOF,
  FX_EXECUTION_SPREAD,
} from "@portifolio-tracker/shared";
import {
  BookOpen,
  Calculator,
  ChartLine,
  type LucideIcon,
  Search,
  Target,
  WalletCards,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTitleIcon,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type DocumentationSection =
  | "score"
  | "contributions"
  | "positions"
  | "performance"
  | "comparisons";

type SectionDefinition = {
  id: DocumentationSection;
  icon: LucideIcon;
};

const SECTIONS: readonly SectionDefinition[] = [
  {
    id: "score",
    icon: Target,
  },
  {
    id: "contributions",
    icon: Calculator,
  },
  {
    id: "positions",
    icon: WalletCards,
  },
  {
    id: "performance",
    icon: ChartLine,
  },
  {
    id: "comparisons",
    icon: Search,
  },
];

const SCORE = DEFAULT_SCORE_CONFIG;
const scoreCap = percent(SCORE.absoluteWeightCap);
const overweightLimit = percent(SCORE.overweightBlockFactor);
const trimLimit = percent(SCORE.trimFactor);
const fxSpread = percent(FX_EXECUTION_SPREAD);
const fxIof = percent(FX_EXECUTION_IOF);
const fxMarkup = (
  ((1 + Number(FX_EXECUTION_SPREAD)) * (1 + Number(FX_EXECUTION_IOF)) - 1) *
  100
).toFixed(4);

function percent(value: string): string {
  return `${Number(value) * 100}%`;
}

/** Header shortcut for the app-specific calculation and policy reference. */
export function DocumentationDialog() {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<DocumentationSection>("score");
  const active =
    SECTIONS.find((candidate) => candidate.id === section) ?? SECTIONS[0];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);

        if (!nextOpen) {
          setSection("score");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={i18n._(
            msg({ id: "documentation.open", message: "Documentation" }),
          )}
        >
          <BookOpen className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(46rem,calc(100svh-2rem))] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl sm:flex-row">
        <DocumentationSidebar section={section} onSectionChange={setSection} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DialogHeader className="gap-1.5 border-b bg-muted/20 px-6 py-5 pr-12 text-left">
            <DialogTitle className="flex items-center gap-3">
              <DialogTitleIcon>
                <active.icon aria-hidden="true" />
              </DialogTitleIcon>
              <span>
                <Trans id="documentation.title">Documentation</Trans>
                <span className="text-muted-foreground"> / </span>
                <DocumentationSectionLabel section={active.id} />
              </span>
            </DialogTitle>
            <DialogDescription>
              <DocumentationSectionDescription section={active.id} />
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {section === "score" ? (
              <ScoreDocumentation />
            ) : section === "contributions" ? (
              <ContributionDocumentation />
            ) : section === "positions" ? (
              <PositionDocumentation />
            ) : section === "performance" ? (
              <PerformanceDocumentation />
            ) : (
              <ComparisonDocumentation />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentationSidebar({
  section,
  onSectionChange,
}: {
  section: DocumentationSection;
  onSectionChange: (section: DocumentationSection) => void;
}) {
  const { i18n } = useLingui();
  const navLabel = i18n._(
    msg({
      id: "documentation.topics",
      message: "Documentation topics",
    }),
  );

  return (
    <>
      <nav
        className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 pr-12 sm:hidden"
        aria-label={navLabel}
      >
        {SECTIONS.map((item) => (
          <SectionButton
            key={item.id}
            item={item}
            active={section === item.id}
            onSelect={() => onSectionChange(item.id)}
          />
        ))}
      </nav>
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/40 sm:flex">
        <div className="flex items-center gap-2.5 border-b px-4 py-5 font-semibold">
          <BookOpen className="size-4" aria-hidden="true" />
          <Trans id="documentation.methodology">Methodology</Trans>
        </div>
        <nav className="flex flex-col gap-1 p-3" aria-label={navLabel}>
          {SECTIONS.map((item) => (
            <SectionButton
              key={item.id}
              item={item}
              active={section === item.id}
              onSelect={() => onSectionChange(item.id)}
            />
          ))}
        </nav>
      </aside>
    </>
  );
}

function SectionButton({
  item,
  active,
  onSelect,
}: {
  item: SectionDefinition;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      <DocumentationSectionLabel section={item.id} />
    </button>
  );
}

function DocumentationSectionLabel({
  section,
}: {
  section: DocumentationSection;
}) {
  switch (section) {
    case "score":
      return <Trans id="documentation.section.score">Contribution score</Trans>;
    case "contributions":
      return (
        <Trans id="documentation.section.contributions">
          Contribution planner
        </Trans>
      );
    case "positions":
      return (
        <Trans id="documentation.section.positions">
          Cost basis and P&amp;L
        </Trans>
      );
    case "performance":
      return <Trans id="documentation.section.performance">Performance</Trans>;
    case "comparisons":
      return (
        <Trans id="documentation.section.comparisons">
          Comparisons and income
        </Trans>
      );
  }
}

function DocumentationSectionDescription({
  section,
}: {
  section: DocumentationSection;
}) {
  switch (section) {
    case "score":
      return (
        <Trans id="documentation.section.scoreDescription">
          How the next-contribution priority is calculated.
        </Trans>
      );
    case "contributions":
      return (
        <Trans id="documentation.section.contributionsDescription">
          Allocation slices, suggested units, and the USD execution rate.
        </Trans>
      );
    case "positions":
      return (
        <Trans id="documentation.section.positionsDescription">
          Moving average cost, fees, sales, and currency consolidation.
        </Trans>
      );
    case "performance":
      return (
        <Trans id="documentation.section.performanceDescription">
          Time-weighted returns, compounding, and missing-price policy.
        </Trans>
      );
    case "comparisons":
      return (
        <Trans id="documentation.section.comparisonsDescription">
          Deep Finder baselines and estimated dividend entitlement.
        </Trans>
      );
  }
}

function ScoreDocumentation() {
  return (
    <DocumentBody>
      <Callout
        icon={Target}
        title={
          <Trans id="documentation.score.policyVersion">
            Policy version {SCORE.version}
          </Trans>
        }
      >
        <Trans id="documentation.score.intro">
          The score answers how strongly an asset should compete for the next
          contribution. It is expressed in portfolio-weight units: a score of
          0.0075 means 0.75 percentage points. Positive values are buy
          candidates, zero means skip, and a negative value is a trim signal.
        </Trans>
      </Callout>

      <Topic
        title={
          <Trans id="documentation.score.coreCalculation">
            Core calculation
          </Trans>
        }
      >
        <Definition
          term={
            <Trans id="documentation.score.fairValueDiscount">
              Fair-value discount
            </Trans>
          }
        >
          <Trans id="documentation.score.fairValueDiscountDescription">
            Positive when the market price is below the newest quarterly Fair
            value; negative when it is above it. A missing Fair value or price
            is treated as a zero discount by the score.
          </Trans>
        </Definition>
        <Formula>(fair value - market price) / fair value</Formula>
        <Definition
          term={
            <Trans id="documentation.score.adjustedTarget">
              Adjusted target
            </Trans>
          }
        >
          <Trans id="documentation.score.adjustedTargetDescription">
            A discount raises the target used for this decision; a premium
            lowers it.
          </Trans>
        </Definition>
        <Formula>target weight × (1 + discount)</Formula>
        <Definition
          term={<Trans id="documentation.score.rawGap">Raw gap</Trans>}
        >
          <Trans id="documentation.score.rawGapDescription">
            The distance between the adjusted target and the asset&apos;s
            current portfolio weight.
          </Trans>
        </Definition>
        <Formula>adjusted target - current weight</Formula>
      </Topic>

      <Topic
        title={
          <Trans id="documentation.score.gradeMultiplier">
            Quarterly grade multiplier
          </Trans>
        }
      >
        <p>
          <Trans id="documentation.score.gradeDescription">
            The grade is the average of the newest {SCORE.gradeWindowQuarters}{" "}
            quarters that actually contain a grade. Notes-only reviews are
            ignored. An asset with no grades uses a neutral ×
            {SCORE.ungradedMultiplier} multiplier.
          </Trans>
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SCORE.gradeBands.map((band, index) => {
            const next = SCORE.gradeBands[index + 1];

            return (
              <Definition
                key={band.minGrade}
                term={
                  next ? (
                    <Trans id="documentation.score.gradeRange">
                      Grade ≥ {band.minGrade} and &lt; {next.minGrade}
                    </Trans>
                  ) : (
                    <Trans id="documentation.score.gradeMinimum">
                      Grade ≥ {band.minGrade}
                    </Trans>
                  )
                }
              >
                <Trans id="documentation.score.gapMultiplier">
                  Gap multiplier ×{band.multiplier}
                </Trans>
              </Definition>
            );
          })}
        </div>
      </Topic>

      <Topic
        title={<Trans id="documentation.score.ruleLadder">Rule ladder</Trans>}
      >
        <p>
          <Trans id="documentation.score.ruleLadderDescription">
            Rules run in this exact order and the first match wins. This
            priority is part of the method.
          </Trans>
        </p>
        <ol className="grid gap-2">
          <Rule
            number="1"
            title={<Trans id="documentation.score.noTarget">No target</Trans>}
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
          >
            <Trans id="documentation.score.cooldownDescription">
              Block the asset for {SCORE.cooldownDays} days after its latest
              buy. Sells do not reset the clock; the asset is eligible again on
              day {SCORE.cooldownDays}.
            </Trans>
          </Rule>
          <Rule
            number="6"
            title={
              <Trans id="documentation.score.normalCandidate">
                Normal candidate
              </Trans>
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
  );
}

function ContributionDocumentation() {
  return (
    <DocumentBody>
      <Callout
        icon={Calculator}
        title={
          <Trans id="documentation.contribution.suggestionTitle">
            A suggestion, not a transaction
          </Trans>
        }
      >
        <Trans id="documentation.contribution.suggestionDescription">
          The planner estimates how to split a new amount. It never changes the
          portfolio; only a registered trade changes positions and cost basis.
        </Trans>
      </Callout>

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
              <Trans id="documentation.contribution.chooseCandidates">
                Choose candidates
              </Trans>
            }
          >
            <Trans id="documentation.contribution.chooseCandidatesDescription">
              Keep only assets with a score above zero, rank them from highest
              to lowest, and select the requested top count or every candidate.
            </Trans>
          </Rule>
          <Rule
            number="2"
            title={
              <Trans id="documentation.contribution.proportionalShare">
                Assign a proportional share
              </Trans>
            }
          >
            <Trans id="documentation.contribution.proportionalShareDescription">
              Each selected asset receives its score divided by the sum of the
              selected scores.
            </Trans>
            <Formula>asset share = asset score / selected score total</Formula>
          </Rule>
          <Rule
            number="3"
            title={
              <Trans id="documentation.contribution.moneyAndUnits">
                Suggest money and units
              </Trans>
            }
          >
            <Trans id="documentation.contribution.moneyAndUnitsDescription">
              Each money slice is rounded independently to cents. Any rounding
              difference is disclosed as an unallocated remainder. Units are the
              slice divided by the asset&apos;s execution price.
            </Trans>
          </Rule>
        </ol>
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
            When a USD asset is sized in BRL, the suggested unit count includes
            the configured broker spread and IOF. These costs are compounded,
            not added.
          </Trans>
        </p>
        <Formula>
          execution USD/BRL = spot × (1 + {fxSpread} spread) × (1 + {fxIof} IOF)
        </Formula>
        <p>
          <Trans id="documentation.contribution.vetPolicy">
            With the current policy, the execution rate is {fxMarkup}% above
            spot. VET is used only for suggested units when converting USD to
            BRL. Portfolio value, allocation weights, results, and every other
            FX conversion continue to use spot.
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
            A slice can still receive a money amount when its score is positive,
            but suggested units stay unavailable until a live or manual price is
            present. The application never substitutes zero for a missing quote.
          </Trans>
        </p>
      </Topic>
    </DocumentBody>
  );
}

function PositionDocumentation() {
  return (
    <DocumentBody>
      <Callout
        icon={WalletCards}
        title={
          <Trans id="documentation.positions.movingAverageTitle">
            Moving average, never FIFO
          </Trans>
        }
      >
        <Trans id="documentation.positions.movingAverageDescription">
          Every ticker is consolidated chronologically with moving average cost.
          Transactions on the same day use their creation order. Each ticker can
          use only one native currency, and currencies are never averaged
          together.
        </Trans>
      </Callout>

      <Topic
        title={
          <Trans id="documentation.positions.buysTitle">
            Buys and average price
          </Trans>
        }
      >
        <p>
          <Trans id="documentation.positions.buysDescription">
            A buy adds its gross value and fees to the cost still held. Average
            price is always the remaining cost basis divided by the remaining
            quantity.
          </Trans>
        </p>
        <Formula>buy cost = quantity × price + fees</Formula>
        <Formula>
          average price = remaining cost basis / remaining quantity
        </Formula>
      </Topic>

      <Topic
        title={
          <Trans id="documentation.positions.salesTitle">
            Sales and realized P&amp;L
          </Trans>
        }
      >
        <p>
          <Trans id="documentation.positions.salesDescription">
            A sale releases cost at the moving average that existed immediately
            before that sale. Fees reduce the proceeds. Selling does not reprice
            the units that remain.
          </Trans>
        </p>
        <Formula>released cost = sold quantity × current average price</Formula>
        <Formula>
          realized P&amp;L = quantity × sale price - fees - released cost
        </Formula>
        <p>
          <Trans id="documentation.positions.zeroQuantity">
            When quantity reaches zero, the remaining cost basis is reset to
            zero. Unrealized P&amp;L on an open position is current market value
            minus its remaining cost basis.
          </Trans>
        </p>
      </Topic>

      <Topic
        title={
          <Trans id="documentation.positions.currencyTitle">
            Currency consolidation
          </Trans>
        }
      >
        <p>
          <Trans id="documentation.positions.currencyDescription">
            Native amounts remain in the asset&apos;s currency. The portfolio
            then converts them to the selected BRL or USD display currency using
            the current spot rate. Consequently, converted realized P&amp;L on
            live position screens is an approximation at today&apos;s
            consolidation rate, not historical-FX tax accounting.
          </Trans>
        </p>
        <p>
          <Trans id="documentation.positions.missingQuote">
            Allocation weights use quoted market value in the display currency.
            An open position without a live or manual quote is flagged and left
            out of the quoted-value denominator rather than valued at zero. Its
            current-weight input to the score consequently falls back to zero,
            while its suggested unit count remains unavailable until it has a
            price.
          </Trans>
        </p>
      </Topic>
    </DocumentBody>
  );
}

function PerformanceDocumentation() {
  return (
    <DocumentBody>
      <Callout
        icon={ChartLine}
        title={
          <Trans id="documentation.performance.monthlyTitle">
            Monthly time-weighted performance
          </Trans>
        }
      >
        <Trans id="documentation.performance.monthlyDescription">
          The performance page uses Modified Dietz so deposits and withdrawals
          do not masquerade as investment return. Each month is calculated
          separately and then compounded.
        </Trans>
      </Callout>

      <Topic
        title={
          <Trans id="documentation.performance.cashFlowsTitle">
            Cash flows and timing
          </Trans>
        }
      >
        <p>
          <Trans id="documentation.performance.cashFlowsDescription">
            Buys are positive invested cash, including fees. Sales are negative
            invested cash, using proceeds after fees. Each flow is weighted by
            the fraction of calendar days left in that month, so a contribution
            on the last day barely affects the month&apos;s return base.
          </Trans>
        </p>
        <Formula>
          flow weight = days remaining in period / days in period
        </Formula>
        <Formula>
          monthly return = (end value - start value - net flows) / (start value
          + weighted flows)
        </Formula>
      </Topic>

      <Topic
        title={
          <Trans id="documentation.performance.compoundingTitle">
            Compounding, annualization, and drawdown
          </Trans>
        }
      >
        <Definition
          term={
            <Trans id="documentation.performance.cumulativeReturn">
              Cumulative return
            </Trans>
          }
        >
          <Trans id="documentation.performance.cumulativeReturnDescription">
            Multiply one plus each valid monthly return, then subtract one.
          </Trans>
        </Definition>
        <Definition
          term={
            <Trans id="documentation.performance.annualizedReturn">
              Annualized return
            </Trans>
          }
        >
          <Trans id="documentation.performance.annualizedReturnDescription">
            Restate cumulative growth to a 12-month rate. It is intentionally
            not shown for windows shorter than 6 months.
          </Trans>
        </Definition>
        <Definition
          term={<Trans id="documentation.performance.drawdown">Drawdown</Trans>}
        >
          <Trans id="documentation.performance.drawdownDescription">
            The percentage distance of the compounded return index from its
            previous peak. Maximum drawdown is the deepest such decline.
          </Trans>
        </Definition>
      </Topic>

      <Topic
        title={
          <Trans id="documentation.performance.historyTitle">
            Historical prices, FX, and gaps
          </Trans>
        }
      >
        <p>
          <Trans id="documentation.performance.historyDescription">
            Month ends use the last available market close on or before the
            snapshot day. Positions are converted with the USD/BRL rate of that
            snapshot, and transaction flows use the rate of their own trade day.
            A manual FX rate has no history, so the same manual rate is applied
            to every month.
          </Trans>
        </p>
        <p>
          <Trans id="documentation.performance.fallbackDescription">
            If a position has no historical price, it is carried at its
            remaining cost basis to keep the portfolio curve continuous. The
            page counts and discloses these cost-fallback positions. A month
            with a non-positive return base has no calculated return.
          </Trans>
        </p>
      </Topic>

      <Topic
        title={
          <Trans id="documentation.performance.contributionTitle">
            Result contribution
          </Trans>
        }
      >
        <p>
          <Trans id="documentation.performance.contributionDescription">
            The contribution shown for an asset or class is its unrealized
            P&amp;L divided by the entire portfolio&apos;s invested cost. It
            answers how many percentage points that item adds to the
            portfolio&apos;s open result; it is not the item&apos;s own return
            percentage.
          </Trans>
        </p>
      </Topic>
    </DocumentBody>
  );
}

function ComparisonDocumentation() {
  return (
    <DocumentBody>
      <Callout
        icon={Search}
        title={
          <Trans id="documentation.comparisons.missingDataTitle">
            Comparisons preserve missing data
          </Trans>
        }
      >
        <Trans id="documentation.comparisons.missingDataDescription">
          Deep Finder and income estimates report unavailable observations
          explicitly. A missing quote, baseline, FX rate, or provider event is
          never silently converted to zero.
        </Trans>
      </Callout>

      <Topic title="Deep Finder">
        <Definition
          term={
            <Trans id="documentation.comparisons.costView">Cost view</Trans>
          }
        >
          <Trans id="documentation.comparisons.costViewDescription">
            Change is the open position&apos;s market value minus moving-average
            cost.
          </Trans>
        </Definition>
        <Definition
          term={
            <Trans id="documentation.comparisons.periodViews">
              Period views
            </Trans>
          }
        >
          <Trans id="documentation.comparisons.periodViewsDescription">
            The app compares today&apos;s open quantity at today&apos;s price
            with that same quantity at the baseline close. This isolates price
            movement and is not the realized performance of trades made during
            the period.
          </Trans>
        </Definition>
        <Formula>
          period change = current quantity × (current price - baseline price)
        </Formula>
        <p>
          <Trans id="documentation.comparisons.baselineDescription">
            The baseline is the last available close on or before the nominal
            window start. Year to date starts from December 31 of the prior
            year. The summary percentage is value-weighted: total change divided
            by total baseline value, not an average of ticker percentages.
          </Trans>
        </p>
      </Topic>

      <Topic
        title={
          <Trans id="documentation.comparisons.dividendTitle">
            Dividend entitlement
          </Trans>
        }
      >
        <p>
          <Trans id="documentation.comparisons.dividendDescription">
            Estimated eligible quantity is the consolidated position from trades
            strictly before the ex-date. Trades on the ex-date are excluded
            because that session no longer carries the entitlement.
          </Trans>
        </p>
        <Formula>
          estimated gross income = eligible quantity × amount per share
        </Formula>
        <p>
          <Trans id="documentation.comparisons.dividendStatus">
            Amounts are gross estimates: withholding, broker adjustments, and
            confirmed settlement are not modeled. Future ex-dates are announced;
            a past ex-date with a future payment date is scheduled; otherwise
            the event is labeled estimated paid. That last status is an
            inference, not payment confirmation.
          </Trans>
        </p>
        <p>
          <Trans id="documentation.comparisons.dividendFx">
            Mixed-currency totals use the currently selected USD/BRL rate, not a
            historical payment-date rate. When no conversion rate is available,
            the native amount remains visible and the event is excluded from the
            converted total.
          </Trans>
        </p>
      </Topic>
    </DocumentBody>
  );
}

function DocumentBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-2xl gap-6">{children}</div>;
}

function Topic({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <div className="grid gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Callout({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-lg border bg-muted/35 p-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {children}
        </p>
      </div>
    </div>
  );
}

function Definition({
  term,
  children,
}: {
  term: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border px-3.5 py-3">
      <p className="font-medium text-foreground">{term}</p>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
      {children}
    </code>
  );
}

function Rule({
  number,
  title,
  children,
}: {
  number: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-lg border px-3.5 py-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
        {number}
      </span>
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <div className="mt-1 grid gap-2 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
