import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  BookOpen,
  Calculator,
  ChartLine,
  type LucideIcon,
  Search,
  Target,
  WalletCards,
} from "lucide-react";
import { useState } from "react";
import { ContributionPlanDocumentation } from "@/components/contribution-plan-documentation";
import {
  Callout,
  Definition,
  DocumentBody,
  Formula,
  Topic,
} from "@/components/documentation-primitives";
import { ScoreDocumentation } from "@/components/score-documentation";
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
              <ContributionPlanDocumentation />
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
          How the next-contribution priority is calculated, and the thresholds
          you can tune.
        </Trans>
      );
    case "contributions":
      return (
        <Trans id="documentation.section.contributionsDescription">
          How a contribution is split across names, and the thresholds you can
          tune.
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
          Daily FX-inclusive change, Deep Finder baselines, and estimated
          dividend entitlement.
        </Trans>
      );
  }
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

      <Topic
        title={
          <Trans id="documentation.comparisons.dailyTitle">
            Daily performance
          </Trans>
        }
      >
        <p>
          <Trans id="documentation.comparisons.dailyDescription">
            Daily change is today&apos;s converted wealth minus yesterday&apos;s
            converted wealth. The previous close is converted at the previous
            weekday&apos;s USD/BRL rate, and today uses the live rate, so a
            foreign-currency holding includes both the asset move and the
            dollar. Switching the display currency inverts that conversion. Cash
            has no market previous close; in USD it still moves with the rate. A
            manual FX rate has no history, so both days share it.
          </Trans>
        </p>
        <Formula>
          daily change = today (fx today) - previous close (fx yesterday)
        </Formula>
        <p>
          <Trans id="documentation.comparisons.dailyPercent">
            The portfolio percentage is that change divided by yesterday&apos;s
            comparable value, including cash. It is not the same as each
            ticker&apos;s native-currency return, and it is not the open result
            against moving-average cost.
          </Trans>
        </p>
      </Topic>

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
