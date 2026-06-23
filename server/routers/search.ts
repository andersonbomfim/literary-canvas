import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import { getUserLibraryEntries, searchChaptersByContent, searchDraftsByContent, searchLibraryEntriesBroad } from '../db';
import { ensureReadableWork } from '../_core/workGuard';

function snippet(text: string | null | undefined, query: string) {
  if (!text) return '';
  const normalized = text.toLowerCase();
  const idx = normalized.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 180);
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + query.length + 120);
  return text.slice(start, end).trim();
}

export const searchRouter = router({
  searchLibrary: protectedProcedure
    .input(z.object({ query: z.string().min(2), type: z.enum(['character', 'event', 'location', 'aura', 'society']).optional(), limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input, ctx }) => {
      if (!ctx.activeWorkId) return { success: true, results: [] };
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const entries = await searchLibraryEntriesBroad(ctx.user!.id, input.query, input.type, input.limit, ctx.activeWorkId);
      return {
        success: true,
        results: entries.map((entry) => ({
          id: entry.id,
          type: entry.type,
          name: entry.name,
          status: entry.status,
          snippet: snippet(entry.description || entry.details || '', input.query),
        })),
      };
    }),

  searchContent: protectedProcedure
    .input(z.object({ query: z.string().min(2), contentType: z.enum(['chapters', 'drafts']).default('chapters'), limit: z.number().int().min(1).max(20).default(5) }))
    .query(async ({ input, ctx }) => {
      if (!ctx.activeWorkId) return { success: true, query: input.query, results: [] };
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const rows = input.contentType === 'chapters'
         ? await searchChaptersByContent(ctx.user!.id, input.query, input.limit, ctx.activeWorkId)
        : await searchDraftsByContent(ctx.user!.id, input.query, input.limit, ctx.activeWorkId);

      return {
        success: true,
        query: input.query,
        results: rows.map((row) => ({
          id: row.id,
          title: row.title,
          snippet: snippet((row as any).content || (row as any).summary || '', input.query),
          updatedAt: row.updatedAt,
          status: (row as any).status,
        })),
      };
    }),

  getSuggestions: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeWorkId) {
      return {
        success: true,
        suggestions: [
          'Crie ou selecione uma obra antes de pesquisar o cânone.',
        ],
      };
    }
    await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
    const entries = await getUserLibraryEntries(ctx.user!.id, undefined, ctx.activeWorkId);
    const names = entries.slice(0, 5).map((entry) => entry.name);
    return {
      success: true,
      suggestions: names.length ? names.map((name) => `Onde ${name} aparece`) : [
        'Quais são os personagens principais',
        'Quais eventos já estão definidos',
        'Que locais fazem parte do cânone',
        'Quais capítulos já foram escritos',
        'Quais regras do universo estão salvas',
      ],
    };
  }),
});
