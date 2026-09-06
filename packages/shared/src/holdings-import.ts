import { z } from "zod";
import { type Currency, currencySchema, DEFAULT_CURRENCY } from "./currency";
import { isoDate, positiveDecimal } from "./decimal";
import {
  type AssetClass,
  assetClassSchema,
  tickerSchema,
} from "./transactions";

const MAX_HOLDINGS = 200;

/** One opening lot: quantity at average cost, booked as a single buy. */
export const bookHoldingRowSchema = z.object({
  ticker: tickerSchema,
  assetClass: assetClassSchema,
  currency: currencySchema,
  quantity: positiveDecimal,
  price: positiveDecimal,
});

export type BookHoldingRow = z.infer<typeof bookHoldingRowSchema>;

export const bookHoldingsInput = z.object({
  tradedAt: isoDate,
  notes: z.string().trim().max(280, "Use at most 280 characters").optional(),
  holdings: z
    .array(bookHoldingRowSchema)
    .min(1, "Add at least one holding")
    .max(MAX_HOLDINGS, `Book at most ${MAX_HOLDINGS} holdings at once`),
});

export type BookHoldingsInput = z.input<typeof bookHoldingsInput>;

/** Parsed row before the user confirms class/currency overrides. */
export type ParsedHoldingRow = {
  ticker: string;
  quantity: string;
  price: string;
  currency: Currency;
  assetClass: AssetClass;
  /** 1-based source line for error messages. */
  line: number;
};

export type HoldingsParseIssue = {
  line: number;
  message: string;
};

export type HoldingsParseResult = {
  rows: ParsedHoldingRow[];
  issues: HoldingsParseIssue[];
};

const HEADER_ALIASES = new Set([
  "ativo",
  "ticker",
  "symbol",
  "qtd",
  "qty",
  "quantidade",
  "quantity",
  "preco medio",
  "preço médio",
  "preco",
  "preço",
  "price",
  "average price",
  "avg price",
]);

/**
 * B3 cash equities look like PETR4 / VALE3 / FIQE11. Pure letter tickers
 * (GOOG, NVDA) default to US stock when the currency is USD, otherwise BR.
 */
export function inferAssetClass(
  ticker: string,
  currency: Currency,
): AssetClass {
  if (/^[A-Z]{4}\d{1,2}$/.test(ticker) || /^[A-Z]{3,5}\d{1,2}$/.test(ticker)) {
    return "stock_br";
  }

  // Pure letter symbols (GOOG, NVDA) are treated as US equities even when the
  // paste used R$ — the preview lets the user flip currency/class.
  if (/^[A-Z]{1,5}$/.test(ticker)) {
    return "stock_us";
  }

  return currency === "USD" ? "stock_us" : "stock_br";
}

/**
 * Brazilian-friendly decimal: `2.800` → 2800, `4,78` → 4.78, `1.234,56` →
 * 1234.56, `32.15` → 32.15.
 */
export function parseBrazilianNumber(text: string): string | null {
  let cleaned = text.trim().replace(/\s/g, "").replace(/%/g, "");

  if (cleaned.length === 0) {
    return null;
  }

  const negative = cleaned.startsWith("-");

  if (negative) {
    cleaned = cleaned.slice(1);
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    cleaned = cleaned.replace(",", ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }

  const [whole = "0", fraction = ""] = cleaned.split(".");
  const trimmedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const trimmedFraction = fraction.replace(/0+$/, "").slice(0, 8);
  const value = trimmedFraction
    ? `${trimmedWhole}.${trimmedFraction}`
    : trimmedWhole;

  if (value === "0") {
    return null;
  }

  return negative ? `-${value}` : value;
}

export function parseMoneyCell(raw: string): {
  currency: Currency;
  amount: string | null;
} {
  let text = raw.trim();
  let currency: Currency = DEFAULT_CURRENCY;

  if (/^R\$\s*/i.test(text)) {
    currency = "BRL";
    text = text.replace(/^R\$\s*/i, "");
  } else if (/^US\$\s*/i.test(text)) {
    currency = "USD";
    text = text.replace(/^US\$\s*/i, "");
  } else if (/^USD\s*/i.test(text)) {
    currency = "USD";
    text = text.replace(/^USD\s*/i, "");
  } else if (/^\$\s*/.test(text)) {
    currency = "USD";
    text = text.replace(/^\$\s*/, "");
  }

  return { currency, amount: parseBrazilianNumber(text) };
}

/** Splits one CSV line, honoring double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }

      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === "," || char === ";" || char === "\t") {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());

  return cells;
}

function isHeaderRow(cells: string[]): boolean {
  if (cells.length === 0) {
    return false;
  }

  const normalized = cells.map((cell) =>
    cell.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim(),
  );

  return normalized.some((cell) => HEADER_ALIASES.has(cell));
}

/**
 * Parses a paste or `.txt`/`.csv` body into holding rows. Invalid lines are
 * reported; valid ones keep going so the preview can still be useful.
 */
export function parseHoldingsImport(text: string): HoldingsParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.length > 0);

  const rows: ParsedHoldingRow[] = [];
  const issues: HoldingsParseIssue[] = [];
  const seen = new Set<string>();
  let started = false;

  for (const { line, number } of lines) {
    const cells = splitCsvLine(line);

    if (!started) {
      if (isHeaderRow(cells)) {
        started = true;
        continue;
      }

      started = true;
    }

    if (cells.length < 3) {
      issues.push({
        line: number,
        message: "Expected ticker, quantity and average price",
      });
      continue;
    }

    const [rawTicker = "", rawQty = "", rawPrice = ""] = cells;
    const tickerResult = tickerSchema.safeParse(rawTicker);

    if (!tickerResult.success) {
      issues.push({ line: number, message: "Invalid ticker" });
      continue;
    }

    const quantity = parseBrazilianNumber(rawQty);
    const { currency, amount: price } = parseMoneyCell(rawPrice);

    if (quantity === null || quantity.startsWith("-")) {
      issues.push({ line: number, message: "Invalid quantity" });
      continue;
    }

    if (price === null || price.startsWith("-")) {
      issues.push({ line: number, message: "Invalid average price" });
      continue;
    }

    const qtyCheck = positiveDecimal.safeParse(quantity);
    const priceCheck = positiveDecimal.safeParse(price);

    if (!qtyCheck.success) {
      issues.push({ line: number, message: "Invalid quantity" });
      continue;
    }

    if (!priceCheck.success) {
      issues.push({ line: number, message: "Invalid average price" });
      continue;
    }

    const ticker = tickerResult.data;

    if (seen.has(ticker)) {
      issues.push({
        line: number,
        message: `Duplicate ticker ${ticker}`,
      });
      continue;
    }

    seen.add(ticker);

    const currencyParsed = currencySchema.parse(currency);
    const assetClass = inferAssetClass(ticker, currencyParsed);

    rows.push({
      ticker,
      quantity: qtyCheck.data,
      price: priceCheck.data,
      currency: currencyParsed,
      assetClass,
      line: number,
    });
  }

  return { rows, issues };
}
