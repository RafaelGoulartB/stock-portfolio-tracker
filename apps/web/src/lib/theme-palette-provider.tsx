import { useTheme } from "next-themes";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  applyCustomThemeColors,
  applyThemePaletteAttribute,
  type CustomTheme,
  clearCustomThemeColors,
  clearLegacyThemeLab,
  readCustomThemes,
  readStoredThemePaletteId,
  storeCustomThemes,
  storeThemePaletteId,
} from "@/lib/theme-palette";

type ThemePaletteContextValue = {
  paletteId: string;
  customThemes: ReadonlyArray<CustomTheme>;
  setPaletteId: (id: string) => void;
  saveCustomTheme: (theme: CustomTheme) => void;
  deleteCustomTheme: (id: string) => void;
  previewCustomTheme: (theme: CustomTheme) => void;
  clearThemePreview: () => void;
};

const ThemePaletteContext = createContext<ThemePaletteContextValue | null>(
  null,
);

/** Applies the selected named palette on `<html>` and persists the choice. */
export function ThemePaletteProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const [paletteId, setPaletteIdState] = useState<string>(
    readStoredThemePaletteId,
  );
  const [customThemes, setCustomThemes] =
    useState<ReadonlyArray<CustomTheme>>(readCustomThemes);
  const [themePreview, setThemePreview] = useState<CustomTheme | null>(null);

  useLayoutEffect(() => {
    clearLegacyThemeLab();
    clearCustomThemeColors();

    const activeCustomTheme =
      themePreview ??
      customThemes.find((theme) => theme.id === paletteId) ??
      null;
    if (activeCustomTheme) {
      applyThemePaletteAttribute(activeCustomTheme.id);
      applyCustomThemeColors(
        activeCustomTheme.colors[resolvedTheme === "dark" ? "dark" : "light"],
      );
      return;
    }

    applyThemePaletteAttribute(paletteId);
  }, [customThemes, paletteId, resolvedTheme, themePreview]);

  const setPaletteId = useCallback((id: string) => {
    setThemePreview(null);
    setPaletteIdState(id);
    storeThemePaletteId(id);
  }, []);

  const saveCustomTheme = useCallback((theme: CustomTheme) => {
    setCustomThemes((current) => {
      const next = current.some((existing) => existing.id === theme.id)
        ? current.map((existing) =>
            existing.id === theme.id ? theme : existing,
          )
        : [...current, theme];
      storeCustomThemes(next);
      return next;
    });
    setThemePreview(null);
    setPaletteIdState(theme.id);
    storeThemePaletteId(theme.id);
  }, []);

  const deleteCustomTheme = useCallback((id: string) => {
    setCustomThemes((current) => {
      const next = current.filter((theme) => theme.id !== id);
      storeCustomThemes(next);
      return next;
    });
    setThemePreview((current) => (current?.id === id ? null : current));
    setPaletteIdState((current) => {
      if (current !== id) return current;
      storeThemePaletteId("default");
      return "default";
    });
  }, []);

  const previewCustomTheme = useCallback((theme: CustomTheme) => {
    setThemePreview(theme);
  }, []);

  const clearThemePreview = useCallback(() => {
    setThemePreview(null);
  }, []);

  const value = useMemo(
    () => ({
      paletteId,
      customThemes,
      setPaletteId,
      saveCustomTheme,
      deleteCustomTheme,
      previewCustomTheme,
      clearThemePreview,
    }),
    [
      clearThemePreview,
      customThemes,
      deleteCustomTheme,
      paletteId,
      previewCustomTheme,
      saveCustomTheme,
      setPaletteId,
    ],
  );

  return (
    <ThemePaletteContext.Provider value={value}>
      {children}
    </ThemePaletteContext.Provider>
  );
}

export function useThemePalette(): ThemePaletteContextValue {
  const value = useContext(ThemePaletteContext);

  if (!value) {
    throw new Error("useThemePalette must be used within ThemePaletteProvider");
  }

  return value;
}
