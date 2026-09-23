import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const envPath = resolve(
  repositoryRoot,
  process.env.PORTFOLIO_ENV_FILE ?? ".env",
);

if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://portifolio:portifolio@127.0.0.1:5432/portifolio",
  },
});
