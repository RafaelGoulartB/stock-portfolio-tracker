import { z } from "zod";
import { currencySchema } from "./currency";
import { dailyTrackingInput } from "./fx";
import { assetClassSchema } from "./transactions";

/**
 * Lookback windows on Deep Finder. `cost` is the open result versus moving
 * average cost; the others compare today's holding to a past close.
 */
export const DEEP_FINDER_WINDOWS = [
  "cost",
  "1d",
  "1w",
  "1m",
  "3m",
  "ytd",
  "1y",
] as const;

export const deepFinderWindowSchema = z.enum(DEEP_FINDER_WINDOWS);
export type DeepFinderWindow = z.infer<typeof deepFinderWindowSchema>;

export const DEFAULT_DEEP_FINDER_WINDOW: DeepFinderWindow = "cost";

export const deepFinderInput = dailyTrackingInput.extend({
  window: deepFinderWindowSchema.default(DEFAULT_DEEP_FINDER_WINDOW),
});

export type DeepFinderInput = z.input<typeof deepFinderInput>;

export const deepFinderRowSchema = z.object({
  ticker: z.string(),
  assetClass: assetClassSchema,
  currency: currencySchema,
  displayCurrency: currencySchema,
  quantity: z.string(),
  /** Current market value in the display currency, when quoted. */
  marketValue: z.string().nullable(),
  /**
   * Period move in the display currency. For `cost` this is the open
   * result; otherwise `qty * (priceNow - priceThen)` converted.
   */
  change: z.string().nullable(),
  /** `change / baselineValue`. Null without a baseline. */
  changePercent: z.string().nullable(),
  /** Native close used as the period start. Null on the cost window. */
  baselinePrice: z.string().nullable(),
  /** Day of {@link baselinePrice}. Null on the cost window. */
  baselineAsOf: z.string().nullable(),
  marketPrice: z.string().nullable(),
});

export type DeepFinderRow = z.infer<typeof deepFinderRowSchema>;
