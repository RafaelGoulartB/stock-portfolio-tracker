import type {
  AssetClass,
  PortfolioSummary,
  Position,
  TransactionSide,
} from "@portifolio-tracker/shared";
import {
  add,
  type Decimal,
  div,
  formatDecimal,
  isZero,
  mul,
  sub,
  toDecimal,
  ZERO,
} from "../lib/decimal";

export type ConsolidationInput = {
  ticker: string;
  assetClass: AssetClass;
  side: TransactionSide;
  quantity: string;
  price: string;
  fees: string;
  tradedAt: string;
  createdAt: Date;
};

type Accumulator = {
  ticker: string;
  assetClass: AssetClass;
  quantity: Decimal;
  /** Acquisition cost still held, fees included. */
  costBasis: Decimal;
  realizedPnl: Decimal;
  transactionCount: number;
  lastTradedAt: string;
};

const QUANTITY_PLACES = 8;
const MONEY_PLACES = 2;

/** Chronological order; `createdAt` breaks ties inside the same trade day. */
function byTradeOrder(a: ConsolidationInput, b: ConsolidationInput): number {
  if (a.tradedAt !== b.tradedAt) {
    return a.tradedAt < b.tradedAt ? -1 : 1;
  }

  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Consolidates a transaction log into one position per ticker using the
 * moving average cost method: buys raise the average price, sells release
 * cost at the current average and realize the difference as P&L.
 */
export function consolidatePositions(
  input: readonly ConsolidationInput[],
): Position[] {
  const byTicker = new Map<string, Accumulator>();

  for (const entry of [...input].sort(byTradeOrder)) {
    const quantity = toDecimal(entry.quantity);
    const price = toDecimal(entry.price);
    const fees = toDecimal(entry.fees);

    const current: Accumulator = byTicker.get(entry.ticker) ?? {
      ticker: entry.ticker,
      assetClass: entry.assetClass,
      quantity: ZERO,
      costBasis: ZERO,
      realizedPnl: ZERO,
      transactionCount: 0,
      lastTradedAt: entry.tradedAt,
    };

    current.assetClass = entry.assetClass;
    current.transactionCount += 1;
    current.lastTradedAt = entry.tradedAt;

    if (entry.side === "buy") {
      current.quantity = add(current.quantity, quantity);
      current.costBasis = add(
        current.costBasis,
        add(mul(quantity, price), fees),
      );
    } else {
      const sold = current.quantity > quantity ? quantity : current.quantity;
      const releasedCost = isZero(current.quantity)
        ? ZERO
        : div(mul(current.costBasis, sold), current.quantity);
      const proceeds = sub(mul(quantity, price), fees);

      current.realizedPnl = add(
        current.realizedPnl,
        sub(proceeds, releasedCost),
      );
      current.quantity = sub(current.quantity, quantity);
      current.costBasis = sub(current.costBasis, releasedCost);

      if (current.quantity <= ZERO) {
        current.quantity = ZERO;
        current.costBasis = ZERO;
      }
    }

    byTicker.set(entry.ticker, current);
  }

  return [...byTicker.values()]
    .map((position) => ({
      ticker: position.ticker,
      assetClass: position.assetClass,
      quantity: formatDecimal(position.quantity, QUANTITY_PLACES),
      averagePrice: formatDecimal(
        isZero(position.quantity)
          ? ZERO
          : div(position.costBasis, position.quantity),
        MONEY_PLACES,
      ),
      investedCost: formatDecimal(position.costBasis, MONEY_PLACES),
      realizedPnl: formatDecimal(position.realizedPnl, MONEY_PLACES),
      transactionCount: position.transactionCount,
      lastTradedAt: position.lastTradedAt,
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function summarizePositions(
  positions: readonly Position[],
): PortfolioSummary {
  let totalInvested = ZERO;
  let totalRealizedPnl = ZERO;
  let openPositions = 0;

  for (const position of positions) {
    totalInvested = add(totalInvested, toDecimal(position.investedCost));
    totalRealizedPnl = add(totalRealizedPnl, toDecimal(position.realizedPnl));

    if (!isZero(toDecimal(position.quantity))) {
      openPositions += 1;
    }
  }

  return {
    openPositions,
    closedPositions: positions.length - openPositions,
    totalInvested: formatDecimal(totalInvested, MONEY_PLACES),
    totalRealizedPnl: formatDecimal(totalRealizedPnl, MONEY_PLACES),
  };
}

/** Quantity available to sell for a ticker, as a decimal string. */
export function availableQuantity(
  input: readonly ConsolidationInput[],
  ticker: string,
): string {
  const position = consolidatePositions(input).find(
    (item) => item.ticker === ticker,
  );

  return position?.quantity ?? "0";
}
