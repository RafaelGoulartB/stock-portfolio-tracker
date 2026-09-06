/**
 * Fixed-point decimal arithmetic backed by `bigint`.
 *
 * Money must never touch IEEE-754 floats. Values are scaled integers with
 * {@link SCALE} decimal places, which matches the `numeric(22, 8)` columns.
 */

export const SCALE = 8;

const UNIT = 10n ** BigInt(SCALE);
const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

export type Decimal = bigint;

export const ZERO: Decimal = 0n;

/** Parses `"12.34"` into a scaled bigint. Throws on malformed input. */
export function toDecimal(value: string | number | bigint): Decimal {
  if (typeof value === "bigint") {
    return value * UNIT;
  }

  const raw = typeof value === "number" ? String(value) : value.trim();
  const match = DECIMAL_PATTERN.exec(raw);

  if (!match) {
    throw new Error(`Not a decimal value: ${raw}`);
  }

  const [, sign, whole, fraction = ""] = match as unknown as [
    string,
    string | undefined,
    string,
    string | undefined,
  ];

  if (fraction.length > SCALE) {
    throw new Error(`More than ${SCALE} decimal places: ${raw}`);
  }

  const scaled =
    BigInt(whole) * UNIT + BigInt(fraction.padEnd(SCALE, "0") || "0");

  return sign === "-" ? -scaled : scaled;
}

export function add(a: Decimal, b: Decimal): Decimal {
  return a + b;
}

export function sub(a: Decimal, b: Decimal): Decimal {
  return a - b;
}

/** Divides two scaled integers, rounding half away from zero. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("Division by zero");
  }

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

export function mul(a: Decimal, b: Decimal): Decimal {
  return divideRounded(a * b, UNIT);
}

export function div(a: Decimal, b: Decimal): Decimal {
  return divideRounded(a * UNIT, b);
}

export function isZero(value: Decimal): boolean {
  return value === 0n;
}

export function isNegative(value: Decimal): boolean {
  return value < 0n;
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

/** Renders a scaled bigint as a plain decimal string with `places` digits. */
export function formatDecimal(value: Decimal, places = SCALE): string {
  if (places < 0 || places > SCALE) {
    throw new Error(`Unsupported precision: ${places}`);
  }

  const rounded = divideRounded(value, 10n ** BigInt(SCALE - places));
  const negative = rounded < 0n;
  const digits = (negative ? -rounded : rounded)
    .toString()
    .padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const fraction = places > 0 ? digits.slice(digits.length - places) : "";
  const text = fraction ? `${whole}.${fraction}` : whole;

  return negative && rounded !== 0n ? `-${text}` : text;
}
