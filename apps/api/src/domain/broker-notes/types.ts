import type { BrokerNoteFileError } from "@portifolio-tracker/shared";

/** The parser's output travels to the browser and back, so it is a contract. */
export type {
  ParsedBrokerNote,
  ParsedNoteTrade,
} from "@portifolio-tracker/shared";

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
