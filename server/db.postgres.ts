import { eq, asc, and, desc, inArray, like, lt, sql, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertUser,
  users,
  bookSeries,
  BookSeries,
  works,
  Work,
  drafts,
  Draft,
  chapters,
  Chapter,
  libraryEntries,
  LibraryEntry,
  seriesLibraryEntries,
  SeriesLibraryEntry,
  authorProfiles,
  AuthorProfile,
  chapterReviews,
  ChapterReview,
  notifications,
  Notification,
  statistics,
  Statistic,
  chapterVersions,
  ChapterVersion,
  characters,
  Character,
  InsertCharacter,
  promptTemplates,
  PromptTemplate,
  InsertPromptTemplate,
  creditWallets,
  CreditWallet,
  creditLedgerEntries,
  CreditLedgerEntry,
  userSubscriptions,
  UserSubscription,
  generationJobs,
  GenerationJob,
  generationCostLogs,
  GenerationCostLog,
  generationUsageLedger,
  GenerationUsageLedgerEntry,
  auditReports,
  AuditReport,
  InsertAuditReport,
  improvementReports,
  ImprovementReport,
  InsertImprovementReport,
  auditLogs,
  AuditLog,
  InsertAuditLog,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getResolvedDatabaseUrl } from "./_core/databaseUrl";
import {
  STARTER_WALLET_CREDITS,
  canReceivePlanWalletAllowance,
  getPlanWalletAllowance,
  legacyPlanWalletGrantReferences,
  planWalletGrantReference,
  resolvePlanWalletAllowance,
} from "./billingPolicy";

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

type PaginationOptions = {
  limit?: number;
  offset?: number;
};

function normalizePagination(options?: PaginationOptions) {
  if (!options?.limit) return null;
  return {
    limit: Math.max(1, Math.min(500, Math.floor(options.limit))),
    offset: Math.max(0, Math.floor(options.offset ?? 0)),
  };
}

function hasWorkScope(workId: number | null | undefined): workId is number {
  return typeof workId === "number" && Number.isFinite(workId);
}

function requireWorkScope(workId: number | null | undefined, resource: string) {
  if (!hasWorkScope(workId)) {
    throw new Error(`Active work required for ${resource}`);
  }
  return workId;
}

function countResult(value: unknown) {
  return Number(value ?? 0);
}

function escapeLikeValue(value: string) {
  return value.replace(/[\\%_]/g, char => `\\${char}`);
}

function containsLikePattern(value: string) {
  return `%${escapeLikeValue(value)}%`;
}

function prefixLikePattern(value: string) {
  return `${escapeLikeValue(value)}%`;
}

// Lazily create the PostgreSQL client so local tooling can run without a DB.
// Supabase's Transaction Pooler uses PgBouncer, which is incompatible with
// prepared statements kept across transactions.
export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      const databaseUrl = await getResolvedDatabaseUrl();
      _client = postgres(databaseUrl, {
        max: 10,
        prepare: false,
        connect_timeout: 10,
      });
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      if (_client) await _client.end({ timeout: 2 }).catch(() => undefined);
      _client = null;
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user by email: database not available");
    return undefined;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function listUsers() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function countUsers() {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.select({ total: sql<number>`count(*)` }).from(users);
  return countResult(result[0]?.total);
}

export async function createLocalUser(data: {
  name: string;
  email: string;
  passwordHash: string;
  role: "user" | "admin";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedEmail = data.email.trim().toLowerCase();
  const openId = `local:${normalizedEmail}`;

  await db.insert(users).values({
    openId,
    name: data.name.trim(),
    email: normalizedEmail,
    loginMethod: "local",
    passwordHash: data.passwordHash,
    role: data.role || "user",
    lastSignedIn: new Date(),
  });

  const created = await getUserByOpenId(openId);
  if (!created) throw new Error("Failed to create local user");
  return created;
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(users)
    .set({
      passwordHash,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      lastSignedIn: new Date(),
    })
    .where(eq(users.id, userId));

  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result[0];
}

export async function savePasswordResetToken(
  userId: number,
  tokenHash: string,
  expiresAt: Date
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(users)
    .set({ resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt })
    .where(eq(users.id, userId));
}

export async function getUserByResetTokenHash(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(users)
    .where(eq(users.resetTokenHash, tokenHash))
    .limit(1);
  if (!result[0]) return undefined;
  const user = result[0];
  if (
    !user.resetTokenExpiresAt ||
    user.resetTokenExpiresAt.getTime() < Date.now()
  )
    return undefined;
  return user;
}

export async function clearPasswordResetToken(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(users)
    .set({ resetTokenHash: null, resetTokenExpiresAt: null })
    .where(eq(users.id, userId));
}

// A07.1 (OWASP) — registra uma tentativa de login mal-sucedida e, ao atingir
// o teto, bloqueia a conta por uma janela de tempo. Devolve o estado novo
// para o caller poder enviar a mensagem certa ao usuário.
const FAILED_LOGIN_LIMIT = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

export async function recordFailedLogin(
  userId: number
): Promise<{ failedLoginCount: number; lockedUntil: Date | null }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const before = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const current = before[0];
  const nextCount = (current?.failedLoginCount ?? 0) + 1;
  const lockedUntil =
    nextCount >= FAILED_LOGIN_LIMIT
      ? new Date(Date.now() + LOCK_WINDOW_MS)
      : null;

  await db
    .update(users)
    .set({ failedLoginCount: nextCount, lockedUntil })
    .where(eq(users.id, userId));

  return { failedLoginCount: nextCount, lockedUntil };
}

export async function resetFailedLogins(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, userId));
}

// A09 (OWASP) — Append-only audit log. Falhas em escrever NÃO devem
// abortar a ação principal (logging não pode quebrar o fluxo de negócio),
// então capturamos o erro internamente.
export async function writeAuditLog(entry: InsertAuditLog): Promise<void> {
  const db = await getDb();
  if (!db) {
    // eslint-disable-next-line no-console
    console.warn(
      "[audit] DB indisponível; perdendo entrada de auditoria:",
      entry.action
    );
    return;
  }
  try {
    await db.insert(auditLogs).values(entry);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[audit] falha ao escrever entrada", {
      action: entry.action,
      err,
    });
  }
}

export async function listAuditLogs(
  filters: { actorId?: number; action?: string; limit?: number } = {}
): Promise<AuditLog[]> {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(filters.limit ?? 100, 500);
  const conditions = [] as any[];
  if (filters.actorId !== undefined)
    conditions.push(eq(auditLogs.actorId, filters.actorId));
  if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
  const where =
    conditions.length === 1
      ? conditions[0]
      : conditions.length
        ? and(...conditions)
        : undefined;
  const query = db.select().from(auditLogs);
  const result = where
    ? await query.where(where).orderBy(desc(auditLogs.createdAt)).limit(limit)
    : await query.orderBy(desc(auditLogs.createdAt)).limit(limit);
  return result;
}

export async function updateUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(users).set({ role }).where(eq(users.id, userId));
  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result[0];
}

// ============ WORKS ============

const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sortWorksInSeries(rows: Work[]) {
  return [...rows].sort((a, b) => {
    const numberA = a.bookNumber ?? Number.MAX_SAFE_INTEGER;
    const numberB = b.bookNumber ?? Number.MAX_SAFE_INTEGER;
    if (numberA !== numberB) return numberA - numberB;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

function clipText(value: string | null | undefined, max = 2400) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return trimmed.length > max ? `${trimmed.slice(0, max).trim()}...` : trimmed;
}

function formatSeriesWorkLabel(work: Work) {
  const number =
    work.bookNumber != null ? `Livro ${work.bookNumber}` : "Livro sem número";
  const subtitle = work.subtitle ? `: ${work.subtitle}` : "";
  return `${number} - ${work.title}${subtitle}`;
}

type SeriesLibraryEntryInput = {
  type: string;
  name: string;
  description?: string | null;
  details?: string | null;
  sourceWorkIds?: number[] | string | null;
  confidence?: number | null;
  status?: SeriesLibraryEntry["status"] | null;
};

function normalizeSeriesLibrarySourceWorkIds(
  value: SeriesLibraryEntryInput["sourceWorkIds"]
) {
  if (Array.isArray(value)) {
    const ids = Array.from(
      new Set(
        value
          .filter(item => Number.isFinite(item))
          .map(item => Math.floor(item))
      )
    );
    return ids.length ? JSON.stringify(ids) : null;
  }
  return normalizeNullableText(value);
}

function normalizeSeriesLibraryConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return 80;
  return Math.max(0, Math.min(100, Math.round(value!)));
}

function formatSeriesLibraryEntry(entry: SeriesLibraryEntry) {
  const parts = [
    `- ${entry.type}: ${entry.name}`,
    entry.description ? `  descrição: ${clipText(entry.description, 900)}` : "",
    entry.details
      ? `  detalhes de continuidade: ${clipText(entry.details, 1200)}`
      : "",
    entry.status === "conflict"
      ? "  atencao: marcado como conflito, use apenas como alerta de continuidade."
      : "",
  ].filter(Boolean);
  return parts.join("\n");
}

async function requireSeriesForUser(
  userId: number,
  seriesId: number | null | undefined
) {
  if (seriesId == null) return null;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .select()
    .from(bookSeries)
    .where(and(eq(bookSeries.id, seriesId), eq(bookSeries.userId, userId)))
    .limit(1);
  if (!result[0]) throw new Error("Série não encontrada.");
  return result[0];
}

async function nextBookNumberForSeries(userId: number, seriesId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ bookNumber: works.bookNumber })
    .from(works)
    .where(
      and(
        eq(works.userId, userId),
        eq(works.seriesId, seriesId),
        sql`${works.deletedAt} IS NULL`
      )
    );
  const numbers = rows.map(item => item.bookNumber ?? 0).filter(Boolean);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function hasMeaningfulText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return Boolean(normalized && normalized !== "[]" && normalized !== "{}");
}

function hasMeaningfulProfileData(profile: AuthorProfile | undefined) {
  if (!profile) return false;
  return [
    profile.narrativeStyle,
    profile.keyElements,
    profile.characterVoices,
    profile.negativeRules,
    profile.keyChapters,
    profile.storyFoundation,
    profile.continuityMemories,
  ].some(hasMeaningfulText);
}

function hasGeneratedPlaceholderMetadata(work: Work) {
  const placeholderTitle =
    work.title === "Obra principal" || work.title === "Minha Obra";
  const placeholderDescription =
    work.description == null ||
    work.description ===
      "Obra criada automaticamente para organizar o ambiente local.";

  return (
    placeholderTitle &&
    placeholderDescription &&
    work.subtitle == null &&
    work.genre == null &&
    work.coverImage == null &&
    work.status === "planning"
  );
}

async function hasWorkContentForDb(userId: number, workId: number) {
  const db = await getDb();
  if (!db) return false;

  const draft = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.workId, workId)))
    .limit(1);
  if (draft[0]) return true;

  const chapter = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.userId, userId), eq(chapters.workId, workId)))
    .limit(1);
  if (chapter[0]) return true;

  const libraryEntry = await db
    .select({ id: libraryEntries.id })
    .from(libraryEntries)
    .where(
      and(eq(libraryEntries.userId, userId), eq(libraryEntries.workId, workId))
    )
    .limit(1);
  if (libraryEntry[0]) return true;

  const character = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(eq(characters.userId, userId), eq(characters.workId, workId)))
    .limit(1);
  if (character[0]) return true;

  const promptTemplate = await db
    .select({ id: promptTemplates.id })
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.workId, workId)
      )
    )
    .limit(1);
  if (promptTemplate[0]) return true;

  const stat = await db
    .select()
    .from(statistics)
    .where(and(eq(statistics.userId, userId), eq(statistics.workId, workId)))
    .limit(1);
  if (
    stat[0] &&
    ((stat[0].totalChaptersGenerated ?? 0) > 0 ||
      (stat[0].totalWordsWritten ?? 0) > 0 ||
      (stat[0].totalCharactersCreated ?? 0) > 0 ||
      (stat[0].totalEventsCreated ?? 0) > 0 ||
      (stat[0].totalLocationsCreated ?? 0) > 0)
  ) {
    return true;
  }

  const profile = await db
    .select()
    .from(authorProfiles)
    .where(
      and(eq(authorProfiles.userId, userId), eq(authorProfiles.workId, workId))
    )
    .limit(1);
  return hasMeaningfulProfileData(profile[0]);
}

async function removeGeneratedPlaceholderWorks(userId: number) {
  const db = await getDb();
  if (!db) return;

  const allWorks = await db
    .select()
    .from(works)
    .where(eq(works.userId, userId));
  const hasRealWork = allWorks.some(
    work => !hasGeneratedPlaceholderMetadata(work)
  );
  if (!hasRealWork) return;

  for (const work of allWorks) {
    if (work.deletedAt || !hasGeneratedPlaceholderMetadata(work)) continue;
    if (await hasWorkContentForDb(userId, work.id)) continue;
    await deleteWorkRecordsForDb(userId, work.id);
  }
}

async function deleteWorkScopedRecordsForDb(userId: number, workId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const chapterRows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.userId, userId), eq(chapters.workId, workId)));
  const chapterIds = chapterRows.map(item => item.id);

  if (chapterIds.length) {
    await db
      .delete(chapterVersions)
      .where(inArray(chapterVersions.chapterId, chapterIds));
    await db
      .delete(chapterReviews)
      .where(
        and(
          eq(chapterReviews.userId, userId),
          inArray(chapterReviews.chapterId, chapterIds)
        )
      );
  }

  await db
    .delete(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.workId, workId)));
  await db
    .delete(chapters)
    .where(and(eq(chapters.userId, userId), eq(chapters.workId, workId)));
  await db
    .delete(libraryEntries)
    .where(
      and(eq(libraryEntries.userId, userId), eq(libraryEntries.workId, workId))
    );
  await db
    .delete(authorProfiles)
    .where(
      and(eq(authorProfiles.userId, userId), eq(authorProfiles.workId, workId))
    );
  await db
    .delete(statistics)
    .where(and(eq(statistics.userId, userId), eq(statistics.workId, workId)));
  await db
    .delete(characters)
    .where(and(eq(characters.userId, userId), eq(characters.workId, workId)));
  await db
    .delete(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.workId, workId)
      )
    );
  await db
    .delete(creditLedgerEntries)
    .where(
      and(
        eq(creditLedgerEntries.userId, userId),
        eq(creditLedgerEntries.workId, workId)
      )
    );
  const jobRows = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(
      and(eq(generationJobs.userId, userId), eq(generationJobs.workId, workId))
    );
  const jobIds = jobRows.map(item => item.id);
  if (jobIds.length) {
    await db
      .delete(generationCostLogs)
      .where(inArray(generationCostLogs.jobId, jobIds));
  }
  await db
    .delete(generationUsageLedger)
    .where(
      and(
        eq(generationUsageLedger.userId, userId),
        eq(generationUsageLedger.workId, workId)
      )
    );
  await db
    .delete(auditReports)
    .where(and(eq(auditReports.userId, userId), eq(auditReports.workId, workId)));
  await db
    .delete(improvementReports)
    .where(
      and(eq(improvementReports.userId, userId), eq(improvementReports.workId, workId))
    );
  await db
    .delete(generationJobs)
    .where(
      and(eq(generationJobs.userId, userId), eq(generationJobs.workId, workId))
    );
}

async function deleteWorkRecordsForDb(userId: number, workId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await deleteWorkScopedRecordsForDb(userId, workId);
  await db
    .delete(works)
    .where(and(eq(works.id, workId), eq(works.userId, userId)));
}

async function purgeExpiredTrashedWorks(userId: number) {
  const db = await getDb();
  if (!db) return;

  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS);
  const expired = await db
    .select({ id: works.id })
    .from(works)
    .where(
      and(
        eq(works.userId, userId),
        sql`${works.deletedAt} IS NOT NULL`,
        lt(works.deletedAt, cutoff)
      )
    );

  for (const item of expired) {
    await deleteWorkRecordsForDb(userId, item.id);
  }
}

export async function listBookSeriesByUserId(
  userId: number
): Promise<BookSeries[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(bookSeries)
    .where(eq(bookSeries.userId, userId))
    .orderBy(desc(bookSeries.updatedAt));
}

export async function createBookSeries(
  userId: number,
  data: {
    title: string;
    description?: string | null;
    genre?: string | null;
    universeNotes?: string | null;
    status?: BookSeries["status"];
  }
): Promise<BookSeries> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(bookSeries).values({
    userId,
    title: data.title.trim(),
    description: normalizeNullableText(data.description),
    genre: normalizeNullableText(data.genre),
    universeNotes: normalizeNullableText(data.universeNotes),
    status: data.status ?? "active",
  });

  const result = await db
    .select()
    .from(bookSeries)
    .where(eq(bookSeries.userId, userId))
    .orderBy(desc(bookSeries.createdAt))
    .limit(1);

  return result[0]!;
}

export async function updateBookSeries(
  seriesId: number,
  userId: number,
  data: Partial<Omit<BookSeries, "id" | "userId" | "createdAt" | "updatedAt">>
): Promise<BookSeries> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await requireSeriesForUser(userId, seriesId);

  await db
    .update(bookSeries)
    .set({
      ...data,
      title: data.title?.trim(),
      description:
        data.description === undefined
          ? undefined
          : normalizeNullableText(data.description),
      genre:
        data.genre === undefined
          ? undefined
          : normalizeNullableText(data.genre),
      universeNotes:
        data.universeNotes === undefined
          ? undefined
          : normalizeNullableText(data.universeNotes),
      updatedAt: new Date(),
    })
    .where(and(eq(bookSeries.id, seriesId), eq(bookSeries.userId, userId)));

  const result = await db
    .select()
    .from(bookSeries)
    .where(and(eq(bookSeries.id, seriesId), eq(bookSeries.userId, userId)))
    .limit(1);
  if (!result[0]) throw new Error("Série não encontrada.");
  return result[0];
}

export async function deleteBookSeries(
  seriesId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await requireSeriesForUser(userId, seriesId);

  await db
    .update(works)
    .set({ seriesId: null, bookNumber: null, updatedAt: new Date() })
    .where(and(eq(works.userId, userId), eq(works.seriesId, seriesId)));
  await db
    .delete(seriesLibraryEntries)
    .where(
      and(
        eq(seriesLibraryEntries.userId, userId),
        eq(seriesLibraryEntries.seriesId, seriesId)
      )
    );
  await db
    .delete(bookSeries)
    .where(and(eq(bookSeries.id, seriesId), eq(bookSeries.userId, userId)));
}

export async function listWorksBySeriesId(
  userId: number,
  seriesId: number
): Promise<Work[]> {
  const db = await getDb();
  if (!db) return [];
  await requireSeriesForUser(userId, seriesId);

  const rows = await db
    .select()
    .from(works)
    .where(
      and(
        eq(works.userId, userId),
        eq(works.seriesId, seriesId),
        sql`${works.deletedAt} IS NULL`
      )
    );
  return sortWorksInSeries(rows);
}

export async function listSeriesLibraryEntries(
  userId: number,
  seriesId: number
): Promise<SeriesLibraryEntry[]> {
  const db = await getDb();
  if (!db) return [];
  await requireSeriesForUser(userId, seriesId);

  return db
    .select()
    .from(seriesLibraryEntries)
    .where(
      and(
        eq(seriesLibraryEntries.userId, userId),
        eq(seriesLibraryEntries.seriesId, seriesId)
      )
    )
    .orderBy(desc(seriesLibraryEntries.updatedAt));
}

export async function replaceSeriesLibraryEntries(
  userId: number,
  seriesId: number,
  entries: SeriesLibraryEntryInput[]
): Promise<SeriesLibraryEntry[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await requireSeriesForUser(userId, seriesId);

  await db
    .delete(seriesLibraryEntries)
    .where(
      and(
        eq(seriesLibraryEntries.userId, userId),
        eq(seriesLibraryEntries.seriesId, seriesId)
      )
    );

  const values = entries
    .map(entry => ({
      ...entry,
      type: entry.type.trim(),
      name: entry.name.trim(),
    }))
    .filter(entry => entry.type && entry.name)
    .slice(0, 160)
    .map(entry => ({
      userId,
      seriesId,
      type: entry.type,
      name: entry.name,
      description: normalizeNullableText(entry.description),
      details: normalizeNullableText(entry.details),
      sourceWorkIds: normalizeSeriesLibrarySourceWorkIds(entry.sourceWorkIds),
      confidence: normalizeSeriesLibraryConfidence(entry.confidence),
      status: entry.status ?? "needs_review",
    }));

  if (values.length) {
    await db.insert(seriesLibraryEntries).values(values);
  }

  return listSeriesLibraryEntries(userId, seriesId);
}

export async function getSeriesContextForWork(
  userId: number,
  workId: number
): Promise<{ series: BookSeries | null; works: Work[]; contextText: string }> {
  const db = await getDb();
  if (!db) return { series: null, works: [], contextText: "" };

  const activeWork = await getWorkById(workId, userId);
  if (!activeWork?.seriesId)
    return { series: null, works: [], contextText: "" };

  const series = await requireSeriesForUser(userId, activeWork.seriesId);
  if (!series || series.status !== "active")
    return { series, works: [], contextText: "" };

  const availableWorks = sortWorksInSeries(
    await db
      .select()
      .from(works)
      .where(
        and(
          eq(works.userId, userId),
          eq(works.seriesId, series.id),
          sql`${works.deletedAt} IS NULL`,
          sql`${works.status} NOT IN ('paused', 'archived')`
        )
      )
  );
  const siblingWorks = availableWorks.filter(item => item.id !== workId);
  const siblingIds = siblingWorks.map(item => item.id);

  const seriesLibrary = await db
    .select()
    .from(seriesLibraryEntries)
    .where(
      and(
        eq(seriesLibraryEntries.userId, userId),
        eq(seriesLibraryEntries.seriesId, series.id)
      )
    )
    .orderBy(desc(seriesLibraryEntries.updatedAt))
    .limit(100);

  const profileRows = siblingIds.length
    ? await db
        .select()
        .from(authorProfiles)
        .where(
          and(
            eq(authorProfiles.userId, userId),
            inArray(authorProfiles.workId, siblingIds)
          )
        )
    : [];
  const characterRows = siblingIds.length
    ? await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.userId, userId),
            inArray(characters.workId, siblingIds)
          )
        )
        .orderBy(asc(characters.name))
    : [];
  const entryRows = siblingIds.length
    ? await db
        .select()
        .from(libraryEntries)
        .where(
          and(
            eq(libraryEntries.userId, userId),
            inArray(libraryEntries.workId, siblingIds),
            sql`${libraryEntries.status} <> 'discarded'`
          )
        )
    : [];
  const chapterRows = siblingIds.length
    ? await db
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.userId, userId),
            inArray(chapters.workId, siblingIds),
            eq(chapters.status, "canonical")
          )
        )
        .orderBy(asc(chapters.createdAt))
    : [];

  const seriesHeader = [
    `Série / universo compartilhado: ${series.title}`,
    series.genre ? `Gênero macro: ${series.genre}` : "",
    series.description
      ? `Descrição da série: ${clipText(series.description, 1600)}`
      : "",
    series.universeNotes
      ? `Regras e notas do universo compartilhado: ${clipText(series.universeNotes, 2600)}`
      : "",
    `Obra ativa dentro da série: ${formatSeriesWorkLabel(activeWork)}`,
    availableWorks.length
      ? `Ordem conhecida: ${availableWorks.map(formatSeriesWorkLabel).join(" | ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const seriesLibraryText = seriesLibrary.length
    ? seriesLibrary.map(formatSeriesLibraryEntry).join("\n\n")
    : "";

  const workSections = siblingWorks
    .map(work => {
      const profile = profileRows.find(item => item.workId === work.id);
      const workCharacters = characterRows
        .filter(item => item.workId === work.id)
        .slice(0, 24);
      const workEntries = entryRows
        .filter(item => item.workId === work.id)
        .slice(0, 30);
      const canonicalChapters = chapterRows
        .filter(item => item.workId === work.id)
        .slice(-12);

      const charactersText = workCharacters
        .map(character => {
          const details = [
            character.role ? `papel: ${character.role}` : "",
            character.history
              ? `histórico: ${clipText(character.history, 800)}`
              : "",
            character.motivations
              ? `motivação: ${clipText(character.motivations, 500)}`
              : "",
            character.relationships
              ? `relações: ${clipText(character.relationships, 500)}`
              : "",
          ]
            .filter(Boolean)
            .join("; ");
          return `- ${character.name}${details ? ` (${details})` : ""}`;
        })
        .join("\n");

      const entriesText = workEntries
        .map(entry => {
          const details = [entry.description, entry.details]
            .map(item => clipText(item, 600))
            .filter(Boolean)
            .join(" ");
          return `- ${entry.type}: ${entry.name}${details ? ` - ${details}` : ""}`;
        })
        .join("\n");

      const chaptersText = canonicalChapters
        .map(chapter => {
          return `- ${chapter.title}: ${clipText(chapter.content, 900)}`;
        })
        .join("\n");

      return [
        `### ${formatSeriesWorkLabel(work)}`,
        work.genre ? `Gênero: ${work.genre}` : "",
        work.description
          ? `Premissa/descrição: ${clipText(work.description, 1400)}`
          : "",
        profile?.storyFoundation
          ? `Base canônica desta obra: ${clipText(profile.storyFoundation, 2400)}`
          : "",
        profile?.continuityMemories
          ? `Memórias aprovadas: ${clipText(profile.continuityMemories, 2200)}`
          : "",
        charactersText ? `Personagens recorrentes:\n${charactersText}` : "",
        entriesText ? `Biblioteca canônica:\n${entriesText}` : "",
        chaptersText ? `Capítulos canônicos recentes:\n${chaptersText}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean);

  const contextText = [
    "CONTEXTO DE SÉRIE / UNIVERSO COMPARTILHADO",
    seriesHeader,
    seriesLibraryText
      ? `Biblioteca consolidada da serie:\n\n${seriesLibraryText}`
      : "",
    workSections.length
      ? `Livros anteriores ou paralelos que não podem ser contraditos:\n\n${workSections.join("\n\n----------------\n\n")}`
      : "Nenhum outro livro ativo desta série foi encontrado. Use apenas a estrutura da série e a obra atual.",
    "Regra de uso: este contexto serve para continuidade de universo, eventos passados, personagens recorrentes, consequências e tom macro. Não copie cenas nem transforme livros anteriores em resumo genérico.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { series, works: availableWorks, contextText };
}

export async function listWorksByUserId(userId: number): Promise<Work[]> {
  const db = await getDb();
  if (!db) return [];

  await purgeExpiredTrashedWorks(userId);
  await removeGeneratedPlaceholderWorks(userId);
  return db
    .select()
    .from(works)
    .where(and(eq(works.userId, userId), sql`${works.deletedAt} IS NULL`))
    .orderBy(desc(works.updatedAt));
}

export async function getWorkById(
  workId: number,
  userId: number
): Promise<Work | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(works)
    .where(
      and(
        eq(works.id, workId),
        eq(works.userId, userId),
        sql`${works.deletedAt} IS NULL`
      )
    )
    .limit(1);

  return result[0];
}

export async function getDefaultWorkForUser(
  userId: number
): Promise<Work | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let result = await db
    .select()
    .from(works)
    .where(
      and(
        eq(works.userId, userId),
        eq(works.isDefault, "true"),
        sql`${works.deletedAt} IS NULL`
      )
    )
    .limit(1);

  if (result[0]) return result[0];

  // If no default, pick the first work
  result = await db
    .select()
    .from(works)
    .where(and(eq(works.userId, userId), sql`${works.deletedAt} IS NULL`))
    .orderBy(asc(works.createdAt))
    .limit(1);

  if (result[0]) {
    // Mark it as default
    await db
      .update(works)
      .set({ isDefault: "true" })
      .where(eq(works.id, result[0].id));
    return { ...result[0], isDefault: "true" };
  }

  return undefined;
}

export async function createWork(
  userId: number,
  data: {
    title: string;
    subtitle?: string | null;
    description?: string | null;
    genre?: string | null;
    coverImage?: string | null;
    coverPositionX?: number;
    coverPositionY?: number;
    coverScale?: number;
    status?: Work["status"];
    seriesId?: number | null;
    bookNumber?: number | null;
  }
): Promise<Work> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const series = await requireSeriesForUser(userId, data.seriesId);
  const existing = await db
    .select()
    .from(works)
    .where(and(eq(works.userId, userId), sql`${works.deletedAt} IS NULL`));
  const hasRealActiveWork = existing.some(
    work => !hasGeneratedPlaceholderMetadata(work)
  );

  await db.insert(works).values({
    userId,
    seriesId: series?.id ?? null,
    bookNumber: series
      ? (data.bookNumber ?? (await nextBookNumberForSeries(userId, series.id)))
      : null,
    title: data.title.trim(),
    subtitle: data.subtitle ?? null,
    description: data.description ?? null,
    genre: data.genre ?? null,
    coverImage: data.coverImage ?? null,
    coverPositionX: data.coverPositionX ?? 50,
    coverPositionY: data.coverPositionY ?? 50,
    coverScale: data.coverScale ?? 100,
    status: data.status ?? "planning",
    isDefault: hasRealActiveWork ? "false" : "true",
  });

  await removeGeneratedPlaceholderWorks(userId);

  const result = await db
    .select()
    .from(works)
    .where(and(eq(works.userId, userId), sql`${works.deletedAt} IS NULL`))
    .orderBy(desc(works.createdAt))
    .limit(1);

  return result[0]!;
}

export async function updateWork(
  workId: number,
  userId: number,
  data: Partial<Omit<Work, "id" | "userId" | "createdAt" | "updatedAt">>
): Promise<Work> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const nextData = { ...data };
  if ("seriesId" in nextData) {
    const series = await requireSeriesForUser(userId, nextData.seriesId);
    if (!series) {
      nextData.bookNumber = null;
    } else if (!("bookNumber" in nextData) || nextData.bookNumber == null) {
      nextData.bookNumber = await nextBookNumberForSeries(userId, series.id);
    }
  }

  await db
    .update(works)
    .set(nextData)
    .where(
      and(
        eq(works.id, workId),
        eq(works.userId, userId),
        sql`${works.deletedAt} IS NULL`
      )
    );

  const result = await db
    .select()
    .from(works)
    .where(
      and(
        eq(works.id, workId),
        eq(works.userId, userId),
        sql`${works.deletedAt} IS NULL`
      )
    )
    .limit(1);

  if (!result[0]) throw new Error("Work not found");
  return result[0];
}

export async function setDefaultWork(
  userId: number,
  workId: number
): Promise<Work> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Unset all defaults for this user
  await db
    .update(works)
    .set({ isDefault: "false" })
    .where(and(eq(works.userId, userId), sql`${works.deletedAt} IS NULL`));
  // Set the new default
  await db
    .update(works)
    .set({ isDefault: "true" })
    .where(
      and(
        eq(works.id, workId),
        eq(works.userId, userId),
        sql`${works.deletedAt} IS NULL`
      )
    );

  const result = await db
    .select()
    .from(works)
    .where(
      and(
        eq(works.id, workId),
        eq(works.userId, userId),
        sql`${works.deletedAt} IS NULL`
      )
    )
    .limit(1);

  if (!result[0]) throw new Error("Work not found");
  return result[0];
}

export async function listTrashedWorks(userId: number): Promise<Work[]> {
  const db = await getDb();
  if (!db) return [];

  await purgeExpiredTrashedWorks(userId);
  return db
    .select()
    .from(works)
    .where(and(eq(works.userId, userId), sql`${works.deletedAt} IS NOT NULL`))
    .orderBy(desc(works.deletedAt));
}

export async function softDeleteWork(
  workId: number,
  userId: number
): Promise<Work> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const work = await getWorkById(workId, userId);
  if (!work) throw new Error("Work not found");

  await db
    .update(works)
    .set({ deletedAt: new Date(), updatedAt: new Date(), isDefault: "false" })
    .where(
      and(
        eq(works.id, workId),
        eq(works.userId, userId),
        sql`${works.deletedAt} IS NULL`
      )
    );

  await deleteWorkScopedRecordsForDb(userId, workId);

  if (work.isDefault === "true") {
    const nextDefault = await db
      .select()
      .from(works)
      .where(and(eq(works.userId, userId), sql`${works.deletedAt} IS NULL`))
      .orderBy(desc(works.updatedAt))
      .limit(1);
    if (nextDefault[0]) {
      await db
        .update(works)
        .set({ isDefault: "true" })
        .where(eq(works.id, nextDefault[0].id));
    }
  }

  const trashed = await db
    .select()
    .from(works)
    .where(and(eq(works.id, workId), eq(works.userId, userId)))
    .limit(1);
  return trashed[0]!;
}

export async function restoreWork(
  workId: number,
  userId: number
): Promise<Work> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(works)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(works.id, workId),
        eq(works.userId, userId),
        sql`${works.deletedAt} IS NOT NULL`
      )
    );

  await removeGeneratedPlaceholderWorks(userId);

  const restored = await getWorkById(workId, userId);
  if (!restored) throw new Error("Work not found in trash");
  const activeDefault = await db
    .select({ id: works.id })
    .from(works)
    .where(
      and(
        eq(works.userId, userId),
        eq(works.isDefault, "true"),
        sql`${works.deletedAt} IS NULL`
      )
    )
    .limit(1);
  if (!activeDefault[0]) {
    await db
      .update(works)
      .set({ isDefault: "true" })
      .where(eq(works.id, restored.id));
    return { ...restored, isDefault: "true" };
  }
  return restored;
}

export async function permanentDeleteWork(
  workId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const trashed = await db
    .select()
    .from(works)
    .where(
      and(
        eq(works.id, workId),
        eq(works.userId, userId),
        sql`${works.deletedAt} IS NOT NULL`
      )
    )
    .limit(1);

  if (!trashed[0]) throw new Error("Work not found in trash");
  await deleteWorkRecordsForDb(userId, workId);
}

// ============ DRAFTS ============

export async function createDraft(
  userId: number,
  data: Omit<typeof drafts.$inferInsert, "userId">,
  workId: number | null
): Promise<Draft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(data.workId ?? workId, "drafts");

  await db.insert(drafts).values({
    ...data,
    userId,
    workId: targetWorkId,
  });

  const result = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.workId, targetWorkId)))
    .orderBy(desc(drafts.createdAt))
    .limit(1);

  if (!result[0]) throw new Error("Failed to create draft");
  return result[0];
}

export async function countUserDrafts(
  userId: number,
  workId: number | null
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  if (!hasWorkScope(workId)) return 0;

  const conditions = [eq(drafts.userId, userId)];
  conditions.push(eq(drafts.workId, workId));

  const result = await db
    .select({ total: sql<number>`count(*)` })
    .from(drafts)
    .where(and(...conditions));
  return countResult(result[0]?.total);
}

export async function getUserDrafts(
  userId: number,
  workId: number | null,
  pagination?: PaginationOptions
): Promise<Draft[]> {
  const db = await getDb();
  if (!db) return [];
  if (!hasWorkScope(workId)) return [];

  const conditions = [eq(drafts.userId, userId)];
  conditions.push(eq(drafts.workId, workId));

  const page = normalizePagination(pagination);
  if (page) {
    return db
      .select()
      .from(drafts)
      .where(and(...conditions))
      .orderBy(desc(drafts.updatedAt))
      .limit(page.limit)
      .offset(page.offset);
  }

  return db
    .select()
    .from(drafts)
    .where(and(...conditions))
    .orderBy(desc(drafts.updatedAt));
}

export async function getDraftById(
  draftId: number,
  userId: number,
  workId: number | null
): Promise<Draft | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  if (!hasWorkScope(workId)) return undefined;

  const conditions = [eq(drafts.id, draftId), eq(drafts.userId, userId)];
  conditions.push(eq(drafts.workId, workId));

  const result = await db
    .select()
    .from(drafts)
    .where(and(...conditions))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============ CHAPTERS ============

export async function createChapter(
  userId: number,
  data: Omit<typeof chapters.$inferInsert, "userId">,
  workId: number | null
): Promise<Chapter> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(data.workId ?? workId, "chapters");

  await db.insert(chapters).values({
    ...data,
    userId,
    workId: targetWorkId,
  });

  const result = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.userId, userId), eq(chapters.workId, targetWorkId)))
    .orderBy(desc(chapters.createdAt))
    .limit(1);

  if (!result[0]) throw new Error("Failed to create chapter");
  return result[0];
}

export async function countUserChapters(
  userId: number,
  workId: number | null
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  if (!hasWorkScope(workId)) return 0;

  const conditions = [eq(chapters.userId, userId)];
  conditions.push(eq(chapters.workId, workId));

  const result = await db
    .select({ total: sql<number>`count(*)` })
    .from(chapters)
    .where(and(...conditions));
  return countResult(result[0]?.total);
}

export async function getUserChapters(
  userId: number,
  workId: number | null,
  pagination?: PaginationOptions
): Promise<Chapter[]> {
  const db = await getDb();
  if (!db) return [];
  if (!hasWorkScope(workId)) return [];

  const conditions = [eq(chapters.userId, userId)];
  conditions.push(eq(chapters.workId, workId));

  const page = normalizePagination(pagination);
  if (page) {
    return db
      .select()
      .from(chapters)
      .where(and(...conditions))
      .orderBy(desc(chapters.updatedAt))
      .limit(page.limit)
      .offset(page.offset);
  }

  return db
    .select()
    .from(chapters)
    .where(and(...conditions))
    .orderBy(desc(chapters.updatedAt));
}

export async function getChapterById(
  chapterId: number,
  userId: number,
  workId: number | null
): Promise<Chapter | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  if (!hasWorkScope(workId)) return undefined;

  const conditions = [eq(chapters.id, chapterId), eq(chapters.userId, userId)];
  conditions.push(eq(chapters.workId, workId));

  const result = await db
    .select()
    .from(chapters)
    .where(and(...conditions))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============ LIBRARY ENTRIES ============

export async function createLibraryEntry(
  userId: number,
  data: Omit<typeof libraryEntries.$inferInsert, "userId">,
  workId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(data.workId ?? workId, "library entries");

  const result = await db.insert(libraryEntries).values({
    ...data,
    userId,
    workId: targetWorkId,
  });

  return result;
}

export async function countUserLibraryEntries(
  userId: number,
  type: string | undefined = undefined,
  workId: number | null = null
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  if (!hasWorkScope(workId)) return 0;

  const conditions = [eq(libraryEntries.userId, userId)];
  if (type) conditions.push(eq(libraryEntries.type, type as any));
  conditions.push(eq(libraryEntries.workId, workId));

  const result = await db
    .select({ total: sql<number>`count(*)` })
    .from(libraryEntries)
    .where(and(...conditions));
  return countResult(result[0]?.total);
}

export async function getUserLibraryEntries(
  userId: number,
  type: string | undefined = undefined,
  workId: number | null = null,
  pagination?: PaginationOptions
): Promise<LibraryEntry[]> {
  const db = await getDb();
  if (!db) return [];
  if (!hasWorkScope(workId)) return [];

  const conditions = [eq(libraryEntries.userId, userId)];
  if (type) conditions.push(eq(libraryEntries.type, type as any));
  conditions.push(eq(libraryEntries.workId, workId));

  const page = normalizePagination(pagination);
  if (page) {
    return db
      .select()
      .from(libraryEntries)
      .where(and(...conditions))
      .orderBy(desc(libraryEntries.updatedAt))
      .limit(page.limit)
      .offset(page.offset);
  }

  return db
    .select()
    .from(libraryEntries)
    .where(and(...conditions))
    .orderBy(desc(libraryEntries.updatedAt));
}

// ============ AUTHOR PROFILES ============

export async function getOrCreateAuthorProfile(
  userId: number,
  workId: number | null
): Promise<AuthorProfile> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "author profile");

  const conditions = [
    eq(authorProfiles.userId, userId),
    eq(authorProfiles.workId, targetWorkId),
  ];

  let profile = await db
    .select()
    .from(authorProfiles)
    .where(and(...conditions))
    .limit(1);

  if (profile.length === 0) {
    await db.insert(authorProfiles).values({
      userId,
      workId: targetWorkId,
      narrativeStyle: "",
      keyElements: "[]",
      characterVoices: "{}",
      negativeRules: "[]",
      keyChapters: "[]",
      storyFoundation: "",
      continuityMemories: "[]",
    });

    profile = await db
      .select()
      .from(authorProfiles)
      .where(and(...conditions))
      .limit(1);
  }

  return profile[0];
}

export async function updateAuthorProfile(
  userId: number,
  data: Partial<typeof authorProfiles.$inferInsert>,
  workId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "author profile");

  const conditions = [
    eq(authorProfiles.userId, userId),
    eq(authorProfiles.workId, targetWorkId),
  ];

  return db
    .update(authorProfiles)
    .set(data)
    .where(and(...conditions));
}

// ============ CHAPTER REVIEWS ============

export async function createChapterReview(
  userId: number,
  chapterId: number,
  data: Omit<typeof chapterReviews.$inferInsert, "userId" | "chapterId">
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(chapterReviews).values({
    ...data,
    userId,
    chapterId,
  });
}

export async function getChapterReview(
  chapterId: number,
  userId: number
): Promise<ChapterReview | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(chapterReviews)
    .where(
      and(
        eq(chapterReviews.chapterId, chapterId),
        eq(chapterReviews.userId, userId)
      )
    )
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============ NOTIFICATIONS ============

export async function createNotification(
  userId: number,
  data: Omit<typeof notifications.$inferInsert, "userId">
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(notifications).values({
    ...data,
    userId,
  });
}

export async function getUserNotifications(userId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationAsRead(
  notificationId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(notifications)
    .set({ isRead: "true" })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      )
    );
}

export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .update(notifications)
    .set({ isRead: "true" })
    .where(
      and(eq(notifications.userId, userId), eq(notifications.isRead, "false"))
    );
}

export async function getUnreadNotificationCount(
  userId: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), eq(notifications.isRead, "false"))
    );

  return result.length;
}

// ============ STATISTICS ============

export async function getOrCreateStatistics(
  userId: number,
  workId: number | null
): Promise<Statistic> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "statistics");

  const conditions = [
    eq(statistics.userId, userId),
    eq(statistics.workId, targetWorkId),
  ];

  let stat = await db
    .select()
    .from(statistics)
    .where(and(...conditions))
    .limit(1);

  if (stat.length === 0) {
    await db.insert(statistics).values({
      userId,
      workId: targetWorkId,
      totalChaptersGenerated: 0,
      totalWordsWritten: 0,
      totalCharactersCreated: 0,
      totalEventsCreated: 0,
      totalLocationsCreated: 0,
    });

    stat = await db
      .select()
      .from(statistics)
      .where(and(...conditions))
      .limit(1);
  }

  return stat[0]!;
}

export async function updateStatistics(
  userId: number,
  updates: Partial<Omit<typeof statistics.$inferInsert, "userId">>,
  workId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "statistics");

  const conditions = [
    eq(statistics.userId, userId),
    eq(statistics.workId, targetWorkId),
  ];

  return db
    .update(statistics)
    .set(updates)
    .where(and(...conditions));
}

export async function incrementChapterCount(
  userId: number,
  wordCount: number = 0,
  workId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "statistics");

  const current = await getOrCreateStatistics(userId, targetWorkId);

  const conditions = [
    eq(statistics.userId, userId),
    eq(statistics.workId, targetWorkId),
  ];

  return db
    .update(statistics)
    .set({
      totalChaptersGenerated: (current.totalChaptersGenerated || 0) + 1,
      totalWordsWritten: (current.totalWordsWritten || 0) + wordCount,
      lastGenerationDate: new Date(),
    })
    .where(and(...conditions));
}

export async function incrementLibraryCount(
  userId: number,
  type: "character" | "event" | "location",
  workId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "statistics");

  const current = await getOrCreateStatistics(userId, targetWorkId);
  const updates: Record<string, number> = {};

  if (type === "character") {
    updates.totalCharactersCreated = (current.totalCharactersCreated || 0) + 1;
  } else if (type === "event") {
    updates.totalEventsCreated = (current.totalEventsCreated || 0) + 1;
  } else if (type === "location") {
    updates.totalLocationsCreated = (current.totalLocationsCreated || 0) + 1;
  }

  const conditions2 = [
    eq(statistics.userId, userId),
    eq(statistics.workId, targetWorkId),
  ];

  return db
    .update(statistics)
    .set(updates)
    .where(and(...conditions2));
}

// ============ CHAPTER VERSIONS ============

export async function createChapterVersion(
  chapterId: number,
  userId: number,
  content: string,
  changeDescription: string
): Promise<ChapterVersion> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get the latest version number
  const latestVersion = await db
    .select()
    .from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.versionNumber))
    .limit(1);

  const nextVersionNumber = (latestVersion[0].versionNumber || 0) + 1;

  const result = await db.insert(chapterVersions).values({
    chapterId,
    userId,
    content,
    versionNumber: nextVersionNumber,
    changeDescription,
  });

  const inserted = await db
    .select()
    .from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.versionNumber))
    .limit(1);

  return inserted[0]!;
}

export async function getChapterVersions(
  chapterId: number
): Promise<ChapterVersion[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.createdAt));
}

export async function getChapterVersion(
  versionId: number
): Promise<ChapterVersion | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(chapterVersions)
    .where(eq(chapterVersions.id, versionId))
    .limit(1);

  return result[0];
}

// ============ CHARACTERS ============

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type CharacterReference = string | number;

function parseCharacterReferences(
  raw: string | null | undefined
): CharacterReference[] {
  return safeJsonParse<CharacterReference[]>(raw, []).filter(
    item => typeof item === "string" || typeof item === "number"
  );
}

function serializeCharacterReferences(items: CharacterReference[]) {
  return JSON.stringify(
    Array.from(
      new Set(
        items.filter(item =>
          typeof item === "number"
            ? Number.isFinite(item)
            : Boolean(item.trim())
        )
      )
    )
  );
}

async function syncCharacterReferencesAfterRename(
  userId: number,
  oldName: string,
  nextCharacter: Character
) {
  const db = await getDb();
  if (!db || oldName === nextCharacter.name) return;

  const userDrafts = await getUserDrafts(userId, nextCharacter.workId ?? null);
  for (const draft of userDrafts) {
    const current = parseCharacterReferences(draft.mainCharacters);
    const hasLegacyName = current.some(
      item => typeof item === "string" && item === oldName
    );
    if (!hasLegacyName) continue;
    const updated = current.map(item =>
      typeof item === "string" && item === oldName ? nextCharacter.name : item
    );
    await db
      .update(drafts)
      .set({ mainCharacters: serializeCharacterReferences(updated) })
      .where(and(eq(drafts.id, draft.id), eq(drafts.userId, userId)));
  }
}

async function cleanupCharacterReferencesOnDelete(
  userId: number,
  character: Character
) {
  const db = await getDb();
  if (!db) return;

  const userDrafts = await getUserDrafts(userId, character.workId ?? null);
  for (const draft of userDrafts) {
    const current = parseCharacterReferences(draft.mainCharacters);
    const hasReference = current.some(
      item =>
        item === character.id ||
        (typeof item === "string" && item === character.name)
    );
    if (!hasReference) continue;
    const updated = current.filter(
      item =>
        item !== character.id &&
        !(typeof item === "string" && item === character.name)
    );
    await db
      .update(drafts)
      .set({ mainCharacters: serializeCharacterReferences(updated) })
      .where(and(eq(drafts.id, draft.id), eq(drafts.userId, userId)));
  }
}

export async function createCharacter(
  userId: number,
  data: Omit<InsertCharacter, "userId">,
  workId: number | null
): Promise<Character> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(data.workId ?? workId, "characters");

  await db.insert(characters).values({
    ...data,
    userId,
    workId: targetWorkId,
  });

  const inserted = await db
    .select()
    .from(characters)
    .where(and(eq(characters.userId, userId), eq(characters.workId, targetWorkId)))
    .orderBy(desc(characters.createdAt))
    .limit(1);

  return inserted[0]!;
}

export async function countCharactersByUserId(
  userId: number,
  workId: number | null
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  if (!hasWorkScope(workId)) return 0;

  const conditions = [eq(characters.userId, userId)];
  conditions.push(eq(characters.workId, workId));

  const result = await db
    .select({ total: sql<number>`count(*)` })
    .from(characters)
    .where(and(...conditions));
  return countResult(result[0]?.total);
}

export async function getCharactersByUserId(
  userId: number,
  workId: number | null,
  pagination?: PaginationOptions
): Promise<Character[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!hasWorkScope(workId)) return [];

  const conditions = [eq(characters.userId, userId)];
  conditions.push(eq(characters.workId, workId));

  const page = normalizePagination(pagination);
  if (page) {
    return db
      .select()
      .from(characters)
      .where(and(...conditions))
      .orderBy(asc(characters.name))
      .limit(page.limit)
      .offset(page.offset);
  }

  return db
    .select()
    .from(characters)
    .where(and(...conditions))
    .orderBy(asc(characters.name));
}

export async function searchCharactersByName(
  userId: number,
  query: string,
  workId: number | null
): Promise<Character[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!hasWorkScope(workId)) return [];

  const conditions = [
    eq(characters.userId, userId),
    like(characters.name, prefixLikePattern(query)),
  ];
  conditions.push(eq(characters.workId, workId));

  return db
    .select()
    .from(characters)
    .where(and(...conditions))
    .orderBy(asc(characters.name))
    .limit(5);
}

export async function getCharacterById(
  characterId: number,
  userId: number,
  workId: number | null
): Promise<Character | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!hasWorkScope(workId)) return undefined;

  const conditions = [
    eq(characters.id, characterId),
    eq(characters.userId, userId),
  ];
  conditions.push(eq(characters.workId, workId));

  const result = await db
    .select()
    .from(characters)
    .where(and(...conditions))
    .limit(1);

  return result[0];
}

export async function updateCharacter(
  characterId: number,
  userId: number,
  data: Partial<Omit<InsertCharacter, "userId">>,
  workId: number | null
): Promise<Character> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "characters");

  const existing = await getCharacterById(characterId, userId, targetWorkId);
  if (!existing) throw new Error("Character not found");

  await db
    .update(characters)
    .set(data)
    .where(
      and(
        eq(characters.id, characterId),
        eq(characters.userId, userId),
        eq(characters.workId, targetWorkId)
      )
    );

  const updated = await db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        eq(characters.userId, userId),
        eq(characters.workId, targetWorkId)
      )
    )
    .limit(1);

  const nextCharacter = updated[0]!;
  await syncCharacterReferencesAfterRename(
    userId,
    existing.name,
    nextCharacter
  );

  return nextCharacter;
}

export async function deleteCharacter(
  characterId: number,
  userId: number,
  workId: number | null
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "characters");

  const existing = await getCharacterById(characterId, userId, targetWorkId);
  if (!existing) throw new Error("Character not found");

  await db
    .delete(characters)
    .where(
      and(
        eq(characters.id, characterId),
        eq(characters.userId, userId),
        eq(characters.workId, targetWorkId)
      )
    );

  await cleanupCharacterReferencesOnDelete(userId, existing);
}

// ============ PROMPT TEMPLATES ============

export async function createPromptTemplate(
  userId: number,
  data: Omit<InsertPromptTemplate, "userId">,
  workId: number | null
): Promise<PromptTemplate> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(data.workId ?? workId, "prompt templates");

  await db.insert(promptTemplates).values({
    ...data,
    userId,
    workId: targetWorkId,
  });

  const result = await db
    .select()
    .from(promptTemplates)
    .where(and(eq(promptTemplates.userId, userId), eq(promptTemplates.workId, targetWorkId)))
    .orderBy(desc(promptTemplates.createdAt))
    .limit(1);

  if (!result[0]) throw new Error("Failed to create template");
  return result[0];
}

export async function getPromptTemplatesByUserId(
  userId: number,
  workId: number | null
): Promise<PromptTemplate[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!hasWorkScope(workId)) return [];

  const conditions = [eq(promptTemplates.userId, userId)];
  conditions.push(eq(promptTemplates.workId, workId));

  return db
    .select()
    .from(promptTemplates)
    .where(and(...conditions))
    .orderBy(desc(promptTemplates.createdAt));
}

export async function getPromptTemplateById(
  templateId: number,
  userId: number,
  workId: number | null
): Promise<PromptTemplate | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!hasWorkScope(workId)) return undefined;

  const conditions = [
    eq(promptTemplates.id, templateId),
    eq(promptTemplates.userId, userId),
  ];
  conditions.push(eq(promptTemplates.workId, workId));

  const result = await db
    .select()
    .from(promptTemplates)
    .where(and(...conditions))
    .limit(1);

  return result[0];
}

export async function updatePromptTemplate(
  templateId: number,
  userId: number,
  data: Partial<Omit<InsertPromptTemplate, "userId">>,
  workId: number | null
): Promise<PromptTemplate> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "prompt templates");

  await db
    .update(promptTemplates)
    .set(data)
    .where(
      and(
        eq(promptTemplates.id, templateId),
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.workId, targetWorkId)
      )
    );

  const updated = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.id, templateId),
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.workId, targetWorkId)
      )
    )
    .limit(1);

  if (!updated[0]) throw new Error("Template not found");
  return updated[0];
}

export async function deletePromptTemplate(
  templateId: number,
  userId: number,
  workId: number | null
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "prompt templates");

  await db
    .delete(promptTemplates)
    .where(
      and(
        eq(promptTemplates.id, templateId),
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.workId, targetWorkId)
      )
    );
}

// ============ DRAFT / CHAPTER UPDATES ============

export async function updateDraft(
  draftId: number,
  userId: number,
  data: Partial<Omit<typeof drafts.$inferInsert, "userId">>,
  workId: number | null
): Promise<Draft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "drafts");

  await db
    .update(drafts)
    .set(data)
    .where(
      and(
        eq(drafts.id, draftId),
        eq(drafts.userId, userId),
        eq(drafts.workId, targetWorkId)
      )
    );

  const updated = await getDraftById(draftId, userId, targetWorkId);
  if (!updated) throw new Error("Draft not found after update");
  return updated;
}

export async function setDraftStatus(
  draftId: number,
  userId: number,
  status: "draft" | "sent_to_writing" | "archived",
  workId: number | null
) {
  return updateDraft(draftId, userId, { status }, workId);
}

export async function deleteDraft(
  draftId: number,
  userId: number,
  workId: number | null
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "drafts");
  const conditions = [
    eq(drafts.id, draftId),
    eq(drafts.userId, userId),
    eq(drafts.workId, targetWorkId),
  ];
  const deleted = await db
    .delete(drafts)
    .where(and(...conditions))
    .returning({ id: drafts.id });
  return deleted.length > 0;
}

export async function updateChapter(
  chapterId: number,
  userId: number,
  data: Partial<Omit<typeof chapters.$inferInsert, "userId">>,
  workId: number | null
): Promise<Chapter> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const targetWorkId = requireWorkScope(workId, "chapters");

  await db
    .update(chapters)
    .set(data)
    .where(
      and(
        eq(chapters.id, chapterId),
        eq(chapters.userId, userId),
        eq(chapters.workId, targetWorkId)
      )
    );

  const updated = await getChapterById(chapterId, userId, targetWorkId);
  if (!updated) throw new Error("Chapter not found after update");
  return updated;
}

// ============ SEARCH HELPERS ============

export async function searchLibraryEntries(
  userId: number,
  query: string,
  type: string,
  limit: number = 10,
  workId: number | null
): Promise<LibraryEntry[]> {
  const db = await getDb();
  if (!db) return [];
  if (!hasWorkScope(workId)) return [];

  const q = containsLikePattern(query);
  const conditions = [eq(libraryEntries.userId, userId)];
  if (type) conditions.push(eq(libraryEntries.type, type as any));
  conditions.push(eq(libraryEntries.workId, workId));

  return db
    .select()
    .from(libraryEntries)
    .where(and(...conditions, like(libraryEntries.name, q)))
    .orderBy(desc(libraryEntries.updatedAt))
    .limit(limit);
}

export async function searchLibraryEntriesBroad(
  userId: number,
  query: string,
  type: string,
  limit: number = 10,
  workId: number | null
): Promise<LibraryEntry[]> {
  const db = await getDb();
  if (!db) return [];
  if (!hasWorkScope(workId)) return [];

  const q = containsLikePattern(query);
  const conditions = [
    eq(libraryEntries.userId, userId),
    sql`(${libraryEntries.name} LIKE ${q} OR ${libraryEntries.description} LIKE ${q} OR ${libraryEntries.details} LIKE ${q})`,
  ];
  if (type) conditions.push(eq(libraryEntries.type, type as any));
  conditions.push(eq(libraryEntries.workId, workId));

  return db
    .select()
    .from(libraryEntries)
    .where(and(...conditions))
    .orderBy(desc(libraryEntries.updatedAt))
    .limit(limit);
}

export async function searchChaptersByContent(
  userId: number,
  query: string,
  limit: number = 5,
  workId: number | null
): Promise<Chapter[]> {
  const db = await getDb();
  if (!db) return [];
  if (!hasWorkScope(workId)) return [];

  const q = containsLikePattern(query);
  const conditions = [
    eq(chapters.userId, userId),
    sql`(${chapters.title} LIKE ${q} OR ${chapters.content} LIKE ${q})`,
  ];
  conditions.push(eq(chapters.workId, workId));

  return db
    .select()
    .from(chapters)
    .where(and(...conditions))
    .orderBy(desc(chapters.updatedAt))
    .limit(limit);
}

export async function searchDraftsByContent(
  userId: number,
  query: string,
  limit: number = 5,
  workId: number | null
): Promise<Draft[]> {
  const db = await getDb();
  if (!db) return [];
  if (!hasWorkScope(workId)) return [];

  const q = containsLikePattern(query);
  const conditions = [
    eq(drafts.userId, userId),
    sql`(${drafts.title} LIKE ${q} OR ${drafts.content} LIKE ${q} OR ${drafts.summary} LIKE ${q})`,
  ];
  conditions.push(eq(drafts.workId, workId));

  return db
    .select()
    .from(drafts)
    .where(and(...conditions))
    .orderBy(desc(drafts.updatedAt))
    .limit(limit);
}

// ============ REVIEW HELPERS ============

export async function listReviewsByUserId(
  userId: number
): Promise<ChapterReview[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(chapterReviews)
    .where(eq(chapterReviews.userId, userId))
    .orderBy(desc(chapterReviews.updatedAt));
}

export async function upsertChapterReview(
  userId: number,
  chapterId: number,
  data: {
    comments?: string | null;
    alerts?: string | null;
    revisionBrief?: string | null;
    revisionFixCount?: number;
    status?:
      | "in_writing"
      | "pending"
      | "approved"
      | "rejected"
      | "revision_needed"
      | null;
  }
): Promise<ChapterReview> {
  const existing = await getChapterReview(chapterId, userId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (existing) {
    await db
      .update(chapterReviews)
      .set(data)
      .where(
        and(
          eq(chapterReviews.chapterId, chapterId),
          eq(chapterReviews.userId, userId)
        )
      );
  } else {
    await db.insert(chapterReviews).values({
      chapterId,
      userId,
      comments: data.comments ?? null,
      alerts: data.alerts ?? null,
      revisionBrief: data.revisionBrief ?? null,
      revisionFixCount: data.revisionFixCount ?? 0,
      status: data.status || "pending",
    });
  }

  const review = await getChapterReview(chapterId, userId);
  if (!review) throw new Error("Review not found after upsert");
  return review;
}

// ============ BILLING ============

function isDuplicateKeyError(error: unknown) {
  const err = error as { code?: string; errno?: number; message?: string };
  return (
    err?.code === "ER_DUP_ENTRY" ||
    err?.errno === 1062 ||
    /duplicate/i.test(err?.message || "")
  );
}

export async function getCreditWallet(userId: number): Promise<CreditWallet> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let result = await db
    .select()
    .from(creditWallets)
    .where(eq(creditWallets.userId, userId))
    .limit(1);

  if (result.length === 0) {
    try {
      await db
        .insert(creditWallets)
        .values({ userId, balance: STARTER_WALLET_CREDITS });
      await db.insert(creditLedgerEntries).values({
        userId,
        workId: null,
        type: "grant",
        amount: STARTER_WALLET_CREDITS,
        balanceAfter: STARTER_WALLET_CREDITS,
        reason: "Créditos flexíveis iniciais",
        reference: "starter-pack",
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    result = await db
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.userId, userId))
      .limit(1);
  }

  return result[0]!;
}

export async function grantCredits(
  userId: number,
  amount: number,
  reason: string,
  options: {
    workId?: number | null;
    reference?: string | null;
    type?: CreditLedgerEntry["type"];
  } = {}
): Promise<CreditWallet> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const wallet = await getCreditWallet(userId);
  const newBalance = wallet.balance + amount;

  await db
    .update(creditWallets)
    .set({ balance: newBalance })
    .where(eq(creditWallets.userId, userId));

  await db.insert(creditLedgerEntries).values({
    userId,
    workId: options.workId ?? null,
    type: options.type ?? "grant",
    amount,
    balanceAfter: newBalance,
    reason,
    reference: options.reference ?? null,
  });

  return { ...wallet, balance: newBalance };
}

async function ensurePlanWalletAllowance(
  userId: number,
  subscription: UserSubscription
): Promise<CreditWallet> {
  const wallet = await getCreditWallet(userId);
  if (!canReceivePlanWalletAllowance(subscription)) return wallet;

  const amount = resolvePlanWalletAllowance(subscription);
  if (amount <= 0) return wallet;

  const db = await getDb();
  if (!db) return wallet;

  if (subscription.creditAllowance !== amount) {
    await db
      .update(userSubscriptions)
      .set({ creditAllowance: amount })
      .where(eq(userSubscriptions.userId, userId));
    subscription.creditAllowance = amount;
  }

  const reference = planWalletGrantReference(subscription.planCode);
  const equivalentReferences = [
    reference,
    ...legacyPlanWalletGrantReferences(subscription.planCode),
  ];
  const existing = await db
    .select()
    .from(creditLedgerEntries)
    .where(
      and(
        eq(creditLedgerEntries.userId, userId),
        inArray(creditLedgerEntries.reference, equivalentReferences)
      )
    )
    .limit(1);

  if (existing.length > 0) return wallet;

  return grantCredits(
    userId,
    amount,
    `Créditos flexíveis do plano ${subscription.planCode}`,
    {
      reference,
      type: "grant",
    }
  );
}

export async function chargeCredits(
  userId: number,
  amount: number,
  reason: string,
  options: { workId?: number | null; reference?: string | null } = {}
): Promise<CreditWallet> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (amount <= 0) throw new Error("Amount must be positive");

  // Make sure the wallet row exists.
  await getCreditWallet(userId);

  // C8: atomic debit. The previous implementation read the balance, checked
  // it in JS, then wrote — two parallel requests with cost=25 against a
  // wallet of 25 could both pass the check and overdraw. The conditional
  // UPDATE below either decrements the balance OR matches zero rows, in
  // which case we know the user is broke.
  const charged = await db
    .update(creditWallets)
    .set({ balance: sql`${creditWallets.balance} - ${amount}` })
    .where(
      and(
        eq(creditWallets.userId, userId),
        sql`${creditWallets.balance} >= ${amount}`
      )
    )
    .returning({ id: creditWallets.id });

  if (!charged.length) {
    const current = await getCreditWallet(userId);
    throw new Error(
      `Créditos insuficientes. Necessário: ${amount}, disponível: ${current.balance}.`
    );
  }

  // Re-read the wallet to learn the new balance so the ledger row is consistent.
  const updated = await getCreditWallet(userId);

  await db.insert(creditLedgerEntries).values({
    userId,
    workId: options.workId ?? null,
    type: "usage",
    amount: -amount,
    balanceAfter: updated.balance,
    reason,
    reference: options.reference ?? null,
  });

  return updated;
}

export async function listCreditLedgerEntries(
  userId: number,
  limit: number = 50
): Promise<CreditLedgerEntry[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(creditLedgerEntries)
    .where(eq(creditLedgerEntries.userId, userId))
    .orderBy(desc(creditLedgerEntries.createdAt))
    .limit(limit);
}

export async function getUserSubscription(
  userId: number
): Promise<UserSubscription> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let result = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, userId))
    .limit(1);

  if (result.length === 0) {
    await db.insert(userSubscriptions).values({
      userId,
      planCode: "none",
      status: "none",
      creditAllowance: 0,
      planTier: "free",
      monthlyNarrativeCreditLimit: 5000,
      monthlyNarrativeCreditsUsed: 0,
      monthlyNarrativeCreditsReserved: 0,
      extraNarrativeCredits: 0,
      extraNarrativeCreditsReserved: 0,
      billingCycleStart: null,
      billingCycleEnd: null,
      monthlyInspirationUsed: 0,
      monthlyTextReviewUsed: 0,
    });
    result = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .limit(1);
  }

  return result[0]!;
}

export async function upsertUserSubscription(
  userId: number,
  data: Partial<
    Omit<UserSubscription, "id" | "userId" | "createdAt" | "updatedAt">
  >
): Promise<UserSubscription> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getUserSubscription(userId);

  await db
    .update(userSubscriptions)
    .set({
      ...data,
      creditAllowance:
        data.creditAllowance ??
        getPlanWalletAllowance(data.planCode ?? existing.planCode),
    })
    .where(eq(userSubscriptions.userId, userId));

  const result = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.userId, userId))
    .limit(1);

  await ensurePlanWalletAllowance(userId, result[0]!);

  return result[0]!;
}

export async function getBillingSummary(userId: number) {
  let subscription = await getUserSubscription(userId);
  await ensurePlanWalletAllowance(userId, subscription);
  subscription = await getUserSubscription(userId);
  const wallet = await getCreditWallet(userId);

  const db = await getDb();
  if (!db) return { wallet, subscription, recentEntries: [] };

  const recentEntries = await db
    .select()
    .from(creditLedgerEntries)
    .where(eq(creditLedgerEntries.userId, userId))
    .orderBy(desc(creditLedgerEntries.createdAt))
    .limit(20);

  return { wallet, subscription, recentEntries };
}

// --- Generation Jobs ---

type GenerationJobStatus = GenerationJob["status"];
type CreateGenerationJobData = Omit<
  GenerationJob,
  "id" | "createdAt" | "updatedAt"
> &
  Partial<Pick<GenerationJob, "id" | "createdAt" | "updatedAt">>;
type CreateGenerationCostLogData = Omit<GenerationCostLog, "id" | "createdAt"> &
  Partial<Pick<GenerationCostLog, "id" | "createdAt">>;
type CreateGenerationUsageLedgerData = Omit<
  GenerationUsageLedgerEntry,
  "id" | "createdAt"
> &
  Partial<Pick<GenerationUsageLedgerEntry, "id" | "createdAt">>;

const ACTIVE_GENERATION_JOB_STATUSES: GenerationJobStatus[] = [
  "queued",
  "preparing",
  "generating",
  "finalizing",
];

export async function getGenerationJobByPublicId(
  publicId: string,
  userId: number
): Promise<GenerationJob | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.publicId, publicId),
        eq(generationJobs.userId, userId)
      )
    )
    .limit(1);
  return rows[0];
}

export async function getGenerationJobById(
  jobId: number,
  userId?: number
): Promise<GenerationJob | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const where =
    userId === undefined
      ? eq(generationJobs.id, jobId)
      : and(eq(generationJobs.id, jobId), eq(generationJobs.userId, userId));
  const rows = await db.select().from(generationJobs).where(where).limit(1);
  return rows[0];
}

export async function findGenerationJobByIdempotencyKey(
  userId: number,
  idempotencyKey: string
): Promise<GenerationJob | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.userId, userId),
        eq(generationJobs.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  return rows[0];
}

export async function findActiveGenerationJobForTarget(
  userId: number,
  workId: number,
  options: { draftId?: number | null; chapterId?: number | null } = {}
): Promise<GenerationJob | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const conditions = [
    eq(generationJobs.userId, userId),
    eq(generationJobs.workId, workId),
    inArray(generationJobs.status, ACTIVE_GENERATION_JOB_STATUSES),
  ];
  if (options.draftId != null)
    conditions.push(eq(generationJobs.draftId, options.draftId));
  if (options.chapterId != null)
    conditions.push(eq(generationJobs.chapterId, options.chapterId));
  const rows = await db
    .select()
    .from(generationJobs)
    .where(and(...conditions))
    .limit(1);
  return rows[0];
}

export async function createGenerationJob(
  data: CreateGenerationJobData
): Promise<GenerationJob> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(generationJobs).values(data);
  const rows = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.userId, data.userId),
        eq(generationJobs.idempotencyKey, data.idempotencyKey)
      )
    )
    .limit(1);
  if (!rows[0]) throw new Error("Generation job not found after insert");
  return rows[0];
}

export async function updateGenerationJob(
  jobId: number,
  data: Partial<Omit<GenerationJob, "id" | "createdAt" | "updatedAt">>
): Promise<GenerationJob> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(generationJobs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(generationJobs.id, jobId));
  const row = await getGenerationJobById(jobId);
  if (!row) throw new Error("Generation job not found after update");
  return row;
}

export async function listActiveGenerationJobs(
  userId: number,
  workId?: number | null
): Promise<GenerationJob[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    eq(generationJobs.userId, userId),
    inArray(generationJobs.status, ACTIVE_GENERATION_JOB_STATUSES),
  ];
  if (workId != null) conditions.push(eq(generationJobs.workId, workId));
  return db
    .select()
    .from(generationJobs)
    .where(and(...conditions))
    .orderBy(desc(generationJobs.updatedAt));
}

export async function acquireNextGenerationJob(
  workerId: string,
  lockMs: number
): Promise<GenerationJob | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const timestamp = new Date();
  const rows = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        inArray(generationJobs.status, ACTIVE_GENERATION_JOB_STATUSES),
        sql`${generationJobs.attempts} < ${generationJobs.maxAttempts}`,
        or(
          eq(generationJobs.status, "queued"),
          lt(generationJobs.lockExpiresAt, timestamp)
        )
      )
    )
    .orderBy(asc(generationJobs.createdAt))
    .limit(1);

  const job = rows[0];
  if (!job) return undefined;

  await db
    .update(generationJobs)
    .set({
      status: "preparing",
      progressMessage: "Estamos preparando o contexto narrativo da sua obra.",
      lockedAt: timestamp,
      lockedBy: workerId,
      lockExpiresAt: new Date(timestamp.getTime() + lockMs),
      attempts: sql`${generationJobs.attempts} + 1`,
      updatedAt: timestamp,
    })
    .where(eq(generationJobs.id, job.id));

  return getGenerationJobById(job.id);
}

export async function createGenerationCostLog(
  data: CreateGenerationCostLogData
): Promise<GenerationCostLog> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(generationCostLogs).values(data);
  const rows = await db
    .select()
    .from(generationCostLogs)
    .where(
      and(
        eq(generationCostLogs.jobId, data.jobId),
        eq(generationCostLogs.userId, data.userId)
      )
    )
    .orderBy(desc(generationCostLogs.createdAt))
    .limit(1);
  if (!rows[0]) throw new Error("Generation cost log not found after insert");
  return rows[0];
}

export async function createGenerationUsageLedgerEntry(
  data: CreateGenerationUsageLedgerData
): Promise<GenerationUsageLedgerEntry> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(generationUsageLedger).values(data);
  const rows = await db
    .select()
    .from(generationUsageLedger)
    .where(
      and(
        eq(generationUsageLedger.jobId, data.jobId),
        eq(generationUsageLedger.userId, data.userId),
        eq(generationUsageLedger.type, data.type)
      )
    )
    .orderBy(desc(generationUsageLedger.createdAt))
    .limit(1);
  if (!rows[0])
    throw new Error("Generation usage ledger entry not found after insert");
  return rows[0];
}

export async function updateUserSubscriptionGenerationUsage(
  userId: number,
  data: Partial<
    Pick<
      UserSubscription,
      | "planTier"
      | "monthlyNarrativeCreditLimit"
      | "monthlyNarrativeCreditsUsed"
      | "monthlyNarrativeCreditsReserved"
      | "extraNarrativeCredits"
      | "extraNarrativeCreditsReserved"
      | "monthlyAnalysisCreditLimit"
      | "monthlyAnalysisCreditsUsed"
      | "monthlyAnalysisCreditsReserved"
      | "extraAnalysisCredits"
      | "extraAnalysisCreditsReserved"
      | "billingCycleStart"
      | "billingCycleEnd"
      | "monthlyInspirationUsed"
      | "monthlyTextReviewUsed"
    >
  >
): Promise<UserSubscription> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(userSubscriptions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(userSubscriptions.userId, userId));
  return getUserSubscription(userId);
}

// ─────────────────────────────────────────────────────────────────────────
// Audit Reports (Auditoria de Consistência Narrativa)
// ─────────────────────────────────────────────────────────────────────────
//
// Cada nova auditoria cria UM novo registro — nunca sobrescrevemos relatórios
// anteriores. O histórico por workId fica preservado. updateAuditReport existe
// só pra correções pontuais de contadores; o ciclo normal é create-only.

type CreateAuditReportData = Omit<InsertAuditReport, "id" | "createdAt"> & {
  id?: number;
  createdAt?: Date;
};

export async function createAuditReport(
  data: CreateAuditReportData
): Promise<AuditReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(auditReports).values({
    jobId: data.jobId,
    publicJobId: data.publicJobId,
    userId: data.userId,
    workId: data.workId,
    wordCount: data.wordCount,
    analysisCreditsCharged: data.analysisCreditsCharged,
    strategy: data.strategy,
    engine: data.engine,
    totalIssues: data.totalIssues ?? 0,
    criticalCount: data.criticalCount ?? 0,
    highCount: data.highCount ?? 0,
    mediumCount: data.mediumCount ?? 0,
    lowCount: data.lowCount ?? 0,
    issuesJson: data.issuesJson,
    ...(data.createdAt ? { createdAt: data.createdAt } : {}),
  });
  const rows = await db
    .select()
    .from(auditReports)
    .where(
      and(
        eq(auditReports.jobId, data.jobId),
        eq(auditReports.userId, data.userId)
      )
    )
    .orderBy(desc(auditReports.createdAt))
    .limit(1);
  if (!rows[0]) throw new Error("Audit report not found after insert");
  return rows[0];
}

export async function getAuditReportById(
  reportId: number,
  userId?: number
): Promise<AuditReport | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const conditions = [eq(auditReports.id, reportId)];
  if (userId !== undefined) conditions.push(eq(auditReports.userId, userId));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await db.select().from(auditReports).where(where).limit(1);
  return rows[0];
}

export async function getAuditReportByJobId(
  jobId: number,
  userId?: number
): Promise<AuditReport | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const conditions = [eq(auditReports.jobId, jobId)];
  if (userId !== undefined) conditions.push(eq(auditReports.userId, userId));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await db.select().from(auditReports).where(where).limit(1);
  return rows[0];
}

export async function getLatestAuditReportByWork(
  workId: number,
  userId: number
): Promise<AuditReport | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(auditReports)
    .where(
      and(eq(auditReports.workId, workId), eq(auditReports.userId, userId))
    )
    .orderBy(desc(auditReports.createdAt))
    .limit(1);
  return rows[0];
}

export async function listAuditReportsByWork(
  workId: number,
  userId: number,
  options?: PaginationOptions
): Promise<AuditReport[]> {
  const db = await getDb();
  if (!db) return [];
  const page = normalizePagination(options);
  const base = db
    .select()
    .from(auditReports)
    .where(
      and(eq(auditReports.workId, workId), eq(auditReports.userId, userId))
    )
    .orderBy(desc(auditReports.createdAt));
  if (page) {
    return base.limit(page.limit).offset(page.offset);
  }
  return base;
}

type AuditReportUpdate = Partial<
  Pick<
    AuditReport,
    | "wordCount"
    | "analysisCreditsCharged"
    | "strategy"
    | "engine"
    | "totalIssues"
    | "criticalCount"
    | "highCount"
    | "mediumCount"
    | "lowCount"
    | "issuesJson"
  >
>;

export async function updateAuditReport(
  reportId: number,
  data: AuditReportUpdate
): Promise<AuditReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(auditReports).set(data).where(eq(auditReports.id, reportId));
  const updated = await getAuditReportById(reportId);
  if (!updated) throw new Error("Audit report not found after update");
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────
// Improvement Reports (Melhorias Narrativas)
// ─────────────────────────────────────────────────────────────────────────
//
// Estrutura paralela aos audit reports: cada job de
// action=narrative_improvements gera UM novo registro. Histórico preservado.

type CreateImprovementReportData = Omit<
  InsertImprovementReport,
  "id" | "createdAt"
> & {
  id?: number;
  createdAt?: Date;
};

export async function createImprovementReport(
  data: CreateImprovementReportData
): Promise<ImprovementReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(improvementReports).values({
    jobId: data.jobId,
    publicJobId: data.publicJobId,
    userId: data.userId,
    workId: data.workId,
    wordCount: data.wordCount,
    analysisCreditsCharged: data.analysisCreditsCharged,
    strategy: data.strategy,
    engine: data.engine,
    totalSuggestions: data.totalSuggestions ?? 0,
    criticalCount: data.criticalCount ?? 0,
    highCount: data.highCount ?? 0,
    mediumCount: data.mediumCount ?? 0,
    lowCount: data.lowCount ?? 0,
    suggestionsJson: data.suggestionsJson,
    ...(data.createdAt ? { createdAt: data.createdAt } : {}),
  });
  const rows = await db
    .select()
    .from(improvementReports)
    .where(
      and(
        eq(improvementReports.jobId, data.jobId),
        eq(improvementReports.userId, data.userId)
      )
    )
    .orderBy(desc(improvementReports.createdAt))
    .limit(1);
  if (!rows[0]) throw new Error("Improvement report not found after insert");
  return rows[0];
}

export async function getImprovementReportById(
  reportId: number,
  userId?: number
): Promise<ImprovementReport | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const conditions = [eq(improvementReports.id, reportId)];
  if (userId !== undefined)
    conditions.push(eq(improvementReports.userId, userId));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await db.select().from(improvementReports).where(where).limit(1);
  return rows[0];
}

export async function getImprovementReportByJobId(
  jobId: number,
  userId?: number
): Promise<ImprovementReport | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const conditions = [eq(improvementReports.jobId, jobId)];
  if (userId !== undefined)
    conditions.push(eq(improvementReports.userId, userId));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await db.select().from(improvementReports).where(where).limit(1);
  return rows[0];
}

export async function getLatestImprovementReportByWork(
  workId: number,
  userId: number
): Promise<ImprovementReport | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(improvementReports)
    .where(
      and(
        eq(improvementReports.workId, workId),
        eq(improvementReports.userId, userId)
      )
    )
    .orderBy(desc(improvementReports.createdAt))
    .limit(1);
  return rows[0];
}

export async function listImprovementReportsByWork(
  workId: number,
  userId: number,
  options?: PaginationOptions
): Promise<ImprovementReport[]> {
  const db = await getDb();
  if (!db) return [];
  const page = normalizePagination(options);
  const base = db
    .select()
    .from(improvementReports)
    .where(
      and(
        eq(improvementReports.workId, workId),
        eq(improvementReports.userId, userId)
      )
    )
    .orderBy(desc(improvementReports.createdAt));
  if (page) {
    return base.limit(page.limit).offset(page.offset);
  }
  return base;
}

type ImprovementReportUpdate = Partial<
  Pick<
    ImprovementReport,
    | "wordCount"
    | "analysisCreditsCharged"
    | "strategy"
    | "engine"
    | "totalSuggestions"
    | "criticalCount"
    | "highCount"
    | "mediumCount"
    | "lowCount"
    | "suggestionsJson"
  >
>;

export async function updateImprovementReport(
  reportId: number,
  data: ImprovementReportUpdate
): Promise<ImprovementReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(improvementReports)
    .set(data)
    .where(eq(improvementReports.id, reportId));
  const updated = await getImprovementReportById(reportId);
  if (!updated) throw new Error("Improvement report not found after update");
  return updated;
}

// --- Account Management ---

export async function deleteUserAccount(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Delete all user data in correct order (respecting foreign keys)
  await db
    .delete(improvementReports)
    .where(eq(improvementReports.userId, userId));
  await db.delete(auditReports).where(eq(auditReports.userId, userId));
  await db
    .delete(generationCostLogs)
    .where(eq(generationCostLogs.userId, userId));
  await db
    .delete(generationUsageLedger)
    .where(eq(generationUsageLedger.userId, userId));
  await db.delete(generationJobs).where(eq(generationJobs.userId, userId));
  await db
    .delete(creditLedgerEntries)
    .where(eq(creditLedgerEntries.userId, userId));
  await db.delete(creditWallets).where(eq(creditWallets.userId, userId));
  await db
    .delete(userSubscriptions)
    .where(eq(userSubscriptions.userId, userId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(chapterReviews).where(eq(chapterReviews.userId, userId));
  await db.delete(chapterVersions).where(eq(chapterVersions.userId, userId));
  await db.delete(chapters).where(eq(chapters.userId, userId));
  await db.delete(drafts).where(eq(drafts.userId, userId));
  await db.delete(libraryEntries).where(eq(libraryEntries.userId, userId));
  await db
    .delete(seriesLibraryEntries)
    .where(eq(seriesLibraryEntries.userId, userId));
  await db.delete(characters).where(eq(characters.userId, userId));
  await db.delete(promptTemplates).where(eq(promptTemplates.userId, userId));
  await db.delete(authorProfiles).where(eq(authorProfiles.userId, userId));
  await db.delete(statistics).where(eq(statistics.userId, userId));
  await db.delete(works).where(eq(works.userId, userId));
  await db.delete(bookSeries).where(eq(bookSeries.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

export async function changePassword(userId: number, newPasswordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  await db
    .update(users)
    .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));

  const [updated] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!updated) throw new Error("User not found");
  return updated;
}
