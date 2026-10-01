import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n";

type CodeCarrier = {
  data?: { code?: string } | null;
};

/** Stable tRPC codes come from the API; sentences are translated here. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const data = (error as CodeCarrier).data;

  return typeof data?.code === "string" ? data.code : undefined;
}

const invalidCredentials = msg({
  id: "auth.invalidCredentials",
  message: "Invalid email or password.",
});

const emailRegistered = msg({
  id: "auth.emailRegistered",
  message: "This email is already registered.",
});

const sessionExpired = msg({
  id: "error.sessionExpired",
  message: "Your session expired. Sign in again.",
});

const unknownError = msg({
  id: "error.unknown",
  message: "Something went wrong. Try again.",
});

const holdingsShort = msg({
  id: "transactions.holdingsShort",
  message: "You do not hold enough of this ticker to sell.",
});

const currencyMismatch = msg({
  id: "transactions.currencyMismatch",
  message: "This ticker is already tracked in another currency.",
});

const fixedIncomeExists = msg({
  id: "transactions.fixedIncomeExists",
  message:
    "This fixed-income balance already exists. Update its value from Allocation.",
});

const bookBatchInvalid = msg({
  id: "transactions.bookBatchInvalid",
  message: "Could not book these holdings. Check for duplicates or bad rows.",
});

const transactionMissing = msg({
  id: "transactions.notFound",
  message: "Transaction not found.",
});

const editOversells = msg({
  id: "transactions.editOversells",
  message:
    "This edit would leave a later sale without enough shares. Adjust or remove that sale first.",
});

const removeOversells = msg({
  id: "transactions.removeOversells",
  message:
    "Removing this trade would leave a later sale without enough shares. Remove or adjust that sale first.",
});

const importedTradeLocked = msg({
  id: "transactions.importedTradeLocked",
  message:
    "This trade was imported from a broker note. Delete the note to remove its trades.",
});

const editConflict = msg({
  id: "transactions.editConflict",
  message: "This trade changed meanwhile. Reload and try again.",
});

const ptaxUnavailable = msg({
  id: "transactions.ptaxUnavailable",
  message: "Could not reach the BCB PTAX service. Try again later.",
});

const loadFailed = msg({
  id: "error.loadFailed",
  message: "Could not load this data. Try again.",
});

const categoryNameTaken = msg({
  id: "categories.nameTaken",
  message: "A category with this name already exists.",
});

const categoryMissing = msg({
  id: "categories.notFound",
  message: "Category not found.",
});

const unknownTicker = msg({
  id: "categories.unknownTicker",
  message: "That ticker is not in your portfolio.",
});

function isAuthCode(code: string | undefined): boolean {
  return code === "UNAUTHORIZED" || code === "FORBIDDEN";
}

export function authErrorMessage(
  error: unknown,
  action: "login" | "register",
): string {
  const code = codeOf(error);

  if (action === "register" && code === "CONFLICT") {
    return i18n._(emailRegistered);
  }

  if (code === "UNAUTHORIZED" || code === "BAD_REQUEST") {
    return i18n._(invalidCredentials);
  }

  if (isAuthCode(code)) {
    return i18n._(sessionExpired);
  }

  return i18n._(unknownError);
}

export function createTradeErrorMessage(error: unknown): string {
  if (codeOf(error) === "CONFLICT") {
    return i18n._(fixedIncomeExists);
  }

  if (codeOf(error) === "PRECONDITION_FAILED") {
    return i18n._(currencyMismatch);
  }

  if (codeOf(error) === "BAD_REQUEST") {
    return i18n._(holdingsShort);
  }

  if (isAuthCode(codeOf(error))) {
    return i18n._(sessionExpired);
  }

  return i18n._(unknownError);
}

export function bookHoldingsErrorMessage(error: unknown): string {
  if (codeOf(error) === "PRECONDITION_FAILED") {
    return i18n._(currencyMismatch);
  }

  if (codeOf(error) === "BAD_REQUEST") {
    return i18n._(bookBatchInvalid);
  }

  if (isAuthCode(codeOf(error))) {
    return i18n._(sessionExpired);
  }

  return i18n._(unknownError);
}

/** True when the portfolio needs an USD/BRL rate it was not given. */
export function isFxRateRequired(error: unknown): boolean {
  if (codeOf(error) !== "BAD_REQUEST" || typeof error !== "object") {
    return false;
  }

  const message =
    error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  return message.toLowerCase().includes("rate");
}

export function updateTradeErrorMessage(error: unknown): string {
  const code = codeOf(error);

  if (code === "NOT_FOUND") {
    return i18n._(transactionMissing);
  }

  if (code === "CONFLICT") {
    return i18n._(editConflict);
  }

  if (code === "UNPROCESSABLE_CONTENT") {
    return i18n._(importedTradeLocked);
  }

  if (code === "PRECONDITION_FAILED") {
    return i18n._(currencyMismatch);
  }

  if (code === "BAD_REQUEST") {
    return i18n._(editOversells);
  }

  if (isAuthCode(code)) {
    return i18n._(sessionExpired);
  }

  return i18n._(unknownError);
}

export function fillTradeFxErrorMessage(error: unknown): string {
  const code = codeOf(error);

  if (code === "BAD_GATEWAY") {
    return i18n._(ptaxUnavailable);
  }

  if (isAuthCode(code)) {
    return i18n._(sessionExpired);
  }

  return i18n._(unknownError);
}

const splitNoHolding = msg({
  id: "splits.noHolding",
  message: "There is no trade of this ticker before that date.",
});

const splitExists = msg({
  id: "splits.exists",
  message: "A split on this date is already recorded.",
});

const splitOversells = msg({
  id: "splits.oversells",
  message:
    "This would leave a later sale without enough shares in the new units.",
});

const splitMissing = msg({
  id: "splits.notFound",
  message: "Split not found.",
});

export function splitErrorMessage(error: unknown): string {
  const code = codeOf(error);

  if (code === "PRECONDITION_FAILED") return i18n._(splitNoHolding);
  if (code === "CONFLICT") return i18n._(splitExists);
  if (code === "BAD_REQUEST") return i18n._(splitOversells);
  if (code === "NOT_FOUND") return i18n._(splitMissing);
  if (isAuthCode(code)) return i18n._(sessionExpired);

  return i18n._(unknownError);
}

export function removeTradeErrorMessage(error: unknown): string {
  const code = codeOf(error);

  if (code === "NOT_FOUND") {
    return i18n._(transactionMissing);
  }

  if (code === "UNPROCESSABLE_CONTENT") {
    return i18n._(importedTradeLocked);
  }

  if (code === "BAD_REQUEST") {
    return i18n._(removeOversells);
  }

  if (isAuthCode(code)) {
    return i18n._(sessionExpired);
  }

  return i18n._(unknownError);
}

export function queryErrorMessage(error: unknown): string {
  if (isAuthCode(codeOf(error))) {
    return i18n._(sessionExpired);
  }

  return i18n._(loadFailed);
}

export function categoryErrorMessage(error: unknown): string {
  const code = codeOf(error);

  if (code === "CONFLICT") {
    return i18n._(categoryNameTaken);
  }

  if (code === "NOT_FOUND") {
    return i18n._(categoryMissing);
  }

  if (code === "BAD_REQUEST") {
    return i18n._(unknownTicker);
  }

  if (isAuthCode(code)) {
    return i18n._(sessionExpired);
  }

  return i18n._(unknownError);
}

const brokerNoteFilesInvalid = msg({
  id: "brokerNotes.filesInvalid",
  message: "Select at most 20 PDF files of up to 5 MB each.",
});

const brokerNoteStale = msg({
  id: "brokerNotes.importStale",
  message:
    "Some selected notes can no longer be imported. They were checked again; review them before importing.",
});

const brokerNoteConflict = msg({
  id: "brokerNotes.importConflict",
  message:
    "These notes or their tickers changed meanwhile. They were checked again; review them before importing.",
});

const brokerNoteMissing = msg({
  id: "brokerNotes.notFound",
  message: "Broker note not found.",
});

const brokerNoteRemoveOversells = msg({
  id: "brokerNotes.removeOversells",
  message:
    "Deleting this note would leave a later sale without enough shares. Delete the later note or sale first.",
});

export function brokerNotePreviewErrorMessage(error: unknown): string {
  const code = codeOf(error);

  if (code === "BAD_REQUEST") return i18n._(brokerNoteFilesInvalid);
  if (isAuthCode(code)) return i18n._(sessionExpired);

  return i18n._(unknownError);
}

export function brokerNoteImportErrorMessage(error: unknown): string {
  const code = codeOf(error);

  if (code === "PRECONDITION_FAILED") return i18n._(brokerNoteStale);
  if (code === "CONFLICT") return i18n._(brokerNoteConflict);
  if (code === "BAD_REQUEST") return i18n._(brokerNoteFilesInvalid);
  if (isAuthCode(code)) return i18n._(sessionExpired);

  return i18n._(unknownError);
}

export function removeBrokerNoteErrorMessage(error: unknown): string {
  const code = codeOf(error);

  if (code === "NOT_FOUND") return i18n._(brokerNoteMissing);
  if (code === "BAD_REQUEST") return i18n._(brokerNoteRemoveOversells);
  if (isAuthCode(code)) return i18n._(sessionExpired);

  return i18n._(unknownError);
}
