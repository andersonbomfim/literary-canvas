import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

type ContextOptions = Pick<CreateExpressContextOptions, "req" | "res">;

/**
 * SafeUser omits sensitive fields so they never leak via
 * tRPC responses, error serialization, or logging.
 */
export type SafeUser = Omit<User, "passwordHash" | "resetTokenHash" | "resetTokenExpiresAt">;

export function sanitizeUser(user: User): SafeUser {
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, ...safe } = user;
  return safe;
}

export type TrpcContext = {
  req: ContextOptions["req"];
  res: ContextOptions["res"];
  user: SafeUser | null;
  activeWorkId: number | null;
};

function parseActiveWorkId(req: ContextOptions["req"]): number | null {
  const raw = req.headers["x-active-work-id"];
  if (!raw) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function createContext(
  opts: ContextOptions
): Promise<TrpcContext> {
  let user: SafeUser | null = null;

  try {
    const rawUser = await sdk.authenticateRequest(opts.req);
    user = rawUser ? sanitizeUser(rawUser) : null;
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    activeWorkId: parseActiveWorkId(opts.req),
  };
}
