import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "./db";
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

app.use(
  "*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    credentials: true,
  }),
);

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
    createContext: (_opts, c) => createContext(c),
  }),
);

deleteExpiredSessions().catch((error) => {
  console.error("Failed to prune expired sessions", error);
});

const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3001;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://127.0.0.1:${info.port}`);
});
