import type {
  AssetClass,
  BrokerNoteFee,
  BrokerNoteFileError,
  BrokerNoteFormat,
  Currency,
  TransactionSide,
} from "@portifolio-tracker/shared";

/** One trade line as printed. Every amount is a decimal string. */
export type ParsedNoteTrade = {
  side: TransactionSide;
  /** Stable key of the security across notes of the same market. */
  sourceKey: string;
  description: string;
  /** Ticker printed by the document, if any. */
  ticker: string | null;
  /** Class suggested by the document for a ticker without trades. */
  classHint: AssetClass;
  quantity: string;
  executionPrice: string;
  /** Line value (B3) or principal (US), in cents. */
  grossValue: string;
  /**
   * Cash the line settles for, fees included (US confirmations price each
   * line). `null` when the costs are printed once for the whole note (B3).
   */
  netValue: string | null;
  market: string | null;
  flags: string[];
  settlementDate: string | null;
  references: Record<string, string>;
};

export type ParsedBrokerNote = {
  format: BrokerNoteFormat;
  currency: Currency;
  noteNumber: string | null;
  account: string | null;
  tradeDate: string;
  settlementDate: string | null;
  trades: ParsedNoteTrade[];
  /** Itemized note-level costs (B3); empty when each line prices its own. */
  fees: BrokerNoteFee[];
  purchasesTotal: string;
  salesTotal: string;
  /** Total costs; signed, a broker credit larger than fees is negative. */
  feesTotal: string;
  withheldTax: string;
  withheldTaxBase: string | null;
  /** Signed settlement: positive is credited to the investor. */
  netAmount: string;
};

/**
 * A document that cannot be read with certainty. The message is technical
 * and in English; the code is what the UI translates.
 */
export class BrokerNoteParseError extends Error {
  constructor(
    readonly code: Exclude<
      BrokerNoteFileError,
      "not_pdf" | "too_large" | "password_protected" | "unreadable"
    >,
    message: string,
  ) {
    super(message);
    this.name = "BrokerNoteParseError";
  }
}
