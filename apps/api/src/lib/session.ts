import { createHash, randomBytes } from "node:crypto";
import type { SessionUser } from "@portifolio-tracker/shared";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";

export const SESSION_COOKIE = "portifolio_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

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
  const [row] = await db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
