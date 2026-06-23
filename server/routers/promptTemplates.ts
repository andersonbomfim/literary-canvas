import { UserVisibleError } from "@shared/_core/errors";
import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import { createPromptTemplate, deletePromptTemplate, getPromptTemplateById, getPromptTemplatesByUserId, updatePromptTemplate } from '../db';

export const promptTemplatesRouter = router({
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), description: z.string().optional(), template: z.string().min(1), variables: z.array(z.string()).optional(), category: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const template = await createPromptTemplate(ctx.user!.id, {
        name: input.name,
        description: input.description,
        template: input.template,
        variables: input.variables ? JSON.stringify(input.variables) : null,
        category: input.category,
        workId: ctx.activeWorkId,
      }, ctx.activeWorkId);
      return { success: true, data: template };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const templates = await getPromptTemplatesByUserId(ctx.user!.id, ctx.activeWorkId);
    return { success: true, data: templates };
  }),

  getById: protectedProcedure.input(z.object({ templateId: z.number() })).query(async ({ input, ctx }) => {
    const template = await getPromptTemplateById(input.templateId, ctx.user!.id, ctx.activeWorkId);
    if (!template) throw new UserVisibleError('Modelo de prompt não encontrado.');
    return { success: true, data: template };
  }),

  update: protectedProcedure
    .input(z.object({ templateId: z.number(), name: z.string().optional(), description: z.string().optional(), template: z.string().optional(), variables: z.array(z.string()).optional(), category: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { templateId, ...rest } = input;
      const updated = await updatePromptTemplate(templateId, ctx.user!.id, {
        ...rest,
        variables: rest.variables ? JSON.stringify(rest.variables) : undefined,
      }, ctx.activeWorkId);
      return { success: true, data: updated };
    }),

  delete: protectedProcedure.input(z.object({ templateId: z.number() })).mutation(async ({ input, ctx }) => {
    await deletePromptTemplate(input.templateId, ctx.user!.id, ctx.activeWorkId);
    return { success: true, message: 'Template deleted' };
  }),
});
