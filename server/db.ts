import { ENV } from "./_core/env";
import * as mysql from "./db.mysql";
import * as local from "./localDb";

const localPreference = process.env.LOCAL_DATA_ONLY;
const useLocal = localPreference === "true" || !ENV.databaseUrl;

/**
 * Typed proxy: picks the local or MySQL implementation at startup,
 * preserving the full function signature from localDb.
 */
type LocalDb = typeof local;

function pick<K extends keyof LocalDb>(name: K): LocalDb[K] {
  const localFn = local[name];
  const mysqlFn = (mysql as Record<string, unknown>)[name];

  if (!useLocal && typeof mysqlFn === "function") {
    return mysqlFn as LocalDb[K];
  }

  if (typeof localFn !== "function") {
    throw new Error(
      `Função ${String(name)} não está disponível no modo local.`
    );
  }
  return localFn;
}

// --- Auth / Users ---
export const upsertUser = pick("upsertUser");
export const getUserByOpenId = pick("getUserByOpenId");
export const getUserByEmail = pick("getUserByEmail");
export const listUsers = pick("listUsers");
export const countUsers = pick("countUsers");
export const createLocalUser = pick("createLocalUser");
export const updateUserPassword = pick("updateUserPassword");
export const savePasswordResetToken = pick("savePasswordResetToken");
export const getUserByResetTokenHash = pick("getUserByResetTokenHash");
export const clearPasswordResetToken = pick("clearPasswordResetToken");
export const updateUserRole = pick("updateUserRole");
// A07.1 — account lockout helpers
export const recordFailedLogin = pick("recordFailedLogin");
export const resetFailedLogins = pick("resetFailedLogins");
// A09 — audit log
export const writeAuditLog = pick("writeAuditLog");
export const listAuditLogs = pick("listAuditLogs");

// --- Works ---
export const listWorksByUserId = pick("listWorksByUserId");
export const getWorkById = pick("getWorkById");
export const getDefaultWorkForUser = pick("getDefaultWorkForUser");
export const createWork = pick("createWork");
export const updateWork = pick("updateWork");
export const setDefaultWork = pick("setDefaultWork");
export const listTrashedWorks = pick("listTrashedWorks");
export const softDeleteWork = pick("softDeleteWork");
export const restoreWork = pick("restoreWork");
export const permanentDeleteWork = pick("permanentDeleteWork");
export const listBookSeriesByUserId = pick("listBookSeriesByUserId");
export const createBookSeries = pick("createBookSeries");
export const updateBookSeries = pick("updateBookSeries");
export const deleteBookSeries = pick("deleteBookSeries");
export const listWorksBySeriesId = pick("listWorksBySeriesId");
export const getSeriesContextForWork = pick("getSeriesContextForWork");
export const listSeriesLibraryEntries = pick("listSeriesLibraryEntries");
export const replaceSeriesLibraryEntries = pick("replaceSeriesLibraryEntries");

// --- Drafts ---
export const createDraft = pick("createDraft");
export const countUserDrafts = pick("countUserDrafts");
export const getUserDrafts = pick("getUserDrafts");
export const getDraftById = pick("getDraftById");
export const updateDraft = pick("updateDraft");
export const setDraftStatus = pick("setDraftStatus");
export const deleteDraft = pick("deleteDraft");

// --- Chapters ---
export const createChapter = pick("createChapter");
export const countUserChapters = pick("countUserChapters");
export const getUserChapters = pick("getUserChapters");
export const getChapterById = pick("getChapterById");
export const updateChapter = pick("updateChapter");

// --- Library ---
export const createLibraryEntry = pick("createLibraryEntry");
export const countUserLibraryEntries = pick("countUserLibraryEntries");
export const getUserLibraryEntries = pick("getUserLibraryEntries");
export const searchLibraryEntries = pick("searchLibraryEntries");
export const searchLibraryEntriesBroad = pick("searchLibraryEntriesBroad");

// --- Author Profile ---
export const getOrCreateAuthorProfile = pick("getOrCreateAuthorProfile");
export const updateAuthorProfile = pick("updateAuthorProfile");

// --- Reviews ---
export const createChapterReview = pick("createChapterReview");
export const getChapterReview = pick("getChapterReview");
export const listReviewsByUserId = pick("listReviewsByUserId");
export const upsertChapterReview = pick("upsertChapterReview");

// --- Notifications ---
export const createNotification = pick("createNotification");
export const getUserNotifications = pick("getUserNotifications");
export const markNotificationAsRead = pick("markNotificationAsRead");
export const markAllNotificationsAsRead = pick("markAllNotificationsAsRead");
export const getUnreadNotificationCount = pick("getUnreadNotificationCount");

// --- Statistics ---
export const getOrCreateStatistics = pick("getOrCreateStatistics");
export const updateStatistics = pick("updateStatistics");
export const incrementChapterCount = pick("incrementChapterCount");
export const incrementLibraryCount = pick("incrementLibraryCount");

// --- Versions ---
export const createChapterVersion = pick("createChapterVersion");
export const getChapterVersions = pick("getChapterVersions");
export const getChapterVersion = pick("getChapterVersion");

// --- Characters ---
export const createCharacter = pick("createCharacter");
export const countCharactersByUserId = pick("countCharactersByUserId");
export const getCharactersByUserId = pick("getCharactersByUserId");
export const searchCharactersByName = pick("searchCharactersByName");
export const getCharacterById = pick("getCharacterById");
export const updateCharacter = pick("updateCharacter");
export const deleteCharacter = pick("deleteCharacter");

// --- Prompt Templates ---
export const createPromptTemplate = pick("createPromptTemplate");
export const getPromptTemplatesByUserId = pick("getPromptTemplatesByUserId");
export const getPromptTemplateById = pick("getPromptTemplateById");
export const updatePromptTemplate = pick("updatePromptTemplate");
export const deletePromptTemplate = pick("deletePromptTemplate");

// --- Search ---
export const searchChaptersByContent = pick("searchChaptersByContent");
export const searchDraftsByContent = pick("searchDraftsByContent");

// --- Billing ---
export const getCreditWallet = pick("getCreditWallet");
export const grantCredits = pick("grantCredits");
export const chargeCredits = pick("chargeCredits");
export const listCreditLedgerEntries = pick("listCreditLedgerEntries");
export const getUserSubscription = pick("getUserSubscription");
export const upsertUserSubscription = pick("upsertUserSubscription");
export const getBillingSummary = pick("getBillingSummary");

// --- Generation Jobs ---
export const getGenerationJobByPublicId = pick("getGenerationJobByPublicId");
export const getGenerationJobById = pick("getGenerationJobById");
export const findGenerationJobByIdempotencyKey = pick(
  "findGenerationJobByIdempotencyKey"
);
export const findActiveGenerationJobForTarget = pick(
  "findActiveGenerationJobForTarget"
);
export const createGenerationJob = pick("createGenerationJob");
export const updateGenerationJob = pick("updateGenerationJob");
export const listActiveGenerationJobs = pick("listActiveGenerationJobs");
export const acquireNextGenerationJob = pick("acquireNextGenerationJob");
export const createGenerationCostLog = pick("createGenerationCostLog");
export const createGenerationUsageLedgerEntry = pick(
  "createGenerationUsageLedgerEntry"
);
export const updateUserSubscriptionGenerationUsage = pick(
  "updateUserSubscriptionGenerationUsage"
);

// --- Audit Reports (Auditoria de Consistência Narrativa) ---
export const createAuditReport = pick("createAuditReport");
export const getAuditReportById = pick("getAuditReportById");
export const getAuditReportByJobId = pick("getAuditReportByJobId");
export const getLatestAuditReportByWork = pick("getLatestAuditReportByWork");
export const listAuditReportsByWork = pick("listAuditReportsByWork");
export const updateAuditReport = pick("updateAuditReport");

// --- Improvement Reports (Melhorias Narrativas) ---
export const createImprovementReport = pick("createImprovementReport");
export const getImprovementReportById = pick("getImprovementReportById");
export const getImprovementReportByJobId = pick("getImprovementReportByJobId");
export const getLatestImprovementReportByWork = pick(
  "getLatestImprovementReportByWork"
);
export const listImprovementReportsByWork = pick(
  "listImprovementReportsByWork"
);
export const updateImprovementReport = pick("updateImprovementReport");

// --- Account Management ---
export const deleteUserAccount = pick("deleteUserAccount");
export const changePassword = pick("changePassword");
