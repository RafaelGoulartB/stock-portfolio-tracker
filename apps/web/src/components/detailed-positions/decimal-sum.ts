/**
 * Presentation-only exact summation of decimal strings.
 *
 * The API delivers money as decimal strings to preserve precision. When the
 * footer totals reflect the *filtered* rows on screen it has to add those
 * strings itself, and `Number` addition would reintroduce binary-float drift
 * (`0.1 + 0.2`). This helper accumulates in `BigInt` scaled integers so the
 * result matches the stored decimals exactly, then renders a fixed-scale
 * string that {@link formatMoney} and friends already expect.
 *
 * This is a display aid, not a stored calculation: authoritative money math
 * still lives in the API domain. Keep the scale generous enough for any
 * decimal the API emits.
 */
const SCALE = 8;

/**
 * Parse a decimal string into a `BigInt` scaled to {@link SCALE} fractional
 * digits. Nullish and blank inputs count as zero so callers can sum optional
 * columns (an unquoted market value) without branching.
 */
function toScaled(value: string | null | undefined): bigint {
  if (value == null) {
    return 0n;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return 0n;
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");

  const paddedFraction = fraction.slice(0, SCALE).padEnd(SCALE, "0");
  const digits = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "");
  const magnitude = BigInt(digits === "" ? "0" : digits);

  return negative ? -magnitude : magnitude;
}

/** Render a scaled `BigInt` back to a fixed-decimal string with `digits`. */
function fromScaled(scaled: bigint, digits: number): string {
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;

  // Round half-up to the requested display scale before formatting.
  const dropped = SCALE - digits;
  let rounded = magnitude;

  if (dropped > 0) {
    const divisor = 10n ** BigInt(dropped);
    const remainder = magnitude % divisor;
    rounded = magnitude / divisor;

    if (remainder * 2n >= divisor) {
      rounded += 1n;
    }
  }

  const scaleFactor = 10n ** BigInt(digits);
  const whole = rounded / scaleFactor;
  const fraction = rounded % scaleFactor;
  const sign = negative && rounded !== 0n ? "-" : "";

  if (digits === 0) {
    return `${sign}${whole}`;
  }

  const fractionText = fraction.toString().padStart(digits, "0");

  return `${sign}${whole}.${fractionText}`;
}

/**
 * Sum decimal strings exactly and return a decimal string with `digits`
 * fractional places (two by default, matching money display). Missing values
 * are treated as zero.
 */
export function sumDecimalStrings(
  values: Array<string | null | undefined>,
  digits = 2,
): string {
  let total = 0n;

  for (const value of values) {
    total += toScaled(value);
  }

  return fromScaled(total, digits);
}
