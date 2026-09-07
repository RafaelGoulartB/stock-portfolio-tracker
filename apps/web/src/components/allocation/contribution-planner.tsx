import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AllocationRow, Currency } from "@portifolio-tracker/shared";
import {
  FX_EXECUTION_IOF,
  FX_EXECUTION_SPREAD,
} from "@portifolio-tracker/shared";
import { Calculator, Info } from "lucide-react";
import { useMemo, useState } from "react";
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
import { formatMoney, formatQuantity, formatWeightPrecise } from "@/lib/format";
import { parseDecimalInput } from "@/lib/numeric-input";

/** How many candidates a contribution is spread over. `0` means every one. */
const SPREAD_OPTIONS = [1, 2, 3, 4, 5, 0] as const;

export type ContributionFx = {
  usdBrlRate: string | null;
  executionUsdBrlRate: string | null;
  executionSpread: string;
  executionIof: string;
};

export type ContributionSlice = {
  ticker: string;
  currency: Currency;
  /** Share of the contribution, `0`–`1`. */
  share: number;
  /** Suggested amount in the display currency. */
  amount: number;
  /** Suggested unit count, `null` when the asset has no price. */
  units: number | null;
  /** True when units used the VET rate instead of spot. */
  executionFxApplied: boolean;
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
  slices: readonly ContributionSlice[],
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
      slice.amount,
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
 * Splits an amount across the top-scoring assets, proportionally to their
 * scores. Amounts are a *suggestion*, never an accounting record: they are
 * computed with plain numbers and rounded to cents, with the rounding
 * remainder reported separately so nothing silently disappears. Money that
 * actually moves is entered as a transaction, where decimals stay exact.
 *
 * Unit counts for USD assets shown in BRL use the execution (VET) price so
 * spread and IOF are in the suggested size. Portfolio valuation still uses
 * the spot dollar.
 */
export function planContribution(
  rows: readonly AllocationRow[],
  amount: number,
  spread: number,
): { slices: ContributionSlice[]; allocated: number } {
  const candidates = rows
    .filter((row) => Number(row.score.value) > 0)
    .sort((a, b) => Number(b.score.value) - Number(a.score.value));
  const chosen = spread > 0 ? candidates.slice(0, spread) : candidates;
  const total = chosen.reduce((sum, row) => sum + Number(row.score.value), 0);

  if (chosen.length === 0 || total <= 0 || amount <= 0) {
    return { slices: [], allocated: 0 };
  }

  let allocated = 0;
  const slices = chosen.map((row) => {
    const share = Number(row.score.value) / total;
    const sliceAmount = Math.round(amount * share * 100) / 100;
    const price =
      row.executionPrice === null ? null : Number(row.executionPrice);

    allocated += sliceAmount;

    return {
      ticker: row.ticker,
      currency: row.currency,
      share,
      amount: sliceAmount,
      units: price && price > 0 ? sliceAmount / price : null,
      executionFxApplied: row.executionFxApplied,
    };
  });

  return { slices, allocated: Math.round(allocated * 100) / 100 };
}

/**
 * Opens the contribution planner in a dialog so the allocation screen stays
 * focused on the table.
 */
export function ContributionPlannerButton({
  rows,
  displayCurrency,
  fx,
  disabled = false,
}: {
  rows: AllocationRow[];
  displayCurrency: Currency;
  fx?: ContributionFx | null;
  disabled?: boolean;
}) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [spread, setSpread] = useState<number>(3);

  const amount = Number(parseDecimalInput(amountText) ?? "0");
  const { slices, allocated } = useMemo(
    () => planContribution(rows, amount, spread),
    [rows, amount, spread],
  );
  const remainder = Math.round((amount - allocated) * 100) / 100;
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
    slices,
    displayCurrency,
    validUsdBrlRate,
    validExecutionUsdBrlRate,
  );
  const hasUsdSlices = slices.some((slice) => slice.currency === "USD");
  const hasBrlSlices = slices.some((slice) => slice.currency === "BRL");
  const hasCrossCurrencySlice = slices.some(
    (slice) => slice.currency !== displayCurrency,
  );
  const spreadPercent =
    Number(fx?.executionSpread ?? FX_EXECUTION_SPREAD) * 100;
  const iofPercent = Number(fx?.executionIof ?? FX_EXECUTION_IOF) * 100;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          setAmountText("");
          setSpread(3);
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
              Enter how much you are contributing and the amount is split
              proportionally to the score. Suggestion only — nothing is saved
              until you register the trade.
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
                value={String(spread)}
                onValueChange={(value) => setSpread(Number(value))}
              >
                <SelectTrigger id="allocation-spread" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPREAD_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option === 0 ? (
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

          {slices.length === 0 ? (
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
            <ul className="max-h-72 space-y-2 overflow-auto pr-1">
              {slices.map((slice) => {
                const usdAmount =
                  slice.currency === "USD"
                    ? contributionAmountInAssetCurrency(
                        slice.amount,
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
                    <span className="w-16 shrink-0 text-sm font-semibold">
                      {slice.ticker}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-foreground/60"
                        style={{ width: `${Math.round(slice.share * 100)}%` }}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {formatWeightPrecise(String(slice.share))}
                    </span>
                    <span className="w-32 shrink-0 text-right tabular-nums">
                      <span className="block text-sm">
                        {formatMoney(slice.amount.toFixed(2), displayCurrency)}
                      </span>
                      {slice.currency === "USD" && displayCurrency === "BRL" ? (
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
                          {formatQuantity(slice.units.toFixed(4))} un.
                        </Trans>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {slices.length > 0 && Math.abs(remainder) >= 0.01 ? (
            <p className="text-xs text-muted-foreground">
              <Trans id="allocation.plannerRemainder">
                Rounding leaves{" "}
                {formatMoney(remainder.toFixed(2), displayCurrency)}{" "}
                unallocated.
              </Trans>
            </p>
          ) : null}

          {slices.length > 0 ? (
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
