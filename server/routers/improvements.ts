import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { ensureReadableWork, ensureWritableWork } from "../_core/workGuard";
import {
  getImprovementReportById,
  getImprovementReportByJobId,
  getLatestImprovementReportByWork,
  listImprovementReportsByWork,
} from "../db";
import { createNarrativeImprovementsJobForUser } from "../generation/createImprovementsJob";
import { getAnalysisCoverage, loadAnalysisChapters } from "../generation/analysisSource";
import { sanitizeNarrativeImprovementReportJson } from "../generation/improvementsEngine";
import { scheduleGenerationWorker } from "../generation/worker";

type ImprovementReportRow = NonNullable<Awaited<ReturnType<typeof getLatestImprovementReportByWork>>>;

async function sanitizeReportForResponse(report: ImprovementReportRow | null | undefined, userId: number) {
  if (!report) return null;
  const analysisChapters = await loadAnalysisChapters({ userId, workId: report.workId });
  if (!analysisChapters.length) return report;

  const sanitized = sanitizeNarrativeImprovementReportJson(
    report.suggestionsJson,
    analysisChapters.map((chapter) => ({
      index: chapter.index,
      chapterId: chapter.chapterId,
      title: chapter.title,
      content: chapter.content,
    })),
  );

  if (!sanitized.removed) return report;

  return {
    ...report,
    suggestionsJson: sanitized.suggestionsJson,
    totalSuggestions: sanitized.counts.total,
    criticalCount: sanitized.counts.critical,
    highCount: sanitized.counts.high,
    mediumCount: sanitized.counts.medium,
    lowCount: sanitized.counts.low,
  };
}

/**
 * Router de Melhorias Narrativas.
 *
 * Endpoints:
 *  - `create`     → enfileira novo job de análise editorial (cobra créditos
 *                   de análise, mesma bolsa da Auditoria).
 *  - `latest`     → relatório mais recente da obra ativa (ou null).
 *  - `listByWork` → histórico paginado de relatórios da obra ativa.
 *  - `getById`    → relatório específico por id.
 *  - `getByJobId` → relatório associado a um jobId público — útil pro client
 *                   exibir o resultado após o worker concluir.
 *
 * Todas as queries respeitam workGuard, então uma obra
 * pausada/arquivada/completada continua legível (só não aceita nova análise).
 */
export const improvementsRouter = router({
  create: protectedProcedure
    .input(z.object({ idempotencyKey: z.string().min(1).max(255).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const { job, reused } = await createNarrativeImprovementsJobForUser({
        userId: ctx.user!.id,
        workId: ctx.activeWorkId,
        idempotencyKey: input?.idempotencyKey ?? null,
      });
      scheduleGenerationWorker();
      return {
        success: true,
        data: {
          jobId: job.publicId,
          status: job.status,
          reused,
        },
      };
    }),

  latest: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeWorkId) return { success: true, data: null };
    await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
    const report = await getLatestImprovementReportByWork(ctx.activeWorkId, ctx.user!.id);
    return { success: true, data: await sanitizeReportForResponse(report, ctx.user!.id) };
  }),

  sourceCoverage: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeWorkId) return { success: true, data: null };
    await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
    return {
      success: true,
      data: await getAnalysisCoverage({
        userId: ctx.user!.id,
        workId: ctx.activeWorkId,
      }),
    };
  }),

  listByWork: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(10),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      if (!ctx.activeWorkId) return { success: true, data: [] };
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const limit = input?.limit ?? 10;
      const offset = input?.offset ?? 0;
      const rows = await listImprovementReportsByWork(ctx.activeWorkId, ctx.user!.id, { limit, offset });
      return {
        success: true,
        data: await Promise.all(rows.map((row) => sanitizeReportForResponse(row, ctx.user!.id))),
      };
    }),

  getById: protectedProcedure
    .input(z.object({ reportId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const report = await getImprovementReportById(input.reportId, ctx.user!.id);
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Relatório de melhorias não encontrado." });
      await ensureReadableWork(ctx.user!.id, report.workId);
      return { success: true, data: await sanitizeReportForResponse(report, ctx.user!.id) };
    }),

  getByJobId: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      // jobId aqui é o publicId — o report guarda em `publicJobId`. Pra
      // manter a interface simétrica com auditoria (que usa numeric id),
      // o consumidor passa publicId e o router faz a tradução. Como o
      // helper de DB filtra por número, usamos a busca por publicJobId
      // direto via lista paginada da obra ativa.
      if (!ctx.activeWorkId) {
        return { success: true, data: null };
      }
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const rows = await listImprovementReportsByWork(ctx.activeWorkId, ctx.user!.id, { limit: 50 });
      const report = rows.find((row) => row.publicJobId === input.jobId);
      if (!report) {
        // Não encontrado ainda — pode ser que o worker ainda esteja rodando.
        // Devolvemos null em vez de 404 pra cliente poder polar sem erro.
        return { success: true, data: null };
      }
      // Defesa adicional: também buscar por jobId numérico interno via
      // getImprovementReportByJobId se quiser, mas com publicJobId no
      // resultado já é suficiente.
      void getImprovementReportByJobId;
      return { success: true, data: await sanitizeReportForResponse(report, ctx.user!.id) };
    }),
});
