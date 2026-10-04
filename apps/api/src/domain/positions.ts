import type {
  AssetClass,
  CorporateActionKind,
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
  /**
   * BRL per 1 USD on the trade date. Omitted or `null` when unresolved; the
   * trade then converts at the consolidation rate.
   */
  usdBrlRate?: string | null;
  /**
   * Units multiplier from splits effective after this trade, as the ratio
   * `to / from`. Omitted means `1`. Only share units scale; the cash of the
   * trade (`quantity × price + fees`) never changes. See {@link adjustForSplits}.
   */
  unitScale?: { to: string; from: string };
};

/**
 * A recorded split or bonus issue: `fromQuantity` old shares become
 * `toQuantity` new ones. Units scale the same way for both; only the income
 * tax ledger reads `unitCost`, the cost a bonus share was attributed.
 */
export type SplitEvent = {
  ticker: string;
  /** First trading day in the new units. */
  effectiveAt: string;
  fromQuantity: string;
  toQuantity: string;
  kind?: CorporateActionKind;
  unitCost?: string | null;
};

/** Share units a trade represents today, after every later split. */
export function effectiveQuantity(entry: {
  quantity: string;
  unitScale?: { to: string; from: string };
}): Decimal {
  const quantity = toDecimal(entry.quantity);

  return entry.unitScale
    ? div(
        mul(quantity, toDecimal(entry.unitScale.to)),
        toDecimal(entry.unitScale.from),
      )
    : quantity;
}

/**
 * Expresses every trade in today's share units: a trade dated before a
 * split's `effectiveAt` has its units multiplied by that split's ratio.
 *
 * Market data providers publish split-adjusted historical closes and
 * dividends, i.e. already in today's units. Scaling the ledger the same way
 * keeps live values, month-end snapshots, dividend entitlements and oversell
 * checks consistent, while cost basis stays the cash actually paid.
 */
export function adjustForSplits<T extends ConsolidationInput>(
  entries: readonly T[],
  splits: readonly SplitEvent[],
): T[] {
  if (splits.length === 0) {
    return [...entries];
  }

  const byTicker = new Map<string, SplitEvent[]>();

  for (const split of splits) {
    const list = byTicker.get(split.ticker) ?? [];
    list.push(split);
    byTicker.set(split.ticker, list);
  }

  return entries.map((entry) => {
    const later = (byTicker.get(entry.ticker) ?? []).filter(
      (split) => split.effectiveAt > entry.tradedAt,
    );

    if (later.length === 0) {
      return entry;
    }

    let to = toDecimal("1");
    let from = toDecimal("1");

    for (const split of later) {
      to = mul(to, toDecimal(split.toQuantity));
      from = mul(from, toDecimal(split.fromQuantity));
    }

    return {
      ...entry,
      unitScale: {
        to: formatDecimal(to, QUANTITY_PLACES),
        from: formatDecimal(from, QUANTITY_PLACES),
      },
    };
  });
}

/**
 * Units of `ticker` held at the end of the day before `day`, in the units of
 * that date: trades as traded, with every split before `day` applied when it
 * happened. `entries` must not be adjusted with {@link adjustForSplits}.
 */
export function unitsHeldBefore(
  entries: readonly ConsolidationInput[],
  splits: readonly SplitEvent[],
  ticker: string,
  day: string,
): Decimal {
  const events = [
    ...entries
      .filter((entry) => entry.ticker === ticker && entry.tradedAt < day)
      .map((entry) => ({ at: entry.tradedAt, order: 1, entry })),
    ...splits
      .filter((split) => split.ticker === ticker && split.effectiveAt < day)
      .map((split) => ({ at: split.effectiveAt, order: 0, split })),
  ].sort((a, b) => (a.at === b.at ? a.order - b.order : a.at < b.at ? -1 : 1));
  let units = ZERO;

  for (const event of events) {
    if ("split" in event) {
      units = div(
        mul(units, toDecimal(event.split.toQuantity)),
        toDecimal(event.split.fromQuantity),
      );
    } else {
      const quantity = toDecimal(event.entry.quantity);
      units =
        event.entry.side === "buy"
          ? add(units, quantity)
          : sub(units, quantity);
    }
  }

  return units;
}

/**
 * Published splits worth offering to the user: effective after the first
 * trade (so the ledger held shares before it) and not recorded yet.
 */
export function pendingSplitSuggestions<T extends { effectiveAt: string }>(
  published: readonly T[],
  recorded: readonly { effectiveAt: string }[],
  firstTradedAt: string | null,
): T[] {
  if (firstTradedAt === null) {
    return [];
  }

  const known = new Set(recorded.map((split) => split.effectiveAt));

  return published
    .filter(
      (split) =>
        split.effectiveAt > firstTradedAt && !known.has(split.effectiveAt),
    )
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
}

type Accumulator = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  quantity: Decimal;
  /** Acquisition cost still held, fees included, in the native currency. */
  costBasis: Decimal;
  realizedPnl: Decimal;
  /**
   * The same moving average kept in the *other* currency (USD for a BRL
   * asset, BRL for a USD asset), each trade converted at its own trade-date
   * rate. Selling releases the same fraction here as in the native ledger.
   */
  fxCost: Decimal;
  fxRealizedPnl: Decimal;
  /**
   * Native-currency share of cost and realized result coming from trades
   * without a trade-date rate. Converted later at the consolidation rate;
   * the split is linear, so releasing a fraction of each bucket on a sale is
   * the same as releasing that fraction of the total.
   */
  unratedCost: Decimal;
  unratedRealizedPnl: Decimal;
  tradesMissingFx: number;
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
    tradesMissingFx: 0,
    marketPrice: nativeAmount,
    marketValue: nativeAmount,
    convertedMarketValue: converted,
    unrealizedPnl: "0.00",
    convertedUnrealizedPnl: "0.00",
    // Cash is a BRL balance, not an FX position: its converted value moves
    // with the rate but carries no trade-date cost to compare against.
    convertedFxPnl: null,
    unrealizedPnlPercent: "0.000000",
    convertedUnrealizedPnlPercent: "0.000000",
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
  /** True when `quantity` and `price` are restated in today's units. */
  splitAdjusted: boolean;
  fees: string;
  total: string;
  tradedAt: string;
  /** BRL per 1 USD on the trade date, `null` while unresolved. */
  usdBrlRate: string | null;
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
    fxCost: ZERO,
    fxRealizedPnl: ZERO,
    unratedCost: ZERO,
    unratedRealizedPnl: ZERO,
    tradesMissingFx: 0,
    transactionCount: 0,
    lastTradedAt: entry.tradedAt,
  };
}

/** Converts a native amount into the other currency at a BRL-per-USD rate. */
function toOtherCurrency(
  amount: Decimal,
  native: Currency,
  rate: Decimal,
): Decimal {
  return native === "USD" ? mul(amount, rate) : div(amount, rate);
}

function tradeRate(entry: ConsolidationInput): Decimal | null {
  if (entry.usdBrlRate == null) return null;
  const rate = toDecimal(entry.usdBrlRate);

  return rate > ZERO ? rate : null;
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
  // Units move in today's share units; money uses the trade as entered.
  const quantity = effectiveQuantity(entry);
  const gross = mul(toDecimal(entry.quantity), toDecimal(entry.price));
  const fees = toDecimal(entry.fees);

  const rate = tradeRate(entry);

  current.assetClass = entry.assetClass;
  current.transactionCount += 1;
  current.lastTradedAt = entry.tradedAt;

  if (rate === null) {
    current.tradesMissingFx += 1;
  }

  if (entry.side === "buy") {
    const cost = add(gross, fees);
    current.quantity = add(current.quantity, quantity);
    current.costBasis = add(current.costBasis, cost);

    if (rate === null) {
      current.unratedCost = add(current.unratedCost, cost);
    } else {
      current.fxCost = add(
        current.fxCost,
        toOtherCurrency(cost, entry.currency, rate),
      );
    }

    return ZERO;
  }

  const sold = current.quantity > quantity ? quantity : current.quantity;
  const release = (bucket: Decimal) =>
    isZero(current.quantity) ? ZERO : div(mul(bucket, sold), current.quantity);
  const releasedCost = release(current.costBasis);
  const releasedFxCost = release(current.fxCost);
  const releasedUnratedCost = release(current.unratedCost);
  const proceeds = sub(gross, fees);
  const realized = sub(proceeds, releasedCost);

  current.realizedPnl = add(current.realizedPnl, realized);
  current.quantity = sub(current.quantity, quantity);
  current.costBasis = sub(current.costBasis, releasedCost);
  current.fxCost = sub(current.fxCost, releasedFxCost);
  current.unratedCost = sub(current.unratedCost, releasedUnratedCost);

  if (rate === null) {
    current.fxRealizedPnl = sub(current.fxRealizedPnl, releasedFxCost);
    current.unratedRealizedPnl = add(
      current.unratedRealizedPnl,
      sub(proceeds, releasedUnratedCost),
    );
  } else {
    current.fxRealizedPnl = add(
      current.fxRealizedPnl,
      sub(toOtherCurrency(proceeds, entry.currency, rate), releasedFxCost),
    );
    current.unratedRealizedPnl = sub(
      current.unratedRealizedPnl,
      releasedUnratedCost,
    );
  }

  if (current.quantity <= ZERO) {
    current.quantity = ZERO;
    current.costBasis = ZERO;
    current.fxCost = ZERO;
    current.unratedCost = ZERO;
  }

  return realized;
}

/**
 * Trade-date FX figures of a consolidated position. Internal to the API:
 * {@link convertPositions} folds them into the display-currency amounts.
 */
export type TradeFxBasis = {
  /** Cost still held in the other currency, rated trades only. */
  fxCost: string;
  fxRealizedPnl: string;
  /** Native cost and realized result of trades without a rate. */
  unratedCost: string;
  unratedRealizedPnl: string;
  tradesMissingFx: number;
};

type ConsolidatedPosition = Omit<
  Position,
  | "displayCurrency"
  | "convertedAveragePrice"
  | "convertedInvestedCost"
  | "convertedRealizedPnl"
  | "tradesMissingFx"
> &
  TradeFxBasis;

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
      fxCost: formatDecimal(position.fxCost, QUANTITY_PLACES),
      fxRealizedPnl: formatDecimal(position.fxRealizedPnl, QUANTITY_PLACES),
      unratedCost: formatDecimal(position.unratedCost, QUANTITY_PLACES),
      unratedRealizedPnl: formatDecimal(
        position.unratedRealizedPnl,
        QUANTITY_PLACES,
      ),
      tradesMissingFx: position.tradesMissingFx,
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
      buyQuantity = add(buyQuantity, effectiveQuantity(entry));
      buyTotal = add(buyTotal, cash);
    } else {
      sellCount += 1;
      sellQuantity = add(sellQuantity, effectiveQuantity(entry));
      sellTotal = add(sellTotal, cash);
    }

    trades.push({
      id: entry.id,
      ticker: entry.ticker,
      assetClass: current.assetClass,
      currency: entry.currency,
      side: entry.side,
      // In today's units, like the average after it; the cash is unchanged.
      quantity: formatDecimal(effectiveQuantity(entry), QUANTITY_PLACES),
      price: entry.unitScale
        ? formatDecimal(
            div(
              mul(toDecimal(entry.price), toDecimal(entry.unitScale.from)),
              toDecimal(entry.unitScale.to),
            ),
            QUANTITY_PLACES,
          )
        : entry.price,
      splitAdjusted: entry.unitScale !== undefined,
      fees: entry.fees,
      total: tradeCashTotal(entry),
      tradedAt: entry.tradedAt,
      usdBrlRate: entry.usdBrlRate ?? null,
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
 * Display-currency cost basis and realized result of one consolidated
 * position. The native currency passes through; the other currency reads
 * the trade-date FX ledger and converts only unrated trades at `usdBrlRate`.
 */
export function convertedCostBasis(
  position: Pick<
    ConsolidatedPosition,
    "currency" | "investedCost" | "realizedPnl"
  > &
    TradeFxBasis,
  displayCurrency: Currency,
  usdBrlRate: UsdBrlRate | null,
): { investedCost: Decimal; realizedPnl: Decimal } {
  if (position.currency === displayCurrency) {
    return {
      investedCost: toDecimal(position.investedCost),
      realizedPnl: toDecimal(position.realizedPnl),
    };
  }

  const unratedCost = toDecimal(position.unratedCost);
  const unratedRealizedPnl = toDecimal(position.unratedRealizedPnl);
  let investedCost = toDecimal(position.fxCost);
  let realizedPnl = toDecimal(position.fxRealizedPnl);

  if (!isZero(unratedCost) || !isZero(unratedRealizedPnl)) {
    if (usdBrlRate === null) {
      throw new Error(
        "An USD/BRL rate is required to convert trades without a trade-date rate",
      );
    }

    const rate = toDecimal(usdBrlRate);

    if (rate <= ZERO) {
      throw new Error(`Invalid USD/BRL rate: ${usdBrlRate}`);
    }

    investedCost = add(
      investedCost,
      toOtherCurrency(unratedCost, position.currency, rate),
    );
    realizedPnl = add(
      realizedPnl,
      toOtherCurrency(unratedRealizedPnl, position.currency, rate),
    );
  }

  return { investedCost, realizedPnl };
}

/**
 * Attaches display-currency amounts to every native position. Cost and
 * realized results of cross-currency trades use each trade's own USD/BRL, so
 * the open result in the display currency includes the FX move since each
 * purchase. Trades without that rate fall back to the consolidation rate
 * and are counted in `tradesMissingFx`.
 */
export function convertPositions(
  positions: readonly ConsolidatedPosition[],
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

  return positions.map((consolidated) => {
    const {
      fxCost: _fxCost,
      fxRealizedPnl: _fxRealizedPnl,
      unratedCost: _unratedCost,
      unratedRealizedPnl: _unratedRealizedPnl,
      tradesMissingFx,
      ...position
    } = consolidated;
    const basis = convertedCostBasis(consolidated, displayCurrency, usdBrlRate);
    const quantity = toDecimal(position.quantity);

    return {
      ...position,
      displayCurrency,
      convertedAveragePrice: formatDecimal(
        isZero(quantity) ? ZERO : div(basis.investedCost, quantity),
        MONEY_PLACES,
      ),
      convertedInvestedCost: formatDecimal(basis.investedCost, MONEY_PLACES),
      convertedRealizedPnl: formatDecimal(basis.realizedPnl, MONEY_PLACES),
      tradesMissingFx:
        position.currency === displayCurrency ? 0 : tradesMissingFx,
    };
  });
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

/** True when the ledger still holds a live quantity of the ticker. */
export function isOpenQuantity(quantity: string): boolean {
  return toDecimal(quantity) > ZERO;
}

/** One resolved market price used to value a ticker. */
export type ValuationQuote = {
  ticker: string;
  /** Native-currency price per unit, as a decimal string. */
  price: string;
  /** Calendar day the quote refers to, `YYYY-MM-DD`. */
  asOf: string;
  previousClose?: string;
  previousCloseAsOf?: string;
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
        convertedFxPnl: null,
        unrealizedPnlPercent: null,
        convertedUnrealizedPnlPercent: null,
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
        convertedFxPnl: null,
        unrealizedPnlPercent: null,
        convertedUnrealizedPnlPercent: null,
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
    const convertedMarketValue = convertMoney(
      marketValue,
      position.currency,
      displayCurrency,
      usdBrlRate ?? "1",
    );
    const convertedInvestedCost = toDecimal(position.convertedInvestedCost);
    // Market value at today's rate against cost at each trade's own rate:
    // the FX move since the purchases is part of the display-currency result.
    const convertedUnrealizedPnl = sub(
      toDecimal(convertedMarketValue),
      convertedInvestedCost,
    );
    const crossCurrency = position.currency !== displayCurrency;

    return {
      ...position,
      marketPrice: formatDecimal(toDecimal(quote.price), MONEY_PLACES),
      marketValue,
      convertedMarketValue,
      unrealizedPnl: isManualFixedIncome
        ? null
        : formatDecimal(unrealizedPnl, MONEY_PLACES),
      convertedUnrealizedPnl: isManualFixedIncome
        ? null
        : formatDecimal(convertedUnrealizedPnl, MONEY_PLACES),
      // Cost at today's rate minus cost at the trade-date rates.
      convertedFxPnl:
        isManualFixedIncome || !crossCurrency
          ? null
          : formatDecimal(
              sub(
                toDecimal(
                  convertMoney(
                    position.investedCost,
                    position.currency,
                    displayCurrency,
                    usdBrlRate ?? "1",
                  ),
                ),
                convertedInvestedCost,
              ),
              MONEY_PLACES,
            ),
      // Both amounts share the native currency, so the ratio needs no rate.
      unrealizedPnlPercent:
        isManualFixedIncome || isZero(investedCost)
          ? null
          : formatDecimal(div(unrealizedPnl, investedCost), RATE_PLACES),
      convertedUnrealizedPnlPercent:
        isManualFixedIncome || isZero(convertedInvestedCost)
          ? null
          : formatDecimal(
              div(convertedUnrealizedPnl, convertedInvestedCost),
              RATE_PLACES,
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

/**
 * How concentrated the invested book is. Cash is left out: it is a balance
 * waiting to be invested, not a position that can dominate the result.
 * Weights here are shares of the invested (non-cash, quoted) value.
 */
export type PortfolioConcentration = {
  positions: number;
  largest: { ticker: string; weight: string };
  /** Combined weight of the five and ten largest positions. */
  top5Weight: string;
  top10Weight: string;
  /**
   * `1 / Σ w²`: the number of equal-weight positions with the same
   * concentration. 20 holdings with an effective count of 8 behave like 8.
   */
  effectivePositions: string;
  /** Fewest largest positions that together hold at least half the value. */
  halfOfValueIn: number;
};

export function positionConcentration(
  positions: readonly ValuedPosition[],
): PortfolioConcentration | null {
  const invested = positions
    .filter(
      (position) =>
        position.assetClass !== "cash" &&
        position.convertedMarketValue != null &&
        toDecimal(position.convertedMarketValue) > ZERO,
    )
    .map((position) => ({
      ticker: position.ticker,
      value: toDecimal(position.convertedMarketValue ?? "0"),
    }))
    .sort((a, b) => (a.value === b.value ? 0 : a.value > b.value ? -1 : 1));

  let total = ZERO;

  for (const entry of invested) {
    total = add(total, entry.value);
  }

  const [first] = invested;

  if (!first || isZero(total)) {
    return null;
  }

  const weights = invested.map((entry) => div(entry.value, total));
  const half = toDecimal("0.5");
  let squares = ZERO;
  let cumulative = ZERO;
  let halfOfValueIn = 0;
  let top5 = ZERO;
  let top10 = ZERO;

  for (const [index, weight] of weights.entries()) {
    squares = add(squares, mul(weight, weight));
    cumulative = add(cumulative, weight);

    if (index < 5) {
      top5 = cumulative;
    }

    if (index < 10) {
      top10 = cumulative;
    }

    if (halfOfValueIn === 0 && cumulative >= half) {
      halfOfValueIn = index + 1;
    }
  }

  return {
    positions: invested.length,
    largest: {
      ticker: first.ticker,
      weight: formatDecimal(weights[0], WEIGHT_PLACES),
    },
    top5Weight: formatDecimal(top5, WEIGHT_PLACES),
    top10Weight: formatDecimal(top10, WEIGHT_PLACES),
    effectivePositions: formatDecimal(div(toDecimal("1"), squares), 2),
    halfOfValueIn,
  };
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

    const amount = effectiveQuantity(entry);

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
  splits: readonly SplitEvent[] = [],
): string | null {
  const remaining = history.filter(
    (entry) => entry.id !== removeId && entry.ticker === ticker,
  );

  return availableBeforeOversell(adjustForSplits(remaining, splits), ticker);
}

/**
 * Simulates replacing the entry with `replaceId` and replays every ticker the
 * edit touches (the old one and, when renamed, the new one). Returns the
 * first ticker whose history would sell more than it holds, with the balance
 * before that sell, or `null` when every replayed ledger stays valid.
 */
export function oversellAfterReplacement(
  history: readonly IdentifiedEntry[],
  replaceId: string,
  replacement: ConsolidationInput,
  splits: readonly SplitEvent[] = [],
): { ticker: string; available: string } | null {
  const target = history.find((entry) => entry.id === replaceId);
  const next = adjustForSplits(
    [...history.filter((entry) => entry.id !== replaceId), replacement],
    splits,
  );
  const tickers = [
    ...new Set([replacement.ticker, ...(target ? [target.ticker] : [])]),
  ];

  for (const ticker of tickers) {
    const available = availableBeforeOversell(next, ticker);

    if (available !== null) {
      return { ticker, available };
    }
  }

  return null;
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
