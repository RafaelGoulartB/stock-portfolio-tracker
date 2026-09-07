import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Kept deliberately small for Neon pooled connections per API instance. */
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(10).default(3),
  DATABASE_IDLE_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(300)
    .default(30),
  /** Optional free key. Automatic dividends gracefully fall back to Yahoo. */
  ALPHA_VANTAGE_API_KEY: z.string().min(1).optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === "production";
