import { z } from "zod";

/**
 * Decimal values travel as strings so they never lose precision in JSON.
 * Postgres stores them as `numeric`.
 */
const DECIMAL_PATTERN = /^\d{1,14}(\.\d{1,8})?$/;
const NON_ZERO_PATTERN = /[1-9]/;

export const nonNegativeDecimal = z
  .string()
  .trim()
  .regex(DECIMAL_PATTERN, "Use digits with up to 8 decimal places");

export const positiveDecimal = nonNegativeDecimal.refine(
  (value) => NON_ZERO_PATTERN.test(value),
  "Must be greater than zero",
);

export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Not a valid calendar date");

/**
 * Signed decimal string, e.g. a discount that can turn negative when the
 * market price runs above the fair value.
 */
export const signedDecimal = z
  .string()
  .trim()
  .regex(/^-?\d{1,14}(\.\d{1,8})?$/, "Use digits with up to 8 decimal places");
