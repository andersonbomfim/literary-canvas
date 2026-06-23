import { describe, expect, it } from "vitest";
import {
  canReceivePlanWalletAllowance,
  getPlanWalletAllowance,
  planWalletGrantReference,
  legacyPlanWalletGrantReferences,
  resolvePlanWalletAllowance,
} from "./billingPolicy";

describe("billingPolicy", () => {
  it("keeps flexible-credit allowances centralized", () => {
    expect(getPlanWalletAllowance("weekly")).toBe(250);
    expect(getPlanWalletAllowance("monthly")).toBe(1200);
    expect(getPlanWalletAllowance("yearly")).toBe(18000);
    expect(getPlanWalletAllowance("none")).toBe(0);
    expect(getPlanWalletAllowance("invalid")).toBe(0);
  });

  it("only grants monthly wallet allowance to active paid plans", () => {
    expect(
      canReceivePlanWalletAllowance({ planCode: "monthly", status: "active" })
    ).toBe(true);
    expect(
      canReceivePlanWalletAllowance({ planCode: "monthly", status: "trial" })
    ).toBe(true);
    expect(
      canReceivePlanWalletAllowance({ planCode: "monthly", status: "canceled" })
    ).toBe(false);
    expect(
      canReceivePlanWalletAllowance({ planCode: "none", status: "active" })
    ).toBe(false);
  });

  it("uses stable local-month references for idempotent plan grants", () => {
    const date = new Date(2026, 4, 30);
    expect(planWalletGrantReference("monthly", date)).toBe(
      "plan-wallet:2026-05"
    );
    expect(legacyPlanWalletGrantReferences("monthly", date)).toEqual([
      "plan:monthly:2026-05",
      "plan-wallet:monthly:2026-05",
    ]);
  });

  it("honors explicit positive allowances before plan defaults", () => {
    expect(
      resolvePlanWalletAllowance({ planCode: "monthly", creditAllowance: 77 })
    ).toBe(77);
    expect(
      resolvePlanWalletAllowance({ planCode: "monthly", creditAllowance: 0 })
    ).toBe(1200);
  });
});
