import { loginInput, registerInput } from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import { hashPassword, verifyPassword } from "../../lib/password";
import { createSession, deleteSession } from "../../lib/session";
import { protectedProcedure, publicProcedure, router } from "../trpc";

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  register: publicProcedure
    .input(registerInput)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This email is already registered",
        });
      }

      const [user] = await db
        .insert(users)
        .values({
          email: input.email,
          passwordHash: await hashPassword(input.password),
        })
        .returning({ id: users.id, email: users.email });

      if (!user) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      const session = await createSession(user.id);
      ctx.setSessionCookie(session.token, session.expiresAt);

      return user;
    }),

  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
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
