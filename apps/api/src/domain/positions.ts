import type {
  AssetClass,
  Currency,
  CurrencyTotal,
  PortfolioSummary,
  Position,
  TransactionSide,
  ValuedPosition,
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
  currency: Currency;
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
  currency: Currency;
  quantity: Decimal;
  /** Acquisition cost still held, fees included, in the native currency. */
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
 * Consolidates a transaction log into one position per ticker and currency
 * using the moving average cost method: buys raise the average price, sells
 * release cost at the current average and realize the difference as P&L.
 *
 * Each currency is consolidated in isolation so BRL and USD costs are never
 * averaged together. Writes are additionally guarded by a one-currency-per
 * ticker rule, but grouping here stays (ticker, currency) as defense in
 * depth.
 */
export function consolidatePositions(
  input: readonly ConsolidationInput[],
): Omit<
  Position,
  | "displayCurrency"
  | "convertedAveragePrice"
  | "convertedInvestedCost"
  | "convertedRealizedPnl"
>[] {
  const byKey = new Map<string, Accumulator>();

  for (const entry of [...input].sort(byTradeOrder)) {
    const key = `${entry.ticker}|${entry.currency}`;
    const quantity = toDecimal(entry.quantity);
    const price = toDecimal(entry.price);
    const fees = toDecimal(entry.fees);

    const current: Accumulator = byKey.get(key) ?? {
      ticker: entry.ticker,
      assetClass: entry.assetClass,
      currency: entry.currency,
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

    byKey.set(key, current);
  }

  return [...byKey.values()]
    .map((position) => ({
      ticker: position.ticker,
      assetClass: position.assetClass,
      currency: position.currency,
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
    .sort(
      (a, b) =>
        a.ticker.localeCompare(b.ticker) ||
        a.currency.localeCompare(b.currency),
    );
}

/** BRL per 1 USD, as a decimal string. */
export type UsdBrlRate = string;

/**
 * Converts a native-currency amount to the display currency. Amounts already
 * in the display currency pass through untouched.
 */
export function convertMoney(
  value: string,
  from: Currency,
  display: Currency,
  usdBrlRate: UsdBrlRate,
): string {
  if (from === display) {
    return formatDecimal(toDecimal(value), MONEY_PLACES);
  }

  const rate = toDecimal(usdBrlRate);

  if (rate <= ZERO) {
    throw new Error(`Invalid USD/BRL rate: ${usdBrlRate}`);
  }

  const converted =
    from === "USD" ? mul(toDecimal(value), rate) : div(toDecimal(value), rate);

  return formatDecimal(converted, MONEY_PLACES);
}

/**
 * Attaches display-currency amounts to every native position. Realized P&L
 * converts at the current consolidation rate; it is an approximation, not a
 * historical-FX accounting.
 */
export function convertPositions(
  positions: readonly Omit<
    Position,
    | "displayCurrency"
    | "convertedAveragePrice"
    | "convertedInvestedCost"
    | "convertedRealizedPnl"
  >[],
  displayCurrency: Currency,
  usdBrlRate: UsdBrlRate | null,
): Position[] {
  if (
    usdBrlRate === null &&
    positions.some((position) => position.currency !== displayCurrency)
  ) {
    throw new Error(
      "An USD/BRL rate is required to consolidate mixed currencies",
    );
  }

  return positions.map((position) => ({
    ...position,
    displayCurrency,
    convertedAveragePrice: convertMoney(
      position.averagePrice,
      position.currency,
      displayCurrency,
      usdBrlRate ?? "1",
    ),
    convertedInvestedCost: convertMoney(
      position.investedCost,
      position.currency,
      displayCurrency,
      usdBrlRate ?? "1",
    ),
    convertedRealizedPnl: convertMoney(
      position.realizedPnl,
      position.currency,
      displayCurrency,
      usdBrlRate ?? "1",
    ),
  }));
}

export function summarizePositions(
  positions: readonly (Position | ValuedPosition)[],
  displayCurrency: Currency,
  usdBrlRate: UsdBrlRate | null,
  asOf: string | null = null,
): PortfolioSummary {
  let totalInvested = ZERO;
  let totalRealizedPnl = ZERO;
  let totalMarketValue = ZERO;
  let openPositions = 0;
  let quotedPositions = 0;
  let unquotedPositions = 0;
  const byCurrency = new Map<Currency, { invested: Decimal; pnl: Decimal }>();

  for (const position of positions) {
    totalInvested = add(
      totalInvested,
      toDecimal(position.convertedInvestedCost),
    );
    totalRealizedPnl = add(
      totalRealizedPnl,
      toDecimal(position.convertedRealizedPnl),
    );

    const native = byCurrency.get(position.currency) ?? {
      invested: ZERO,
      pnl: ZERO,
    };
    native.invested = add(native.invested, toDecimal(position.investedCost));
    native.pnl = add(native.pnl, toDecimal(position.realizedPnl));
    byCurrency.set(position.currency, native);

    const isOpen = !isZero(toDecimal(position.quantity));

    if (isOpen) {
      openPositions += 1;

      const marketValue =
        "convertedMarketValue" in position
          ? position.convertedMarketValue
          : null;

      if (marketValue != null) {
        totalMarketValue = add(totalMarketValue, toDecimal(marketValue));
        quotedPositions += 1;
      } else {
        unquotedPositions += 1;
      }
    }
  }

  const totalsByCurrency: CurrencyTotal[] = [...byCurrency.entries()]
    .map(([currency, totals]) => ({
      currency,
      investedCost: formatDecimal(totals.invested, MONEY_PLACES),
      realizedPnl: formatDecimal(totals.pnl, MONEY_PLACES),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    openPositions,
    closedPositions: positions.length - openPositions,
    displayCurrency,
    usdBrlRate,
    totalInvested: formatDecimal(totalInvested, MONEY_PLACES),
    totalRealizedPnl: formatDecimal(totalRealizedPnl, MONEY_PLACES),
    totalsByCurrency,
    asOf,
    totalMarketValue: formatDecimal(totalMarketValue, MONEY_PLACES),
    quotedPositions,
    unquotedPositions,
  };
}

/** One resolved market price used to value a ticker. */
export type ValuationQuote = {
  ticker: string;
  /** Native-currency price per unit, as a decimal string. */
  price: string;
  /** Calendar day the quote refers to, `YYYY-MM-DD`. */
  asOf: string;
};

/**
 * Keeps only trades on or before `asOf` (`YYYY-MM-DD`), so consolidating the
 * result yields the portfolio snapshot at that day's close. A `null` date
 * keeps everything (the live portfolio).
 */
export function filterTransactionsByAsOf(
  input: readonly ConsolidationInput[],
  asOf: string | null | undefined,
): ConsolidationInput[] {
  if (asOf == null) {
    return [...input];
  }

  return input.filter((entry) => entry.tradedAt <= asOf);
}

const WEIGHT_PLACES = 8;

/**
 * Attaches market values and allocation weights to converted positions.
 * Tickers without a quote keep `null` market fields and `quoteMissing` so
 * the UI can flag the gap; closed positions carry no market value by
 * definition. Weights are shares of quoted equity (`0`–`1`).
 */
export function valuePositions(
  positions: readonly Position[],
  quotes: ReadonlyMap<string, ValuationQuote>,
  displayCurrency: Currency,
  usdBrlRate: UsdBrlRate | null,
): ValuedPosition[] {
  const valued = positions.map((position): ValuedPosition => {
    if (isZero(toDecimal(position.quantity))) {
      return {
        ...position,
        marketPrice: null,
        marketValue: null,
        convertedMarketValue: null,
        weight: null,
        quoteAsOf: null,
        quoteMissing: false,
      };
    }

    const quote = quotes.get(position.ticker);

    if (!quote) {
      return {
        ...position,
        marketPrice: null,
        marketValue: null,
        convertedMarketValue: null,
        weight: null,
        quoteAsOf: null,
        quoteMissing: true,
      };
    }

    const marketValue = formatDecimal(
      mul(toDecimal(position.quantity), toDecimal(quote.price)),
      MONEY_PLACES,
    );

    return {
      ...position,
      marketPrice: formatDecimal(toDecimal(quote.price), MONEY_PLACES),
      marketValue,
      convertedMarketValue: convertMoney(
        marketValue,
        position.currency,
        displayCurrency,
        usdBrlRate ?? "1",
      ),
      // Weights need the portfolio total first; filled in below.
      weight: null,
      quoteAsOf: quote.asOf,
      quoteMissing: false,
    };
  });

  let total = ZERO;

  for (const position of valued) {
    if (position.convertedMarketValue != null) {
      total = add(total, toDecimal(position.convertedMarketValue));
    }
  }

  if (!isZero(total)) {
    for (const position of valued) {
      if (position.convertedMarketValue != null) {
        position.weight = formatDecimal(
          div(toDecimal(position.convertedMarketValue), total),
          WEIGHT_PLACES,
        );
      }
    }
  }

  return valued;
}

/** Quantity available to sell for a ticker, as a decimal string. */
export function availableQuantity(
  input: readonly ConsolidationInput[],
  ticker: string,
): string {
  let total = ZERO;

  for (const position of consolidatePositions(input)) {
    if (position.ticker === ticker) {
      total = add(total, toDecimal(position.quantity));
    }
  }

  return formatDecimal(total, QUANTITY_PLACES);
}

/** Native currencies already used by a ticker, e.g. to enforce one per ticker. */
export function tickerCurrencies(
  input: readonly ConsolidationInput[],
  ticker: string,
): Currency[] {
  const found = new Set<Currency>();

  for (const entry of input) {
    if (entry.ticker === ticker) {
      found.add(entry.currency);
    }
  }

  return [...found].sort();
}
