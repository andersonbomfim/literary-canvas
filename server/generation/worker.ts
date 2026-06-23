import type { GenerationJob, Work } from "../../drizzle/schema";
import {
  acquireNextGenerationJob,
  createAuditReport,
  createChapter,
  createChapterVersion,
  createGenerationCostLog,
  createImprovementReport,
  createNotification,
  getUserChapters,
  getWorkById,
  updateGenerationJob,
  incrementChapterCount,
  setDraftStatus,
} from "../db";
import { ENV } from "../_core/env";
import { loadAnalysisChapters } from "./analysisSource";
import {
  AuditEngineError,
  type AuditChapterInput,
  type AuditEngineResult,
  aggregateCounts,
  runConsistencyAudit,
} from "./auditEngine";
import {
  ImprovementEngineError,
  type ImprovementChapterInput,
  type ImprovementEngineResult,
  aggregateImprovementCounts,
  runNarrativeImprovements,
} from "./improvementsEngine";
import { parseAuditJobSnapshot } from "./createAuditJob";
import { parseImprovementJobSnapshot } from "./createImprovementsJob";
import { GenerationEngineError, generateWithJobEngine } from "./engines";
import { parseGenerationSnapshot } from "./payloadBuilder";
import {
  confirmAnalysisCredits,
  confirmImprovementCredits,
  confirmNarrativeCredits,
  releaseAnalysisCredits,
  releaseImprovementCredits,
  releaseNarrativeCredits,
} from "./usageLimiter";

const WORKER_ID = `local-worker-${process.pid}`;
const LOCK_MS = 15 * 60 * 1000;
const WORK_STANDBY_STATUSES = new Set(["paused", "completed", "archived"]);
const WORK_STANDBY_LABELS: Record<string, string> = {
  paused: "pausada",
  completed: "concluida",
  archived: "arquivada",
};

type TerminalJobStatus = "failed" | "canceled";

let workerScheduled = false;
let workerRunning = false;

export function scheduleGenerationWorker(delayMs = 50) {
  if (workerScheduled) return;
  workerScheduled = true;
  const timer = setTimeout(async () => {
    workerScheduled = false;
    await drainGenerationWorker();
  }, delayMs);
  timer.unref?.();
}

export function startGenerationWorker() {
  scheduleGenerationWorker(250);
}

export async function drainGenerationWorker(maxJobs = 5) {
  if (workerRunning) return;
  workerRunning = true;
  try {
    for (let index = 0; index < maxJobs; index += 1) {
      const processed = await runGenerationWorkerOnce();
      if (!processed) break;
    }
  } finally {
    workerRunning = false;
  }
}

function secondsBetween(startedAt: Date, finishedAt: Date) {
  return Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
}

function workStandbyMessage(work: Pick<Work, "title" | "status">) {
  const status = WORK_STANDBY_LABELS[work.status || ""] || "em stand by";
  return `A obra "${work.title}" esta ${status}. Retome a obra antes de executar IA.`;
}

function workIsOnStandby(
  work: Pick<Work, "title" | "status"> | null | undefined
): boolean {
  return Boolean(work && WORK_STANDBY_STATUSES.has(work.status || ""));
}

type BlockedWorkGeneration = {
  errorCode: "work_missing" | "work_deleted" | "work_standby";
  message: string;
  progressMessage: string;
  releaseReason: string;
};

async function loadBlockedWorkForGeneration(
  userId: number,
  workId: number | null
): Promise<BlockedWorkGeneration | null> {
  if (!workId) {
    return {
      errorCode: "work_missing",
      message: "Nenhuma obra ativa foi encontrada para este job.",
      progressMessage: "A geracao foi interrompida porque nao ha obra ativa.",
      releaseReason: "Geracao interrompida: obra ausente.",
    };
  }
  const work = await getWorkById(workId, userId);
  if (!work) {
    return {
      errorCode: "work_deleted",
      message: "A obra foi removida ou esta na lixeira. Este job nao pode gravar conteudo.",
      progressMessage: "A geracao foi interrompida porque a obra foi removida.",
      releaseReason: "Geracao interrompida: obra removida ou na lixeira.",
    };
  }
  if (workIsOnStandby(work)) {
    return {
      errorCode: "work_standby",
      message: workStandbyMessage(work),
      progressMessage: "Obra em stand by. A geracao foi interrompida.",
      releaseReason: "Obra em stand by antes de gerar.",
    };
  }
  return null;
}

async function cancelNarrativeJobForBlockedWork(args: {
  job: GenerationJob;
  startedAt: Date;
  inputWordCount: number;
  inputCharCount: number;
  errorCode: BlockedWorkGeneration["errorCode"];
  message: string;
  progressMessage: string;
  releaseReason: string;
}) {
  const completedAt = new Date();
  const canceled = await updateGenerationJob(args.job.id, {
    status: "canceled",
    progressMessage: args.progressMessage,
    errorCode: args.errorCode,
    errorMessage: args.message.slice(0, 5000),
    completedAt,
    canceledAt: completedAt,
    lockExpiresAt: null,
    lockedAt: null,
    lockedBy: null,
  });
  await releaseNarrativeCredits(canceled, args.releaseReason);
  await createGenerationCostLog({
    jobId: args.job.id,
    publicJobId: args.job.publicId,
    userId: args.job.userId,
    workId: args.job.workId,
    engine: args.job.engine,
    fallbackEngine: args.job.fallbackEngine,
    startedAt: args.startedAt,
    finishedAt: completedAt,
    durationSeconds: secondsBetween(args.startedAt, completedAt),
    inputWordCount: args.inputWordCount,
    outputWordCount: 0,
    inputCharCount: args.inputCharCount,
    outputCharCount: 0,
    providerRequestId: null,
    fallbackUsed: 0,
    estimatedCostUsd: null,
    status: "canceled",
    errorCode: args.errorCode,
  });
}

export async function runGenerationWorkerOnce(workerId = WORKER_ID) {
  const job = await acquireNextGenerationJob(workerId, LOCK_MS);
  if (!job) return false;

  if (job.action === "consistency_audit") {
    await runConsistencyAuditJob(job);
    scheduleGenerationWorker(50);
    return true;
  }

  if (job.action === "narrative_improvements") {
    await runNarrativeImprovementsJob(job);
    scheduleGenerationWorker(50);
    return true;
  }

  const startedAt = new Date();
  const isDeepSeek = job.engine.startsWith("deepseek");
  const snapshot = parseGenerationSnapshot(job.inputSnapshot);
  if (!snapshot) {
    const finishedAt = new Date();
    const failed = await updateGenerationJob(job.id, {
      status: "failed",
      progressMessage: "O pacote narrativo deste job está inválido.",
      errorCode: "invalid_snapshot",
      errorMessage: "Input snapshot is missing or malformed.",
      completedAt: finishedAt,
      lockExpiresAt: null,
      lockedAt: null,
      lockedBy: null,
    });
    await releaseNarrativeCredits(failed, "Falha técnica antes de gerar: snapshot inválido.");
    await createGenerationCostLog({
      jobId: job.id,
      publicJobId: job.publicId,
      userId: job.userId,
      workId: job.workId,
      engine: job.engine,
      fallbackEngine: job.fallbackEngine,
      startedAt,
      finishedAt,
      durationSeconds: 0,
      inputWordCount: 0,
      outputWordCount: 0,
      inputCharCount: 0,
      outputCharCount: 0,
      providerRequestId: null,
      fallbackUsed: 0,
      estimatedCostUsd: null,
      status: "failed",
      errorCode: "invalid_snapshot",
    });
    return true;
  }

  const blockedWork = await loadBlockedWorkForGeneration(job.userId, job.workId);
  if (blockedWork) {
    await cancelNarrativeJobForBlockedWork({
      job,
      startedAt,
      inputWordCount: snapshot.inputWordCount,
      inputCharCount: snapshot.promptInput.sceneContext.length,
      errorCode: blockedWork.errorCode,
      message: blockedWork.message,
      progressMessage: blockedWork.progressMessage,
      releaseReason: blockedWork.releaseReason,
    });
    scheduleGenerationWorker(50);
    return true;
  }

  try {
    await updateGenerationJob(job.id, {
      status: "generating",
      progressMessage: isDeepSeek
        ? "A DeepSeek está escrevendo o capítulo com base no rascunho, estilo e contexto da obra."
        : "Estamos gerando seu capítulo com base no rascunho, estilo e contexto da obra.",
      startedAt,
    });

    const result = await generateWithJobEngine(job, snapshot);

    const blockedBeforeSave = await loadBlockedWorkForGeneration(
      job.userId,
      job.workId
    );
    if (blockedBeforeSave) {
      await cancelNarrativeJobForBlockedWork({
        job,
        startedAt,
        inputWordCount: result.inputWordCount,
        inputCharCount: result.inputCharCount,
        errorCode: blockedBeforeSave.errorCode,
        message: blockedBeforeSave.message,
        progressMessage: blockedBeforeSave.progressMessage,
        releaseReason: blockedBeforeSave.releaseReason,
      });
      scheduleGenerationWorker(50);
      return true;
    }

    await updateGenerationJob(job.id, {
      status: "finalizing",
      progressMessage: "Estamos salvando o capítulo e organizando a versão final.",
      outputText: result.content,
      generatedWordCount: result.outputWordCount,
    });

    const chapter = await createChapter(job.userId, {
      title: result.title || "Capítulo provisório",
      content: result.content,
      draftId: job.draftId,
      bookNumber: null,
      chapterNumber: null,
      status: "in_development",
      generationPrompt: result.generationPrompt,
      workId: job.workId,
    }, job.workId);
    await createChapterVersion(chapter.id, job.userId, chapter.content, "Versão inicial gerada por job assíncrono");
    await incrementChapterCount(job.userId, result.outputWordCount, job.workId);
    if (job.draftId) await setDraftStatus(job.draftId, job.userId, "sent_to_writing", job.workId);

    const jobWithOutput = await updateGenerationJob(job.id, {
      outputChapterId: chapter.id,
      outputText: result.content,
      generatedWordCount: result.outputWordCount,
    });
    const confirmedJob = await confirmNarrativeCredits(jobWithOutput, result.outputWordCount);

    const completedAt = new Date();
    await updateGenerationJob(job.id, {
      status: "completed",
      progressMessage: "Capítulo gerado com sucesso.",
      completedAt,
      outputChapterId: chapter.id,
      lockExpiresAt: null,
      lockedAt: null,
      lockedBy: null,
    });
    await createNotification(job.userId, {
      type: "chapter_generated",
      title: "Capítulo gerado",
      message: `"${chapter.title}" foi criado com sucesso.`,
      data: JSON.stringify({ chapterId: chapter.id, workId: job.workId, jobId: job.publicId }),
      isRead: "false",
    });
    await createGenerationCostLog({
      jobId: job.id,
      publicJobId: job.publicId,
      userId: job.userId,
      workId: job.workId,
      engine: result.engine,
      fallbackEngine: job.fallbackEngine,
      startedAt,
      finishedAt: completedAt,
      durationSeconds: secondsBetween(startedAt, completedAt),
      inputWordCount: result.inputWordCount,
      outputWordCount: result.outputWordCount,
      inputCharCount: result.inputCharCount,
      outputCharCount: result.outputCharCount,
      providerRequestId: result.providerRequestId,
      fallbackUsed: result.fallbackUsed,
      estimatedCostUsd: result.estimatedCostUsd,
      status: "success",
      errorCode: null,
    });
    void confirmedJob;
  } catch (error) {
    const completedAt = new Date();
    const message = error instanceof Error ? error.message : "Falha desconhecida ao gerar capítulo.";
    const errorCode = error instanceof GenerationEngineError ? error.code : "generation_failed";
    const failed = await updateGenerationJob(job.id, {
      status: "failed",
      progressMessage: "Não foi possível gerar o capítulo agora. Tente novamente em alguns instantes.",
      errorCode,
      errorMessage: message.slice(0, 5000),
      completedAt,
      lockExpiresAt: null,
      lockedAt: null,
      lockedBy: null,
    });
    await releaseNarrativeCredits(failed, "Falha técnica durante a geração.");
    await createGenerationCostLog({
      jobId: job.id,
      publicJobId: job.publicId,
      userId: job.userId,
      workId: job.workId,
      engine: job.engine,
      fallbackEngine: job.fallbackEngine,
      startedAt,
      finishedAt: completedAt,
      durationSeconds: secondsBetween(startedAt, completedAt),
      inputWordCount: snapshot.inputWordCount,
      outputWordCount: 0,
      inputCharCount: snapshot.promptInput.sceneContext.length,
      outputCharCount: 0,
      providerRequestId: null,
      fallbackUsed: 0,
      estimatedCostUsd: null,
      status: "failed",
      errorCode,
    });
  }

  scheduleGenerationWorker(50);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Auditoria de Consistência Narrativa
// ─────────────────────────────────────────────────────────────────────────
//
// Fluxo:
//   1. ler obra + capítulos (workId vem do snapshot)
//   2. validar texto e wordCount (já cobrado pelo creditsReserved no createJob)
//   3. status = analyzing → runConsistencyAudit (integral OU pipeline)
//   4. status = finalizing → contar issues, persistir auditReports
//   5. confirmar créditos de análise (wordCount lido = wordCount cobrado)
//   6. completed + notificação
//   7. em qualquer falha técnica: status=failed + releaseAnalysisCredits
//
// Logs operacionais NÃO contêm livro bruto / prompt bruto / capítulo completo.
// `auditReports.issuesJson` contém os trechos citados pelo modelo — é parte do
// diagnóstico que o autor verá, então fica salvo.

const AUDIT_PROGRESS_BY_STATE = {
  preparing: "Preparando o contexto da auditoria de consistência.",
  analyzing: "Auditando a continuidade da obra (leitura integral).",
  finalizing: "Compilando o relatório de inconsistências.",
} as const;

async function persistAuditOutcome(args: {
  job: GenerationJob;
  wordCount: number;
  result: AuditEngineResult;
}) {
  const { job, wordCount, result } = args;
  const counts = aggregateCounts(result.issues);
  await createAuditReport({
    jobId: job.id,
    publicJobId: job.publicId,
    userId: job.userId,
    workId: job.workId as number,
    wordCount,
    analysisCreditsCharged: wordCount,
    strategy: result.strategy,
    engine: result.engineLabel.slice(0, 64),
    totalIssues: counts.total,
    criticalCount: counts.critical,
    highCount: counts.high,
    mediumCount: counts.medium,
    lowCount: counts.low,
    issuesJson: JSON.stringify(result.issues),
  });
}

async function failAuditJob(args: {
  job: GenerationJob;
  startedAt: Date;
  errorCode: string;
  message: string;
  providerEngineLabel?: string;
  finalStatus?: TerminalJobStatus;
  progressMessage?: string;
}): Promise<void> {
  const completedAt = new Date();
  const finalStatus = args.finalStatus ?? "failed";
  const failed = await updateGenerationJob(args.job.id, {
    status: finalStatus,
    progressMessage: "Não foi possível concluir a auditoria. Tente novamente em alguns instantes.",
    errorCode: args.errorCode,
    errorMessage: args.message.slice(0, 5000),
    completedAt,
    canceledAt: finalStatus === "canceled" ? completedAt : null,
    lockExpiresAt: null,
    lockedAt: null,
    lockedBy: null,
  });
  await releaseAnalysisCredits(failed, `Auditoria falhou: ${args.errorCode}`);
  await createGenerationCostLog({
    jobId: args.job.id,
    publicJobId: args.job.publicId,
    userId: args.job.userId,
    workId: args.job.workId,
    engine: args.providerEngineLabel?.slice(0, 80) || "audit",
    fallbackEngine: null,
    startedAt: args.startedAt,
    finishedAt: completedAt,
    durationSeconds: secondsBetween(args.startedAt, completedAt),
    inputWordCount: 0,
    outputWordCount: 0,
    inputCharCount: 0,
    outputCharCount: 0,
    providerRequestId: null,
    fallbackUsed: 0,
    estimatedCostUsd: null,
    status: finalStatus,
    errorCode: args.errorCode,
  });
}

export async function runConsistencyAuditJob(job: GenerationJob): Promise<void> {
  const startedAt = new Date();
  const snapshotInfo = parseAuditJobSnapshot(job.inputSnapshot);
  const providerLabel = `${ENV.auditProvider}:${ENV.auditModel || "default"}`;

  if (!snapshotInfo || !job.workId) {
    await failAuditJob({
      job,
      startedAt,
      errorCode: "audit_missing_book_text",
      message: "Snapshot da auditoria inválido ou sem obra associada.",
      providerEngineLabel: providerLabel,
    });
    return;
  }

  const work = await getWorkById(snapshotInfo.workId, job.userId);
  if (!work) {
    await failAuditJob({
      job,
      startedAt,
      errorCode: "audit_missing_book_text",
      message: "Obra não encontrada no momento da auditoria.",
      providerEngineLabel: providerLabel,
    });
    return;
  }
  // loadAnalysisChapters lê chapters reais OU referências importadas
  // (upload integral). Sem isso, livros subidos pelo onboarding viravam
  // "Obra sem capítulos" mesmo com 70k palavras de conteúdo.
  if (work && workIsOnStandby(work)) {
    await failAuditJob({
      job,
      startedAt,
      errorCode: "work_standby",
      message: workStandbyMessage(work),
      providerEngineLabel: providerLabel,
      finalStatus: "canceled",
      progressMessage: "Obra em stand by. A auditoria foi interrompida.",
    });
    return;
  }

  const ordered = await loadAnalysisChapters({ userId: job.userId, workId: snapshotInfo.workId });
  if (!ordered.length) {
    await failAuditJob({
      job,
      startedAt,
      errorCode: "audit_missing_book_text",
      message: "Obra sem capítulos nem referências importadas para auditar.",
      providerEngineLabel: providerLabel,
    });
    return;
  }

  const wordCount = ordered.reduce((total, chapter) => {
    return total + chapter.content.trim().split(/\s+/).filter(Boolean).length;
  }, 0);

  if (wordCount <= 0) {
    await failAuditJob({
      job,
      startedAt,
      errorCode: "audit_missing_book_text",
      message: "Conteúdo sem texto suficiente para auditoria.",
      providerEngineLabel: providerLabel,
    });
    return;
  }

  // `ordered` já vem normalizado (chapters reais OU referências sintéticas).
  // Cada item tem index/chapterId/title/content e a flag `source`.
  const auditChapters: AuditChapterInput[] = ordered.map((chapter) => ({
    index: chapter.index,
    chapterId: chapter.chapterId,
    title: chapter.title,
    content: chapter.content,
  }));

  try {
    await updateGenerationJob(job.id, {
      status: "preparing",
      progressMessage: AUDIT_PROGRESS_BY_STATE.preparing,
      startedAt,
    });
    await updateGenerationJob(job.id, {
      status: "generating",
      progressMessage: AUDIT_PROGRESS_BY_STATE.analyzing,
    });

    const result = await runConsistencyAudit({
      workMeta: {
        workId: work.id,
        title: work.title,
        genre: work.genre,
        description: work.description,
      },
      chapters: auditChapters,
    });

    if (!result.issues.length) {
      await failAuditJob({
        job,
        startedAt,
        errorCode: "audit_empty_report",
        message: "Auditoria retornou relatório vazio.",
        providerEngineLabel: result.engineLabel,
      });
      return;
    }

    await updateGenerationJob(job.id, {
      status: "finalizing",
      progressMessage: AUDIT_PROGRESS_BY_STATE.finalizing,
    });

    await persistAuditOutcome({ job, wordCount, result });

    const refreshed = await updateGenerationJob(job.id, {
      generatedWordCount: wordCount,
    });
    await confirmAnalysisCredits(refreshed, wordCount);

    const completedAt = new Date();
    await updateGenerationJob(job.id, {
      status: "completed",
      progressMessage: "Auditoria de consistência concluída.",
      completedAt,
      lockExpiresAt: null,
      lockedAt: null,
      lockedBy: null,
    });

    await createNotification(job.userId, {
      type: "review_completed",
      title: "Auditoria de consistência pronta",
      message: `${result.issues.length} inconsistência(s) encontrada(s) em "${work.title}".`,
      data: JSON.stringify({
        workId: work.id,
        jobId: job.publicId,
        totalIssues: result.issues.length,
      }),
      isRead: "false",
    });

    await createGenerationCostLog({
      jobId: job.id,
      publicJobId: job.publicId,
      userId: job.userId,
      workId: job.workId,
      engine: result.engineLabel.slice(0, 80),
      fallbackEngine: null,
      startedAt,
      finishedAt: completedAt,
      durationSeconds: secondsBetween(startedAt, completedAt),
      inputWordCount: wordCount,
      outputWordCount: 0,
      inputCharCount: 0,
      outputCharCount: 0,
      providerRequestId: null,
      fallbackUsed: 0,
      estimatedCostUsd: null,
      status: "success",
      errorCode: null,
    });
  } catch (error) {
    if (error instanceof AuditEngineError) {
      await failAuditJob({
        job,
        startedAt,
        errorCode: error.code,
        message: error.message,
        providerEngineLabel: providerLabel,
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await failAuditJob({
      job,
      startedAt,
      errorCode: "audit_unknown_error",
      message,
      providerEngineLabel: providerLabel,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Melhorias Narrativas
// ─────────────────────────────────────────────────────────────────────────
//
// Mesmo esqueleto do Auditoria, mas:
//  - lê snapshot do tipo "narrative_improvements"
//  - chama runNarrativeImprovements (prompts editoriais, não auditoria)
//  - usa releaseImprovementCredits / confirmImprovementCredits (mesma bolsa
//    de análise; só muda usageType no ledger pra rastreabilidade)
//  - persiste em improvementReports
//  - mapeia ImprovementEngineError → errorCode tipado
//
// Logs operacionais NÃO contêm livro bruto / prompt bruto / capítulo
// completo. `improvementReports.suggestionsJson` contém os trechos citados
// pelo modelo (faz parte do diagnóstico que o autor verá).

const IMPROVEMENT_PROGRESS_BY_STATE = {
  preparing: "Preparando o contexto da análise editorial.",
  analyzing: "Lendo a obra para sugerir melhorias estruturais.",
  finalizing: "Compilando o relatório de melhorias.",
} as const;

async function persistImprovementOutcome(args: {
  job: GenerationJob;
  wordCount: number;
  result: ImprovementEngineResult;
}) {
  const { job, wordCount, result } = args;
  const counts = aggregateImprovementCounts(result.suggestions);
  await createImprovementReport({
    jobId: job.id,
    publicJobId: job.publicId,
    userId: job.userId,
    workId: job.workId as number,
    wordCount,
    analysisCreditsCharged: wordCount,
    strategy: result.strategy,
    engine: result.engineLabel.slice(0, 64),
    totalSuggestions: counts.total,
    criticalCount: counts.critical,
    highCount: counts.high,
    mediumCount: counts.medium,
    lowCount: counts.low,
    suggestionsJson: JSON.stringify(result.suggestions),
  });
}

async function failImprovementJob(args: {
  job: GenerationJob;
  startedAt: Date;
  errorCode: string;
  message: string;
  providerEngineLabel?: string;
  finalStatus?: TerminalJobStatus;
  progressMessage?: string;
}): Promise<void> {
  const completedAt = new Date();
  const finalStatus = args.finalStatus ?? "failed";
  const failed = await updateGenerationJob(args.job.id, {
    status: finalStatus,
    progressMessage: "Não foi possível concluir a análise editorial. Tente novamente em alguns instantes.",
    errorCode: args.errorCode,
    errorMessage: args.message.slice(0, 5000),
    completedAt,
    canceledAt: finalStatus === "canceled" ? completedAt : null,
    lockExpiresAt: null,
    lockedAt: null,
    lockedBy: null,
  });
  await releaseImprovementCredits(failed, `Melhorias falhou: ${args.errorCode}`);
  await createGenerationCostLog({
    jobId: args.job.id,
    publicJobId: args.job.publicId,
    userId: args.job.userId,
    workId: args.job.workId,
    engine: args.providerEngineLabel?.slice(0, 80) || "improvements",
    fallbackEngine: null,
    startedAt: args.startedAt,
    finishedAt: completedAt,
    durationSeconds: secondsBetween(args.startedAt, completedAt),
    inputWordCount: 0,
    outputWordCount: 0,
    inputCharCount: 0,
    outputCharCount: 0,
    providerRequestId: null,
    fallbackUsed: 0,
    estimatedCostUsd: null,
    status: finalStatus,
    errorCode: args.errorCode,
  });
}

export async function runNarrativeImprovementsJob(job: GenerationJob): Promise<void> {
  const startedAt = new Date();
  const snapshotInfo = parseImprovementJobSnapshot(job.inputSnapshot);
  const providerLabel = `${ENV.auditProvider}:${ENV.auditModel || "default"}`;

  if (!snapshotInfo || !job.workId) {
    await failImprovementJob({
      job,
      startedAt,
      errorCode: "improvements_missing_book_text",
      message: "Snapshot da análise inválido ou sem obra associada.",
      providerEngineLabel: providerLabel,
    });
    return;
  }

  const work = await getWorkById(snapshotInfo.workId, job.userId);
  if (work && workIsOnStandby(work)) {
    await failImprovementJob({
      job,
      startedAt,
      errorCode: "work_standby",
      message: workStandbyMessage(work),
      providerEngineLabel: providerLabel,
      finalStatus: "canceled",
      progressMessage: "Obra em stand by. A analise foi interrompida.",
    });
    return;
  }
  if (!work) {
    await failImprovementJob({
      job,
      startedAt,
      errorCode: "improvements_missing_book_text",
      message: "Obra não encontrada no momento da análise.",
      providerEngineLabel: providerLabel,
    });
    return;
  }
  // Mesma estratégia de auditoria: chapters reais OU referências importadas.
  const ordered = await loadAnalysisChapters({ userId: job.userId, workId: snapshotInfo.workId });
  if (!ordered.length) {
    await failImprovementJob({
      job,
      startedAt,
      errorCode: "improvements_missing_book_text",
      message: "Obra sem capítulos nem referências importadas para análise editorial.",
      providerEngineLabel: providerLabel,
    });
    return;
  }

  const wordCount = ordered.reduce((total, chapter) => {
    return total + chapter.content.trim().split(/\s+/).filter(Boolean).length;
  }, 0);

  if (wordCount <= 0) {
    await failImprovementJob({
      job,
      startedAt,
      errorCode: "improvements_missing_book_text",
      message: "Conteúdo sem texto suficiente para análise editorial.",
      providerEngineLabel: providerLabel,
    });
    return;
  }

  const improvementChapters: ImprovementChapterInput[] = ordered.map((chapter) => ({
    index: chapter.index,
    chapterId: chapter.chapterId,
    title: chapter.title,
    content: chapter.content,
  }));

  try {
    await updateGenerationJob(job.id, {
      status: "preparing",
      progressMessage: IMPROVEMENT_PROGRESS_BY_STATE.preparing,
      startedAt,
    });
    await updateGenerationJob(job.id, {
      status: "generating",
      progressMessage: IMPROVEMENT_PROGRESS_BY_STATE.analyzing,
    });

    const result = await runNarrativeImprovements({
      workMeta: {
        workId: work.id,
        title: work.title,
        genre: work.genre,
        description: work.description,
      },
      chapters: improvementChapters,
    });

    if (!result.suggestions.length) {
      await failImprovementJob({
        job,
        startedAt,
        errorCode: "improvements_empty_report",
        message: "Análise editorial retornou relatório vazio.",
        providerEngineLabel: result.engineLabel,
      });
      return;
    }

    await updateGenerationJob(job.id, {
      status: "finalizing",
      progressMessage: IMPROVEMENT_PROGRESS_BY_STATE.finalizing,
    });

    await persistImprovementOutcome({ job, wordCount, result });

    const refreshed = await updateGenerationJob(job.id, {
      generatedWordCount: wordCount,
    });
    await confirmImprovementCredits(refreshed, wordCount);

    const completedAt = new Date();
    await updateGenerationJob(job.id, {
      status: "completed",
      progressMessage: "Análise de melhorias concluída.",
      completedAt,
      lockExpiresAt: null,
      lockedAt: null,
      lockedBy: null,
    });

    await createNotification(job.userId, {
      type: "review_completed",
      title: "Melhorias narrativas prontas",
      message: `${result.suggestions.length} sugestão(ões) editorial(is) gerada(s) para "${work.title}".`,
      data: JSON.stringify({
        workId: work.id,
        jobId: job.publicId,
        totalSuggestions: result.suggestions.length,
      }),
      isRead: "false",
    });

    await createGenerationCostLog({
      jobId: job.id,
      publicJobId: job.publicId,
      userId: job.userId,
      workId: job.workId,
      engine: result.engineLabel.slice(0, 80),
      fallbackEngine: null,
      startedAt,
      finishedAt: completedAt,
      durationSeconds: secondsBetween(startedAt, completedAt),
      inputWordCount: wordCount,
      outputWordCount: 0,
      inputCharCount: 0,
      outputCharCount: 0,
      providerRequestId: null,
      fallbackUsed: 0,
      estimatedCostUsd: null,
      status: "success",
      errorCode: null,
    });
  } catch (error) {
    if (error instanceof ImprovementEngineError) {
      await failImprovementJob({
        job,
        startedAt,
        errorCode: error.code,
        message: error.message,
        providerEngineLabel: providerLabel,
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await failImprovementJob({
      job,
      startedAt,
      errorCode: "improvements_unknown_error",
      message,
      providerEngineLabel: providerLabel,
    });
  }
}
