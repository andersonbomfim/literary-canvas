import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type {
  AuditReport,
  ImprovementReport,
  InsertImprovementReport,
  AuthorProfile,
  BookSeries,
  Chapter,
  ChapterReview,
  ChapterVersion,
  Character,
  CreditLedgerEntry,
  CreditWallet,
  Draft,
  GenerationCostLog,
  GenerationJob,
  GenerationUsageLedgerEntry,
  InsertAuditReport,
  InsertCharacter,
  InsertPromptTemplate,
  InsertUser,
  LibraryEntry,
  Notification,
  PromptTemplate,
  SeriesLibraryEntry,
  Statistic,
  User,
  UserSubscription,
  Work,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import {
  STARTER_WALLET_CREDITS,
  canReceivePlanWalletAllowance,
  getPlanWalletAllowance,
  legacyPlanWalletGrantReferences,
  planWalletGrantReference,
  resolvePlanWalletAllowance,
} from "./billingPolicy";

const DATA_DIR = path.resolve(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "literary-canvas.json");

// Local-mode audit log entry. Inline type — não importamos do drizzle schema
// pra manter o localDb desacoplado.
type LocalAuditLog = {
  id: number;
  actorId: number;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: number | null;
  metadata: string | null;
  ipAddress: string | null;
  createdAt: Date;
};

type Store = {
  users: User[];
  bookSeries: BookSeries[];
  seriesLibraryEntries: SeriesLibraryEntry[];
  works: Work[];
  drafts: Draft[];
  chapters: Chapter[];
  libraryEntries: LibraryEntry[];
  authorProfiles: AuthorProfile[];
  chapterReviews: ChapterReview[];
  notifications: Notification[];
  statistics: Statistic[];
  chapterVersions: ChapterVersion[];
  characters: Character[];
  promptTemplates: PromptTemplate[];
  creditWallets: CreditWallet[];
  creditLedgerEntries: CreditLedgerEntry[];
  userSubscriptions: UserSubscription[];
  generationJobs: GenerationJob[];
  generationCostLogs: GenerationCostLog[];
  generationUsageLedger: GenerationUsageLedgerEntry[];
  auditReports: AuditReport[];
  improvementReports: ImprovementReport[];
  auditLogs: LocalAuditLog[];
};

type TableName = keyof Store;

type IdEntity = { id: number };

type Role = "user" | "admin";
type WorkStatus = Work["status"];
type SeriesStatus = BookSeries["status"];
type SeriesLibraryStatus = SeriesLibraryEntry["status"];
type ReviewStatus = ChapterReview["status"];
type ChapterStatus = Chapter["status"];
type DraftStatus = Draft["status"];
type LedgerType = CreditLedgerEntry["type"];
type GenerationJobStatus = GenerationJob["status"];
type PaginationOptions = {
  limit?: number;
  offset?: number;
};

const EMPTY_STORE: Store = {
  users: [],
  bookSeries: [],
  seriesLibraryEntries: [],
  works: [],
  drafts: [],
  chapters: [],
  libraryEntries: [],
  authorProfiles: [],
  chapterReviews: [],
  notifications: [],
  statistics: [],
  chapterVersions: [],
  characters: [],
  promptTemplates: [],
  creditWallets: [],
  creditLedgerEntries: [],
  userSubscriptions: [],
  generationJobs: [],
  generationCostLogs: [],
  generationUsageLedger: [],
  auditReports: [],
  improvementReports: [],
  auditLogs: [],
};

const DATE_FIELDS: Partial<Record<TableName, string[]>> = {
  users: [
    "createdAt",
    "updatedAt",
    "lastSignedIn",
    "resetTokenExpiresAt",
    "lockedUntil",
  ],
  bookSeries: ["createdAt", "updatedAt"],
  seriesLibraryEntries: ["createdAt", "updatedAt"],
  works: ["createdAt", "updatedAt", "deletedAt"],
  drafts: ["createdAt", "updatedAt"],
  chapters: ["createdAt", "updatedAt"],
  libraryEntries: ["createdAt", "updatedAt"],
  authorProfiles: ["createdAt", "updatedAt"],
  chapterReviews: ["createdAt", "updatedAt"],
  notifications: ["createdAt"],
  statistics: ["createdAt", "updatedAt", "lastGenerationDate"],
  chapterVersions: ["createdAt"],
  characters: ["createdAt", "updatedAt"],
  promptTemplates: ["createdAt", "updatedAt"],
  creditWallets: ["createdAt", "updatedAt"],
  creditLedgerEntries: ["createdAt"],
  userSubscriptions: [
    "createdAt",
    "updatedAt",
    "renewsAt",
    "billingCycleStart",
    "billingCycleEnd",
  ],
  generationJobs: [
    "createdAt",
    "updatedAt",
    "lockedAt",
    "lockExpiresAt",
    "startedAt",
    "completedAt",
    "canceledAt",
  ],
  generationCostLogs: ["createdAt", "startedAt", "finishedAt"],
  generationUsageLedger: ["createdAt"],
  auditReports: ["createdAt"],
  improvementReports: ["createdAt"],
  auditLogs: ["createdAt"],
};

let warned = false;

function logFallbackOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    `[Database] PostgreSQL indisponível. Usando armazenamento local em ${DATA_FILE}`
  );
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizePagination(options?: PaginationOptions) {
  if (!options?.limit) return null;
  return {
    limit: Math.max(1, Math.min(500, Math.floor(options.limit))),
    offset: Math.max(0, Math.floor(options.offset ?? 0)),
  };
}

function paginate<T>(rows: T[], options?: PaginationOptions) {
  const page = normalizePagination(options);
  if (!page) return rows;
  return rows.slice(page.offset, page.offset + page.limit);
}

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(EMPTY_STORE, null, 2), "utf8");
  }
}

function waitForFileRetry(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Short synchronous wait used only after transient Windows file-lock errors.
  }
}

function isRetryableFileWriteError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

// C9: write to a sibling .tmp file then atomically rename. Without this,
// fs.writeFileSync can leave the JSON half-written if the process is killed
// (kernel panic, OOM, container restart) — at which point readStore would hit
// JSON.parse() failure and previously *truncated the entire DB to empty*.
function atomicWriteJson(target: string, payload: string) {
  const tmpPath = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, payload, "utf8");

  const retryDelaysMs = [0, 10, 25, 50, 100, 200, 350, 500];
  let lastError: unknown = null;

  for (const delay of retryDelaysMs) {
    if (delay > 0) waitForFileRetry(delay);
    try {
      fs.renameSync(tmpPath, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableFileWriteError(error)) break;
    }
  }

  if (lastError && isRetryableFileWriteError(lastError)) {
    try {
      fs.copyFileSync(tmpPath, target);
      fs.unlinkSync(tmpPath);
      return;
    } catch (fallbackError) {
      lastError = fallbackError;
    }
  }

  try {
    fs.unlinkSync(tmpPath);
  } catch {
    // Best effort cleanup; the original write error is more important.
  }
  throw lastError;
}

function reviveDates<K extends TableName>(table: K, rows: Store[K]): Store[K] {
  const fields = DATE_FIELDS[table] ?? [];
  return rows.map(row => {
    const copy: Record<string, unknown> = {
      ...(row as Record<string, unknown>),
    };
    for (const field of fields) {
      const value = copy[field];
      if (typeof value === "string" && value) copy[field] = new Date(value);
      else if (value == null) copy[field] = null;
    }
    return copy as Store[K][number];
  }) as Store[K];
}

function serializeDates<K extends TableName>(table: K, rows: Store[K]) {
  const fields = DATE_FIELDS[table] ?? [];
  return rows.map(row => {
    const copy: Record<string, unknown> = {
      ...(row as Record<string, unknown>),
    };
    for (const field of fields) {
      const value = copy[field];
      if (value instanceof Date) copy[field] = value.toISOString();
    }
    return copy;
  });
}

function migrateWorks(rows: Work[]): Work[] {
  return rows.map(row => ({
    ...row,
    subtitle: row.subtitle ?? null,
    seriesId: row.seriesId ?? null,
    bookNumber: row.bookNumber ?? null,
    coverPositionX: row.coverPositionX ?? 50,
    coverPositionY: row.coverPositionY ?? 50,
    coverScale: row.coverScale ?? 100,
    deletedAt: row.deletedAt ?? null,
  }));
}

function migrateChapterReviews(rows: ChapterReview[]): ChapterReview[] {
  return rows.map(row => ({
    ...row,
    revisionBrief: row.revisionBrief ?? null,
    revisionFixCount: row.revisionFixCount ?? 0,
    status: row.status ?? "in_writing",
  }));
}

function migrateStore(rawStore: Partial<Store>): Store {
  return {
    users: reviveDates("users", rawStore.users ?? []),
    bookSeries: reviveDates("bookSeries", rawStore.bookSeries ?? []),
    seriesLibraryEntries: reviveDates(
      "seriesLibraryEntries",
      rawStore.seriesLibraryEntries ?? []
    ),
    works: migrateWorks(reviveDates("works", rawStore.works ?? [])),
    drafts: reviveDates("drafts", rawStore.drafts ?? []),
    chapters: reviveDates("chapters", rawStore.chapters ?? []),
    libraryEntries: reviveDates(
      "libraryEntries",
      rawStore.libraryEntries ?? []
    ),
    authorProfiles: reviveDates(
      "authorProfiles",
      rawStore.authorProfiles ?? []
    ),
    chapterReviews: migrateChapterReviews(
      reviveDates("chapterReviews", rawStore.chapterReviews ?? [])
    ),
    notifications: reviveDates("notifications", rawStore.notifications ?? []),
    statistics: reviveDates("statistics", rawStore.statistics ?? []),
    chapterVersions: reviveDates(
      "chapterVersions",
      rawStore.chapterVersions ?? []
    ),
    characters: reviveDates("characters", rawStore.characters ?? []),
    promptTemplates: reviveDates(
      "promptTemplates",
      rawStore.promptTemplates ?? []
    ),
    creditWallets: reviveDates("creditWallets", rawStore.creditWallets ?? []),
    creditLedgerEntries: reviveDates(
      "creditLedgerEntries",
      rawStore.creditLedgerEntries ?? []
    ),
    userSubscriptions: reviveDates(
      "userSubscriptions",
      rawStore.userSubscriptions ?? []
    ),
    generationJobs: reviveDates(
      "generationJobs",
      rawStore.generationJobs ?? []
    ),
    generationCostLogs: reviveDates(
      "generationCostLogs",
      rawStore.generationCostLogs ?? []
    ),
    generationUsageLedger: reviveDates(
      "generationUsageLedger",
      rawStore.generationUsageLedger ?? []
    ),
    auditReports: reviveDates("auditReports", rawStore.auditReports ?? []),
    improvementReports: reviveDates(
      "improvementReports",
      rawStore.improvementReports ?? []
    ),
    auditLogs: reviveDates("auditLogs", rawStore.auditLogs ?? []),
  };
}

function readStore(): Store {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  let parsed: Partial<Store> = EMPTY_STORE;
  try {
    const normalized = raw.trim().toLowerCase();
    parsed =
      !normalized || normalized === "undefined" || normalized === "null"
        ? EMPTY_STORE
        : (JSON.parse(raw) as Partial<Store>);
  } catch {
    // C9: previously this branch silently overwrote the JSON with EMPTY_STORE,
    // erasing the user's entire local data on a single parse error. Now we
    // back the broken file up and re-throw so the operator notices.
    const backupPath = `${DATA_FILE}.corrupt.${Date.now()}`;
    try {
      fs.copyFileSync(DATA_FILE, backupPath);
      // eslint-disable-next-line no-console
      console.error(
        `[Database] JSON corrompido em ${DATA_FILE}. Backup salvo em ${backupPath}. ` +
          `Inspecione o backup antes de prosseguir.`
      );
    } catch (copyErr) {
      // eslint-disable-next-line no-console
      console.error(
        "[Database] Falha ao salvar backup do JSON corrompido:",
        copyErr
      );
    }
    throw new Error(
      `Local data store at ${DATA_FILE} is corrupted. A backup was saved at ${backupPath}.`
    );
  }

  const store = migrateStore(parsed);
  const cleanedTrashedWorkRecords = purgeSoftDeletedWorkScopedRecords(store);
  logFallbackOnce();
  ensureDefaultData(store);
  if (cleanedTrashedWorkRecords) {
    writeStore(store);
  }
  return store;
}

function writeStore(store: Store) {
  ensureDataFile();
  const serializable = {
    users: serializeDates("users", store.users),
    bookSeries: serializeDates("bookSeries", store.bookSeries),
    seriesLibraryEntries: serializeDates(
      "seriesLibraryEntries",
      store.seriesLibraryEntries
    ),
    works: serializeDates("works", store.works),
    drafts: serializeDates("drafts", store.drafts),
    chapters: serializeDates("chapters", store.chapters),
    libraryEntries: serializeDates("libraryEntries", store.libraryEntries),
    authorProfiles: serializeDates("authorProfiles", store.authorProfiles),
    chapterReviews: serializeDates("chapterReviews", store.chapterReviews),
    notifications: serializeDates("notifications", store.notifications),
    statistics: serializeDates("statistics", store.statistics),
    chapterVersions: serializeDates("chapterVersions", store.chapterVersions),
    characters: serializeDates("characters", store.characters),
    promptTemplates: serializeDates("promptTemplates", store.promptTemplates),
    creditWallets: serializeDates("creditWallets", store.creditWallets),
    creditLedgerEntries: serializeDates(
      "creditLedgerEntries",
      store.creditLedgerEntries
    ),
    userSubscriptions: serializeDates(
      "userSubscriptions",
      store.userSubscriptions
    ),
    generationJobs: serializeDates("generationJobs", store.generationJobs),
    generationCostLogs: serializeDates(
      "generationCostLogs",
      store.generationCostLogs
    ),
    generationUsageLedger: serializeDates(
      "generationUsageLedger",
      store.generationUsageLedger
    ),
    auditReports: serializeDates("auditReports", store.auditReports),
    improvementReports: serializeDates(
      "improvementReports",
      store.improvementReports
    ),
    auditLogs: serializeDates("auditLogs", store.auditLogs),
  };
  // Atomic: tmp + rename. See atomicWriteJson() above.
  atomicWriteJson(DATA_FILE, JSON.stringify(serializable, null, 2));
}

/**
 * C9: in-process safety + crash safety.
 *
 * Within a single Node process, this read+mutate+write block never interleaves
 * because the body is fully synchronous and Node is single-threaded — every
 * mutation runs to completion before the next call gets to execute its
 * readStore. Crash safety comes from atomicWriteJson() (tmp + rename).
 *
 * If you ever run TWO Node processes against the same .local-data directory
 * (e.g. dev server + a script that also imports this file), wrap them with
 * an external lock or just don't do that — the recommended deployment is
 * single-process for local mode, and PostgreSQL for multi-process.
 */
function withStore<T>(mutate: (store: Store) => T): T {
  ensureDataFile();
  const store = readStore();
  const result = mutate(store);
  writeStore(store);
  return result;
}

function nextId<T extends IdEntity>(rows: T[]) {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
}

function now() {
  return new Date();
}

const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function sortByDateDesc<T extends Record<string, unknown>>(
  rows: T[],
  field: keyof T
) {
  return [...rows].sort((a, b) => {
    const left = a[field] instanceof Date ? (a[field] as Date).getTime() : 0;
    const right = b[field] instanceof Date ? (b[field] as Date).getTime() : 0;
    return right - left;
  });
}

function deleteWorkScopedRecordsFromStore(
  store: Store,
  userId: number,
  workId: number
) {
  const chapterIds = new Set(
    store.chapters
      .filter(item => item.userId === userId && item.workId === workId)
      .map(item => item.id)
  );

  store.chapterVersions = store.chapterVersions.filter(
    item => !chapterIds.has(item.chapterId)
  );
  store.chapterReviews = store.chapterReviews.filter(
    item => item.userId !== userId || !chapterIds.has(item.chapterId)
  );
  store.drafts = store.drafts.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.chapters = store.chapters.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.libraryEntries = store.libraryEntries.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.authorProfiles = store.authorProfiles.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.statistics = store.statistics.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.characters = store.characters.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.promptTemplates = store.promptTemplates.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.creditLedgerEntries = store.creditLedgerEntries.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.generationUsageLedger = store.generationUsageLedger.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.auditReports = store.auditReports.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  store.improvementReports = store.improvementReports.filter(
    item => item.userId !== userId || item.workId !== workId
  );
  const generationJobIds = new Set(
    store.generationJobs
      .filter(item => item.userId === userId && item.workId === workId)
      .map(item => item.id)
  );
  store.generationCostLogs = store.generationCostLogs.filter(
    item => !generationJobIds.has(item.jobId)
  );
  store.generationJobs = store.generationJobs.filter(
    item => item.userId !== userId || item.workId !== workId
  );
}

function deleteWorkRecordsFromStore(
  store: Store,
  userId: number,
  workId: number
) {
  deleteWorkScopedRecordsFromStore(store, userId, workId);
  store.works = store.works.filter(
    item => item.userId !== userId || item.id !== workId
  );
}

function purgeSoftDeletedWorkScopedRecords(store: Store) {
  const deletedWorks = store.works.filter(
    item => item.deletedAt instanceof Date
  );
  if (!deletedWorks.length) return false;

  const before = JSON.stringify({
    drafts: store.drafts.length,
    chapters: store.chapters.length,
    libraryEntries: store.libraryEntries.length,
    authorProfiles: store.authorProfiles.length,
    statistics: store.statistics.length,
    characters: store.characters.length,
    promptTemplates: store.promptTemplates.length,
    creditLedgerEntries: store.creditLedgerEntries.length,
    generationUsageLedger: store.generationUsageLedger.length,
    auditReports: store.auditReports.length,
    improvementReports: store.improvementReports.length,
    generationJobs: store.generationJobs.length,
    generationCostLogs: store.generationCostLogs.length,
    chapterReviews: store.chapterReviews.length,
    chapterVersions: store.chapterVersions.length,
  });

  for (const work of deletedWorks) {
    deleteWorkScopedRecordsFromStore(store, work.userId, work.id);
  }

  const after = JSON.stringify({
    drafts: store.drafts.length,
    chapters: store.chapters.length,
    libraryEntries: store.libraryEntries.length,
    authorProfiles: store.authorProfiles.length,
    statistics: store.statistics.length,
    characters: store.characters.length,
    promptTemplates: store.promptTemplates.length,
    creditLedgerEntries: store.creditLedgerEntries.length,
    generationUsageLedger: store.generationUsageLedger.length,
    auditReports: store.auditReports.length,
    improvementReports: store.improvementReports.length,
    generationJobs: store.generationJobs.length,
    generationCostLogs: store.generationCostLogs.length,
    chapterReviews: store.chapterReviews.length,
    chapterVersions: store.chapterVersions.length,
  });

  return before !== after;
}

function purgeExpiredTrashedWorks(store: Store, userId: number) {
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  const expiredIds = store.works
    .filter(
      item =>
        item.userId === userId &&
        item.deletedAt instanceof Date &&
        item.deletedAt.getTime() <= cutoff
    )
    .map(item => item.id);

  for (const workId of expiredIds) {
    deleteWorkRecordsFromStore(store, userId, workId);
  }
}

function containsInsensitive(text: string | null | undefined, query: string) {
  if (!text) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}

function startsWithInsensitive(text: string | null | undefined, query: string) {
  if (!text) return false;
  return text.toLowerCase().startsWith(query.toLowerCase());
}

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

function ensureDefaultData(store: Store) {
  for (const user of store.users) {
    if (user.failedLoginCount === undefined || user.failedLoginCount === null)
      user.failedLoginCount = 0;
    if (user.lockedUntil === undefined) user.lockedUntil = null;
    ensureWallet(store, user.id);
    ensureSubscription(store, user.id);
  }
}

function getDefaultRole(email: string): Role {
  return ENV.adminEmail &&
    normalizeEmail(ENV.adminEmail) === normalizeEmail(email)
    ? "admin"
    : "user";
}

function ensureWallet(store: Store, userId: number): CreditWallet {
  let wallet = store.creditWallets.find(item => item.userId === userId);
  if (!wallet) {
    const timestamp = now();
    wallet = {
      id: nextId(store.creditWallets),
      userId,
      balance: STARTER_WALLET_CREDITS,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.creditWallets.push(wallet);
    store.creditLedgerEntries.push({
      id: nextId(store.creditLedgerEntries),
      userId,
      workId: null,
      type: "grant",
      amount: STARTER_WALLET_CREDITS,
      balanceAfter: STARTER_WALLET_CREDITS,
      reason: "Créditos flexíveis iniciais",
      reference: "starter-pack",
      createdAt: timestamp,
    });
  }
  return wallet;
}

function ensureSubscription(store: Store, userId: number): UserSubscription {
  let subscription = store.userSubscriptions.find(
    item => item.userId === userId
  );
  if (!subscription) {
    const timestamp = now();
    subscription = {
      id: nextId(store.userSubscriptions),
      userId,
      planCode: "none",
      status: "none",
      renewsAt: null,
      creditAllowance: 0,
      planTier: "free",
      monthlyNarrativeCreditLimit: 5000,
      monthlyNarrativeCreditsUsed: 0,
      monthlyNarrativeCreditsReserved: 0,
      extraNarrativeCredits: 0,
      extraNarrativeCreditsReserved: 0,
      // Auditoria de Consistência (bolsa separada — ver planConfig).
      monthlyAnalysisCreditLimit: 0,
      monthlyAnalysisCreditsUsed: 0,
      monthlyAnalysisCreditsReserved: 0,
      extraAnalysisCredits: 0,
      extraAnalysisCreditsReserved: 0,
      billingCycleStart: null,
      billingCycleEnd: null,
      monthlyInspirationUsed: 0,
      monthlyTextReviewUsed: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.userSubscriptions.push(subscription);
  } else {
    subscription.planTier ??= "free";
    subscription.monthlyNarrativeCreditLimit ??= 5000;
    subscription.monthlyNarrativeCreditsUsed ??= 0;
    subscription.monthlyNarrativeCreditsReserved ??= 0;
    subscription.extraNarrativeCredits ??= 0;
    subscription.extraNarrativeCreditsReserved ??= 0;
    // Backfill em subscriptions criadas antes da auditoria existir.
    subscription.monthlyAnalysisCreditLimit ??= 0;
    subscription.monthlyAnalysisCreditsUsed ??= 0;
    subscription.monthlyAnalysisCreditsReserved ??= 0;
    subscription.extraAnalysisCredits ??= 0;
    subscription.extraAnalysisCreditsReserved ??= 0;
    subscription.billingCycleStart ??= null;
    subscription.billingCycleEnd ??= null;
    subscription.monthlyInspirationUsed ??= 0;
    subscription.monthlyTextReviewUsed ??= 0;
  }
  return subscription;
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

function hasWorkContent(store: Store, userId: number, workId: number) {
  return (
    store.drafts.some(
      item => item.userId === userId && item.workId === workId
    ) ||
    store.chapters.some(
      item => item.userId === userId && item.workId === workId
    ) ||
    store.libraryEntries.some(
      item => item.userId === userId && item.workId === workId
    ) ||
    store.characters.some(
      item => item.userId === userId && item.workId === workId
    ) ||
    store.promptTemplates.some(
      item => item.userId === userId && item.workId === workId
    ) ||
    store.statistics.some(
      item =>
        item.userId === userId &&
        item.workId === workId &&
        ((item.totalChaptersGenerated ?? 0) > 0 ||
          (item.totalWordsWritten ?? 0) > 0 ||
          (item.totalCharactersCreated ?? 0) > 0 ||
          (item.totalEventsCreated ?? 0) > 0 ||
          (item.totalLocationsCreated ?? 0) > 0)
    ) ||
    hasMeaningfulProfileData(
      store.authorProfiles.find(
        item => item.userId === userId && item.workId === workId
      )
    )
  );
}

function hasGeneratedPlaceholderMetadata(work: Work) {
  return (
    work.title === "Obra principal" &&
    work.description ===
      "Obra criada automaticamente para organizar o ambiente local." &&
    work.genre == null &&
    work.coverImage == null &&
    work.status === "planning"
  );
}

function removeGeneratedPlaceholderWorks(store: Store, userId: number) {
  const hasRealWork = store.works.some(
    item => item.userId === userId && !hasGeneratedPlaceholderMetadata(item)
  );
  if (!hasRealWork) return;

  const generatedIds = store.works
    .filter(
      item =>
        item.userId === userId &&
        !item.deletedAt &&
        hasGeneratedPlaceholderMetadata(item) &&
        !hasWorkContent(store, userId, item.id)
    )
    .map(item => item.id);

  if (!generatedIds.length) return;
  const generatedSet = new Set(generatedIds);
  store.authorProfiles = store.authorProfiles.filter(
    item =>
      item.userId !== userId ||
      item.workId == null ||
      !generatedSet.has(item.workId)
  );
  store.statistics = store.statistics.filter(
    item =>
      item.userId !== userId ||
      item.workId == null ||
      !generatedSet.has(item.workId)
  );
  store.works = store.works.filter(item => !generatedSet.has(item.id));
}

function getDefaultWork(store: Store, userId: number): Work | undefined {
  const active = store.works.filter(
    item => item.userId === userId && !item.deletedAt
  );
  return (
    active.find(item => item.isDefault === "true") ??
    sortByDateDesc(active, "createdAt")[0]
  );
}

function ensureDefaultWork(store: Store, userId: number): Work {
  let work = getDefaultWork(store, userId);
  if (!work) {
    throw new Error("Nenhuma obra ativa encontrada.");
  }

  for (const item of store.works.filter(entry => entry.userId === userId)) {
    item.isDefault = item.id === work.id ? "true" : "false";
  }

  for (const draft of store.drafts.filter(
    item => item.userId === userId && item.workId == null
  ))
    draft.workId = work.id;
  for (const chapter of store.chapters.filter(
    item => item.userId === userId && item.workId == null
  ))
    chapter.workId = work.id;
  for (const entry of store.libraryEntries.filter(
    item => item.userId === userId && item.workId == null
  ))
    entry.workId = work.id;
  for (const profile of store.authorProfiles.filter(
    item => item.userId === userId && item.workId == null
  ))
    profile.workId = work.id;
  for (const stat of store.statistics.filter(
    item => item.userId === userId && item.workId == null
  ))
    stat.workId = work.id;
  for (const character of store.characters.filter(
    item => item.userId === userId && item.workId == null
  ))
    character.workId = work.id;
  for (const template of store.promptTemplates.filter(
    item => item.userId === userId && item.workId == null
  ))
    template.workId = work.id;

  return work;
}

function resolveWorkId(store: Store, userId: number, workId: number | null) {
  if (workId) {
    const found = store.works.find(
      item => item.id === workId && item.userId === userId && !item.deletedAt
    );
    if (found) return found.id;
    throw new Error("Obra ativa não encontrada.");
  }
  return ensureDefaultWork(store, userId).id;
}

function requireScopedEntity<
  T extends { userId: number; workId: number | null },
>(
  rows: T[],
  id: number,
  userId: number,
  workId: number | null,
  label: string = "Item"
) {
  const resolvedWorkId = resolveWorkId(readStore(), userId, workId);
  const item = rows.find(
    (entry: any) =>
      entry.id === id &&
      entry.userId === userId &&
      (entry.workId ?? resolvedWorkId) === resolvedWorkId
  );
  if (!item) throw new Error(`${label} not found`);
  return item;
}

function syncCharacterReferencesAfterRename(
  store: Store,
  userId: number,
  workId: number,
  oldName: string,
  nextCharacter: Character
) {
  if (oldName === nextCharacter.name) return;

  for (const draft of store.drafts.filter(
    item => item.userId === userId && item.workId === workId
  )) {
    const current = parseCharacterReferences(draft.mainCharacters);
    const hasLegacyName = current.some(
      item => typeof item === "string" && item === oldName
    );
    if (!hasLegacyName) continue;
    draft.mainCharacters = serializeCharacterReferences(
      current.map(item =>
        typeof item === "string" && item === oldName ? nextCharacter.name : item
      )
    );
    draft.updatedAt = now();
  }
}

function cleanupCharacterReferencesOnDelete(
  store: Store,
  userId: number,
  workId: number,
  character: Character
) {
  for (const draft of store.drafts.filter(
    item => item.userId === userId && item.workId === workId
  )) {
    const current = parseCharacterReferences(draft.mainCharacters);
    const hasReference = current.some(
      item =>
        item === character.id ||
        (typeof item === "string" && item === character.name)
    );
    if (!hasReference) continue;
    draft.mainCharacters = serializeCharacterReferences(
      current.filter(
        item =>
          item !== character.id &&
          !(typeof item === "string" && item === character.name)
      )
    );
    draft.updatedAt = now();
  }
}

function getOrCreateAuthorProfileFromStore(
  store: Store,
  userId: number,
  workId: number | null
): AuthorProfile {
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  let profile = store.authorProfiles.find(
    item =>
      item.userId === userId &&
      (item.workId ?? resolvedWorkId) === resolvedWorkId
  );
  if (!profile) {
    const timestamp = now();
    profile = {
      id: nextId(store.authorProfiles),
      userId,
      workId: resolvedWorkId,
      narrativeStyle: "",
      keyElements: "[]",
      characterVoices: "{}",
      negativeRules: "[]",
      keyChapters: "[]",
      storyFoundation: "",
      continuityMemories: "[]",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.authorProfiles.push(profile);
  }
  return profile;
}

function getOrCreateStatisticsFromStore(
  store: Store,
  userId: number,
  workId: number | null
): Statistic {
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  let stat = store.statistics.find(
    item =>
      item.userId === userId &&
      (item.workId ?? resolvedWorkId) === resolvedWorkId
  );
  if (!stat) {
    const timestamp = now();
    stat = {
      id: nextId(store.statistics),
      userId,
      workId: resolvedWorkId,
      totalChaptersGenerated: 0,
      totalWordsWritten: 0,
      totalCharactersCreated: 0,
      totalEventsCreated: 0,
      totalLocationsCreated: 0,
      lastGenerationDate: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.statistics.push(stat);
  }
  return stat;
}

function chargeWallet(
  store: Store,
  userId: number,
  amount: number,
  reason: string,
  workId: number | null,
  reference: string | null
) {
  if (amount <= 0) return ensureWallet(store, userId);
  const wallet = ensureWallet(store, userId);
  if (wallet.balance < amount) throw new Error("Créditos insuficientes.");
  wallet.balance -= amount;
  wallet.updatedAt = now();
  store.creditLedgerEntries.push({
    id: nextId(store.creditLedgerEntries),
    userId,
    workId: workId ?? null,
    type: "usage",
    amount: -Math.abs(amount),
    balanceAfter: wallet.balance,
    reason,
    reference: reference ?? null,
    createdAt: now(),
  });
  return wallet;
}

function grantWallet(
  store: Store,
  userId: number,
  amount: number,
  reason: string,
  workId: number | null,
  reference: string | null,
  type: LedgerType = "grant"
) {
  const wallet = ensureWallet(store, userId);
  wallet.balance += Math.abs(amount);
  wallet.updatedAt = now();
  store.creditLedgerEntries.push({
    id: nextId(store.creditLedgerEntries),
    userId,
    workId: workId ?? null,
    type,
    amount: Math.abs(amount),
    balanceAfter: wallet.balance,
    reason,
    reference: reference ?? null,
    createdAt: now(),
  });
  return wallet;
}

function ensurePlanWalletAllowance(
  store: Store,
  userId: number,
  subscription: UserSubscription
) {
  if (!canReceivePlanWalletAllowance(subscription))
    return ensureWallet(store, userId);

  const amount = resolvePlanWalletAllowance(subscription);
  if (amount <= 0) return ensureWallet(store, userId);
  if (subscription.creditAllowance !== amount) {
    subscription.creditAllowance = amount;
    subscription.updatedAt = now();
  }

  const reference = planWalletGrantReference(subscription.planCode);
  const equivalentReferences = new Set([
    reference,
    ...legacyPlanWalletGrantReferences(subscription.planCode),
  ]);
  const alreadyGranted = store.creditLedgerEntries.some(
    entry =>
      entry.userId === userId &&
      entry.reference !== null &&
      equivalentReferences.has(entry.reference)
  );
  if (alreadyGranted) return ensureWallet(store, userId);

  return grantWallet(
    store,
    userId,
    amount,
    `Créditos flexíveis do plano ${subscription.planCode}`,
    null,
    reference,
    "grant"
  );
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    console.warn(
      "[localDb] upsertUser called without openId — skipping to prevent data corruption."
    );
    return;
  }
  withStore(store => {
    const existing = store.users.find(item => item.openId === user.openId);
    const timestamp = now();
    if (existing) {
      if (user.name !== undefined) existing.name = user.name ?? null;
      if (user.email !== undefined)
        existing.email = user.email ? normalizeEmail(user.email) : null;
      if (user.loginMethod !== undefined)
        existing.loginMethod = user.loginMethod ?? null;
      if (user.passwordHash !== undefined)
        existing.passwordHash = user.passwordHash ?? null;
      if (user.resetTokenHash !== undefined)
        existing.resetTokenHash = user.resetTokenHash ?? null;
      if (user.resetTokenExpiresAt !== undefined)
        existing.resetTokenExpiresAt = user.resetTokenExpiresAt ?? null;
      if (user.role !== undefined) existing.role = user.role;
      existing.lastSignedIn = user.lastSignedIn ?? timestamp;
      existing.updatedAt = timestamp;
      ensureWallet(store, existing.id);
      ensureSubscription(store, existing.id);
      return;
    }

    if (!user.openId) return;
    const normalizedEmail = user.email ? normalizeEmail(user.email) : null;
    const created: User = {
      id: nextId(store.users),
      openId: user.openId,
      name: user.name ?? null,
      email: normalizedEmail,
      loginMethod: user.loginMethod ?? null,
      passwordHash: user.passwordHash ?? null,
      resetTokenHash: user.resetTokenHash ?? null,
      resetTokenExpiresAt: user.resetTokenExpiresAt ?? null,
      failedLoginCount: user.failedLoginCount ?? 0,
      lockedUntil: user.lockedUntil ?? null,
      role:
        user.role ??
        (normalizedEmail ? getDefaultRole(normalizedEmail) : "user"),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSignedIn: user.lastSignedIn ?? timestamp,
    };
    store.users.push(created);
    ensureWallet(store, created.id);
    ensureSubscription(store, created.id);
    // No longer auto-creates "Obra principal" — new users start with zero works
    // and are guided to create their first on /works
  });
}

export async function getUserByOpenId(openId: string) {
  const store = readStore();
  return clone(store.users.find(item => item.openId === openId)) ?? undefined;
}

export async function getUserByEmail(email: string) {
  const normalized = normalizeEmail(email);
  const store = readStore();
  return (
    clone(
      store.users.find(item => normalizeEmail(item.email || "") === normalized)
    ) ?? undefined
  );
}

export async function listUsers() {
  const store = readStore();
  return clone(sortByDateDesc(store.users, "createdAt"));
}

export async function countUsers() {
  const store = readStore();
  return store.users.length;
}

export async function createLocalUser(data: {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
}) {
  return withStore(store => {
    const normalizedEmail = normalizeEmail(data.email);
    if (
      store.users.some(
        item => normalizeEmail(item.email || "") === normalizedEmail
      )
    ) {
      throw new Error("Já existe uma conta com este e-mail.");
    }
    const timestamp = now();
    const created: User = {
      id: nextId(store.users),
      openId: `local:${normalizedEmail}`,
      name: data.name.trim(),
      email: normalizedEmail,
      loginMethod: "local",
      passwordHash: data.passwordHash,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
      role: data.role || getDefaultRole(normalizedEmail),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSignedIn: timestamp,
    };
    store.users.push(created);
    ensureWallet(store, created.id);
    ensureSubscription(store, created.id);
    // No longer auto-creates "Obra principal" — user creates first work explicitly
    return clone(created);
  });
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  return withStore(store => {
    const user = store.users.find(item => item.id === userId);
    if (!user) throw new Error("User not found");
    user.passwordHash = passwordHash;
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    user.lastSignedIn = now();
    user.updatedAt = now();
    return clone(user);
  });
}

export async function savePasswordResetToken(
  userId: number,
  tokenHash: string,
  expiresAt: Date
) {
  withStore(store => {
    const user = store.users.find(item => item.id === userId);
    if (!user) throw new Error("User not found");
    user.resetTokenHash = tokenHash;
    user.resetTokenExpiresAt = expiresAt;
    user.updatedAt = now();
  });
}

export async function getUserByResetTokenHash(tokenHash: string) {
  const store = readStore();
  const user = store.users.find(item => item.resetTokenHash === tokenHash);
  if (!user) return undefined;
  if (
    !user.resetTokenExpiresAt ||
    user.resetTokenExpiresAt.getTime() < Date.now()
  )
    return undefined;
  return clone(user);
}

export async function clearPasswordResetToken(userId: number) {
  withStore(store => {
    const user = store.users.find(item => item.id === userId);
    if (!user) return;
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    user.updatedAt = now();
  });
}

export async function updateUserRole(userId: number, role: Role) {
  return withStore(store => {
    const user = store.users.find(item => item.id === userId);
    if (!user) throw new Error("User not found");
    user.role = role;
    user.updatedAt = now();
    return clone(user);
  });
}

// A07.1 — account lockout (paridade com db.postgres.ts)
const FAILED_LOGIN_LIMIT_LOCAL = 5;
const LOCK_WINDOW_MS_LOCAL = 15 * 60 * 1000;

export async function recordFailedLogin(
  userId: number
): Promise<{ failedLoginCount: number; lockedUntil: Date | null }> {
  return withStore(store => {
    const user = store.users.find(item => item.id === userId);
    if (!user) return { failedLoginCount: 0, lockedUntil: null };
    const next = ((user as any).failedLoginCount ?? 0) + 1;
    const lockedUntil =
      next >= FAILED_LOGIN_LIMIT_LOCAL
        ? new Date(Date.now() + LOCK_WINDOW_MS_LOCAL)
        : null;
    (user as any).failedLoginCount = next;
    (user as any).lockedUntil = lockedUntil;
    user.updatedAt = now();
    return { failedLoginCount: next, lockedUntil };
  });
}

export async function resetFailedLogins(userId: number): Promise<void> {
  withStore(store => {
    const user = store.users.find(item => item.id === userId);
    if (!user) return;
    (user as any).failedLoginCount = 0;
    (user as any).lockedUntil = null;
    user.updatedAt = now();
  });
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertSeriesForUser(
  store: Store,
  userId: number,
  seriesId: number | null | undefined
) {
  if (seriesId == null) return null;
  const series = store.bookSeries.find(
    item => item.id === seriesId && item.userId === userId
  );
  if (!series) throw new Error("Série não encontrada.");
  return series;
}

function sortWorksInSeries(rows: Work[]) {
  return [...rows].sort((a, b) => {
    const numberA = a.bookNumber ?? Number.MAX_SAFE_INTEGER;
    const numberB = b.bookNumber ?? Number.MAX_SAFE_INTEGER;
    if (numberA !== numberB) return numberA - numberB;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

function nextBookNumberForSeries(
  store: Store,
  userId: number,
  seriesId: number
) {
  const numbers = store.works
    .filter(
      item =>
        item.userId === userId &&
        item.seriesId === seriesId &&
        !item.deletedAt &&
        item.bookNumber != null
    )
    .map(item => item.bookNumber ?? 0);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
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
  status?: SeriesLibraryStatus | null;
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

function buildSeriesContextFromStore(
  store: Store,
  userId: number,
  workId: number
) {
  const activeWork = store.works.find(
    item => item.id === workId && item.userId === userId && !item.deletedAt
  );
  if (!activeWork?.seriesId)
    return { series: null, works: [], contextText: "" };

  const series = store.bookSeries.find(
    item => item.id === activeWork.seriesId && item.userId === userId
  );
  if (!series || series.status !== "active")
    return { series: series ?? null, works: [], contextText: "" };

  const availableWorks = sortWorksInSeries(
    store.works.filter(
      item =>
        item.userId === userId &&
        item.seriesId === series.id &&
        !item.deletedAt &&
        item.status !== "paused" &&
        item.status !== "archived"
    )
  );
  const siblingWorks = availableWorks.filter(item => item.id !== workId);
  const seriesLibrary = store.seriesLibraryEntries
    .filter(item => item.userId === userId && item.seriesId === series.id)
    .sort((a, b) => {
      if (a.status !== b.status)
        return a.status === "canonical" ? -1 : b.status === "canonical" ? 1 : 0;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    })
    .slice(0, 100);

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
      const profile = store.authorProfiles.find(
        item => item.userId === userId && item.workId === work.id
      );
      const workCharacters = store.characters
        .filter(item => item.userId === userId && item.workId === work.id)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        .slice(0, 24);
      const workEntries = store.libraryEntries
        .filter(
          item =>
            item.userId === userId &&
            item.workId === work.id &&
            item.status !== "discarded"
        )
        .slice(0, 30);
      const canonicalChapters = store.chapters
        .filter(
          item =>
            item.userId === userId &&
            item.workId === work.id &&
            item.status === "canonical"
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
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

  return { series: clone(series), works: clone(availableWorks), contextText };
}

export async function listBookSeriesByUserId(
  userId: number
): Promise<BookSeries[]> {
  const store = readStore();
  return clone(
    sortByDateDesc(
      store.bookSeries.filter(item => item.userId === userId),
      "updatedAt"
    )
  );
}

export async function createBookSeries(
  userId: number,
  data: {
    title: string;
    description?: string | null;
    genre?: string | null;
    universeNotes?: string | null;
    status?: SeriesStatus;
  }
): Promise<BookSeries> {
  return withStore(store => {
    const timestamp = now();
    const series: BookSeries = {
      id: nextId(store.bookSeries),
      userId,
      title: data.title.trim(),
      description: normalizeNullableText(data.description),
      genre: normalizeNullableText(data.genre),
      universeNotes: normalizeNullableText(data.universeNotes),
      status: data.status ?? "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.bookSeries.push(series);
    return clone(series);
  });
}

export async function updateBookSeries(
  seriesId: number,
  userId: number,
  data: Partial<Omit<BookSeries, "id" | "userId" | "createdAt" | "updatedAt">>
): Promise<BookSeries> {
  return withStore(store => {
    const series = assertSeriesForUser(store, userId, seriesId);
    if (!series) throw new Error("Série não encontrada.");
    Object.assign(series, {
      ...data,
      description:
        data.description === undefined
          ? series.description
          : normalizeNullableText(data.description),
      genre:
        data.genre === undefined
          ? series.genre
          : normalizeNullableText(data.genre),
      universeNotes:
        data.universeNotes === undefined
          ? series.universeNotes
          : normalizeNullableText(data.universeNotes),
      updatedAt: now(),
    });
    return clone(series);
  });
}

export async function deleteBookSeries(
  seriesId: number,
  userId: number
): Promise<void> {
  withStore(store => {
    assertSeriesForUser(store, userId, seriesId);
    for (const work of store.works.filter(
      item => item.userId === userId && item.seriesId === seriesId
    )) {
      work.seriesId = null;
      work.bookNumber = null;
      work.updatedAt = now();
    }
    store.seriesLibraryEntries = store.seriesLibraryEntries.filter(
      item => item.seriesId !== seriesId || item.userId !== userId
    );
    store.bookSeries = store.bookSeries.filter(
      item => item.id !== seriesId || item.userId !== userId
    );
  });
}

export async function listWorksBySeriesId(
  userId: number,
  seriesId: number
): Promise<Work[]> {
  const store = readStore();
  assertSeriesForUser(store, userId, seriesId);
  return clone(
    sortWorksInSeries(
      store.works.filter(
        item =>
          item.userId === userId &&
          item.seriesId === seriesId &&
          !item.deletedAt
      )
    )
  );
}

export async function listSeriesLibraryEntries(
  userId: number,
  seriesId: number
): Promise<SeriesLibraryEntry[]> {
  const store = readStore();
  assertSeriesForUser(store, userId, seriesId);
  return clone(
    sortByDateDesc(
      store.seriesLibraryEntries.filter(
        item => item.userId === userId && item.seriesId === seriesId
      ),
      "updatedAt"
    )
  );
}

export async function replaceSeriesLibraryEntries(
  userId: number,
  seriesId: number,
  entries: SeriesLibraryEntryInput[]
): Promise<SeriesLibraryEntry[]> {
  return withStore(store => {
    assertSeriesForUser(store, userId, seriesId);
    const timestamp = now();
    store.seriesLibraryEntries = store.seriesLibraryEntries.filter(
      item => item.userId !== userId || item.seriesId !== seriesId
    );
    const firstId = nextId(store.seriesLibraryEntries);

    const nextEntries = entries
      .map(entry => ({
        ...entry,
        type: entry.type.trim(),
        name: entry.name.trim(),
      }))
      .filter(entry => entry.type && entry.name)
      .slice(0, 160)
      .map(
        (entry, index): SeriesLibraryEntry => ({
          id: firstId + index,
          userId,
          seriesId,
          type: entry.type,
          name: entry.name,
          description: normalizeNullableText(entry.description),
          details: normalizeNullableText(entry.details),
          sourceWorkIds: normalizeSeriesLibrarySourceWorkIds(
            entry.sourceWorkIds
          ),
          confidence: normalizeSeriesLibraryConfidence(entry.confidence),
          status: entry.status ?? "needs_review",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      );

    store.seriesLibraryEntries.push(...nextEntries);
    return clone(sortByDateDesc(nextEntries, "updatedAt"));
  });
}

export async function getSeriesContextForWork(
  userId: number,
  workId: number
): Promise<{ series: BookSeries | null; works: Work[]; contextText: string }> {
  const store = readStore();
  return buildSeriesContextFromStore(store, userId, workId);
}

export async function listWorksByUserId(userId: number): Promise<Work[]> {
  return withStore(store => {
    purgeExpiredTrashedWorks(store, userId);
    removeGeneratedPlaceholderWorks(store, userId);
    return clone(
      sortByDateDesc(
        store.works.filter(item => item.userId === userId && !item.deletedAt),
        "updatedAt"
      )
    );
  });
}

export async function listTrashedWorks(userId: number): Promise<Work[]> {
  return withStore(store => {
    purgeExpiredTrashedWorks(store, userId);
    return clone(
      sortByDateDesc(
        store.works.filter(
          item => item.userId === userId && item.deletedAt != null
        ),
        "deletedAt"
      )
    );
  });
}

export async function softDeleteWork(
  workId: number,
  userId: number
): Promise<Work> {
  return withStore(store => {
    const work = store.works.find(
      item => item.id === workId && item.userId === userId
    );
    if (!work) throw new Error("Work not found");
    work.deletedAt = now();
    work.updatedAt = now();
    deleteWorkScopedRecordsFromStore(store, userId, workId);
    if (work.isDefault === "true") {
      work.isDefault = "false";
      const nextDefault = store.works.find(
        item => item.userId === userId && !item.deletedAt && item.id !== workId
      );
      if (nextDefault) nextDefault.isDefault = "true";
    }
    return clone(work);
  });
}

export async function restoreWork(
  workId: number,
  userId: number
): Promise<Work> {
  return withStore(store => {
    const work = store.works.find(
      item =>
        item.id === workId && item.userId === userId && item.deletedAt != null
    );
    if (!work) throw new Error("Work not found in trash");
    work.deletedAt = null;
    work.updatedAt = now();
    removeGeneratedPlaceholderWorks(store, userId);
    if (
      !store.works.some(
        item =>
          item.userId === userId && !item.deletedAt && item.isDefault === "true"
      )
    ) {
      work.isDefault = "true";
    }
    return clone(work);
  });
}

export async function permanentDeleteWork(
  workId: number,
  userId: number
): Promise<void> {
  return withStore(store => {
    const idx = store.works.findIndex(
      item =>
        item.id === workId && item.userId === userId && item.deletedAt != null
    );
    if (idx === -1) throw new Error("Work not found in trash");
    deleteWorkRecordsFromStore(store, userId, workId);
  });
}

export async function getWorkById(
  workId: number,
  userId: number
): Promise<Work | undefined> {
  const store = readStore();
  return (
    clone(
      store.works.find(
        item => item.id === workId && item.userId === userId && !item.deletedAt
      )
    ) ?? undefined
  );
}

export async function getDefaultWorkForUser(
  userId: number
): Promise<Work | undefined> {
  return withStore(store => {
    const work = getDefaultWork(store, userId);
    return work ? clone(ensureDefaultWork(store, userId)) : undefined;
  });
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
    status?: WorkStatus;
    seriesId?: number | null;
    bookNumber?: number | null;
  }
) {
  return withStore(store => {
    const timestamp = now();
    const series = assertSeriesForUser(store, userId, data.seriesId);
    const hasActiveWork = store.works.some(
      item =>
        item.userId === userId &&
        !item.deletedAt &&
        !hasGeneratedPlaceholderMetadata(item)
    );
    const work: Work = {
      id: nextId(store.works),
      userId,
      seriesId: series?.id ?? null,
      bookNumber: series
        ? (data.bookNumber ?? nextBookNumberForSeries(store, userId, series.id))
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
      isDefault: hasActiveWork ? "false" : "true",
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.works.push(work);
    removeGeneratedPlaceholderWorks(store, userId);
    if (
      !store.works.some(
        item =>
          item.userId === userId && !item.deletedAt && item.isDefault === "true"
      )
    ) {
      work.isDefault = "true";
    }
    return clone(work);
  });
}

export async function updateWork(
  workId: number,
  userId: number,
  data: Partial<Omit<Work, "id" | "userId" | "createdAt" | "updatedAt">>
) {
  return withStore(store => {
    const work = store.works.find(
      item => item.id === workId && item.userId === userId && !item.deletedAt
    );
    if (!work) throw new Error("Work not found");
    const nextData = { ...data };
    if ("seriesId" in nextData) {
      const series = assertSeriesForUser(store, userId, nextData.seriesId);
      if (!series) {
        nextData.bookNumber = null;
      } else if (!("bookNumber" in nextData) || nextData.bookNumber == null) {
        nextData.bookNumber = nextBookNumberForSeries(store, userId, series.id);
      }
    }
    Object.assign(work, nextData, { updatedAt: now() });
    if (work.isDefault === "true") ensureDefaultWork(store, userId);
    return clone(work);
  });
}

export async function setDefaultWork(userId: number, workId: number) {
  return withStore(store => {
    const work = store.works.find(
      item => item.id === workId && item.userId === userId && !item.deletedAt
    );
    if (!work) throw new Error("Work not found");
    for (const item of store.works.filter(
      entry => entry.userId === userId && !entry.deletedAt
    )) {
      item.isDefault = item.id === workId ? "true" : "false";
      item.updatedAt = now();
    }
    return clone(work);
  });
}

export async function createDraft(
  userId: number,
  data: Omit<Draft, "id" | "userId" | "createdAt" | "updatedAt"> &
    Partial<Pick<Draft, "createdAt" | "updatedAt">>,
  workId: number | null
): Promise<Draft> {
  return withStore(store => {
    const timestamp = now();
    const resolvedWorkId = resolveWorkId(
      store,
      userId,
      workId ?? data.workId ?? null
    );
    const draft: Draft = {
      id: nextId(store.drafts),
      userId,
      workId: resolvedWorkId,
      title: data.title,
      content: data.content,
      sceneLocation: data.sceneLocation ?? null,
      bookReference: data.bookReference ?? null,
      chapterNumber: data.chapterNumber ?? null,
      mainCharacters: data.mainCharacters ?? null,
      summary: data.summary ?? null,
      untouchableDialogue: data.untouchableDialogue ?? null,
      untouchableScenes: data.untouchableScenes ?? null,
      canonicalFacts: data.canonicalFacts ?? null,
      notes: data.notes ?? null,
      status: data.status ?? "draft",
      createdAt: data.createdAt ?? timestamp,
      updatedAt: data.updatedAt ?? timestamp,
    };
    store.drafts.push(draft);
    return clone(draft);
  });
}

export async function countUserDrafts(
  userId: number,
  workId: number | null = null
): Promise<number> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return store.drafts.filter(
    item =>
      item.userId === userId &&
      (item.workId ?? resolvedWorkId) === resolvedWorkId
  ).length;
}

export async function getUserDrafts(
  userId: number,
  workId: number | null = null,
  pagination?: PaginationOptions
): Promise<Draft[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  const rows = sortByDateDesc(
    store.drafts.filter(
      item =>
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId
    ),
    "updatedAt"
  );
  return clone(paginate(rows, pagination));
}

export async function getDraftById(
  draftId: number,
  userId: number,
  workId: number | null
): Promise<Draft | undefined> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return (
    clone(
      store.drafts.find(
        item =>
          item.id === draftId &&
          item.userId === userId &&
          (item.workId ?? resolvedWorkId) === resolvedWorkId
      )
    ) ?? undefined
  );
}

export async function updateDraft(
  draftId: number,
  userId: number,
  data: Partial<Omit<Draft, "id" | "userId" | "createdAt" | "updatedAt">>,
  workId: number | null = null
): Promise<Draft> {
  return withStore(store => {
    const resolvedWorkId = resolveWorkId(store, userId, workId);
    const draft = store.drafts.find(
      item =>
        item.id === draftId &&
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId
    );
    if (!draft) throw new Error("Draft not found after update");
    Object.assign(draft, data, { updatedAt: now(), workId: resolvedWorkId });
    return clone(draft);
  });
}

export async function setDraftStatus(
  draftId: number,
  userId: number,
  status: DraftStatus,
  workId: number | null
) {
  return updateDraft(draftId, userId, { status }, workId);
}

export async function deleteDraft(
  draftId: number,
  userId: number,
  workId: number | null
): Promise<boolean> {
  return withStore(store => {
    const resolvedWorkId = resolveWorkId(store, userId, workId);
    const before = store.drafts.length;
    store.drafts = store.drafts.filter(
      draft =>
        !(
          draft.id === draftId &&
          draft.userId === userId &&
          (draft.workId ?? resolvedWorkId) === resolvedWorkId
        )
    );
    return store.drafts.length < before;
  });
}

export async function createChapter(
  userId: number,
  data: Omit<Chapter, "id" | "userId" | "createdAt" | "updatedAt"> &
    Partial<Pick<Chapter, "createdAt" | "updatedAt">>,
  workId: number | null
): Promise<Chapter> {
  return withStore(store => {
    const timestamp = now();
    const resolvedWorkId = resolveWorkId(
      store,
      userId,
      workId ?? data.workId ?? null
    );
    const chapter: Chapter = {
      id: nextId(store.chapters),
      userId,
      workId: resolvedWorkId,
      draftId: data.draftId ?? null,
      title: data.title,
      content: data.content,
      bookNumber: data.bookNumber ?? null,
      chapterNumber: data.chapterNumber ?? null,
      status: data.status ?? "in_development",
      generationPrompt: data.generationPrompt ?? null,
      createdAt: data.createdAt ?? timestamp,
      updatedAt: data.updatedAt ?? timestamp,
    };
    store.chapters.push(chapter);
    return clone(chapter);
  });
}

export async function countUserChapters(
  userId: number,
  workId: number | null
): Promise<number> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return store.chapters.filter(
    item =>
      item.userId === userId &&
      (item.workId ?? resolvedWorkId) === resolvedWorkId
  ).length;
}

export async function getUserChapters(
  userId: number,
  workId: number | null,
  pagination?: PaginationOptions
): Promise<Chapter[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  const rows = sortByDateDesc(
    store.chapters.filter(
      item =>
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId
    ),
    "updatedAt"
  );
  return clone(paginate(rows, pagination));
}

export async function getChapterById(
  chapterId: number,
  userId: number,
  workId: number | null
): Promise<Chapter | undefined> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return (
    clone(
      store.chapters.find(
        item =>
          item.id === chapterId &&
          item.userId === userId &&
          (item.workId ?? resolvedWorkId) === resolvedWorkId
      )
    ) ?? undefined
  );
}

export async function updateChapter(
  chapterId: number,
  userId: number,
  data: Partial<Omit<Chapter, "id" | "userId" | "createdAt" | "updatedAt">>,
  workId: number | null = null
): Promise<Chapter> {
  return withStore(store => {
    const resolvedWorkId = resolveWorkId(store, userId, workId);
    const chapter = store.chapters.find(
      item =>
        item.id === chapterId &&
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId
    );
    if (!chapter) throw new Error("Chapter not found after update");
    Object.assign(chapter, data, { updatedAt: now(), workId: resolvedWorkId });
    return clone(chapter);
  });
}

export async function createLibraryEntry(
  userId: number,
  data: Omit<LibraryEntry, "id" | "userId" | "createdAt" | "updatedAt"> &
    Partial<Pick<LibraryEntry, "createdAt" | "updatedAt">>,
  workId: number | null
) {
  return withStore(store => {
    const timestamp = now();
    const resolvedWorkId = resolveWorkId(
      store,
      userId,
      workId ?? data.workId ?? null
    );
    const entry: LibraryEntry = {
      id: nextId(store.libraryEntries),
      userId,
      workId: resolvedWorkId,
      type: data.type,
      name: data.name,
      description: data.description ?? null,
      details: data.details ?? null,
      status: data.status ?? "in_development",
      createdAt: data.createdAt ?? timestamp,
      updatedAt: data.updatedAt ?? timestamp,
    };
    store.libraryEntries.push(entry);
    return clone(entry);
  });
}

export async function countUserLibraryEntries(
  userId: number,
  type: string | undefined = undefined,
  workId: number | null = null
): Promise<number> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return store.libraryEntries.filter(
    item =>
      item.userId === userId &&
      (item.workId ?? resolvedWorkId) === resolvedWorkId &&
      (!type || item.type === type)
  ).length;
}

export async function getUserLibraryEntries(
  userId: number,
  type: string | undefined = undefined,
  workId: number | null = null,
  pagination?: PaginationOptions
): Promise<LibraryEntry[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  const rows = sortByDateDesc(
    store.libraryEntries.filter(
      item =>
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId &&
        (!type || item.type === type)
    ),
    "updatedAt"
  );
  return clone(paginate(rows, pagination));
}

export async function getOrCreateAuthorProfile(
  userId: number,
  workId: number | null
): Promise<AuthorProfile> {
  return withStore(store =>
    clone(getOrCreateAuthorProfileFromStore(store, userId, workId))
  );
}

export async function updateAuthorProfile(
  userId: number,
  data: Partial<AuthorProfile>,
  workId: number | null
) {
  return withStore(store => {
    const profile = getOrCreateAuthorProfileFromStore(store, userId, workId);
    Object.assign(profile, data, { updatedAt: now() });
    return clone(profile);
  });
}

export async function createChapterReview(
  userId: number,
  chapterId: number,
  data: Omit<
    ChapterReview,
    "id" | "userId" | "chapterId" | "createdAt" | "updatedAt"
  > &
    Partial<Pick<ChapterReview, "createdAt" | "updatedAt">>
) {
  return withStore(store => {
    const timestamp = now();
    const review: ChapterReview = {
      id: nextId(store.chapterReviews),
      chapterId,
      userId,
      comments: data.comments ?? null,
      alerts: data.alerts ?? null,
      revisionBrief: data.revisionBrief ?? null,
      revisionFixCount: data.revisionFixCount ?? 0,
      status: data.status ?? "pending",
      createdAt: data.createdAt ?? timestamp,
      updatedAt: data.updatedAt ?? timestamp,
    };
    store.chapterReviews.push(review);
    return clone(review);
  });
}

export async function getChapterReview(
  chapterId: number,
  userId: number
): Promise<ChapterReview | undefined> {
  const store = readStore();
  return (
    clone(
      store.chapterReviews.find(
        item => item.chapterId === chapterId && item.userId === userId
      )
    ) ?? undefined
  );
}

export async function createNotification(
  userId: number,
  data: Omit<Notification, "id" | "userId" | "createdAt"> &
    Partial<Pick<Notification, "createdAt">>
) {
  return withStore(store => {
    const notification: Notification = {
      id: nextId(store.notifications),
      userId,
      type: data.type,
      title: data.title,
      message: data.message,
      data: data.data ?? null,
      isRead: data.isRead ?? "false",
      createdAt: data.createdAt ?? now(),
    };
    store.notifications.push(notification);
    return clone(notification);
  });
}

export async function getUserNotifications(userId: number, limit: number = 20) {
  const store = readStore();
  return clone(
    sortByDateDesc(
      store.notifications.filter(item => item.userId === userId),
      "createdAt"
    ).slice(0, limit)
  );
}

export async function markNotificationAsRead(
  notificationId: number,
  userId: number
) {
  return withStore(store => {
    const notification = store.notifications.find(
      item => item.id === notificationId && item.userId === userId
    );
    if (!notification) return null;
    notification.isRead = "true";
    return clone(notification);
  });
}

export async function markAllNotificationsAsRead(userId: number) {
  return withStore(store => {
    for (const notification of store.notifications) {
      if (notification.userId === userId) {
        notification.isRead = "true";
      }
    }
    return { success: true };
  });
}

export async function getUnreadNotificationCount(
  userId: number
): Promise<number> {
  const store = readStore();
  return store.notifications.filter(
    item => item.userId === userId && item.isRead !== "true"
  ).length;
}

export async function getOrCreateStatistics(
  userId: number,
  workId: number | null
): Promise<Statistic> {
  return withStore(store =>
    clone(getOrCreateStatisticsFromStore(store, userId, workId))
  );
}

export async function updateStatistics(
  userId: number,
  updates: Partial<Omit<Statistic, "id" | "userId" | "createdAt">>,
  workId: number | null
) {
  return withStore(store => {
    const stat = getOrCreateStatisticsFromStore(store, userId, workId);
    Object.assign(stat, updates, { updatedAt: now() });
    return clone(stat);
  });
}

export async function incrementChapterCount(
  userId: number,
  wordCount: number = 0,
  workId: number | null
) {
  return withStore(store => {
    const stat = getOrCreateStatisticsFromStore(store, userId, workId);
    stat.totalChaptersGenerated = (stat.totalChaptersGenerated || 0) + 1;
    stat.totalWordsWritten = (stat.totalWordsWritten || 0) + wordCount;
    stat.lastGenerationDate = now();
    stat.updatedAt = now();
    return clone(stat);
  });
}

export async function incrementLibraryCount(
  userId: number,
  type: "character" | "event" | "location",
  workId: number | null
) {
  return withStore(store => {
    const stat = getOrCreateStatisticsFromStore(store, userId, workId);
    if (type === "character")
      stat.totalCharactersCreated = (stat.totalCharactersCreated || 0) + 1;
    if (type === "event")
      stat.totalEventsCreated = (stat.totalEventsCreated || 0) + 1;
    if (type === "location")
      stat.totalLocationsCreated = (stat.totalLocationsCreated || 0) + 1;
    stat.updatedAt = now();
    return clone(stat);
  });
}

export async function createChapterVersion(
  chapterId: number,
  userId: number,
  content: string,
  changeDescription: string
): Promise<ChapterVersion> {
  return withStore(store => {
    const latest = sortByDateDesc(
      store.chapterVersions.filter(item => item.chapterId === chapterId),
      "createdAt"
    )[0];
    const nextVersionNumber = latest ? (latest.versionNumber || 0) + 1 : 1;
    const version: ChapterVersion = {
      id: nextId(store.chapterVersions),
      chapterId,
      userId,
      content,
      versionNumber: nextVersionNumber,
      changeDescription: changeDescription ?? null,
      createdAt: now(),
    };
    store.chapterVersions.push(version);
    return clone(version);
  });
}

export async function getChapterVersions(
  chapterId: number
): Promise<ChapterVersion[]> {
  const store = readStore();
  return clone(
    sortByDateDesc(
      store.chapterVersions.filter(item => item.chapterId === chapterId),
      "createdAt"
    )
  );
}

export async function getChapterVersion(
  versionId: number
): Promise<ChapterVersion | undefined> {
  const store = readStore();
  return (
    clone(store.chapterVersions.find(item => item.id === versionId)) ??
    undefined
  );
}

export async function createCharacter(
  userId: number,
  data: Omit<InsertCharacter, "userId">,
  workId: number | null
): Promise<Character> {
  return withStore(store => {
    const timestamp = now();
    const resolvedWorkId = resolveWorkId(
      store,
      userId,
      workId ?? data.workId ?? null
    );
    const character: Character = {
      id: nextId(store.characters),
      userId,
      workId: resolvedWorkId,
      name: data.name,
      history: data.history,
      personality: data.personality ?? null,
      physicalDescription: data.physicalDescription ?? null,
      role: data.role ?? null,
      appearance: data.appearance ?? null,
      family: data.family ?? null,
      birthDate: data.birthDate ?? null,
      speechStyle: data.speechStyle ?? null,
      psychologicalProfile: data.psychologicalProfile ?? null,
      backstory: data.backstory ?? null,
      motivations: data.motivations ?? null,
      relationships: data.relationships ?? null,
      notes: data.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.characters.push(character);
    return clone(character);
  });
}

export async function countCharactersByUserId(
  userId: number,
  workId: number | null
): Promise<number> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return store.characters.filter(
    item =>
      item.userId === userId &&
      (item.workId ?? resolvedWorkId) === resolvedWorkId
  ).length;
}

export async function getCharactersByUserId(
  userId: number,
  workId: number | null,
  pagination?: PaginationOptions
): Promise<Character[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  const rows = [
    ...store.characters.filter(
      item =>
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId
    ),
  ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return clone(paginate(rows, pagination));
}

export async function searchCharactersByName(
  userId: number,
  query: string,
  workId: number | null
): Promise<Character[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return clone(
    [
      ...store.characters.filter(
        item =>
          item.userId === userId &&
          (item.workId ?? resolvedWorkId) === resolvedWorkId &&
          startsWithInsensitive(item.name, query)
      ),
    ]
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, 5)
  );
}

export async function getCharacterById(
  characterId: number,
  userId: number,
  workId: number | null
): Promise<Character | undefined> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return (
    clone(
      store.characters.find(
        item =>
          item.id === characterId &&
          item.userId === userId &&
          (item.workId ?? resolvedWorkId) === resolvedWorkId
      )
    ) ?? undefined
  );
}

export async function updateCharacter(
  characterId: number,
  userId: number,
  data: Partial<Omit<InsertCharacter, "userId">>,
  workId: number | null
): Promise<Character> {
  return withStore(store => {
    const resolvedWorkId = resolveWorkId(store, userId, workId);
    const existing = store.characters.find(
      item =>
        item.id === characterId &&
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId
    );
    if (!existing) throw new Error("Character not found");
    const oldName = existing.name;
    Object.assign(existing, data, { updatedAt: now(), workId: resolvedWorkId });
    syncCharacterReferencesAfterRename(
      store,
      userId,
      resolvedWorkId,
      oldName,
      existing
    );
    return clone(existing);
  });
}

export async function deleteCharacter(
  characterId: number,
  userId: number,
  workId: number | null
): Promise<void> {
  withStore(store => {
    const resolvedWorkId = resolveWorkId(store, userId, workId);
    const index = store.characters.findIndex(
      item =>
        item.id === characterId &&
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId
    );
    if (index === -1) throw new Error("Character not found");
    const [removed] = store.characters.splice(index, 1);
    cleanupCharacterReferencesOnDelete(store, userId, resolvedWorkId, removed);
  });
}

export async function createPromptTemplate(
  userId: number,
  data: Omit<InsertPromptTemplate, "userId">,
  workId: number | null
): Promise<PromptTemplate> {
  return withStore(store => {
    const timestamp = now();
    const resolvedWorkId = resolveWorkId(
      store,
      userId,
      workId ?? data.workId ?? null
    );
    const template: PromptTemplate = {
      id: nextId(store.promptTemplates),
      userId,
      workId: resolvedWorkId,
      name: data.name,
      description: data.description ?? null,
      template: data.template,
      variables: data.variables ?? null,
      category: data.category ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.promptTemplates.push(template);
    return clone(template);
  });
}

export async function getPromptTemplatesByUserId(
  userId: number,
  workId: number | null
): Promise<PromptTemplate[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return clone(
    sortByDateDesc(
      store.promptTemplates.filter(
        item =>
          item.userId === userId &&
          (item.workId ?? resolvedWorkId) === resolvedWorkId
      ),
      "createdAt"
    )
  );
}

export async function getPromptTemplateById(
  templateId: number,
  userId: number,
  workId: number | null
): Promise<PromptTemplate | undefined> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  return (
    clone(
      store.promptTemplates.find(
        item =>
          item.id === templateId &&
          item.userId === userId &&
          (item.workId ?? resolvedWorkId) === resolvedWorkId
      )
    ) ?? undefined
  );
}

export async function updatePromptTemplate(
  templateId: number,
  userId: number,
  data: Partial<Omit<InsertPromptTemplate, "userId">>,
  workId: number | null
): Promise<PromptTemplate> {
  return withStore(store => {
    const resolvedWorkId = resolveWorkId(store, userId, workId);
    const template = store.promptTemplates.find(
      item =>
        item.id === templateId &&
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId
    );
    if (!template) throw new Error("Template not found");
    Object.assign(template, data, { updatedAt: now(), workId: resolvedWorkId });
    return clone(template);
  });
}

export async function deletePromptTemplate(
  templateId: number,
  userId: number,
  workId: number | null
): Promise<void> {
  withStore(store => {
    const resolvedWorkId = resolveWorkId(store, userId, workId);
    const index = store.promptTemplates.findIndex(
      item =>
        item.id === templateId &&
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId
    );
    if (index === -1) return;
    store.promptTemplates.splice(index, 1);
  });
}

export async function searchLibraryEntries(
  userId: number,
  query: string,
  type: string = "",
  limit: number = 10,
  workId: number | null = null
): Promise<LibraryEntry[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  const rows = store.libraryEntries
    .filter(
      item =>
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId &&
        (!type || item.type === type) &&
        containsInsensitive(item.name, query)
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
  return clone(rows);
}

export async function searchLibraryEntriesBroad(
  userId: number,
  query: string,
  type: string = "",
  limit: number = 10,
  workId: number | null = null
): Promise<LibraryEntry[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  const rows = store.libraryEntries
    .filter(
      item =>
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId &&
        (!type || item.type === type) &&
        (containsInsensitive(item.name, query) ||
          containsInsensitive(item.description, query) ||
          containsInsensitive(item.details, query))
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
  return clone(rows);
}

export async function searchChaptersByContent(
  userId: number,
  query: string,
  limit: number = 5,
  workId: number | null
): Promise<Chapter[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  const rows = store.chapters
    .filter(
      item =>
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId &&
        (containsInsensitive(item.title, query) ||
          containsInsensitive(item.content, query))
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
  return clone(rows);
}

export async function searchDraftsByContent(
  userId: number,
  query: string,
  limit: number = 5,
  workId: number | null
): Promise<Draft[]> {
  const store = readStore();
  const resolvedWorkId = resolveWorkId(store, userId, workId);
  const rows = store.drafts
    .filter(
      item =>
        item.userId === userId &&
        (item.workId ?? resolvedWorkId) === resolvedWorkId &&
        (containsInsensitive(item.title, query) ||
          containsInsensitive(item.content, query) ||
          containsInsensitive(item.summary, query))
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
  return clone(rows);
}

export async function listReviewsByUserId(
  userId: number
): Promise<ChapterReview[]> {
  const store = readStore();
  return clone(
    sortByDateDesc(
      store.chapterReviews.filter(item => item.userId === userId),
      "updatedAt"
    )
  );
}

export async function upsertChapterReview(
  userId: number,
  chapterId: number,
  data: {
    comments?: string | null;
    alerts?: string | null;
    revisionBrief?: string | null;
    revisionFixCount?: number;
    status?: ReviewStatus | null;
  }
): Promise<ChapterReview> {
  return withStore(store => {
    let review = store.chapterReviews.find(
      item => item.chapterId === chapterId && item.userId === userId
    );
    if (review) {
      if (data.comments !== undefined) review.comments = data.comments;
      if (data.alerts !== undefined) review.alerts = data.alerts;
      if (data.revisionBrief !== undefined)
        review.revisionBrief = data.revisionBrief;
      if (data.revisionFixCount !== undefined)
        review.revisionFixCount = data.revisionFixCount;
      if (data.status !== undefined) review.status = data.status;
      review.updatedAt = now();
      return clone(review);
    }

    const timestamp = now();
    review = {
      id: nextId(store.chapterReviews),
      chapterId,
      userId,
      comments: data.comments ?? null,
      alerts: data.alerts ?? null,
      revisionBrief: data.revisionBrief ?? null,
      revisionFixCount: data.revisionFixCount ?? 0,
      status: data.status || "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.chapterReviews.push(review);
    return clone(review);
  });
}

export async function getCreditWallet(userId: number): Promise<CreditWallet> {
  return withStore(store => clone(ensureWallet(store, userId)));
}

export async function grantCredits(
  userId: number,
  amount: number,
  reason: string,
  options: {
    workId?: number | null;
    reference?: string | null;
    type?: LedgerType;
  } = {}
) {
  return withStore(store =>
    clone(
      grantWallet(
        store,
        userId,
        amount,
        reason,
        options.workId ?? null,
        options.reference ?? null,
        options.type ?? "grant"
      )
    )
  );
}

export async function chargeCredits(
  userId: number,
  amount: number,
  reason: string,
  options: { workId?: number | null; reference?: string | null } = {}
) {
  return withStore(store =>
    clone(
      chargeWallet(
        store,
        userId,
        amount,
        reason,
        options.workId ?? null,
        options.reference ?? null
      )
    )
  );
}

export async function listCreditLedgerEntries(
  userId: number,
  limit: number = 50
) {
  const store = readStore();
  return clone(
    sortByDateDesc(
      store.creditLedgerEntries.filter(item => item.userId === userId),
      "createdAt"
    ).slice(0, limit)
  );
}

export async function getUserSubscription(
  userId: number
): Promise<UserSubscription> {
  return withStore(store => clone(ensureSubscription(store, userId)));
}

export async function upsertUserSubscription(
  userId: number,
  data: Partial<
    Omit<UserSubscription, "id" | "userId" | "createdAt" | "updatedAt">
  >
) {
  return withStore(store => {
    const subscription = ensureSubscription(store, userId);
    Object.assign(subscription, data, { updatedAt: now() });
    subscription.creditAllowance =
      data.creditAllowance ?? getPlanWalletAllowance(subscription.planCode);
    ensurePlanWalletAllowance(store, userId, subscription);
    return clone(subscription);
  });
}

export async function getBillingSummary(userId: number) {
  return withStore(store => {
    const subscription = ensureSubscription(store, userId);
    ensurePlanWalletAllowance(store, userId, subscription);
    const wallet = ensureWallet(store, userId);
    const recentEntries = sortByDateDesc(
      store.creditLedgerEntries.filter(item => item.userId === userId),
      "createdAt"
    ).slice(0, 20);
    return clone({ wallet, subscription, recentEntries });
  });
}

// --- Generation Jobs ---

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
  const store = readStore();
  return clone(
    store.generationJobs.find(
      item => item.publicId === publicId && item.userId === userId
    )
  );
}

export async function getGenerationJobById(
  jobId: number,
  userId?: number
): Promise<GenerationJob | undefined> {
  const store = readStore();
  return clone(
    store.generationJobs.find(
      item =>
        item.id === jobId && (userId === undefined || item.userId === userId)
    )
  );
}

export async function findGenerationJobByIdempotencyKey(
  userId: number,
  idempotencyKey: string
): Promise<GenerationJob | undefined> {
  const store = readStore();
  return clone(
    store.generationJobs.find(
      item => item.userId === userId && item.idempotencyKey === idempotencyKey
    )
  );
}

export async function findActiveGenerationJobForTarget(
  userId: number,
  workId: number,
  options: { draftId?: number | null; chapterId?: number | null } = {}
): Promise<GenerationJob | undefined> {
  const store = readStore();
  return clone(
    store.generationJobs.find(item => {
      if (
        item.userId !== userId ||
        item.workId !== workId ||
        !ACTIVE_GENERATION_JOB_STATUSES.includes(item.status)
      )
        return false;
      if (
        options.draftId !== undefined &&
        item.draftId !== (options.draftId ?? null)
      )
        return false;
      if (
        options.chapterId !== undefined &&
        item.chapterId !== (options.chapterId ?? null)
      )
        return false;
      return true;
    })
  );
}

export async function createGenerationJob(
  data: CreateGenerationJobData
): Promise<GenerationJob> {
  return withStore(store => {
    const timestamp = now();
    const job: GenerationJob = {
      ...data,
      id: data.id ?? nextId(store.generationJobs),
      createdAt: data.createdAt ?? timestamp,
      updatedAt: data.updatedAt ?? timestamp,
    };
    store.generationJobs.push(job);
    return clone(job);
  });
}

export async function updateGenerationJob(
  jobId: number,
  data: Partial<Omit<GenerationJob, "id" | "createdAt" | "updatedAt">>
): Promise<GenerationJob> {
  return withStore(store => {
    const job = store.generationJobs.find(item => item.id === jobId);
    if (!job) throw new Error("Generation job not found");
    Object.assign(job, data, { updatedAt: now() });
    return clone(job);
  });
}

export async function listActiveGenerationJobs(
  userId: number,
  workId?: number | null
): Promise<GenerationJob[]> {
  const store = readStore();
  return clone(
    sortByDateDesc(
      store.generationJobs.filter(
        item =>
          item.userId === userId &&
          (workId === undefined || item.workId === workId) &&
          ACTIVE_GENERATION_JOB_STATUSES.includes(item.status)
      ),
      "updatedAt"
    )
  );
}

export async function acquireNextGenerationJob(
  workerId: string,
  lockMs: number
): Promise<GenerationJob | undefined> {
  return withStore(store => {
    const timestamp = now();
    const lockExpiresAt = new Date(timestamp.getTime() + lockMs);
    const job = store.generationJobs
      .filter(item => {
        const lockExpired =
          item.lockExpiresAt instanceof Date &&
          item.lockExpiresAt.getTime() <= timestamp.getTime();
        const queued = item.status === "queued";
        const abandoned =
          ACTIVE_GENERATION_JOB_STATUSES.includes(item.status) && lockExpired;
        return (queued || abandoned) && item.attempts < item.maxAttempts;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (!job) return undefined;

    job.status = "preparing";
    job.progressMessage =
      "Estamos preparando o contexto narrativo da sua obra.";
    job.lockedAt = timestamp;
    job.lockedBy = workerId;
    job.lockExpiresAt = lockExpiresAt;
    job.attempts += 1;
    job.updatedAt = timestamp;
    return clone(job);
  });
}

export async function createGenerationCostLog(
  data: CreateGenerationCostLogData
): Promise<GenerationCostLog> {
  return withStore(store => {
    const row: GenerationCostLog = {
      ...data,
      id: data.id ?? nextId(store.generationCostLogs),
      createdAt: data.createdAt ?? now(),
    };
    store.generationCostLogs.push(row);
    return clone(row);
  });
}

export async function createGenerationUsageLedgerEntry(
  data: CreateGenerationUsageLedgerData
): Promise<GenerationUsageLedgerEntry> {
  return withStore(store => {
    const row: GenerationUsageLedgerEntry = {
      ...data,
      id: data.id ?? nextId(store.generationUsageLedger),
      createdAt: data.createdAt ?? now(),
    };
    store.generationUsageLedger.push(row);
    return clone(row);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Audit Reports (Auditoria de Consistência Narrativa)
// ─────────────────────────────────────────────────────────────────────────
//
// Cada relatório é 1-1 com um generationJob de action=consistency_audit.
// `issuesJson` guarda o array bruto de NarrativeConsistencyIssue.
// O histórico é preservado: NUNCA sobrescrevemos um relatório existente —
// cada nova auditoria cria um novo registro. Update aqui serve só pra ajustar
// contadores agregados, nunca pra apagar histórico.

type CreateAuditReportInput = Omit<InsertAuditReport, "id" | "createdAt"> & {
  id?: number;
  createdAt?: Date;
};

export async function createAuditReport(
  data: CreateAuditReportInput
): Promise<AuditReport> {
  return withStore(store => {
    const row: AuditReport = {
      id: data.id ?? nextId(store.auditReports),
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
      createdAt: data.createdAt ?? now(),
    };
    store.auditReports.push(row);
    return clone(row);
  });
}

export async function getAuditReportById(
  reportId: number,
  userId?: number
): Promise<AuditReport | undefined> {
  const store = readStore();
  return clone(
    store.auditReports.find(
      item =>
        item.id === reportId && (userId === undefined || item.userId === userId)
    )
  );
}

export async function getAuditReportByJobId(
  jobId: number,
  userId?: number
): Promise<AuditReport | undefined> {
  const store = readStore();
  return clone(
    store.auditReports.find(
      item =>
        item.jobId === jobId && (userId === undefined || item.userId === userId)
    )
  );
}

export async function getLatestAuditReportByWork(
  workId: number,
  userId: number
): Promise<AuditReport | undefined> {
  const store = readStore();
  const entries = store.auditReports.filter(
    item => item.userId === userId && item.workId === workId
  );
  if (!entries.length) return undefined;
  return clone(sortByDateDesc(entries, "createdAt")[0]);
}

export async function listAuditReportsByWork(
  workId: number,
  userId: number,
  options?: PaginationOptions
): Promise<AuditReport[]> {
  const store = readStore();
  const entries = store.auditReports.filter(
    item => item.userId === userId && item.workId === workId
  );
  return clone(paginate(sortByDateDesc(entries, "createdAt"), options));
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
  return withStore(store => {
    const row = store.auditReports.find(item => item.id === reportId);
    if (!row) throw new Error("Audit report not found");
    Object.assign(row, data);
    return clone(row);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Improvement Reports (Melhorias Narrativas)
// ─────────────────────────────────────────────────────────────────────────
//
// Estrutura paralela aos audit reports: cada job de
// `action=narrative_improvements` gera UM novo registro. Histórico preservado
// — updateImprovementReport existe só pra ajustes pontuais; o ciclo normal
// é create-only.

type CreateImprovementReportInput = Omit<
  InsertImprovementReport,
  "id" | "createdAt"
> & {
  id?: number;
  createdAt?: Date;
};

export async function createImprovementReport(
  data: CreateImprovementReportInput
): Promise<ImprovementReport> {
  return withStore(store => {
    const row: ImprovementReport = {
      id: data.id ?? nextId(store.improvementReports),
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
      createdAt: data.createdAt ?? now(),
    };
    store.improvementReports.push(row);
    return clone(row);
  });
}

export async function getImprovementReportById(
  reportId: number,
  userId?: number
): Promise<ImprovementReport | undefined> {
  const store = readStore();
  return clone(
    store.improvementReports.find(
      item =>
        item.id === reportId && (userId === undefined || item.userId === userId)
    )
  );
}

export async function getImprovementReportByJobId(
  jobId: number,
  userId?: number
): Promise<ImprovementReport | undefined> {
  const store = readStore();
  return clone(
    store.improvementReports.find(
      item =>
        item.jobId === jobId && (userId === undefined || item.userId === userId)
    )
  );
}

export async function getLatestImprovementReportByWork(
  workId: number,
  userId: number
): Promise<ImprovementReport | undefined> {
  const store = readStore();
  const entries = store.improvementReports.filter(
    item => item.userId === userId && item.workId === workId
  );
  if (!entries.length) return undefined;
  return clone(sortByDateDesc(entries, "createdAt")[0]);
}

export async function listImprovementReportsByWork(
  workId: number,
  userId: number,
  options?: PaginationOptions
): Promise<ImprovementReport[]> {
  const store = readStore();
  const entries = store.improvementReports.filter(
    item => item.userId === userId && item.workId === workId
  );
  return clone(paginate(sortByDateDesc(entries, "createdAt"), options));
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
  return withStore(store => {
    const row = store.improvementReports.find(item => item.id === reportId);
    if (!row) throw new Error("Improvement report not found");
    Object.assign(row, data);
    return clone(row);
  });
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
  return withStore(store => {
    const subscription = ensureSubscription(store, userId);
    Object.assign(subscription, data, { updatedAt: now() });
    subscription.monthlyNarrativeCreditsUsed = Math.max(
      0,
      subscription.monthlyNarrativeCreditsUsed ?? 0
    );
    subscription.monthlyNarrativeCreditsReserved = Math.max(
      0,
      subscription.monthlyNarrativeCreditsReserved ?? 0
    );
    subscription.extraNarrativeCredits = Math.max(
      0,
      subscription.extraNarrativeCredits ?? 0
    );
    subscription.extraNarrativeCreditsReserved = Math.max(
      0,
      subscription.extraNarrativeCreditsReserved ?? 0
    );
    subscription.monthlyAnalysisCreditsUsed = Math.max(
      0,
      subscription.monthlyAnalysisCreditsUsed ?? 0
    );
    subscription.monthlyAnalysisCreditsReserved = Math.max(
      0,
      subscription.monthlyAnalysisCreditsReserved ?? 0
    );
    subscription.extraAnalysisCredits = Math.max(
      0,
      subscription.extraAnalysisCredits ?? 0
    );
    subscription.extraAnalysisCreditsReserved = Math.max(
      0,
      subscription.extraAnalysisCreditsReserved ?? 0
    );
    subscription.monthlyInspirationUsed = Math.max(
      0,
      subscription.monthlyInspirationUsed ?? 0
    );
    subscription.monthlyTextReviewUsed = Math.max(
      0,
      subscription.monthlyTextReviewUsed ?? 0
    );
    return clone(subscription);
  });
}

// --- A09 (OWASP) Audit Log ---

export async function writeAuditLog(entry: {
  actorId: number;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: number | null;
  metadata?: string | null;
  ipAddress?: string | null;
}): Promise<void> {
  withStore(store => {
    store.auditLogs.push({
      id: nextId(store.auditLogs),
      actorId: entry.actorId,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ipAddress: entry.ipAddress ?? null,
      createdAt: now(),
    });
  });
}

export async function listAuditLogs(
  filters: { actorId?: number; action?: string; limit?: number } = {}
) {
  const store = readStore();
  const limit = Math.min(filters.limit ?? 100, 500);
  let entries = store.auditLogs;
  if (filters.actorId !== undefined)
    entries = entries.filter(e => e.actorId === filters.actorId);
  if (filters.action)
    entries = entries.filter(e => e.action === filters.action);
  return clone(sortByDateDesc(entries, "createdAt").slice(0, limit));
}

// --- Account Management ---

export async function deleteUserAccount(userId: number): Promise<void> {
  withStore(store => {
    store.drafts = store.drafts.filter(d => d.userId !== userId);
    store.chapters = store.chapters.filter(c => c.userId !== userId);
    store.libraryEntries = store.libraryEntries.filter(
      l => l.userId !== userId
    );
    store.seriesLibraryEntries = store.seriesLibraryEntries.filter(
      l => l.userId !== userId
    );
    store.authorProfiles = store.authorProfiles.filter(
      a => a.userId !== userId
    );
    store.chapterReviews = store.chapterReviews.filter(
      r => r.userId !== userId
    );
    store.notifications = store.notifications.filter(n => n.userId !== userId);
    store.statistics = store.statistics.filter(s => s.userId !== userId);
    store.characters = store.characters.filter(c => c.userId !== userId);
    store.promptTemplates = store.promptTemplates.filter(
      p => p.userId !== userId
    );
    if (store.chapterVersions)
      store.chapterVersions = store.chapterVersions.filter(
        v => v.userId !== userId
      );
    if (store.works) store.works = store.works.filter(w => w.userId !== userId);
    if (store.bookSeries)
      store.bookSeries = store.bookSeries.filter(s => s.userId !== userId);
    if (store.creditWallets)
      store.creditWallets = store.creditWallets.filter(
        w => w.userId !== userId
      );
    if (store.creditLedgerEntries)
      store.creditLedgerEntries = store.creditLedgerEntries.filter(
        e => e.userId !== userId
      );
    if (store.userSubscriptions)
      store.userSubscriptions = store.userSubscriptions.filter(
        s => s.userId !== userId
      );
    if (store.generationJobs)
      store.generationJobs = store.generationJobs.filter(
        j => j.userId !== userId
      );
    if (store.generationCostLogs)
      store.generationCostLogs = store.generationCostLogs.filter(
        l => l.userId !== userId
      );
    if (store.generationUsageLedger)
      store.generationUsageLedger = store.generationUsageLedger.filter(
        l => l.userId !== userId
      );
    if (store.auditReports)
      store.auditReports = store.auditReports.filter(r => r.userId !== userId);
    if (store.improvementReports)
      store.improvementReports = store.improvementReports.filter(
        r => r.userId !== userId
      );
    store.users = store.users.filter(u => u.id !== userId);
  });
}

export async function changePassword(userId: number, newPasswordHash: string) {
  return withStore(store => {
    const user = store.users.find(item => item.id === userId);
    if (!user) throw new Error("User not found");
    user.passwordHash = newPasswordHash;
    user.updatedAt = now();
    return clone(user);
  });
}
// EOF
