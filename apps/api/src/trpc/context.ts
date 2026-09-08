import { getConnInfo } from "@hono/node-server/conninfo";
import type { SessionUser } from "@portifolio-tracker/shared";
import type { Context as HonoContext } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { env, isProduction } from "../env";
import { resolveClientKey } from "../lib/rate-limit";
import { findSessionUser, SESSION_COOKIE } from "../lib/session";

export async function createContext(c: HonoContext) {
  const token = getCookie(c, SESSION_COOKIE) ?? null;
  const user: SessionUser | null = token ? await findSessionUser(token) : null;

  let remoteAddress: string | null = null;
  try {
    remoteAddress = getConnInfo(c).remote.address ?? null;
  } catch {
    // Connection info is unavailable outside the node server (e.g. in tests);
    // the resolver falls back to a shared bucket, which is still bounded.
  }
  const clientKey = resolveClientKey({
    forwardedFor: c.req.header("x-forwarded-for"),
    remoteAddress,
    trustProxy: env.TRUST_PROXY,
  });

  return {
    user,
    token,
    clientKey,
    setSessionCookie(value: string, expiresAt: Date) {
      setCookie(c, SESSION_COOKIE, value, {
        httpOnly: true,
        sameSite: "Lax",
        secure: isProduction,
        path: "/",
        expires: expiresAt,
      });
    },
    clearSessionCookie() {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
