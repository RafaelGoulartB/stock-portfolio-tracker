import type { PdfPage } from "../../lib/pdf-text";
import { detectApex, parseApex } from "./apex";
import { detectDriveWealth, parseDriveWealth } from "./drivewealth";
import { detectInterDtvm, parseInterDtvm } from "./inter-dtvm";
import { BrokerNoteParseError, type ParsedBrokerNote } from "./types";

/**
 * Reads every note of one document. Throws {@link BrokerNoteParseError}
 * when the layout is unknown or any figure fails to reconcile: a document
 * is imported completely or not at all.
 */
export function parseBrokerNotePages(
  pages: readonly PdfPage[],
): ParsedBrokerNote[] {
  const inter = detectInterDtvm(pages);

  if (inter) return parseInterDtvm(pages, inter);
  if (detectApex(pages)) return parseApex(pages);
  if (detectDriveWealth(pages)) return parseDriveWealth(pages);

  throw new BrokerNoteParseError(
    "unknown_format",
    "This document is not a supported broker note",
  );
}
