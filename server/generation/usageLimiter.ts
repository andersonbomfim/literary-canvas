import { TRPCError } from "@trpc/server";
import type { GenerationJob, UserSubscription } from "../../drizzle/schema";
import {
  createGenerationUsageLedgerEntry,
  getUserSubscription,
  updateGenerationJob,
  updateUserSubscriptionGenerationUsage,
} from "../db";
import {
  getBillingCycle,
  isCycleExpired,
  monthlyAnalysisCreditsByPlan,
  monthlyNarrativeCreditsByPlan,
  resolvePlanTier,
  type PlanTier,
} from "./planConfig";

export type NarrativeUsageState = {
  subscription: UserSubscription;
  planTier: PlanTier;
  monthlyLimit: number;
  monthlyAvailable: number;
  extraAvailable: number;
  remainingNarrativeCredits: number;
};

function availableMonthlyCredits(subscription: UserSubscription, monthlyLimit: number) {
  return Math.max(
    0,
    monthlyLimit - subscription.monthlyNarrativeCreditsUsed - subscription.monthlyNarrativeCreditsReserved,
  );
}

function availableExtraCredits(subscription: UserSubscription) {
  return Math.max(0, subscription.extraNarrativeCredits - subscription.extraNarrativeCreditsReserved);
}

async function normalizeSubscription(userId: number, subscription: UserSubscription): Promise<UserSubscription> {
  const planTier = resolvePlanTier(subscription);
  const monthlyLimit = monthlyNarrativeCreditsByPlan[planTier];
  const monthlyAnalysisLimit = monthlyAnalysisCreditsByPlan[planTier];
  const cycle = getBillingCycle();
  const patch: Partial<Pick<UserSubscription,
    "planTier" |
    "monthlyNarrativeCreditLimit" |
    "monthlyNarrativeCreditsUsed" |
    "monthlyNarrativeCreditsReserved" |
    "monthlyAnalysisCreditLimit" |
    "monthlyAnalysisCreditsUsed" |
    "monthlyAnalysisCreditsReserved" |
    "billingCycleStart" |
    "billingCycleEnd" |
    "monthlyInspirationUsed" |
    "monthlyTextReviewUsed"
  >> = {};

  if (subscription.planTier !== planTier) patch.planTier = planTier;
  if (subscription.monthlyNarrativeCreditLimit !== monthlyLimit) patch.monthlyNarrativeCreditLimit = monthlyLimit;
  if (subscription.monthlyAnalysisCreditLimit !== monthlyAnalysisLimit) patch.monthlyAnalysisCreditLimit = monthlyAnalysisLimit;
  if (isCycleExpired(subscription)) {
    patch.monthlyNarrativeCreditsUsed = 0;
    patch.monthlyNarrativeCreditsReserved = 0;
    patch.monthlyAnalysisCreditsUsed = 0;
    patch.monthlyAnalysisCreditsReserved = 0;
    patch.monthlyInspirationUsed = 0;
    patch.monthlyTextReviewUsed = 0;
    patch.billingCycleStart = cycle.start;
    patch.billingCycleEnd = cycle.end;
  }

  if (!Object.keys(patch).length) return subscription;
  return updateUserSubscriptionGenerationUsage(userId, patch);
}

export async function getNarrativeUsageState(userId: number): Promise<NarrativeUsageState> {
  const subscription = await normalizeSubscription(userId, await getUserSubscription(userId));
  const planTier = resolvePlanTier(subscription);
  const monthlyLimit = monthlyNarrativeCreditsByPlan[planTier];
  const monthlyAvailable = availableMonthlyCredits(subscription, monthlyLimit);
  const extraAvailable = availableExtraCredits(subscription);
  return {
    subscription,
    planTier,
    monthlyLimit,
    monthlyAvailable,
    extraAvailable,
    remainingNarrativeCredits: monthlyAvailable + extraAvailable,
  };
}

function jobLedgerBase(job: Pick<GenerationJob, "id" | "publicId" | "userId" | "workId">) {
  return {
    jobId: job.id,
    publicJobId: job.publicId,
    userId: job.userId,
    workId: job.workId,
  };
}

/**
 * Tipos de uso que conseguimos distinguir no ledger. Auditoria e Melhorias
 * compartilham a MESMA bolsa (analysisCredits) mas têm rótulos diferentes
 * aqui pra rastreabilidade contábil/relatório.
 */
export type LedgerUsageType =
  | "narrative_generation"
  | "book_consistency_audit"
  | "narrative_improvements";

async function writeLedgerRows(args: {
  job: GenerationJob;
  usageType?: LedgerUsageType;
  type: "reserve" | "confirm" | "release" | "refund" | "adjustment";
  monthlyAmount: number;
  extraAmount: number;
  monthlyBalanceAfter: number;
  extraBalanceAfter: number;
  reason: string;
}) {
  const base = jobLedgerBase(args.job);
  const usageType = args.usageType ?? "narrative_generation";
  if (args.monthlyAmount > 0) {
    await createGenerationUsageLedgerEntry({
      ...base,
      usageType,
      source: "monthly",
      type: args.type,
      amount: args.monthlyAmount,
      balanceAfter: args.monthlyBalanceAfter,
      reason: args.reason,
    });
  }
  if (args.extraAmount > 0) {
    await createGenerationUsageLedgerEntry({
      ...base,
      usageType,
      source: "extra",
      type: args.type,
      amount: args.extraAmount,
      balanceAfter: args.extraBalanceAfter,
      reason: args.reason,
    });
  }
}

export async function reserveNarrativeCredits(job: GenerationJob, requestedCredits: number): Promise<GenerationJob> {
  const amount = Math.max(0, Math.floor(requestedCredits));
  if (amount <= 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Sem créditos narrativos disponíveis para gerar este capítulo.",
    });
  }

  const state = await getNarrativeUsageState(job.userId);
  if (state.remainingNarrativeCredits < amount) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Você atingiu o limite mensal de escrita. Use créditos extras ou faça upgrade de plano.",
    });
  }

  const monthlyAmount = Math.min(state.monthlyAvailable, amount);
  const extraAmount = amount - monthlyAmount;
  const nextMonthlyReserved = state.subscription.monthlyNarrativeCreditsReserved + monthlyAmount;
  const nextExtraReserved = state.subscription.extraNarrativeCreditsReserved + extraAmount;

  await updateUserSubscriptionGenerationUsage(job.userId, {
    monthlyNarrativeCreditsReserved: nextMonthlyReserved,
    extraNarrativeCreditsReserved: nextExtraReserved,
  });

  const monthlyBalanceAfter = Math.max(0, state.monthlyLimit - state.subscription.monthlyNarrativeCreditsUsed - nextMonthlyReserved);
  const extraBalanceAfter = Math.max(0, state.subscription.extraNarrativeCredits - nextExtraReserved);

  await writeLedgerRows({
    job,
    type: "reserve",
    monthlyAmount,
    extraAmount,
    monthlyBalanceAfter,
    extraBalanceAfter,
    reason: "Reserva de créditos narrativos para geração.",
  });

  return updateGenerationJob(job.id, {
    reservedCredits: amount,
    reservedMonthlyCredits: monthlyAmount,
    reservedExtraCredits: extraAmount,
  });
}

export async function confirmNarrativeCredits(job: GenerationJob, generatedWordCount: number): Promise<GenerationJob> {
  const actual = Math.max(0, Math.floor(generatedWordCount));
  const confirmedTotal = Math.min(actual, job.reservedCredits);
  const confirmedMonthly = Math.min(job.reservedMonthlyCredits, confirmedTotal);
  const confirmedExtra = Math.min(job.reservedExtraCredits, confirmedTotal - confirmedMonthly);
  const releasedMonthly = Math.max(0, job.reservedMonthlyCredits - confirmedMonthly);
  const releasedExtra = Math.max(0, job.reservedExtraCredits - confirmedExtra);
  const state = await getNarrativeUsageState(job.userId);

  const nextMonthlyReserved = Math.max(0, state.subscription.monthlyNarrativeCreditsReserved - job.reservedMonthlyCredits);
  const nextExtraReserved = Math.max(0, state.subscription.extraNarrativeCreditsReserved - job.reservedExtraCredits);
  const nextMonthlyUsed = state.subscription.monthlyNarrativeCreditsUsed + confirmedMonthly;
  const nextExtraCredits = Math.max(0, state.subscription.extraNarrativeCredits - confirmedExtra);

  await updateUserSubscriptionGenerationUsage(job.userId, {
    monthlyNarrativeCreditsReserved: nextMonthlyReserved,
    extraNarrativeCreditsReserved: nextExtraReserved,
    monthlyNarrativeCreditsUsed: nextMonthlyUsed,
    extraNarrativeCredits: nextExtraCredits,
  });

  const monthlyBalanceAfter = Math.max(0, state.monthlyLimit - nextMonthlyUsed - nextMonthlyReserved);
  const extraBalanceAfter = Math.max(0, nextExtraCredits - nextExtraReserved);

  await writeLedgerRows({
    job,
    type: "confirm",
    monthlyAmount: confirmedMonthly,
    extraAmount: confirmedExtra,
    monthlyBalanceAfter,
    extraBalanceAfter,
    reason: "Confirmação de consumo por palavras geradas.",
  });
  await writeLedgerRows({
    job,
    type: "release",
    monthlyAmount: releasedMonthly,
    extraAmount: releasedExtra,
    monthlyBalanceAfter,
    extraBalanceAfter,
    reason: "Liberação da sobra reservada.",
  });

  return updateGenerationJob(job.id, {
    confirmedCredits: confirmedTotal,
    confirmedMonthlyCredits: confirmedMonthly,
    confirmedExtraCredits: confirmedExtra,
    releasedCredits: releasedMonthly + releasedExtra,
    generatedWordCount: actual,
  });
}

export async function releaseNarrativeCredits(job: GenerationJob, reason: string): Promise<GenerationJob> {
  const monthlyAmount = Math.max(0, job.reservedMonthlyCredits - job.confirmedMonthlyCredits);
  const extraAmount = Math.max(0, job.reservedExtraCredits - job.confirmedExtraCredits);
  if (monthlyAmount <= 0 && extraAmount <= 0) return job;

  const state = await getNarrativeUsageState(job.userId);
  const nextMonthlyReserved = Math.max(0, state.subscription.monthlyNarrativeCreditsReserved - monthlyAmount);
  const nextExtraReserved = Math.max(0, state.subscription.extraNarrativeCreditsReserved - extraAmount);

  await updateUserSubscriptionGenerationUsage(job.userId, {
    monthlyNarrativeCreditsReserved: nextMonthlyReserved,
    extraNarrativeCreditsReserved: nextExtraReserved,
  });

  const monthlyBalanceAfter = Math.max(0, state.monthlyLimit - state.subscription.monthlyNarrativeCreditsUsed - nextMonthlyReserved);
  const extraBalanceAfter = Math.max(0, state.subscription.extraNarrativeCredits - nextExtraReserved);

  await writeLedgerRows({
    job,
    type: "release",
    monthlyAmount,
    extraAmount,
    monthlyBalanceAfter,
    extraBalanceAfter,
    reason,
  });

  return updateGenerationJob(job.id, {
    releasedCredits: job.releasedCredits + monthlyAmount + extraAmount,
  });
}

// ────────────────────────────────────────────────────────────────────────
// Auditoria de Consistência Narrativa — bolsa de análise
// ────────────────────────────────────────────────────────────────────────
//
// Mesmo formato dos helpers narrativos, mas lendo/escrevendo
// monthlyAnalysisCredits* e extraAnalysisCredits*. O job (action =
// "consistency_audit") reusa os campos genéricos reservedCredits /
// confirmedCredits / releasedCredits — como um job nunca é
// simultaneamente narrative e analysis, não há conflito semântico.

export type AnalysisUsageState = {
  subscription: UserSubscription;
  planTier: PlanTier;
  monthlyLimit: number;
  monthlyAvailable: number;
  extraAvailable: number;
  remainingAnalysisCredits: number;
};

function availableMonthlyAnalysisCredits(subscription: UserSubscription, monthlyLimit: number) {
  return Math.max(
    0,
    monthlyLimit - subscription.monthlyAnalysisCreditsUsed - subscription.monthlyAnalysisCreditsReserved,
  );
}

function availableExtraAnalysisCredits(subscription: UserSubscription) {
  return Math.max(0, subscription.extraAnalysisCredits - subscription.extraAnalysisCreditsReserved);
}

export async function getAnalysisUsageState(userId: number): Promise<AnalysisUsageState> {
  const subscription = await normalizeSubscription(userId, await getUserSubscription(userId));
  const planTier = resolvePlanTier(subscription);
  const monthlyLimit = monthlyAnalysisCreditsByPlan[planTier];
  const monthlyAvailable = availableMonthlyAnalysisCredits(subscription, monthlyLimit);
  const extraAvailable = availableExtraAnalysisCredits(subscription);
  return {
    subscription,
    planTier,
    monthlyLimit,
    monthlyAvailable,
    extraAvailable,
    remainingAnalysisCredits: monthlyAvailable + extraAvailable,
  };
}

/**
 * Configuração de rótulos por feature que consome créditos de análise.
 * Auditoria e Melhorias compartilham a mesma bolsa — só mudam usageType
 * (rastreabilidade contábil) e a mensagem amigável ao usuário.
 */
type AnalysisFeature = {
  usageType: "book_consistency_audit" | "narrative_improvements";
  featureLabelShort: string;          // ex: "Auditoria", "Melhorias"
  reserveReason: string;
  confirmReason: string;
  releaseReason: string;
};

const ANALYSIS_FEATURES = {
  audit: {
    usageType: "book_consistency_audit",
    featureLabelShort: "Auditoria",
    reserveReason: "Reserva de créditos para Auditoria de Consistência.",
    confirmReason: "Confirmação de palavras analisadas pela Auditoria.",
    releaseReason: "Liberação de sobra reservada da Auditoria.",
  },
  improvements: {
    usageType: "narrative_improvements",
    featureLabelShort: "Melhorias",
    reserveReason: "Reserva de créditos para Melhorias Narrativas.",
    confirmReason: "Confirmação de palavras analisadas pelas Melhorias.",
    releaseReason: "Liberação de sobra reservada das Melhorias.",
  },
} as const satisfies Record<string, AnalysisFeature>;

/**
 * Core compartilhado entre Auditoria e Melhorias. Reserva créditos de análise
 * UMA única vez por job; cobrança = wordCount (1 crédito por palavra). O
 * pipeline interno pode fazer N chamadas ao LLM, mas isso NÃO multiplica a
 * cobrança ao autor — esse é custo operacional do produto.
 */
async function reserveAnalysisCreditsFor(
  job: GenerationJob,
  requestedCredits: number,
  feature: AnalysisFeature,
): Promise<GenerationJob> {
  const amount = Math.max(0, Math.floor(requestedCredits));
  if (amount <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${feature.featureLabelShort} precisa de pelo menos 1 palavra de conteúdo.`,
    });
  }

  const state = await getAnalysisUsageState(job.userId);
  if (state.remainingAnalysisCredits < amount) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Sem créditos de análise suficientes. ${feature.featureLabelShort} precisa de ${amount.toLocaleString("pt-BR")}; você tem ${state.remainingAnalysisCredits.toLocaleString("pt-BR")} disponíveis no plano ${state.planTier}.`,
    });
  }

  const monthlyAmount = Math.min(state.monthlyAvailable, amount);
  const extraAmount = amount - monthlyAmount;
  const nextMonthlyReserved = state.subscription.monthlyAnalysisCreditsReserved + monthlyAmount;
  const nextExtraReserved = state.subscription.extraAnalysisCreditsReserved + extraAmount;

  await updateUserSubscriptionGenerationUsage(job.userId, {
    monthlyAnalysisCreditsReserved: nextMonthlyReserved,
    extraAnalysisCreditsReserved: nextExtraReserved,
  });

  const monthlyBalanceAfter = Math.max(0, state.monthlyLimit - state.subscription.monthlyAnalysisCreditsUsed - nextMonthlyReserved);
  const extraBalanceAfter = Math.max(0, state.subscription.extraAnalysisCredits - nextExtraReserved);

  await writeLedgerRows({
    job,
    usageType: feature.usageType,
    type: "reserve",
    monthlyAmount,
    extraAmount,
    monthlyBalanceAfter,
    extraBalanceAfter,
    reason: feature.reserveReason,
  });

  return updateGenerationJob(job.id, {
    reservedCredits: amount,
    reservedMonthlyCredits: monthlyAmount,
    reservedExtraCredits: extraAmount,
  });
}

async function confirmAnalysisCreditsFor(
  job: GenerationJob,
  actualUsed: number,
  feature: AnalysisFeature,
): Promise<GenerationJob> {
  const actual = Math.max(0, Math.floor(actualUsed));
  const confirmedTotal = Math.min(actual, job.reservedCredits);
  const confirmedMonthly = Math.min(job.reservedMonthlyCredits, confirmedTotal);
  const confirmedExtra = Math.min(job.reservedExtraCredits, confirmedTotal - confirmedMonthly);
  const releasedMonthly = Math.max(0, job.reservedMonthlyCredits - confirmedMonthly);
  const releasedExtra = Math.max(0, job.reservedExtraCredits - confirmedExtra);
  const state = await getAnalysisUsageState(job.userId);

  const nextMonthlyReserved = Math.max(0, state.subscription.monthlyAnalysisCreditsReserved - job.reservedMonthlyCredits);
  const nextExtraReserved = Math.max(0, state.subscription.extraAnalysisCreditsReserved - job.reservedExtraCredits);
  const nextMonthlyUsed = state.subscription.monthlyAnalysisCreditsUsed + confirmedMonthly;
  const nextExtraCredits = Math.max(0, state.subscription.extraAnalysisCredits - confirmedExtra);

  await updateUserSubscriptionGenerationUsage(job.userId, {
    monthlyAnalysisCreditsReserved: nextMonthlyReserved,
    extraAnalysisCreditsReserved: nextExtraReserved,
    monthlyAnalysisCreditsUsed: nextMonthlyUsed,
    extraAnalysisCredits: nextExtraCredits,
  });

  const monthlyBalanceAfter = Math.max(0, state.monthlyLimit - nextMonthlyUsed - nextMonthlyReserved);
  const extraBalanceAfter = Math.max(0, nextExtraCredits - nextExtraReserved);

  await writeLedgerRows({
    job,
    usageType: feature.usageType,
    type: "confirm",
    monthlyAmount: confirmedMonthly,
    extraAmount: confirmedExtra,
    monthlyBalanceAfter,
    extraBalanceAfter,
    reason: feature.confirmReason,
  });
  await writeLedgerRows({
    job,
    usageType: feature.usageType,
    type: "release",
    monthlyAmount: releasedMonthly,
    extraAmount: releasedExtra,
    monthlyBalanceAfter,
    extraBalanceAfter,
    reason: feature.releaseReason,
  });

  return updateGenerationJob(job.id, {
    confirmedCredits: confirmedTotal,
    confirmedMonthlyCredits: confirmedMonthly,
    confirmedExtraCredits: confirmedExtra,
    releasedCredits: releasedMonthly + releasedExtra,
  });
}

async function releaseAnalysisCreditsFor(
  job: GenerationJob,
  reason: string,
  feature: AnalysisFeature,
): Promise<GenerationJob> {
  const monthlyAmount = Math.max(0, job.reservedMonthlyCredits - job.confirmedMonthlyCredits);
  const extraAmount = Math.max(0, job.reservedExtraCredits - job.confirmedExtraCredits);
  if (monthlyAmount <= 0 && extraAmount <= 0) return job;

  const state = await getAnalysisUsageState(job.userId);
  const nextMonthlyReserved = Math.max(0, state.subscription.monthlyAnalysisCreditsReserved - monthlyAmount);
  const nextExtraReserved = Math.max(0, state.subscription.extraAnalysisCreditsReserved - extraAmount);

  await updateUserSubscriptionGenerationUsage(job.userId, {
    monthlyAnalysisCreditsReserved: nextMonthlyReserved,
    extraAnalysisCreditsReserved: nextExtraReserved,
  });

  const monthlyBalanceAfter = Math.max(0, state.monthlyLimit - state.subscription.monthlyAnalysisCreditsUsed - nextMonthlyReserved);
  const extraBalanceAfter = Math.max(0, state.subscription.extraAnalysisCredits - nextExtraReserved);

  await writeLedgerRows({
    job,
    usageType: feature.usageType,
    type: "release",
    monthlyAmount,
    extraAmount,
    monthlyBalanceAfter,
    extraBalanceAfter,
    reason,
  });

  return updateGenerationJob(job.id, {
    releasedCredits: job.releasedCredits + monthlyAmount + extraAmount,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Auditoria de Consistência — wrappers públicos (compat com Fase 2).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reserva créditos de análise UMA única vez por job de Auditoria.
 *
 * Cobrança ao usuário = wordCount do livro (1 crédito por palavra do livro).
 * Se o pipeline interno (extração por capítulo + consolidação + cruzamento)
 * fizer múltiplas chamadas ao LLM, ESSE é custo operacional do produto e
 * NÃO multiplica a cobrança ao autor. O worker passa wordCount aqui uma vez
 * só; depois chama confirmAnalysisCredits com o mesmo wordCount.
 */
export async function reserveAnalysisCredits(job: GenerationJob, requestedCredits: number): Promise<GenerationJob> {
  return reserveAnalysisCreditsFor(job, requestedCredits, ANALYSIS_FEATURES.audit);
}

export async function confirmAnalysisCredits(job: GenerationJob, actualUsed: number): Promise<GenerationJob> {
  return confirmAnalysisCreditsFor(job, actualUsed, ANALYSIS_FEATURES.audit);
}

export async function releaseAnalysisCredits(job: GenerationJob, reason: string): Promise<GenerationJob> {
  return releaseAnalysisCreditsFor(job, reason, ANALYSIS_FEATURES.audit);
}

// ─────────────────────────────────────────────────────────────────────────
// Melhorias Narrativas — wrappers públicos.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reserva créditos para um job de Melhorias. Compartilha a MESMA bolsa de
 * análise (`monthlyAnalysisCredit*`) — só rotula diferente no ledger pra
 * relatório/reconciliação.
 */
export async function reserveImprovementCredits(job: GenerationJob, requestedCredits: number): Promise<GenerationJob> {
  return reserveAnalysisCreditsFor(job, requestedCredits, ANALYSIS_FEATURES.improvements);
}

export async function confirmImprovementCredits(job: GenerationJob, actualUsed: number): Promise<GenerationJob> {
  return confirmAnalysisCreditsFor(job, actualUsed, ANALYSIS_FEATURES.improvements);
}

export async function releaseImprovementCredits(job: GenerationJob, reason: string): Promise<GenerationJob> {
  return releaseAnalysisCreditsFor(job, reason, ANALYSIS_FEATURES.improvements);
}
