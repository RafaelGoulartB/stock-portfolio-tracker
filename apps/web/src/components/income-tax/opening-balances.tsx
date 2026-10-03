import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  type IncomeTaxSettings,
  incomeTaxSettingsInput,
} from "@portifolio-tracker/shared";
import { Loader2, Pencil } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { trpc } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { formatDecimalInput, parseDecimalInput } from "@/lib/numeric-input";
import { queryErrorMessage } from "@/lib/trpcErrors";

type AmountField =
  | "ordinaryLoss"
  | "dayTradeLoss"
  | "fiiLoss"
  | "foreignLoss"
  | "pendingDarf";

const AMOUNT_FIELDS: AmountField[] = [
  "ordinaryLoss",
  "dayTradeLoss",
  "fiiLoss",
  "foreignLoss",
  "pendingDarf",
];

function fieldLabel(field: AmountField) {
  switch (field) {
    case "ordinaryLoss":
      return (
        <Trans id="incomeTax.opening.ordinaryLoss">
          Ordinary loss to offset
        </Trans>
      );
    case "dayTradeLoss":
      return (
        <Trans id="incomeTax.opening.dayTradeLoss">
          Day-trade loss to offset
        </Trans>
      );
    case "fiiLoss":
      return <Trans id="incomeTax.opening.fiiLoss">FII loss to offset</Trans>;
    case "foreignLoss":
      return (
        <Trans id="incomeTax.opening.foreignLoss">Foreign loss to offset</Trans>
      );
    case "pendingDarf":
      return (
        <Trans id="incomeTax.opening.pendingDarf">
          Tax below the R$ 10 DARF minimum
        </Trans>
      );
  }
}

/**
 * What the declaration carried into the first assessed year. Everything
 * after it is recomputed from the trades.
 */
export function OpeningBalances({
  settings,
  onSaved,
}: {
  settings: IncomeTaxSettings;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const startYear = settings.startYear;
  const previousYear = startYear - 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="incomeTax.opening.title">Opening balances</Trans>
        </CardTitle>
        <CardDescription>
          {settings.configured ? (
            <Trans id="incomeTax.opening.description">
              Assessment starts in January {startYear} with what your{" "}
              {previousYear} declaration carried forward. Earlier sales still
              set the average cost but are not assessed again.
            </Trans>
          ) : (
            <Trans id="incomeTax.opening.notConfigured">
              Not set yet: assessment starts at your first trade with nothing
              carried. Enter the losses and pending tax from your last
              declaration.
            </Trans>
          )}
        </CardDescription>
        <CardAction className="print:hidden">
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Pencil aria-hidden="true" />
            <Trans id="incomeTax.opening.edit">Edit</Trans>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">
              <Trans id="incomeTax.opening.startYear">
                First assessed year
              </Trans>
            </dt>
            <dd className="font-medium tabular-nums">{startYear}</dd>
          </div>
          {AMOUNT_FIELDS.map((field) => (
            <div key={field}>
              <dt className="text-muted-foreground">{fieldLabel(field)}</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(settings[field], "BRL")}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
      {open ? (
        <OpeningBalancesDialog
          settings={settings}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      ) : null}
    </Card>
  );
}

function OpeningBalancesDialog({
  settings,
  onClose,
  onSaved,
}: {
  settings: IncomeTaxSettings;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [yearText, setYearText] = useState(String(settings.startYear));
  const [amounts, setAmounts] = useState<Record<AmountField, string>>(() => ({
    ordinaryLoss: formatDecimalInput(settings.ordinaryLoss),
    dayTradeLoss: formatDecimalInput(settings.dayTradeLoss),
    fiiLoss: formatDecimalInput(settings.fiiLoss),
    foreignLoss: formatDecimalInput(settings.foreignLoss),
    pendingDarf: formatDecimalInput(settings.pendingDarf),
  }));
  const save = trpc.incomeTax.saveSettings.useMutation({
    onSuccess: async () => {
      toast.success(
        t({ id: "incomeTax.opening.saved", message: "Opening balances saved" }),
      );
      await onSaved();
      onClose();
    },
    onError: (error) => toast.error(queryErrorMessage(error)),
  });
  const parsed = incomeTaxSettingsInput.safeParse({
    startYear: Number(yearText),
    ...Object.fromEntries(
      AMOUNT_FIELDS.map((field) => [
        field,
        parseDecimalInput(amounts[field] === "" ? "0" : amounts[field]) ?? "",
      ]),
    ),
  });
  const invalid = new Set(
    parsed.success
      ? []
      : parsed.error.issues.map((issue) => String(issue.path[0])),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (parsed.success) save.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              <Trans id="incomeTax.opening.dialogTitle">
                Edit opening balances
              </Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans id="incomeTax.opening.dialogDescription">
                Copy them from your last declaration: the losses left to offset
                in the Renda Variável sheet (December column) and any tax below
                R$ 10 not paid yet. Amounts in reais.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="income-tax-start-year">
                <Trans id="incomeTax.opening.startYear">
                  First assessed year
                </Trans>
              </Label>
              <Input
                id="income-tax-start-year"
                inputMode="numeric"
                value={yearText}
                onChange={(event) => setYearText(event.target.value)}
                aria-invalid={invalid.has("startYear") || undefined}
              />
            </div>
            {AMOUNT_FIELDS.map((field) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={`income-tax-${field}`}>
                  {fieldLabel(field)}
                </Label>
                <Input
                  id={`income-tax-${field}`}
                  inputMode="decimal"
                  placeholder="0"
                  value={amounts[field]}
                  onChange={(event) =>
                    setAmounts((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                  aria-invalid={invalid.has(field) || undefined}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              <Trans id="incomeTax.opening.cancel">Cancel</Trans>
            </Button>
            <Button type="submit" disabled={!parsed.success || save.isPending}>
              {save.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              <Trans id="incomeTax.opening.save">Save</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
