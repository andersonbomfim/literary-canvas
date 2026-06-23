import { UserVisibleError } from "@shared/_core/errors";
import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import { createChapterVersion, getChapterById, getChapterVersion, getChapterVersions, updateChapter } from '../db';

function validateVersion(version: Awaited<ReturnType<typeof getChapterVersion>>, chapterId: number, userId: number) {
  if (!version) throw new UserVisibleError('Versão não encontrada.');
  if (version.chapterId !== chapterId || version.userId !== userId) throw new UserVisibleError('Você não tem permissão para acessar esta versão.');
  return version;
}

export const versionsRouter = router({
  list: protectedProcedure.input(z.object({ chapterId: z.number() })).query(async ({ input, ctx }) => {
    const chapter = await getChapterById(input.chapterId, ctx.user!.id, ctx.activeWorkId);
    if (!chapter) throw new UserVisibleError('Capítulo não encontrado.');
    const versions = await getChapterVersions(input.chapterId);
    return { success: true, data: versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, changeDescription: v.changeDescription, createdAt: v.createdAt, contentLength: v.content.length })) };
  }),

  getVersion: protectedProcedure.input(z.object({ versionId: z.number(), chapterId: z.number().optional() })).query(async ({ input, ctx }) => {
    const version = await getChapterVersion(input.versionId);
    const chapter = input.chapterId ?? version?.chapterId ?? 0;
    const validated = validateVersion(version, chapter, ctx.user!.id);
    return { success: true, data: { id: validated.id, versionNumber: validated.versionNumber, content: validated.content, changeDescription: validated.changeDescription, createdAt: validated.createdAt } };
  }),

  create: protectedProcedure.input(z.object({ chapterId: z.number(), changeDescription: z.string().optional() })).mutation(async ({ input, ctx }) => {
    const chapter = await getChapterById(input.chapterId, ctx.user!.id, ctx.activeWorkId);
    if (!chapter) throw new UserVisibleError('Capítulo não encontrado.');
    const version = await createChapterVersion(input.chapterId, ctx.user!.id, chapter.content, input.changeDescription || 'Manual save');
    return { success: true, data: { id: version.id, versionNumber: version.versionNumber, createdAt: version.createdAt } };
  }),

  compare: protectedProcedure.input(z.object({ chapterId: z.number(), versionId1: z.number(), versionId2: z.number() })).query(async ({ input, ctx }) => {
    const chapter = await getChapterById(input.chapterId, ctx.user!.id, ctx.activeWorkId);
    if (!chapter) throw new UserVisibleError('Capítulo não encontrado.');
    const v1 = validateVersion(await getChapterVersion(input.versionId1), input.chapterId, ctx.user!.id);
    const v2 = validateVersion(await getChapterVersion(input.versionId2), input.chapterId, ctx.user!.id);
    const lines1 = v1.content.split('\n');
    const lines2 = v2.content.split('\n');
    return {
      success: true,
      data: {
        version1: { number: v1.versionNumber, lines: lines1.length, words: v1.content.split(/\s+/).filter(Boolean).length },
        version2: { number: v2.versionNumber, lines: lines2.length, words: v2.content.split(/\s+/).filter(Boolean).length },
        changes: {
          linesAdded: Math.max(0, lines2.length - lines1.length),
          linesRemoved: Math.max(0, lines1.length - lines2.length),
          wordsAdded: Math.max(0, v2.content.split(/\s+/).filter(Boolean).length - v1.content.split(/\s+/).filter(Boolean).length),
        },
      },
    };
  }),

  restore: protectedProcedure.input(z.object({ chapterId: z.number(), versionId: z.number() })).mutation(async ({ input, ctx }) => {
    const chapter = await getChapterById(input.chapterId, ctx.user!.id, ctx.activeWorkId);
    if (!chapter) throw new UserVisibleError('Capítulo não encontrado.');
    const version = validateVersion(await getChapterVersion(input.versionId), input.chapterId, ctx.user!.id);
    await createChapterVersion(input.chapterId, ctx.user!.id, chapter.content, `Backup before restore to v${version.versionNumber}`);
    await updateChapter(input.chapterId, ctx.user!.id, { content: version.content, status: 'in_development' }, ctx.activeWorkId);
    return { success: true, message: `Chapter restored to version ${version.versionNumber}` };
  }),
});
