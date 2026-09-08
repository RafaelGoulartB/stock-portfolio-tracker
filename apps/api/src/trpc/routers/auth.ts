import { loginInput, registerInput } from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import { hashPassword, verifyPassword } from "../../lib/password";
import { RateLimiter } from "../../lib/rate-limit";
import { createSession, deleteSession } from "../../lib/session";
import { protectedProcedure, publicProcedure, router } from "../trpc";

/**
 * One shared limiter per sensitive action. Bounds are generous for a real
 * person yet finite for an attacker, and `maxKeys` caps memory so a flood of
 * distinct source addresses cannot grow the map without limit.
 */
const RATE_LIMIT_MAX_KEYS = 10_000;
const loginLimiter = new RateLimiter({
  limit: 10,
  windowMs: 60_000,
  maxKeys: RATE_LIMIT_MAX_KEYS,
});
const registerLimiter = new RateLimiter({
  limit: 5,
  windowMs: 60 * 60_000,
  maxKeys: RATE_LIMIT_MAX_KEYS,
});

/** Postgres unique-violation SQLSTATE, surfaced by postgres.js as `error.code`. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function enforceRateLimit(limiter: RateLimiter, key: string): void {
  if (!limiter.consume(key).allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Please wait and try again.",
    });
  }
}

const EMAIL_CONFLICT = "This email is already registered";

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  register: publicProcedure
    .input(registerInput)
    .mutation(async ({ ctx, input }) => {
      enforceRateLimit(registerLimiter, ctx.clientKey);

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: EMAIL_CONFLICT });
      }

      let user: { id: string; email: string } | undefined;
      try {
        [user] = await db
          .insert(users)
          .values({
            email: input.email,
            passwordHash: await hashPassword(input.password),
          })
          .returning({ id: users.id, email: users.email });
      } catch (error) {
        // A concurrent registration can win the race between the check above
        // and this insert; the unique index is the real guard, so translate
        // its violation into the same conflict instead of a 500.
        if (isUniqueViolation(error)) {
          throw new TRPCError({ code: "CONFLICT", message: EMAIL_CONFLICT });
        }
        throw error;
      }

      if (!user) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      const session = await createSession(user.id);
      ctx.setSessionCookie(session.token, session.expiresAt);

      return user;
    }),

  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    enforceRateLimit(loginLimiter, ctx.clientKey);

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    const passwordMatches = user
      ? await verifyPassword(input.password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid email or password",
      });
    }

    // A real user cleared the check, so free their window immediately.
    loginLimiter.reset(ctx.clientKey);

    const session = await createSession(user.id);
    ctx.setSessionCookie(session.token, session.expiresAt);

    return { id: user.id, email: user.email };
  }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.token) {
      await deleteSession(ctx.token);
    }

    ctx.clearSessionCookie();

    return { ok: true as const };
  }),
});
