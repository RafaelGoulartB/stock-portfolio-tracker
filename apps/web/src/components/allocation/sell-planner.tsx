import { Trans } from "@lingui/react/macro";
import type {
  AllocationRow,
  Currency,
  ScoreConfig,
  ValuationSkill,
} from "@portifolio-tracker/shared";
import {
  BR_STOCK_SALE_EXEMPTION_BRL,
  DEFAULT_SCORE_CONFIG,
  tradesInWholeUnits,
} from "@portifolio-tracker/shared";
import { HandCoins, Info, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { AssetLink } from "@/components/asset-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  formatMoney,
  formatQuantity,
  formatSignedWeightPrecise,
  formatWeight,
  formatWeightPrecise,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  planSales,
  type SellSuggestion,
} from "../../../../api/src/domain/sell-plan";

/**
 * Suggested sales of expensive positions that ran past their adjusted
 * target, kept apart from contributions. Sales are only *recommended* once
 * the valuation track record earns it; before that they are informational.
 */
export function SellPlannerButton({
  rows,
  displayCurrency,
  portfolioValue,
  usdBrlRate,
  soldThisMonthBrl,
  skill,
  config,
  disabled = false,
}: {
  rows: AllocationRow[];
  displayCurrency: Currency;
  portfolioValue: string;
  usdBrlRate: string | null;
  soldThisMonthBrl: string;
  skill: ValuationSkill | undefined;
  config: ScoreConfig | undefined;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const plan = useMemo(
    () =>
      planSales({
        rows: rows
          .filter((row) => row.hasPosition)
          .map((row) => ({
            ticker: row.ticker,
            assetClass: row.assetClass,
            currency: row.currency,
            quantity: row.quantity,
            marketValue: row.marketValue,
            currentWeight: row.currentWeight,
            trimTarget: row.score.trimTarget,
            fairValue: row.fairValue,
            marketPrice: row.marketPrice,
            wholeUnits: tradesInWholeUnits(row.assetClass, row.currency),
          })),
        portfolioValue,
        displayCurrency,
        usdBrlRate,
        soldThisMonthBrl,
        confidence: skill?.confidence ?? "0",
        partialTrackRecord: (skill?.missing ?? 0) > 0,
        config,
      }),
    [
      rows,
      portfolioValue,
      displayCurrency,
      usdBrlRate,
      soldThisMonthBrl,
      skill,
      config,
    ],
  );
  const count = plan.exempt.length + plan.taxable.length;
  const money = (value: string | null) =>
    value === null ? "—" : formatMoney(value, displayCurrency);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <HandCoins aria-hidden="true" />
          <Trans id="allocation.sales.open">Sale suggestions</Trans>
          {count > 0 ? (
            // Muted while sales are only informational, so the count does not
            // read as a call to sell.
            <Badge
              variant={plan.recommended ? "secondary" : "outline"}
              className={cn(
                "ml-0.5 px-1.5",
                !plan.recommended && "text-muted-foreground",
              )}
            >
              {count}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <DialogTitleIcon>
              <HandCoins aria-hidden="true" />
            </DialogTitleIcon>
            <Trans id="allocation.sales.title">Sale suggestions</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="allocation.sales.descriptionV2">
              Positions priced above your fair value that ran more than{" "}
              {formatWeight(config?.sellBand ?? DEFAULT_SCORE_CONFIG.sellBand)}{" "}
              past their sale target, trimmed toward it. The sale target never
              sits below what the asset&apos;s own valuation justifies.
              Suggestion only — nothing is saved until you register the sale.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        {plan.recommended ? (
          <Alert>
            <ShieldCheck aria-hidden="true" />
            <AlertTitle>
              <Trans id="allocation.sales.recommendedTitle">
                Recommended by your track record
              </Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans id="allocation.sales.recommendedText">
                Your fair values reached {formatWeight(plan.confidence)}{" "}
                confidence (bar: {formatWeight(plan.requiredConfidence)}), the
                level at which selling expensive positions paid off in the
                simulation.
              </Trans>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <Info aria-hidden="true" />
            <AlertTitle>
              <Trans id="allocation.sales.infoTitle">
                For information only
              </Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans id="allocation.sales.infoText">
                Confidence in your fair values is{" "}
                {formatWeight(plan.confidence)}; sales are recommended from{" "}
                {formatWeight(plan.requiredConfidence)}. Without a proven track
                record, selling on valuation alone lost money in the simulation
                when fair values were biased. Consider simply not contributing
                to these assets.
              </Trans>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          <div className="grid gap-0.5">
            <span className="text-xs text-muted-foreground">
              <Trans id="allocation.sales.limit">Monthly exemption</Trans>
            </span>
            <span className="font-semibold tabular-nums">
              {money(plan.exemptLimit)}
            </span>
          </div>
          <div className="grid gap-0.5">
            <span className="text-xs text-muted-foreground">
              <Trans id="allocation.sales.sold">Sold this month</Trans>
            </span>
            <span className="font-semibold tabular-nums">
              {money(plan.soldThisMonth)}
            </span>
          </div>
          <div className="grid gap-0.5">
            <span className="text-xs text-muted-foreground">
              <Trans id="allocation.sales.remaining">Still exempt</Trans>
            </span>
            <span className="font-semibold tabular-nums">
              {money(plan.remaining)}
            </span>
          </div>
        </div>

        <section className="grid gap-2">
          <h3 className="text-sm font-medium">
            <Trans id="allocation.sales.exemptTitle">
              Brazilian stocks, inside the exemption
            </Trans>
          </h3>
          {plan.exempt.length === 0 ? (
            <p className="rounded-lg border bg-muted/40 px-4 py-4 text-center text-sm text-muted-foreground">
              <Trans id="allocation.sales.exemptEmpty">
                No Brazilian stock is above its fair value and past the band.
              </Trans>
            </p>
          ) : (
            <>
              {plan.scaled ? (
                <p className="text-xs text-muted-foreground">
                  <Trans id="allocation.sales.scaledV2">
                    Bringing every position back to its sale target would sell{" "}
                    {money(plan.exemptExcess)}, more than is still exempt, so
                    each sale was reduced by the same share.
                  </Trans>
                </p>
              ) : null}
              <SuggestionList
                items={plan.exempt}
                displayCurrency={displayCurrency}
              />
            </>
          )}
        </section>

        {plan.taxable.length > 0 ? (
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">
              <Trans id="allocation.sales.taxableTitle">
                Outside the exemption (taxed if sold)
              </Trans>
            </h3>
            <p className="text-xs text-muted-foreground">
              <Trans id="allocation.sales.taxableTextV2">
                FIIs, ETFs, BDRs, foreign assets, and Brazilian stocks once the
                month&apos;s exemption is used up pay tax on any gain. Letting
                contributions go elsewhere usually beats selling them.
              </Trans>
            </p>
            <SuggestionList
              items={plan.taxable}
              displayCurrency={displayCurrency}
            />
          </section>
        ) : null}

        <p className="text-xs text-muted-foreground">
          <Trans id="allocation.sales.footnoteV2">
            Exemption: gross sales of Brazilian stocks up to{" "}
            {formatMoney(BR_STOCK_SALE_EXEMPTION_BRL, "BRL")} per month (Lei
            11.033/2004). Sales already registered this month are deducted; once
            it is used up, further sales are listed as taxed. Confirm your case
            with an accountant.
          </Trans>
        </p>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionList({
  items,
  displayCurrency,
}: {
  items: readonly SellSuggestion[];
  displayCurrency: Currency;
}) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.ticker}
          className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm"
        >
          <AssetLink ticker={item.ticker} className="truncate font-semibold">
            {item.ticker}
          </AssetLink>
          <span className="text-xs text-muted-foreground tabular-nums">
            <Trans id="allocation.sales.weightsV2">
              {formatWeightPrecise(item.weightNow)} →{" "}
              {formatWeightPrecise(item.weightAfter)} (sale target{" "}
              {formatWeightPrecise(item.trimTarget)})
            </Trans>
            {item.discount !== null ? (
              <span className="block">
                <Trans id="allocation.sales.discount">
                  Discount to fair value:{" "}
                  {formatSignedWeightPrecise(item.discount)}
                </Trans>
              </span>
            ) : null}
          </span>
          <span className="text-right tabular-nums">
            <span className="block font-medium">
              {formatMoney(item.amount, displayCurrency)}
            </span>
            <span className="block text-xs text-muted-foreground">
              <Trans id="allocation.sales.units">
                {formatQuantity(item.units)} un.
              </Trans>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
