import type {
  AssetClass,
  BrokerNoteFormat,
  TransactionSide,
} from "@portifolio-tracker/shared";
import {
  add,
  compare,
  type Decimal,
  formatDecimal,
  mul,
  sub,
  toDecimal,
  ZERO,
} from "../../lib/decimal";
import {
  BrokerNoteParseError,
  type ParsedBrokerNote,
  type ParsedNoteTrade,
} from "./types";

/** One confirmation line of a US broker, amounts as printed (signed). */
export type UsConfirmLine = {
  side: TransactionSide;
  symbol: string;
  description: string;
  tradeDate: string;
  settlementDate: string;
  quantity: string;
  executionPrice: string;
  principal: string;
  /** Commission, transaction and other fees as printed, signed. */
  charges: string[];
  interest: string;
  net: string;
  market: string | null;
  references: Record<string, string>;
  /** Source text for error messages. */
  text: string;
};

function abs(value: Decimal): Decimal {
  return value < ZERO ? -value : value;
}

function reconciliationError(message: string): never {
  throw new BrokerNoteParseError("reconciliation_failed", message);
}

function classHint(description: string): AssetClass {
  if (/\bREIT\b/i.test(description)) return "reit";
  if (/\bETF\b/i.test(description)) return "etf";

  return "stock_us";
}

function decimalPlaces(value: string): number {
  const fraction = value.split(".")[1] ?? "";

  return fraction.replace(/0+$/, "").length;
}

/** Trailing zeros of a printed decimal are not precision. */
function trimDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/**
 * Verifies one line and returns it as a note trade. The net amount is the
 * cash that moved; fees are the gap between it and the principal.
 */
function toTrade(line: UsConfirmLine): ParsedNoteTrade {
  if (toDecimal(line.interest) !== ZERO) {
    throw new BrokerNoteParseError(
      "unsupported_market",
      `Accrued interest is not supported (bonds): "${line.text}"`,
    );
  }

  const quantity = abs(toDecimal(line.quantity));
  const price = toDecimal(line.executionPrice);
  const principal = abs(toDecimal(line.principal));
  const net = abs(toDecimal(line.net));
  const charges = line.charges.reduce(
    (total, charge) => add(total, toDecimal(charge)),
    ZERO,
  );

  if (quantity === ZERO || price <= ZERO || principal === ZERO) {
    throw new BrokerNoteParseError(
      "invalid_layout",
      `Trade line with invalid amounts: "${line.text}"`,
    );
  }

  // Dollar-based orders truncate the quantity, so quantity × price may miss
  // the principal by one unit of the last quantity digit, plus a cent.
  const places = decimalPlaces(line.quantity);
  const lastDigit =
    places === 0 ? ZERO : toDecimal(`0.${"0".repeat(places - 1)}1`);
  const tolerance = add(toDecimal("0.01"), mul(price, lastDigit));
  if (abs(sub(mul(quantity, price), principal)) > tolerance) {
    reconciliationError(
      `Quantity × price does not match the principal: "${line.text}"`,
    );
  }

  // The fees borne by the investor are the gap between cash and principal;
  // the printed charges must explain it, whatever sign convention they use.
  const borne = line.side === "buy" ? sub(net, principal) : sub(principal, net);
  if (compare(abs(borne), abs(charges)) !== 0) {
    reconciliationError(
      `Principal and fees do not add up to the net amount: "${line.text}"`,
    );
  }

  return {
    side: line.side,
    sourceKey: `US:${line.symbol}`,
    description: line.description,
    ticker: line.symbol,
    classHint: classHint(line.description),
    quantity: trimDecimal(formatDecimal(quantity)),
    executionPrice: trimDecimal(formatDecimal(price)),
    grossValue: formatDecimal(principal, 2),
    netValue: formatDecimal(net, 2),
    market: line.market,
    flags: [],
    settlementDate: line.settlementDate,
    references: line.references,
  };
}

/**
 * Groups confirmation lines into one note per trade date, the unit the
 * ledger and a tax report reason about.
 */
export function buildUsNotes(
  format: Extract<BrokerNoteFormat, "apex-confirm" | "drivewealth-confirm">,
  account: string | null,
  lines: readonly UsConfirmLine[],
): ParsedBrokerNote[] {
  if (lines.length === 0) {
    throw new BrokerNoteParseError(
      "invalid_layout",
      "The confirmation has no trade lines",
    );
  }

  const byDate = new Map<string, UsConfirmLine[]>();

  for (const line of lines) {
    const list = byDate.get(line.tradeDate) ?? [];
    list.push(line);
    byDate.set(line.tradeDate, list);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tradeDate, dateLines]) => {
      const trades = dateLines.map(toTrade);
      const settlements = [
        ...new Set(trades.map((trade) => trade.settlementDate)),
      ];
      let purchases = ZERO;
      let sales = ZERO;
      let fees = ZERO;
      let netAmount = ZERO;

      for (const trade of trades) {
        const gross = toDecimal(trade.grossValue);
        const net = toDecimal(trade.netValue as string);

        if (trade.side === "buy") {
          purchases = add(purchases, gross);
          fees = add(fees, sub(net, gross));
          netAmount = sub(netAmount, net);
        } else {
          sales = add(sales, gross);
          fees = add(fees, sub(gross, net));
          netAmount = add(netAmount, net);
        }
      }

      return {
        format,
        currency: "USD",
        noteNumber: null,
        account,
        tradeDate,
        settlementDate:
          settlements.length === 1 ? (settlements[0] ?? null) : null,
        trades,
        fees: [],
        purchasesTotal: formatDecimal(purchases, 2),
        salesTotal: formatDecimal(sales, 2),
        feesTotal: formatDecimal(fees, 2),
        withheldTax: "0.00",
        dayTradeWithheldTax: "0.00",
        withheldTaxBase: null,
        netAmount: formatDecimal(netAmount, 2),
      } satisfies ParsedBrokerNote;
    });
}
