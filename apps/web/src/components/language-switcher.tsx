import { useLingui } from "@lingui/react";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type AppLocale, activateLocale, LOCALES } from "@/i18n";

const LABELS: Record<AppLocale, string> = {
  en: "EN",
  "pt-BR": "PT-BR",
};

/** Compact locale switcher for the app shell. No locale appears in the URL. */
export function LanguageSwitcher() {
  const { i18n } = useLingui();
  const active = (i18n.locale ?? "en") as AppLocale;

  return (
    <div className="flex items-center gap-1">
      <Languages className="size-4 text-muted-foreground" aria-hidden="true" />
      {LOCALES.map((locale) => (
        <Button
          key={locale}
          type="button"
          variant={locale === active ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2 text-xs"
          aria-pressed={locale === active}
          onClick={() => {
            if (locale !== active) {
              void activateLocale(locale);
            }
          }}
        >
          {LABELS[locale]}
        </Button>
      ))}
    </div>
  );
}
