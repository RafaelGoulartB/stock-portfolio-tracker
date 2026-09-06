import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  type Currency,
  FX_SOURCE_LABELS,
  type FxSource,
} from "@portifolio-tracker/shared";
import { RefreshCw, Settings } from "lucide-react";
import { useState } from "react";
import { DevSeedSection } from "@/components/dev-seed-section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Skeleton } from "@/components/ui/skeleton";
import { formatQuantity, formatTradeDate } from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { useSettings } from "@/lib/settings";

/** Header shortcut that opens the portfolio settings modal. */
export function SettingsDialog() {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={i18n._(msg({ id: "settings.open", message: "Settings" }))}
        >
          <Settings className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans id="settings.title">Settings</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="settings.description">
              Display currency and exchange-rate source used to consolidate the
              portfolio.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <SettingsForm />
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm() {
  const {
    displayCurrency,
    setDisplayCurrency,
    fxSource,
    setFxSource,
    manualRate,
    setManualRate,
  } = useSettings();
  const fx = useFxQuote();

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="settings-display-currency">
          <Trans id="positions.displayCurrency">Display currency</Trans>
        </Label>
        <Select
          value={displayCurrency}
          onValueChange={(value) => setDisplayCurrency(value as Currency)}
        >
          <SelectTrigger id="settings-display-currency" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((currency) => (
              <SelectItem key={currency} value={currency}>
                {CURRENCY_LABELS[currency]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="settings-fx-source">
          <Trans id="positions.fxSource">Exchange-rate source</Trans>
        </Label>
        <Select
          value={fxSource}
          onValueChange={(value) => setFxSource(value as FxSource)}
        >
          <SelectTrigger id="settings-fx-source" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FX_SOURCE_LABELS) as FxSource[]).map((source) => (
              <SelectItem key={source} value={source}>
                {FX_SOURCE_LABELS[source]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {fxSource === "manual" ? (
        <div className="grid gap-2">
          <Label htmlFor="settings-fx-rate">
            <Trans id="positions.fxRate">USD/BRL rate</Trans>
          </Label>
          <Input
            id="settings-fx-rate"
            inputMode="decimal"
            placeholder="5.00"
            value={manualRate}
            onChange={(event) => setManualRate(event.target.value)}
            aria-invalid={!fx.manualRateValid}
          />
        </div>
      ) : (
        <div className="grid gap-2">
          <span className="text-sm font-medium">
            <Trans id="positions.fxRate">USD/BRL rate</Trans>
          </span>
          <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm tabular-nums">
            {fx.isPending ? (
              <Skeleton className="h-4 w-40" />
            ) : fx.rate ? (
              <span className="text-muted-foreground">
                1 USD = {formatQuantity(fx.rate)} BRL
                {fx.asOf ? ` · ${formatTradeDate(fx.asOf)}` : null}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto size-7"
              onClick={() => fx.refetch()}
              aria-label="Refresh rate"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
      {/* DEV-ONLY test-data seeder; renders nothing in production builds. */}
      {import.meta.env.DEV ? <DevSeedSection /> : null}
    </div>
  );
}
