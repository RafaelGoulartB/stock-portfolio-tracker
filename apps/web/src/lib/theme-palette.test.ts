import { readFileSync } from "node:fs";
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
  THEME_COLOR_ROLES,
  THEME_PALETTES,
} from "./theme-palette";

function readStyles(file: string): string {
  return readFileSync(new URL(`../styles/${file}`, import.meta.url), "utf8");
}

/** Custom properties declared by the rule whose selector is `selector`. */
function readTokenBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Missing rule ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)]
      .filter(([, name]) => name !== "radius")
      .map(([, name, value]) => [name, value.trim()]),
  );
}

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

  it("mirrors the default tokens of globals.css in the editor seed", () => {
    const css = readStyles("globals.css");

    expect(
      readTokenBlock(css, ':root,\n[data-theme-palette="default"]'),
    ).toEqual(expect.objectContaining(getDefaultThemeColors("light")));
    expect(
      readTokenBlock(
        css,
        '.dark,\n[data-theme-palette="default"][data-scheme="dark"]',
      ),
    ).toEqual(expect.objectContaining(getDefaultThemeColors("dark")));
  });

  it("defines every editable role and the chart accent in both modes", () => {
    const css = readStyles("theme-palettes.css");
    const roles = [...THEME_COLOR_ROLES, "chart-primary"].sort();

    for (const { id } of THEME_PALETTES.slice(1)) {
      const light = readTokenBlock(
        css,
        `:root[data-theme-palette="${id}"],\n[data-theme-palette="${id}"]`,
      );
      const dark = readTokenBlock(
        css,
        `:root.dark[data-theme-palette="${id}"],\n[data-theme-palette="${id}"][data-scheme="dark"]`,
      );

      expect(Object.keys(light).sort()).toEqual(roles);
      expect(Object.keys(dark).sort()).toEqual(roles);
    }
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
