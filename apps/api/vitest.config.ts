import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://portifolio:portifolio@127.0.0.1:5432/portifolio",
    },
  },
});
