import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
] as const;

/** Compact theme control (Light / Dark / System). Persisted in localStorage by next-themes. */
export function ThemeSwitcher() {
  const { i18n } = useLingui();
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="relative"
          aria-label={i18n._(msg({ id: "theme.toggle", message: "Theme" }))}
        >
          <Sun
            className="size-4 scale-100 rotate-0 transition-none dark:scale-0 dark:-rotate-90"
            aria-hidden="true"
          />
          <Moon
            className="absolute size-4 scale-0 rotate-90 transition-none dark:scale-100 dark:rotate-0"
            aria-hidden="true"
          />
          <span className="sr-only">
            <Trans id="theme.toggle">Theme</Trans>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
            className={cn(theme === option.value && "font-medium")}
          >
            <option.icon className="size-4" aria-hidden="true" />
            {option.value === "light" ? (
              <Trans id="theme.light">Light</Trans>
            ) : option.value === "dark" ? (
              <Trans id="theme.dark">Dark</Trans>
            ) : (
              <Trans id="theme.system">System</Trans>
            )}
            {theme === option.value ? (
              <Check className="ml-auto size-4" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
