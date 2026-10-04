import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql as client, db } from "../db";
import { sessions, users } from "../db/schema";
import {
  clearSessionLookupCache,
  createSession,
  deleteSession,
  findSessionUser,
} from "./session";

/**
 * Opt-in like the other Postgres integration tests
 * (`RUN_DB_INTEGRATION_TESTS=true`). Each test provisions and deletes its own
 * user; sessions cascade with it.
 */
const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

async function withUser(
  body: (user: { id: string; email: string }) => Promise<void>,
): Promise<void> {
  const email = `session-${randomUUID()}@integration.test`;
  const [created] = await db
    .insert(users)
    .values({ email, passwordHash: "integration-test-not-a-real-hash" })
    .returning({ id: users.id });

  if (!created) {
    throw new Error("failed to provision integration test user");
  }

  try {
    await body({ id: created.id, email });
  } finally {
    await db.delete(users).where(eq(users.id, created.id));
  }
}

describeIntegration("session lookup cache", () => {
  beforeEach(() => {
    clearSessionLookupCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await client.end();
  });

  it("serves a repeated lookup without re-reading the session", async () => {
    await withUser(async (user) => {
      const { token } = await createSession(user.id);

      await expect(findSessionUser(token)).resolves.toEqual(user);

      // Removed behind the cache's back: the cached lookup still answers,
      // which proves the second call did not query.
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await expect(findSessionUser(token)).resolves.toEqual(user);

      clearSessionLookupCache();
      await expect(findSessionUser(token)).resolves.toBeNull();
    });
  });

  it("forgets a session immediately on logout", async () => {
    await withUser(async (user) => {
      const { token } = await createSession(user.id);

      await expect(findSessionUser(token)).resolves.toEqual(user);
      await deleteSession(token);
      await expect(findSessionUser(token)).resolves.toBeNull();
    });
  });

  it("never caches a lookup past the session's own expiry", async () => {
    await withUser(async (user) => {
      const { token } = await createSession(user.id);
      const expiresAt = Date.now() + 10_000;
      await db
        .update(sessions)
        .set({ expiresAt: new Date(expiresAt) })
        .where(eq(sessions.userId, user.id));

      await expect(findSessionUser(token)).resolves.toEqual(user);

      // Still inside the cache window, but past the session's expiry.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(expiresAt + 1_000);
      await expect(findSessionUser(token)).resolves.toBeNull();
    });
  });
});
