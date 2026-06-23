import {
  index,
  int,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    passwordHash: text("passwordHash"),
    resetTokenHash: text("resetTokenHash"),
    resetTokenExpiresAt: timestamp("resetTokenExpiresAt"),
    // A07.1 (OWASP) — account lockout: contagem de falhas consecutivas e
    // janela de bloqueio temporário após X tentativas erradas seguidas.
    failedLoginCount: int("failedLoginCount").default(0).notNull(),
    lockedUntil: timestamp("lockedUntil"),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  table => [
    // UNIQUE — prevents the register-race that previously could create two
    // accounts with the same e-mail. MySQL UNIQUE allows multiple NULLs, so
    // OAuth users without an e-mail still work.
    uniqueIndex("uniq_users_email").on(table.email),
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const bookSeries = mysqlTable(
  "bookSeries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    genre: varchar("genre", { length: 120 }),
    universeNotes: text("universeNotes"),
    status: mysqlEnum("status", ["active", "paused", "archived"])
      .default("active")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("idx_bookSeries_userId").on(table.userId)]
);

export type BookSeries = typeof bookSeries.$inferSelect;
export type InsertBookSeries = typeof bookSeries.$inferInsert;

export const seriesLibraryEntries = mysqlTable(
  "seriesLibraryEntries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    seriesId: int("seriesId").notNull(),
    type: varchar("type", { length: 80 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    details: text("details"),
    sourceWorkIds: text("sourceWorkIds"),
    confidence: int("confidence").default(80),
    status: mysqlEnum("status", ["canonical", "needs_review", "conflict"])
      .default("needs_review")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("idx_seriesLibraryEntries_userId").on(table.userId),
    index("idx_seriesLibraryEntries_seriesId").on(table.seriesId),
  ]
);

export type SeriesLibraryEntry = typeof seriesLibraryEntries.$inferSelect;
export type InsertSeriesLibraryEntry = typeof seriesLibraryEntries.$inferInsert;

export const works = mysqlTable(
  "works",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    seriesId: int("seriesId"),
    bookNumber: int("bookNumber"),
    title: varchar("title", { length: 255 }).notNull(),
    subtitle: varchar("subtitle", { length: 255 }),
    description: text("description"),
    genre: varchar("genre", { length: 120 }),
    coverImage: text("coverImage"),
    coverPositionX: int("coverPositionX").default(50),
    coverPositionY: int("coverPositionY").default(50),
    coverScale: int("coverScale").default(100),
    status: mysqlEnum("status", [
      "planning",
      "in_progress",
      "paused",
      "completed",
      "archived",
    ])
      .default("planning")
      .notNull(),
    isDefault: mysqlEnum("isDefault", ["true", "false"])
      .default("false")
      .notNull(),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("idx_works_userId").on(table.userId),
    index("idx_works_seriesId").on(table.seriesId),
  ]
);

export type Work = typeof works.$inferSelect;
export type InsertWork = typeof works.$inferInsert;

export const drafts = mysqlTable(
  "drafts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    workId: int("workId"),
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
    status: mysqlEnum("status", [
      "draft",
      "sent_to_writing",
      "archived",
    ]).default("draft"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("idx_drafts_userId").on(table.userId),
    index("idx_drafts_workId").on(table.workId),
  ]
);

export type Draft = typeof drafts.$inferSelect;
export type InsertDraft = typeof drafts.$inferInsert;

export const chapters = mysqlTable(
  "chapters",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    workId: int("workId"),
    draftId: int("draftId"),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),
    bookNumber: int("bookNumber"),
    chapterNumber: int("chapterNumber"),
    status: mysqlEnum("status", [
      "canonical",
      "in_development",
      "hypothesis",
      "discarded",
    ]).default("in_development"),
    generationPrompt: text("generationPrompt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("idx_chapters_userId").on(table.userId),
    index("idx_chapters_workId").on(table.workId),
    index("idx_chapters_draftId").on(table.draftId),
  ]
);

export type Chapter = typeof chapters.$inferSelect;
export type InsertChapter = typeof chapters.$inferInsert;

export const libraryEntries = mysqlTable(
  "libraryEntries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    workId: int("workId"),
    type: mysqlEnum("type", [
      "character",
      "event",
      "location",
      "aura",
      "society",
    ]).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    details: text("details"),
    status: mysqlEnum("status", [
      "canonical",
      "in_development",
      "hypothesis",
      "discarded",
    ]).default("in_development"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("idx_libraryEntries_userId").on(table.userId),
    index("idx_libraryEntries_workId").on(table.workId),
  ]
);

export type LibraryEntry = typeof libraryEntries.$inferSelect;
export type InsertLibraryEntry = typeof libraryEntries.$inferInsert;

export const authorProfiles = mysqlTable("authorProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  workId: int("workId"),
  narrativeStyle: text("narrativeStyle"),
  keyElements: text("keyElements"),
  characterVoices: text("characterVoices"),
  negativeRules: text("negativeRules"),
  keyChapters: text("keyChapters"),
  storyFoundation: text("storyFoundation"),
  continuityMemories: text("continuityMemories"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AuthorProfile = typeof authorProfiles.$inferSelect;
export type InsertAuthorProfile = typeof authorProfiles.$inferInsert;

export const chapterReviews = mysqlTable(
  "chapterReviews",
  {
    id: int("id").autoincrement().primaryKey(),
    chapterId: int("chapterId").notNull(),
    userId: int("userId").notNull(),
    comments: text("comments"),
    alerts: text("alerts"),
    // O retorno para a Escrita precisa sobreviver a refresh, nova aba e
    // navegação direta. Estes campos guardam o recorte exato escolhido pelo
    // revisor, em vez de reconstruir todas as observações da última análise.
    revisionBrief: text("revisionBrief"),
    revisionFixCount: int("revisionFixCount").default(0).notNull(),
    status: mysqlEnum("status", [
      "in_writing",
      "pending",
      "approved",
      "rejected",
      "revision_needed",
    ]).default("pending"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("idx_chapterReviews_chapterId").on(table.chapterId),
    index("idx_chapterReviews_userId").on(table.userId),
  ]
);

export type ChapterReview = typeof chapterReviews.$inferSelect;
export type InsertChapterReview = typeof chapterReviews.$inferInsert;

export const notifications = mysqlTable(
  "notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    type: mysqlEnum("type", [
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
    isRead: mysqlEnum("isRead", ["true", "false"]).default("false"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("idx_notifications_userId").on(table.userId)]
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

export const statistics = mysqlTable("statistics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  workId: int("workId"),
  totalChaptersGenerated: int("totalChaptersGenerated").default(0),
  totalWordsWritten: int("totalWordsWritten").default(0),
  totalCharactersCreated: int("totalCharactersCreated").default(0),
  totalEventsCreated: int("totalEventsCreated").default(0),
  totalLocationsCreated: int("totalLocationsCreated").default(0),
  lastGenerationDate: timestamp("lastGenerationDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Statistic = typeof statistics.$inferSelect;
export type InsertStatistic = typeof statistics.$inferInsert;

export const chapterVersions = mysqlTable(
  "chapterVersions",
  {
    id: int("id").autoincrement().primaryKey(),
    chapterId: int("chapterId").notNull(),
    userId: int("userId").notNull(),
    content: text("content").notNull(),
    versionNumber: int("versionNumber").notNull(),
    changeDescription: varchar("changeDescription", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("idx_chapterVersions_chapterId").on(table.chapterId)]
);

export type ChapterVersion = typeof chapterVersions.$inferSelect;
export type InsertChapterVersion = typeof chapterVersions.$inferInsert;

export const characters = mysqlTable(
  "characters",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    workId: int("workId"),
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
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("idx_characters_userId").on(table.userId),
    index("idx_characters_workId").on(table.workId),
  ]
);

export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;

export const promptTemplates = mysqlTable("promptTemplates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  workId: int("workId"),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  template: text("template").notNull(),
  variables: text("variables"),
  category: varchar("category", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type InsertPromptTemplate = typeof promptTemplates.$inferInsert;

export const creditWallets = mysqlTable(
  "creditWallets",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    balance: int("balance").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("uniq_creditWallets_userId").on(table.userId)]
);

export type CreditWallet = typeof creditWallets.$inferSelect;
export type InsertCreditWallet = typeof creditWallets.$inferInsert;

export const creditLedgerEntries = mysqlTable(
  "creditLedgerEntries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    workId: int("workId"),
    type: mysqlEnum("type", [
      "grant",
      "usage",
      "refund",
      "adjustment",
    ]).notNull(),
    amount: int("amount").notNull(),
    balanceAfter: int("balanceAfter").notNull(),
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

export const userSubscriptions = mysqlTable(
  "userSubscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    planCode: mysqlEnum("planCode", ["weekly", "monthly", "yearly", "none"])
      .default("none")
      .notNull(),
    planTier: mysqlEnum("planTier", ["free", "essential", "ultra"])
      .default("free")
      .notNull(),
    status: mysqlEnum("status", [
      "active",
      "paused",
      "canceled",
      "trial",
      "none",
    ])
      .default("none")
      .notNull(),
    renewsAt: timestamp("renewsAt"),
    creditAllowance: int("creditAllowance").default(0).notNull(),
    monthlyNarrativeCreditLimit: int("monthlyNarrativeCreditLimit")
      .default(5000)
      .notNull(),
    monthlyNarrativeCreditsUsed: int("monthlyNarrativeCreditsUsed")
      .default(0)
      .notNull(),
    monthlyNarrativeCreditsReserved: int("monthlyNarrativeCreditsReserved")
      .default(0)
      .notNull(),
    extraNarrativeCredits: int("extraNarrativeCredits").default(0).notNull(),
    extraNarrativeCreditsReserved: int("extraNarrativeCreditsReserved")
      .default(0)
      .notNull(),
    // Auditoria de Consistência Narrativa — bolsa separada das narrativas.
    // 1 crédito de análise = 1 palavra lida pela auditoria global.
    // Free=0 (sem acesso), Essential=120k/mês, Ultra=600k/mês (ver planConfig).
    monthlyAnalysisCreditLimit: int("monthlyAnalysisCreditLimit")
      .default(0)
      .notNull(),
    monthlyAnalysisCreditsUsed: int("monthlyAnalysisCreditsUsed")
      .default(0)
      .notNull(),
    monthlyAnalysisCreditsReserved: int("monthlyAnalysisCreditsReserved")
      .default(0)
      .notNull(),
    extraAnalysisCredits: int("extraAnalysisCredits").default(0).notNull(),
    extraAnalysisCreditsReserved: int("extraAnalysisCreditsReserved")
      .default(0)
      .notNull(),
    billingCycleStart: timestamp("billingCycleStart"),
    billingCycleEnd: timestamp("billingCycleEnd"),
    monthlyInspirationUsed: int("monthlyInspirationUsed").default(0).notNull(),
    monthlyTextReviewUsed: int("monthlyTextReviewUsed").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("uniq_userSubscriptions_userId").on(table.userId)]
);

export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type InsertUserSubscription = typeof userSubscriptions.$inferInsert;

export const generationJobs = mysqlTable(
  "generationJobs",
  {
    id: int("id").autoincrement().primaryKey(),
    publicId: varchar("publicId", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    userId: int("userId").notNull(),
    workId: int("workId"),
    draftId: int("draftId"),
    chapterId: int("chapterId"),
    outputChapterId: int("outputChapterId"),
    action: mysqlEnum("action", [
      "generate",
      "regenerate",
      "localized_edit",
      "consistency_audit",
      "narrative_improvements",
    ])
      .default("generate")
      .notNull(),
    generationMode: mysqlEnum("generationMode", ["standard", "premium"])
      .default("standard")
      .notNull(),
    planTier: mysqlEnum("planTier", ["free", "essential", "ultra"])
      .default("free")
      .notNull(),
    engine: mysqlEnum("engine", [
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
    fallbackEngine: mysqlEnum("fallbackEngine", [
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
    status: mysqlEnum("status", [
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
    inputSnapshot: mediumtext("inputSnapshot"),
    outputText: mediumtext("outputText"),
    draftVersion: int("draftVersion"),
    chapterVersion: int("chapterVersion"),
    requestedMaxOutputWords: int("requestedMaxOutputWords")
      .default(0)
      .notNull(),
    generatedWordCount: int("generatedWordCount").default(0).notNull(),
    reservedCredits: int("reservedCredits").default(0).notNull(),
    reservedMonthlyCredits: int("reservedMonthlyCredits").default(0).notNull(),
    reservedExtraCredits: int("reservedExtraCredits").default(0).notNull(),
    confirmedCredits: int("confirmedCredits").default(0).notNull(),
    confirmedMonthlyCredits: int("confirmedMonthlyCredits")
      .default(0)
      .notNull(),
    confirmedExtraCredits: int("confirmedExtraCredits").default(0).notNull(),
    releasedCredits: int("releasedCredits").default(0).notNull(),
    attempts: int("attempts").default(0).notNull(),
    maxAttempts: int("maxAttempts").default(2).notNull(),
    lockedAt: timestamp("lockedAt"),
    lockedBy: varchar("lockedBy", { length: 120 }),
    lockExpiresAt: timestamp("lockExpiresAt"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    canceledAt: timestamp("canceledAt"),
    errorCode: varchar("errorCode", { length: 120 }),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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

export const generationCostLogs = mysqlTable(
  "generationCostLogs",
  {
    id: int("id").autoincrement().primaryKey(),
    jobId: int("jobId").notNull(),
    publicJobId: varchar("publicJobId", { length: 64 }).notNull(),
    userId: int("userId").notNull(),
    workId: int("workId"),
    engine: varchar("engine", { length: 80 }).notNull(),
    fallbackEngine: varchar("fallbackEngine", { length: 80 }),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    durationSeconds: int("durationSeconds").default(0).notNull(),
    inputWordCount: int("inputWordCount").default(0).notNull(),
    outputWordCount: int("outputWordCount").default(0).notNull(),
    inputCharCount: int("inputCharCount").default(0).notNull(),
    outputCharCount: int("outputCharCount").default(0).notNull(),
    providerRequestId: varchar("providerRequestId", { length: 255 }),
    fallbackUsed: int("fallbackUsed").default(0).notNull(),
    estimatedCostUsd: varchar("estimatedCostUsd", { length: 32 }),
    status: mysqlEnum("status", ["success", "failed", "canceled"]).notNull(),
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

export const generationUsageLedger = mysqlTable(
  "generationUsageLedger",
  {
    id: int("id").autoincrement().primaryKey(),
    jobId: int("jobId").notNull(),
    publicJobId: varchar("publicJobId", { length: 64 }).notNull(),
    userId: int("userId").notNull(),
    workId: int("workId"),
    // Diferencia bolsas:
    //   "narrative_generation" = geração/regeneração de capítulo (default
    //      pra retrocompatibilidade com toda linha pré-Auditoria).
    //   "book_consistency_audit" = leitura integral pra Auditoria de Consistência.
    //   "narrative_improvements" = leitura integral pra sugestões editoriais (Melhorias).
    // Auditoria e Melhorias compartilham a MESMA bolsa (monthlyAnalysisCredit*)
    // — só diferenciamos aqui no ledger pra rastreabilidade contábil.
    usageType: mysqlEnum("usageType", [
      "narrative_generation",
      "book_consistency_audit",
      "narrative_improvements",
    ])
      .default("narrative_generation")
      .notNull(),
    source: mysqlEnum("source", ["monthly", "extra"]).notNull(),
    type: mysqlEnum("type", [
      "reserve",
      "confirm",
      "release",
      "refund",
      "adjustment",
    ]).notNull(),
    amount: int("amount").notNull(),
    balanceAfter: int("balanceAfter"),
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

// Auditoria de Consistência Narrativa — relatório gerado pela leitura
// integral da obra. 1-1 com um generationJob de action=consistency_audit.
// O relatório bruto (lista de NarrativeConsistencyIssue) vai no campo
// `issuesJson`. Logs operacionais NÃO devem guardar o texto do livro, mas
// guardar este relatório associado ao usuário/obra é OK.
export const auditReports = mysqlTable(
  "auditReports",
  {
    id: int("id").autoincrement().primaryKey(),
    jobId: int("jobId").notNull(),
    publicJobId: varchar("publicJobId", { length: 64 }).notNull(),
    userId: int("userId").notNull(),
    workId: int("workId").notNull(),
    // Snapshot do nº de palavras do livro no momento da auditoria.
    wordCount: int("wordCount").notNull(),
    // Total cobrado em créditos de análise (deve bater com wordCount, mas
    // guardamos separado pra histórico caso a fórmula mude no futuro).
    analysisCreditsCharged: int("analysisCreditsCharged").notNull(),
    // Estratégia usada: "integral" (caiu no contexto direto) ou "pipeline"
    // (extração por capítulo + consolidação + cruzamento).
    strategy: mysqlEnum("strategy", ["integral", "pipeline"]).notNull(),
    // Engine usada (current/runpod_4090). Reusa o enum do generationJobs.
    engine: varchar("engine", { length: 64 }).notNull(),
    // Contadores agregados pra UI e analytics, evita ter que reparse o JSON.
    totalIssues: int("totalIssues").default(0).notNull(),
    criticalCount: int("criticalCount").default(0).notNull(),
    highCount: int("highCount").default(0).notNull(),
    mediumCount: int("mediumCount").default(0).notNull(),
    lowCount: int("lowCount").default(0).notNull(),
    // Conteúdo do relatório: JSON array de NarrativeConsistencyIssue.
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

// Melhorias Narrativas — relatório gerado pela leitura global da obra.
// 1-1 com um generationJob de action=narrative_improvements. Estrutura
// paralela a auditReports, mas com conteúdo editorial em vez de
// contradições. Os trechos citados (excerpts) vivem dentro do
// `suggestionsJson` (array de NarrativeImprovementSuggestion).
export const improvementReports = mysqlTable(
  "improvementReports",
  {
    id: int("id").autoincrement().primaryKey(),
    jobId: int("jobId").notNull(),
    publicJobId: varchar("publicJobId", { length: 64 }).notNull(),
    userId: int("userId").notNull(),
    workId: int("workId").notNull(),
    // Snapshot do tamanho da obra no momento da análise.
    wordCount: int("wordCount").notNull(),
    // Créditos consumidos (mesma bolsa da auditoria — analysisCredits).
    // Guardamos separado pra histórico no caso da fórmula mudar.
    analysisCreditsCharged: int("analysisCreditsCharged").notNull(),
    // Estratégia usada: "integral" (caiu no contexto) ou "pipeline" (extração
    // por capítulo + cruzamento global).
    strategy: mysqlEnum("strategy", ["integral", "pipeline"]).notNull(),
    // Provider/modelo usados (label compacto), pra debugging futuro.
    engine: varchar("engine", { length: 64 }).notNull(),
    // Contadores agregados por prioridade — evita reparse do JSON na UI.
    totalSuggestions: int("totalSuggestions").default(0).notNull(),
    criticalCount: int("criticalCount").default(0).notNull(),
    highCount: int("highCount").default(0).notNull(),
    mediumCount: int("mediumCount").default(0).notNull(),
    lowCount: int("lowCount").default(0).notNull(),
    // Conteúdo do relatório: JSON array de NarrativeImprovementSuggestion.
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

// A09 (OWASP) — Audit log para ações administrativas (mudança de role,
// concessão de créditos, mudança de plano, exclusão de conta) e qualquer
// outra ação privilegiada que precise ser reconstituída em incidente.
export const auditLogs = mysqlTable(
  "auditLogs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorId: int("actorId").notNull(),
    actorEmail: varchar("actorEmail", { length: 320 }),
    action: varchar("action", { length: 80 }).notNull(),
    targetType: varchar("targetType", { length: 64 }),
    targetId: int("targetId"),
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

// NOTE: authorStyleAnalysis table was removed — it was defined but never used
// by any router, DB function, or client code. Re-add when the feature is built.
