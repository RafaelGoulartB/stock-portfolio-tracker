import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AllocationRow, Currency } from "@portifolio-tracker/shared";
import { Calculator } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, formatQuantity, formatWeightPrecise } from "@/lib/format";
import { parseDecimalInput } from "@/lib/numeric-input";

/** How many candidates a contribution is spread over. `0` means every one. */
const SPREAD_OPTIONS = [1, 3, 5, 0] as const;

export type ContributionSlice = {
  ticker: string;
  /** Share of the contribution, `0`–`1`. */
  share: number;
  /** Suggested amount in the display currency. */
  amount: number;
  /** Suggested unit count, `null` when the asset has no price. */
  units: number | null;
};

/**
 * Splits an amount across the top-scoring assets, proportionally to their
 * scores. Amounts are a *suggestion*, never an accounting record: they are
 * computed with plain numbers and rounded to cents, with the rounding
 * remainder reported separately so nothing silently disappears. Money that
 * actually moves is entered as a transaction, where decimals stay exact.
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
      row.convertedMarketPrice === null
        ? null
        : Number(row.convertedMarketPrice);

    allocated += sliceAmount;

    return {
      ticker: row.ticker,
      share,
      amount: sliceAmount,
      units: price && price > 0 ? sliceAmount / price : null,
    };
  });

  return { slices, allocated: Math.round(allocated * 100) / 100 };
}

export function ContributionPlanner({
  rows,
  displayCurrency,
}: {
  rows: AllocationRow[];
  displayCurrency: Currency;
}) {
  const { i18n } = useLingui();
  const [amountText, setAmountText] = useState("");
  const [spread, setSpread] = useState<number>(3);

  const amount = Number(parseDecimalInput(amountText) ?? "0");
  const { slices, allocated } = useMemo(
    () => planContribution(rows, amount, spread),
    [rows, amount, spread],
  );
  const remainder = Math.round((amount - allocated) * 100) / 100;
  const candidates = rows.filter((row) => Number(row.score.value) > 0).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="size-4" aria-hidden="true" />
          <Trans id="allocation.plannerTitle">Contribution planner</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="allocation.plannerDescription">
            Enter how much you are contributing and the amount is split
            proportionally to the score. Suggestion only — nothing is saved
            until you register the trade.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="allocation-amount">
              <Trans id="allocation.plannerAmount">Contribution</Trans>
            </Label>
            <Input
              id="allocation-amount"
              value={amountText}
              inputMode="decimal"
              placeholder={i18n._(
                t({
                  id: "allocation.plannerAmountPlaceholder",
                  message: "5000",
                }),
              )}
              onChange={(event) => setAmountText(event.target.value)}
            />
          </div>
          <div className="w-40 space-y-1.5">
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
          <p className="text-sm text-muted-foreground">
            {candidates === 0 ? (
              <Trans id="allocation.plannerNoCandidates">
                No asset is taking contributions right now. Set a target, review
                a fair value, or wait for a cooldown to expire.
              </Trans>
            ) : (
              <Trans id="allocation.plannerAwaitingAmount">
                Enter an amount to see the suggested split.
              </Trans>
            )}
          </p>
        ) : (
          <ul className="space-y-2">
            {slices.map((slice) => (
              <li key={slice.ticker} className="flex items-center gap-3">
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
                <span className="w-28 shrink-0 text-right text-sm tabular-nums">
                  {formatMoney(slice.amount.toFixed(2), displayCurrency)}
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
            ))}
          </ul>
        )}

        {slices.length > 0 && Math.abs(remainder) >= 0.01 ? (
          <p className="text-xs text-muted-foreground">
            <Trans id="allocation.plannerRemainder">
              Rounding leaves{" "}
              {formatMoney(remainder.toFixed(2), displayCurrency)} unallocated.
            </Trans>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
