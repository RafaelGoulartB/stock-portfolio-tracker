/** Named palettes applied on top of the light/dark/system color scheme. */

export const THEME_PALETTE_STORAGE_KEY = "portfolio-theme-palette";
export const CUSTOM_THEME_STORAGE_KEY = "portfolio-custom-themes";
export const THEME_PALETTE_ATTRIBUTE = "data-theme-palette";
export const LEGACY_THEME_LAB_STORAGE_KEY = "portfolio-theme-lab";

export type ThemeMode = "light" | "dark";

/** Semantic tokens supported by the lightweight custom-theme editor. */
export const THEME_COLOR_ROLES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
] as const;

export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number];
export type ThemeColors = Readonly<Record<ThemeColorRole, string>>;
export type CustomTheme = Readonly<{
  id: string;
  name: string;
  colors: Readonly<Record<ThemeMode, ThemeColors>>;
}>;

export type ThemePaletteId =
  | "default"
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

/** Colors shown in the editor when a new theme starts from the app default. */
const DEFAULT_THEME_COLORS: Readonly<Record<ThemeMode, ThemeColors>> = {
  light: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0.145 0 0)",
    popover: "oklch(1 0 0)",
    "popover-foreground": "oklch(0.145 0 0)",
    primary: "oklch(0.205 0 0)",
    "primary-foreground": "oklch(0.985 0 0)",
    secondary: "oklch(0.97 0 0)",
    "secondary-foreground": "oklch(0.205 0 0)",
    muted: "oklch(0.97 0 0)",
    "muted-foreground": "oklch(0.556 0 0)",
    accent: "oklch(0.97 0 0)",
    "accent-foreground": "oklch(0.205 0 0)",
    destructive: "oklch(0.577 0.245 27.325)",
    border: "oklch(0.922 0 0)",
    input: "oklch(0.922 0 0)",
    ring: "oklch(0.708 0 0)",
  },
  dark: {
    background: "oklch(0.145 0 0)",
    foreground: "oklch(0.985 0 0)",
    card: "oklch(0.205 0 0)",
    "card-foreground": "oklch(0.985 0 0)",
    popover: "oklch(0.205 0 0)",
    "popover-foreground": "oklch(0.985 0 0)",
    primary: "oklch(0.922 0 0)",
    "primary-foreground": "oklch(0.205 0 0)",
    secondary: "oklch(0.269 0 0)",
    "secondary-foreground": "oklch(0.985 0 0)",
    muted: "oklch(0.269 0 0)",
    "muted-foreground": "oklch(0.708 0 0)",
    accent: "oklch(0.269 0 0)",
    "accent-foreground": "oklch(0.985 0 0)",
    destructive: "oklch(0.704 0.191 22.216)",
    border: "oklch(1 0 0 / 10%)",
    input: "oklch(1 0 0 / 15%)",
    ring: "oklch(0.556 0 0)",
  },
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
    id: "bloom",
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

const THEME_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,47})$/;
const COLOR_VALUE_PATTERN =
  /^(?:#|oklch\(|rgb\(|rgba\(|hsl\(|hsla\(|hwb\(|lab\(|lch\(|color\()/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneThemeColors(colors: ThemeColors): Record<ThemeColorRole, string> {
  return Object.fromEntries(
    THEME_COLOR_ROLES.map((role) => [role, colors[role]]),
  ) as Record<ThemeColorRole, string>;
}

function isThemeColorValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[;{}]/.test(value) &&
    COLOR_VALUE_PATTERN.test(value.trim())
  );
}

function parseThemeColors(value: unknown): ThemeColors | null {
  if (!isRecord(value)) return null;

  const colors = {} as Record<ThemeColorRole, string>;
  for (const role of THEME_COLOR_ROLES) {
    const color = value[role];
    if (!isThemeColorValue(color)) return null;
    colors[role] = color.trim();
  }

  return colors;
}

function parseCustomTheme(value: unknown): CustomTheme | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    !THEME_ID_PATTERN.test(value.id) ||
    THEME_PALETTE_IDS.has(value.id)
  ) {
    return null;
  }
  if (
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.trim().length > 48
  ) {
    return null;
  }

  const rawColors = isRecord(value.colors) ? value.colors : null;
  const light = parseThemeColors(rawColors?.light);
  const dark = parseThemeColors(rawColors?.dark);
  if (!light || !dark) return null;

  return {
    id: value.id,
    name: value.name.trim(),
    colors: { light, dark },
  };
}

export function readCustomThemes(): ReadonlyArray<CustomTheme> {
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const themes: CustomTheme[] = [];
    for (const value of parsed) {
      const theme = parseCustomTheme(value);
      if (theme && !themes.some((existing) => existing.id === theme.id)) {
        themes.push(theme);
      }
    }
    return themes;
  } catch {
    return [];
  }
}

export function storeCustomThemes(themes: ReadonlyArray<CustomTheme>): void {
  try {
    localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(themes));
  } catch {
    // Private mode or disabled storage: the provider still keeps the change in memory.
  }
}

export function getDefaultThemeColors(mode: ThemeMode): ThemeColors {
  return cloneThemeColors(DEFAULT_THEME_COLORS[mode]);
}

export function createCustomThemeId(
  name: string,
  existingIds: ReadonlyArray<string> = [],
): string {
  const baseName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const baseId = `custom-${baseName || "theme"}`;
  const usedIds = new Set([...THEME_PALETTE_IDS, ...existingIds]);

  if (!usedIds.has(baseId)) return baseId;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${baseId.slice(0, 47 - String(suffix).length)}-${suffix}`;
    if (!usedIds.has(candidate)) return candidate;
  }

  return `custom-theme-${Date.now().toString(36)}`;
}

export function applyCustomThemeColors(colors: ThemeColors): void {
  if (typeof document === "undefined") return;

  for (const role of THEME_COLOR_ROLES) {
    document.documentElement.style.setProperty(`--${role}`, colors[role]);
  }
}

export function clearCustomThemeColors(): void {
  if (typeof document === "undefined") return;

  for (const role of THEME_COLOR_ROLES) {
    document.documentElement.style.removeProperty(`--${role}`);
  }
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function linearToSrgb(value: number): number {
  const channel = Math.max(0, Math.min(1, value));
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const angle = (hue * Math.PI) / 180;
  const a = Math.cos(angle) * chroma;
  const b = Math.sin(angle) * chroma;
  const lightnessPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const greenPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const bluePrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const lightnessCube = lightnessPrime ** 3;
  const greenCube = greenPrime ** 3;
  const blueCube = bluePrime ** 3;
  const red =
    4.0767416621 * lightnessCube -
    3.3077115913 * greenCube +
    0.2309699292 * blueCube;
  const green =
    -1.2684380046 * lightnessCube +
    2.6097574011 * greenCube -
    0.3413193965 * blueCube;
  const blue =
    -0.0041960863 * lightnessCube -
    0.7034186147 * greenCube +
    1.707614701 * blueCube;

  return `#${[red, green, blue]
    .map((channel) =>
      clampChannel(linearToSrgb(channel)).toString(16).padStart(2, "0"),
    )
    .join("")}`;
}

/** Converts stored CSS colors to the native color input format. */
export function cssColorToHex(value: string, fallback = "#000000"): string {
  const color = value.trim();
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      return `#${hex
        .slice(0, 3)
        .split("")
        .map((channel) => `${channel}${channel}`)
        .join("")}`.toLowerCase();
    }
    if (hex.length === 6 || hex.length === 8)
      return `#${hex.slice(0, 6).toLowerCase()}`;
  }

  const oklch = color.match(
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.+-]+)(?:deg)?(?:\s*\/[^)]*)?\s*\)$/i,
  );
  if (oklch) {
    const lightness = Number(oklch[1]) / (oklch[2] ? 100 : 1);
    const chroma = Number(oklch[3]) / (oklch[4] ? 100 : 1);
    const hue = Number(oklch[5]);
    if ([lightness, chroma, hue].every(Number.isFinite)) {
      return oklchToHex(lightness, chroma, hue);
    }
  }

  const rgb = color.match(/^rgba?\(([^)]+)\)$/i)?.[1];
  if (rgb) {
    const channels = rgb
      .replace(/\//g, " ")
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((channel) =>
        channel.endsWith("%")
          ? (Number(channel.slice(0, -1)) * 255) / 100
          : Number(channel),
      );
    if (channels.length === 3 && channels.every(Number.isFinite)) {
      return `#${channels
        .map((channel) =>
          Math.max(0, Math.min(255, Math.round(channel)))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
    }
  }

  return fallback;
}

const LEGACY_PALETTE_IDS: Record<string, ThemePaletteId> = {
  "t3-code": "default",
  slate: "default",
  "t3-chat": "bloom",
};

export function isThemePaletteId(
  value: string | null,
): value is ThemePaletteId {
  return value !== null && THEME_PALETTE_IDS.has(value);
}

export function readStoredThemePaletteId(): string {
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

    if (stored && readCustomThemes().some((theme) => theme.id === stored)) {
      return stored;
    }

    return DEFAULT_THEME_PALETTE_ID;
  } catch {
    return DEFAULT_THEME_PALETTE_ID;
  }
}

export function storeThemePaletteId(id: string): void {
  try {
    localStorage.setItem(THEME_PALETTE_STORAGE_KEY, id);
  } catch {
    // Private mode or disabled storage: the palette still applies in memory.
  }
}

export function applyThemePaletteAttribute(id: string): void {
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
