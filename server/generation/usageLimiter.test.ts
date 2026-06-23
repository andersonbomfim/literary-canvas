import { beforeEach, describe, expect, it, vi } from "vitest";

let subscription: any;
let job: any;
const ledgerEntries: any[] = [];

vi.mock("../db", () => ({
  getUserSubscription: vi.fn(async () => subscription),
  updateUserSubscriptionGenerationUsage: vi.fn(async (_userId: number, patch: Record<string, unknown>) => {
    subscription = { ...subscription, ...patch, updatedAt: new Date() };
    return subscription;
  }),
  createGenerationUsageLedgerEntry: vi.fn(async (entry: Record<string, unknown>) => {
    const row = { id: ledgerEntries.length + 1, createdAt: new Date(), ...entry };
    ledgerEntries.push(row);
    return row;
  }),
  updateGenerationJob: vi.fn(async (_jobId: number, patch: Record<string, unknown>) => {
    job = { ...job, ...patch, updatedAt: new Date() };
    return job;
  }),
}));

function currentBillingCycle() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  const cycle = currentBillingCycle();
  return {
    id: 1,
    userId: 10,
    planCode: "none",
    planTier: "free",
    status: "active",
    renewsAt: null,
    creditAllowance: 0,
    monthlyNarrativeCreditLimit: 5000,
    monthlyNarrativeCreditsUsed: 4000,
    monthlyNarrativeCreditsReserved: 0,
    extraNarrativeCredits: 700,
    extraNarrativeCreditsReserved: 0,
    billingCycleStart: cycle.start,
    billingCycleEnd: cycle.end,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    publicId: "gen_test",
    userId: 10,
    workId: 20,
    reservedCredits: 0,
    reservedMonthlyCredits: 0,
    reservedExtraCredits: 0,
    confirmedCredits: 0,
    confirmedMonthlyCredits: 0,
    confirmedExtraCredits: 0,
    releasedCredits: 0,
    ...overrides,
  };
}

describe("narrative usage limiter", () => {
  beforeEach(() => {
    subscription = makeSubscription();
    job = makeJob();
    ledgerEntries.length = 0;
  });

  it("reserves monthly credits first and then extra credits", async () => {
    const { reserveNarrativeCredits } = await import("./usageLimiter");

    const reserved = await reserveNarrativeCredits(job, 1200);

    expect(reserved).toMatchObject({
      reservedCredits: 1200,
      reservedMonthlyCredits: 1000,
      reservedExtraCredits: 200,
    });
    expect(subscription.monthlyNarrativeCreditsReserved).toBe(1000);
    expect(subscription.extraNarrativeCreditsReserved).toBe(200);
    expect(ledgerEntries.map((entry) => [entry.type, entry.source, entry.amount])).toEqual([
      ["reserve", "monthly", 1000],
      ["reserve", "extra", 200],
    ]);
  });

  it("confirms only generated words and releases the unused reservation", async () => {
    const { reserveNarrativeCredits, confirmNarrativeCredits } = await import("./usageLimiter");

    const reserved = await reserveNarrativeCredits(job, 1200);
    const confirmed = await confirmNarrativeCredits(reserved, 900);

    expect(confirmed).toMatchObject({
      confirmedCredits: 900,
      confirmedMonthlyCredits: 900,
      confirmedExtraCredits: 0,
      releasedCredits: 300,
      generatedWordCount: 900,
    });
    expect(subscription.monthlyNarrativeCreditsUsed).toBe(4900);
    expect(subscription.monthlyNarrativeCreditsReserved).toBe(0);
    expect(subscription.extraNarrativeCredits).toBe(700);
    expect(subscription.extraNarrativeCreditsReserved).toBe(0);
    expect(ledgerEntries.map((entry) => [entry.type, entry.source, entry.amount])).toEqual([
      ["reserve", "monthly", 1000],
      ["reserve", "extra", 200],
      ["confirm", "monthly", 900],
      ["release", "monthly", 100],
      ["release", "extra", 200],
    ]);
  });

  it("releases reserved credits when a queued job is canceled", async () => {
    const { reserveNarrativeCredits, releaseNarrativeCredits } = await import("./usageLimiter");

    const reserved = await reserveNarrativeCredits(job, 1200);
    const released = await releaseNarrativeCredits(reserved, "Cancelado antes de gerar.");

    expect(released.releasedCredits).toBe(1200);
    expect(subscription.monthlyNarrativeCreditsReserved).toBe(0);
    expect(subscription.extraNarrativeCreditsReserved).toBe(0);
    expect(ledgerEntries.map((entry) => [entry.type, entry.source, entry.amount])).toEqual([
      ["reserve", "monthly", 1000],
      ["reserve", "extra", 200],
      ["release", "monthly", 1000],
      ["release", "extra", 200],
    ]);
  });

  it("rejects a reservation above monthly and extra availability", async () => {
    subscription = makeSubscription({
      monthlyNarrativeCreditsUsed: 5000,
      extraNarrativeCredits: 0,
    });
    const { reserveNarrativeCredits } = await import("./usageLimiter");

    await expect(reserveNarrativeCredits(job, 1)).rejects.toThrow(/limite mensal|créditos extras|upgrade/i);
    expect(ledgerEntries).toHaveLength(0);
  });
});
