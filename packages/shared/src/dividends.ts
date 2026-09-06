import { z } from "zod";
import { currencySchema } from "./currency";
import { isoDate, positiveDecimal } from "./decimal";

/** Dividend sources are independent from price sources and can evolve separately. */
export const DIVIDEND_SOURCE_IDS = ["auto", "yahoo", "alpha_vantage"] as const;
export const dividendSourceSchema = z.enum(DIVIDEND_SOURCE_IDS);
export type DividendSource = z.infer<typeof dividendSourceSchema>;

export const DIVIDEND_SOURCE_LABELS: Record<DividendSource, string> = {
  auto: "Automatic (Alpha Vantage + Yahoo fallback)",
  yahoo: "Yahoo Finance (free)",
  alpha_vantage: "Alpha Vantage (free API key)",
};

export const DIVIDEND_WINDOWS = [1, 3, 5, 10] as const;
export const dividendWindowSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(5),
  z.literal(10),
]);
export type DividendWindow = z.infer<typeof dividendWindowSchema>;

export const dividendHistoryInput = z.object({
  source: dividendSourceSchema.default("auto"),
  years: dividendWindowSchema.default(3),
  displayCurrency: currencySchema.default("BRL"),
  /** BRL per USD, used only to consolidate mixed-currency income. */
  usdBrlRate: positiveDecimal.optional(),
});

export type DividendHistoryInput = z.input<typeof dividendHistoryInput>;

export const dividendStatusSchema = z.enum([
  "announced",
  "scheduled",
  "estimated_paid",
]);
export type DividendStatus = z.infer<typeof dividendStatusSchema>;

export const dividendEventSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  currency: currencySchema,
  amountPerShare: z.string(),
  declarationDate: isoDate.nullable(),
  exDate: isoDate,
  recordDate: isoDate.nullable(),
  paymentDate: isoDate.nullable(),
  eligibleQuantity: z.string(),
  grossAmount: z.string(),
  convertedGrossAmount: z.string().nullable(),
  status: dividendStatusSchema,
  source: z.enum(["yahoo", "alpha_vantage"]),
});

export type DividendEventDto = z.infer<typeof dividendEventSchema>;
