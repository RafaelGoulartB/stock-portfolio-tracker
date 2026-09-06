import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Check, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type AppLocale, activateLocale, LOCALES } from "@/i18n";
import { cn } from "@/lib/utils";

const LABELS: Record<AppLocale, string> = {
  en: "EN",
  "pt-BR": "PT-BR",
};

/** Compact locale switcher (EN / PT-BR). Mirrors the theme switcher dropdown. */
export function LanguageSwitcher() {
  const { i18n } = useLingui();
  const active = (i18n.locale ?? "en") as AppLocale;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={i18n._(msg({ id: "shell.language", message: "Language" }))}
        >
          <Languages className="size-4" aria-hidden="true" />
          <span className="sr-only">
            <Trans id="shell.language">Language</Trans>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => {
              if (locale !== active) {
                void activateLocale(locale);
              }
            }}
            className={cn(active === locale && "font-medium")}
          >
            {LABELS[locale]}
            {active === locale ? (
              <Check className="ml-auto size-4" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
