import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email"));

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters");

export const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const registerInput = credentialsSchema;
export const loginInput = credentialsSchema;

export type Credentials = z.infer<typeof credentialsSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;
