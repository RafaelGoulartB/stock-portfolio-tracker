import { createHash, randomBytes } from "node:crypto";
import type { SessionUser } from "@portifolio-tracker/shared";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";

export const SESSION_COOKIE = "portifolio_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * Every HTTP request authenticates before any procedure runs, so without this
 * each page batch would start with a serial database round trip (and wake a
 * suspended Neon compute just to re-read the same row). Entries live briefly,
 * never past the session's own expiry, and logout removes them at once. A
 * session deleted by another API instance stays usable here for at most this
 * long.
 */
const LOOKUP_CACHE_TTL_MS = 60 * 1_000;
const LOOKUP_CACHE_MAX = 1_000;
const lookupCache = new Map<string, { user: SessionUser; expiresAt: number }>();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type IssuedSession = {
  token: string;
  expiresAt: Date;
};

export async function createSession(userId: string): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Login is infrequent, unlike a timer that would keep Neon compute awake.
  await deleteExpiredSessions();
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });

  return { token, expiresAt };
}

export async function findSessionUser(
  token: string,
): Promise<SessionUser | null> {
  const id = hashToken(token);
  const now = Date.now();
  const hit = lookupCache.get(id);

  if (hit && hit.expiresAt > now) {
    return hit.user;
  }

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date(now))))
    .limit(1);

  if (!row) {
    lookupCache.delete(id);
    return null;
  }

  const user = { id: row.id, email: row.email };

  if (lookupCache.size >= LOOKUP_CACHE_MAX) {
    for (const [key, entry] of lookupCache) {
      if (entry.expiresAt <= now) lookupCache.delete(key);
    }
    if (lookupCache.size >= LOOKUP_CACHE_MAX) lookupCache.clear();
  }
  lookupCache.set(id, {
    user,
    expiresAt: Math.min(now + LOOKUP_CACHE_TTL_MS, row.expiresAt.getTime()),
  });

  return user;
}

export async function deleteSession(token: string): Promise<void> {
  const id = hashToken(token);
  lookupCache.delete(id);
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Forgets cached session lookups. Exported for tests. */
export function clearSessionLookupCache(): void {
  lookupCache.clear();
}
