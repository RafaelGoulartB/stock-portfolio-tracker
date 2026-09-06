import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  Check,
  ChevronDown,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type AppLocale, activateLocale, LOCALES } from "@/i18n";
import { cn } from "@/lib/utils";

const LOCALE_NAMES: Record<AppLocale, string> = {
  en: "English",
  "pt-BR": "Português",
};

const THEME_OPTIONS = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
] as const;

/** Up to two initials from the account email, e.g. `rafael.silva@…` → `RS`. */
export function initialsOf(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");

  return letters.join("").toUpperCase() || "?";
}

/**
 * Account control: an initials avatar that opens a menu with the signed-in
 * email, inline expandable language and theme sections, and the sign-out action.
 */
export function UserMenu({
  email,
  signingOut,
  onSignOut,
}: {
  email: string;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const { i18n } = useLingui();
  const activeLocale = (i18n.locale ?? "en") as AppLocale;
  const { theme, setTheme } = useTheme();
  const ActiveThemeIcon =
    THEME_OPTIONS.find((option) => option.value === theme)?.icon ?? Monitor;
  const [languageOpen, setLanguageOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          setLanguageOpen(false);
          setThemeOpen(false);
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={email}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar className="bg-primary text-primary-foreground">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {initialsOf(email)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="min-w-0">
          <span className="block truncate font-normal text-muted-foreground">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <div className="flex flex-col gap-1">
          <div
            className={cn(
              "rounded-md transition-colors duration-200",
              languageOpen && "bg-muted/50",
            )}
          >
            <DropdownMenuItem
              aria-expanded={languageOpen}
              onSelect={(event) => {
                event.preventDefault();
                setLanguageOpen((open) => !open);
              }}
            >
              <Languages className="size-4" aria-hidden="true" />
              <Trans id="shell.language">Language</Trans>
              <span className="ml-auto text-xs text-muted-foreground">
                {LOCALE_NAMES[activeLocale]}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 transition-transform duration-200",
                  languageOpen && "rotate-180",
                )}
              />
            </DropdownMenuItem>
            <div
              className={cn(
                "grid transition-all duration-200 ease-out motion-reduce:transition-none",
                languageOpen
                  ? "visible grid-rows-[1fr] opacity-100"
                  : "invisible grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="px-1 pb-1">
                  {LOCALES.map((locale) => {
                    const isActive = activeLocale === locale;
                    return (
                      <DropdownMenuItem
                        key={locale}
                        onClick={() => {
                          if (!isActive) {
                            void activateLocale(locale);
                          }
                        }}
                        className={cn(
                          "py-1.5 pl-8 text-[13px] leading-5",
                          isActive && "bg-background font-medium shadow-sm",
                        )}
                      >
                        {LOCALE_NAMES[locale]}
                        {isActive ? (
                          <Check
                            className="ml-auto size-4"
                            aria-hidden="true"
                          />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "rounded-md transition-colors duration-200",
              themeOpen && "bg-muted/50",
            )}
          >
            <DropdownMenuItem
              aria-expanded={themeOpen}
              onSelect={(event) => {
                event.preventDefault();
                setThemeOpen((open) => !open);
              }}
            >
              <ActiveThemeIcon className="size-4" aria-hidden="true" />
              <Trans id="theme.toggle">Theme</Trans>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "ml-auto size-4 transition-transform duration-200",
                  themeOpen && "rotate-180",
                )}
              />
            </DropdownMenuItem>
            <div
              className={cn(
                "grid transition-all duration-200 ease-out motion-reduce:transition-none",
                themeOpen
                  ? "visible grid-rows-[1fr] opacity-100"
                  : "invisible grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="px-1 pb-1">
                  {THEME_OPTIONS.map((option) => {
                    const isActive = theme === option.value;
                    return (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className={cn(
                          "py-1.5 pl-8 text-[13px] leading-5",
                          isActive && "bg-background font-medium shadow-sm",
                        )}
                      >
                        {option.value === "light" ? (
                          <Trans id="theme.light">Light</Trans>
                        ) : option.value === "dark" ? (
                          <Trans id="theme.dark">Dark</Trans>
                        ) : (
                          <Trans id="theme.system">System</Trans>
                        )}
                        {isActive ? (
                          <Check
                            className="ml-auto size-4"
                            aria-hidden="true"
                          />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} disabled={signingOut}>
          <LogOut className="size-4" aria-hidden="true" />
          <Trans id="shell.signOut">Sign out</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
