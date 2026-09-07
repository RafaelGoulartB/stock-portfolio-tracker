import { z } from "zod";
import { currencySchema, DEFAULT_CURRENCY } from "./currency";
import { isoDate, nonNegativeDecimal, positiveDecimal } from "./decimal";

export const TRANSACTION_SIDES = ["buy", "sell"] as const;
export const transactionSideSchema = z.enum(TRANSACTION_SIDES);
export type TransactionSide = z.infer<typeof transactionSideSchema>;

export const ASSET_CLASSES = [
  "stock_br",
  "stock_us",
  "reit",
  "etf",
  "bdr",
  "crypto",
  "fixed_income",
  "cash",
  "other",
] as const;
export const assetClassSchema = z.enum(ASSET_CLASSES);
export type AssetClass = z.infer<typeof assetClassSchema>;

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  stock_br: "Brazilian stock",
  stock_us: "US stock",
  reit: "REIT",
  etf: "ETF",
  bdr: "BDR",
  crypto: "Crypto",
  fixed_income: "Fixed income",
  cash: "Cash",
  other: "Other",
};

export const TRANSACTION_SIDE_LABELS: Record<TransactionSide, string> = {
  buy: "Buy",
  sell: "Sell",
};

export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "Ticker is required")
  .max(120, "Use at most 120 characters")
  .refine((value) => !/[\r\n\t]/.test(value), "Use a single-line asset name");

/** Empty fields are omitted by the fixed-income form. */
const optionalPositiveDecimal = z
  .union([positiveDecimal, z.literal("")])
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const createTransactionInput = z
  .object({
    ticker: tickerSchema,
    assetClass: assetClassSchema,
    currency: currencySchema.default(DEFAULT_CURRENCY),
    side: transactionSideSchema.optional(),
    quantity: optionalPositiveDecimal,
    price: optionalPositiveDecimal,
    /**
     * Fixed-income positions are tracked as a single user-maintained value.
     * Quantity and unit price remain an internal implementation detail.
     */
    value: positiveDecimal.optional(),
    fees: nonNegativeDecimal.optional(),
    tradedAt: isoDate,
    notes: z.string().trim().max(280, "Use at most 280 characters").optional(),
  })
  .superRefine((input, ctx) => {
    if (input.assetClass === "cash") {
      ctx.addIssue({
        code: "custom",
        path: ["assetClass"],
        message: "Cash is maintained from Allocation",
      });
      return;
    }

    if (input.assetClass === "fixed_income") {
      if (input.value === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Value is required",
        });
      }

      if (input.side !== undefined && input.side !== "buy") {
        ctx.addIssue({
          code: "custom",
          path: ["side"],
          message: "Fixed income cannot be sold as a trade",
        });
      }

      return;
    }

    if (input.side === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["side"],
        message: "Side is required",
      });
    }

    if (input.quantity === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Quantity is required",
      });
    }

    if (input.price === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["price"],
        message: "Unit price is required",
      });
    }
  })
  .transform((input) => {
    if (input.assetClass === "fixed_income") {
      return {
        ...input,
        side: "buy" as const,
        quantity: "1",
        price: input.value as string,
        fees: "0",
      };
    }

    return {
      ...input,
      side: input.side as TransactionSide,
      quantity: input.quantity as string,
      price: input.price as string,
      fees: input.fees ?? "0",
    };
  });

export type CreateTransactionInput = z.input<typeof createTransactionInput>;

export const deleteTransactionInput = z.object({ id: z.uuid() });

export const transactionSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  assetClass: assetClassSchema,
  currency: currencySchema,
  side: transactionSideSchema,
  quantity: z.string(),
  price: z.string(),
  fees: z.string(),
  tradedAt: z.string(),
  notes: z.string().nullable(),
  total: z.string(),
});

export type Transaction = z.infer<typeof transactionSchema>;

export const tickerLedgerInput = z.object({ ticker: tickerSchema });

export const tickerLedgerTradeSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  assetClass: assetClassSchema,
  currency: currencySchema,
  side: transactionSideSchema,
  quantity: z.string(),
  price: z.string(),
  fees: z.string(),
  total: z.string(),
  tradedAt: z.string(),
  notes: z.string().nullable(),
  /** Realized P&L of this sell at the then-current moving average. */
  realizedPnl: z.string().nullable(),
  quantityAfter: z.string(),
  averagePriceAfter: z.string(),
});

export type TickerLedgerTrade = z.infer<typeof tickerLedgerTradeSchema>;

export const tickerLedgerSchema = z.object({
  ticker: z.string(),
  currency: currencySchema.nullable(),
  trades: z.array(tickerLedgerTradeSchema),
  buyCount: z.number(),
  sellCount: z.number(),
  buyQuantity: z.string(),
  sellQuantity: z.string(),
  buyTotal: z.string(),
  sellTotal: z.string(),
  realizedPnl: z.string(),
  investedCost: z.string(),
  quantity: z.string(),
  averagePrice: z.string(),
});

export type TickerLedger = z.infer<typeof tickerLedgerSchema>;

export const positionSchema = z.object({
  ticker: z.string(),
  assetClass: assetClassSchema,
  /** Native currency of the trades behind this position. Never converted. */
  currency: currencySchema,
  quantity: z.string(),
  averagePrice: z.string(),
  investedCost: z.string(),
  realizedPnl: z.string(),
  transactionCount: z.number(),
  lastTradedAt: z.string(),
  /** Currency the portfolio is consolidated into. */
  displayCurrency: currencySchema,
  /** Same amounts converted at the consolidation rate. */
  convertedAveragePrice: z.string(),
  convertedInvestedCost: z.string(),
  convertedRealizedPnl: z.string(),
});

export type Position = z.infer<typeof positionSchema>;

/**
 * A position enriched with its market valuation for the snapshot date.
 * Quote-backed fields are `null` when no quote exists for the ticker, so
 * the UI can fall back to cost basis and flag the gap instead of guessing.
 */
export const valuedPositionSchema = positionSchema.extend({
  /** Native-currency market price per unit at the snapshot close. */
  marketPrice: z.string().nullable(),
  /** Native-currency market value (`quantity * marketPrice`). */
  marketValue: z.string().nullable(),
  /** Market value converted to the display currency. */
  convertedMarketValue: z.string().nullable(),
  /** Native-currency open result (`marketValue - investedCost`). */
  unrealizedPnl: z.string().nullable(),
  /** Open result converted to the display currency. */
  convertedUnrealizedPnl: z.string().nullable(),
  /** Open result over invested cost, as a decimal string (`0.1` = +10%). */
  unrealizedPnlPercent: z.string().nullable(),
  /** Share of quoted equity, `0`–`1` as a decimal string. */
  weight: z.string().nullable(),
  /** Calendar day the quote refers to, `YYYY-MM-DD`. */
  quoteAsOf: z.string().nullable(),
  /** True when the quote provider had no price for this ticker. */
  quoteMissing: z.boolean(),
});

export type ValuedPosition = z.infer<typeof valuedPositionSchema>;

export const currencyTotalSchema = z.object({
  currency: currencySchema,
  investedCost: z.string(),
  realizedPnl: z.string(),
});

export type CurrencyTotal = z.infer<typeof currencyTotalSchema>;

export const portfolioSummarySchema = z.object({
  openPositions: z.number(),
  closedPositions: z.number(),
  displayCurrency: currencySchema,
  /** BRL per 1 USD used for the conversion, when a conversion happened. */
  usdBrlRate: z.string().nullable(),
  totalInvested: z.string(),
  totalRealizedPnl: z.string(),
  /** Native-currency subtotals before conversion. */
  totalsByCurrency: z.array(currencyTotalSchema),
  /** Snapshot date (`YYYY-MM-DD`) or `null` for the live portfolio. */
  asOf: z.string().nullable(),
  /** Converted market value of every quoted position. */
  totalMarketValue: z.string(),
  /** Converted cost basis behind `totalMarketValue`, quoted positions only. */
  quotedInvestedCost: z.string(),
  /** `totalMarketValue - quotedInvestedCost`, in the display currency. */
  totalUnrealizedPnl: z.string(),
  /** Open result over the quoted cost basis, `null` when there is no cost. */
  totalUnrealizedPnlPercent: z.string().nullable(),
  /** Open positions with a quote vs without one. */
  quotedPositions: z.number(),
  unquotedPositions: z.number(),
});

export type PortfolioSummary = z.infer<typeof portfolioSummarySchema>;
