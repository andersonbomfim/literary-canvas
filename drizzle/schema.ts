import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// PostgreSQL enum type names are global inside a schema, while this model has
// several independent columns called `status`, `type` and `planTier`. A typed
// varchar keeps the same application-level unions without creating colliding
// enum types in Postgres.
function enumColumn<
  const U extends string,
  const TValues extends readonly [U, ...U[]]
>(
  name: string,
  values: TValues
) {
  return varchar(name, { length: 64, enum: values });
}

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    passwordHash: text("passwordHash"),
    resetTokenHash: text("resetTokenHash"),
    resetTokenExpiresAt: timestamp("resetTokenExpiresAt"),
    // A07.1 (OWASP) â€” account lockout: contagem de falhas consecutivas e
    // janela de bloqueio temporÃ¡rio apÃ³s X tentativas erradas seguidas.
    failedLoginCount: integer("failedLoginCount").default(0).notNull(),
    lockedUntil: timestamp("lockedUntil"),
    role: enumColumn("role", ["user", "admin"]).default("user").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  table => [
    // UNIQUE â€” prevents the register-race that previously could create two
    // accounts with the same e-mail. MySQL UNIQUE allows multiple NULLs, so
    // OAuth users without an e-mail still work.
    uniqueIndex("uniq_users_email").on(table.email),
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const bookSeries = pgTable(
  "bookSeries",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    genre: varchar("genre", { length: 120 }),
    universeNotes: text("universeNotes"),
    status: enumColumn("status", ["active", "paused", "archived"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [index("idx_bookSeries_userId").on(table.userId)]
);

export type BookSeries = typeof bookSeries.$inferSelect;
export type InsertBookSeries = typeof bookSeries.$inferInsert;

export const seriesLibraryEntries = pgTable(
  "seriesLibraryEntries",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    seriesId: integer("seriesId").notNull(),
    type: varchar("type", { length: 80 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    details: text("details"),
    sourceWorkIds: text("sourceWorkIds"),
    confidence: integer("confidence").default(80),
    status: enumColumn("status", ["canonical", "needs_review", "conflict"])
      .default("needs_review")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    index("idx_seriesLibraryEntries_userId").on(table.userId),
    index("idx_seriesLibraryEntries_seriesId").on(table.seriesId),
  ]
);

export type SeriesLibraryEntry = typeof seriesLibraryEntries.$inferSelect;
export type InsertSeriesLibraryEntry = typeof seriesLibraryEntries.$inferInsert;

export const works = pgTable(
  "works",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    seriesId: integer("seriesId"),
    bookNumber: integer("bookNumber"),
    title: varchar("title", { length: 255 }).notNull(),
    subtitle: varchar("subtitle", { length: 255 }),
    description: text("description"),
    genre: varchar("genre", { length: 120 }),
    coverImage: text("coverImage"),
    coverPositionX: integer("coverPositionX").default(50),
    coverPositionY: integer("coverPositionY").default(50),
    coverScale: integer("coverScale").default(100),
    status: enumColumn("status", [
      "planning",
      "in_progress",
      "paused",
      "completed",
      "archived",
    ])
      .default("planning")
      .notNull(),
    isDefault: enumColumn("isDefault", ["true", "false"])
      .default("false")
      .notNull(),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    index("idx_works_userId").on(table.userId),
    index("idx_works_seriesId").on(table.seriesId),
  ]
);

export type Work = typeof works.$inferSelect;
export type InsertWork = typeof works.$inferInsert;

export const drafts = pgTable(
  "drafts",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    workId: integer("workId"),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),
    sceneLocation: varchar("sceneLocation", { length: 255 }),
    bookReference: varchar("bookReference", { length: 255 }),
    chapterNumber: varchar("chapterNumber", { length: 50 }),
    mainCharacters: text("mainCharacters"),
    summary: text("summary"),
    untouchableDialogue: text("untouchableDialogue"),
    untouchableScenes: text("untouchableScenes"),
    canonicalFacts: text("canonicalFacts"),
    notes: text("notes"),
    status: enumColumn("status", [
      "draft",
      "sent_to_writing",
      "archived",
    ]).default("draft"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    index("idx_drafts_userId").on(table.userId),
    index("idx_drafts_workId").on(table.workId),
  ]
);

export type Draft = typeof drafts.$inferSelect;
export type InsertDraft = typeof drafts.$inferInsert;

export const chapters = pgTable(
  "chapters",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    workId: integer("workId"),
    draftId: integer("draftId"),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),
    bookNumber: integer("bookNumber"),
    chapterNumber: integer("chapterNumber"),
    status: enumColumn("status", [
      "canonical",
      "in_development",
      "hypothesis",
      "discarded",
    ]).default("in_development"),
    generationPrompt: text("generationPrompt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    index("idx_chapters_userId").on(table.userId),
    index("idx_chapters_workId").on(table.workId),
    index("idx_chapters_draftId").on(table.draftId),
  ]
);

export type Chapter = typeof chapters.$inferSelect;
export type InsertChapter = typeof chapters.$inferInsert;

export const libraryEntries = pgTable(
  "libraryEntries",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    workId: integer("workId"),
    type: enumColumn("type", [
      "character",
      "event",
      "location",
      "aura",
      "society",
    ]).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    details: text("details"),
    status: enumColumn("status", [
      "canonical",
      "in_development",
      "hypothesis",
      "discarded",
    ]).default("in_development"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    index("idx_libraryEntries_userId").on(table.userId),
    index("idx_libraryEntries_workId").on(table.workId),
  ]
);

export type LibraryEntry = typeof libraryEntries.$inferSelect;
export type InsertLibraryEntry = typeof libraryEntries.$inferInsert;

export const authorProfiles = pgTable("authorProfiles", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  workId: integer("workId"),
  narrativeStyle: text("narrativeStyle"),
  keyElements: text("keyElements"),
  characterVoices: text("characterVoices"),
  negativeRules: text("negativeRules"),
  keyChapters: text("keyChapters"),
  storyFoundation: text("storyFoundation"),
  continuityMemories: text("continuityMemories"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type AuthorProfile = typeof authorProfiles.$inferSelect;
export type InsertAuthorProfile = typeof authorProfiles.$inferInsert;

export const chapterReviews = pgTable(
  "chapterReviews",
  {
    id: serial("id").primaryKey(),
    chapterId: integer("chapterId").notNull(),
    userId: integer("userId").notNull(),
    comments: text("comments"),
    alerts: text("alerts"),
    // O retorno para a Escrita precisa sobreviver a refresh, nova aba e
    // navegaÃ§Ã£o direta. Estes campos guardam o recorte exato escolhido pelo
    // revisor, em vez de reconstruir todas as observaÃ§Ãµes da Ãºltima anÃ¡lise.
    revisionBrief: text("revisionBrief"),
    revisionFixCount: integer("revisionFixCount").default(0).notNull(),
    status: enumColumn("status", [
      "in_writing",
      "pending",
      "approved",
      "rejected",
      "revision_needed",
    ]).default("pending"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    index("idx_chapterReviews_chapterId").on(table.chapterId),
    index("idx_chapterReviews_userId").on(table.userId),
  ]
);

export type ChapterReview = typeof chapterReviews.$inferSelect;
export type InsertChapterReview = typeof chapterReviews.$inferInsert;

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    type: enumColumn("type", [
      "chapter_generated",
      "chapter_error",
      "library_created",
      "profile_updated",
      "review_completed",
      "system",
      "billing",
    ]).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    data: text("data"),
    isRead: enumColumn("isRead", ["true", "false"]).default("false"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("idx_notifications_userId").on(table.userId)]
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

export const statistics = pgTable("statistics", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  workId: integer("workId"),
  totalChaptersGenerated: integer("totalChaptersGenerated").default(0),
  totalWordsWritten: integer("totalWordsWritten").default(0),
  totalCharactersCreated: integer("totalCharactersCreated").default(0),
  totalEventsCreated: integer("totalEventsCreated").default(0),
  totalLocationsCreated: integer("totalLocationsCreated").default(0),
  lastGenerationDate: timestamp("lastGenerationDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Statistic = typeof statistics.$inferSelect;
export type InsertStatistic = typeof statistics.$inferInsert;

export const chapterVersions = pgTable(
  "chapterVersions",
  {
    id: serial("id").primaryKey(),
    chapterId: integer("chapterId").notNull(),
    userId: integer("userId").notNull(),
    content: text("content").notNull(),
    versionNumber: integer("versionNumber").notNull(),
    changeDescription: varchar("changeDescription", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("idx_chapterVersions_chapterId").on(table.chapterId)]
);

export type ChapterVersion = typeof chapterVersions.$inferSelect;
export type InsertChapterVersion = typeof chapterVersions.$inferInsert;

export const characters = pgTable(
  "characters",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    workId: integer("workId"),
    name: varchar("name", { length: 255 }).notNull(),
    history: text("history").notNull(),
    personality: text("personality"),
    physicalDescription: text("physicalDescription"),
    role: varchar("role", { length: 100 }),
    appearance: varchar("appearance", { length: 100 }),
    family: text("family"),
    birthDate: varchar("birthDate", { length: 100 }),
    speechStyle: text("speechStyle"),
    psychologicalProfile: text("psychologicalProfile"),
    backstory: text("backstory"),
    motivations: text("motivations"),
    relationships: text("relationships"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    index("idx_characters_userId").on(table.userId),
    index("idx_characters_workId").on(table.workId),
  ]
);

export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;

export const promptTemplates = pgTable("promptTemplates", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  workId: integer("workId"),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  template: text("template").notNull(),
  variables: text("variables"),
  category: varchar("category", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type InsertPromptTemplate = typeof promptTemplates.$inferInsert;

export const creditWallets = pgTable(
  "creditWallets",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    balance: integer("balance").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("uniq_creditWallets_userId").on(table.userId)]
);

export type CreditWallet = typeof creditWallets.$inferSelect;
export type InsertCreditWallet = typeof creditWallets.$inferInsert;

export const creditLedgerEntries = pgTable(
  "creditLedgerEntries",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    workId: integer("workId"),
    type: enumColumn("type", [
      "grant",
      "usage",
      "refund",
      "adjustment",
    ]).notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balanceAfter").notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    reference: varchar("reference", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("idx_creditLedgerEntries_userId").on(table.userId),
    index("idx_creditLedgerEntries_user_reference").on(
      table.userId,
      table.reference
    ),
  ]
);

export type CreditLedgerEntry = typeof creditLedgerEntries.$inferSelect;
export type InsertCreditLedgerEntry = typeof creditLedgerEntries.$inferInsert;

export const userSubscriptions = pgTable(
  "userSubscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    planCode: enumColumn("planCode", ["weekly", "monthly", "yearly", "none"])
      .default("none")
      .notNull(),
    planTier: enumColumn("planTier", ["free", "essential", "ultra"])
      .default("free")
      .notNull(),
    status: enumColumn("status", [
      "active",
      "paused",
      "canceled",
      "trial",
      "none",
    ])
      .default("none")
      .notNull(),
    renewsAt: timestamp("renewsAt"),
    creditAllowance: integer("creditAllowance").default(0).notNull(),
    monthlyNarrativeCreditLimit: integer("monthlyNarrativeCreditLimit")
      .default(5000)
      .notNull(),
    monthlyNarrativeCreditsUsed: integer("monthlyNarrativeCreditsUsed")
      .default(0)
      .notNull(),
    monthlyNarrativeCreditsReserved: integer("monthlyNarrativeCreditsReserved")
      .default(0)
      .notNull(),
    extraNarrativeCredits: integer("extraNarrativeCredits").default(0).notNull(),
    extraNarrativeCreditsReserved: integer("extraNarrativeCreditsReserved")
      .default(0)
      .notNull(),
    // Auditoria de ConsistÃªncia Narrativa â€” bolsa separada das narrativas.
    // 1 crÃ©dito de anÃ¡lise = 1 palavra lida pela auditoria global.
    // Free=0 (sem acesso), Essential=120k/mÃªs, Ultra=600k/mÃªs (ver planConfig).
    monthlyAnalysisCreditLimit: integer("monthlyAnalysisCreditLimit")
      .default(0)
      .notNull(),
    monthlyAnalysisCreditsUsed: integer("monthlyAnalysisCreditsUsed")
      .default(0)
      .notNull(),
    monthlyAnalysisCreditsReserved: integer("monthlyAnalysisCreditsReserved")
      .default(0)
      .notNull(),
    extraAnalysisCredits: integer("extraAnalysisCredits").default(0).notNull(),
    extraAnalysisCreditsReserved: integer("extraAnalysisCreditsReserved")
      .default(0)
      .notNull(),
    billingCycleStart: timestamp("billingCycleStart"),
    billingCycleEnd: timestamp("billingCycleEnd"),
    monthlyInspirationUsed: integer("monthlyInspirationUsed").default(0).notNull(),
    monthlyTextReviewUsed: integer("monthlyTextReviewUsed").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("uniq_userSubscriptions_userId").on(table.userId)]
);

export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type InsertUserSubscription = typeof userSubscriptions.$inferInsert;

export const generationJobs = pgTable(
  "generationJobs",
  {
    id: serial("id").primaryKey(),
    publicId: varchar("publicId", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    userId: integer("userId").notNull(),
    workId: integer("workId"),
    draftId: integer("draftId"),
    chapterId: integer("chapterId"),
    outputChapterId: integer("outputChapterId"),
    action: enumColumn("action", [
      "generate",
      "regenerate",
      "localized_edit",
      "consistency_audit",
      "narrative_improvements",
    ])
      .default("generate")
      .notNull(),
    generationMode: enumColumn("generationMode", ["standard", "premium"])
      .default("standard")
      .notNull(),
    planTier: enumColumn("planTier", ["free", "essential", "ultra"])
      .default("free")
      .notNull(),
    engine: enumColumn("engine", [
      "current",
      "runpod_4090",
      "deepseek_free",
      "deepseek_essential",
      "deepseek_ultra",
      "deepseek_review",
      "deepseek_inspiration",
      "open_source_4090",
      "open_source_h100",
      "openai_instant",
      "openai_thinking",
    ])
      .default("current")
      .notNull(),
    fallbackEngine: enumColumn("fallbackEngine", [
      "current",
      "runpod_4090",
      "deepseek_free",
      "deepseek_essential",
      "deepseek_ultra",
      "deepseek_review",
      "deepseek_inspiration",
      "open_source_4090",
      "open_source_h100",
      "openai_instant",
      "openai_thinking",
    ]),
    status: enumColumn("status", [
      "queued",
      "preparing",
      "generating",
      "finalizing",
      "completed",
      "failed",
      "canceled",
    ])
      .default("queued")
      .notNull(),
    progressMessage: varchar("progressMessage", { length: 500 }).notNull(),
    inputSnapshot: text("inputSnapshot"),
    outputText: text("outputText"),
    draftVersion: integer("draftVersion"),
    chapterVersion: integer("chapterVersion"),
    requestedMaxOutputWords: integer("requestedMaxOutputWords")
      .default(0)
      .notNull(),
    generatedWordCount: integer("generatedWordCount").default(0).notNull(),
    reservedCredits: integer("reservedCredits").default(0).notNull(),
    reservedMonthlyCredits: integer("reservedMonthlyCredits").default(0).notNull(),
    reservedExtraCredits: integer("reservedExtraCredits").default(0).notNull(),
    confirmedCredits: integer("confirmedCredits").default(0).notNull(),
    confirmedMonthlyCredits: integer("confirmedMonthlyCredits")
      .default(0)
      .notNull(),
    confirmedExtraCredits: integer("confirmedExtraCredits").default(0).notNull(),
    releasedCredits: integer("releasedCredits").default(0).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("maxAttempts").default(2).notNull(),
    lockedAt: timestamp("lockedAt"),
    lockedBy: varchar("lockedBy", { length: 120 }),
    lockExpiresAt: timestamp("lockExpiresAt"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    canceledAt: timestamp("canceledAt"),
    errorCode: varchar("errorCode", { length: 120 }),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("uniq_generationJobs_publicId").on(table.publicId),
    uniqueIndex("uniq_generationJobs_user_idempotency").on(
      table.userId,
      table.idempotencyKey
    ),
    index("idx_generationJobs_user_status").on(table.userId, table.status),
    index("idx_generationJobs_work_status").on(table.workId, table.status),
    index("idx_generationJobs_lock").on(table.status, table.lockExpiresAt),
  ]
);

export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertGenerationJob = typeof generationJobs.$inferInsert;

export const generationCostLogs = pgTable(
  "generationCostLogs",
  {
    id: serial("id").primaryKey(),
    jobId: integer("jobId").notNull(),
    publicJobId: varchar("publicJobId", { length: 64 }).notNull(),
    userId: integer("userId").notNull(),
    workId: integer("workId"),
    engine: varchar("engine", { length: 80 }).notNull(),
    fallbackEngine: varchar("fallbackEngine", { length: 80 }),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    durationSeconds: integer("durationSeconds").default(0).notNull(),
    inputWordCount: integer("inputWordCount").default(0).notNull(),
    outputWordCount: integer("outputWordCount").default(0).notNull(),
    inputCharCount: integer("inputCharCount").default(0).notNull(),
    outputCharCount: integer("outputCharCount").default(0).notNull(),
    providerRequestId: varchar("providerRequestId", { length: 255 }),
    fallbackUsed: integer("fallbackUsed").default(0).notNull(),
    estimatedCostUsd: varchar("estimatedCostUsd", { length: 32 }),
    status: enumColumn("status", ["success", "failed", "canceled"]).notNull(),
    errorCode: varchar("errorCode", { length: 120 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("idx_generationCostLogs_jobId").on(table.jobId),
    index("idx_generationCostLogs_userId").on(table.userId),
  ]
);

export type GenerationCostLog = typeof generationCostLogs.$inferSelect;
export type InsertGenerationCostLog = typeof generationCostLogs.$inferInsert;

export const generationUsageLedger = pgTable(
  "generationUsageLedger",
  {
    id: serial("id").primaryKey(),
    jobId: integer("jobId").notNull(),
    publicJobId: varchar("publicJobId", { length: 64 }).notNull(),
    userId: integer("userId").notNull(),
    workId: integer("workId"),
    // Diferencia bolsas:
    //   "narrative_generation" = geraÃ§Ã£o/regeneraÃ§Ã£o de capÃ­tulo (default
    //      pra retrocompatibilidade com toda linha prÃ©-Auditoria).
    //   "book_consistency_audit" = leitura integral pra Auditoria de ConsistÃªncia.
    //   "narrative_improvements" = leitura integral pra sugestÃµes editoriais (Melhorias).
    // Auditoria e Melhorias compartilham a MESMA bolsa (monthlyAnalysisCredit*)
    // â€” sÃ³ diferenciamos aqui no ledger pra rastreabilidade contÃ¡bil.
    usageType: enumColumn("usageType", [
      "narrative_generation",
      "book_consistency_audit",
      "narrative_improvements",
    ])
      .default("narrative_generation")
      .notNull(),
    source: enumColumn("source", ["monthly", "extra"]).notNull(),
    type: enumColumn("type", [
      "reserve",
      "confirm",
      "release",
      "refund",
      "adjustment",
    ]).notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balanceAfter"),
    reason: varchar("reason", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("idx_generationUsageLedger_jobId").on(table.jobId),
    index("idx_generationUsageLedger_userId").on(table.userId),
    index("idx_generationUsageLedger_usageType").on(table.usageType),
  ]
);

export type GenerationUsageLedgerEntry =
  typeof generationUsageLedger.$inferSelect;
export type InsertGenerationUsageLedgerEntry =
  typeof generationUsageLedger.$inferInsert;

// Auditoria de ConsistÃªncia Narrativa â€” relatÃ³rio gerado pela leitura
// integral da obra. 1-1 com um generationJob de action=consistency_audit.
// O relatÃ³rio bruto (lista de NarrativeConsistencyIssue) vai no campo
// `issuesJson`. Logs operacionais NÃƒO devem guardar o texto do livro, mas
// guardar este relatÃ³rio associado ao usuÃ¡rio/obra Ã© OK.
export const auditReports = pgTable(
  "auditReports",
  {
    id: serial("id").primaryKey(),
    jobId: integer("jobId").notNull(),
    publicJobId: varchar("publicJobId", { length: 64 }).notNull(),
    userId: integer("userId").notNull(),
    workId: integer("workId").notNull(),
    // Snapshot do nÂº de palavras do livro no momento da auditoria.
    wordCount: integer("wordCount").notNull(),
    // Total cobrado em crÃ©ditos de anÃ¡lise (deve bater com wordCount, mas
    // guardamos separado pra histÃ³rico caso a fÃ³rmula mude no futuro).
    analysisCreditsCharged: integer("analysisCreditsCharged").notNull(),
    // EstratÃ©gia usada: "integral" (caiu no contexto direto) ou "pipeline"
    // (extraÃ§Ã£o por capÃ­tulo + consolidaÃ§Ã£o + cruzamento).
    strategy: enumColumn("strategy", ["integral", "pipeline"]).notNull(),
    // Engine usada (current/runpod_4090). Reusa o enum do generationJobs.
    engine: varchar("engine", { length: 64 }).notNull(),
    // Contadores agregados pra UI e analytics, evita ter que reparse o JSON.
    totalIssues: integer("totalIssues").default(0).notNull(),
    criticalCount: integer("criticalCount").default(0).notNull(),
    highCount: integer("highCount").default(0).notNull(),
    mediumCount: integer("mediumCount").default(0).notNull(),
    lowCount: integer("lowCount").default(0).notNull(),
    // ConteÃºdo do relatÃ³rio: JSON array de NarrativeConsistencyIssue.
    issuesJson: text("issuesJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("idx_auditReports_userId").on(table.userId),
    index("idx_auditReports_workId").on(table.workId),
    index("idx_auditReports_jobId").on(table.jobId),
    index("idx_auditReports_created").on(table.createdAt),
  ]
);

export type AuditReport = typeof auditReports.$inferSelect;
export type InsertAuditReport = typeof auditReports.$inferInsert;

// Melhorias Narrativas â€” relatÃ³rio gerado pela leitura global da obra.
// 1-1 com um generationJob de action=narrative_improvements. Estrutura
// paralela a auditReports, mas com conteÃºdo editorial em vez de
// contradiÃ§Ãµes. Os trechos citados (excerpts) vivem dentro do
// `suggestionsJson` (array de NarrativeImprovementSuggestion).
export const improvementReports = pgTable(
  "improvementReports",
  {
    id: serial("id").primaryKey(),
    jobId: integer("jobId").notNull(),
    publicJobId: varchar("publicJobId", { length: 64 }).notNull(),
    userId: integer("userId").notNull(),
    workId: integer("workId").notNull(),
    // Snapshot do tamanho da obra no momento da anÃ¡lise.
    wordCount: integer("wordCount").notNull(),
    // CrÃ©ditos consumidos (mesma bolsa da auditoria â€” analysisCredits).
    // Guardamos separado pra histÃ³rico no caso da fÃ³rmula mudar.
    analysisCreditsCharged: integer("analysisCreditsCharged").notNull(),
    // EstratÃ©gia usada: "integral" (caiu no contexto) ou "pipeline" (extraÃ§Ã£o
    // por capÃ­tulo + cruzamento global).
    strategy: enumColumn("strategy", ["integral", "pipeline"]).notNull(),
    // Provider/modelo usados (label compacto), pra debugging futuro.
    engine: varchar("engine", { length: 64 }).notNull(),
    // Contadores agregados por prioridade â€” evita reparse do JSON na UI.
    totalSuggestions: integer("totalSuggestions").default(0).notNull(),
    criticalCount: integer("criticalCount").default(0).notNull(),
    highCount: integer("highCount").default(0).notNull(),
    mediumCount: integer("mediumCount").default(0).notNull(),
    lowCount: integer("lowCount").default(0).notNull(),
    // ConteÃºdo do relatÃ³rio: JSON array de NarrativeImprovementSuggestion.
    suggestionsJson: text("suggestionsJson").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("idx_improvementReports_userId").on(table.userId),
    index("idx_improvementReports_workId").on(table.workId),
    index("idx_improvementReports_jobId").on(table.jobId),
    index("idx_improvementReports_created").on(table.createdAt),
  ]
);

export type ImprovementReport = typeof improvementReports.$inferSelect;
export type InsertImprovementReport = typeof improvementReports.$inferInsert;

// A09 (OWASP) â€” Audit log para aÃ§Ãµes administrativas (mudanÃ§a de role,
// concessÃ£o de crÃ©ditos, mudanÃ§a de plano, exclusÃ£o de conta) e qualquer
// outra aÃ§Ã£o privilegiada que precise ser reconstituÃ­da em incidente.
export const auditLogs = pgTable(
  "auditLogs",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actorId").notNull(),
    actorEmail: varchar("actorEmail", { length: 320 }),
    action: varchar("action", { length: 80 }).notNull(),
    targetType: varchar("targetType", { length: 64 }),
    targetId: integer("targetId"),
    metadata: text("metadata"),
    ipAddress: varchar("ipAddress", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("idx_auditLogs_actor").on(table.actorId),
    index("idx_auditLogs_created").on(table.createdAt),
    index("idx_auditLogs_action").on(table.action),
  ]
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

// NOTE: authorStyleAnalysis table was removed â€” it was defined but never used
// by any router, DB function, or client code. Re-add when the feature is built.
