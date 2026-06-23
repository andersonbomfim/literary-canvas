CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_works_userId` ON `works` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_drafts_userId` ON `drafts` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_drafts_workId` ON `drafts` (`workId`);--> statement-breakpoint
CREATE INDEX `idx_chapters_userId` ON `chapters` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_chapters_workId` ON `chapters` (`workId`);--> statement-breakpoint
CREATE INDEX `idx_chapters_draftId` ON `chapters` (`draftId`);--> statement-breakpoint
CREATE INDEX `idx_libraryEntries_userId` ON `libraryEntries` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_libraryEntries_workId` ON `libraryEntries` (`workId`);--> statement-breakpoint
CREATE INDEX `idx_chapterReviews_chapterId` ON `chapterReviews` (`chapterId`);--> statement-breakpoint
CREATE INDEX `idx_chapterReviews_userId` ON `chapterReviews` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_notifications_userId` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_chapterVersions_chapterId` ON `chapterVersions` (`chapterId`);--> statement-breakpoint
CREATE INDEX `idx_characters_userId` ON `characters` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_characters_workId` ON `characters` (`workId`);
