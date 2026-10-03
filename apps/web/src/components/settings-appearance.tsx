import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Check, Monitor, Moon, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
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
  const { theme, resolvedTheme, setTheme } = useTheme();
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
  const previewMode: ThemeMode = resolvedTheme === "dark" ? "dark" : "light";
  const activeCustomColors = customThemes.find(
    (item) => item.id === paletteId,
  )?.colors;

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
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {COLOR_SCHEMES.map((scheme) => {
            const selected = activeScheme === scheme.value;

            return (
              <button
                key={scheme.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setTheme(scheme.value)}
                className={cn(OPTION_TILE, selected && OPTION_TILE_SELECTED)}
              >
                <SchemePreview
                  scheme={scheme.value}
                  paletteId={paletteId}
                  customColors={activeCustomColors}
                />
                <span className="flex min-w-0 items-center gap-1.5 px-2.5 py-2 text-sm font-medium sm:px-3 sm:py-2.5">
                  <scheme.icon
                    className="hidden size-3.5 shrink-0 text-muted-foreground min-[480px]:block"
                    aria-hidden="true"
                  />
                  {scheme.value === "light" ? (
                    <Trans id="theme.light">Light</Trans>
                  ) : scheme.value === "dark" ? (
                    <Trans id="theme.dark">Dark</Trans>
                  ) : (
                    <Trans id="theme.system">System</Trans>
                  )}
                  {selected ? <SelectedMark /> : null}
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

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
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
              preview={
                <PalettePreview paletteId={palette.id} scheme={previewMode} />
              }
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
              preview={
                <PalettePreview
                  paletteId={theme.id}
                  scheme={previewMode}
                  customColors={theme.colors}
                />
              }
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

const OPTION_TILE =
  "group grid overflow-hidden rounded-lg border bg-card text-left outline-none transition-[border-color,box-shadow] hover:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover";
const OPTION_TILE_SELECTED =
  "border-primary ring-1 ring-primary hover:border-primary";

function SelectedMark() {
  return (
    <span className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Check className="size-3" strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

function ThemeCard({
  name,
  selected,
  preview,
  onApply,
  onCustomize,
  onDelete,
  deletePending = false,
  onCancelDelete,
  onConfirmDelete,
}: {
  name: ReactNode;
  selected: boolean;
  preview: ReactNode;
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
  const actionCount = (onCustomize ? 1 : 0) + (onDelete ? 1 : 0);

  return (
    <div
      className={cn(
        "relative grid overflow-hidden rounded-lg border bg-card transition-[border-color,box-shadow] hover:border-ring/70",
        selected && OPTION_TILE_SELECTED,
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onApply}
        className="grid text-left outline-none focus-visible:bg-accent/40"
      >
        {preview}
        <span
          className={cn(
            "flex min-w-0 items-center gap-2 px-3 py-2.5 text-sm font-medium",
            actionCount === 1 && "pr-11",
            actionCount === 2 && "pr-[4.75rem]",
          )}
        >
          <span className="truncate">{name}</span>
          {selected ? <SelectedMark /> : null}
        </span>
      </button>

      {deletePending ? (
        <div className="grid gap-2 border-t bg-muted/50 p-2.5 text-xs">
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
      ) : actionCount > 0 ? (
        <div className="absolute right-1.5 bottom-1.5 flex gap-0.5">
          {onCustomize ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              onClick={onCustomize}
              aria-label={editLabel}
              title={editLabel}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label={deleteLabel}
              title={deleteLabel}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function customColorStyle(colors: ThemeColors): CSSProperties {
  return Object.fromEntries(
    THEME_COLOR_ROLES.map((role) => [`--${role}`, colors[role]]),
  ) as CSSProperties;
}

/**
 * A miniature dashboard drawn with a palette's real tokens. Built-in palettes
 * resolve through the scoped `data-theme-palette` rules in the stylesheets;
 * custom themes pass their stored colors inline.
 */
function PalettePreview({
  paletteId,
  scheme,
  customColors,
  className,
}: {
  paletteId: string;
  scheme: ThemeMode;
  customColors?: Readonly<Record<ThemeMode, ThemeColors>>;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-theme-palette={paletteId}
      data-scheme={scheme}
      style={customColors ? customColorStyle(customColors[scheme]) : undefined}
      className={cn(
        "flex aspect-[16/9] flex-col border-b bg-background",
        className,
      )}
    >
      <span className="flex h-[22%] items-center gap-1 border-b bg-card px-2">
        <span className="size-1.5 rounded-full bg-primary" />
        <span className="h-1 w-6 rounded-full bg-muted-foreground/40" />
        <span className="ml-auto h-1.5 w-4 rounded-full bg-accent" />
      </span>
      <span className="flex min-h-0 flex-1 gap-1.5 p-2">
        <span className="flex w-1/4 flex-col gap-1 rounded-sm border bg-card p-1">
          <span className="h-1 rounded-full bg-accent" />
          <span className="h-1 w-3/4 rounded-full bg-muted" />
          <span className="h-1 w-2/3 rounded-full bg-muted" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm border bg-card p-1.5">
          <span className="h-1 w-1/2 rounded-full bg-foreground/80" />
          <svg
            aria-hidden="true"
            className="min-h-0 w-full flex-1"
            viewBox="0 0 40 12"
            preserveAspectRatio="none"
          >
            <polyline
              points="0,10 7,8 13,9 20,5 27,6 33,3 40,2"
              fill="none"
              stroke="var(--chart-primary)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-5 rounded-sm bg-primary" />
            <span className="h-1.5 w-3 rounded-sm border bg-secondary" />
          </span>
        </span>
      </span>
    </span>
  );
}

function SchemePreview({
  scheme,
  paletteId,
  customColors,
}: {
  scheme: "system" | "light" | "dark";
  paletteId: string;
  customColors?: Readonly<Record<ThemeMode, ThemeColors>>;
}) {
  if (scheme !== "system") {
    return (
      <PalettePreview
        paletteId={paletteId}
        scheme={scheme}
        customColors={customColors}
      />
    );
  }

  return (
    <span aria-hidden="true" className="relative block">
      <PalettePreview
        paletteId={paletteId}
        scheme="light"
        customColors={customColors}
      />
      <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
        <PalettePreview
          paletteId={paletteId}
          scheme="dark"
          customColors={customColors}
        />
      </span>
    </span>
  );
}
