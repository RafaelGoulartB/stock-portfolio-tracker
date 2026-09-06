import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  ASSET_CLASS_LABELS,
  ASSET_CLASSES,
  type AssetClass,
  CURRENCIES,
  CURRENCY_LABELS,
  type Currency,
  discountRatio,
  tickerSchema,
  weightRatio,
} from "@portifolio-tracker/shared";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { parsePercentInput } from "@/lib/numeric-input";

export type AddAssetValues = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  targetWeight: string | null;
  discount: string | null;
};

/**
 * Adds a ticker to the table without a trade behind it: a watch-only asset,
 * which can already carry a target and a discount so it competes for the
 * next contribution.
 */
export function AddAssetDialog({
  onSubmit,
  saving = false,
}: {
  onSubmit: (values: AddAssetValues) => Promise<void> | void;
  saving?: boolean;
}) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("stock_us");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [target, setTarget] = useState("");
  const [discount, setDiscount] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTicker("");
    setAssetClass("stock_us");
    setCurrency("USD");
    setTarget("");
    setDiscount("");
    setError(null);
  }

  async function submit() {
    const parsedTicker = tickerSchema.safeParse(ticker);

    if (!parsedTicker.success) {
      setError(
        i18n._(
          t({
            id: "allocation.addTickerInvalid",
            message: "Use letters, digits, dots or hyphens.",
          }),
        ),
      );

      return;
    }

    const targetValue = target.trim() ? parsePercentInput(target) : null;
    const discountValue = discount.trim() ? parsePercentInput(discount) : null;

    if (
      target.trim() &&
      (targetValue === null || !weightRatio.safeParse(targetValue).success)
    ) {
      setError(
        i18n._(
          t({
            id: "allocation.addTargetInvalid",
            message: "Use a target between 0% and 100%.",
          }),
        ),
      );

      return;
    }

    if (
      discount.trim() &&
      (discountValue === null ||
        !discountRatio.safeParse(discountValue).success)
    ) {
      setError(
        i18n._(
          t({
            id: "allocation.addDiscountInvalid",
            message: "Use a discount above -100%.",
          }),
        ),
      );

      return;
    }

    await onSubmit({
      ticker: parsedTicker.data,
      assetClass,
      currency,
      targetWeight: targetValue,
      discount: discountValue,
    });
    reset();
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus aria-hidden="true" />
          <Trans id="allocation.addAsset">Add asset</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans id="allocation.addTitle">Add asset to follow</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="allocation.addDescription">
              Watch-only assets have no invested amount. They stay in the table
              with their target and discount, so the score can already rank
              them.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="allocation-add-ticker">
              <Trans id="allocation.addTicker">Ticker</Trans>
            </Label>
            <Input
              id="allocation-add-ticker"
              value={ticker}
              autoComplete="off"
              className="uppercase"
              placeholder="CAVA"
              onChange={(event) => {
                setTicker(event.target.value);
                setError(null);
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="allocation-add-class">
                <Trans id="allocation.addClass">Class</Trans>
              </Label>
              <Select
                value={assetClass}
                onValueChange={(value) => setAssetClass(value as AssetClass)}
              >
                <SelectTrigger id="allocation-add-class" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CLASSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ASSET_CLASS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="allocation-add-currency">
                <Trans id="allocation.addCurrency">Currency</Trans>
              </Label>
              <Select
                value={currency}
                onValueChange={(value) => setCurrency(value as Currency)}
              >
                <SelectTrigger id="allocation-add-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CURRENCY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="allocation-add-target">
                <Trans id="allocation.addTarget">Target (%)</Trans>
              </Label>
              <Input
                id="allocation-add-target"
                value={target}
                inputMode="decimal"
                placeholder="1,5"
                onChange={(event) => {
                  setTarget(event.target.value);
                  setError(null);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="allocation-add-discount">
                <Trans id="allocation.addDiscount">Discount (%)</Trans>
              </Label>
              <Input
                id="allocation-add-discount"
                value={discount}
                inputMode="decimal"
                placeholder="20"
                onChange={(event) => {
                  setDiscount(event.target.value);
                  setError(null);
                }}
              />
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            <Trans id="allocation.addCancel">Cancel</Trans>
          </Button>
          <Button type="button" disabled={saving} onClick={submit}>
            <Trans id="allocation.addConfirm">Add asset</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
