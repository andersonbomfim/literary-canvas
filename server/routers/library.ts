import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import { countUserLibraryEntries, createLibraryEntry, getUserLibraryEntries, incrementLibraryCount } from '../db';
import { ensureReadableWork, ensureWritableWork } from '../_core/workGuard';

export const libraryRouter = router({
  create: protectedProcedure
    .input(z.object({
      type: z.enum(['character', 'event', 'location', 'aura', 'society']),
      name: z.string().min(1, 'Name required'),
      description: z.string().optional(),
      details: z.string().optional(),
      status: z.enum(['canonical', 'in_development', 'hypothesis', 'discarded']).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const result = await createLibraryEntry(ctx.user!.id, {
        type: input.type,
        name: input.name,
        description: input.description ?? null,
        details: input.details ?? null,
        status: input.status || 'in_development',
        workId: ctx.activeWorkId,
      }, ctx.activeWorkId);

      if (['character', 'event', 'location'].includes(input.type)) {
        await incrementLibraryCount(ctx.user!.id, input.type as 'character' | 'event' | 'location', ctx.activeWorkId);
      }

      return { success: true, data: result };
    }),

  list: protectedProcedure.input(z.object({
    type: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(100),
    offset: z.number().int().min(0).default(0),
  }).optional()).query(async ({ input, ctx }) => {
    if (!ctx.activeWorkId) {
      return { data: [], total: 0, hasMore: false };
    }
    await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
    const limit = input?.limit ?? 100;
    const offset = input?.offset ?? 0;
    const type = input?.type ?? undefined;
    const [data, total] = await Promise.all([
      getUserLibraryEntries(ctx.user!.id, type, ctx.activeWorkId, { limit, offset }),
      countUserLibraryEntries(ctx.user!.id, type, ctx.activeWorkId),
    ]);
    return {
      data,
      total,
      hasMore: offset + limit < total,
    };
  }),

  getByType: protectedProcedure
    .input(z.object({ type: z.enum(['character', 'event', 'location', 'aura', 'society']) }))
    .query(async ({ input, ctx }) => {
      if (!ctx.activeWorkId) return [];
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      return getUserLibraryEntries(ctx.user!.id, input.type, ctx.activeWorkId);
    }),
});
