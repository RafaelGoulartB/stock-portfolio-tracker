import { z } from "zod";
import { currencySchema } from "./currency";
import { positiveDecimal } from "./decimal";
import { fxSourceSchema } from "./fx";
import { quoteSourceSchema } from "./quotes";

/**
 * Windows offered by the performance screen, in months. The history always
 * ends today and one extra month-end before the window is valued as the
 * starting point of the first monthly return.
 */
export const PERFORMANCE_WINDOWS = [6, 12, 24, 36] as const;
export type PerformanceWindow = (typeof PERFORMANCE_WINDOWS)[number];

export const DEFAULT_PERFORMANCE_WINDOW: PerformanceWindow = 12;

/**
 * Historical performance request. Unlike `positions.list`, the rate is not
 * supplied by the caller: every month-end needs its own USD/BRL close, so
 * the API resolves the whole series from `fxSource` (or from `manualRate`,
 * which is then held flat because a manual rate has no history).
 */
export const performanceHistoryInput = z.object({
  displayCurrency: currencySchema.default("BRL"),
  /** Number of monthly returns to compute, ending in the current month. */
  months: z.number().int().min(3).max(60).default(DEFAULT_PERFORMANCE_WINDOW),
  quoteSource: quoteSourceSchema.default("yahoo"),
  /** Per-ticker native prices for `manual` quotes, keyed by upper-case ticker. */
  manualPrices: z.record(z.string(), positiveDecimal).optional(),
  fxSource: fxSourceSchema.default("frankfurter"),
  /** Required when `fxSource` is `manual`. */
  manualRate: positiveDecimal.optional(),
});

export type PerformanceHistoryInput = z.input<typeof performanceHistoryInput>;
