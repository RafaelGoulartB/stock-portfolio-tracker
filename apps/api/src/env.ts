import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Optional free key. Automatic dividends gracefully fall back to Yahoo. */
  ALPHA_VANTAGE_API_KEY: z.string().min(1).optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === "production";
