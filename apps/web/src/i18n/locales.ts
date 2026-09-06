// Supported UI locales. `en` is the source locale; `pt-BR` (with hyphen and
// region) is the only Portuguese variant, never bare `pt`.

export const LOCALES = ["en", "pt-BR"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const SOURCE_LOCALE: AppLocale = "en";

export const LOCALE_STORAGE_KEY = "portifolio-tracker:locale";

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "en" || value === "pt-BR";
}

export function resolveLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : SOURCE_LOCALE;
}

/**
 * First-visit hint only: a stored choice always wins, otherwise the browser
 * language suggests `pt-BR` when it looks Portuguese. The result is persisted
 * on activation, so detection never runs again once the user has a choice.
 */
export function detectInitialLocale(): AppLocale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);

    if (stored) {
      return resolveLocale(stored);
    }
  } catch {
    // Storage can be unavailable (private mode, iframe); fall through.
  }

  try {
    const language = window.navigator.language ?? "";

    if (language.toLowerCase().startsWith("pt")) {
      return "pt-BR";
    }
  } catch {
    // Navigator can be unavailable; fall through to the default.
  }

  return SOURCE_LOCALE;
}
