import { relations } from "drizzle-orm";
import {
  users,
  works,
  drafts,
  chapters,
  libraryEntries,
  authorProfiles,
  chapterReviews,
  notifications,
  statistics,
  chapterVersions,
  characters,
  promptTemplates,
  creditWallets,
  creditLedgerEntries,
  userSubscriptions,
  generationJobs,
  generationCostLogs,
  generationUsageLedger,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  works: many(works),
  drafts: many(drafts),
  chapters: many(chapters),
  libraryEntries: many(libraryEntries),
  authorProfiles: many(authorProfiles),
  notifications: many(notifications),
  statistics: many(statistics),
  characters: many(characters),
  promptTemplates: many(promptTemplates),
  creditWallets: many(creditWallets),
  creditLedgerEntries: many(creditLedgerEntries),
  userSubscriptions: many(userSubscriptions),
  generationJobs: many(generationJobs),
  generationCostLogs: many(generationCostLogs),
  generationUsageLedger: many(generationUsageLedger),
}));

export const worksRelations = relations(works, ({ one, many }) => ({
  user: one(users, { fields: [works.userId], references: [users.id] }),
  drafts: many(drafts),
  chapters: many(chapters),
  libraryEntries: many(libraryEntries),
  characters: many(characters),
  generationJobs: many(generationJobs),
}));

export const draftsRelations = relations(drafts, ({ one }) => ({
  user: one(users, { fields: [drafts.userId], references: [users.id] }),
  work: one(works, { fields: [drafts.workId], references: [works.id] }),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  user: one(users, { fields: [chapters.userId], references: [users.id] }),
  work: one(works, { fields: [chapters.workId], references: [works.id] }),
  draft: one(drafts, { fields: [chapters.draftId], references: [drafts.id] }),
  versions: many(chapterVersions),
  reviews: many(chapterReviews),
}));

export const libraryEntriesRelations = relations(libraryEntries, ({ one }) => ({
  user: one(users, { fields: [libraryEntries.userId], references: [users.id] }),
  work: one(works, { fields: [libraryEntries.workId], references: [works.id] }),
}));

export const authorProfilesRelations = relations(authorProfiles, ({ one }) => ({
  user: one(users, { fields: [authorProfiles.userId], references: [users.id] }),
  work: one(works, { fields: [authorProfiles.workId], references: [works.id] }),
}));

export const chapterReviewsRelations = relations(chapterReviews, ({ one }) => ({
  chapter: one(chapters, { fields: [chapterReviews.chapterId], references: [chapters.id] }),
  user: one(users, { fields: [chapterReviews.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const statisticsRelations = relations(statistics, ({ one }) => ({
  user: one(users, { fields: [statistics.userId], references: [users.id] }),
  work: one(works, { fields: [statistics.workId], references: [works.id] }),
}));

export const chapterVersionsRelations = relations(chapterVersions, ({ one }) => ({
  chapter: one(chapters, { fields: [chapterVersions.chapterId], references: [chapters.id] }),
  user: one(users, { fields: [chapterVersions.userId], references: [users.id] }),
}));

export const charactersRelations = relations(characters, ({ one }) => ({
  user: one(users, { fields: [characters.userId], references: [users.id] }),
  work: one(works, { fields: [characters.workId], references: [works.id] }),
}));

export const promptTemplatesRelations = relations(promptTemplates, ({ one }) => ({
  user: one(users, { fields: [promptTemplates.userId], references: [users.id] }),
  work: one(works, { fields: [promptTemplates.workId], references: [works.id] }),
}));

export const creditWalletsRelations = relations(creditWallets, ({ one }) => ({
  user: one(users, { fields: [creditWallets.userId], references: [users.id] }),
}));

export const creditLedgerEntriesRelations = relations(creditLedgerEntries, ({ one }) => ({
  user: one(users, { fields: [creditLedgerEntries.userId], references: [users.id] }),
  work: one(works, { fields: [creditLedgerEntries.workId], references: [works.id] }),
}));

export const userSubscriptionsRelations = relations(userSubscriptions, ({ one }) => ({
  user: one(users, { fields: [userSubscriptions.userId], references: [users.id] }),
}));

export const generationJobsRelations = relations(generationJobs, ({ one, many }) => ({
  user: one(users, { fields: [generationJobs.userId], references: [users.id] }),
  work: one(works, { fields: [generationJobs.workId], references: [works.id] }),
  draft: one(drafts, { fields: [generationJobs.draftId], references: [drafts.id] }),
  outputChapter: one(chapters, { fields: [generationJobs.outputChapterId], references: [chapters.id] }),
  costLogs: many(generationCostLogs),
  usageLedger: many(generationUsageLedger),
}));

export const generationCostLogsRelations = relations(generationCostLogs, ({ one }) => ({
  user: one(users, { fields: [generationCostLogs.userId], references: [users.id] }),
  work: one(works, { fields: [generationCostLogs.workId], references: [works.id] }),
  job: one(generationJobs, { fields: [generationCostLogs.jobId], references: [generationJobs.id] }),
}));

export const generationUsageLedgerRelations = relations(generationUsageLedger, ({ one }) => ({
  user: one(users, { fields: [generationUsageLedger.userId], references: [users.id] }),
  work: one(works, { fields: [generationUsageLedger.workId], references: [works.id] }),
  job: one(generationJobs, { fields: [generationUsageLedger.jobId], references: [generationJobs.id] }),
}));
