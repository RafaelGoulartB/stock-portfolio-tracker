import type { Currency, DividendStatus } from "@portifolio-tracker/shared";
import { formatDecimal, isZero, mul, toDecimal } from "../lib/decimal";
import type { DividendEvent } from "../lib/dividends";
import { type ConsolidationInput, consolidatePositions } from "./positions";

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
          2,
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
