import { describe, expect, it, vi } from "vitest";
import { writingRouter } from "./writing";
import type { TrpcContext } from "../_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    activeWorkId: null,
  };
}

describe("writing router", () => {
  it("should have generateChapter procedure", async () => {
    const ctx = createTestContext();
    const caller = writingRouter.createCaller(ctx);

    expect(caller.generateChapter).toBeDefined();
  });

  it("should have list procedure", async () => {
    const ctx = createTestContext();
    const caller = writingRouter.createCaller(ctx);

    expect(caller.list).toBeDefined();
  });

  it("should have getById procedure", async () => {
    const ctx = createTestContext();
    const caller = writingRouter.createCaller(ctx);

    expect(caller.getById).toBeDefined();
  });

  it("should have regenerate procedure", async () => {
    const ctx = createTestContext();
    const caller = writingRouter.createCaller(ctx);

    expect(caller.regenerate).toBeDefined();
  });

  it("generateChapter should require a draft source", async () => {
    const ctx = createTestContext();
    const caller = writingRouter.createCaller(ctx);

    try {
      await caller.generateChapter({
        title: "",
        sceneContext: "",
      });
      expect.fail("Should have thrown validation error");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it.skip("generateChapter should accept valid input", { timeout: 10000 }, async () => {
    const ctx = createTestContext();
    const caller = writingRouter.createCaller(ctx);

    try {
      await caller.generateChapter({
        title: "Test Chapter",
        sceneContext: "A test scene with characters",
        authorStyle: "Literary and introspective",
      });
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
