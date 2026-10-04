import { add, compare, type Decimal, toDecimal, ZERO } from "../../lib/decimal";
import type { PdfPage } from "../../lib/pdf-text";
import { normalizeText, parseUsAmount, parseUsDate } from "./text";
import { BrokerNoteParseError, type ParsedBrokerNote } from "./types";
import { buildUsNotes, type UsConfirmLine } from "./us-confirm";

const MONEY = String.raw`-?[\d,]*\.\d{2}`;
/**
 * `Type B/S TradeDate SettleDate QTY SYM PRICE Principal COMM TranFee Fees
 * [Tag] Net Trade# ...` as Apex prints it on one row.
 */
const TRADE_ROW = new RegExp(
  [
    String.raw`^(\d+)\s+([BS])`,
    String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})`,
    String.raw`(-?[\d,]*\.?\d+)\s+([A-Z][A-Z0-9./-]*)`,
    String.raw`([\d,]*\.\d+)`,
    `(${MONEY})\\s+(${MONEY})\\s+(${MONEY})\\s+(${MONEY})`,
    String.raw`(?:([A-Z0-9]+)\s+)?(${MONEY})(?:\s+(\S+))?`,
  ].join(String.raw`\s+`),
);
const LOOKS_LIKE_TRADE = /^\d+\s+[BS]\s+\d{1,2}\//;
const DESCRIPTION_ROW =
  /^Desc:\s+(.*?)\s+Interest\/STTax:\s+(-?[\d,]*\.\d{2})(?:\s+CUSIP:\s+(\S+))?/;

function layoutError(message: string): never {
  throw new BrokerNoteParseError("invalid_layout", message);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function detectApex(pages: readonly PdfPage[]): boolean {
  const text = pages
    .flatMap((page) => page.lines.map((line) => normalizeText(line.text)))
    .join("\n");

  return (
    text.includes("apex clearing corporation") &&
    text.includes("b/s trade date settle date")
  );
}

type DailySummary = { bought: Decimal; sold: Decimal };

export function parseApex(pages: readonly PdfPage[]): ParsedBrokerNote[] {
  const lines: UsConfirmLine[] = [];
  const summaries = new Map<string, DailySummary>();
  let account: string | null = null;
  let summaryDate: string | null = null;
  let current: UsConfirmLine | null = null;

  for (const page of pages) {
    for (const line of page.lines) {
      const text = collapse(line.text);
      const accountMatch = /Account Number:\s*(\S+)/.exec(text);

      if (accountMatch?.[1]) account = accountMatch[1];

      if (LOOKS_LIKE_TRADE.test(text)) {
        const match = TRADE_ROW.exec(text);
        if (!match) layoutError(`Unrecognized trade row: "${text}"`);

        const [
          ,
          ,
          side = "",
          tradeDate = "",
          settleDate = "",
          quantity = "",
          symbol = "",
          price = "",
          principal = "",
          commission = "",
          transactionFee = "",
          fees = "",
          tag,
          net = "",
          tradeNumber,
        ] = match;

        current = {
          side: side === "B" ? "buy" : "sell",
          symbol,
          description: "",
          tradeDate: parseUsDate(tradeDate),
          settlementDate: parseUsDate(settleDate),
          quantity: parseUsAmount(quantity),
          executionPrice: parseUsAmount(price),
          principal: parseUsAmount(principal),
          charges: [commission, transactionFee, fees].map(parseUsAmount),
          interest: "0",
          net: parseUsAmount(net),
          market: null,
          references: {
            ...(tag ? { tag } : {}),
            ...(tradeNumber ? { trade: tradeNumber } : {}),
          },
          text,
        };
        lines.push(current);
        continue;
      }

      if (text.startsWith("Desc:")) {
        const match = DESCRIPTION_ROW.exec(text);
        if (!current || !match) layoutError(`Unexpected row: "${text}"`);

        current.description = match[1] ?? "";
        current.interest = parseUsAmount(match[2] ?? "0");
        if (match[3]) current.references.cusip = match[3];
        continue;
      }

      const currency = /^Currency:\s*([A-Z]{3})/.exec(text);
      if (currency) {
        if (!current) layoutError(`Unexpected row: "${text}"`);
        if (currency[1] !== "USD") {
          throw new BrokerNoteParseError(
            "unsupported_market",
            `Currency ${currency[1]} is not supported`,
          );
        }
        continue;
      }

      const summary = /SUMMARY FOR CURRENT TRADE DATE:\s*(\S+)/.exec(text);
      if (summary?.[1]) {
        summaryDate = parseUsDate(summary[1]);
        continue;
      }

      const total = /TOTAL DOLLARS (BOUGHT|SOLD):\s*(\S+)/.exec(text);
      if (total?.[1] && total[2]) {
        if (!summaryDate) layoutError("Daily totals without a trade date");

        const entry = summaries.get(summaryDate) ?? {
          bought: ZERO,
          sold: ZERO,
        };
        const amount = toDecimal(parseUsAmount(total[2]));
        const magnitude = amount < ZERO ? -amount : amount;

        if (total[1] === "BOUGHT") entry.bought = magnitude;
        else entry.sold = magnitude;
        summaries.set(summaryDate, entry);
      }
    }
  }

  for (const line of lines) {
    if (!line.description)
      layoutError(`Trade without description: "${line.text}"`);
  }

  const notes = buildUsNotes("apex-confirm", account, lines);

  // The daily summary must match the lines, by net cash or by principal.
  for (const note of notes) {
    const summary = summaries.get(note.tradeDate);
    if (!summary) layoutError(`No daily summary for ${note.tradeDate}`);

    const totals = (side: "buy" | "sell", field: "netValue" | "grossValue") =>
      note.trades
        .filter((trade) => trade.side === side)
        .reduce(
          (sum, trade) => add(sum, toDecimal(trade[field] as string)),
          ZERO,
        );
    const matches = (side: "buy" | "sell", expected: Decimal) =>
      compare(totals(side, "netValue"), expected) === 0 ||
      compare(totals(side, "grossValue"), expected) === 0;

    if (!matches("buy", summary.bought) || !matches("sell", summary.sold)) {
      throw new BrokerNoteParseError(
        "reconciliation_failed",
        `Trades of ${note.tradeDate} do not add up to the daily summary`,
      );
    }
  }

  return notes;
}
