import { z } from 'zod';
import { UserVisibleError } from '@shared/_core/errors';
import { protectedProcedure, router } from '../_core/trpc';
import { createWork, getWorkById, listTrashedWorks, listWorksByUserId, permanentDeleteWork, restoreWork, setDefaultWork, softDeleteWork, updateWork } from '../db';

// Status que bloqueiam edição de conteúdo (capa/título/descrição). O usuário
// ainda pode mudar o `status` em si (reativando a obra) — só não pode editar
// metadata enquanto pausada/arquivada, igual ao que `ensureWritableWork` faz
// em drafts/chapters/library.
const READ_ONLY_STATUSES = new Set(['paused', 'archived', 'completed']);

export const worksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const works = await listWorksByUserId(ctx.user!.id);
    const inactiveStatuses = new Set(['paused', 'completed', 'archived']);
    const visibleWorks = works.filter((w) => !w.deletedAt);
    // Prefer a non-paused default work; fall back to any visible default or first visible work
    const markedDefault = visibleWorks.find((work) => work.isDefault === 'true') ?? null;
    const activeWorks = visibleWorks.filter((w) => !inactiveStatuses.has(w.status || ''));
    const defaultWork =
      (markedDefault && !inactiveStatuses.has(markedDefault.status || '') ? markedDefault : null)
      ?? activeWorks[0]
      ?? markedDefault
      ?? visibleWorks[0]
      ?? null;
    return { success: true, data: visibleWorks, defaultWorkId: defaultWork?.id ?? null };
  }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1, 'Título obrigatório'),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      genre: z.string().optional(),
      // ~5.5MB acomoda inflate base64 (data:image/...;base64,...) de imagens
      // originais até ~3MB no cliente. Tem que estar abaixo do body-size do
      // express.json em _core/index.ts (configurado em ~6MB).
      coverImage: z.string().max(5_500_000).optional(),
      coverPositionX: z.number().int().min(0).max(100).optional(),
      coverPositionY: z.number().int().min(0).max(100).optional(),
      coverScale: z.number().int().min(100).max(180).optional(),
      status: z.enum(['planning', 'in_progress', 'paused', 'completed', 'archived']).optional(),
      seriesId: z.number().nullable().optional(),
      bookNumber: z.number().int().positive().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const work = await createWork(ctx.user!.id, input);
      return { success: true, data: work };
    }),

  update: protectedProcedure
    .input(z.object({
      workId: z.number(),
      title: z.string().min(1).optional(),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      genre: z.string().optional(),
      // ~5.5MB acomoda inflate base64 (data:image/...;base64,...) de imagens
      // originais até ~3MB no cliente. Tem que estar abaixo do body-size do
      // express.json em _core/index.ts (configurado em ~6MB).
      coverImage: z.string().max(5_500_000).optional(),
      coverPositionX: z.number().int().min(0).max(100).optional(),
      coverPositionY: z.number().int().min(0).max(100).optional(),
      coverScale: z.number().int().min(100).max(180).optional(),
      status: z.enum(['planning', 'in_progress', 'paused', 'completed', 'archived']).optional(),
      seriesId: z.number().nullable().optional(),
      bookNumber: z.number().int().positive().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { workId, ...rest } = input;
      // Guard: obras pausadas/arquivadas/completadas não aceitam edição de
      // conteúdo (capa, título, etc) — só mudança de status pra reativar.
      // Mantém paridade com drafts/chapters/library que já passam por
      // ensureWritableWork.
      const isStatusOnlyChange = Object.keys(rest).every((key) => key === 'status');
      if (!isStatusOnlyChange) {
        const current = await getWorkById(workId, ctx.user!.id);
        if (current && READ_ONLY_STATUSES.has(current.status || '')) {
          throw new UserVisibleError(
            'Esta obra está pausada/arquivada/concluída. Reative antes de editar.',
          );
        }
      }
      const work = await updateWork(workId, ctx.user!.id, rest);
      return { success: true, data: work };
    }),

  setDefault: protectedProcedure
    .input(z.object({ workId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const work = await setDefaultWork(ctx.user!.id, input.workId);
      return { success: true, data: work };
    }),

  listTrash: protectedProcedure.query(async ({ ctx }) => {
    const works = await listTrashedWorks(ctx.user!.id);
    return { success: true, data: works };
  }),

  softDelete: protectedProcedure
    .input(z.object({ workId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const work = await softDeleteWork(input.workId, ctx.user!.id);
      return { success: true, data: work };
    }),

  restore: protectedProcedure
    .input(z.object({ workId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const work = await restoreWork(input.workId, ctx.user!.id);
      return { success: true, data: work };
    }),

  permanentDelete: protectedProcedure
    .input(z.object({ workId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await permanentDeleteWork(input.workId, ctx.user!.id);
      return { success: true };
    }),
});
