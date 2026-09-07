import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AllocationRow, Currency } from "@portifolio-tracker/shared";
import {
  DEFAULT_CONTRIBUTION_PLAN_CONFIG,
  FX_EXECUTION_IOF,
  FX_EXECUTION_SPREAD,
} from "@portifolio-tracker/shared";
import { Calculator, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { AssetLink } from "@/components/asset-link";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/api";
import { formatMoney, formatQuantity, formatWeightPrecise } from "@/lib/format";
import { parseDecimalInput } from "@/lib/numeric-input";
import { planContribution } from "../../../../api/src/domain/contribution-plan";

/** How many candidates a contribution is spread over. `auto` uses the policy. */
const SPREAD_OPTIONS = ["auto", "1", "2", "3", "4", "5", "0"] as const;

type SpreadChoice = (typeof SPREAD_OPTIONS)[number];

export type ContributionFx = {
  usdBrlRate: string | null;
  executionUsdBrlRate: string | null;
  executionSpread: string;
  executionIof: string;
};

/** Converts a display-currency slice into the asset's native contribution currency. */
export function contributionAmountInAssetCurrency(
  amount: number,
  assetCurrency: Currency,
  displayCurrency: Currency,
  usdBrlRate: number | null,
  executionUsdBrlRate: number | null,
): number | null {
  if (!Number.isFinite(amount)) {
    return null;
  }

  if (assetCurrency === displayCurrency) {
    return amount;
  }

  const rate =
    assetCurrency === "USD" && displayCurrency === "BRL"
      ? executionUsdBrlRate
      : usdBrlRate;

  if (rate === null || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }

  return assetCurrency === "USD" ? amount / rate : amount * rate;
}

function formatContributionMoney(
  amount: number | null,
  currency: Currency,
): string {
  return amount === null ? "—" : formatMoney(amount.toFixed(2), currency);
}

function sumContributionTotals(
  slices: readonly { amount: string; currency: Currency }[],
  displayCurrency: Currency,
  usdBrlRate: number | null,
  executionUsdBrlRate: number | null,
): { brl: number | null; usd: number | null } {
  let brl = 0;
  let usd = 0;
  let brlAvailable = true;
  let usdAvailable = true;

  for (const slice of slices) {
    const nativeAmount = contributionAmountInAssetCurrency(
      Number(slice.amount),
      slice.currency,
      displayCurrency,
      usdBrlRate,
      executionUsdBrlRate,
    );

    if (nativeAmount === null) {
      if (slice.currency === "BRL") brlAvailable = false;
      else usdAvailable = false;
      continue;
    }

    if (slice.currency === "BRL") brl += nativeAmount;
    else usd += nativeAmount;
  }

  return {
    brl: brlAvailable ? brl : null,
    usd: usdAvailable ? usd : null,
  };
}

/**
 * Opens the contribution planner in a dialog so the allocation screen stays
 * focused on the table.
 */
export function ContributionPlannerButton({
  rows,
  displayCurrency,
  portfolioValue,
  fx,
  disabled = false,
}: {
  rows: AllocationRow[];
  displayCurrency: Currency;
  portfolioValue: string;
  fx?: ContributionFx | null;
  disabled?: boolean;
}) {
  const { i18n } = useLingui();
  const policy = trpc.contributionPlanConfig.get.useQuery();
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [spread, setSpread] = useState<SpreadChoice>("auto");

  const amount = parseDecimalInput(amountText) ?? "0";
  const config = policy.data?.config ?? DEFAULT_CONTRIBUTION_PLAN_CONFIG;
  const plan = useMemo(
    () =>
      planContribution({
        rows: rows.map((row) => ({
          ticker: row.ticker,
          currency: row.currency,
          score: row.score.value,
          executionPrice: row.executionPrice,
          executionFxApplied: row.executionFxApplied,
        })),
        amount,
        portfolioValue,
        config,
        spread: spread === "auto" ? null : Number(spread),
      }),
    [rows, amount, portfolioValue, config, spread],
  );
  const candidates = rows.filter((row) => Number(row.score.value) > 0).length;
  const executionUsdBrlRate = Number(fx?.executionUsdBrlRate);
  const validExecutionUsdBrlRate =
    Number.isFinite(executionUsdBrlRate) && executionUsdBrlRate > 0
      ? executionUsdBrlRate
      : null;
  const usdBrlRate = Number(fx?.usdBrlRate);
  const validUsdBrlRate =
    Number.isFinite(usdBrlRate) && usdBrlRate > 0 ? usdBrlRate : null;
  const totals = sumContributionTotals(
    plan.slices,
    displayCurrency,
    validUsdBrlRate,
    validExecutionUsdBrlRate,
  );
  const hasUsdSlices = plan.slices.some((slice) => slice.currency === "USD");
  const hasBrlSlices = plan.slices.some((slice) => slice.currency === "BRL");
  const hasCrossCurrencySlice = plan.slices.some(
    (slice) => slice.currency !== displayCurrency,
  );
  const spreadPercent =
    Number(fx?.executionSpread ?? FX_EXECUTION_SPREAD) * 100;
  const iofPercent = Number(fx?.executionIof ?? FX_EXECUTION_IOF) * 100;
  const remainderValue = Math.abs(Number(plan.remainder));
  const needRemainder =
    remainderValue >= 0.01 && plan.slices.some((slice) => slice.cappedByNeed);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          setAmountText("");
          setSpread("auto");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Calculator aria-hidden="true" />
          <Trans id="allocation.plannerOpen">Plan contribution</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <DialogTitleIcon>
              <Calculator aria-hidden="true" />
            </DialogTitleIcon>
            <Trans id="allocation.plannerTitle">Contribution planner</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="allocation.plannerDescription">
              Enter how much you are contributing and the amount is split so
              each slice can still move portfolio weight. Suggestion only —
              nothing is saved until you register the trade.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="allocation-amount">
                <Trans id="allocation.plannerAmount">Contribution</Trans>
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                  {displayCurrency === "BRL" ? "R$" : "$"}
                </span>
                <Input
                  id="allocation-amount"
                  value={amountText}
                  inputMode="decimal"
                  className="pl-10"
                  placeholder={i18n._(
                    t({
                      id: "allocation.plannerAmountPlaceholder",
                      message: "5000",
                    }),
                  )}
                  onChange={(event) => setAmountText(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="allocation-spread">
                <Trans id="allocation.plannerSpread">Spread over</Trans>
              </Label>
              <Select
                value={spread}
                onValueChange={(value) => setSpread(value as SpreadChoice)}
              >
                <SelectTrigger id="allocation-spread" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPREAD_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "auto" ? (
                        <Trans id="allocation.plannerAuto">
                          Automatic ({plan.selectedCount || plan.targetCount})
                        </Trans>
                      ) : option === "0" ? (
                        <Trans id="allocation.plannerAll">
                          Every candidate ({candidates})
                        </Trans>
                      ) : (
                        <Trans id="allocation.plannerTop">
                          Top {option} assets
                        </Trans>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {plan.slices.length === 0 ? (
            <p className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
              {candidates === 0 ? (
                <Trans id="allocation.plannerNoCandidates">
                  No asset is taking contributions right now. Set a target,
                  review a fair value, or wait for a cooldown to expire.
                </Trans>
              ) : (
                <Trans id="allocation.plannerAwaitingAmount">
                  Enter an amount to see the suggested split.
                </Trans>
              )}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {plan.spreadMode === "auto" && plan.relativeSize === null ? (
                  <Trans id="allocation.plannerAutoEmpty">
                    Empty portfolio — spreading over {plan.selectedCount}{" "}
                    assets, up to {config.maxAssets}.
                  </Trans>
                ) : plan.spreadMode === "auto" &&
                  plan.relativeSize !== null &&
                  plan.weightImpact !== null ? (
                  <Trans id="allocation.plannerAutoReason">
                    Contribution is {formatWeightPrecise(plan.relativeSize)} of
                    the portfolio, so automatic spread is {plan.selectedCount}{" "}
                    (minimum impact {formatWeightPrecise(plan.weightImpact)}).
                  </Trans>
                ) : null}
              </p>
              <ul className="max-h-72 space-y-2 overflow-auto pr-1">
                {plan.slices.map((slice) => {
                  const usdAmount =
                    slice.currency === "USD"
                      ? contributionAmountInAssetCurrency(
                          Number(slice.amount),
                          "USD",
                          displayCurrency,
                          validUsdBrlRate,
                          validExecutionUsdBrlRate,
                        )
                      : null;

                  return (
                    <li
                      key={slice.ticker}
                      className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5"
                    >
                      <div className="w-16 shrink-0">
                        <AssetLink
                          ticker={slice.ticker}
                          className="block truncate text-sm font-semibold"
                        >
                          {slice.ticker}
                        </AssetLink>
                        {slice.cappedByShare || slice.cappedByNeed ? (
                          <span className="block text-[10px] text-muted-foreground">
                            {slice.cappedByShare ? (
                              <Trans id="allocation.plannerCappedShare">
                                Share cap
                              </Trans>
                            ) : (
                              <Trans id="allocation.plannerCappedNeed">
                                Need cap
                              </Trans>
                            )}
                          </span>
                        ) : null}
                      </div>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-foreground/60"
                          style={{
                            width: `${Math.round(Number(slice.share) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                        {formatWeightPrecise(slice.share)}
                      </span>
                      <span className="w-32 shrink-0 text-right tabular-nums">
                        <span className="block text-sm">
                          {formatMoney(slice.amount, displayCurrency)}
                        </span>
                        {slice.currency === "USD" &&
                        displayCurrency === "BRL" ? (
                          <span className="block text-xs text-muted-foreground">
                            <span className="sr-only">
                              <Trans id="allocation.plannerUsdEquivalent">
                                USD equivalent
                              </Trans>
                              :{" "}
                            </span>
                            ≈ {formatContributionMoney(usdAmount, "USD")}
                          </span>
                        ) : null}
                      </span>
                      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                        {slice.units === null ? (
                          "—"
                        ) : (
                          <Trans id="allocation.plannerUnits">
                            {formatQuantity(slice.units)} un.
                          </Trans>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {plan.slices.length > 0 && remainderValue >= 0.01 ? (
            <p className="text-xs text-muted-foreground">
              {needRemainder ? (
                <Trans id="allocation.plannerNeedRemainder">
                  Scored need is smaller than this contribution.{" "}
                  {formatMoney(plan.remainder, displayCurrency)} stays
                  unallocated.
                </Trans>
              ) : (
                <Trans id="allocation.plannerRemainder">
                  Rounding leaves {formatMoney(plan.remainder, displayCurrency)}{" "}
                  unallocated.
                </Trans>
              )}
            </p>
          ) : null}

          {plan.slices.length > 0 ? (
            <div className="grid gap-3 rounded-lg border bg-muted/30 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                <Trans id="allocation.plannerTotals">Contribution totals</Trans>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    <Trans id="allocation.plannerTotalBrl">
                      Contribution to BRL assets
                    </Trans>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatContributionMoney(totals.brl, "BRL")}
                  </span>
                </div>
                <div className="grid gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    <Trans id="allocation.plannerTotalUsd">
                      Contribution to USD assets
                    </Trans>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatContributionMoney(totals.usd, "USD")}
                  </span>
                </div>
              </div>
              {hasUsdSlices && displayCurrency === "BRL" ? (
                <p className="text-xs text-muted-foreground">
                  {validExecutionUsdBrlRate === null ? (
                    <Trans id="allocation.plannerFxUnavailable">
                      A currency total is unavailable until the required FX rate
                      is available.
                    </Trans>
                  ) : (
                    <Trans id="allocation.plannerVetRate">
                      USD asset amounts use VET at{" "}
                      {formatQuantity(validExecutionUsdBrlRate.toFixed(4))} BRL
                      per USD.
                    </Trans>
                  )}
                </p>
              ) : hasBrlSlices &&
                displayCurrency === "USD" &&
                totals.brl === null ? (
                <p className="text-xs text-muted-foreground">
                  <Trans id="allocation.plannerFxUnavailable">
                    A currency total is unavailable until the required FX rate
                    is available.
                  </Trans>
                </p>
              ) : null}
            </div>
          ) : null}

          {hasCrossCurrencySlice ? (
            <div className="flex justify-end">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    aria-label={i18n._(
                      t({
                        id: "allocation.plannerFxAria",
                        message:
                          "How FX is used for contribution amounts and units",
                      }),
                    )}
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                    <span className="text-xs">
                      <Trans id="allocation.plannerFxHint">
                        VET / FX costs
                      </Trans>
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="space-y-1.5 text-left">
                  <p>
                    <Trans id="allocation.plannerFxTooltip">
                      Contribution totals are split by asset currency. USD
                      assets budgeted in BRL use the execution rate (spot ×{" "}
                      {spreadPercent.toFixed(1)}% spread ×{" "}
                      {iofPercent.toFixed(2)}% IOF) for their amount and units;
                      BRL assets budgeted in USD use spot. Portfolio value still
                      uses the spot dollar.
                    </Trans>
                  </p>
                  {fx?.usdBrlRate && fx.executionUsdBrlRate ? (
                    <p className="tabular-nums opacity-90">
                      <Trans id="allocation.plannerFxRates">
                        Spot {fx.usdBrlRate} → execution{" "}
                        {fx.executionUsdBrlRate}
                      </Trans>
                    </p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
