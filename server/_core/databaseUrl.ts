import postgres from "postgres";
import { ENV } from "./env";

const CONNECT_TIMEOUT_SECONDS = 5;

export class DatabaseUnavailableError extends Error {
  code = "DATABASE_UNAVAILABLE" as const;
  originalError: unknown;
  candidates: string[];

  constructor(
    message: string,
    options: { originalError: unknown; candidates: string[] }
  ) {
    super(message);
    this.name = "DatabaseUnavailableError";
    this.originalError = options.originalError;
    this.candidates = options.candidates ?? [];
  }
}

let resolvedDatabaseUrlPromise: Promise<string> | null = null;

export function maskDatabaseUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return rawUrl.replace(/:[^:@/]+@/, ":***@");
  }
}

// Supabase already supplies the correct Transaction Pooler endpoint. Unlike
// the former local MySQL setup, there is no alternate port to probe.
export function buildCandidateDatabaseUrls(rawUrl: string) {
  return rawUrl ? [rawUrl] : [];
}

function getErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code: string }).code)
    : "";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isDatabaseConnectionError(error: unknown) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  return (
    code === "DATABASE_UNAVAILABLE" ||
    ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND"].includes(code) ||
    /connect ECONNREFUSED|ETIMEDOUT|ECONNRESET|connection terminated|database .* does not exist/i.test(
      message
    )
  );
}

async function probeDatabaseUrl(candidate: string) {
  const client = postgres(candidate, {
    max: 1,
    prepare: false,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
  });

  try {
    await client`select 1`;
  } finally {
    await client.end({ timeout: 2 }).catch(() => undefined);
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

  try {
    const parsed = new URL(rawUrl);
    if (!/^postgres(?:ql)?:$/i.test(parsed.protocol)) {
      throw new Error("DATABASE_URL precisa usar o protocolo postgresql://.");
    }
  } catch (error) {
    throw new DatabaseUnavailableError(
      "DATABASE_URL do PostgreSQL invÃ¡lida.",
      { originalError: error, candidates: [rawUrl] }
    );
  }

  try {
    await probeDatabaseUrl(rawUrl);
    return rawUrl;
  } catch (error) {
    throw new DatabaseUnavailableError(
      `NÃ£o foi possÃ­vel conectar ao PostgreSQL. Verifique a Transaction Pooler URL do Supabase (${maskDatabaseUrl(
        rawUrl
      )}).`,
      { originalError: error, candidates: [rawUrl] }
    );
  }
}

export async function getResolvedDatabaseUrl() {
  if (!resolvedDatabaseUrlPromise) {
    resolvedDatabaseUrlPromise = resolveDatabaseUrlInternal().catch(error => {
      resolvedDatabaseUrlPromise = null;
      throw error;
    });
  }

  return resolvedDatabaseUrlPromise;
}
