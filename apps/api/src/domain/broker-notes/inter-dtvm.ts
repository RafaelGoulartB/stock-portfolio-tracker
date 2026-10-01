import type {
  AssetClass,
  BrokerNoteFee,
  BrokerNoteFormat,
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
import type { PdfPage, PdfTextLine } from "../../lib/pdf-text";
import {
  normalizeText,
  parseBrazilianAmount,
  parseBrazilianDate,
} from "./text";
import {
  BrokerNoteParseError,
  type ParsedBrokerNote,
  type ParsedNoteTrade,
} from "./types";

type InterFormat = Extract<
  BrokerNoteFormat,
  "inter-dtvm-sinacor" | "inter-dtvm-web"
>;

/** Spot markets only; options, forwards and futures are out of scope. */
const SPOT_MARKETS = new Map([
  ["VIS", "VIS"],
  ["VISTA", "VIS"],
  ["FRA", "FRA"],
  ["FRACIONARIO", "FRA"],
]);

/** Share classes printed in the B3 security specification. */
const CLASS_TOKENS = new Set([
  "ON",
  "PN",
  "PNA",
  "PNB",
  "PNC",
  "PND",
  "PNE",
  "PNF",
  "PNG",
  "PNH",
  "UNT",
  "CI",
  "DRN",
  "DR1",
  "DR2",
  "DR3",
  "DIR",
  "REC",
]);

/**
 * Listing segments and ex-right markers. They change over a security's life
 * (`ON EJ NM` after a dividend), so they are not part of its identity.
 */
const MARKER_TOKEN = /^(?:N[12M]|MA|M2|MB|E[A-Z]{1,2}|ATZ)$/;
/** A ticker printed in the specification, with the fractional `F`. */
const PRINTED_TICKER = /^([A-Z0-9]{4}\d{1,2})F?$/;
const AMOUNT = String.raw`(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})`;

function layoutError(message: string): never {
  throw new BrokerNoteParseError("invalid_layout", message);
}

function reconciliationError(message: string): never {
  throw new BrokerNoteParseError("reconciliation_failed", message);
}

/** Line text with each item normalized, item boundaries kept as 2 spaces. */
function normalizedLine(line: PdfTextLine): string {
  return line.items.map((item) => normalizeText(item.text)).join("  ");
}

function pageText(page: PdfPage): string {
  return page.lines.map(normalizedLine).join("\n");
}

export function detectInterDtvm(pages: readonly PdfPage[]): InterFormat | null {
  const text = pages.map(pageText).join("\n");

  if (!text.includes("inter dtvm")) return null;
  if (!text.includes("especificacao do titulo")) return null;

  if (text.includes("negocios realizados")) return "inter-dtvm-sinacor";
  if (/(?:^|\s)praca(?:\s|$)/m.test(text)) return "inter-dtvm-web";

  return null;
}

type Token = { text: string; x: number };

/** Splits merged items into words, estimating each word's x position. */
function tokensOf(line: PdfTextLine): Token[] {
  const tokens: Token[] = [];

  for (const item of line.items) {
    const pattern = /\S+/g;
    let match = pattern.exec(item.text);

    while (match) {
      const offset =
        item.text.length > 0
          ? (match.index / item.text.length) * item.width
          : 0;
      tokens.push({ text: match[0], x: item.x + offset });
      match = pattern.exec(item.text);
    }
  }

  return tokens;
}

type Security = {
  sourceKey: string;
  description: string;
  ticker: string | null;
  classHint: AssetClass;
};

function classHintFor(shareClass: string | null, name: string): AssetClass {
  if (shareClass === "CI") return name.startsWith("FII ") ? "reit" : "etf";
  if (shareClass?.startsWith("DR")) return "bdr";

  return "stock_br";
}

/**
 * Identifies the security of a B3 line. A printed ticker wins; otherwise the
 * key is the trading name plus the share class, which is stable across notes
 * of the same security while markers come and go.
 */
export function describeB3Security(tokens: readonly string[]): Security {
  const description = tokens.join(" ");
  const printed = tokens[0] ? PRINTED_TICKER.exec(tokens[0]) : null;

  if (printed?.[1]) {
    const shareClass = tokens.find((token) => CLASS_TOKENS.has(token)) ?? null;

    return {
      sourceKey: `B3:${printed[1]}`,
      description,
      ticker: printed[1],
      classHint:
        shareClass === "CI"
          ? "reit"
          : shareClass?.startsWith("DR")
            ? "bdr"
            : "stock_br",
    };
  }

  let shareClass: string | null = null;
  let name: string[] = [...tokens];

  if (tokens[0] && CLASS_TOKENS.has(tokens[0])) {
    // Inter prints the class and markers before the trading name.
    let index = 1;
    while (tokens[index] && MARKER_TOKEN.test(tokens[index] as string)) {
      index += 1;
    }
    shareClass = tokens[0];
    name = tokens.slice(index);
  } else {
    // The SINACOR default prints the name first: `ELETROBRAS PNB N1`.
    let index = tokens.length - 1;
    while (index >= 0 && MARKER_TOKEN.test(tokens[index] as string)) {
      index -= 1;
    }
    if (index > 0 && CLASS_TOKENS.has(tokens[index] as string)) {
      shareClass = tokens[index] as string;
      name = tokens.slice(0, index);
    }
  }

  if (name.length === 0) {
    shareClass = null;
    name = [...tokens];
  }

  const joined = name.join(" ");

  return {
    sourceKey: `B3:${joined}|${shareClass ?? ""}`,
    description: shareClass ? `${joined} ${shareClass}` : joined,
    ticker: null,
    classHint: classHintFor(shareClass, joined),
  };
}

type TableColumns = { obsX: number | null };

function findTradeHeader(page: PdfPage): {
  index: number;
  columns: TableColumns;
} | null {
  const index = page.lines.findIndex((line) => {
    const text = normalizedLine(line);

    return (
      text.includes("c/v") &&
      text.includes("quantidade") &&
      text.includes("especificacao do titulo")
    );
  });

  if (index < 0) return null;

  const header = page.lines[index] as PdfTextLine;
  const obs = header.items.find((item) =>
    normalizeText(item.text).startsWith("obs"),
  );

  return { index, columns: { obsX: obs ? obs.x : null } };
}

function parseTradeLine(
  line: PdfTextLine,
  columns: TableColumns,
): ParsedNoteTrade {
  const tokens = tokensOf(line);
  let cursor = 0;

  // An optional "Q" (qualified settlement) mark precedes the exchange.
  if (!/bovespa$/i.test(tokens[0]?.text ?? "")) cursor += 1;
  if (!/bovespa$/i.test(tokens[cursor]?.text ?? "")) {
    layoutError(`Unrecognized line in the trades table: "${line.text}"`);
  }
  cursor += 1;

  const sideToken = tokens[cursor]?.text;
  if (sideToken !== "C" && sideToken !== "V") {
    layoutError(`Missing C/V in trade line: "${line.text}"`);
  }
  cursor += 1;

  const marketToken = (tokens[cursor]?.text ?? "").toUpperCase();
  const market = SPOT_MARKETS.get(marketToken);
  if (!market) {
    throw new BrokerNoteParseError(
      "unsupported_market",
      `Market "${marketToken}" is not a spot cash market`,
    );
  }
  cursor += 1;

  const tail = tokens.slice(-4);
  if (tokens.length - 4 <= cursor || tail.length !== 4) {
    layoutError(`Incomplete trade line: "${line.text}"`);
  }

  const [quantityToken, priceToken, valueToken, dcToken] = tail as [
    Token,
    Token,
    Token,
    Token,
  ];
  const middle = tokens.slice(cursor, -4);
  const obsX = columns.obsX;
  const specTokens = middle.filter(
    (token) => obsX === null || token.x < obsX - 3,
  );
  const flags = middle
    .filter((token) => obsX !== null && token.x >= obsX - 3)
    .map((token) => token.text);

  if (specTokens.length === 0) {
    layoutError(`Trade line without a security: "${line.text}"`);
  }

  const side = sideToken === "C" ? "buy" : "sell";
  const expectedDc = side === "buy" ? "D" : "C";
  if (dcToken.text !== expectedDc) {
    layoutError(`Debit/credit flag does not match the side: "${line.text}"`);
  }

  const quantity = parseBrazilianAmount(quantityToken.text);
  const executionPrice = parseBrazilianAmount(priceToken.text);
  const grossValue = parseBrazilianAmount(valueToken.text);

  if (
    !/^\d+$/.test(quantity) ||
    toDecimal(quantity) <= ZERO ||
    toDecimal(executionPrice) <= ZERO ||
    toDecimal(grossValue) <= ZERO
  ) {
    layoutError(`Trade line with invalid amounts: "${line.text}"`);
  }

  // Quantity × price is the line value; a gap above one cent means the
  // columns were misread, not a rounding difference.
  const gap = sub(
    mul(toDecimal(quantity), toDecimal(executionPrice)),
    toDecimal(grossValue),
  );
  if (gap > toDecimal("0.01") || gap < toDecimal("-0.01")) {
    reconciliationError(
      `Quantity × price does not match the value: "${line.text}"`,
    );
  }

  const security = describeB3Security(specTokens.map((token) => token.text));

  return {
    side,
    sourceKey: security.sourceKey,
    description: security.description,
    ticker: security.ticker,
    classHint: security.classHint,
    quantity,
    executionPrice,
    grossValue,
    netValue: null,
    market,
    flags,
    settlementDate: null,
    references: {},
  };
}

function parseTrades(page: PdfPage): ParsedNoteTrade[] {
  const header = findTradeHeader(page);

  if (!header) return [];

  const trades: ParsedNoteTrade[] = [];

  for (const line of page.lines.slice(header.index + 1)) {
    const text = normalizedLine(line);

    if (text.includes("resumo dos negocios")) return trades;
    if (text.startsWith("subtotal") || text.includes("continua")) continue;

    trades.push(parseTradeLine(line, header.columns));
  }

  // The table continues on the next page. Lines can only go missing at a
  // page break if the totals stop adding up, which `reconcile` refuses.
  return trades;
}

type NoteHeader = {
  noteNumber: string | null;
  tradeDate: string;
  account: string | null;
};

/**
 * The note header of a page, or `null` for a continuation page that only
 * carries the rest of the trades table or the financial summary.
 */
function parseHeader(page: PdfPage, format: InterFormat): NoteHeader | null {
  const lines = page.lines.map(normalizedLine);

  if (!lines.some((text) => text.includes("data pregao"))) return null;

  let noteNumber: string | null = null;
  let tradeDate: string | null = null;

  if (format === "inter-dtvm-web") {
    for (const text of lines) {
      const date = /data pregao:\s*(\d{2}\/\d{2}\/\d{4})/.exec(text);
      const number = /n[ºo°]\s*nota:\s*(\d+)/.exec(text);
      if (date?.[1]) tradeDate = parseBrazilianDate(date[1]);
      if (number?.[1]) noteNumber = number[1];
    }
  } else {
    const index = lines.findIndex(
      (text) => text.includes("nr. nota") && text.includes("data pregao"),
    );
    const values = index >= 0 ? (page.lines[index + 1]?.items ?? []) : [];
    const date = values.find((item) => /^\d{2}\/\d{2}\/\d{4}$/.test(item.text));
    const number = values.find((item) => /^\d+$/.test(item.text));

    if (date) tradeDate = parseBrazilianDate(date.text);
    if (number) noteNumber = number.text;
  }

  if (!tradeDate) layoutError("Trade date (Data pregão) not found");

  const accountIndex = lines.findIndex((text) =>
    text.includes("conta corrente"),
  );
  const accountItems =
    accountIndex >= 0 ? (page.lines[accountIndex + 1]?.items ?? []) : [];
  const account = accountItems.at(-1)?.text ?? null;

  return {
    // Inter prints `0` on some notes; that is not an identifier.
    noteNumber: noteNumber && /[1-9]/.test(noteNumber) ? noteNumber : null,
    tradeDate,
    account: account && /\d/.test(account) ? account : null,
  };
}

type FeeRule = { label: string; pattern: RegExp };

/** Itemized costs. Each label must start at an item boundary. */
const FEE_RULES: FeeRule[] = [
  {
    label: "Taxa de liquidação",
    pattern: /taxa de liquidacao(?:\(\d\))?/,
  },
  { label: "Taxa de registro", pattern: /taxa de registro(?:\(\d\))?/ },
  {
    label: "Taxa de termo/opções/futuro",
    pattern: /taxa de (?:termo\/)?opcoes\/futuro/,
  },
  { label: "Taxa A.N.A.", pattern: /taxa a\.n\.a\.?/ },
  { label: "Emolumentos", pattern: /emolumentos/ },
  {
    label: "Taxa de transferência de ativos",
    pattern: /taxa de trans?ferencia de ativos/,
  },
  { label: "Clearing", pattern: /clearing/ },
  { label: "Execução casa", pattern: /execucao casa/ },
  { label: "Execução", pattern: /execucao(?! casa)/ },
  { label: "Corretagem", pattern: /corretagem/ },
  { label: "ISS", pattern: /iss/ },
  { label: "Impostos", pattern: /impostos/ },
  { label: "Outras", pattern: /outras/ },
];

function labeled(label: RegExp, value: string): RegExp {
  return new RegExp(`(?:^|  )${label.source}\\s+${value}`);
}

/** All matches of a labeled amount, with its debit/credit flag. */
function findAmounts(
  lines: readonly string[],
  label: RegExp,
): { amount: string; flag: "d" | "c" | null; match: RegExpExecArray }[] {
  const pattern = labeled(label, `${AMOUNT}(?:\\s+([dc]))?(?=\\s|$)`);
  const found: {
    amount: string;
    flag: "d" | "c" | null;
    match: RegExpExecArray;
  }[] = [];

  for (const text of lines) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      found.push({
        amount: parseBrazilianAmount(match[1]),
        flag: (match[2] as "d" | "c" | undefined) ?? null,
        match,
      });
    }
  }

  return found;
}

type Amount = { amount: string; flag: "d" | "c" | null };

function optional(
  lines: readonly string[],
  label: RegExp,
  name: string,
): Amount | null {
  const found = findAmounts(lines, label);

  if (found.length > 1) layoutError(`"${name}" appears more than once`);

  return found[0] ?? null;
}

function required(
  lines: readonly string[],
  label: RegExp,
  name: string,
): Amount {
  return optional(lines, label, name) ?? layoutError(`"${name}" not found`);
}

/** Credit (`C`) is positive for the investor, debit (`D`) negative. */
function signed(entry: Amount): Decimal {
  const value = toDecimal(entry.amount);
  const magnitude = value < ZERO ? -value : value;

  if (entry.flag === "d") return -magnitude;
  if (entry.flag === "c") return magnitude;

  return value;
}

type Summary = {
  purchases: string;
  sales: string;
  netOperations: Decimal;
  net: Decimal;
  settlementDate: string;
  fees: BrokerNoteFee[];
  withheldTax: Decimal;
  withheldTaxBase: string | null;
  operationsTotal: string | null;
};

function parseSummary(page: PdfPage): Summary {
  const lines = page.lines.map(normalizedLine);
  const sales = required(lines, /vendas a vista/, "Vendas à vista");
  const purchases = required(lines, /compras a vista/, "Compras à vista");
  const netOperations = required(
    lines,
    /valor liquido das operacoes(?:\(1\))?/,
    "Valor líquido das operações",
  );
  const operationsTotal = optional(
    lines,
    /valor das operacoes/,
    "Valor das operações",
  );
  const netPattern = new RegExp(
    `(?:^|  )liquido para\\s+(\\d{2}\\/\\d{2}\\/\\d{4})\\s+${AMOUNT}(?:\\s+([dc]))?`,
  );
  const netMatches = lines
    .map((text) => netPattern.exec(text))
    .filter((match): match is RegExpExecArray => match !== null);

  if (netMatches.length !== 1) {
    layoutError("Expected exactly one Líquido para line");
  }

  const [, settlement = "", netAmount = "", netFlag] =
    netMatches[0] as RegExpExecArray;
  const fees: BrokerNoteFee[] = [];

  for (const rule of FEE_RULES) {
    for (const entry of findAmounts(lines, rule.pattern)) {
      // A fee printed without a flag is a cost, like a debit.
      const cost =
        entry.flag === null ? toDecimal(entry.amount) : -signed(entry);
      if (cost !== ZERO) {
        fees.push({ label: rule.label, amount: formatDecimal(cost, 2) });
      }
    }
  }

  const irrf =
    /(?:^| {2})i\.r\.r\.f\. s\/ operacoes,?(?:\s+base)?\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})/;
  const irrfMatches = lines
    .map((text) => irrf.exec(text))
    .filter((match): match is RegExpExecArray => match !== null);
  if (irrfMatches.length > 1) layoutError("IRRF appears more than once");

  const dayTradeIrrf = optional(
    lines,
    /irrf sobre day trade/,
    "IRRF sobre day trade",
  );
  const brokerageIr = optional(
    lines,
    /ir sobre corretagem/,
    "IR sobre corretagem",
  );
  if (brokerageIr && toDecimal(brokerageIr.amount) !== ZERO) {
    layoutError("A non-zero IR sobre corretagem is not supported yet");
  }

  const irrfMatch = irrfMatches[0];
  const irrfValue = irrfMatch?.[2]
    ? toDecimal(parseBrazilianAmount(irrfMatch[2]))
    : ZERO;
  const dayTradeValue = dayTradeIrrf ? toDecimal(dayTradeIrrf.amount) : ZERO;
  const abs = (value: Decimal) => (value < ZERO ? -value : value);

  return {
    purchases: purchases.amount,
    sales: sales.amount,
    netOperations: signed(netOperations),
    net: signed({
      amount: parseBrazilianAmount(netAmount),
      flag: (netFlag as "d" | "c" | undefined) ?? null,
    }),
    settlementDate: parseBrazilianDate(settlement),
    fees,
    withheldTax: add(abs(irrfValue), abs(dayTradeValue)),
    withheldTaxBase: irrfMatch?.[1] ? parseBrazilianAmount(irrfMatch[1]) : null,
    operationsTotal: operationsTotal?.amount ?? null,
  };
}

function sum(values: readonly string[]): Decimal {
  return values.reduce((total, value) => add(total, toDecimal(value)), ZERO);
}

/**
 * Every figure of the note must agree with its trade lines; any gap means
 * the document was misread and nothing is imported from it.
 */
function reconcile(
  trades: readonly ParsedNoteTrade[],
  summary: Summary,
): { feesTotal: Decimal } {
  const buys = sum(
    trades.filter((trade) => trade.side === "buy").map((t) => t.grossValue),
  );
  const sells = sum(
    trades.filter((trade) => trade.side === "sell").map((t) => t.grossValue),
  );
  const money = (value: Decimal) => formatDecimal(value, 2);

  if (compare(buys, toDecimal(summary.purchases)) !== 0) {
    reconciliationError(
      `Buys add up to ${money(buys)}, the note says ${summary.purchases}`,
    );
  }
  if (compare(sells, toDecimal(summary.sales)) !== 0) {
    reconciliationError(
      `Sells add up to ${money(sells)}, the note says ${summary.sales}`,
    );
  }
  if (compare(sub(sells, buys), summary.netOperations) !== 0) {
    reconciliationError(
      `Sells − buys is ${money(sub(sells, buys))}, the note says ${money(summary.netOperations)}`,
    );
  }
  if (
    summary.operationsTotal !== null &&
    compare(add(sells, buys), toDecimal(summary.operationsTotal)) !== 0
  ) {
    reconciliationError(
      `Operations add up to ${money(add(sells, buys))}, the note says ${summary.operationsTotal}`,
    );
  }

  const costs = sub(sub(sells, buys), summary.net);
  const itemized = sum(summary.fees.map((fee) => fee.amount));

  // Inter leaves IRRF out of the net amount; other layouts deduct it.
  if (
    compare(itemized, costs) !== 0 &&
    compare(add(itemized, summary.withheldTax), costs) !== 0
  ) {
    reconciliationError(
      `Itemized costs are ${money(itemized)}, the net amount implies ${money(costs)}`,
    );
  }

  return { feesTotal: itemized };
}

/** Consecutive pages of the same note (number and trade date). */
function groupPages(
  pages: readonly PdfPage[],
  format: InterFormat,
): { header: NoteHeader; pages: PdfPage[] }[] {
  const groups: { header: NoteHeader; pages: PdfPage[] }[] = [];

  for (const page of pages) {
    const header = parseHeader(page, format);
    const last = groups.at(-1);

    if (!header) {
      if (!last) layoutError("Trade date (Data pregão) not found");
      last.pages.push(page);
    } else if (
      last &&
      last.header.tradeDate === header.tradeDate &&
      last.header.noteNumber === header.noteNumber
    ) {
      last.pages.push(page);
    } else {
      groups.push({ header, pages: [page] });
    }
  }

  return groups;
}

export function parseInterDtvm(
  pages: readonly PdfPage[],
  format: InterFormat,
): ParsedBrokerNote[] {
  return groupPages(pages, format).map(({ header, pages: notePages }) => {
    const trades = notePages.flatMap(parseTrades);
    const summaryPages = notePages.filter((page) =>
      pageText(page).includes("liquido para"),
    );

    if (trades.length === 0) layoutError("The note has no trade lines");
    if (summaryPages.length !== 1) {
      layoutError(
        "Expected exactly one financial summary in the note; multi-page summaries are not supported yet",
      );
    }

    const summary = parseSummary(summaryPages[0] as PdfPage);
    const { feesTotal } = reconcile(trades, summary);

    return {
      format,
      currency: "BRL",
      noteNumber: header.noteNumber,
      account: header.account,
      tradeDate: header.tradeDate,
      settlementDate: summary.settlementDate,
      trades: trades.map((trade) => ({
        ...trade,
        settlementDate: summary.settlementDate,
      })),
      fees: summary.fees,
      purchasesTotal: formatDecimal(toDecimal(summary.purchases), 2),
      salesTotal: formatDecimal(toDecimal(summary.sales), 2),
      feesTotal: formatDecimal(feesTotal, 2),
      withheldTax: formatDecimal(summary.withheldTax, 2),
      withheldTaxBase: summary.withheldTaxBase,
      netAmount: formatDecimal(summary.net, 2),
    } satisfies ParsedBrokerNote;
  });
}
