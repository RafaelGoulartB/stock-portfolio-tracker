import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export const sql = postgres(env.DATABASE_URL, {
  max: env.DATABASE_MAX_CONNECTIONS,
  idle_timeout: env.DATABASE_IDLE_TIMEOUT_SECONDS,
});
export const db = drizzle(sql, { schema });
