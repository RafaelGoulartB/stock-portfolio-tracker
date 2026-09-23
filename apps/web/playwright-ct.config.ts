import path from "node:path";
import { fileURLToPath } from "node:url";
import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import { defineConfig, devices } from "@playwright/experimental-ct-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./playwright",
  testMatch: "**/*.spec.tsx",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
    ctViteConfig: {
      plugins: [
        lingui(),
        babel({ presets: [linguiTransformerBabelPreset()] }),
        tailwindcss(),
      ],
      resolve: {
        alias: {
          "@": path.resolve(dir, "./src"),
        },
      },
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
