import type { UserSubscription } from "../../drizzle/schema";
import { ENV } from "../_core/env";

export type PlanTier = "free" | "essential" | "ultra";

export const planTiers: PlanTier[] = ["free", "essential", "ultra"];

export const monthlyNarrativeCreditsByPlan: Record<PlanTier, number> = {
  free: 5_000,
  essential: 30_000,
  ultra: 100_000,
};

/**
 * Auditoria de Consistência Narrativa — bolsa separada das narrativas.
 * 1 crédito de análise = 1 palavra lida na leitura integral.
 * Free=0 (sem acesso à feature); Essential cobre ~1 livro médio/mês;
 * Ultra cobre ~5 livros/mês.
 */
export const monthlyAnalysisCreditsByPlan: Record<PlanTier, number> = {
  free: 0,
  essential: 120_000,
  ultra: 600_000,
};

/** Planos que têm acesso ao recurso de Auditoria de Consistência. */
export const consistencyAuditAllowedPlans: PlanTier[] = ["essential", "ultra"];

export function canRunConsistencyAudit(planTier: PlanTier): boolean {
  return consistencyAuditAllowedPlans.includes(planTier);
}

/**
 * Mensagem amigável quando o plano do usuário não dá acesso à Auditoria.
 * O router F3 deve checar `canRunConsistencyAudit` ANTES de chamar
 * `reserveAnalysisCredits` — assim o usuário recebe convite de upgrade em
 * vez de erro genérico de saldo insuficiente.
 */
export const CONSISTENCY_AUDIT_PLAN_REQUIRED_MESSAGE =
  'A Auditoria de Consistência está disponível nos planos Essential e Ultra. Faça upgrade para auditar a continuidade da sua obra.';

/**
 * Melhorias Narrativas — gating de plano. Por enquanto compartilha a mesma
 * regra de Auditoria: Essential e Ultra. Bolsa de créditos também é a mesma
 * (`monthlyAnalysisCredit*`), só diferenciamos via `usageType` no ledger.
 * Se um dia quisermos permitir Free experimentar com limite reduzido, basta
 * trocar a lista aqui sem mexer no usageLimiter.
 */
export const narrativeImprovementsAllowedPlans: PlanTier[] = ["essential", "ultra"];

export function canRunNarrativeImprovements(planTier: PlanTier): boolean {
  return narrativeImprovementsAllowedPlans.includes(planTier);
}

export const NARRATIVE_IMPROVEMENTS_PLAN_REQUIRED_MESSAGE =
  'As Melhorias Narrativas estão disponíveis nos planos Essential e Ultra. Faça upgrade para receber sugestões editoriais sobre a sua obra.';

export const maxDraftWordsPerGeneration: Record<PlanTier, number> = {
  free: 3_000,
  essential: 10_000,
  ultra: 15_000,
};

export const defaultOutputWordsByPlan: Record<PlanTier, number> = {
  free: 1_500,
  essential: 3_000,
  ultra: 6_000,
};

export const maxGeneratedWordsPerChapter: Record<PlanTier, number> = {
  free: 1_500,
  essential: 12_000,
  ultra: 20_000,
};

export const maxLocalizedEditOutputWords: Record<PlanTier, number> = {
  free: 500,
  essential: 2_000,
  ultra: 5_000,
};

export const maxAdjustmentsPerChapter: Record<PlanTier, number> = {
  free: 1,
  essential: 3,
  ultra: 8,
};

export const minDraftWordsToGenerate = 1_000;
export const minDraftWordsToReview = 50;

export const monthlyInspirationLimit: Record<PlanTier, number> = {
  free: 5,
  essential: 30,
  ultra: 100,
};

export const monthlyTextReviewLimit: Record<PlanTier, number> = {
  free: 3,
  essential: 30,
  ultra: 100,
};

export const draftRules = {
  minDraftWordsToGenerate,
  minDraftWordsToReview,
  maxDraftWordsPerGeneration,
  maxGeneratedWordsPerChapter,
  monthlyInspirationLimit,
  monthlyTextReviewLimit,
};

export function countWords(value: string | null | undefined) {
  return (value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

export function resolvePlanTier(subscription?: Pick<UserSubscription, "planTier" | "planCode" | "status"> | null): PlanTier {
  // Em modo local-data o app é single-user e o "dono" é o próprio operador.
  // Ele não tem como assinar plano, então tratar como "ultra" por padrão.
  // Caso o operador queira simular limites, basta setar manualmente
  // userSubscriptions.planTier no JSON local.
  if (process.env.LOCAL_DATA_ONLY === "true" || !ENV.databaseUrl) {
    const hasExplicitPlan = Boolean(
      subscription?.status &&
      subscription.status !== "none" &&
      subscription.status !== "canceled" &&
      subscription?.planTier &&
      planTiers.includes(subscription.planTier as PlanTier),
    );

    if (hasExplicitPlan) {
      return subscription?.planTier as PlanTier;
    }
    return "ultra";
  }

  if (subscription?.planTier && planTiers.includes(subscription.planTier as PlanTier)) {
    return subscription.planTier as PlanTier;
  }

  if (subscription?.planCode === "yearly") return "ultra";
  if (subscription?.planCode === "monthly" || subscription?.planCode === "weekly") return "essential";
  return "free";
}

export function getBillingCycle(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

export function isCycleExpired(subscription: Pick<UserSubscription, "billingCycleStart" | "billingCycleEnd">, now = new Date()) {
  return !subscription.billingCycleStart || !subscription.billingCycleEnd || subscription.billingCycleEnd <= now;
}

export function clampRequestedMaxOutputWords(args: {
  planTier: PlanTier;
  userRequestedMaxOutputWords?: number | null;
  remainingNarrativeCredits: number;
  // Nem "consistency_audit" nem "narrative_improvements" geram texto narrativo
  // — o worker pula esse caller pra eles. Mantemos aqui só pra satisfazer o
  // tipo `GenerationAction` compartilhado, retornando 0 caso seja chamado por
  // engano via routers narrativos.
  action?: "generate" | "regenerate" | "localized_edit" | "consistency_audit" | "narrative_improvements";
}) {
  if (args.action === "consistency_audit" || args.action === "narrative_improvements") return 0;
  if (args.remainingNarrativeCredits <= 0) return 0;

  const maxByAction = args.action === "localized_edit"
    ? maxLocalizedEditOutputWords[args.planTier]
    : maxGeneratedWordsPerChapter[args.planTier];
  const requested = args.userRequestedMaxOutputWords && Number.isFinite(args.userRequestedMaxOutputWords)
    ? Math.floor(args.userRequestedMaxOutputWords)
    : defaultOutputWordsByPlan[args.planTier];

  return Math.max(1, Math.min(requested, maxByAction, Math.max(0, args.remainingNarrativeCredits)));
}
