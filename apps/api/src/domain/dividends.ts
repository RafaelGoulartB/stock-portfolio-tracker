import type {
  AssetClass,
  Currency,
  DividendStatus,
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
import type { DividendEvent } from "../lib/dividends";
import {
  type ConsolidationInput,
  consolidatePositions,
  convertMoney,
  isOpenQuantity,
} from "./positions";

const MONEY_PLACES = 2;
const RATE_PLACES = 6;

export type PortfolioDividendEvent = DividendEvent & {
  eligibleQuantity: string;
  grossAmount: string;
  status: DividendStatus;
};

function eventStatus(event: DividendEvent, today: string): DividendStatus {
  if (event.exDate > today) {
    return "announced";
  }

  if (event.paymentDate && event.paymentDate > today) {
    return "scheduled";
  }

  return "estimated_paid";
}

/**
 * Estimates entitlement from the last cum-dividend position. Trades on the
 * ex-date are excluded because that session no longer carries the right.
 */
export function attachDividendEntitlements(
  events: readonly DividendEvent[],
  transactions: readonly ConsolidationInput[],
  today: string,
): PortfolioDividendEvent[] {
  return events.flatMap((event): PortfolioDividendEvent[] => {
    const eligibleTransactions = transactions.filter(
      (entry) =>
        entry.ticker === event.ticker &&
        entry.currency === event.currency &&
        entry.tradedAt < event.exDate,
    );
    const position = consolidatePositions(eligibleTransactions).find(
      (entry) =>
        entry.ticker === event.ticker && entry.currency === event.currency,
    );
    const quantity = position?.quantity ?? "0";

    if (isZero(toDecimal(quantity))) {
      return [];
    }

    return [
      {
        ...event,
        eligibleQuantity: quantity,
        grossAmount: formatDecimal(
          mul(toDecimal(quantity), toDecimal(event.amountPerShare)),
          MONEY_PLACES,
        ),
        status: eventStatus(event, today),
      },
    ];
  });
}

export function nativeDividendTotals(
  events: readonly PortfolioDividendEvent[],
): Array<{ currency: Currency; amount: string }> {
  const totals = new Map<Currency, bigint>();

  for (const event of events) {
    totals.set(
      event.currency,
      (totals.get(event.currency) ?? 0n) + toDecimal(event.grossAmount),
    );
  }

  return [...totals.entries()]
    .map(([currency, amount]) => ({
      currency,
      amount: formatDecimal(amount, 2),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** An entitled event with its amount in the display currency, if convertible. */
export type ConvertedDividendEvent = PortfolioDividendEvent & {
  convertedGrossAmount: string | null;
};

/** The day income counts on: the payment when published, else the ex-date. */
export function incomeDay(event: {
  paymentDate: string | null;
  exDate: string;
}): string {
  return event.paymentDate ?? event.exDate;
}

function shiftYears(day: string, years: number): string {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(Date.UTC(year + years, month - 1, date))
    .toISOString()
    .slice(0, 10);
}

export type IncomeMonth = {
  month: string;
  amount: string;
  byAssetClass: Array<{ assetClass: AssetClass; amount: string }>;
};

export type IncomeAsset = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  /** Income received in the last 12 months, in the display currency. */
  trailing12m: string;
  /** Every event of the window, future announcements included. */
  windowTotal: string;
  events: number;
  lastIncomeDay: string;
  /** True while the position is still open. */
  held: boolean;
  /**
   * Native income of the last 12 months over the native cost of the open
   * position: no FX on either side. `null` when nothing is held.
   */
  yieldOnCost: string | null;
};

export type IncomeSummary = {
  trailing12m: string;
  /** The 12 months before those, `null` when the window cannot cover them. */
  previous12m: string | null;
  /** `trailing / previous - 1`, `null` without a previous year to compare. */
  trailing12mChange: string | null;
  monthlyAverage: string;
  /**
   * Last-12-month income of the assets still held over the cost of every
   * open income-eligible position, both converted at the same consolidation
   * rate. `null` without a held cost or a needed rate.
   */
  yieldOnCost: string | null;
  monthly: IncomeMonth[];
  byYear: Array<{ year: number; amount: string }>;
  byAsset: IncomeAsset[];
};

/**
 * Income totals the screen reads at a glance. "Received" means the income
 * day has passed; amounts are gross estimates, never confirmed credits.
 * Events that could not be converted are left out of every converted total.
 */
export function summarizeIncome(input: {
  events: readonly ConvertedDividendEvent[];
  /** Asset class by `ticker|currency` of every income-eligible asset. */
  assetClasses: ReadonlyMap<string, AssetClass>;
  transactions: readonly ConsolidationInput[];
  today: string;
  windowYears: number;
  displayCurrency: Currency;
  usdBrlRate: string | null;
}): IncomeSummary {
  const yearAgo = shiftYears(input.today, -1);
  const twoYearsAgo = shiftYears(input.today, -2);
  let trailing = ZERO;
  let previous = ZERO;
  const months = new Map<string, Map<AssetClass, Decimal>>();
  const years = new Map<number, Decimal>();
  const assets = new Map<
    string,
    {
      ticker: string;
      currency: Currency;
      assetClass: AssetClass;
      trailing: Decimal;
      nativeTrailing: Decimal;
      window: Decimal;
      events: number;
      last: string;
    }
  >();

  for (const event of input.events) {
    const key = `${event.ticker}|${event.currency}`;
    const assetClass = input.assetClasses.get(key) ?? "other";
    const day = incomeDay(event);
    const received = day <= input.today;
    const inTrailing = received && day > yearAgo;
    const asset = assets.get(key) ?? {
      ticker: event.ticker,
      currency: event.currency,
      assetClass,
      trailing: ZERO,
      nativeTrailing: ZERO,
      window: ZERO,
      events: 0,
      last: day,
    };

    asset.events += 1;
    asset.last = day > asset.last ? day : asset.last;

    if (inTrailing) {
      asset.nativeTrailing = add(
        asset.nativeTrailing,
        toDecimal(event.grossAmount),
      );
    }

    if (event.convertedGrossAmount != null) {
      const amount = toDecimal(event.convertedGrossAmount);
      const month = day.slice(0, 7);
      const byClass = months.get(month) ?? new Map<AssetClass, Decimal>();
      const year = Number(day.slice(0, 4));

      byClass.set(assetClass, add(byClass.get(assetClass) ?? ZERO, amount));
      months.set(month, byClass);
      years.set(year, add(years.get(year) ?? ZERO, amount));
      asset.window = add(asset.window, amount);

      if (inTrailing) {
        trailing = add(trailing, amount);
        asset.trailing = add(asset.trailing, amount);
      } else if (received && day > twoYearsAgo && day <= yearAgo) {
        previous = add(previous, amount);
      }
    }

    assets.set(key, asset);
  }

  const open = new Map(
    consolidatePositions(input.transactions)
      .filter((position) => isOpenQuantity(position.quantity))
      .map((position) => [
        `${position.ticker}|${position.currency}`,
        position.investedCost,
      ]),
  );
  let heldIncome = ZERO;
  let heldCost = ZERO;
  let missingRate = false;

  for (const asset of assets.values()) {
    if (open.has(`${asset.ticker}|${asset.currency}`)) {
      heldIncome = add(heldIncome, asset.trailing);
    }
  }

  // Every open income-eligible position joins the cost, paying or not: a
  // holding that paid nothing still dilutes the portfolio's yield.
  for (const [key, cost] of open) {
    const currency = key.split("|")[1] as Currency;

    if (!input.assetClasses.has(key)) {
      continue;
    }

    if (currency === input.displayCurrency) {
      heldCost = add(heldCost, toDecimal(cost));
    } else if (input.usdBrlRate) {
      heldCost = add(
        heldCost,
        toDecimal(
          convertMoney(cost, currency, input.displayCurrency, input.usdBrlRate),
        ),
      );
    } else {
      missingRate = true;
    }
  }

  const ratio = (numerator: Decimal, denominator: Decimal) =>
    denominator <= ZERO
      ? null
      : formatDecimal(div(numerator, denominator), RATE_PLACES);

  return {
    trailing12m: formatDecimal(trailing, MONEY_PLACES),
    previous12m:
      input.windowYears >= 2 ? formatDecimal(previous, MONEY_PLACES) : null,
    trailing12mChange:
      input.windowYears >= 2 ? ratio(sub(trailing, previous), previous) : null,
    monthlyAverage: formatDecimal(div(trailing, toDecimal("12")), MONEY_PLACES),
    yieldOnCost: missingRate ? null : ratio(heldIncome, heldCost),
    monthly: [...months.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, byClass]) => {
        let amount = ZERO;

        for (const value of byClass.values()) {
          amount = add(amount, value);
        }

        return {
          month,
          amount: formatDecimal(amount, MONEY_PLACES),
          byAssetClass: [...byClass.entries()]
            .map(([assetClass, value]) => ({
              assetClass,
              amount: formatDecimal(value, MONEY_PLACES),
            }))
            .sort((a, b) => a.assetClass.localeCompare(b.assetClass)),
        };
      }),
    byYear: [...years.entries()]
      .sort(([left], [right]) => left - right)
      .map(([year, amount]) => ({
        year,
        amount: formatDecimal(amount, MONEY_PLACES),
      })),
    byAsset: [...assets.entries()]
      .map(([key, asset]) => {
        const cost = open.get(key);

        return {
          ticker: asset.ticker,
          assetClass: asset.assetClass,
          currency: asset.currency,
          trailing12m: formatDecimal(asset.trailing, MONEY_PLACES),
          windowTotal: formatDecimal(asset.window, MONEY_PLACES),
          events: asset.events,
          lastIncomeDay: asset.last,
          held: cost !== undefined,
          yieldOnCost:
            cost === undefined
              ? null
              : ratio(asset.nativeTrailing, toDecimal(cost)),
        };
      })
      .sort(
        (a, b) =>
          Number(b.trailing12m) - Number(a.trailing12m) ||
          Number(b.windowTotal) - Number(a.windowTotal) ||
          a.ticker.localeCompare(b.ticker),
      ),
  };
}
