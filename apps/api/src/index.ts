import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "./db";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
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

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: () => createContext(),
  }),
);

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`API listening on http://127.0.0.1:${info.port}`);
});
