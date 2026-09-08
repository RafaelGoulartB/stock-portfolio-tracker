import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  CURRENCIES,
  type Currency,
  FX_SOURCE_LABELS,
  type FxSource,
  QUOTE_SOURCE_LABELS,
  type QuoteSource,
} from "@portifolio-tracker/shared";
import {
  Database,
  Palette,
  RefreshCw,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { SettingsAppearance } from "@/components/settings-appearance";
import { SettingsData } from "@/components/settings-data";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  currencyText,
  fxSourceText,
  quoteSourceText,
} from "@/lib/display-labels";
import { formatQuantity, formatTradeDate } from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

type SettingsSection = "general" | "appearance" | "data";

const SECTIONS: {
  id: SettingsSection;
  icon: typeof Settings;
}[] = [
  { id: "general", icon: SlidersHorizontal },
  { id: "appearance", icon: Palette },
  { id: "data", icon: Database },
];

/** Header shortcut that opens the portfolio settings modal. */
export function SettingsDialog() {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("general");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);

        if (!nextOpen) {
          setSection("general");
        }
      }}
    >
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
      <DialogContent className="flex h-[min(42rem,calc(100svh-2rem))] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl sm:flex-row">
        <SettingsSidebar section={section} onSectionChange={setSection} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DialogHeader className="gap-1.5 border-b bg-muted/20 px-6 py-5 pr-12 text-left">
            <DialogTitle className="flex items-center gap-3">
              <DialogTitleIcon>
                {section === "appearance" ? (
                  <Palette aria-hidden="true" />
                ) : section === "data" ? (
                  <Database aria-hidden="true" />
                ) : (
                  <SlidersHorizontal aria-hidden="true" />
                )}
              </DialogTitleIcon>
              <span>
                <Trans id="settings.title">Settings</Trans>
                <span className="text-muted-foreground"> / </span>
                <SettingsSectionLabel section={section} />
              </span>
            </DialogTitle>
            <DialogDescription>
              {section === "appearance" ? (
                <Trans id="settings.appearance.description">
                  Color scheme and palette used across the dashboard.
                </Trans>
              ) : section === "data" ? (
                <Trans id="settings.data.description">
                  Portable backups, restores, test fixtures, and data removal.
                </Trans>
              ) : (
                <Trans id="settings.description">
                  Display currency, exchange-rate source, and market-quote
                  source used to consolidate the portfolio.
                </Trans>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {section === "appearance" ? (
              <SettingsAppearance />
            ) : section === "data" ? (
              <SettingsData />
            ) : (
              <GeneralSettings />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsSidebar({
  section,
  onSectionChange,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const { i18n } = useLingui();
  const navLabel = i18n._(msg({ id: "settings.title", message: "Settings" }));

  return (
    <>
      <nav
        className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 pr-12 sm:hidden"
        aria-label={navLabel}
      >
        {SECTIONS.map((item) => (
          <SectionButton
            key={item.id}
            section={item.id}
            icon={item.icon}
            active={section === item.id}
            onSelect={() => onSectionChange(item.id)}
          />
        ))}
      </nav>
      <aside className="hidden w-52 shrink-0 flex-col gap-1 border-r bg-muted/40 p-3 sm:flex">
        <nav className="flex flex-col gap-1" aria-label={navLabel}>
          {SECTIONS.map((item) => (
            <SectionButton
              key={item.id}
              section={item.id}
              icon={item.icon}
              active={section === item.id}
              onSelect={() => onSectionChange(item.id)}
            />
          ))}
        </nav>
      </aside>
    </>
  );
}

function SectionButton({
  section,
  icon: Icon,
  active,
  onSelect,
}: {
  section: SettingsSection;
  icon: typeof Settings;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      <SettingsSectionLabel section={section} />
    </button>
  );
}

function SettingsSectionLabel({ section }: { section: SettingsSection }) {
  return section === "appearance" ? (
    <Trans id="settings.section.appearance">Appearance</Trans>
  ) : section === "data" ? (
    <Trans id="settings.section.data">Data</Trans>
  ) : (
    <Trans id="settings.section.general">General</Trans>
  );
}

function GeneralSettings() {
  const { i18n } = useLingui();
  const {
    displayCurrency,
    setDisplayCurrency,
    fxSource,
    setFxSource,
    manualRate,
    setManualRate,
    quoteSource,
    setQuoteSource,
    showLogos,
    setShowLogos,
  } = useSettings();
  const fx = useFxQuote();

  return (
    <div className="grid max-w-lg gap-5">
      <Field
        label={
          <Label htmlFor="settings-display-currency">
            <Trans id="positions.displayCurrency">Display currency</Trans>
          </Label>
        }
      >
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
                {currencyText(currency, i18n)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label={
          <Label htmlFor="settings-fx-source">
            <Trans id="positions.fxSource">Exchange-rate source</Trans>
          </Label>
        }
      >
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
                {fxSourceText(source, i18n)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {fxSource === "manual" ? (
        <Field
          label={
            <Label htmlFor="settings-fx-rate">
              <Trans id="positions.fxRate">USD/BRL rate</Trans>
            </Label>
          }
        >
          <Input
            id="settings-fx-rate"
            inputMode="decimal"
            placeholder="5.00"
            value={manualRate}
            onChange={(event) => setManualRate(event.target.value)}
            aria-invalid={fx.manualRateInvalid}
            aria-describedby={
              fx.manualRateInvalid ? "settings-fx-rate-error" : undefined
            }
          />
          {fx.manualRateInvalid ? (
            <p
              id="settings-fx-rate-error"
              role="alert"
              className="text-xs text-destructive"
            >
              <Trans id="settings.fxManualRateInvalid">
                Enter a rate above zero, e.g. 5.00, to consolidate your
                portfolio.
              </Trans>
            </p>
          ) : null}
        </Field>
      ) : (
        <Field
          label={
            <span className="text-sm font-medium">
              <Trans id="positions.fxRate">USD/BRL rate</Trans>
            </span>
          }
        >
          <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/60 px-3 text-sm tabular-nums dark:bg-black/25">
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
              aria-label={i18n._(
                t({ id: "settings.fxRefresh", message: "Refresh rate" }),
              )}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </Field>
      )}

      <Field
        label={
          <Label htmlFor="settings-quote-source">
            <Trans id="positions.quoteSource">Market-quote source</Trans>
          </Label>
        }
      >
        <Select
          value={quoteSource}
          onValueChange={(value) => setQuoteSource(value as QuoteSource)}
        >
          <SelectTrigger id="settings-quote-source" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(QUOTE_SOURCE_LABELS) as QuoteSource[]).map(
              (source) => (
                <SelectItem key={source} value={source}>
                  {quoteSourceText(source, i18n)}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {quoteSource === "manual" ? (
            <Trans id="positions.quoteSourceManualHint">
              Manual prices are entered per ticker on the Positions page.
            </Trans>
          ) : (
            <Trans id="positions.quoteSourceHint">
              Free delayed quotes used for market values and allocation.
            </Trans>
          )}
        </p>
      </Field>

      <Field
        label={
          <Label htmlFor="settings-show-logos">
            <Trans id="settings.showLogos">Show company logos</Trans>
          </Label>
        }
      >
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            <Trans id="settings.showLogosHint">
              Turn this off to use ticker initials and make no Logo.dev image
              requests.
            </Trans>
          </p>
          <Switch
            id="settings-show-logos"
            checked={showLogos}
            onCheckedChange={setShowLogos}
          />
        </div>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      {label}
      {children}
    </div>
  );
}
