import { z } from "zod";
import { currencySchema } from "./currency";
import { isoDate, positiveDecimal } from "./decimal";
import { quoteSourceSchema } from "./quotes";

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

/**
 * Extra costs applied only when sizing a contribution in BRL for a USD
 * asset: broker spread, then IOF. Portfolio valuation always uses the
 * spot dollar; these factors never leave the contribution planner.
 */
export const FX_EXECUTION_SPREAD = "0.015";
export const FX_EXECUTION_IOF = "0.0038";

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
  /** `YYYY-MM-DD` close for month snapshots; omitted means latest spot. */
  asOf: isoDate.optional(),
});

export type GetFxRateInput = z.input<typeof getFxRateInput>;

/**
 * Lets the server resolve USD/BRL itself when the caller sends no explicit
 * `usdBrlRate`, the way `performance.history` already does.
 *
 * This removes a client waterfall: a screen no longer has to fetch the rate,
 * wait, and only then ask for its portfolio. `usdBrlRate` still wins when
 * present, so a caller that already holds a rate (a write dialog, for
 * instance) keeps full control of the number used.
 */
export const fxResolutionFields = {
  /** Provider used when `usdBrlRate` is absent. */
  fxSource: fxSourceSchema.optional(),
  /** Required when `fxSource` is `manual` and no `usdBrlRate` is given. */
  manualRate: positiveDecimal.optional(),
} as const;

/** Consolidation target: every position is shown converted to this. */
export const positionsListInput = z.object({
  displayCurrency: currencySchema.default("BRL"),
  /** BRL per 1 USD. Required when holdings span both currencies. */
  usdBrlRate: positiveDecimal.optional(),
  ...fxResolutionFields,
  /**
   * Snapshot date (`YYYY-MM-DD`, month-end for past months). Only trades on
   * or before this day consolidate; quotes resolve at its close. Omitted
   * means the live portfolio today.
   */
  asOf: isoDate.optional(),
  /** Market-quote source used for financial values and allocation. */
  quoteSource: quoteSourceSchema.default("yahoo"),
  /**
   * Per-ticker native-currency prices for `manual` quotes, keyed by
   * upper-case ticker. Owned by the frontend until a server table lands.
   */
  manualPrices: z.record(z.string(), positiveDecimal).optional(),
});

export type PositionsListInput = z.input<typeof positionsListInput>;

/** Live portfolio request used by the daily performance screen. */
export const dailyTrackingInput = positionsListInput.omit({ asOf: true });

export type DailyTrackingInput = z.input<typeof dailyTrackingInput>;
