import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Request, Response } from "express";
import { z } from "zod";
import { COOKIE_NAME, SESSION_TTL_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";
import type { User } from "../../drizzle/schema";

const scrypt = promisify(_scrypt);
type SensitiveUserFields = "passwordHash" | "resetTokenHash" | "resetTokenExpiresAt";
type SanitizableUser = Omit<User, SensitiveUserFields> & Partial<Pick<User, SensitiveUserFields>>;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("E-mail inválido");

export const passwordSchema = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres")
  .max(128, "Senha longa demais")
  .regex(/[A-Z]/, "Use pelo menos uma letra maiúscula")
  .regex(/[a-z]/, "Use pelo menos uma letra minúscula")
  .regex(/[0-9]/, "Use pelo menos um número");

export const registerInputSchema = z
  .object({
    name: z.string().trim().min(2, "Informe seu nome"),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não batem",
    path: ["confirmPassword"],
  });

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe a senha"),
});

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined
) {
  if (!storedHash) return false;
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;

  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const keyBuffer = Buffer.from(key, "hex");
  if (keyBuffer.length !== derived.length) return false;
  return timingSafeEqual(keyBuffer, derived);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sanitizeUser<T extends SanitizableUser | null | undefined>(user: T) {
  if (!user) return null;
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, ...safeUser } = user;
  return safeUser;
}

export async function issueSessionCookie(
  req: Request,
  res: Response,
  user: { openId: string; name: string | null }
) {
  // Sessions now last SESSION_TTL_MS (30 days) instead of ONE_YEAR_MS. A
  // stolen cookie still grants access until expiry — keep TTL bounded.
  const sessionToken = await sdk.signSession(
    {
      openId: user.openId,
      // Use the configured app id rather than a hard-coded literal so multi-env
      // installs don't accidentally accept tokens issued for a different app.
      appId: ENV.appId || "literary-canvas-local",
      name: user.name || "Autor",
    },
    { expiresInMs: SESSION_TTL_MS },
  );

  res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: SESSION_TTL_MS,
  });
}
