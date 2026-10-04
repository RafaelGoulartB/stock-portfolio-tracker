import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  CURRENCIES,
  type Currency,
  DEFAULT_GOAL_RATES,
  type GoalSettings,
  type GoalTargetKind,
  goalSettingsInput,
} from "@portifolio-tracker/shared";
import { Loader2, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { trpc } from "@/lib/api";
import {
  formatDecimalInput,
  formatPercentInput,
  parseDecimalInput,
  parsePercentInput,
} from "@/lib/numeric-input";
import { queryErrorMessage } from "@/lib/trpcErrors";

type RateField =
  | "withdrawalRate"
  | "conservativeReturn"
  | "baseReturn"
  | "optimisticReturn";

const RETURN_FIELDS = [
  "conservativeReturn",
  "baseReturn",
  "optimisticReturn",
] as const;

function returnLabel(field: (typeof RETURN_FIELDS)[number]) {
  switch (field) {
    case "conservativeReturn":
      return <Trans id="goals.scenario.conservative">Conservative</Trans>;
    case "baseReturn":
      return <Trans id="goals.scenario.base">Base</Trans>;
    case "optimisticReturn":
      return <Trans id="goals.scenario.optimistic">Optimistic</Trans>;
  }
}

/**
 * Creates, edits or removes the account's goal. A new goal starts from the
 * display currency, the recent average contribution and the default real
 * returns.
 */
export function GoalDialog({
  goal,
  displayCurrency,
  suggestedContribution,
  onClose,
  onSaved,
}: {
  goal: GoalSettings | null;
  displayCurrency: Currency;
  /** Recent average monthly contribution, offered for a new goal. */
  suggestedContribution: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [currency, setCurrency] = useState<Currency>(
    goal?.currency ?? displayCurrency,
  );
  const [targetKind, setTargetKind] = useState<GoalTargetKind>(
    goal?.targetKind ?? "income",
  );
  const [targetAmount, setTargetAmount] = useState(
    formatDecimalInput(goal?.targetAmount ?? null),
  );
  const [monthlyContribution, setMonthlyContribution] = useState(
    formatDecimalInput(goal?.monthlyContribution ?? suggestedContribution),
  );
  const [targetMonth, setTargetMonth] = useState(goal?.targetMonth ?? "");
  const [rates, setRates] = useState<Record<RateField, string>>(() => ({
    withdrawalRate: formatPercentInput(
      goal?.withdrawalRate ?? DEFAULT_GOAL_RATES.withdrawalRate,
    ),
    conservativeReturn: formatPercentInput(
      goal?.conservativeReturn ?? DEFAULT_GOAL_RATES.conservativeReturn,
    ),
    baseReturn: formatPercentInput(
      goal?.baseReturn ?? DEFAULT_GOAL_RATES.baseReturn,
    ),
    optimisticReturn: formatPercentInput(
      goal?.optimisticReturn ?? DEFAULT_GOAL_RATES.optimisticReturn,
    ),
  }));

  const save = trpc.goals.save.useMutation({
    onSuccess: async () => {
      toast.success(t({ id: "goals.saved", message: "Goal saved" }));
      await onSaved();
      onClose();
    },
    onError: (error) => toast.error(queryErrorMessage(error)),
  });
  const remove = trpc.goals.remove.useMutation({
    onSuccess: async () => {
      toast.success(t({ id: "goals.removed", message: "Goal removed" }));
      await onSaved();
      onClose();
    },
    onError: (error) => toast.error(queryErrorMessage(error)),
  });

  const parsed = goalSettingsInput.safeParse({
    currency,
    targetKind,
    targetAmount: parseDecimalInput(targetAmount) ?? "",
    monthlyContribution:
      monthlyContribution.trim() === ""
        ? "0"
        : (parseDecimalInput(monthlyContribution) ?? ""),
    withdrawalRate: parsePercentInput(rates.withdrawalRate) ?? "",
    conservativeReturn: parsePercentInput(rates.conservativeReturn) ?? "",
    baseReturn: parsePercentInput(rates.baseReturn) ?? "",
    optimisticReturn: parsePercentInput(rates.optimisticReturn) ?? "",
    targetMonth: targetMonth === "" ? null : targetMonth,
  });
  const invalid = new Set(
    parsed.success
      ? []
      : parsed.error.issues.map((issue) => String(issue.path[0])),
  );
  const returnsInvalid = RETURN_FIELDS.some((field) => invalid.has(field));
  const busy = save.isPending || remove.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (parsed.success) save.mutate(parsed.data);
  }

  const setRate = (field: RateField, value: string) =>
    setRates((current) => ({ ...current, [field]: value }));

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              {goal ? (
                <Trans id="goals.editTitle">Edit goal</Trans>
              ) : (
                <Trans id="goals.createTitle">Set a goal</Trans>
              )}
            </DialogTitle>
            <DialogDescription>
              <Trans id="goals.dialogDescription">
                State the goal in today&apos;s money. Returns are real (above
                inflation), so the projection needs no inflation guess.
              </Trans>
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              <Trans id="goals.targetKind">The goal is</Trans>
            </legend>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={targetKind}
              onValueChange={(value) =>
                value && setTargetKind(value as GoalTargetKind)
              }
            >
              <ToggleGroupItem
                value="income"
                className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                <Trans id="goals.kindIncome">A monthly income</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="value"
                className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                <Trans id="goals.kindValue">A portfolio value</Trans>
              </ToggleGroupItem>
            </ToggleGroup>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-2">
              <Label htmlFor="goal-target-amount">
                {targetKind === "income" ? (
                  <Trans id="goals.targetIncome">Monthly income wanted</Trans>
                ) : (
                  <Trans id="goals.targetValue">Portfolio value wanted</Trans>
                )}
              </Label>
              <Input
                id="goal-target-amount"
                inputMode="decimal"
                value={targetAmount}
                onChange={(event) => setTargetAmount(event.target.value)}
                aria-invalid={invalid.has("targetAmount") || undefined}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-currency">
                <Trans id="goals.currency">Currency</Trans>
              </Label>
              <Select
                value={currency}
                onValueChange={(value) => setCurrency(value as Currency)}
              >
                <SelectTrigger id="goal-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="goal-contribution">
                <Trans id="goals.monthlyContribution">
                  Planned monthly contribution
                </Trans>
              </Label>
              <Input
                id="goal-contribution"
                inputMode="decimal"
                placeholder="0"
                value={monthlyContribution}
                onChange={(event) => setMonthlyContribution(event.target.value)}
                aria-invalid={invalid.has("monthlyContribution") || undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-target-month">
                <Trans id="goals.targetMonth">Reach it by (optional)</Trans>
              </Label>
              <Input
                id="goal-target-month"
                type="month"
                value={targetMonth}
                onChange={(event) => setTargetMonth(event.target.value)}
                aria-invalid={invalid.has("targetMonth") || undefined}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="goal-withdrawal">
              <Trans id="goals.withdrawalRate">
                Yearly withdrawal rate (%)
              </Trans>
            </Label>
            <Input
              id="goal-withdrawal"
              inputMode="decimal"
              className="sm:w-32"
              value={rates.withdrawalRate}
              onChange={(event) =>
                setRate("withdrawalRate", event.target.value)
              }
              aria-invalid={invalid.has("withdrawalRate") || undefined}
              aria-describedby="goal-withdrawal-hint"
            />
            <p
              id="goal-withdrawal-hint"
              className="text-xs text-muted-foreground"
            >
              <Trans id="goals.withdrawalHint">
                Share of the portfolio you would live on each year. 4% is a
                common rule of thumb for decades of withdrawals.
              </Trans>
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              <Trans id="goals.returns">Real yearly return (%)</Trans>
            </legend>
            <div className="grid grid-cols-3 gap-3">
              {RETURN_FIELDS.map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label
                    htmlFor={`goal-${field}`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    {returnLabel(field)}
                  </Label>
                  <Input
                    id={`goal-${field}`}
                    inputMode="decimal"
                    value={rates[field]}
                    onChange={(event) => setRate(field, event.target.value)}
                    aria-invalid={returnsInvalid || undefined}
                  />
                </div>
              ))}
            </div>
            {returnsInvalid ? (
              <p className="text-xs text-destructive" role="alert">
                <Trans id="goals.returnsInvalid">
                  Use returns from 0% to 20%, ordered from conservative to
                  optimistic.
                </Trans>
              </p>
            ) : null}
          </fieldset>

          <DialogFooter className="gap-2 sm:justify-between">
            {goal ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => remove.mutate()}
                disabled={busy}
              >
                <Trash2 aria-hidden="true" />
                <Trans id="goals.remove">Remove goal</Trans>
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose}>
                <Trans id="goals.cancel">Cancel</Trans>
              </Button>
              <Button type="submit" disabled={!parsed.success || busy}>
                {save.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                <Trans id="goals.save">Save goal</Trans>
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
