import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { GenerationJob } from "../../drizzle/schema";
import {
  createGenerationJob,
  findActiveGenerationJobForTarget,
  findGenerationJobByIdempotencyKey,
  updateGenerationJob,
} from "../db";
import type { GenerationPromptInput } from "./currentEngine";
import { buildGenerationPayload, type GenerationAction } from "./payloadBuilder";
import { getNarrativeUsageState, reserveNarrativeCredits } from "./usageLimiter";
import { scheduleGenerationWorker } from "./worker";
import { selectGenerationEngine } from "./engineConfig";

export type CreateGenerationJobInput = {
  draftId?: number | null;
  chapterId?: number | null;
  action?: GenerationAction;
  generationMode?: "standard" | "premium";
  requestedMaxOutputWords?: number | null;
  idempotencyKey?: string | null;
  legacyPromptInput?: GenerationPromptInput | null;
};

function defaultIdempotencyKey(userId: number, workId: number, input: CreateGenerationJobInput) {
  if (input.idempotencyKey?.trim()) return input.idempotencyKey.trim();
  const target = input.chapterId ? `chapter:${input.chapterId}` : `draft:${input.draftId ?? "none"}`;
  return `${userId}:${workId}:${target}:${input.action ?? "generate"}:${randomUUID()}`;
}

function serializeJob(job: GenerationJob) {
  return {
    jobId: job.publicId,
    engine: job.engine,
    status: job.status,
    progressMessage: job.progressMessage,
    // errorCode/errorMessage agora viajam pro client. Antes ficavam só no
    // banco e a UI tentava adivinhar a falha pelo `progressMessage`, que é
    // sempre genérico ("Não foi possível concluir..."). Resultado: usuário
    // via "loading sem nada acontecer" porque a tela não tinha como saber
    // se foi audit_invalid_json, audit_provider_timeout, etc.
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    outputChapterId: job.outputChapterId,
    generatedWordCount: job.generatedWordCount,
    requestedMaxOutputWords: job.requestedMaxOutputWords,
    reservedCredits: job.reservedCredits,
    confirmedCredits: job.confirmedCredits,
  };
}

export async function createGenerationJobForUser(args: {
  userId: number;
  workId: number | null;
  input: CreateGenerationJobInput;
}) {
  if (!args.workId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione uma obra ativa antes de gerar." });
  }

  const action = args.input.action ?? "generate";
  // Guard: este fluxo só constrói jobs de narrativa. Auditoria de Consistência
  // tem seu próprio caminho (createConsistencyAuditJobForUser) porque cobra
  // créditos de análise — não narrativos — e não tem rascunho/capítulo de
  // entrada. Quem chega aqui com `consistency_audit` provavelmente é um retry
  // do router de generationJobs reusando job.action sem distinguir.
  if (action === "consistency_audit") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Jobs de auditoria devem ser criados via createConsistencyAuditJobForUser.",
    });
  }
  if (action === "narrative_improvements") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Jobs de melhorias devem ser criados via createNarrativeImprovementsJobForUser.",
    });
  }
  const idempotencyKey = defaultIdempotencyKey(args.userId, args.workId, args.input);
  const existing = await findGenerationJobByIdempotencyKey(args.userId, idempotencyKey);
  if (existing) return { job: existing, response: serializeJob(existing), reused: true };

  const active = await findActiveGenerationJobForTarget(args.userId, args.workId, {
    draftId: args.input.draftId ?? null,
    chapterId: args.input.chapterId ?? null,
  });
  if (active) {
    scheduleGenerationWorker();
    return { job: active, response: serializeJob(active), reused: true };
  }

  const usage = await getNarrativeUsageState(args.userId);
  let engine: ReturnType<typeof selectGenerationEngine>;
  try {
    engine = selectGenerationEngine({ planTier: usage.planTier, task: action });
  } catch (error) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error instanceof Error ? error.message : "Motor de geração indisponível.",
    });
  }
  const payload = await buildGenerationPayload({
    userId: args.userId,
    workId: args.workId,
    draftId: args.input.draftId ?? null,
    chapterId: args.input.chapterId ?? null,
    action,
    generationMode: args.input.generationMode ?? "standard",
    requestedMaxOutputWords: args.input.requestedMaxOutputWords,
    planTier: usage.planTier,
    remainingNarrativeCredits: usage.remainingNarrativeCredits,
    legacyPromptInput: args.input.legacyPromptInput ?? null,
  });

  const timestamp = new Date();
  let job = await createGenerationJob({
    publicId: `gen_${randomUUID().replace(/-/g, "")}`,
    idempotencyKey,
    userId: args.userId,
    workId: args.workId,
    draftId: args.input.draftId ?? null,
    chapterId: args.input.chapterId ?? null,
    outputChapterId: null,
    action,
    generationMode: args.input.generationMode ?? "standard",
    planTier: usage.planTier,
    engine,
    fallbackEngine: null,
    status: "queued",
    progressMessage: engine.startsWith("deepseek")
      ? "Seu capítulo entrou na fila da DeepSeek."
      : "Seu capítulo entrou na fila de geração.",
    inputSnapshot: payload.inputSnapshot,
    outputText: null,
    draftVersion: payload.draftVersion,
    chapterVersion: payload.chapterVersion,
    requestedMaxOutputWords: payload.requestedMaxOutputWords,
    generatedWordCount: 0,
    reservedCredits: 0,
    reservedMonthlyCredits: 0,
    reservedExtraCredits: 0,
    confirmedCredits: 0,
    confirmedMonthlyCredits: 0,
    confirmedExtraCredits: 0,
    releasedCredits: 0,
    attempts: 0,
    maxAttempts: 2,
    lockedAt: null,
    lockedBy: null,
    lockExpiresAt: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  try {
    job = await reserveNarrativeCredits(job, payload.requestedMaxOutputWords);
  } catch (error) {
    await updateGenerationJob(job.id, {
      status: "failed",
      progressMessage: "Não foi possível reservar créditos narrativos para esta geração.",
      errorCode: "reserve_failed",
      errorMessage: error instanceof Error ? error.message : "Falha ao reservar créditos.",
      completedAt: new Date(),
    });
    throw error;
  }

  scheduleGenerationWorker();
  return { job, response: serializeJob(job), reused: false };
}

export { serializeJob as serializeGenerationJob };


