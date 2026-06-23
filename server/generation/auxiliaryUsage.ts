import { TRPCError } from "@trpc/server";
import type { UserSubscription } from "../../drizzle/schema";
import { getUserSubscription, updateUserSubscriptionGenerationUsage } from "../db";
import {
  getBillingCycle,
  isCycleExpired,
  monthlyInspirationLimit,
  monthlyNarrativeCreditsByPlan,
  monthlyTextReviewLimit,
  resolvePlanTier,
  type PlanTier,
} from "./planConfig";

export type AuxiliaryUsageKind = "inspiration" | "textReview";

const LIMIT_REACHED_MESSAGE = "Você atingiu o limite mensal de revisões/inspirações do seu plano.";

function fieldForKind(kind: AuxiliaryUsageKind): "monthlyInspirationUsed" | "monthlyTextReviewUsed" {
  return kind === "inspiration" ? "monthlyInspirationUsed" : "monthlyTextReviewUsed";
}

function limitForKind(kind: AuxiliaryUsageKind, planTier: PlanTier) {
  return kind === "inspiration" ? monthlyInspirationLimit[planTier] : monthlyTextReviewLimit[planTier];
}

async function normalizeSubscription(userId: number, subscription: UserSubscription): Promise<UserSubscription> {
  const planTier = resolvePlanTier(subscription);
  const monthlyLimit = monthlyNarrativeCreditsByPlan[planTier];
  const cycle = getBillingCycle();
  const patch: Partial<Pick<UserSubscription,
    "planTier" |
    "monthlyNarrativeCreditLimit" |
    "monthlyNarrativeCreditsUsed" |
    "monthlyNarrativeCreditsReserved" |
    "billingCycleStart" |
    "billingCycleEnd" |
    "monthlyInspirationUsed" |
    "monthlyTextReviewUsed"
  >> = {};

  if (subscription.planTier !== planTier) patch.planTier = planTier;
  if (subscription.monthlyNarrativeCreditLimit !== monthlyLimit) patch.monthlyNarrativeCreditLimit = monthlyLimit;
  if (isCycleExpired(subscription)) {
    patch.monthlyNarrativeCreditsUsed = 0;
    patch.monthlyNarrativeCreditsReserved = 0;
    patch.monthlyInspirationUsed = 0;
    patch.monthlyTextReviewUsed = 0;
    patch.billingCycleStart = cycle.start;
    patch.billingCycleEnd = cycle.end;
  }

  if (!Object.keys(patch).length) return subscription;
  return updateUserSubscriptionGenerationUsage(userId, patch);
}

export async function getAuxiliaryUsageState(userId: number, kind: AuxiliaryUsageKind) {
  const subscription = await normalizeSubscription(userId, await getUserSubscription(userId));
  const planTier = resolvePlanTier(subscription);
  const field = fieldForKind(kind);
  const limit = limitForKind(kind, planTier);
  const used = Math.max(0, subscription[field] ?? 0);
  return { subscription, planTier, field, limit, used, remaining: Math.max(0, limit - used) };
}

export async function consumeAuxiliaryUsage(userId: number, kind: AuxiliaryUsageKind) {
  const state = await getAuxiliaryUsageState(userId, kind);
  if (state.used >= state.limit) {
    throw new TRPCError({ code: "FORBIDDEN", message: LIMIT_REACHED_MESSAGE });
  }
  await updateUserSubscriptionGenerationUsage(userId, {
    [state.field]: state.used + 1,
  });
  return { ...state, usedAfter: state.used + 1 };
}

export async function releaseAuxiliaryUsage(userId: number, kind: AuxiliaryUsageKind) {
  const state = await getAuxiliaryUsageState(userId, kind);
  await updateUserSubscriptionGenerationUsage(userId, {
    [state.field]: Math.max(0, state.used - 1),
  });
}
