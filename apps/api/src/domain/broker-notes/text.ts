import { BrokerNoteParseError } from "./types";

/** Lowercase, accent-free text for label matching. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function layoutError(message: string): never {
  throw new BrokerNoteParseError("invalid_layout", message);
}

/**
 * Strict Brazilian amount: `1.205,96`, `0,51`, `-102,32` or a whole
 * number such as `1.000`. Returns a plain decimal string (`1205.96`).
 */
export function parseBrazilianAmount(raw: string): string {
  const text = raw.trim();
  const match = /^(-)?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,8}))?$/.exec(text);

  if (!match) layoutError(`Not a Brazilian amount: "${raw}"`);

  const [, sign = "", whole = "", fraction] = match;
  const digits = whole.replace(/\./g, "");

  return `${sign}${digits}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Strict US amount: `1,234.56`, `$0.00`, `($494.84)`, `-0.38281`.
 * Parentheses and a leading minus are negative.
 */
export function parseUsAmount(raw: string): string {
  const text = raw.trim();
  const match =
    /^(\()?(-)?\$?(\d{1,3}(?:,\d{3})*|\d*)(?:\.(\d{1,8}))?(\))?$/.exec(text);

  if (!match) layoutError(`Not a US amount: "${raw}"`);

  const [, open, minus, whole = "", fraction, close] = match;

  if (Boolean(open) !== Boolean(close) || (whole === "" && !fraction)) {
    layoutError(`Not a US amount: "${raw}"`);
  }

  const negative = Boolean(open) || Boolean(minus);
  const digits = whole.replace(/,/g, "") || "0";

  return `${negative ? "-" : ""}${digits}${fraction ? `.${fraction}` : ""}`;
}

function isoFromParts(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    layoutError(`Not a calendar date: ${year}-${month}-${day}`);
  }

  return date.toISOString().slice(0, 10);
}

/** `31/01/2024` → `2024-01-31`. */
export function parseBrazilianDate(raw: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());

  if (!match) layoutError(`Not a dd/mm/yyyy date: "${raw}"`);

  return isoFromParts(Number(match[3]), Number(match[2]), Number(match[1]));
}

/** `03/06/24` or `9/1/2026` (month first) → ISO date. */
export function parseUsDate(raw: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw.trim());

  if (!match) layoutError(`Not a US date: "${raw}"`);

  const year = Number(match[3]);

  return isoFromParts(
    match[3]?.length === 2 ? 2000 + year : year,
    Number(match[1]),
    Number(match[2]),
  );
}
