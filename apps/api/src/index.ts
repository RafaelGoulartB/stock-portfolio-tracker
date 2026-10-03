import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "./db";
import { isProduction } from "./env";
import { streamingCompress } from "./lib/compression";
import { runWithRequestMemo } from "./lib/request-memo";
import { deleteExpiredSessions } from "./lib/session";
import { dataBackupRoutes } from "./routes/data-backup";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

const app = new Hono();

// Outermost, so nothing else touches the response after its body has been
// handed to gzip.
app.use("*", streamingCompress());

app.use("*", async (_c, next) => {
  await runWithRequestMemo(() => next());
});

if (!isProduction) {
  app.use(
    "*",
    cors({
      origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
      credentials: true,
    }),
  );
}

app.get("/health", async (c) => {
  try {
    await sql`SELECT 1`;
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 503);
  }
});

app.route("/api/data", dataBackupRoutes);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (opts, c) => createContext(c, opts.resHeaders),
  }),
);

if (isProduction) {
  const webDistPath = fileURLToPath(new URL("../../web/dist", import.meta.url));
  const webIndexPath = join(webDistPath, "index.html");

  if (!existsSync(webIndexPath)) {
    throw new Error(
      `Web build not found at ${webIndexPath}. Run \`pnpm build:local\` first.`,
    );
  }

  const isBackendPath = (path: string) =>
    path === "/health" ||
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/trpc" ||
    path.startsWith("/trpc/");

  const serveWebFile = serveStatic({
    root: webDistPath,
    onFound(path, c) {
      c.header(
        "Cache-Control",
        path.includes("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
    },
  });
  const serveWebIndex = serveStatic({
    path: webIndexPath,
    onFound(_path, c) {
      c.header("Cache-Control", "no-cache");
    },
  });

  app.use("*", async (c, next) => {
    if (isBackendPath(c.req.path)) return next();

    // Browser storage is scoped by hostname. Keep one canonical local origin
    // so localhost and 127.0.0.1 cannot appear to have different sessions.
    const requestUrl = new URL(c.req.url);
    if (requestUrl.hostname === "127.0.0.1") {
      requestUrl.hostname = "localhost";
      return c.redirect(requestUrl.toString(), 307);
    }

    return serveWebFile(c, next);
  });

  app.get("*", async (c, next) => {
    if (isBackendPath(c.req.path)) return c.notFound();
    return serveWebIndex(c, next);
  });
}

deleteExpiredSessions().catch((error) => {
  console.error("Failed to prune expired sessions", error);
});

const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3001;
const hostname = "127.0.0.1";

serve({ fetch: app.fetch, hostname, port }, (info) => {
  console.log(`Portfolio Tracker listening on http://${hostname}:${info.port}`);
});
