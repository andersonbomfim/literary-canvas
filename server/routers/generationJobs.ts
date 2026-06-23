import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { ensureReadableWork, ensureWritableWork } from "../_core/workGuard";
import {
  getChapterById,
  getGenerationJobByPublicId,
  listActiveGenerationJobs,
  updateGenerationJob,
} from "../db";
import { createGenerationJobForUser, serializeGenerationJob } from "../generation/createJob";
import { createConsistencyAuditJobForUser } from "../generation/createAuditJob";
import { createNarrativeImprovementsJobForUser } from "../generation/createImprovementsJob";
import { parseGenerationSnapshot } from "../generation/payloadBuilder";
import {
  releaseAnalysisCredits,
  releaseImprovementCredits,
  releaseNarrativeCredits,
} from "../generation/usageLimiter";
import { scheduleGenerationWorker } from "../generation/worker";

const createInputSchema = z.object({
  draftId: z.number().optional(),
  chapterId: z.number().optional(),
  action: z.enum(["generate", "regenerate", "localized_edit"]).optional(),
  generationMode: z.enum(["standard", "premium"]).optional(),
  requestedMaxOutputWords: z.number().int().min(1).optional(),
  idempotencyKey: z.string().min(1).max(255).optional(),
});

async function requireJob(publicId: string, userId: number) {
  const job = await getGenerationJobByPublicId(publicId, userId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job de geração não encontrado." });
  return job;
}

export const generationJobsRouter = router({
  create: protectedProcedure.input(createInputSchema).mutation(async ({ input, ctx }) => {
    await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
    const { response } = await createGenerationJobForUser({
      userId: ctx.user!.id,
      workId: ctx.activeWorkId,
      input,
    });
    scheduleGenerationWorker();
    return { success: true, data: response };
  }),

  get: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).query(async ({ input, ctx }) => {
    const job = await requireJob(input.jobId, ctx.user!.id);
    if (job.workId) await ensureReadableWork(ctx.user!.id, job.workId);
    return { success: true, data: serializeGenerationJob(job) };
  }),

  listActive: protectedProcedure.query(async ({ ctx }) => {
    const rows = await listActiveGenerationJobs(ctx.user!.id, ctx.activeWorkId);
    return { success: true, data: rows.map(serializeGenerationJob) };
  }),

  cancel: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    const job = await requireJob(input.jobId, ctx.user!.id);
    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
      return { success: true, data: serializeGenerationJob(job) };
    }
    if (job.status === "generating" || job.status === "finalizing" || job.startedAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A geração já começou. O cancelamento agora não libera a reserva automaticamente.",
      });
    }

    // Auditoria e Melhorias usam a bolsa de análise (compartilhada); ambas
    // rotuladas diferente no ledger. Geração narrativa usa bolsa narrativa.
    const released = job.action === "consistency_audit"
      ? await releaseAnalysisCredits(job, "Cancelamento antes do motor de auditoria.")
      : job.action === "narrative_improvements"
      ? await releaseImprovementCredits(job, "Cancelamento antes do motor de melhorias.")
      : await releaseNarrativeCredits(job, "Cancelamento antes do motor de geração.");
    const canceled = await updateGenerationJob(job.id, {
      status: "canceled",
      progressMessage: "Geração cancelada antes de começar.",
      canceledAt: new Date(),
      completedAt: new Date(),
      lockExpiresAt: null,
      lockedAt: null,
      lockedBy: null,
      releasedCredits: released.releasedCredits,
    });
    return { success: true, data: serializeGenerationJob(canceled) };
  }),

  retry: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    const job = await requireJob(input.jobId, ctx.user!.id);
    if (job.status !== "failed" && job.status !== "canceled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Apenas jobs com falha ou cancelados podem ser reenviados." });
    }
    if (job.workId) await ensureWritableWork(ctx.user!.id, job.workId);

    // Auditoria e Melhorias usam bolsa de análise — não podem reciclar o
    // caminho narrativo. Cada uma tem seu helper de createJob.
    if (job.action === "consistency_audit") {
      const { job: newJob } = await createConsistencyAuditJobForUser({
        userId: ctx.user!.id,
        workId: job.workId,
        idempotencyKey: `retry:${job.publicId}:${Date.now()}`,
      });
      scheduleGenerationWorker();
      return { success: true, data: serializeGenerationJob(newJob) };
    }

    if (job.action === "narrative_improvements") {
      const { job: newJob } = await createNarrativeImprovementsJobForUser({
        userId: ctx.user!.id,
        workId: job.workId,
        idempotencyKey: `retry:${job.publicId}:${Date.now()}`,
      });
      scheduleGenerationWorker();
      return { success: true, data: serializeGenerationJob(newJob) };
    }

    const snapshot = parseGenerationSnapshot(job.inputSnapshot);
    const { response } = await createGenerationJobForUser({
      userId: ctx.user!.id,
      workId: job.workId,
      input: {
        draftId: job.draftId,
        chapterId: job.chapterId,
        action: job.action,
        generationMode: job.generationMode,
        requestedMaxOutputWords: job.requestedMaxOutputWords,
        idempotencyKey: `retry:${job.publicId}:${Date.now()}`,
        legacyPromptInput: snapshot?.promptInput ?? null,
      },
    });
    scheduleGenerationWorker();
    return { success: true, data: response };
  }),

  result: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).query(async ({ input, ctx }) => {
    const job = await requireJob(input.jobId, ctx.user!.id);
    if (job.status !== "completed" || !job.outputChapterId) {
      return { success: true, data: { job: serializeGenerationJob(job), chapter: null } };
    }
    const chapter = await getChapterById(job.outputChapterId, ctx.user!.id, job.workId);
    return { success: true, data: { job: serializeGenerationJob(job), chapter: chapter ?? null } };
  }),
});
