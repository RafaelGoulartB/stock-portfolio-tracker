import { Trans } from "@lingui/react/macro";
import { Moon, Palette, Sun } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type CustomTheme,
  cssColorToHex,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/theme-palette";
import { cn } from "@/lib/utils";

export type ThemeEditorDraft = {
  id: string | null;
  name: string;
  colors: Record<ThemeMode, ThemeColors>;
};

const EDITABLE_FIELDS: ReadonlyArray<{
  role: ThemeColorRole;
}> = [
  { role: "background" },
  { role: "foreground" },
  { role: "card" },
  { role: "primary" },
  { role: "accent" },
  { role: "muted" },
  { role: "border" },
  { role: "input" },
];

function EditorFieldLabel({ role }: { role: ThemeColorRole }) {
  switch (role) {
    case "background":
      return <Trans id="theme.editor.background">Background</Trans>;
    case "foreground":
      return <Trans id="theme.editor.text">Text</Trans>;
    case "card":
      return <Trans id="theme.editor.surface">Surface</Trans>;
    case "primary":
      return <Trans id="theme.editor.primary">Primary</Trans>;
    case "accent":
      return <Trans id="theme.editor.accent">Accent</Trans>;
    case "muted":
      return <Trans id="theme.editor.muted">Muted</Trans>;
    case "border":
      return <Trans id="theme.editor.border">Border</Trans>;
    case "input":
      return <Trans id="theme.editor.input">Input</Trans>;
  }
}

const FALLBACK_COLORS: Record<ThemeMode, Record<ThemeColorRole, string>> = {
  light: {
    background: "#ffffff",
    foreground: "#18181b",
    card: "#ffffff",
    "card-foreground": "#18181b",
    popover: "#ffffff",
    "popover-foreground": "#18181b",
    primary: "#18181b",
    "primary-foreground": "#fafafa",
    secondary: "#f4f4f5",
    "secondary-foreground": "#18181b",
    muted: "#f4f4f5",
    "muted-foreground": "#71717a",
    accent: "#f4f4f5",
    "accent-foreground": "#18181b",
    destructive: "#dc2626",
    border: "#e4e4e7",
    input: "#e4e4e7",
    ring: "#a1a1aa",
  },
  dark: {
    background: "#18181b",
    foreground: "#fafafa",
    card: "#27272a",
    "card-foreground": "#fafafa",
    popover: "#27272a",
    "popover-foreground": "#fafafa",
    primary: "#e4e4e7",
    "primary-foreground": "#27272a",
    secondary: "#3f3f46",
    "secondary-foreground": "#fafafa",
    muted: "#3f3f46",
    "muted-foreground": "#a1a1aa",
    accent: "#3f3f46",
    "accent-foreground": "#fafafa",
    destructive: "#ef4444",
    border: "#3f3f46",
    input: "#52525b",
    ring: "#71717a",
  },
};

function cloneColors(colors: ThemeColors): ThemeColors {
  return { ...colors };
}

function cloneDraft(
  theme: CustomTheme | null,
  fallbackName: string,
  seedColors?: Record<ThemeMode, ThemeColors>,
): ThemeEditorDraft {
  return {
    id: theme?.id ?? null,
    name: theme?.name ?? fallbackName,
    colors: {
      light: cloneColors(
        theme?.colors.light ?? seedColors?.light ?? FALLBACK_COLORS.light,
      ),
      dark: cloneColors(
        theme?.colors.dark ?? seedColors?.dark ?? FALLBACK_COLORS.dark,
      ),
    },
  };
}

export function ThemeEditor({
  initialTheme,
  seedColors,
  fallbackName,
  onCancel,
  onPreview,
  onSave,
}: {
  initialTheme: CustomTheme | null;
  seedColors?: Record<ThemeMode, ThemeColors>;
  fallbackName: string;
  onCancel: () => void;
  onPreview: (theme: CustomTheme) => void;
  onSave: (draft: ThemeEditorDraft) => void;
}) {
  const [draft, setDraft] = useState(() =>
    cloneDraft(initialTheme, fallbackName, seedColors),
  );
  const [activeMode, setActiveMode] = useState<ThemeMode>("light");
  const [nameError, setNameError] = useState(false);

  useEffect(() => {
    setDraft(cloneDraft(initialTheme, fallbackName, seedColors));
    setActiveMode("light");
    setNameError(false);
  }, [fallbackName, initialTheme, seedColors]);

  const previewTheme = useMemo<CustomTheme>(
    () => ({
      id: draft.id ?? "custom-preview",
      name: draft.name.trim() || fallbackName,
      colors: draft.colors,
    }),
    [draft, fallbackName],
  );

  useEffect(() => {
    onPreview(previewTheme);
  }, [onPreview, previewTheme]);

  const updateColor = (role: ThemeColorRole, value: string) => {
    setDraft((current) => ({
      ...current,
      colors: {
        ...current.colors,
        [activeMode]: {
          ...current.colors[activeMode],
          [role]: value,
        },
      },
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    onSave({ ...draft, name });
  };

  return (
    <form
      className="grid gap-4 rounded-xl border bg-card/60 p-4 shadow-sm"
      onSubmit={handleSubmit}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted">
          <Palette className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">
            {draft.id ? (
              <Trans id="theme.editor.editTitle">Edit theme</Trans>
            ) : (
              <Trans id="theme.editor.createTitle">Create theme</Trans>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            <Trans id="theme.editor.description">
              Choose a few colors for light and dark mode. The rest of the
              dashboard stays consistent.
            </Trans>
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="theme-editor-name">
          <Trans id="theme.editor.name">Theme name</Trans>
        </Label>
        <Input
          id="theme-editor-name"
          aria-invalid={nameError}
          autoFocus
          maxLength={48}
          onChange={(event) => {
            setDraft((current) => ({ ...current, name: event.target.value }));
            setNameError(false);
          }}
          value={draft.name}
        />
        {nameError ? (
          <p className="text-xs text-destructive" role="alert">
            <Trans id="theme.editor.nameRequired">
              Enter a name for this theme.
            </Trans>
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 sm:flex-col">
          {(["light", "dark"] as const).map((mode) => {
            const selected = activeMode === mode;
            const Icon = mode === "light" ? Sun : Moon;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={selected}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "bg-background text-foreground shadow-sm",
                )}
                onClick={() => setActiveMode(mode)}
              >
                <Icon className="size-4" aria-hidden="true" />
                {mode === "light" ? (
                  <Trans id="theme.light">Light</Trans>
                ) : (
                  <Trans id="theme.dark">Dark</Trans>
                )}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {EDITABLE_FIELDS.map((field) => {
            const id = `theme-editor-${activeMode}-${field.role}`;
            const value = draft.colors[activeMode][field.role];
            return (
              <div
                className="grid gap-2 rounded-lg border bg-background/50 p-2.5"
                key={field.role}
              >
                <Label className="text-xs" htmlFor={id}>
                  <EditorFieldLabel role={field.role} />
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    id={id}
                    type="color"
                    value={cssColorToHex(
                      value,
                      FALLBACK_COLORS[activeMode][field.role],
                    )}
                    onChange={(event) =>
                      updateColor(field.role, event.target.value)
                    }
                    className="size-9 cursor-pointer rounded-md border border-input bg-transparent p-1"
                  />
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {cssColorToHex(
                      value,
                      FALLBACK_COLORS[activeMode][field.role],
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          <Trans id="theme.editor.cancel">Cancel</Trans>
        </Button>
        <Button type="submit">
          <Trans id="theme.editor.save">Save theme</Trans>
        </Button>
      </div>
    </form>
  );
}
