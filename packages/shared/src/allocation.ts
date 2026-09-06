import { z } from "zod";
import { currencySchema } from "./currency";
import { nonNegativeDecimal, positiveDecimal, signedDecimal } from "./decimal";
import { quoteSourceSchema } from "./quotes";
import { gradeSchema, scoreBreakdownSchema } from "./score";
import { assetClassSchema, tickerSchema } from "./transactions";

/** Calendar quarter of a review, `YYYYQ[1-4]`. Keys sort chronologically. */
export const reviewPeriodSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{4}Q[1-4]$/, "Use the YYYYQn format, e.g. 2026Q1");

export type ReviewPeriod = z.infer<typeof reviewPeriodSchema>;

export function quarterKey(year: number, quarter: number): ReviewPeriod {
  return `${year}Q${quarter}`;
}

/** `2026Q1` → `{ year: 2026, quarter: 1 }`. Throws on a malformed key. */
export function parseQuarterKey(period: string): {
  year: number;
  quarter: number;
} {
  const match = /^(\d{4})Q([1-4])$/.exec(period.toUpperCase());

  if (!match) {
    throw new Error(`Not a review period: ${period}`);
  }

  return { year: Number(match[1]), quarter: Number(match[2]) };
}

/** Target share of the portfolio, `0`–`1` (`0.015` = 1.5%). */
export const weightRatio = nonNegativeDecimal.refine(
  (value) => Number(value) <= 1,
  "Use a weight between 0% and 100%",
);

/**
 * Gap between the asset's fair value and its market price, as a signed
 * ratio (`0.2355` = trading 23.55% below fair value). Negative means the
 * market price runs above the fair value. User-owned for now; a valuation
 * screen will feed it later.
 */
export const discountRatio = signedDecimal
  .refine((value) => Number(value) > -1, "Use a discount above -100%")
  .refine((value) => Number(value) <= 10, "Use a discount up to 1000%");

/** Free-text pointer to the valuation that produced the discount, e.g. `1Q26`. */
export const valuationRefSchema = z
  .string()
  .trim()
  .max(24, "Use at most 24 characters");

export const allocationListInput = z.object({
  displayCurrency: currencySchema.default("BRL"),
  /** Required whenever the portfolio mixes currencies. */
  usdBrlRate: positiveDecimal.optional(),
  quoteSource: quoteSourceSchema.default("yahoo"),
  /** Per-ticker native prices for `manual` quotes, keyed by upper-case ticker. */
  manualPrices: z.record(z.string(), positiveDecimal).optional(),
});

export type AllocationListInput = z.input<typeof allocationListInput>;

/**
 * Creates or patches the analysis metadata of a ticker. Omitted fields keep
 * their stored value, which is what inline cell edits send; an explicit
 * `null` clears the field. Upserting a ticker with no position is how a
 * watch-only asset joins the table.
 */
export const upsertAllocationAssetInput = z.object({
  ticker: tickerSchema,
  assetClass: assetClassSchema.optional(),
  currency: currencySchema.optional(),
  targetWeight: weightRatio.nullable().optional(),
  discount: discountRatio.nullable().optional(),
  valuationRef: valuationRefSchema.nullable().optional(),
});

export type UpsertAllocationAssetInput = z.input<
  typeof upsertAllocationAssetInput
>;

/**
 * Drops the analysis metadata of a ticker. Transactions and quarterly
 * reviews are untouched, so a ticker with a position stays in the table
 * with empty target and discount.
 */
export const removeAllocationAssetInput = z.object({ ticker: tickerSchema });

/** Manual row order, newest first in the array. Unlisted tickers sort last. */
export const reorderAllocationInput = z.object({
  tickers: z.array(tickerSchema).max(500),
});

export type ReorderAllocationInput = z.input<typeof reorderAllocationInput>;

export const upsertAssetReviewInput = z.object({
  ticker: tickerSchema,
  period: reviewPeriodSchema,
  grade: gradeSchema.nullable().optional(),
  notes: z
    .string()
    .trim()
    .max(2000, "Use at most 2000 characters")
    .nullable()
    .optional(),
});

export type UpsertAssetReviewInput = z.input<typeof upsertAssetReviewInput>;

export const removeAssetReviewInput = z.object({
  ticker: tickerSchema,
  period: reviewPeriodSchema,
});

export const assetReviewSchema = z.object({
  period: reviewPeriodSchema,
  grade: gradeSchema.nullable(),
  notes: z.string().nullable(),
});

export type AssetReview = z.infer<typeof assetReviewSchema>;

/** One line of the allocation table: position, targets, grades and score. */
export const allocationRowSchema = z.object({
  ticker: z.string(),
  assetClass: assetClassSchema,
  currency: currencySchema,
  displayCurrency: currencySchema,
  /** True when the ticker owns an analysis row (target, discount, order). */
  tracked: z.boolean(),
  /** False for watch-only assets: on the radar, no money in them. */
  hasPosition: z.boolean(),
  quantity: z.string(),
  averagePrice: z.string(),
  /** Native-currency market price, `null` when no quote resolved. */
  marketPrice: z.string().nullable(),
  /** Same price in the display currency, `null` without a quote or rate. */
  convertedMarketPrice: z.string().nullable(),
  /** Position value in the display currency, `null` without a quote. */
  marketValue: z.string().nullable(),
  /** Share of the quoted portfolio, `0`–`1`. Watch-only assets are `0`. */
  currentWeight: z.string(),
  targetWeight: z.string().nullable(),
  /** `targetWeight - currentWeight`, before the discount adjustment. */
  gapWeight: z.string().nullable(),
  discount: z.string().nullable(),
  /** Average of the newest graded quarters, `null` when never graded. */
  averageGrade: z.string().nullable(),
  /** How many quarters the average covers. */
  gradedQuarters: z.number(),
  /** Date of the last buy (`YYYY-MM-DD`), `null` when never bought. */
  lastContributionAt: z.string().nullable(),
  valuationRef: z.string().nullable(),
  sortOrder: z.number(),
  quoteMissing: z.boolean(),
  score: scoreBreakdownSchema,
  /** Every stored quarterly review, ascending by period. */
  reviews: z.array(assetReviewSchema),
});

export type AllocationRow = z.infer<typeof allocationRowSchema>;

export const allocationSummarySchema = z.object({
  displayCurrency: currencySchema,
  /** Quoted market value backing the weights. */
  totalMarketValue: z.string(),
  totalTargetWeight: z.string(),
  totalCurrentWeight: z.string(),
  /** Rows with a position vs rows listed for research only. */
  investedAssets: z.number(),
  watchOnlyAssets: z.number(),
  /** Rows with a positive score, ready to take a contribution. */
  candidates: z.number(),
  /** Rows a rule zeroed (cap, overweight or cooldown). */
  blocked: z.number(),
  /** Rows with a negative score: overweight and no longer cheap. */
  trimCandidates: z.number(),
  /** Config version behind every score in the payload. */
  scoreVersion: z.string(),
});

export type AllocationSummary = z.infer<typeof allocationSummarySchema>;
