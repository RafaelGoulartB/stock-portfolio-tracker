import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  BROKER_NOTE_FORMAT_LABELS,
  type BrokerNoteFileError,
  type BrokerNoteFormat,
  type BrokerNoteIssue,
  type BrokerNoteStatus,
} from "@portifolio-tracker/shared";
import { Badge } from "@/components/ui/badge";
import { formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Broker names are proper nouns and need no translation. */
export function brokerName(format: BrokerNoteFormat): string {
  return BROKER_NOTE_FORMAT_LABELS[format];
}

export function BrokerNoteStatusBadge({
  status,
}: {
  status: BrokerNoteStatus;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "ready" && "border-gain/40 text-gain",
        status === "blocked" && "border-loss/40 text-loss",
        (status === "imported" || status === "duplicate") &&
          "text-muted-foreground",
      )}
    >
      {status === "ready" ? (
        <Trans id="brokerNotes.statusReady">Ready</Trans>
      ) : status === "blocked" ? (
        <Trans id="brokerNotes.statusBlocked">Needs attention</Trans>
      ) : status === "imported" ? (
        <Trans id="brokerNotes.statusImported">Already imported</Trans>
      ) : (
        <Trans id="brokerNotes.statusDuplicate">Repeated in this upload</Trans>
      )}
    </Badge>
  );
}

export function brokerNoteIssueText(
  issue: BrokerNoteIssue,
  i18n: I18n,
): string {
  const ticker = issue.ticker ?? "";

  switch (issue.code) {
    case "unmapped_security": {
      const description = issue.description ?? "";

      return i18n._(
        msg({
          id: "brokerNotes.issueUnmapped",
          message: `Choose the ticker of “${description}” below.`,
        }),
      );
    }
    case "currency_conflict":
      return i18n._(
        msg({
          id: "brokerNotes.issueCurrency",
          message: `${ticker} is already tracked in another currency.`,
        }),
      );
    case "fixed_income_conflict":
      return i18n._(
        msg({
          id: "brokerNotes.issueFixedIncome",
          message: `${ticker} is a fixed-income balance and cannot receive trades.`,
        }),
      );
    case "oversell": {
      const available = formatQuantity(issue.available ?? "0");

      return i18n._(
        msg({
          id: "brokerNotes.issueOversell",
          message: `This note sells more ${ticker} than you held then (${available}). Import older notes or register earlier trades first.`,
        }),
      );
    }
  }
}

export function brokerNoteFileErrorText(
  error: BrokerNoteFileError,
  i18n: I18n,
): string {
  switch (error) {
    case "not_pdf":
      return i18n._(
        msg({
          id: "brokerNotes.fileNotPdf",
          message: "This file is not a PDF.",
        }),
      );
    case "too_large":
      return i18n._(
        msg({
          id: "brokerNotes.fileTooLarge",
          message: "This file is larger than 5 MB.",
        }),
      );
    case "password_protected":
      return i18n._(
        msg({
          id: "brokerNotes.filePassword",
          message:
            "This PDF is password-protected. Save a copy without the password and try again.",
        }),
      );
    case "unreadable":
      return i18n._(
        msg({
          id: "brokerNotes.fileUnreadable",
          message: "This PDF could not be read.",
        }),
      );
    case "too_many_pages":
      return i18n._(
        msg({
          id: "brokerNotes.fileTooManyPages",
          message: "This PDF has too many pages for a broker note.",
        }),
      );
    case "unknown_format":
      return i18n._(
        msg({
          id: "brokerNotes.fileUnknown",
          message:
            "This is not a supported broker note. Supported: Inter DTVM (B3), Apex Clearing and DriveWealth (US).",
        }),
      );
    case "unsupported_market":
      return i18n._(
        msg({
          id: "brokerNotes.fileUnsupportedMarket",
          message:
            "This note has options, futures or other markets that are not supported. Nothing was read from it.",
        }),
      );
    case "invalid_layout":
      return i18n._(
        msg({
          id: "brokerNotes.fileInvalidLayout",
          message:
            "The layout of this note was not recognized with certainty. Nothing was read from it.",
        }),
      );
    case "reconciliation_failed":
      return i18n._(
        msg({
          id: "brokerNotes.fileReconciliation",
          message:
            "The totals of this note do not match its trades, so nothing was read from it.",
        }),
      );
  }
}
