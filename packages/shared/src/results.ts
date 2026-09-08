import { z } from "zod";
import { isoDate } from "./decimal";

export const RESULT_DATE_SOURCES = [
  "cvm_b3",
  "alpha_vantage",
  "yahoo",
] as const;

export const resultDateSourceSchema = z.enum(RESULT_DATE_SOURCES);
export type ResultDateSource = z.infer<typeof resultDateSourceSchema>;

/** Next scheduled earnings release for one allocation asset. */
export const nextResultSchema = z.object({
  ticker: z.string(),
  date: isoDate,
  /** Human-readable fiscal period such as `3Q26` or `FY25`. */
  period: z.string().nullable(),
  source: resultDateSourceSchema,
  /** True when the provider explicitly marks the date as an estimate. */
  estimated: z.boolean(),
});

export type NextResult = z.infer<typeof nextResultSchema>;

export const nextResultsResponseSchema = z.object({
  results: z.array(nextResultSchema),
  checkedAt: z.string().datetime(),
});

export type NextResultsResponse = z.infer<typeof nextResultsResponseSchema>;
