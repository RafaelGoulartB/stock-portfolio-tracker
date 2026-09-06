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
  applyThemePaletteAttribute,
  clearLegacyThemeLab,
  readStoredThemePaletteId,
  storeThemePaletteId,
  type ThemePaletteId,
} from "@/lib/theme-palette";

type ThemePaletteContextValue = {
  paletteId: ThemePaletteId;
  setPaletteId: (id: ThemePaletteId) => void;
};

const ThemePaletteContext = createContext<ThemePaletteContextValue | null>(
  null,
);

/** Applies the selected named palette on `<html>` and persists the choice. */
export function ThemePaletteProvider({ children }: { children: ReactNode }) {
  const [paletteId, setPaletteIdState] = useState<ThemePaletteId>(
    readStoredThemePaletteId,
  );

  useLayoutEffect(() => {
    clearLegacyThemeLab();
    applyThemePaletteAttribute(paletteId);
  }, [paletteId]);

  const setPaletteId = useCallback((id: ThemePaletteId) => {
    setPaletteIdState(id);
    storeThemePaletteId(id);
  }, []);

  const value = useMemo(
    () => ({ paletteId, setPaletteId }),
    [paletteId, setPaletteId],
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
