import { Trans } from "@lingui/react/macro";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { THEME_PALETTES } from "@/lib/theme-palette";
import { useThemePalette } from "@/lib/theme-palette-provider";
import { cn } from "@/lib/utils";

const COLOR_SCHEMES = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

/** Color scheme cards and named palettes for Settings → Appearance. */
export function SettingsAppearance() {
  const { theme, setTheme } = useTheme();
  const { paletteId, setPaletteId } = useThemePalette();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeScheme = mounted ? (theme ?? "system") : "system";

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h3 className="text-sm font-medium">
          <Trans id="settings.appearance.colorScheme">Color scheme</Trans>
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {COLOR_SCHEMES.map((scheme) => {
            const selected = activeScheme === scheme.value;

            return (
              <button
                key={scheme.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setTheme(scheme.value)}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-2 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "border-ring bg-accent/40 ring-1 ring-ring",
                )}
              >
                <SchemePreview scheme={scheme.value} />
                <span className="flex items-center gap-1.5 px-1 text-sm font-medium">
                  <scheme.icon className="size-3.5" aria-hidden="true" />
                  {scheme.value === "light" ? (
                    <Trans id="theme.light">Light</Trans>
                  ) : scheme.value === "dark" ? (
                    <Trans id="theme.dark">Dark</Trans>
                  ) : (
                    <Trans id="theme.system">System</Trans>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">
            <Trans id="settings.appearance.themes">Themes</Trans>
          </h3>
          <p className="text-xs text-muted-foreground">
            <Trans id="settings.appearance.themesHint">
              Palettes tint chrome and accents. Gain and loss colors stay the
              same.
            </Trans>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {THEME_PALETTES.map((palette) => {
            const selected = paletteId === palette.id;

            return (
              <button
                key={palette.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setPaletteId(palette.id)}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border p-3 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "border-ring bg-accent/40 ring-1 ring-ring",
                )}
              >
                <span className="flex items-center" aria-hidden="true">
                  <span
                    className="size-9 rounded-full"
                    style={{ background: palette.swatch.light }}
                  />
                  <span
                    className="size-9 -ml-3 rounded-full ring-2 ring-background"
                    style={{ background: palette.swatch.dark }}
                  />
                </span>
                <span className="text-sm font-medium">
                  {palette.id === "default" ? (
                    <Trans id="settings.appearance.themeDefault">Default</Trans>
                  ) : (
                    palette.name
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SchemePreview({ scheme }: { scheme: "system" | "light" | "dark" }) {
  if (scheme === "system") {
    return (
      <span
        aria-hidden="true"
        className="relative block aspect-[16/10] overflow-hidden rounded-md border"
      >
        <MiniChrome
          className="absolute inset-0"
          background="#f4f4f5"
          card="#ffffff"
          text="#18181b"
          muted="#d4d4d8"
        />
        <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
          <MiniChrome
            className="absolute inset-0"
            background="#18181b"
            card="#27272a"
            text="#fafafa"
            muted="#3f3f46"
          />
        </span>
      </span>
    );
  }

  const dark = scheme === "dark";

  return (
    <MiniChrome
      className="aspect-[16/10] overflow-hidden rounded-md border"
      background={dark ? "#18181b" : "#f4f4f5"}
      card={dark ? "#27272a" : "#ffffff"}
      text={dark ? "#fafafa" : "#18181b"}
      muted={dark ? "#3f3f46" : "#d4d4d8"}
    />
  );
}

function MiniChrome({
  className,
  background,
  card,
  text,
  muted,
}: {
  className?: string;
  background: string;
  card: string;
  text: string;
  muted: string;
}) {
  return (
    <span className={cn("flex flex-col", className)} style={{ background }}>
      <span
        className="flex h-1/4 items-center gap-1 px-1.5"
        style={{ background: card }}
      >
        <span className="size-1.5 rounded-full" style={{ background: text }} />
        <span className="h-1 w-5 rounded-full" style={{ background: muted }} />
      </span>
      <span className="flex flex-1 gap-1 p-1.5">
        <span className="w-1/4 rounded-sm" style={{ background: card }} />
        <span className="flex flex-1 flex-col justify-center gap-1">
          <span
            className="h-1 w-full rounded-full"
            style={{ background: text }}
          />
          <span
            className="h-1 w-2/3 rounded-full"
            style={{ background: muted }}
          />
        </span>
      </span>
    </span>
  );
}
