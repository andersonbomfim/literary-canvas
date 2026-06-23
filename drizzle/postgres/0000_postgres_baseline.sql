CREATE TABLE "auditLogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorId" integer NOT NULL,
	"actorEmail" varchar(320),
	"action" varchar(80) NOT NULL,
	"targetType" varchar(64),
	"targetId" integer,
	"metadata" text,
	"ipAddress" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditReports" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"publicJobId" varchar(64) NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer NOT NULL,
	"wordCount" integer NOT NULL,
	"analysisCreditsCharged" integer NOT NULL,
	"strategy" varchar(64) NOT NULL,
	"engine" varchar(64) NOT NULL,
	"totalIssues" integer DEFAULT 0 NOT NULL,
	"criticalCount" integer DEFAULT 0 NOT NULL,
	"highCount" integer DEFAULT 0 NOT NULL,
	"mediumCount" integer DEFAULT 0 NOT NULL,
	"lowCount" integer DEFAULT 0 NOT NULL,
	"issuesJson" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorProfiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"narrativeStyle" text,
	"keyElements" text,
	"characterVoices" text,
	"negativeRules" text,
	"keyChapters" text,
	"storyFoundation" text,
	"continuityMemories" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookSeries" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"genre" varchar(120),
	"universeNotes" text,
	"status" varchar(64) DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapterReviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"chapterId" integer NOT NULL,
	"userId" integer NOT NULL,
	"comments" text,
	"alerts" text,
	"revisionBrief" text,
	"revisionFixCount" integer DEFAULT 0 NOT NULL,
	"status" varchar(64) DEFAULT 'pending',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapterVersions" (
	"id" serial PRIMARY KEY NOT NULL,
	"chapterId" integer NOT NULL,
	"userId" integer NOT NULL,
	"content" text NOT NULL,
	"versionNumber" integer NOT NULL,
	"changeDescription" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"draftId" integer,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"bookNumber" integer,
	"chapterNumber" integer,
	"status" varchar(64) DEFAULT 'in_development',
	"generationPrompt" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"name" varchar(255) NOT NULL,
	"history" text NOT NULL,
	"personality" text,
	"physicalDescription" text,
	"role" varchar(100),
	"appearance" varchar(100),
	"family" text,
	"birthDate" varchar(100),
	"speechStyle" text,
	"psychologicalProfile" text,
	"backstory" text,
	"motivations" text,
	"relationships" text,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creditLedgerEntries" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"type" varchar(64) NOT NULL,
	"amount" integer NOT NULL,
	"balanceAfter" integer NOT NULL,
	"reason" varchar(255) NOT NULL,
	"reference" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creditWallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"sceneLocation" varchar(255),
	"bookReference" varchar(255),
	"chapterNumber" varchar(50),
	"mainCharacters" text,
	"summary" text,
	"untouchableDialogue" text,
	"untouchableScenes" text,
	"canonicalFacts" text,
	"notes" text,
	"status" varchar(64) DEFAULT 'draft',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generationCostLogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"publicJobId" varchar(64) NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"engine" varchar(80) NOT NULL,
	"fallbackEngine" varchar(80),
	"startedAt" timestamp,
	"finishedAt" timestamp,
	"durationSeconds" integer DEFAULT 0 NOT NULL,
	"inputWordCount" integer DEFAULT 0 NOT NULL,
	"outputWordCount" integer DEFAULT 0 NOT NULL,
	"inputCharCount" integer DEFAULT 0 NOT NULL,
	"outputCharCount" integer DEFAULT 0 NOT NULL,
	"providerRequestId" varchar(255),
	"fallbackUsed" integer DEFAULT 0 NOT NULL,
	"estimatedCostUsd" varchar(32),
	"status" varchar(64) NOT NULL,
	"errorCode" varchar(120),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generationJobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"publicId" varchar(64) NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"draftId" integer,
	"chapterId" integer,
	"outputChapterId" integer,
	"action" varchar(64) DEFAULT 'generate' NOT NULL,
	"generationMode" varchar(64) DEFAULT 'standard' NOT NULL,
	"planTier" varchar(64) DEFAULT 'free' NOT NULL,
	"engine" varchar(64) DEFAULT 'current' NOT NULL,
	"fallbackEngine" varchar(64),
	"status" varchar(64) DEFAULT 'queued' NOT NULL,
	"progressMessage" varchar(500) NOT NULL,
	"inputSnapshot" text,
	"outputText" text,
	"draftVersion" integer,
	"chapterVersion" integer,
	"requestedMaxOutputWords" integer DEFAULT 0 NOT NULL,
	"generatedWordCount" integer DEFAULT 0 NOT NULL,
	"reservedCredits" integer DEFAULT 0 NOT NULL,
	"reservedMonthlyCredits" integer DEFAULT 0 NOT NULL,
	"reservedExtraCredits" integer DEFAULT 0 NOT NULL,
	"confirmedCredits" integer DEFAULT 0 NOT NULL,
	"confirmedMonthlyCredits" integer DEFAULT 0 NOT NULL,
	"confirmedExtraCredits" integer DEFAULT 0 NOT NULL,
	"releasedCredits" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 2 NOT NULL,
	"lockedAt" timestamp,
	"lockedBy" varchar(120),
	"lockExpiresAt" timestamp,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"canceledAt" timestamp,
	"errorCode" varchar(120),
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generationUsageLedger" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"publicJobId" varchar(64) NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"usageType" varchar(64) DEFAULT 'narrative_generation' NOT NULL,
	"source" varchar(64) NOT NULL,
	"type" varchar(64) NOT NULL,
	"amount" integer NOT NULL,
	"balanceAfter" integer,
	"reason" varchar(255) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "improvementReports" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"publicJobId" varchar(64) NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer NOT NULL,
	"wordCount" integer NOT NULL,
	"analysisCreditsCharged" integer NOT NULL,
	"strategy" varchar(64) NOT NULL,
	"engine" varchar(64) NOT NULL,
	"totalSuggestions" integer DEFAULT 0 NOT NULL,
	"criticalCount" integer DEFAULT 0 NOT NULL,
	"highCount" integer DEFAULT 0 NOT NULL,
	"mediumCount" integer DEFAULT 0 NOT NULL,
	"lowCount" integer DEFAULT 0 NOT NULL,
	"suggestionsJson" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "libraryEntries" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"type" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"details" text,
	"status" varchar(64) DEFAULT 'in_development',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"data" text,
	"isRead" varchar(64) DEFAULT 'false',
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promptTemplates" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"name" varchar(255) NOT NULL,
	"description" text,
	"template" text NOT NULL,
	"variables" text,
	"category" varchar(100),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seriesLibraryEntries" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"seriesId" integer NOT NULL,
	"type" varchar(80) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"details" text,
	"sourceWorkIds" text,
	"confidence" integer DEFAULT 80,
	"status" varchar(64) DEFAULT 'needs_review' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statistics" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"workId" integer,
	"totalChaptersGenerated" integer DEFAULT 0,
	"totalWordsWritten" integer DEFAULT 0,
	"totalCharactersCreated" integer DEFAULT 0,
	"totalEventsCreated" integer DEFAULT 0,
	"totalLocationsCreated" integer DEFAULT 0,
	"lastGenerationDate" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userSubscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"planCode" varchar(64) DEFAULT 'none' NOT NULL,
	"planTier" varchar(64) DEFAULT 'free' NOT NULL,
	"status" varchar(64) DEFAULT 'none' NOT NULL,
	"renewsAt" timestamp,
	"creditAllowance" integer DEFAULT 0 NOT NULL,
	"monthlyNarrativeCreditLimit" integer DEFAULT 5000 NOT NULL,
	"monthlyNarrativeCreditsUsed" integer DEFAULT 0 NOT NULL,
	"monthlyNarrativeCreditsReserved" integer DEFAULT 0 NOT NULL,
	"extraNarrativeCredits" integer DEFAULT 0 NOT NULL,
	"extraNarrativeCreditsReserved" integer DEFAULT 0 NOT NULL,
	"monthlyAnalysisCreditLimit" integer DEFAULT 0 NOT NULL,
	"monthlyAnalysisCreditsUsed" integer DEFAULT 0 NOT NULL,
	"monthlyAnalysisCreditsReserved" integer DEFAULT 0 NOT NULL,
	"extraAnalysisCredits" integer DEFAULT 0 NOT NULL,
	"extraAnalysisCreditsReserved" integer DEFAULT 0 NOT NULL,
	"billingCycleStart" timestamp,
	"billingCycleEnd" timestamp,
	"monthlyInspirationUsed" integer DEFAULT 0 NOT NULL,
	"monthlyTextReviewUsed" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"passwordHash" text,
	"resetTokenHash" text,
	"resetTokenExpiresAt" timestamp,
	"failedLoginCount" integer DEFAULT 0 NOT NULL,
	"lockedUntil" timestamp,
	"role" varchar(64) DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"seriesId" integer,
	"bookNumber" integer,
	"title" varchar(255) NOT NULL,
	"subtitle" varchar(255),
	"description" text,
	"genre" varchar(120),
	"coverImage" text,
	"coverPositionX" integer DEFAULT 50,
	"coverPositionY" integer DEFAULT 50,
	"coverScale" integer DEFAULT 100,
	"status" varchar(64) DEFAULT 'planning' NOT NULL,
	"isDefault" varchar(64) DEFAULT 'false' NOT NULL,
	"deletedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_auditLogs_actor" ON "auditLogs" USING btree ("actorId");--> statement-breakpoint
CREATE INDEX "idx_auditLogs_created" ON "auditLogs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_auditLogs_action" ON "auditLogs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_auditReports_userId" ON "auditReports" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_auditReports_workId" ON "auditReports" USING btree ("workId");--> statement-breakpoint
CREATE INDEX "idx_auditReports_jobId" ON "auditReports" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "idx_auditReports_created" ON "auditReports" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_bookSeries_userId" ON "bookSeries" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_chapterReviews_chapterId" ON "chapterReviews" USING btree ("chapterId");--> statement-breakpoint
CREATE INDEX "idx_chapterReviews_userId" ON "chapterReviews" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_chapterVersions_chapterId" ON "chapterVersions" USING btree ("chapterId");--> statement-breakpoint
CREATE INDEX "idx_chapters_userId" ON "chapters" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_chapters_workId" ON "chapters" USING btree ("workId");--> statement-breakpoint
CREATE INDEX "idx_chapters_draftId" ON "chapters" USING btree ("draftId");--> statement-breakpoint
CREATE INDEX "idx_characters_userId" ON "characters" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_characters_workId" ON "characters" USING btree ("workId");--> statement-breakpoint
CREATE INDEX "idx_creditLedgerEntries_userId" ON "creditLedgerEntries" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_creditLedgerEntries_user_reference" ON "creditLedgerEntries" USING btree ("userId","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_creditWallets_userId" ON "creditWallets" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_drafts_userId" ON "drafts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_drafts_workId" ON "drafts" USING btree ("workId");--> statement-breakpoint
CREATE INDEX "idx_generationCostLogs_jobId" ON "generationCostLogs" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "idx_generationCostLogs_userId" ON "generationCostLogs" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_generationJobs_publicId" ON "generationJobs" USING btree ("publicId");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_generationJobs_user_idempotency" ON "generationJobs" USING btree ("userId","idempotencyKey");--> statement-breakpoint
CREATE INDEX "idx_generationJobs_user_status" ON "generationJobs" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "idx_generationJobs_work_status" ON "generationJobs" USING btree ("workId","status");--> statement-breakpoint
CREATE INDEX "idx_generationJobs_lock" ON "generationJobs" USING btree ("status","lockExpiresAt");--> statement-breakpoint
CREATE INDEX "idx_generationUsageLedger_jobId" ON "generationUsageLedger" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "idx_generationUsageLedger_userId" ON "generationUsageLedger" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_generationUsageLedger_usageType" ON "generationUsageLedger" USING btree ("usageType");--> statement-breakpoint
CREATE INDEX "idx_improvementReports_userId" ON "improvementReports" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_improvementReports_workId" ON "improvementReports" USING btree ("workId");--> statement-breakpoint
CREATE INDEX "idx_improvementReports_jobId" ON "improvementReports" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "idx_improvementReports_created" ON "improvementReports" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_libraryEntries_userId" ON "libraryEntries" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_libraryEntries_workId" ON "libraryEntries" USING btree ("workId");--> statement-breakpoint
CREATE INDEX "idx_notifications_userId" ON "notifications" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_seriesLibraryEntries_userId" ON "seriesLibraryEntries" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_seriesLibraryEntries_seriesId" ON "seriesLibraryEntries" USING btree ("seriesId");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_userSubscriptions_userId" ON "userSubscriptions" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_works_userId" ON "works" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_works_seriesId" ON "works" USING btree ("seriesId");