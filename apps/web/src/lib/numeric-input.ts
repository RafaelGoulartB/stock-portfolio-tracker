import { i18n } from "@/i18n";

/**
 * Text-first numeric parsing for the editable cells.
 *
 * The API only accepts decimal strings, and a percent typed as `1,5` must
 * become exactly `0.015` — never `0.015000000000000001`. So every step here
 * is string arithmetic: the decimal point is *moved*, not multiplied.
 */

const MAX_PLACES = 8;

function decimalSeparator(locale: string): string {
  return (
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? "."
  );
}

/** Drops leading zeros, trailing fraction zeros and a dangling point. */
function tidy(value: string): string {
  const negative = value.startsWith("-");
  const raw = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = raw.split(".");
  const trimmedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const trimmedFraction = fraction.replace(/0+$/, "");
  const text = trimmedFraction
    ? `${trimmedWhole}.${trimmedFraction}`
    : trimmedWhole;

  return negative && text !== "0" ? `-${text}` : text;
}

/** Moves the decimal point of a plain decimal string; negative moves left. */
export function shiftDecimalPoint(value: string, places: number): string {
  const negative = value.startsWith("-");
  const raw = negative ? value.slice(1) : value;
  const [whole = "", fraction = ""] = raw.split(".");
  const digits = `${whole}${fraction}`;
  const point = whole.length + places;
  let text: string;

  if (point <= 0) {
    text = `0.${"0".repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    text = `${digits}${"0".repeat(point - digits.length)}`;
  } else {
    text = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }

  return tidy(negative ? `-${text}` : text);
}

/**
 * Normalizes typed input into a plain decimal string. Accepts both decimal
 * separators, a trailing `%`, thin spaces and group separators, so pasting
 * `1.234,56%` or typing `-23,55` both work.
 */
export function parseDecimalInput(text: string): string | null {
  let cleaned = text.trim().replace(/%/g, "").replace(/\s/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  // With both separators present the rightmost one is the decimal point and
  // the other only groups digits. With one, it is the decimal point.
  if (lastComma >= 0 && lastDot >= 0) {
    cleaned = cleaned.split(lastComma > lastDot ? "." : ",").join("");
  }

  cleaned = cleaned.replace(",", ".");

  if (cleaned.length === 0) {
    return null;
  }

  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || !/\d/.test(cleaned)) {
    return null;
  }

  const [whole = "0", fraction = ""] = cleaned
    .replace(/^-\./, "-0.")
    .replace(/^\./, "0.")
    .split(".");

  return tidy(
    `${whole || "0"}${fraction ? `.${fraction.slice(0, MAX_PLACES)}` : ""}`,
  );
}

/** `"1,5"` typed as a percent becomes the ratio `"0.015"`. */
export function parsePercentInput(text: string): string | null {
  const value = parseDecimalInput(text);

  return value === null ? null : shiftDecimalPoint(value, -2);
}

/** Ratio `"0.015"` becomes `"1,5"` for editing, in the active locale. */
export function formatPercentInput(
  ratio: string | null,
  locale: string = i18n.locale ?? "en",
): string {
  if (ratio === null) {
    return "";
  }

  return shiftDecimalPoint(ratio, 2).replace(".", decimalSeparator(locale));
}

/** Plain decimal `"8.5"` becomes `"8,5"` for editing, in the active locale. */
export function formatDecimalInput(
  value: string | null,
  locale: string = i18n.locale ?? "en",
): string {
  if (value === null) {
    return "";
  }

  return tidy(value).replace(".", decimalSeparator(locale));
}
