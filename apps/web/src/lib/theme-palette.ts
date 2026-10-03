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
};

/** Mirrors the default tokens in globals.css; seeds the custom-theme editor. */
const DEFAULT_THEME_COLORS: Readonly<Record<ThemeMode, ThemeColors>> = {
  light: {
    background: "oklch(0.982 0.002 264)",
    foreground: "oklch(0.2 0.007 264)",
    card: "oklch(0.998 0 264)",
    "card-foreground": "oklch(0.2 0.007 264)",
    popover: "oklch(0.998 0 264)",
    "popover-foreground": "oklch(0.2 0.007 264)",
    primary: "oklch(0.22 0.008 264)",
    "primary-foreground": "oklch(0.985 0.002 264)",
    secondary: "oklch(0.952 0.004 264)",
    "secondary-foreground": "oklch(0.24 0.008 264)",
    muted: "oklch(0.958 0.003 264)",
    "muted-foreground": "oklch(0.5 0.008 264)",
    accent: "oklch(0.942 0.007 264)",
    "accent-foreground": "oklch(0.26 0.015 264)",
    destructive: "oklch(0.577 0.215 27)",
    border: "oklch(0.912 0.003 264)",
    input: "oklch(0.882 0.004 264)",
    ring: "oklch(0.6 0.012 264)",
  },
  dark: {
    background: "oklch(0.165 0.004 264)",
    foreground: "oklch(0.965 0.002 264)",
    card: "oklch(0.198 0.005 264)",
    "card-foreground": "oklch(0.965 0.002 264)",
    popover: "oklch(0.222 0.005 264)",
    "popover-foreground": "oklch(0.965 0.002 264)",
    primary: "oklch(0.93 0.004 264)",
    "primary-foreground": "oklch(0.2 0.006 264)",
    secondary: "oklch(0.27 0.006 264)",
    "secondary-foreground": "oklch(0.965 0.002 264)",
    muted: "oklch(0.255 0.005 264)",
    "muted-foreground": "oklch(0.72 0.006 264)",
    accent: "oklch(0.285 0.011 264)",
    "accent-foreground": "oklch(0.965 0.002 264)",
    destructive: "oklch(0.68 0.19 24)",
    border: "oklch(0.29 0.006 264)",
    input: "oklch(0.33 0.007 264)",
    ring: "oklch(0.62 0.012 264)",
  },
};

export const DEFAULT_THEME_PALETTE_ID: ThemePaletteId = "default";

export const THEME_PALETTES = [
  {
    id: "default",
    name: "Default",
  },
  {
    id: "bloom",
    name: "Bloom",
  },
  {
    id: "grove",
    name: "Grove",
  },
  {
    id: "ocean",
    name: "Ocean",
  },
  {
    id: "ember",
    name: "Ember",
  },
  {
    id: "iris",
    name: "Iris",
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
