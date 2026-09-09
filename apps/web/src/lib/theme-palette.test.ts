import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_THEME_STORAGE_KEY,
  createCustomThemeId,
  cssColorToHex,
  getDefaultThemeColors,
  isThemePaletteId,
  readCustomThemes,
  readStoredThemePaletteId,
  storeCustomThemes,
  THEME_PALETTES,
} from "./theme-palette";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("built-in theme palettes", () => {
  it("keeps the product default and built-in themes in the library order", () => {
    expect(THEME_PALETTES.map((palette) => palette.id)).toEqual([
      "default",
      "bloom",
      "grove",
      "ocean",
      "ember",
      "iris",
    ]);
  });

  it("uses the built-in action colors for the palette swatches", () => {
    expect(THEME_PALETTES.slice(1).map((palette) => palette.swatch)).toEqual([
      {
        light: "oklch(0.591646 0.217985 0.584)",
        dark: "oklch(0.460685 0.185347 4.099)",
      },
      {
        light: "oklch(0.535028 0.106403 77.549)",
        dark: "oklch(0.791603 0.129713 83.299)",
      },
      {
        light: "oklch(0.493961 0.08175 201.584)",
        dark: "oklch(0.793363 0.105022 199.893)",
      },
      {
        light: "oklch(0.516323 0.161628 24.82)",
        dark: "oklch(0.747955 0.135578 29.432)",
      },
      {
        light: "oklch(0.516084 0.185229 340.776)",
        dark: "oklch(0.789904 0.130063 337.621)",
      },
    ]);
  });
});

describe("stored theme palette preferences", () => {
  it("accepts only the current palette ids", () => {
    expect(isThemePaletteId("bloom")).toBe(true);
    expect(isThemePaletteId("iris")).toBe(true);
    expect(isThemePaletteId("slate")).toBe(false);
    expect(isThemePaletteId("t3-chat")).toBe(false);
  });

  it("migrates palette ids from the previous implementation", () => {
    const values = new Map<string, string>([
      ["portfolio-theme-palette", "t3-chat"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    expect(readStoredThemePaletteId()).toBe("bloom");
    expect(values.get("portfolio-theme-palette")).toBe("bloom");
  });
});

describe("custom themes", () => {
  it("creates stable ids and avoids collisions with existing themes", () => {
    expect(createCustomThemeId("My Forest")).toBe("custom-my-forest");
    expect(createCustomThemeId("My Forest", ["custom-my-forest"])).toBe(
      "custom-my-forest-2",
    );
  });

  it("round-trips valid themes and restores a custom selection", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const theme = {
      id: "custom-forest",
      name: "Forest",
      colors: {
        light: getDefaultThemeColors("light"),
        dark: getDefaultThemeColors("dark"),
      },
    } as const;

    storeCustomThemes([theme]);
    values.set("portfolio-theme-palette", theme.id);

    expect(readCustomThemes()).toEqual([theme]);
    expect(readStoredThemePaletteId()).toBe(theme.id);
    expect(values.get(CUSTOM_THEME_STORAGE_KEY)).toContain("custom-forest");
  });

  it("converts editor colors to the native color input format", () => {
    expect(cssColorToHex("#abc")).toBe("#aabbcc");
    expect(cssColorToHex("rgb(10 20 30)")).toBe("#0a141e");
    expect(cssColorToHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(cssColorToHex("invalid", "#123456")).toBe("#123456");
  });
});
