-- PostgreSQL has no MySQL-style ON UPDATE CURRENT_TIMESTAMP column clause.
-- Keep the existing data contract by refreshing updatedAt on every mutation.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER book_series_set_updated_at BEFORE UPDATE ON "bookSeries" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER series_library_entries_set_updated_at BEFORE UPDATE ON "seriesLibraryEntries" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER works_set_updated_at BEFORE UPDATE ON "works" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER drafts_set_updated_at BEFORE UPDATE ON "drafts" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER chapters_set_updated_at BEFORE UPDATE ON "chapters" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER library_entries_set_updated_at BEFORE UPDATE ON "libraryEntries" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER author_profiles_set_updated_at BEFORE UPDATE ON "authorProfiles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER chapter_reviews_set_updated_at BEFORE UPDATE ON "chapterReviews" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER statistics_set_updated_at BEFORE UPDATE ON "statistics" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER characters_set_updated_at BEFORE UPDATE ON "characters" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER prompt_templates_set_updated_at BEFORE UPDATE ON "promptTemplates" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER credit_wallets_set_updated_at BEFORE UPDATE ON "creditWallets" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER user_subscriptions_set_updated_at BEFORE UPDATE ON "userSubscriptions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER generation_jobs_set_updated_at BEFORE UPDATE ON "generationJobs" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
