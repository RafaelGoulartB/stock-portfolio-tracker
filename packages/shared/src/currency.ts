import { z } from "zod";

/** ISO-4217 currencies supported per asset. Never mix them in one average. */
export const CURRENCIES = ["BRL", "USD"] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

export const CURRENCY_LABELS: Record<Currency, string> = {
  BRL: "BRL — Real",
  USD: "USD — Dollar",
};

/** Rows that predate the per-asset currency column are BRL. */
export const DEFAULT_CURRENCY: Currency = "BRL";
