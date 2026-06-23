import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { ensureReadableWork, ensureWritableWork } from "../_core/workGuard";
import {
  getAuditReportById,
  getAuditReportByJobId,
  getLatestAuditReportByWork,
  listAuditReportsByWork,
} from "../db";
import { getAnalysisCoverage } from "../generation/analysisSource";
import { createConsistencyAuditJobForUser } from "../generation/createAuditJob";
import { scheduleGenerationWorker } from "../generation/worker";

/**
 * Router de Auditoria de Consistência Narrativa.
 *
 * Endpoints simétricos ao improvementsRouter — a UI vai consumir os dois
 * lado-a-lado dentro da página da Obra, mas em SEÇÕES SEPARADAS (Auditoria
 * encontra erros, Melhorias sugere fortalecimento).
 */
export const auditRouter = router({
  create: protectedProcedure
    .input(z.object({ idempotencyKey: z.string().min(1).max(255).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const { job, reused } = await createConsistencyAuditJobForUser({
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
    const report = await getLatestAuditReportByWork(ctx.activeWorkId, ctx.user!.id);
    return { success: true, data: report ?? null };
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
      const rows = await listAuditReportsByWork(ctx.activeWorkId, ctx.user!.id, { limit, offset });
      return { success: true, data: rows };
    }),

  getById: protectedProcedure
    .input(z.object({ reportId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const report = await getAuditReportById(input.reportId, ctx.user!.id);
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Relatório de auditoria não encontrado." });
      await ensureReadableWork(ctx.user!.id, report.workId);
      return { success: true, data: report };
    }),

  getByJobId: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      if (!ctx.activeWorkId) return { success: true, data: null };
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const rows = await listAuditReportsByWork(ctx.activeWorkId, ctx.user!.id, { limit: 50 });
      const report = rows.find((row) => row.publicJobId === input.jobId);
      if (!report) return { success: true, data: null };
      void getAuditReportByJobId;
      return { success: true, data: report };
    }),
});
