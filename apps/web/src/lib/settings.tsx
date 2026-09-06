import {
  CURRENCIES,
  type Currency,
  FX_SOURCE_LABELS,
  type FxSource,
} from "@portifolio-tracker/shared";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

const DISPLAY_CURRENCY_KEY = "portfolio.displayCurrency";
const FX_SOURCE_KEY = "portfolio.fxSource";
const FX_MANUAL_RATE_KEY = "portfolio.fxManualRate";

const FX_SOURCES = Object.keys(FX_SOURCE_LABELS) as FxSource[];

function storedValue<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const stored = localStorage.getItem(key) as T | null;

    return stored && allowed.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function storedText(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function storeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or disabled storage: preferences simply do not persist.
  }
}

export type PortfolioSettings = {
  displayCurrency: Currency;
  setDisplayCurrency: (currency: Currency) => void;
  fxSource: FxSource;
  setFxSource: (source: FxSource) => void;
  manualRate: string;
  setManualRate: (rate: string) => void;
};

const SettingsContext = createContext<PortfolioSettings | null>(null);

/**
 * Portfolio-wide display preferences (display currency, FX source, manual
 * rate). Persisted in localStorage and shared by the header settings modal
 * and the positions page, so the controls live in one place.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [displayCurrency, setDisplayCurrencyState] = useState<Currency>(() =>
    storedValue(DISPLAY_CURRENCY_KEY, CURRENCIES, "BRL"),
  );
  const [fxSource, setFxSourceState] = useState<FxSource>(() =>
    storedValue(FX_SOURCE_KEY, FX_SOURCES, "frankfurter"),
  );
  const [manualRate, setManualRateState] = useState(() =>
    storedText(FX_MANUAL_RATE_KEY),
  );

  const setDisplayCurrency = useCallback((currency: Currency) => {
    setDisplayCurrencyState(currency);
    storeValue(DISPLAY_CURRENCY_KEY, currency);
  }, []);

  const setFxSource = useCallback((source: FxSource) => {
    setFxSourceState(source);
    storeValue(FX_SOURCE_KEY, source);
  }, []);

  const setManualRate = useCallback((rate: string) => {
    setManualRateState(rate);
    storeValue(FX_MANUAL_RATE_KEY, rate);
  }, []);

  const value = useMemo(
    () => ({
      displayCurrency,
      setDisplayCurrency,
      fxSource,
      setFxSource,
      manualRate,
      setManualRate,
    }),
    [
      displayCurrency,
      setDisplayCurrency,
      fxSource,
      setFxSource,
      manualRate,
      setManualRate,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): PortfolioSettings {
  const settings = useContext(SettingsContext);

  if (!settings) {
    throw new Error("useSettings must be used inside SettingsProvider");
  }

  return settings;
}
