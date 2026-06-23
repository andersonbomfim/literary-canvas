import type { UserSubscription } from "../drizzle/schema";

export type PlanCode = UserSubscription["planCode"];

export const STARTER_WALLET_CREDITS = 200;

export const PLAN_WALLET_ALLOWANCE_BY_CODE: Record<PlanCode, number> = {
  none: 0,
  weekly: 250,
  monthly: 1200,
  yearly: 18000,
};

export function normalizePlanCode(
  planCode: string | null | undefined
): PlanCode {
  if (planCode === "weekly" || planCode === "monthly" || planCode === "yearly")
    return planCode;
  return "none";
}

export function getPlanWalletAllowance(planCode: string | null | undefined) {
  return PLAN_WALLET_ALLOWANCE_BY_CODE[normalizePlanCode(planCode)];
}

export function canReceivePlanWalletAllowance(
  subscription: Pick<UserSubscription, "planCode" | "status">
) {
  return (
    normalizePlanCode(subscription.planCode) !== "none" &&
    (subscription.status === "active" || subscription.status === "trial")
  );
}

export function resolvePlanWalletAllowance(
  subscription: Pick<UserSubscription, "planCode" | "creditAllowance">
) {
  const explicitAllowance = Math.max(
    0,
    Math.floor(subscription.creditAllowance ?? 0)
  );
  return explicitAllowance > 0
    ? explicitAllowance
    : getPlanWalletAllowance(subscription.planCode);
}

export function billingMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function planWalletGrantReference(
  planCode: string | null | undefined,
  date = new Date()
) {
  return `plan-wallet:${billingMonthKey(date)}`;
}

export function legacyPlanWalletGrantReferences(
  planCode: string | null | undefined,
  date = new Date()
) {
  const normalizedPlan = normalizePlanCode(planCode);
  const month = billingMonthKey(date);
  return [
    `plan:${normalizedPlan}:${month}`,
    `plan-wallet:${normalizedPlan}:${month}`,
  ];
}
