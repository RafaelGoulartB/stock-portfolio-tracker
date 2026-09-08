import type {
  AssetClass,
  Currency,
  CurrencyTotal,
  PortfolioSummary,
  Position,
  TransactionSide,
  ValuedPosition,
} from "@portifolio-tracker/shared";
import { CASH_TICKER } from "@portifolio-tracker/shared";
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
/** Ratios (returns, weights) keep more digits than money. */
const RATE_PLACES = 6;
/**
 * Open result over the portfolio's return-eligible invested cost. The result
 * is the percentage-point contribution of one asset to the portfolio return.
 */
export function portfolioReturnContribution(
  convertedUnrealizedPnl: string | null,
  portfolioInvestedCost: string,
): string | null {
  const invested = toDecimal(portfolioInvestedCost);

  return convertedUnrealizedPnl == null || isZero(invested)
    ? null
    : formatDecimal(
        div(toDecimal(convertedUnrealizedPnl), invested),
        RATE_PLACES,
      );
}

/** Builds the quote-free live position representing the account's BRL cash. */
export function cashPosition(
  amountBrl: string,
  displayCurrency: Currency,
  usdBrlRate: string | null,
): ValuedPosition {
  if (displayCurrency === "USD" && usdBrlRate === null) {
    throw new Error("An USD/BRL rate is required to convert cash");
  }

  const converted = convertMoney(
    amountBrl,
    "BRL",
    displayCurrency,
    usdBrlRate ?? "1",
  );
  const nativeAmount = formatDecimal(toDecimal(amountBrl), MONEY_PLACES);

  return {
    ticker: CASH_TICKER,
    assetClass: "cash",
    currency: "BRL",
    quantity: "1.00000000",
    averagePrice: nativeAmount,
    investedCost: nativeAmount,
    realizedPnl: "0.00",
    transactionCount: 0,
    lastTradedAt: "",
    displayCurrency,
    convertedAveragePrice: converted,
    convertedInvestedCost: converted,
    convertedRealizedPnl: "0.00",
    marketPrice: nativeAmount,
    marketValue: nativeAmount,
    convertedMarketValue: converted,
    unrealizedPnl: "0.00",
    convertedUnrealizedPnl: "0.00",
    unrealizedPnlPercent: "0.000000",
    weight: null,
    quoteAsOf: null,
    quoteMissing: false,
  };
}

/** Appends cash and recomputes every live weight against total net worth. */
export function withCashPosition(
  positions: readonly ValuedPosition[],
  amountBrl: string,
  displayCurrency: Currency,
  usdBrlRate: string | null,
): ValuedPosition[] {
  const result = [
    ...positions
      .filter(
        (position) =>
          position.ticker !== CASH_TICKER && position.assetClass !== "cash",
      )
      .map((position) => ({ ...position })),
    cashPosition(amountBrl, displayCurrency, usdBrlRate),
  ];
  const total = result.reduce(
    (sum, position) =>
      position.convertedMarketValue === null
        ? sum
        : add(sum, toDecimal(position.convertedMarketValue)),
    ZERO,
  );

  for (const position of result) {
    position.weight =
      position.convertedMarketValue === null || isZero(total)
        ? "0.00000000"
        : formatDecimal(
            div(toDecimal(position.convertedMarketValue), total),
            WEIGHT_PLACES,
          );
  }

  return result;
}

export type TickerLedgerEntry = ConsolidationInput & {
  id: string;
  notes: string | null;
};

export type TickerLedgerTrade = {
  id: string;
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  side: TransactionSide;
  quantity: string;
  price: string;
  fees: string;
  total: string;
  tradedAt: string;
  notes: string | null;
  /** Realized P&L of this sell at the then-current moving average. Null on buys. */
  realizedPnl: string | null;
  quantityAfter: string;
  averagePriceAfter: string;
};

export type TickerLedger = {
  ticker: string;
  currency: Currency | null;
  trades: TickerLedgerTrade[];
  buyCount: number;
  sellCount: number;
  buyQuantity: string;
  sellQuantity: string;
  buyTotal: string;
  sellTotal: string;
  realizedPnl: string;
  investedCost: string;
  quantity: string;
  averagePrice: string;
};

/** Chronological order; `createdAt` breaks ties inside the same trade day. */
function byTradeOrder(a: ConsolidationInput, b: ConsolidationInput): number {
  if (a.tradedAt !== b.tradedAt) {
    return a.tradedAt < b.tradedAt ? -1 : 1;
  }

  return a.createdAt.getTime() - b.createdAt.getTime();
}

function emptyAccumulator(entry: ConsolidationInput): Accumulator {
  return {
    ticker: entry.ticker,
    assetClass: entry.assetClass,
    currency: entry.currency,
    quantity: ZERO,
    costBasis: ZERO,
    realizedPnl: ZERO,
    transactionCount: 0,
    lastTradedAt: entry.tradedAt,
  };
}

function averagePriceOf(position: Accumulator): Decimal {
  return isZero(position.quantity)
    ? ZERO
    : div(position.costBasis, position.quantity);
}

/**
 * Cash moved by the trade: fees increase a buy and reduce a sell. Always
 * two decimal places — this is the amount that hit the brokerage.
 */
export function tradeCashTotal(entry: {
  side: TransactionSide;
  quantity: string;
  price: string;
  fees: string;
}): string {
  const gross = mul(toDecimal(entry.quantity), toDecimal(entry.price));
  const fees = toDecimal(entry.fees);

  return formatDecimal(
    entry.side === "buy" ? add(gross, fees) : sub(gross, fees),
    MONEY_PLACES,
  );
}

/**
 * Applies one trade to the running average. Returns the realized P&L of
 * this trade (`ZERO` on a buy).
 */
function applyTrade(current: Accumulator, entry: ConsolidationInput): Decimal {
  const quantity = toDecimal(entry.quantity);
  const price = toDecimal(entry.price);
  const fees = toDecimal(entry.fees);

  current.assetClass = entry.assetClass;
  current.transactionCount += 1;
  current.lastTradedAt = entry.tradedAt;

  if (entry.side === "buy") {
    current.quantity = add(current.quantity, quantity);
    current.costBasis = add(current.costBasis, add(mul(quantity, price), fees));

    return ZERO;
  }

  const sold = current.quantity > quantity ? quantity : current.quantity;
  const releasedCost = isZero(current.quantity)
    ? ZERO
    : div(mul(current.costBasis, sold), current.quantity);
  const proceeds = sub(mul(quantity, price), fees);
  const realized = sub(proceeds, releasedCost);

  current.realizedPnl = add(current.realizedPnl, realized);
  current.quantity = sub(current.quantity, quantity);
  current.costBasis = sub(current.costBasis, releasedCost);

  if (current.quantity <= ZERO) {
    current.quantity = ZERO;
    current.costBasis = ZERO;
  }

  return realized;
}

type ConsolidatedPosition = Omit<
  Position,
  | "displayCurrency"
  | "convertedAveragePrice"
  | "convertedInvestedCost"
  | "convertedRealizedPnl"
>;

/**
 * The trade log already arrives ordered from SQL, so the common case only
 * pays an O(n) check instead of copying and re-sorting the whole ledger.
 */
function inTradeOrder(
  input: readonly ConsolidationInput[],
): readonly ConsolidationInput[] {
  for (let index = 1; index < input.length; index += 1) {
    if (byTradeOrder(input[index - 1], input[index]) > 0) {
      return [...input].sort(byTradeOrder);
    }
  }

  return input;
}

/** Turns running accumulators into the sorted, formatted position list. */
function projectPositions(
  accumulators: Iterable<Accumulator>,
): ConsolidatedPosition[] {
  return [...accumulators]
    .map((position) => ({
      ticker: position.ticker,
      assetClass: position.assetClass,
      currency: position.currency,
      quantity: formatDecimal(position.quantity, QUANTITY_PLACES),
      averagePrice: formatDecimal(averagePriceOf(position), MONEY_PLACES),
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
): ConsolidatedPosition[] {
  const byKey = new Map<string, Accumulator>();

  for (const entry of inTradeOrder(input)) {
    const key = `${entry.ticker}|${entry.currency}`;
    const current = byKey.get(key) ?? emptyAccumulator(entry);
    applyTrade(current, entry);
    byKey.set(key, current);
  }

  return projectPositions(byKey.values());
}

/**
 * Consolidated positions as they stood at each of `asOfDates`, which must be
 * ascending. The ledger is walked once and every cut-off reads the running
 * accumulators, instead of re-consolidating the whole history per date.
 *
 * Equivalent to calling {@link consolidatePositions} on
 * {@link filterTransactionsByAsOf} for each date: filtering by `tradedAt` is
 * exactly a prefix of the trade-ordered ledger, because trade order is keyed
 * on `tradedAt` first.
 */
export function consolidatePositionsAtEach(
  input: readonly ConsolidationInput[],
  asOfDates: readonly string[],
): ConsolidatedPosition[][] {
  const ordered = inTradeOrder(input);
  const byKey = new Map<string, Accumulator>();
  const snapshots: ConsolidatedPosition[][] = [];
  let index = 0;

  for (const asOf of asOfDates) {
    while (index < ordered.length) {
      const entry = ordered[index];

      if (entry.tradedAt > asOf) {
        break;
      }

      const key = `${entry.ticker}|${entry.currency}`;
      const current = byKey.get(key) ?? emptyAccumulator(entry);
      applyTrade(current, entry);
      byKey.set(key, current);
      index += 1;
    }

    snapshots.push(projectPositions(byKey.values()));
  }

  return snapshots;
}

/**
 * Walks one ticker's trades in order and emits the moving-average ledger:
 * running quantity, average after each fill, and realized P&L on sells.
 * Newest trade first so the detail screen reads like a history.
 */
export function buildTickerLedger(
  ticker: string,
  input: readonly TickerLedgerEntry[],
): TickerLedger {
  const rows = input
    .filter((entry) => entry.ticker === ticker)
    .sort(byTradeOrder);
  const empty: TickerLedger = {
    ticker,
    currency: null,
    trades: [],
    buyCount: 0,
    sellCount: 0,
    buyQuantity: formatDecimal(ZERO, QUANTITY_PLACES),
    sellQuantity: formatDecimal(ZERO, QUANTITY_PLACES),
    buyTotal: formatDecimal(ZERO, MONEY_PLACES),
    sellTotal: formatDecimal(ZERO, MONEY_PLACES),
    realizedPnl: formatDecimal(ZERO, MONEY_PLACES),
    investedCost: formatDecimal(ZERO, MONEY_PLACES),
    quantity: formatDecimal(ZERO, QUANTITY_PLACES),
    averagePrice: formatDecimal(ZERO, MONEY_PLACES),
  };

  if (rows.length === 0) {
    return empty;
  }

  const first = rows[0];

  if (!first) {
    return empty;
  }

  const current = emptyAccumulator(first);
  const trades: TickerLedgerTrade[] = [];
  let buyCount = 0;
  let sellCount = 0;
  let buyQuantity = ZERO;
  let sellQuantity = ZERO;
  let buyTotal = ZERO;
  let sellTotal = ZERO;

  for (const entry of rows) {
    const realized = applyTrade(current, entry);
    const cash = toDecimal(tradeCashTotal(entry));

    if (entry.side === "buy") {
      buyCount += 1;
      buyQuantity = add(buyQuantity, toDecimal(entry.quantity));
      buyTotal = add(buyTotal, cash);
    } else {
      sellCount += 1;
      sellQuantity = add(sellQuantity, toDecimal(entry.quantity));
      sellTotal = add(sellTotal, cash);
    }

    trades.push({
      id: entry.id,
      ticker: entry.ticker,
      assetClass: current.assetClass,
      currency: entry.currency,
      side: entry.side,
      quantity: entry.quantity,
      price: entry.price,
      fees: entry.fees,
      total: tradeCashTotal(entry),
      tradedAt: entry.tradedAt,
      notes: entry.notes,
      realizedPnl:
        entry.side === "sell" ? formatDecimal(realized, MONEY_PLACES) : null,
      quantityAfter: formatDecimal(current.quantity, QUANTITY_PLACES),
      averagePriceAfter: formatDecimal(averagePriceOf(current), MONEY_PLACES),
    });
  }

  trades.reverse();

  return {
    ticker,
    currency: current.currency,
    trades,
    buyCount,
    sellCount,
    buyQuantity: formatDecimal(buyQuantity, QUANTITY_PLACES),
    sellQuantity: formatDecimal(sellQuantity, QUANTITY_PLACES),
    buyTotal: formatDecimal(buyTotal, MONEY_PLACES),
    sellTotal: formatDecimal(sellTotal, MONEY_PLACES),
    realizedPnl: formatDecimal(current.realizedPnl, MONEY_PLACES),
    investedCost: formatDecimal(current.costBasis, MONEY_PLACES),
    quantity: formatDecimal(current.quantity, QUANTITY_PLACES),
    averagePrice: formatDecimal(averagePriceOf(current), MONEY_PLACES),
  };
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
  let quotedInvestedCost = ZERO;
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
        // Fixed income is a user-maintained balance, not a quoted investment.
        // Its value belongs to the portfolio total, but never to a calculated
        // return or cost-basis comparison. Cash carries equal cost and market
        // value, so it belongs in the return base with a zero result.
        if (position.assetClass !== "fixed_income") {
          quotedInvestedCost = add(
            quotedInvestedCost,
            toDecimal(position.convertedInvestedCost),
          );
        }
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

  const returnEligibleMarketValue = positions.reduce((total, position) => {
    if (
      position.assetClass === "fixed_income" ||
      !("convertedMarketValue" in position) ||
      position.convertedMarketValue === null
    ) {
      return total;
    }

    return add(total, toDecimal(position.convertedMarketValue));
  }, ZERO);
  const totalUnrealizedPnl = sub(returnEligibleMarketValue, quotedInvestedCost);

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
    quotedInvestedCost: formatDecimal(quotedInvestedCost, MONEY_PLACES),
    totalUnrealizedPnl: formatDecimal(totalUnrealizedPnl, MONEY_PLACES),
    totalUnrealizedPnlPercent: isZero(quotedInvestedCost)
      ? null
      : formatDecimal(div(totalUnrealizedPnl, quotedInvestedCost), RATE_PLACES),
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
        unrealizedPnl: null,
        convertedUnrealizedPnl: null,
        unrealizedPnlPercent: null,
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
        unrealizedPnl: null,
        convertedUnrealizedPnl: null,
        unrealizedPnlPercent: null,
        weight: null,
        quoteAsOf: null,
        quoteMissing: true,
      };
    }

    const marketValue = formatDecimal(
      mul(toDecimal(position.quantity), toDecimal(quote.price)),
      MONEY_PLACES,
    );
    const investedCost = toDecimal(position.investedCost);
    const isManualFixedIncome = position.assetClass === "fixed_income";
    const unrealizedPnl = sub(toDecimal(marketValue), investedCost);

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
      unrealizedPnl: isManualFixedIncome
        ? null
        : formatDecimal(unrealizedPnl, MONEY_PLACES),
      convertedUnrealizedPnl: isManualFixedIncome
        ? null
        : convertMoney(
            formatDecimal(unrealizedPnl, MONEY_PLACES),
            position.currency,
            displayCurrency,
            usdBrlRate ?? "1",
          ),
      // Both amounts share the native currency, so the ratio needs no rate.
      unrealizedPnlPercent:
        isManualFixedIncome || isZero(investedCost)
          ? null
          : formatDecimal(div(unrealizedPnl, investedCost), RATE_PLACES),
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

/**
 * Returns the balance immediately before the first invalid sale, if any.
 * A final net balance is insufficient: a backdated sale cannot be covered by
 * a buy that happens later in the ledger.
 */
export function availableBeforeOversell(
  input: readonly ConsolidationInput[],
  ticker: string,
): string | null {
  let quantity = ZERO;

  for (const entry of [...input].sort(byTradeOrder)) {
    if (entry.ticker !== ticker) {
      continue;
    }

    const amount = toDecimal(entry.quantity);

    if (entry.side === "sell") {
      if (amount > quantity) {
        return formatDecimal(quantity, QUANTITY_PLACES);
      }

      quantity = sub(quantity, amount);
    } else {
      quantity = add(quantity, amount);
    }
  }

  return null;
}

/** A ledger entry that carries its row id, needed to target one for removal. */
export type IdentifiedEntry = ConsolidationInput & { id: string };

/**
 * Simulates removing the entry with `removeId` from a ticker's ledger and
 * returns the balance immediately before the first sell that removal would
 * leave uncovered, or `null` when the remaining ledger stays valid.
 *
 * Deleting a buy can retroactively oversell a later sell that the buy was
 * covering, so the whole remaining history must be replayed in trade order,
 * not just the net balance. Entries for other tickers are ignored.
 */
export function oversellAfterRemoval(
  history: readonly IdentifiedEntry[],
  ticker: string,
  removeId: string,
): string | null {
  const remaining = history.filter(
    (entry) => entry.id !== removeId && entry.ticker === ticker,
  );

  return availableBeforeOversell(remaining, ticker);
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
