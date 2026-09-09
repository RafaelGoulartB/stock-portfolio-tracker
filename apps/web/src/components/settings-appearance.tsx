import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Check, Monitor, Moon, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import { ThemeEditor, type ThemeEditorDraft } from "@/components/theme-editor";
import { Button } from "@/components/ui/button";
import {
  type CustomTheme,
  createCustomThemeId,
  getDefaultThemeColors,
  THEME_COLOR_ROLES,
  THEME_PALETTE_ATTRIBUTE,
  THEME_PALETTES,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/theme-palette";
import { useThemePalette } from "@/lib/theme-palette-provider";
import { cn } from "@/lib/utils";

const COLOR_SCHEMES = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

type EditorState = {
  initialTheme: CustomTheme | null;
  fallbackName: string;
  seedColors?: Record<ThemeMode, ThemeColors>;
};

/** Color scheme cards, named palettes, and the lightweight custom theme editor. */
export function SettingsAppearance() {
  const { i18n } = useLingui();
  const { theme, setTheme } = useTheme();
  const {
    paletteId,
    customThemes,
    setPaletteId,
    saveCustomTheme,
    deleteCustomTheme,
    previewCustomTheme,
    clearThemePreview,
  } = useThemePalette();
  const [mounted, setMounted] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const defaultCustomThemeName = i18n._(
    msg({ id: "theme.customDefaultName", message: "Portfolio custom" }),
  );

  useEffect(() => {
    setMounted(true);
    return () => clearThemePreview();
  }, [clearThemePreview]);

  const activeScheme = mounted ? (theme ?? "system") : "system";

  const startEditor = (state: EditorState) => {
    setDeleteTarget(null);
    setEditor(state);
  };

  const startNewTheme = () => {
    startEditor({
      initialTheme: null,
      fallbackName: defaultCustomThemeName,
      seedColors: createPaletteEditorSeed("default"),
    });
  };

  const startEditingPalette = (id: string) => {
    const customTheme = customThemes.find((theme) => theme.id === id);
    if (customTheme) {
      startEditor({
        initialTheme: customTheme,
        fallbackName: customTheme.name,
      });
      return;
    }

    const palette = THEME_PALETTES.find((item) => item.id === id);
    startEditor({
      initialTheme: null,
      fallbackName: palette?.name ?? defaultCustomThemeName,
      seedColors: createPaletteEditorSeed(id),
    });
  };

  const handleEditorSave = (draft: ThemeEditorDraft) => {
    const id =
      draft.id ??
      createCustomThemeId(
        draft.name,
        customThemes.map((theme) => theme.id),
      );
    saveCustomTheme({
      id,
      name: draft.name,
      colors: draft.colors,
    });
    setEditor(null);
  };

  const handleEditorCancel = () => {
    clearThemePreview();
    setEditor(null);
  };

  const handleApplyPalette = (id: string) => {
    clearThemePreview();
    setEditor(null);
    setDeleteTarget(null);
    setPaletteId(id);
  };

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
        <div className="flex items-start justify-between gap-3">
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startNewTheme}
          >
            <Plus className="size-4" aria-hidden="true" />
            <Trans id="theme.create">Create theme</Trans>
          </Button>
        </div>

        {editor ? (
          <ThemeEditor
            initialTheme={editor.initialTheme}
            seedColors={editor.seedColors}
            fallbackName={editor.fallbackName}
            onCancel={handleEditorCancel}
            onPreview={previewCustomTheme}
            onSave={handleEditorSave}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {THEME_PALETTES.map((palette) => (
            <ThemeCard
              key={palette.id}
              name={
                palette.id === "default" ? (
                  <Trans id="settings.appearance.themeDefault">Default</Trans>
                ) : (
                  palette.name
                )
              }
              selected={paletteId === palette.id}
              lightColor={palette.swatch.light}
              darkColor={palette.swatch.dark}
              onApply={() => handleApplyPalette(palette.id)}
              onCustomize={
                palette.id === "default"
                  ? undefined
                  : () => startEditingPalette(palette.id)
              }
            />
          ))}
          {customThemes.map((theme) => (
            <ThemeCard
              key={theme.id}
              name={theme.name}
              selected={paletteId === theme.id}
              lightColor={theme.colors.light.primary}
              darkColor={theme.colors.dark.primary}
              onApply={() => handleApplyPalette(theme.id)}
              onCustomize={() => startEditingPalette(theme.id)}
              onDelete={() => setDeleteTarget(theme.id)}
              deletePending={deleteTarget === theme.id}
              onCancelDelete={() => setDeleteTarget(null)}
              onConfirmDelete={() => {
                deleteCustomTheme(theme.id);
                if (editor?.initialTheme?.id === theme.id) {
                  clearThemePreview();
                  setEditor(null);
                }
                setDeleteTarget(null);
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function createPaletteEditorSeed(
  paletteId: string,
): Record<ThemeMode, ThemeColors> {
  const light = { ...getDefaultThemeColors("light") };
  const dark = { ...getDefaultThemeColors("dark") };

  const lightPaletteColors = readBuiltInPaletteColors(paletteId, "light");
  const darkPaletteColors = readBuiltInPaletteColors(paletteId, "dark");
  if (lightPaletteColors) Object.assign(light, lightPaletteColors);
  if (darkPaletteColors) Object.assign(dark, darkPaletteColors);

  return { light, dark };
}

function readBuiltInPaletteColors(
  paletteId: string,
  mode: ThemeMode,
): ThemeColors | null {
  if (typeof document === "undefined") return null;

  const root = document.documentElement;
  const previousPalette = root.getAttribute(THEME_PALETTE_ATTRIBUTE);
  const wasDark = root.classList.contains("dark");
  const previousInlineColors = THEME_COLOR_ROLES.map((role) => ({
    role,
    priority: root.style.getPropertyPriority(`--${role}`),
    value: root.style.getPropertyValue(`--${role}`),
  }));

  try {
    for (const role of THEME_COLOR_ROLES) {
      root.style.removeProperty(`--${role}`);
    }
    root.setAttribute(THEME_PALETTE_ATTRIBUTE, paletteId);
    root.classList.toggle("dark", mode === "dark");

    const colors = {} as Record<(typeof THEME_COLOR_ROLES)[number], string>;
    const computed = getComputedStyle(root);
    for (const role of THEME_COLOR_ROLES) {
      const value = computed.getPropertyValue(`--${role}`).trim();
      if (!value) return null;
      colors[role] = value;
    }
    return colors;
  } finally {
    if (previousPalette === null) {
      root.removeAttribute(THEME_PALETTE_ATTRIBUTE);
    } else {
      root.setAttribute(THEME_PALETTE_ATTRIBUTE, previousPalette);
    }
    root.classList.toggle("dark", wasDark);
    for (const { role, priority, value } of previousInlineColors) {
      if (value) {
        root.style.setProperty(`--${role}`, value, priority);
      } else {
        root.style.removeProperty(`--${role}`);
      }
    }
  }
}

function ThemeCard({
  name,
  selected,
  lightColor,
  darkColor,
  onApply,
  onCustomize,
  onDelete,
  deletePending = false,
  onCancelDelete,
  onConfirmDelete,
}: {
  name: ReactNode;
  selected: boolean;
  lightColor: string;
  darkColor: string;
  onApply: () => void;
  onCustomize?: () => void;
  onDelete?: () => void;
  deletePending?: boolean;
  onCancelDelete?: () => void;
  onConfirmDelete?: () => void;
}) {
  const { i18n } = useLingui();
  const editLabel = i18n._(msg({ id: "theme.edit", message: "Edit" }));
  const deleteLabel = i18n._(msg({ id: "theme.delete", message: "Delete" }));

  return (
    <div
      className={cn(
        "grid gap-2 rounded-lg border p-3 transition-colors",
        selected && "border-ring bg-accent/40 ring-1 ring-ring",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onApply}
        className="grid gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ThemeCardPreview lightColor={lightColor} darkColor={darkColor} />
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="truncate">{name}</span>
          {selected ? (
            <Check
              className="ml-auto size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
          ) : null}
        </span>
      </button>

      {deletePending ? (
        <div className="grid gap-2 rounded-md bg-muted/60 p-2 text-xs">
          <span>
            <Trans id="theme.deletePrompt">Remove this custom theme?</Trans>
          </span>
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onCancelDelete}
            >
              <Trans id="theme.cancelDelete">Cancel</Trans>
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={onConfirmDelete}
            >
              <Trans id="theme.delete">Delete</Trans>
            </Button>
          </div>
        </div>
      ) : onCustomize || onDelete ? (
        <div className="flex justify-end gap-1">
          {onCustomize ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onCustomize}
              aria-label={editLabel}
              title={editLabel}
            >
              <Pencil className="size-3" aria-hidden="true" />
              <span className="sr-only">{editLabel}</span>
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onDelete}
              aria-label={deleteLabel}
              title={deleteLabel}
            >
              <Trash2 className="size-3" aria-hidden="true" />
              <span className="sr-only">{deleteLabel}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ThemeCardPreview({
  lightColor,
  darkColor,
}: {
  lightColor: string;
  darkColor: string;
}) {
  return (
    <span className="flex items-center" aria-hidden="true">
      <span
        className="size-9 rounded-full"
        style={{ background: lightColor }}
      />
      <span
        className="-ml-3 size-9 rounded-full ring-2 ring-background"
        style={{ background: darkColor }}
      />
    </span>
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
