import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { GenerationJob } from "../../drizzle/schema";
import {
  createGenerationJob,
  findActiveGenerationJobForTarget,
  findGenerationJobByIdempotencyKey,
  getWorkById,
  updateGenerationJob,
} from "../db";
import { countAnalysisWords } from "./analysisSource";
import {
  canRunNarrativeImprovements,
  NARRATIVE_IMPROVEMENTS_PLAN_REQUIRED_MESSAGE,
} from "./planConfig";
import {
  getAnalysisUsageState,
  reserveImprovementCredits,
} from "./usageLimiter";
import { scheduleGenerationWorker } from "./worker";

/**
 * Cria um job de Melhorias Narrativas.
 *
 * Espelha createConsistencyAuditJobForUser estruturalmente, mas:
 *  - action = "narrative_improvements"
 *  - usa reserveImprovementCredits (mesmo cofre, ledger rotulado diferente)
 *  - mensagem de plano gated faz referência a Melhorias
 *
 * Cobrança = wordCount do livro UMA vez, igual à Auditoria. O pipeline interno
 * pode fazer N chamadas ao LLM — isso é custo operacional, não multiplica a
 * cobrança ao autor.
 */
export async function createNarrativeImprovementsJobForUser(args: {
  userId: number;
  workId: number | null;
  idempotencyKey?: string | null;
}): Promise<{ job: GenerationJob; reused: boolean }> {
  if (!args.workId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione uma obra antes de pedir melhorias." });
  }

  const idempotencyKey = (args.idempotencyKey?.trim() && args.idempotencyKey.trim())
    || `${args.userId}:${args.workId}:narrative_improvements:${randomUUID()}`;

  const existing = await findGenerationJobByIdempotencyKey(args.userId, idempotencyKey);
  if (existing) return { job: existing, reused: true };

  const active = await findActiveGenerationJobForTarget(args.userId, args.workId, {});
  if (active && active.action === "narrative_improvements") {
    scheduleGenerationWorker();
    return { job: active, reused: true };
  }

  const usage = await getAnalysisUsageState(args.userId);
  if (!canRunNarrativeImprovements(usage.planTier)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: NARRATIVE_IMPROVEMENTS_PLAN_REQUIRED_MESSAGE,
    });
  }

  const work = await getWorkById(args.workId, args.userId);
  if (!work) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada." });
  }
  // Conta palavras de capítulos OU referências (upload integral). Antes só
  // lia chapters e ignorava o livro subido como referência.
  const wordCount = await countAnalysisWords({ userId: args.userId, workId: args.workId });
  const chapterCount = wordCount > 0 ? 1 : 0;
  if (wordCount <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Sua obra ainda não tem texto suficiente pra análise editorial. Suba o livro como referência ou gere capítulos primeiro.",
    });
  }

  if (usage.remainingAnalysisCredits < wordCount) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Sem créditos de análise suficientes. Esta análise editorial precisa de ${wordCount.toLocaleString("pt-BR")} créditos; você tem ${usage.remainingAnalysisCredits.toLocaleString("pt-BR")} no plano ${usage.planTier}.`,
    });
  }

  const timestamp = new Date();
  const snapshot = JSON.stringify({
    action: "narrative_improvements",
    workId: args.workId,
    wordCount,
    chapterCount,
  });

  let job = await createGenerationJob({
    publicId: `imp_${randomUUID().replace(/-/g, "")}`,
    idempotencyKey,
    userId: args.userId,
    workId: args.workId,
    draftId: null,
    chapterId: null,
    outputChapterId: null,
    action: "narrative_improvements",
    generationMode: "standard",
    planTier: usage.planTier,
    // Como na Auditoria: "current" só satisfaz o enum existente — o engine
    // real é roteado por ENV.auditProvider dentro de improvementsEngine.ts.
    engine: "current",
    fallbackEngine: null,
    status: "queued",
    progressMessage: "Sua análise editorial entrou na fila — leitura integral começa em instantes.",
    inputSnapshot: snapshot,
    outputText: null,
    draftVersion: null,
    chapterVersion: null,
    requestedMaxOutputWords: 0,
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
    job = await reserveImprovementCredits(job, wordCount);
  } catch (error) {
    await updateGenerationJob(job.id, {
      status: "failed",
      progressMessage: "Não foi possível reservar créditos de análise.",
      errorCode: "improvements_insufficient_analysis_credits",
      errorMessage: error instanceof Error ? error.message : "Falha ao reservar créditos.",
      completedAt: new Date(),
    });
    throw error;
  }

  scheduleGenerationWorker();
  return { job, reused: false };
}

export type ImprovementJobSnapshot = {
  action: "narrative_improvements";
  workId: number;
  wordCount: number;
  chapterCount: number;
};

export function parseImprovementJobSnapshot(snapshot: string | null | undefined): ImprovementJobSnapshot | null {
  if (!snapshot) return null;
  try {
    const parsed = JSON.parse(snapshot) as Partial<ImprovementJobSnapshot>;
    if (parsed.action !== "narrative_improvements") return null;
    if (typeof parsed.workId !== "number") return null;
    return {
      action: "narrative_improvements",
      workId: parsed.workId,
      wordCount: Number(parsed.wordCount ?? 0),
      chapterCount: Number(parsed.chapterCount ?? 0),
    };
  } catch {
    return null;
  }
}
