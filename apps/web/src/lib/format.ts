import { format, parseISO } from "date-fns";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("en-US");

/**
 * Decimal strings come from the API already rounded, so formatting is the only
 * place a value is turned into a JavaScript number.
 */
export function formatMoney(value: string): string {
  return money.format(Number(value));
}

export function formatSignedMoney(value: string): string {
  const formatted = formatMoney(value);

  return value.startsWith("-") ? formatted : `+${formatted}`;
}

export function formatQuantity(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const wholeText = integer.format(Number(whole));

  return trimmed ? `${wholeText}.${trimmed}` : wholeText;
}

export function formatTradeDate(value: string): string {
  return format(parseISO(value), "dd MMM yyyy");
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
