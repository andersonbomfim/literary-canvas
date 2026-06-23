import mysql from "mysql2/promise";
import { ENV } from "./env";

const CONNECT_TIMEOUT_MS = 2000;

export class DatabaseUnavailableError extends Error {
  code = "DATABASE_UNAVAILABLE" as const;
  originalError: unknown;
  candidates: string[];

  constructor(message: string, options: { originalError: unknown; candidates: string[] }) {
    super(message);
    this.name = "DatabaseUnavailableError";
    this.originalError = options.originalError;
    this.candidates = options.candidates ?? [];
  }
}

let resolvedDatabaseUrlPromise: Promise<string> | null = null;

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function cloneUrlWithPort(rawUrl: string, port: string) {
  try {
    const parsed = new URL(rawUrl);
    parsed.port = port;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function maskDatabaseUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return rawUrl.replace(/:[^:@/]+@/, ":***@");
  }
}

export function buildCandidateDatabaseUrls(rawUrl: string) {
  const candidates = [rawUrl];

  try {
    const parsed = new URL(rawUrl);
    const port = parsed.port || "3306";

    if (port === "3307") {
      const fallback = cloneUrlWithPort(rawUrl, "3306");
      if (fallback) candidates.push(fallback);
    } else if (port === "3306") {
      const fallback = cloneUrlWithPort(rawUrl, "3307");
      if (fallback) candidates.push(fallback);
    }
  } catch {
    // keep only the original URL when parsing fails
  }

  return unique(candidates);
}

function getErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isDatabaseConnectionError(error: unknown) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  return (
    code === "DATABASE_UNAVAILABLE" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    /connect ECONNREFUSED|ETIMEDOUT|ECONNRESET|Can't connect to MySQL server/i.test(message)
  );
}

async function probeDatabaseUrl(candidate: string) {
  const connection = (await Promise.race([
    mysql.createConnection(candidate),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        const timeoutError = new Error(`Connection timed out after ${CONNECT_TIMEOUT_MS}ms`);
        (timeoutError as Error & { code: string }).code = "ETIMEDOUT";
        reject(timeoutError);
      }, CONNECT_TIMEOUT_MS);
    }),
  ])) as Awaited<ReturnType<typeof mysql.createConnection>>;

  try {
    await connection.query("SELECT 1");
  } finally {
    await connection.end().catch(() => undefined);
  }
}

async function resolveDatabaseUrlInternal() {
  const rawUrl = ENV.databaseUrl;
  if (!rawUrl) {
    throw new DatabaseUnavailableError("DATABASE_URL ausente no ambiente.", {
      originalError: null,
      candidates: [],
    });
  }

  const candidates = buildCandidateDatabaseUrls(rawUrl);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      await probeDatabaseUrl(candidate);
      if (candidate !== rawUrl) {
        console.warn(
          `[Database] DATABASE_URL ajustada automaticamente para ${maskDatabaseUrl(candidate)} (a porta configurada não respondeu).`
        );
      }
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }

  throw new DatabaseUnavailableError(
    `Não foi possível conectar ao MySQL. Verifique se o banco está ligado e se a porta do DATABASE_URL está correta (${candidates
      .map(maskDatabaseUrl)
      .join(" ou ")}).`,
    { originalError: lastError, candidates }
  );
}

export async function getResolvedDatabaseUrl() {
  if (!resolvedDatabaseUrlPromise) {
    resolvedDatabaseUrlPromise = resolveDatabaseUrlInternal().catch((error) => {
      resolvedDatabaseUrlPromise = null;
      throw error;
    });
  }

  return resolvedDatabaseUrlPromise;
}
