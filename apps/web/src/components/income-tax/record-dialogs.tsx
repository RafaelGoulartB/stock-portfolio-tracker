import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  assetTaxProfileInput,
  darfPaymentInput,
  type ForeignCashBalance,
  foreignCashInput,
  type IncomeTaxHolding,
  normalizeCnpj,
} from "@portifolio-tracker/shared";
import { Loader2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
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
import { trpc } from "@/lib/api";
import { formatMoney, formatTradeDate } from "@/lib/format";
import {
  formatDecimalInput,
  multiplyToCents,
  parseDecimalInput,
} from "@/lib/numeric-input";
import { queryErrorMessage } from "@/lib/trpcErrors";

function useRefreshTax() {
  const utils = trpc.useUtils();

  return () => utils.incomeTax.report.invalidate();
}

function DialogShell({
  title,
  description,
  onClose,
  onSubmit,
  canSubmit,
  pending,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
  pending: boolean;
  children: ReactNode;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">{children}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              <Trans id="incomeTax.dialog.cancel">Cancel</Trans>
            </Button>
            <Button type="submit" disabled={!canSubmit || pending}>
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              <Trans id="incomeTax.dialog.save">Save</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  hint,
  invalid,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  invalid?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {invalid ? (
        <p className="text-xs text-destructive">{invalid}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** The day after a month ends, the earliest a DARF of that month is paid. */
function defaultPaidOn(month: string): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 2000, index ?? 1, 1));

  return date.toISOString().slice(0, 10);
}

export function DarfPaymentDialog({
  month,
  monthLabel,
  due,
  paid,
  paidOn,
  onClose,
}: {
  month: string;
  monthLabel: string;
  due: string;
  paid: string | null;
  paidOn: string | null;
  onClose: () => void;
}) {
  const refresh = useRefreshTax();
  const [amountText, setAmountText] = useState(formatDecimalInput(paid ?? due));
  const [paidOnText, setPaidOnText] = useState(paidOn ?? defaultPaidOn(month));
  const record = trpc.incomeTax.recordDarfPayment.useMutation({
    onSuccess: async () => {
      toast.success(
        t({ id: "incomeTax.darf.saved", message: "DARF payment saved" }),
      );
      await refresh();
      onClose();
    },
    onError: (error) => toast.error(queryErrorMessage(error)),
  });
  const parsed = darfPaymentInput.safeParse({
    month,
    paidOn: paidOnText,
    amount: parseDecimalInput(amountText) ?? "",
  });
  const dueText = formatMoney(due, "BRL");

  return (
    <DialogShell
      title={
        <Trans id="incomeTax.darf.dialogTitle">
          DARF paid for {monthLabel}
        </Trans>
      }
      description={
        <Trans id="incomeTax.darf.dialogDescription">
          Code 6015. The assessment shows {dueText} due; enter what you actually
          paid, including any fine or interest.
        </Trans>
      }
      onClose={onClose}
      onSubmit={() => parsed.success && record.mutate(parsed.data)}
      canSubmit={parsed.success}
      pending={record.isPending}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="darf-paid-on"
          label={<Trans id="incomeTax.darf.paidOn">Paid on</Trans>}
        >
          <Input
            id="darf-paid-on"
            type="date"
            value={paidOnText}
            onChange={(event) => setPaidOnText(event.target.value)}
          />
        </Field>
        <Field
          id="darf-amount"
          label={<Trans id="incomeTax.darf.amount">Amount paid (R$)</Trans>}
        >
          <Input
            id="darf-amount"
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
          />
        </Field>
      </div>
    </DialogShell>
  );
}

export function AssetProfileDialog({
  holding,
  onClose,
}: {
  holding: IncomeTaxHolding;
  onClose: () => void;
}) {
  const refresh = useRefreshTax();
  const [legalName, setLegalName] = useState(holding.legalName ?? "");
  const [cnpj, setCnpj] = useState(holding.cnpj ?? "");
  const [broker, setBroker] = useState(holding.broker ?? "");
  const save = trpc.incomeTax.saveAssetProfile.useMutation({
    onSuccess: async () => {
      toast.success(
        t({ id: "incomeTax.profile.saved", message: "Tax details saved" }),
      );
      await refresh();
      onClose();
    },
    onError: (error) => toast.error(queryErrorMessage(error)),
  });
  const domestic = holding.currency === "BRL";
  const profileInput = {
    ticker: holding.ticker,
    legalName,
    cnpj: domestic ? cnpj : "",
    broker,
  };
  const parsed = assetTaxProfileInput.safeParse(profileInput);
  const cnpjInvalid =
    domestic && cnpj.trim() !== "" && normalizeCnpj(cnpj) === null;
  const ticker = holding.ticker;

  return (
    <DialogShell
      title={
        <Trans id="incomeTax.profile.dialogTitle">
          Tax details of {ticker}
        </Trans>
      }
      description={
        <Trans id="incomeTax.profile.dialogDescription">
          Used in the Bens e Direitos description. Copy the issuer from your
          broker&apos;s income report. Leave a field empty to clear it.
        </Trans>
      }
      onClose={onClose}
      onSubmit={() => parsed.success && save.mutate(profileInput)}
      canSubmit={parsed.success}
      pending={save.isPending}
    >
      <Field
        id="profile-legal-name"
        label={<Trans id="incomeTax.profile.legalName">Legal name</Trans>}
      >
        <Input
          id="profile-legal-name"
          value={legalName}
          maxLength={160}
          onChange={(event) => setLegalName(event.target.value)}
        />
      </Field>
      {domestic ? (
        <Field
          id="profile-cnpj"
          label={<Trans id="incomeTax.profile.cnpj">CNPJ</Trans>}
          hint={
            <Trans id="incomeTax.profile.cnpjHint">
              Numeric or the new alphanumeric format; check digits are verified.
            </Trans>
          }
          invalid={
            cnpjInvalid ? (
              <Trans id="incomeTax.profile.cnpjInvalid">
                This CNPJ is not valid.
              </Trans>
            ) : null
          }
        >
          <Input
            id="profile-cnpj"
            value={cnpj}
            placeholder="00.000.000/0000-00"
            aria-invalid={cnpjInvalid || undefined}
            onChange={(event) => setCnpj(event.target.value)}
          />
        </Field>
      ) : null}
      <Field
        id="profile-broker"
        label={<Trans id="incomeTax.profile.broker">Broker</Trans>}
        hint={
          <Trans id="incomeTax.profile.brokerHint">
            Filled from your imported broker notes when empty.
          </Trans>
        }
      >
        <Input
          id="profile-broker"
          value={broker}
          maxLength={160}
          onChange={(event) => setBroker(event.target.value)}
        />
      </Field>
    </DialogShell>
  );
}

export function ForeignCashDialog({
  year,
  balance,
  onClose,
}: {
  year: number;
  balance: ForeignCashBalance | null;
  onClose: () => void;
}) {
  const refresh = useRefreshTax();
  const [amountText, setAmountText] = useState(
    formatDecimalInput(balance?.amountUsd ?? null),
  );
  const [valueText, setValueText] = useState(
    formatDecimalInput(balance?.valueBrl ?? null),
  );
  const [institution, setInstitution] = useState(balance?.institution ?? "");
  const rate = trpc.incomeTax.yearEndBuyRate.useQuery(
    { year },
    { staleTime: Number.POSITIVE_INFINITY, retry: false },
  );
  const save = trpc.incomeTax.saveForeignCash.useMutation({
    onSuccess: async () => {
      toast.success(
        t({ id: "incomeTax.cash.saved", message: "Balance abroad saved" }),
      );
      await refresh();
      onClose();
    },
    onError: (error) => toast.error(queryErrorMessage(error)),
  });
  const remove = trpc.incomeTax.removeForeignCash.useMutation({
    onSuccess: async () => {
      toast.success(
        t({ id: "incomeTax.cash.removed", message: "Balance abroad removed" }),
      );
      await refresh();
      onClose();
    },
    onError: (error) => toast.error(queryErrorMessage(error)),
  });
  const amount = parseDecimalInput(amountText);
  const cashInput = {
    year,
    amountUsd: amount ?? "",
    valueBrl: parseDecimalInput(valueText) ?? "",
    institution,
  };
  const parsed = foreignCashInput.safeParse(cashInput);
  const rateDate = rate.data ? formatTradeDate(rate.data.asOf) : "";
  const rateText = rate.data
    ? formatDecimalInput(rate.data.rate.replace(/0+$/, ""))
    : "";

  function convert() {
    if (!rate.data || amount === null) return;
    setValueText(formatDecimalInput(multiplyToCents(amount, rate.data.rate)));
  }

  return (
    <DialogShell
      title={
        <Trans id="incomeTax.cash.dialogTitle">
          Dollars held abroad on 31/12/{year}
        </Trans>
      }
      description={
        <Trans id="incomeTax.cash.dialogDescription">
          A non-remunerated balance at your foreign broker (Bens e Direitos,
          group 06, code 01). Its exchange variation is not taxed. Enter the
          value in reais the way your declaration states it.
        </Trans>
      }
      onClose={onClose}
      onSubmit={() => parsed.success && save.mutate(cashInput)}
      canSubmit={parsed.success}
      pending={save.isPending}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="cash-usd"
          label={<Trans id="incomeTax.cash.amount">Balance (US$)</Trans>}
        >
          <Input
            id="cash-usd"
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
          />
        </Field>
        <Field
          id="cash-brl"
          label={<Trans id="incomeTax.cash.value">Value (R$)</Trans>}
          hint={
            rate.data ? (
              <Trans id="incomeTax.cash.rateHint">
                PTAX buy rate of {rateDate}: {rateText}
              </Trans>
            ) : rate.isPending ? null : (
              <Trans id="incomeTax.cash.rateUnavailable">
                The 31 December rate is not available yet.
              </Trans>
            )
          }
        >
          <div className="flex gap-2">
            <Input
              id="cash-brl"
              inputMode="decimal"
              value={valueText}
              onChange={(event) => setValueText(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!rate.data || amount === null}
              onClick={convert}
            >
              <Trans id="incomeTax.cash.convert">Convert</Trans>
            </Button>
          </div>
        </Field>
      </div>
      <Field
        id="cash-institution"
        label={<Trans id="incomeTax.cash.institution">Institution</Trans>}
      >
        <Input
          id="cash-institution"
          value={institution}
          maxLength={160}
          placeholder="Inter&Co"
          onChange={(event) => setInstitution(event.target.value)}
        />
      </Field>
      {balance ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ year })}
          >
            <Trans id="incomeTax.cash.remove">Remove this balance</Trans>
          </Button>
        </div>
      ) : null}
    </DialogShell>
  );
}
