import type { PdfPage } from "../../lib/pdf-text";
import { normalizeText, parseUsAmount, parseUsDate } from "./text";
import { BrokerNoteParseError, type ParsedBrokerNote } from "./types";
import { buildUsNotes, type UsConfirmLine } from "./us-confirm";

/**
 * `Symbol Security A/CType Action ExecutionTime Quantity Price TradeDate
 * SettleDate Capacity` as DriveWealth prints it on one row.
 */
const TRADE_ROW =
  /^([A-Z][A-Z0-9./-]*)\s+(.+?)\s+([A-Z]{1,2})\s+(Buy|Sell)\s+(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s+(-?[\d,]*\.?\d+)\s+([\d,]*\.?\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+)$/;
const LOOKS_LIKE_TRADE = /\s(?:Buy|Sell)\s+\d{1,2}:\d{2}:\d{2}/;
const AMOUNT = String.raw`(\(?-?\$?[\d,]*\.\d{2}\)?)`;
const AMOUNT_ROWS = {
  principal: new RegExp(`^Principal Amount\\s+${AMOUNT}$`),
  interest: new RegExp(`^Interest(?:\\s+${AMOUNT})?$`),
  commission: new RegExp(`^Commission\\s+${AMOUNT}$`),
  transactionFee: new RegExp(`^Transaction Fee\\s+${AMOUNT}$`),
  otherFees: new RegExp(`^Other Fees / Credits\\s+${AMOUNT}$`),
  net: new RegExp(`^Net Amount\\s+${AMOUNT}$`),
} as const;

type AmountField = keyof typeof AMOUNT_ROWS;

function layoutError(message: string): never {
  throw new BrokerNoteParseError("invalid_layout", message);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function detectDriveWealth(pages: readonly PdfPage[]): boolean {
  const text = pages
    .flatMap((page) => page.lines.map((line) => normalizeText(line.text)))
    .join("\n");

  return text.includes("drivewealth") && text.includes("confirmation date");
}

type Pending = {
  row: Omit<UsConfirmLine, "principal" | "charges" | "interest" | "net">;
  amounts: Partial<Record<AmountField, string>>;
};

function complete(pending: Pending): UsConfirmLine {
  const { principal, commission, transactionFee, otherFees, net, interest } =
    pending.amounts;

  if (
    principal === undefined ||
    commission === undefined ||
    transactionFee === undefined ||
    otherFees === undefined ||
    net === undefined
  ) {
    layoutError(`Incomplete amounts for trade: "${pending.row.text}"`);
  }

  return {
    ...pending.row,
    principal,
    charges: [commission, transactionFee, otherFees],
    interest: interest ?? "0",
    net,
  };
}

export function parseDriveWealth(
  pages: readonly PdfPage[],
): ParsedBrokerNote[] {
  const lines: UsConfirmLine[] = [];
  let account: string | null = null;
  let pending: Pending | null = null;

  const flush = () => {
    if (pending) lines.push(complete(pending));
    pending = null;
  };

  scan: for (const page of pages) {
    for (const line of page.lines) {
      const text = collapse(line.text);

      // The legal terms that follow the trades never carry trade data.
      if (/^Transaction Terms$/.test(text)) {
        flush();
        break scan;
      }

      const accountMatch = /Account Number:\s*(\S+)/.exec(text);
      if (accountMatch?.[1]) account = accountMatch[1];

      if (LOOKS_LIKE_TRADE.test(text)) {
        const match = TRADE_ROW.exec(text);
        if (!match) layoutError(`Unrecognized trade row: "${text}"`);

        flush();

        const [
          ,
          symbol = "",
          security = "",
          ,
          action,
          executionTime = "",
          quantity = "",
          price = "",
          tradeDate = "",
          settleDate = "",
          capacity = "",
        ] = match;
        const side = action === "Buy" ? "buy" : "sell";
        const parsedQuantity = parseUsAmount(quantity);

        // A sale is printed with a negative quantity, a purchase positive.
        if (side === "buy" && parsedQuantity.startsWith("-")) {
          layoutError(`Buy with a negative quantity: "${text}"`);
        }

        pending = {
          row: {
            side,
            symbol,
            description: security,
            tradeDate: parseUsDate(tradeDate),
            settlementDate: parseUsDate(settleDate),
            quantity: parsedQuantity,
            executionPrice: parseUsAmount(price),
            market: capacity,
            references: { executionTime },
            text,
          },
          amounts: {},
        };
        continue;
      }

      if (!pending) continue;

      for (const [field, pattern] of Object.entries(AMOUNT_ROWS) as [
        AmountField,
        RegExp,
      ][]) {
        const match = pattern.exec(text);

        if (match) {
          if (pending.amounts[field] !== undefined) {
            layoutError(`Repeated ${field} for trade: "${pending.row.text}"`);
          }
          pending.amounts[field] = match[1] ? parseUsAmount(match[1]) : "0";
        }
      }
    }
  }

  flush();

  return buildUsNotes("drivewealth-confirm", account, lines);
}
