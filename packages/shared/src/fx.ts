import { z } from "zod";
import { currencySchema } from "./currency";
import { positiveDecimal } from "./decimal";

/**
 * FX rate providers. Implementations live in the API (`lib/fx`) behind the
 * `FxProvider` interface, so new quote sources can be added by registering
 * another provider without touching routers or the web app.
 */
export const FX_SOURCE_IDS = ["frankfurter", "manual"] as const;
export const fxSourceSchema = z.enum(FX_SOURCE_IDS);
export type FxSource = z.infer<typeof fxSourceSchema>;

export const FX_SOURCE_LABELS: Record<FxSource, string> = {
  frankfurter: "Frankfurter (ECB reference)",
  manual: "Manual rate",
};

/** `rate` is always BRL per 1 USD, travelling as a decimal string. */
export const fxRateSchema = z.object({
  from: currencySchema,
  to: currencySchema,
  rate: positiveDecimal,
  /** Calendar day the quote refers to, `YYYY-MM-DD`. */
  asOf: z.string(),
  source: fxSourceSchema,
});

export type FxRate = z.infer<typeof fxRateSchema>;

export const getFxRateInput = z.object({
  from: currencySchema,
  to: currencySchema,
  source: fxSourceSchema.default("frankfurter"),
  /** Required when `source` is `manual`. Ignored by external providers. */
  manualRate: positiveDecimal.optional(),
});

export type GetFxRateInput = z.input<typeof getFxRateInput>;

/** Consolidation target: every position is shown converted to this. */
export const positionsListInput = z.object({
  displayCurrency: currencySchema.default("BRL"),
  /** BRL per 1 USD. Required when holdings span both currencies. */
  usdBrlRate: positiveDecimal.optional(),
});

export type PositionsListInput = z.input<typeof positionsListInput>;
