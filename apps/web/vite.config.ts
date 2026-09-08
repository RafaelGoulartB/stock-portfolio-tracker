import path from "node:path";
import { fileURLToPath } from "node:url";
import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { LOCALE_STORAGE_KEY, LOCALES, SOURCE_LOCALE } from "./src/i18n/locales";
import { linguiCatalogPreload } from "./vite-plugins/lingui-catalog-preload";

const dir = path.dirname(fileURLToPath(import.meta.url));

const port = process.env.WEB_PORT ? Number(process.env.WEB_PORT) : 5173;

const apiPort = process.env.API_PORT ? Number(process.env.API_PORT) : 3001;

export default defineConfig({
  envDir: path.resolve(dir, "../.."),
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    lingui(),
    babel({ presets: [linguiTransformerBabelPreset()] }),
    linguiCatalogPreload({
      locales: LOCALES,
      storageKey: LOCALE_STORAGE_KEY,
      sourceLocale: SOURCE_LOCALE,
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(dir, "./src"),
    },
  },
  server: {
    host: "localhost",
    port,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
      "/trpc": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
