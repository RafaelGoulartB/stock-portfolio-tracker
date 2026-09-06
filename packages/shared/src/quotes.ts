import { z } from "zod";
import { currencySchema } from "./currency";
import { isoDate, positiveDecimal } from "./decimal";
import { assetClassSchema, tickerSchema } from "./transactions";

/**
 * Market-quote providers. Implementations live in the API (`lib/quotes`)
 * behind the `QuoteProvider` interface, mirroring the FX provider registry:
 * adding a source means implementing the interface and registering one line,
 * without touching routers or the web app.
 *
 * `yahoo` is the default free source (no API key, delayed quotes). `manual` resolves prices
 * from per-ticker values owned by the frontend (localStorage for now, a DB
 * table later) so assets without a public quote can still be valued.
 */
export const QUOTE_SOURCE_IDS = ["yahoo", "manual"] as const;
export const quoteSourceSchema = z.enum(QUOTE_SOURCE_IDS);
export type QuoteSource = z.infer<typeof quoteSourceSchema>;

export const QUOTE_SOURCE_LABELS: Record<QuoteSource, string> = {
  yahoo: "Yahoo Finance (free, delayed)",
  manual: "Manual prices",
};

/** One market price for a ticker, travelling with its quote date. */
export const spotQuoteSchema = z.object({
  ticker: z.string(),
  /** Native-currency price per unit, as a decimal string. */
  price: positiveDecimal,
  currency: currencySchema,
  /** Calendar day the quote refers to, `YYYY-MM-DD`. */
  asOf: z.string(),
  source: quoteSourceSchema,
});

export type SpotQuote = z.infer<typeof spotQuoteSchema>;

export const quoteAssetSchema = z.object({
  ticker: tickerSchema,
  assetClass: assetClassSchema,
  currency: currencySchema,
});

export type QuoteAsset = z.infer<typeof quoteAssetSchema>;

export const getQuoteInput = z.object({
  ticker: tickerSchema,
  assetClass: assetClassSchema,
  currency: currencySchema.optional(),
  /** `YYYY-MM-DD` close; omitted means the latest spot quote. */
  asOf: isoDate.optional(),
  source: quoteSourceSchema.default("yahoo"),
  /** Required when `source` is `manual`. */
  manualPrice: positiveDecimal.optional(),
});

export type GetQuoteInput = z.input<typeof getQuoteInput>;

export const getBatchQuotesInput = z.object({
  assets: z.array(quoteAssetSchema).max(100),
  asOf: isoDate.optional(),
  source: quoteSourceSchema.default("yahoo"),
  /** Per-ticker native-currency prices, keyed by upper-case ticker. */
  manualPrices: z.record(z.string(), positiveDecimal).optional(),
});

export type GetBatchQuotesInput = z.input<typeof getBatchQuotesInput>;
