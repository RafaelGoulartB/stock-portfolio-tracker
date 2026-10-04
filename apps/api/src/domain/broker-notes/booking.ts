import { createHash } from "node:crypto";
import type {
  BrokerNoteFormat,
  BrokerNoteLine,
} from "@portifolio-tracker/shared";
import {
  add,
  compare,
  type Decimal,
  div,
  formatDecimal,
  mul,
  SCALE,
  sub,
  toDecimal,
  ZERO,
} from "../../lib/decimal";
import type { ParsedBrokerNote, ParsedNoteTrade } from "./types";

/**
 * Splits `total` across `weights` in proportion, at the ledger's 8 decimal
 * places, so the parts add up to `total` exactly. Units left by truncation
 * go to the largest remainders (earlier lines win ties).
 */
export function apportion(
  total: Decimal,
  weights: readonly Decimal[],
): Decimal[] {
  const weightSum = weights.reduce((sum, weight) => add(sum, weight), ZERO);

  if (weights.length === 0) return [];
  if (weightSum <= ZERO || weights.some((weight) => weight < ZERO)) {
    throw new Error("Apportioning needs positive weights");
  }

  const negative = total < ZERO;
  const magnitude = negative ? -total : total;
  // Scaled integers: share = magnitude × weight / weightSum, in 1e-8 units.
  const exact = weights.map((weight) => ({
    floor: (magnitude * weight) / weightSum,
    remainder: (magnitude * weight) % weightSum,
  }));
  let leftover =
    magnitude - exact.reduce((sum, part) => sum + part.floor, ZERO);
  const order = exact
    .map((part, index) => ({ index, remainder: part.remainder }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  const parts = exact.map((part) => part.floor);

  for (const { index } of order) {
    if (leftover <= ZERO) break;
    parts[index] = (parts[index] as Decimal) + 1n;
    leftover -= 1n;
  }

  return negative ? parts.map((part) => -part) : parts;
}

/**
 * Books one line: `quantity × price + fees` (buy) or `− fees` (sell) is the
 * cash the line moved. The document price is kept when it reproduces the
 * line value exactly; otherwise the price is the value over the quantity.
 * A net credit (negative cost) lowers the price instead of the fees, which
 * are never negative.
 */
export function bookLine(
  trade: ParsedNoteTrade,
  cost: Decimal,
): BrokerNoteLine {
  const quantity = toDecimal(trade.quantity);
  const gross = toDecimal(trade.grossValue);
  const executionPrice = toDecimal(trade.executionPrice);
  const fees = cost > ZERO ? cost : ZERO;
  const credit = cost < ZERO ? -cost : ZERO;
  const principal =
    trade.side === "buy" ? sub(gross, credit) : add(gross, credit);
  const price =
    credit === ZERO && compare(mul(quantity, executionPrice), gross) === 0
      ? executionPrice
      : div(principal, quantity);

  return {
    side: trade.side,
    sourceKey: trade.sourceKey,
    description: trade.description,
    documentTicker: trade.ticker,
    quantity: formatDecimal(quantity, SCALE),
    executionPrice: formatDecimal(executionPrice, SCALE),
    grossValue: formatDecimal(gross, 2),
    price: formatDecimal(price, SCALE),
    fees: formatDecimal(fees, SCALE),
    market: trade.market,
    flags: trade.flags,
    settlementDate: trade.settlementDate,
    references: trade.references,
  };
}

/** Per-line cost: the line's own fees (US) or its share of the note's (B3). */
function lineCosts(note: ParsedBrokerNote): Decimal[] {
  const perLine = note.trades.every((trade) => trade.netValue !== null);

  if (perLine) {
    return note.trades.map((trade) => {
      const gross = toDecimal(trade.grossValue);
      const net = toDecimal(trade.netValue as string);

      return trade.side === "buy" ? sub(net, gross) : sub(gross, net);
    });
  }

  return apportion(
    toDecimal(note.feesTotal),
    note.trades.map((trade) => toDecimal(trade.grossValue)),
  );
}

export function bookNote(note: ParsedBrokerNote): BrokerNoteLine[] {
  const costs = lineCosts(note);

  return note.trades.map((trade, index) =>
    bookLine(trade, costs[index] as Decimal),
  );
}

/** Notes of one issuer share an identity whatever layout printed them. */
function issuerOf(format: BrokerNoteFormat): string {
  return format.startsWith("inter-dtvm") ? "inter-dtvm" : format;
}

/**
 * Identity of a note's content, independent of its file bytes and layout:
 * the same note re-downloaded or printed by another layout of the same
 * broker yields the same fingerprint.
 */
export function noteFingerprint(note: ParsedBrokerNote): string {
  const amount = (value: string) => formatDecimal(toDecimal(value), SCALE);
  const trades = note.trades
    .map((trade) =>
      [
        trade.side,
        amount(trade.quantity),
        amount(trade.executionPrice),
        amount(trade.grossValue),
      ].join("|"),
    )
    .sort();
  const canonical = JSON.stringify({
    version: 1,
    issuer: issuerOf(note.format),
    currency: note.currency,
    tradeDate: note.tradeDate,
    trades,
    netAmount: amount(note.netAmount),
  });

  return createHash("sha256").update(canonical).digest("hex");
}
