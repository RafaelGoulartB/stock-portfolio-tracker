import { gunzipSync } from "node:zlib";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { streamingCompress } from "../lib/compression";
import { createContext } from "./context";
import { publicProcedure, router } from "./trpc";

vi.mock("../lib/session", () => ({
  SESSION_COOKIE: "portifolio_session",
  findSessionUser: vi.fn(async (token: string) =>
    token === "issued-token"
      ? { id: "user-1", email: "user@example.com" }
      : null,
  ),
}));

const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000);
const testRouter = router({
  login: publicProcedure.mutation(({ ctx }) => {
    ctx.setSessionCookie("issued-token", expiresAt);
    return { ok: true };
  }),
  logout: publicProcedure.mutation(({ ctx }) => {
    ctx.clearSessionCookie();
    return { ok: true };
  }),
  me: publicProcedure.query(({ ctx }) => ctx.user),
});

function app() {
  const instance = new Hono();
  instance.use("*", streamingCompress());
  instance.use(
    "/trpc/*",
    trpcServer({
      router: testRouter,
      createContext: (opts, c) => createContext(c, opts.resHeaders),
    }),
  );
  return instance;
}

describe("session cookies through the tRPC HTTP adapter", () => {
  it.each([false, true])(
    "keeps login authenticated with gzip=%s",
    async (gzip) => {
      const instance = app();
      const response = await instance.request("/trpc/login?batch=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(gzip ? { "Accept-Encoding": "gzip" } : {}),
        },
        body: JSON.stringify({ 0: null }),
      });
      expect(response.status).toBe(200);
      const cookie = response.headers.get("Set-Cookie");
      expect(cookie).toContain("portifolio_session=issued-token");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain(`Expires=${expiresAt.toUTCString()}`);
      const body = Buffer.from(await response.arrayBuffer());
      expect(JSON.parse((gzip ? gunzipSync(body) : body).toString())).toEqual([
        { result: { data: { ok: true } } },
      ]);
      const me = await instance.request("/trpc/me", {
        headers: { Cookie: cookie?.split(";")[0] ?? "" },
      });
      await expect(me.json()).resolves.toMatchObject({
        result: { data: { id: "user-1", email: "user@example.com" } },
      });
    },
  );

  it("sends the cookie deletion on logout", async () => {
    const response = await app().request("/trpc/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain(
      "portifolio_session=;",
    );
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
