/** Named palettes applied on top of the light/dark/system color scheme. */

export const THEME_PALETTE_STORAGE_KEY = "portfolio-theme-palette";
export const THEME_PALETTE_ATTRIBUTE = "data-theme-palette";
export const LEGACY_THEME_LAB_STORAGE_KEY = "portfolio-theme-lab";

export type ThemePaletteId =
  | "default"
  | "slate"
  | "bloom"
  | "grove"
  | "ocean"
  | "ember"
  | "iris";

export type ThemePalette = {
  id: ThemePaletteId;
  name: string;
  /** Overlapping swatches shown on the Appearance picker. */
  swatch: {
    light: string;
    dark: string;
  };
};

export const DEFAULT_THEME_PALETTE_ID: ThemePaletteId = "default";

export const THEME_PALETTES = [
  {
    id: "default",
    name: "Default",
    swatch: {
      light: "oklch(1 0 0)",
      dark: "oklch(0.145 0 0)",
    },
  },
  {
    id: "slate",
    name: "Slate",
    swatch: {
      light: "oklch(0.97 0.01 250)",
      dark: "oklch(0.35 0.1 255)",
    },
  },
  {
    id: "bloom",
    name: "Bloom",
    swatch: {
      light: "oklch(0.82 0.12 340)",
      dark: "oklch(0.5 0.2 340)",
    },
  },
  {
    id: "grove",
    name: "Grove",
    swatch: {
      light: "oklch(0.86 0.1 155)",
      dark: "oklch(0.42 0.12 155)",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    swatch: {
      light: "oklch(0.84 0.08 230)",
      dark: "oklch(0.38 0.12 250)",
    },
  },
  {
    id: "ember",
    name: "Ember",
    swatch: {
      light: "oklch(0.86 0.1 55)",
      dark: "oklch(0.42 0.12 45)",
    },
  },
  {
    id: "iris",
    name: "Iris",
    swatch: {
      light: "oklch(0.84 0.1 300)",
      dark: "oklch(0.42 0.14 300)",
    },
  },
] as const satisfies readonly ThemePalette[];

const THEME_PALETTE_IDS = new Set<string>(
  THEME_PALETTES.map((palette) => palette.id),
);

const LEGACY_PALETTE_IDS: Record<string, ThemePaletteId> = {
  "t3-code": "slate",
  "t3-chat": "bloom",
};

export function isThemePaletteId(
  value: string | null,
): value is ThemePaletteId {
  return value !== null && THEME_PALETTE_IDS.has(value);
}

export function readStoredThemePaletteId(): ThemePaletteId {
  try {
    const stored = localStorage.getItem(THEME_PALETTE_STORAGE_KEY);

    if (isThemePaletteId(stored)) {
      return stored;
    }

    if (stored && stored in LEGACY_PALETTE_IDS) {
      const migrated = LEGACY_PALETTE_IDS[stored] ?? DEFAULT_THEME_PALETTE_ID;
      storeThemePaletteId(migrated);

      return migrated;
    }

    return DEFAULT_THEME_PALETTE_ID;
  } catch {
    return DEFAULT_THEME_PALETTE_ID;
  }
}

export function storeThemePaletteId(id: ThemePaletteId): void {
  try {
    localStorage.setItem(THEME_PALETTE_STORAGE_KEY, id);
  } catch {
    // Private mode or disabled storage: the palette still applies in memory.
  }
}

export function applyThemePaletteAttribute(id: ThemePaletteId): void {
  document.documentElement.setAttribute(THEME_PALETTE_ATTRIBUTE, id);
}

export function clearLegacyThemeLab(): void {
  try {
    localStorage.removeItem(LEGACY_THEME_LAB_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the attribute cleanup below still runs.
  }

  document.documentElement.removeAttribute("data-theme-lab");
}
