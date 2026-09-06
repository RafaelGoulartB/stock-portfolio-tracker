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

const transactionMissing = msg({
  id: "transactions.notFound",
  message: "Transaction not found.",
});

const loadFailed = msg({
  id: "error.loadFailed",
  message: "Could not load this data. Try again.",
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

export function removeTradeErrorMessage(error: unknown): string {
  const code = codeOf(error);

  if (code === "NOT_FOUND") {
    return i18n._(transactionMissing);
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
