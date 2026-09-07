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

/** Inclusive last calendar day of a review period, `YYYY-MM-DD`. */
export function quarterEndDate(period: string): string {
  const { year, quarter } = parseQuarterKey(period);
  const month = quarter * 3;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Target share of the portfolio, `0`–`1` (`0.015` = 1.5%). */
export const weightRatio = nonNegativeDecimal.refine(
  (value) => Number(value) <= 1,
  "Use a weight between 0% and 100%",
);

/**
 * Per-share fair value in the asset's native currency, set on a quarterly
 * review. The allocation discount uses the newest quarter that has one.
 */
export const fairValueSchema = positiveDecimal;

/**
 * Optional link to the valuation that produced the fair value (spreadsheet,
 * Notion page, etc.). Accepts absolute http(s) URLs.
 */
export const fairValueRefSchema = z
  .string()
  .trim()
  .url("Use a full http(s) link")
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "Use a full http(s) link",
  )
  .max(2048, "Use at most 2048 characters");

/** Free-text pointer to the valuation write-up, e.g. `1Q26`. */
export const valuationRefSchema = z
  .string()
  .trim()
  .max(24, "Use at most 24 characters");

/**
 * Signed gap between fair value and market price (`0.2355` = trading 23.55%
 * below fair value). Negative means the market runs above the fair value.
 * Computed on the server; kept here so clients can validate display ranges.
 */
export const discountRatio = signedDecimal
  .refine((value) => Number(value) > -1, "Use a discount above -100%")
  .refine((value) => Number(value) <= 10, "Use a discount up to 1000%");

export const allocationListInput = z.object({
  displayCurrency: currencySchema.default("BRL"),
  /** Required whenever the portfolio mixes currencies. */
  usdBrlRate: positiveDecimal.optional(),
  quoteSource: quoteSourceSchema.default("yahoo"),
  /** Per-ticker native prices for `manual` quotes, keyed by upper-case ticker. */
  manualPrices: z.record(z.string(), positiveDecimal).optional(),
});

export type AllocationListInput = z.input<typeof allocationListInput>;

/** Price history for one allocation ticker, overlaid with fair value. */
export const allocationHistoryInput = allocationListInput.extend({
  ticker: tickerSchema,
});

export type AllocationHistoryInput = z.input<typeof allocationHistoryInput>;

export const allocationHistoryPointSchema = z.object({
  asOf: z.string(),
  /** Native-currency close. */
  close: z.string(),
  /**
   * Fair value in force on `asOf`: the newest quarterly valuation whose
   * quarter has already ended. Null before the first reviewed quarter.
   */
  fairValue: z.string().nullable(),
});

export type AllocationHistoryPoint = z.infer<
  typeof allocationHistoryPointSchema
>;

/**
 * Soft row highlight on the allocation table. Tokens only — the user decides
 * what each color means. Stored on `allocation_assets.mark_color`.
 */
export const ALLOCATION_MARK_COLORS = [
  "blue",
  "yellow",
  "red",
  "orange",
  "green",
] as const;

export const allocationMarkColorSchema = z.enum(ALLOCATION_MARK_COLORS);
export type AllocationMarkColor = z.infer<typeof allocationMarkColorSchema>;

/** Cycles null → blue → … → green → null for the left-index toggle. */
export function nextAllocationMarkColor(
  current: AllocationMarkColor | null,
): AllocationMarkColor | null {
  if (current === null) {
    return ALLOCATION_MARK_COLORS[0];
  }

  const index = ALLOCATION_MARK_COLORS.indexOf(current);

  if (index < 0 || index >= ALLOCATION_MARK_COLORS.length - 1) {
    return null;
  }

  return ALLOCATION_MARK_COLORS[index + 1] ?? null;
}

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
  valuationRef: valuationRefSchema.nullable().optional(),
  markColor: allocationMarkColorSchema.nullable().optional(),
});

export type UpsertAllocationAssetInput = z.input<
  typeof upsertAllocationAssetInput
>;

/**
 * Sets or clears the stored market value of an unquoted position. The API
 * turns the display-currency amount into a native per-unit price
 * (`value / quantity`) and stores that as the manual quote fallback.
 */
export const setManualValueInput = z.object({
  ticker: tickerSchema,
  /** Display-currency market value. `null` drops the override. */
  marketValue: positiveDecimal.nullable(),
  displayCurrency: currencySchema,
  /** Required when the position's native currency differs from display. */
  usdBrlRate: positiveDecimal.optional(),
});

export type SetManualValueInput = z.input<typeof setManualValueInput>;

/**
 * Drops the analysis metadata of a ticker. Transactions and quarterly
 * reviews are untouched, so a ticker with a position stays in the table
 * with an empty target.
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
  fairValue: fairValueSchema.nullable().optional(),
  fairValueRef: fairValueRefSchema.nullable().optional(),
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
  /** Per-share fair value for this quarter, in the asset's native currency. */
  fairValue: z.string().nullable(),
  /** Optional link to the valuation behind this fair value. */
  fairValueRef: z.string().nullable(),
});

export type AssetReview = z.infer<typeof assetReviewSchema>;

/** One line of the allocation table: position, targets, grades and score. */
export const allocationRowSchema = z.object({
  ticker: z.string(),
  assetClass: assetClassSchema,
  currency: currencySchema,
  displayCurrency: currencySchema,
  /** True when the ticker owns an analysis row (target, order). */
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
  /**
   * Newest quarterly fair value, in the asset's native currency. Null until
   * any review carries one.
   */
  fairValue: z.string().nullable(),
  /** Period of {@link fairValue}, e.g. `2026Q1`. */
  fairValuePeriod: reviewPeriodSchema.nullable(),
  /** Link from the review that produced {@link fairValue}, if any. */
  fairValueRef: z.string().nullable(),
  /**
   * `(fairValue - marketPrice) / fairValue`. Null without a fair value or a
   * market price. Positive means the stock trades below fair value.
   */
  discount: z.string().nullable(),
  /**
   * How the Value column was produced. `quote` is quantity × live price,
   * `manual` is the stored override used when no public quote exists, and
   * `none` means the cell is empty.
   */
  valueSource: z.enum(["quote", "manual", "none"]),
  /**
   * Stored native per-unit price used when the quote provider has nothing.
   * Null until the user sets a value on an unquoted row.
   */
  manualPrice: positiveDecimal.nullable(),
  /**
   * Display-currency price used only to size a contribution. USD assets
   * shown in BRL include spread and IOF; everything else matches the spot
   * conversion. Null without a native price or a rate.
   */
  executionPrice: z.string().nullable(),
  /** True when {@link executionPrice} used the VET rate instead of spot. */
  executionFxApplied: z.boolean(),
  /** Average of the newest graded quarters, `null` when never graded. */
  averageGrade: z.string().nullable(),
  /** How many quarters the average covers. */
  gradedQuarters: z.number(),
  /** Date of the last buy (`YYYY-MM-DD`), `null` when never bought. */
  lastContributionAt: z.string().nullable(),
  valuationRef: z.string().nullable(),
  /** Soft row highlight; null when unmarked. */
  markColor: allocationMarkColorSchema.nullable(),
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
  /**
   * Simple average of non-null discounts among the summarised rows.
   * `null` when no row carries a discount.
   */
  averageDiscount: signedDecimal.nullable(),
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
