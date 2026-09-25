import { z } from "zod";
import { isoDate, positiveDecimal } from "./decimal";
import { tickerSchema } from "./transactions";

/**
 * Ledger events that change share units without moving money. Only splits
 * and reverse splits (desdobramento / grupamento) exist today; a bonus
 * issue (bonificação) also changes cost basis and needs its own rules.
 */
export const CORPORATE_ACTION_KINDS = ["split"] as const;
export const corporateActionKindSchema = z.enum(CORPORATE_ACTION_KINDS);
export type CorporateActionKind = z.infer<typeof corporateActionKindSchema>;

/**
 * `fromQuantity` old shares become `toQuantity` new ones on `effectiveAt`,
 * the first day trading in the new units: `1 → 2` is a split, `10 → 1` a
 * reverse split. Cost basis never changes; the average price follows.
 */
export const createSplitInput = z
  .object({
    ticker: tickerSchema,
    effectiveAt: isoDate,
    fromQuantity: positiveDecimal,
    toQuantity: positiveDecimal,
    notes: z.string().trim().max(280, "Use at most 280 characters").optional(),
  })
  .refine((input) => Number(input.fromQuantity) !== Number(input.toQuantity), {
    path: ["toQuantity"],
    message: "A split must change the number of shares",
  });

export type CreateSplitInput = z.input<typeof createSplitInput>;

export const removeSplitInput = z.object({ id: z.uuid() });

export const splitListInput = z.object({ ticker: tickerSchema });

export const splitSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  kind: corporateActionKindSchema,
  effectiveAt: z.string(),
  fromQuantity: z.string(),
  toQuantity: z.string(),
  notes: z.string().nullable(),
});

export type Split = z.infer<typeof splitSchema>;

/** A split the quote provider published that the ledger does not record yet. */
export const splitSuggestionSchema = z.object({
  ticker: z.string(),
  effectiveAt: z.string(),
  fromQuantity: z.string(),
  toQuantity: z.string(),
});

export type SplitSuggestion = z.infer<typeof splitSuggestionSchema>;
