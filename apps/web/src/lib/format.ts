import { i18n } from "@/i18n";

/**
 * Fixed ISO currency stored per asset. The UI locale only changes how an
 * amount is displayed (separators, symbol placement) and never converts it:
 * 100 BRL stays 100 BRL when the UI switches to English.
 */
export type CurrencyCode = "BRL" | "USD";

/** Rows that predate the per-asset currency column are BRL. */
export const DEFAULT_CURRENCY: CurrencyCode = "BRL";

/** API timezone used when rendering calendar dates. */
export const API_TIME_ZONE = "America/Sao_Paulo";

const moneyFormatters = new Map<string, Intl.NumberFormat>();
const integerFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const decimalSeparators = new Map<string, string>();

function activeLocale(fallback = "en"): string {
  return i18n.locale ?? fallback;
}

function moneyFormatter(
  locale: string,
  currency: CurrencyCode,
): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  const cached = moneyFormatters.get(key);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  moneyFormatters.set(key, formatter);

  return formatter;
}

function integerFormatter(locale: string): Intl.NumberFormat {
  const cached = integerFormatters.get(locale);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  });

  integerFormatters.set(locale, formatter);

  return formatter;
}

function dateFormatter(locale: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(locale);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: API_TIME_ZONE,
  });

  dateFormatters.set(locale, formatter);

  return formatter;
}

function decimalSeparator(locale: string): string {
  const cached = decimalSeparators.get(locale);

  if (cached) {
    return cached;
  }

  const separator =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? ".";

  decimalSeparators.set(locale, separator);

  return separator;
}

/**
 * Decimal strings come from the API already rounded, so formatting is the
 * only place a value is turned into a JavaScript number.
 */
export function formatMoney(
  value: string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  locale: string = activeLocale(),
): string {
  return moneyFormatter(locale, currency).format(Number(value));
}

export function formatSignedMoney(
  value: string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  locale: string = activeLocale(),
): string {
  const formatted = formatMoney(value, currency, locale);

  return value.startsWith("-") ? formatted : `+${formatted}`;
}

export function formatQuantity(
  value: string,
  locale: string = activeLocale(),
): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const wholeText = integerFormatter(locale).format(Number(whole));

  return trimmed
    ? `${wholeText}${decimalSeparator(locale)}${trimmed}`
    : wholeText;
}

export function formatTradeDate(
  value: string,
  locale: string = activeLocale(),
): string {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  // Midday UTC keeps the calendar day stable across the API timezone.
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  return dateFormatter(locale).format(date);
}

export function signOf(value: string): "positive" | "negative" | "zero" {
  if (value.startsWith("-")) {
    return "negative";
  }

  return Number(value) === 0 ? "zero" : "positive";
}

export function pnlClassName(value: string): string {
  const sign = signOf(value);

  if (sign === "positive") {
    return "text-gain";
  }

  return sign === "negative" ? "text-loss" : "text-muted-foreground";
}
