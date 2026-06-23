import { protectedProcedure, router } from '../_core/trpc';
import { getBillingSummary, getOrCreateStatistics, getUserChapters, getUserDrafts, getUserLibraryEntries } from '../db';
import { ensureReadableWork } from '../_core/workGuard';

export const statisticsRouter = router({
  getDashboard: protectedProcedure.query(async ({ ctx }) => {
    const billingSummary = await getBillingSummary(ctx.user!.id);
    if (!ctx.activeWorkId) {
      return {
        success: true,
        data: {
          totalChaptersGenerated: 0,
          totalWordsWritten: 0,
          totalCharactersCreated: 0,
          totalEventsCreated: 0,
          totalLocationsCreated: 0,
          lastGenerationDate: null,
          createdAt: new Date(),
          creditsBalance: billingSummary.wallet.balance,
          activePlan: billingSummary.subscription.planCode,
          draftCount: 0,
          libraryCount: 0,
          canonicalChapters: 0,
          inDevelopmentChapters: 0,
        },
      };
    }
    await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
    const [stats, billing, chapters, drafts, entries] = await Promise.all([
      getOrCreateStatistics(ctx.user!.id, ctx.activeWorkId),
      getBillingSummary(ctx.user!.id),
      getUserChapters(ctx.user!.id, ctx.activeWorkId),
      getUserDrafts(ctx.user!.id, ctx.activeWorkId),
      getUserLibraryEntries(ctx.user!.id, undefined, ctx.activeWorkId),
    ]);

    return {
      success: true,
      data: {
        totalChaptersGenerated: stats.totalChaptersGenerated || 0,
        totalWordsWritten: stats.totalWordsWritten || 0,
        totalCharactersCreated: stats.totalCharactersCreated || 0,
        totalEventsCreated: stats.totalEventsCreated || 0,
        totalLocationsCreated: stats.totalLocationsCreated || 0,
        lastGenerationDate: stats.lastGenerationDate,
        createdAt: stats.createdAt,
        creditsBalance: billing.wallet.balance,
        activePlan: billing.subscription.planCode,
        draftCount: drafts.length,
        libraryCount: entries.length,
        canonicalChapters: chapters.filter((item) => item.status === 'canonical').length,
        inDevelopmentChapters: chapters.filter((item) => item.status === 'in_development').length,
      },
    };
  }),
});
