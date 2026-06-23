import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  getBillingSummary,
  grantCredits,
  upsertUserSubscription,
  writeAuditLog,
} from "../db";
import { getAuxiliaryUsageState } from "../generation/auxiliaryUsage";
import {
  getAnalysisUsageState,
  getNarrativeUsageState,
} from "../generation/usageLimiter";

export const billingRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user!.id;
    const narrative = await getNarrativeUsageState(userId);
    const analysis = await getAnalysisUsageState(userId);
    const inspiration = await getAuxiliaryUsageState(userId, "inspiration");
    const textReview = await getAuxiliaryUsageState(userId, "textReview");
    const summary = await getBillingSummary(userId);

    return {
      success: true,
      data: {
        ...summary,
        credits: {
          wallet: {
            balance: summary.wallet.balance,
            available: summary.wallet.balance,
            label: "Créditos flexíveis",
          },
          narrative: {
            planTier: narrative.planTier,
            monthlyLimit: narrative.monthlyLimit,
            monthlyUsed: summary.subscription.monthlyNarrativeCreditsUsed,
            monthlyReserved:
              summary.subscription.monthlyNarrativeCreditsReserved,
            monthlyAvailable: narrative.monthlyAvailable,
            extraAvailable: narrative.extraAvailable,
            remaining: narrative.remainingNarrativeCredits,
          },
          analysis: {
            planTier: analysis.planTier,
            monthlyLimit: analysis.monthlyLimit,
            monthlyUsed: summary.subscription.monthlyAnalysisCreditsUsed,
            monthlyReserved:
              summary.subscription.monthlyAnalysisCreditsReserved,
            monthlyAvailable: analysis.monthlyAvailable,
            extraAvailable: analysis.extraAvailable,
            remaining: analysis.remainingAnalysisCredits,
          },
          auxiliary: {
            inspiration: {
              limit: inspiration.limit,
              used: inspiration.used,
              remaining: inspiration.remaining,
            },
            textReview: {
              limit: textReview.limit,
              used: textReview.used,
              remaining: textReview.remaining,
            },
          },
        },
      },
    };
  }),

  grantCredits: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        amount: z.number().int().min(1),
        reason: z.string().min(3),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const wallet = await grantCredits(
        input.userId,
        input.amount,
        input.reason,
        { type: "adjustment", reference: "admin-grant" }
      );
      // A09 (OWASP) — toda concessão manual de créditos vira entrada no audit
      // log, separada do creditLedger (que é financeiro). Aqui guardamos o
      // ator humano + IP para revisão de incidente.
      await writeAuditLog({
        actorId: ctx.user!.id,
        actorEmail: ctx.user!.email ?? null,
        action: "billing.credits_granted",
        targetType: "user",
        targetId: input.userId,
        metadata: JSON.stringify({
          amount: input.amount,
          reason: input.reason,
        }),
        ipAddress: ctx.req.ip ?? null,
      });
      return { success: true, data: wallet };
    }),

  setPlan: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        planCode: z.enum(["weekly", "monthly", "yearly", "none"]),
        status: z.enum(["active", "paused", "canceled", "trial", "none"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const subscription = await upsertUserSubscription(input.userId, input);
      await writeAuditLog({
        actorId: ctx.user!.id,
        actorEmail: ctx.user!.email ?? null,
        action: "billing.plan_changed",
        targetType: "user",
        targetId: input.userId,
        metadata: JSON.stringify({
          planCode: input.planCode,
          status: input.status,
        }),
        ipAddress: ctx.req.ip ?? null,
      });
      return { success: true, data: subscription };
    }),
});
