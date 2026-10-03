import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  type Currency,
  createBonusInput,
  createSplitInput,
  type Split,
  type SplitSuggestion,
} from "@portifolio-tracker/shared";
import { Loader2, Split as SplitIcon, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/api";
import {
  formatPreciseMoney,
  formatQuantity,
  formatTradeDate,
} from "@/lib/format";
import { parseDecimalInput } from "@/lib/numeric-input";
import { bonusErrorMessage, splitErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

function ratioText(split: { fromQuantity: string; toQuantity: string }) {
  return `${formatQuantity(split.fromQuantity)} → ${formatQuantity(split.toQuantity)}`;
}

/** Shares a bonus added: the API stores it as held → held + received. */
function bonusShares(split: Split): string {
  return formatQuantity(
    (Number(split.toQuantity) - Number(split.fromQuantity)).toFixed(8),
  );
}

type Mode = "split" | "bonus";

/**
 * Splits and reverse splits of one ticker. Recording one restates the units
 * of every earlier trade; nothing is applied until the user records it,
 * even when the quote provider suggests it.
 */
export function AssetSplits({
  ticker,
  currency,
}: {
  ticker: string;
  currency: Currency | null;
}) {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const splits = trpc.corporateActions.list.useQuery({ ticker });
  const suggestions = trpc.corporateActions.suggestions.useQuery(
    { ticker },
    { staleTime: 60 * 60 * 1000, retry: false },
  );
  const [effectiveAt, setEffectiveAt] = useState("");
  const [fromText, setFromText] = useState("1");
  const [toText, setToText] = useState("");
  const [mode, setMode] = useState<Mode>("split");
  const [receivedText, setReceivedText] = useState("");
  const [unitCostText, setUnitCostText] = useState("");
  // Bonus shares carry a cost in reais the company attributes on B3.
  const bonusAllowed = currency === "BRL";

  async function refresh() {
    // Units change every quantity, weight, value and dividend entitlement.
    await Promise.all([
      utils.corporateActions.invalidate(),
      utils.transactions.invalidate(),
      utils.positions.invalidate(),
      utils.allocation.invalidate(),
      utils.performance.invalidate(),
      utils.dividends.invalidate(),
      utils.incomeTax.invalidate(),
    ]);
  }

  const createBonus = trpc.corporateActions.createBonus.useMutation({
    onSuccess: async (split) => {
      const shares = bonusShares(split);

      toast.success(
        t({
          id: "splits.bonusRecorded",
          message: `Bonus of ${shares} shares recorded`,
        }),
      );
      setEffectiveAt("");
      setReceivedText("");
      setUnitCostText("");
      await refresh();
    },
    onError: (error) => toast.error(bonusErrorMessage(error)),
  });

  const create = trpc.corporateActions.createSplit.useMutation({
    onSuccess: async (split) => {
      const ratio = ratioText(split);

      toast.success(
        t({ id: "splits.recorded", message: `Split ${ratio} recorded` }),
      );
      setEffectiveAt("");
      setFromText("1");
      setToText("");
      await refresh();
    },
    onError: (error) => toast.error(splitErrorMessage(error)),
  });

  const remove = trpc.corporateActions.removeSplit.useMutation({
    onSuccess: async () => {
      toast.success(t({ id: "splits.removed", message: "Split removed" }));
      await refresh();
    },
    onError: (error) => toast.error(splitErrorMessage(error)),
  });

  const parsed = createSplitInput.safeParse({
    ticker,
    effectiveAt,
    fromQuantity: parseDecimalInput(fromText) ?? "",
    toQuantity: parseDecimalInput(toText) ?? "",
  });

  const parsedBonus = createBonusInput.safeParse({
    ticker,
    effectiveAt,
    receivedQuantity: parseDecimalInput(receivedText) ?? "",
    unitCost: parseDecimalInput(unitCostText) ?? "",
  });
  const activeMode: Mode = bonusAllowed ? mode : "split";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (activeMode === "bonus") {
      if (parsedBonus.success) createBonus.mutate(parsedBonus.data);
    } else if (parsed.success) {
      create.mutate(parsed.data);
    }
  }

  function record(suggestion: SplitSuggestion) {
    create.mutate({
      ticker,
      effectiveAt: suggestion.effectiveAt,
      fromQuantity: suggestion.fromQuantity,
      toQuantity: suggestion.toQuantity,
    });
  }

  const recorded: Split[] = splits.data ?? [];
  const pending = suggestions.data?.suggestions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="splits.title">Splits and bonus issues</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="splits.description">
            Splits and reverse splits change share units without moving money.
            Earlier trades are restated in today&apos;s units, so the cost basis
            stays what you paid and the average price follows. Bonus shares
            count the same way here; their attributed cost enters only the
            income tax cost.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending.length > 0 ? (
          <ul className="space-y-2">
            {pending.map((suggestion) => {
              const date = formatTradeDate(suggestion.effectiveAt);
              const ratio = ratioText(suggestion);

              return (
                <li
                  key={suggestion.effectiveAt}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-caution/40 bg-caution/10 px-3 py-2 text-sm"
                >
                  <SplitIcon
                    className="size-4 shrink-0 text-caution"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <Trans id="splits.suggestion">
                      Yahoo reports a {ratio} split effective {date} that is not
                      recorded yet. If it was a bonus issue, record it as a
                      bonus below instead, with the attributed cost.
                    </Trans>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={create.isPending}
                    onClick={() => record(suggestion)}
                  >
                    <Trans id="splits.recordSuggestion">Record it</Trans>
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {suggestions.data?.unavailable ? (
          <p className="text-xs text-muted-foreground">
            <Trans id="splits.suggestionsUnavailable">
              Could not check Yahoo for published splits right now. You can
              still record one below.
            </Trans>
          </p>
        ) : null}

        {recorded.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans id="splits.empty">
              No split or bonus recorded for this ticker.
            </Trans>
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {recorded.map((split) => {
              const date = formatTradeDate(split.effectiveAt);
              const ratio = ratioText(split);
              const isBonus = split.kind === "bonus";
              const shares = isBonus ? bonusShares(split) : "";
              const unitCost =
                isBonus && split.unitCost
                  ? formatPreciseMoney(split.unitCost, "BRL")
                  : "";
              const removeLabel = isBonus
                ? i18n._(
                    t({
                      id: "splits.removeBonusLabel",
                      message: `Remove the bonus of ${date}`,
                    }),
                  )
                : i18n._(
                    t({
                      id: "splits.removeLabel",
                      message: `Remove the ${ratio} split of ${date}`,
                    }),
                  );

              return (
                <li
                  key={split.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <span className="w-28 shrink-0 text-muted-foreground tabular-nums">
                    {date}
                  </span>
                  <span className="flex-1 font-medium tabular-nums">
                    {isBonus ? (
                      <Trans id="splits.bonusRow">
                        Bonus: +{shares} shares at {unitCost} each
                      </Trans>
                    ) : (
                      ratio
                    )}
                    {split.notes ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {split.notes}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={removeLabel}
                    title={removeLabel}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: split.id })}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {bonusAllowed ? (
          <fieldset className="flex gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
            <legend className="sr-only">
              <Trans id="splits.modeLegend">Event type</Trans>
            </legend>
            {(["split", "bonus"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={activeMode === option ? "secondary" : "ghost"}
                aria-pressed={activeMode === option}
                className={cn("flex-1", activeMode === option && "shadow-sm")}
                onClick={() => setMode(option)}
              >
                {option === "split" ? (
                  <Trans id="splits.modeSplit">Split</Trans>
                ) : (
                  <Trans id="splits.modeBonus">Bonus issue</Trans>
                )}
              </Button>
            ))}
          </fieldset>
        ) : null}

        <form
          className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-end"
          onSubmit={submit}
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor="split-date">
              {activeMode === "bonus" ? (
                <Trans id="splits.bonusDate">Ex-date</Trans>
              ) : (
                <Trans id="splits.effectiveAt">First day in new units</Trans>
              )}
            </Label>
            <Input
              id="split-date"
              type="date"
              value={effectiveAt}
              onChange={(event) => setEffectiveAt(event.target.value)}
            />
          </div>
          {activeMode === "bonus" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="bonus-received">
                  <Trans id="splits.bonusReceived">Shares received</Trans>
                </Label>
                <Input
                  id="bonus-received"
                  inputMode="decimal"
                  placeholder="29"
                  value={receivedText}
                  onChange={(event) => setReceivedText(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bonus-cost">
                  <Trans id="splits.bonusUnitCost">Cost per share (R$)</Trans>
                </Label>
                <Input
                  id="bonus-cost"
                  inputMode="decimal"
                  placeholder="18,00"
                  value={unitCostText}
                  onChange={(event) => setUnitCostText(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={!parsedBonus.success || createBonus.isPending}
              >
                {createBonus.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                <Trans id="splits.recordBonus">Record bonus</Trans>
              </Button>
              <p className="text-xs text-muted-foreground sm:col-span-4">
                <Trans id="splits.bonusHint">
                  Use the shares your broker credited and the cost per share the
                  company announced. Shares held the day before the ex-date
                  receive them. Fractions sold at auction are a sale.
                </Trans>
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="split-from">
                  <Trans id="splits.from">Old shares</Trans>
                </Label>
                <Input
                  id="split-from"
                  inputMode="decimal"
                  value={fromText}
                  onChange={(event) => setFromText(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="split-to">
                  <Trans id="splits.to">New shares</Trans>
                </Label>
                <Input
                  id="split-to"
                  inputMode="decimal"
                  placeholder="2"
                  value={toText}
                  onChange={(event) => setToText(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={!parsed.success || create.isPending}
              >
                {create.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                <Trans id="splits.record">Record split</Trans>
              </Button>
              <p className="text-xs text-muted-foreground sm:col-span-4">
                <Trans id="splits.formHint">
                  A split of 1 into 2 doubles the shares; a reverse split of 10
                  into 1 divides them by ten.
                </Trans>
              </p>
            </>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
