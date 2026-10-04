import { z } from "zod";
import { transactionBrokerNoteSchema } from "./broker-note-formats";
import { type Currency, currencySchema, DEFAULT_CURRENCY } from "./currency";
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

/**
 * Monthly gross sales of Brazilian stocks below which capital gains are
 * exempt from income tax (Lei 11.033/2004, art. 3º, I). FIIs, ETFs and
 * BDRs do not qualify.
 */
export const BR_STOCK_SALE_EXEMPTION_BRL = "20000";
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

/** Classes that trade on B3 in whole units when held in BRL. */
const B3_WHOLE_UNIT_CLASSES: ReadonlySet<AssetClass> = new Set([
  "stock_br",
  "reit",
  "etf",
  "bdr",
]);

/**
 * True when a suggested buy must be a whole number of units. B3 has no
 * fractional shares below one unit; US brokers and crypto do.
 */
export function tradesInWholeUnits(
  assetClass: AssetClass,
  currency: Currency,
): boolean {
  return currency === "BRL" && B3_WHOLE_UNIT_CLASSES.has(assetClass);
}

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
    value: optionalPositiveDecimal,
    fees: nonNegativeDecimal.optional(),
    tradedAt: isoDate,
    /**
     * BRL per 1 USD on the trade date. Omitted means the API resolves the
     * BCB PTAX of `tradedAt`; an explicit value (a broker's rate) wins.
     */
    usdBrlRate: optionalPositiveDecimal,
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

/** Replaces every user-entered field of one trade; the row keeps its id. */
export const updateTransactionInput = z.object({
  id: z.uuid(),
  trade: createTransactionInput,
});

export type UpdateTransactionInput = z.input<typeof updateTransactionInput>;

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
  /** BRL per 1 USD on the trade date, `null` while unresolved. */
  usdBrlRate: z.string().nullable(),
  notes: z.string().nullable(),
  total: z.string(),
  /**
   * The broker note this trade was imported from. Such a trade can only be
   * removed together with its note.
   */
  brokerNote: transactionBrokerNoteSchema.nullable(),
});

export type Transaction = z.infer<typeof transactionSchema>;

/**
 * Trades whose trade-date USD/BRL is still missing, by native currency. A
 * missing rate only matters when the display currency differs from it.
 */
export const tradeFxStatusSchema = z.object({
  missing: z.number().int(),
  missingByCurrency: z.record(currencySchema, z.number().int()),
});

export type TradeFxStatus = z.infer<typeof tradeFxStatusSchema>;

export const tradeFxBackfillSchema = z.object({
  updated: z.number().int(),
  /** Trades the provider still had no rate for. */
  missing: z.number().int(),
});

export type TradeFxBackfill = z.infer<typeof tradeFxBackfillSchema>;

/** A bounded, stable page of the account transaction history. */
export const transactionListInput = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(100),
  /** Case-insensitive ticker substring; blank lists every trade. */
  ticker: z.string().trim().toUpperCase().max(120).optional(),
  /** Only buys or only sells; omitted lists both. */
  side: transactionSideSchema.optional(),
  assetClass: assetClassSchema.optional(),
});

export const transactionListSchema = z.object({
  items: z.array(transactionSchema),
  total: z.number().int().nonnegative(),
  /** Buys and sells among the filtered trades, across every page. */
  sides: z.object({
    buy: z.number().int().nonnegative(),
    sell: z.number().int().nonnegative(),
  }),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
});

export type TransactionList = z.infer<typeof transactionListSchema>;

export const tickerLedgerInput = z.object({ ticker: tickerSchema });

export const tickerLedgerTradeSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  assetClass: assetClassSchema,
  currency: currencySchema,
  side: transactionSideSchema,
  /** In today's share units when {@link splitAdjusted}. */
  quantity: z.string(),
  price: z.string(),
  splitAdjusted: z.boolean(),
  fees: z.string(),
  total: z.string(),
  tradedAt: z.string(),
  usdBrlRate: z.string().nullable(),
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
  /**
   * Same amounts in the display currency. Cross-currency trades convert at
   * their own trade-date USD/BRL, so cost and realized results carry the FX
   * of each purchase; trades still missing that rate use the consolidation
   * rate instead.
   */
  convertedAveragePrice: z.string(),
  convertedInvestedCost: z.string(),
  convertedRealizedPnl: z.string(),
  /** Trades of this position converted at the consolidation-rate fallback. */
  tradesMissingFx: z.number().int(),
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
  /**
   * Part of {@link convertedUnrealizedPnl} caused by USD/BRL moving since the
   * purchases: cost at today's rate minus cost at trade-date rates. `null`
   * for same-currency positions or without a quote.
   */
  convertedFxPnl: z.string().nullable(),
  /**
   * Native open result over native invested cost (`0.1` = +10%): the
   * asset's own move, without FX.
   */
  unrealizedPnlPercent: z.string().nullable(),
  /**
   * Display-currency open result over display-currency cost at trade-date
   * FX, so the percent matches {@link convertedUnrealizedPnl}.
   */
  convertedUnrealizedPnlPercent: z.string().nullable(),
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
