import { i18n } from "@lingui/core";
import {
  type AppLocale,
  detectInitialLocale,
  LOCALE_STORAGE_KEY,
} from "./locales";

export { type AppLocale, LOCALES, SOURCE_LOCALE } from "./locales";
export { detectInitialLocale, i18n };

/**
 * Loads the catalog for `locale`, activates it, persists the choice, and
 * keeps `<html lang>` in sync. Amounts and dates are never translated here;
 * components render them with `Intl` using `i18n.locale`.
 */
export async function activateLocale(locale: AppLocale): Promise<void> {
  const { messages } = await import(`../locales/${locale}/messages.po`);

  i18n.load(locale, messages);
  i18n.activate(locale);

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Persistence is a hint; the active locale still applies in memory.
  }

  document.documentElement.lang = locale;
}
