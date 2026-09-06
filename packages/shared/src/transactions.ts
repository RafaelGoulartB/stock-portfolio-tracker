import { z } from "zod";
import { isoDate, nonNegativeDecimal, positiveDecimal } from "./decimal";

export const TRANSACTION_SIDES = ["buy", "sell"] as const;
export const transactionSideSchema = z.enum(TRANSACTION_SIDES);
export type TransactionSide = z.infer<typeof transactionSideSchema>;

export const ASSET_CLASSES = [
  "stock",
  "reit",
  "etf",
  "bdr",
  "crypto",
  "fixed_income",
  "other",
] as const;
export const assetClassSchema = z.enum(ASSET_CLASSES);
export type AssetClass = z.infer<typeof assetClassSchema>;

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  stock: "Stock",
  reit: "REIT",
  etf: "ETF",
  bdr: "BDR",
  crypto: "Crypto",
  fixed_income: "Fixed income",
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
  .max(16, "Use at most 16 characters")
  .regex(/^[A-Z0-9][A-Z0-9.-]*$/, "Use letters, digits, dots or hyphens");

export const createTransactionInput = z.object({
  ticker: tickerSchema,
  assetClass: assetClassSchema,
  side: transactionSideSchema,
  quantity: positiveDecimal,
  price: positiveDecimal,
  fees: nonNegativeDecimal.default("0"),
  tradedAt: isoDate,
  notes: z.string().trim().max(280, "Use at most 280 characters").optional(),
});

export type CreateTransactionInput = z.input<typeof createTransactionInput>;

export const deleteTransactionInput = z.object({ id: z.uuid() });

export const transactionSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  assetClass: assetClassSchema,
  side: transactionSideSchema,
  quantity: z.string(),
  price: z.string(),
  fees: z.string(),
  tradedAt: z.string(),
  notes: z.string().nullable(),
  total: z.string(),
});

export type Transaction = z.infer<typeof transactionSchema>;

export const positionSchema = z.object({
  ticker: z.string(),
  assetClass: assetClassSchema,
  quantity: z.string(),
  averagePrice: z.string(),
  investedCost: z.string(),
  realizedPnl: z.string(),
  transactionCount: z.number(),
  lastTradedAt: z.string(),
});

export type Position = z.infer<typeof positionSchema>;

export const portfolioSummarySchema = z.object({
  openPositions: z.number(),
  closedPositions: z.number(),
  totalInvested: z.string(),
  totalRealizedPnl: z.string(),
});

export type PortfolioSummary = z.infer<typeof portfolioSummarySchema>;
