import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type {
  Currency,
  FxSource,
  QuoteSource,
} from "@portifolio-tracker/shared";

/**
 * Localized display names for the settings dropdowns. The shared `*_LABELS`
 * constants are English source strings used by the API and validation; the
 * UI renders these translated variants instead so both locales read
 * naturally. New source IDs must add a case here to compile.
 */
export function fxSourceText(source: FxSource, i18n: I18n): string {
  switch (source) {
    case "frankfurter":
      return i18n._(
        msg({
          id: "fxSource.frankfurter",
          message: "Frankfurter (ECB reference)",
        }),
      );
    case "manual":
      return i18n._(msg({ id: "fxSource.manual", message: "Manual rate" }));
  }
}

export function quoteSourceText(source: QuoteSource, i18n: I18n): string {
  switch (source) {
    case "yahoo":
      return i18n._(
        msg({
          id: "quoteSource.yahoo",
          message: "Yahoo Finance (free, delayed)",
        }),
      );
    case "manual":
      return i18n._(
        msg({ id: "quoteSource.manual", message: "Manual prices" }),
      );
  }
}

export function currencyText(currency: Currency, i18n: I18n): string {
  switch (currency) {
    case "BRL":
      return i18n._(msg({ id: "currency.brl", message: "BRL — Real" }));
    case "USD":
      return i18n._(msg({ id: "currency.usd", message: "USD — Dollar" }));
  }
}
