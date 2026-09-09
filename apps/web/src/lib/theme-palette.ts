/** Named palettes applied on top of the light/dark/system color scheme. */

export const THEME_PALETTE_STORAGE_KEY = "portfolio-theme-palette";
export const THEME_PALETTE_ATTRIBUTE = "data-theme-palette";
export const LEGACY_THEME_LAB_STORAGE_KEY = "portfolio-theme-lab";

export type ThemePaletteId =
  | "default"
  | "t3-chat"
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
    id: "t3-chat",
    name: "Bloom",
    swatch: {
      light: "oklch(0.591646 0.217985 0.584)",
      dark: "oklch(0.460685 0.185347 4.099)",
    },
  },
  {
    id: "grove",
    name: "Grove",
    swatch: {
      light: "oklch(0.535028 0.106403 77.549)",
      dark: "oklch(0.791603 0.129713 83.299)",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    swatch: {
      light: "oklch(0.493961 0.08175 201.584)",
      dark: "oklch(0.793363 0.105022 199.893)",
    },
  },
  {
    id: "ember",
    name: "Ember",
    swatch: {
      light: "oklch(0.516323 0.161628 24.82)",
      dark: "oklch(0.747955 0.135578 29.432)",
    },
  },
  {
    id: "iris",
    name: "Iris",
    swatch: {
      light: "oklch(0.516084 0.185229 340.776)",
      dark: "oklch(0.789904 0.130063 337.621)",
    },
  },
] as const satisfies readonly ThemePalette[];

const THEME_PALETTE_IDS = new Set<string>(
  THEME_PALETTES.map((palette) => palette.id),
);

const LEGACY_PALETTE_IDS: Record<string, ThemePaletteId> = {
  "t3-code": "default",
  slate: "default",
  bloom: "t3-chat",
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
