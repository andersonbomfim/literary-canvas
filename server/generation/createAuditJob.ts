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
  CONSISTENCY_AUDIT_PLAN_REQUIRED_MESSAGE,
  canRunConsistencyAudit,
} from "./planConfig";
import {
  getAnalysisUsageState,
  reserveAnalysisCredits,
} from "./usageLimiter";
import { scheduleGenerationWorker } from "./worker";

/**
 * Cria um job de Auditoria de Consistência Narrativa.
 *
 * Diferente de `createGenerationJobForUser`, este caminho:
 * - usa a bolsa de créditos de ANÁLISE (não narrativos)
 * - cobra wordCount = palavras do livro (uma vez só, mesmo que o pipeline
 *   interno chame o LLM várias vezes)
 * - não constrói GenerationPayload (não há "narrativa" pra gerar; o snapshot
 *   serve só pra observabilidade)
 * - bloqueia o plano Free ANTES de reservar — assim o usuário Free recebe
 *   convite de upgrade em vez de "saldo insuficiente"
 */
export async function createConsistencyAuditJobForUser(args: {
  userId: number;
  workId: number | null;
  idempotencyKey?: string | null;
}): Promise<{ job: GenerationJob; reused: boolean }> {
  if (!args.workId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione uma obra antes de auditar." });
  }

  const idempotencyKey = (args.idempotencyKey?.trim() && args.idempotencyKey.trim())
    || `${args.userId}:${args.workId}:consistency_audit:${randomUUID()}`;

  // Idempotência: se já chamamos com a mesma key, devolve o mesmo job.
  const existing = await findGenerationJobByIdempotencyKey(args.userId, idempotencyKey);
  if (existing) return { job: existing, reused: true };

  // Coalesce: se já existe um job de auditoria ativo pra esta obra, reusa.
  const active = await findActiveGenerationJobForTarget(args.userId, args.workId, {});
  if (active && active.action === "consistency_audit") {
    scheduleGenerationWorker();
    return { job: active, reused: true };
  }

  // Plano: free não pode rodar auditoria.
  const usage = await getAnalysisUsageState(args.userId);
  if (!canRunConsistencyAudit(usage.planTier)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: CONSISTENCY_AUDIT_PLAN_REQUIRED_MESSAGE,
    });
  }

  // Carrega obra e calcula wordCount sobre capítulos OU referências importadas.
  // Antes só lia `chapters`, então uploads integrais (que vão para
  // authorProfile.keyChapters) ficavam invisíveis pra auditoria, dando
  // "Sua obra ainda não tem texto" mesmo com livros de 70k palavras subidos.
  const work = await getWorkById(args.workId, args.userId);
  if (!work) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada." });
  }
  const wordCount = await countAnalysisWords({ userId: args.userId, workId: args.workId });
  const chapterCount = wordCount > 0 ? 1 : 0; // chapterCount real é resolvido no worker
  if (wordCount <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Sua obra ainda não tem texto suficiente pra auditoria. Suba o livro como referência ou gere capítulos primeiro.",
    });
  }

  // Saldo: pré-check rápido pra dar erro amigável antes de criar o job.
  if (usage.remainingAnalysisCredits < wordCount) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Sem créditos de análise suficientes. Esta auditoria precisa de ${wordCount.toLocaleString("pt-BR")} créditos; você tem ${usage.remainingAnalysisCredits.toLocaleString("pt-BR")} no plano ${usage.planTier}.`,
    });
  }

  const timestamp = new Date();
  const snapshot = JSON.stringify({
    action: "consistency_audit",
    workId: args.workId,
    wordCount,
    chapterCount,
  });

  let job = await createGenerationJob({
    publicId: `aud_${randomUUID().replace(/-/g, "")}`,
    idempotencyKey,
    userId: args.userId,
    workId: args.workId,
    draftId: null,
    chapterId: null,
    outputChapterId: null,
    action: "consistency_audit",
    generationMode: "standard",
    planTier: usage.planTier,
    // O motor narrativo NÃO é o motor de auditoria. Usamos "current" só pra
    // satisfazer o enum existente — auditEngine.ts roteia pelo ENV.auditProvider.
    engine: "current",
    fallbackEngine: null,
    status: "queued",
    progressMessage: "Sua auditoria entrou na fila — leitura integral da obra começa em instantes.",
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

  // Reserva os créditos de ANÁLISE (não narrativos). Cobrança = wordCount.
  try {
    job = await reserveAnalysisCredits(job, wordCount);
  } catch (error) {
    await updateGenerationJob(job.id, {
      status: "failed",
      progressMessage: "Não foi possível reservar créditos de análise.",
      errorCode: "audit_insufficient_analysis_credits",
      errorMessage: error instanceof Error ? error.message : "Falha ao reservar créditos.",
      completedAt: new Date(),
    });
    throw error;
  }

  scheduleGenerationWorker();
  return { job, reused: false };
}

export type AuditJobSnapshot = {
  action: "consistency_audit";
  workId: number;
  wordCount: number;
  chapterCount: number;
};

export function parseAuditJobSnapshot(snapshot: string | null | undefined): AuditJobSnapshot | null {
  if (!snapshot) return null;
  try {
    const parsed = JSON.parse(snapshot) as Partial<AuditJobSnapshot>;
    if (parsed.action !== "consistency_audit") return null;
    if (typeof parsed.workId !== "number") return null;
    return {
      action: "consistency_audit",
      workId: parsed.workId,
      wordCount: Number(parsed.wordCount ?? 0),
      chapterCount: Number(parsed.chapterCount ?? 0),
    };
  } catch {
    return null;
  }
}
