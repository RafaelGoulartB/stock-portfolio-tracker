import type { SessionUser } from "@portifolio-tracker/shared";
import type { Context as HonoContext } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isProduction } from "../env";
import { findSessionUser, SESSION_COOKIE } from "../lib/session";

export async function createContext(c: HonoContext) {
  const token = getCookie(c, SESSION_COOKIE) ?? null;
  const user: SessionUser | null = token ? await findSessionUser(token) : null;

  return {
    user,
    token,
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
