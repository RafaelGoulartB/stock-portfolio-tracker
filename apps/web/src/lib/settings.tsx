import {
  CURRENCIES,
  type Currency,
  FX_SOURCE_LABELS,
  type FxSource,
  QUOTE_SOURCE_LABELS,
  type QuoteSource,
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
const QUOTE_SOURCE_KEY = "portfolio.quoteSource";
const QUOTE_MANUAL_PRICES_KEY = "portfolio.quoteManualPrices";
const SHOW_LOGOS_KEY = "portfolio.showLogos";

const FX_SOURCES = Object.keys(FX_SOURCE_LABELS) as FxSource[];
const QUOTE_SOURCES = Object.keys(QUOTE_SOURCE_LABELS) as QuoteSource[];

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

function storedBoolean(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

function storeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or disabled storage: preferences simply do not persist.
  }
}

function storedJsonRecord(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);

    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" && entry[1].length > 0,
        )
        .map(([ticker, price]) => [ticker.toUpperCase(), price]),
    );
  } catch {
    return {};
  }
}

export type PortfolioSettings = {
  displayCurrency: Currency;
  setDisplayCurrency: (currency: Currency) => void;
  fxSource: FxSource;
  setFxSource: (source: FxSource) => void;
  manualRate: string;
  setManualRate: (rate: string) => void;
  quoteSource: QuoteSource;
  setQuoteSource: (source: QuoteSource) => void;
  /** Per-ticker native-currency prices for the manual quote source. */
  manualPrices: Record<string, string>;
  setManualPrice: (ticker: string, price: string) => void;
  showLogos: boolean;
  setShowLogos: (show: boolean) => void;
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
  const [quoteSource, setQuoteSourceState] = useState<QuoteSource>(() =>
    storedValue(QUOTE_SOURCE_KEY, QUOTE_SOURCES, "yahoo"),
  );
  const [manualPrices, setManualPricesState] = useState<Record<string, string>>(
    () => storedJsonRecord(QUOTE_MANUAL_PRICES_KEY),
  );
  const [showLogos, setShowLogosState] = useState(() =>
    storedBoolean(SHOW_LOGOS_KEY, true),
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

  const setQuoteSource = useCallback((source: QuoteSource) => {
    setQuoteSourceState(source);
    storeValue(QUOTE_SOURCE_KEY, source);
  }, []);

  const setManualPrice = useCallback((ticker: string, price: string) => {
    setManualPricesState((current) => {
      const next = { ...current };
      const key = ticker.toUpperCase();

      if (price.trim().length === 0) {
        delete next[key];
      } else {
        next[key] = price;
      }

      try {
        localStorage.setItem(QUOTE_MANUAL_PRICES_KEY, JSON.stringify(next));
      } catch {
        // Private mode or disabled storage: preferences do not persist.
      }

      return next;
    });
  }, []);

  const setShowLogos = useCallback((show: boolean) => {
    setShowLogosState(show);
    storeValue(SHOW_LOGOS_KEY, String(show));
  }, []);

  const value = useMemo(
    () => ({
      displayCurrency,
      setDisplayCurrency,
      fxSource,
      setFxSource,
      manualRate,
      setManualRate,
      quoteSource,
      setQuoteSource,
      manualPrices,
      setManualPrice,
      showLogos,
      setShowLogos,
    }),
    [
      displayCurrency,
      setDisplayCurrency,
      fxSource,
      setFxSource,
      manualRate,
      setManualRate,
      quoteSource,
      setQuoteSource,
      manualPrices,
      setManualPrice,
      showLogos,
      setShowLogos,
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
