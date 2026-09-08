import type {
  AllocationRow,
  AllocationSummary,
} from "@portifolio-tracker/shared";

const SCALE = 100_000_000n;
const SCALE_PLACES = 8;

/** Parses a decimal string into a scaled bigint; empty/invalid becomes 0. */
function toScaled(value: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());

  if (!match) {
    return 0n;
  }

  const negative = match[1] === "-";
  const whole = BigInt(match[2] ?? "0");
  const frac = BigInt(
    (match[3] ?? "").padEnd(SCALE_PLACES, "0").slice(0, SCALE_PLACES),
  );
  const scaled = whole * SCALE + frac;

  return negative ? -scaled : scaled;
}

/** Renders a scaled bigint with `places` digits, rounding half away from zero. */
function fromScaled(value: bigint, places: number): string {
  const divisor = 10n ** BigInt(SCALE_PLACES - places);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  const digits = rounded.toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const fraction = places > 0 ? digits.slice(digits.length - places) : "";
  const text = fraction ? `${whole}.${fraction}` : whole;

  return negative && rounded !== 0n ? `-${text}` : text;
}

/** Average of scaled values, rounding half away from zero. */
function averageScaled(sum: bigint, count: number): bigint {
  const denominator = BigInt(count);
  const negative = sum < 0n;
  const absolute = negative ? -sum : sum;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;

  return negative && rounded !== 0n ? -rounded : rounded;
}

/**
 * Totals for the rows currently shown (search, category and radar filters).
 * Matches the server summary shape so the footer and footnote stay consistent.
 */
export function summarizeVisibleRows(
  rows: readonly AllocationRow[],
  displayCurrency: AllocationSummary["displayCurrency"],
  scoreVersion: string,
): AllocationSummary {
  let totalMarketValue = 0n;
  let totalTargetWeight = 0n;
  let totalCurrentWeight = 0n;
  let discountSum = 0n;
  let discountCount = 0;
  let investedAssets = 0;
  let watchOnlyAssets = 0;
  let candidates = 0;
  let blocked = 0;
  let trimCandidates = 0;

  for (const row of rows) {
    if (row.marketValue !== null) {
      totalMarketValue += toScaled(row.marketValue);
    }

    if (row.targetWeight !== null) {
      totalTargetWeight += toScaled(row.targetWeight);
    }

    totalCurrentWeight += toScaled(row.currentWeight);

    if (row.discount !== null) {
      discountSum += toScaled(row.discount);
      discountCount += 1;
    }

    if (row.hasPosition) {
      investedAssets += 1;
    } else {
      watchOnlyAssets += 1;
    }

    const score = Number(row.score.value);

    if (score > 0) {
      candidates += 1;
    } else if (score < 0) {
      trimCandidates += 1;
    }

    if (row.score.blocked) {
      blocked += 1;
    }
  }

  return {
    displayCurrency,
    totalMarketValue: fromScaled(totalMarketValue, 2),
    totalTargetWeight: fromScaled(totalTargetWeight, 8),
    totalCurrentWeight: fromScaled(totalCurrentWeight, 8),
    averageDiscount:
      discountCount === 0
        ? null
        : fromScaled(averageScaled(discountSum, discountCount), 8),
    investedAssets,
    watchOnlyAssets,
    candidates,
    blocked,
    trimCandidates,
    scoreVersion,
  };
}
