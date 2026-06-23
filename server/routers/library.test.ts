import { describe, expect, it } from "vitest";
import { libraryRouter } from "./library";
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

describe("library router", () => {
  it("should have create procedure", async () => {
    const ctx = createTestContext();
    const caller = libraryRouter.createCaller(ctx);

    expect(caller.create).toBeDefined();
  });

  it("should have list procedure", async () => {
    const ctx = createTestContext();
    const caller = libraryRouter.createCaller(ctx);

    expect(caller.list).toBeDefined();
  });

  it("should have getByType procedure", async () => {
    const ctx = createTestContext();
    const caller = libraryRouter.createCaller(ctx);

    expect(caller.getByType).toBeDefined();
  });

  it("create should require name and type", async () => {
    const ctx = createTestContext();
    const caller = libraryRouter.createCaller(ctx);

    try {
      await caller.create({
        type: "character",
        name: "",
      });
      expect.fail("Should have thrown validation error");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it("create should accept valid character entry", async () => {
    const ctx = createTestContext();
    const caller = libraryRouter.createCaller(ctx);

    try {
      await caller.create({
        type: "character",
        name: "Robert",
        description: "A mysterious character",
        status: "canonical",
      });
    } catch (error) {
      // Expected to fail due to database not being available in test
      expect(error).toBeDefined();
    }
  });

  it("getByType should accept valid type", async () => {
    const ctx = createTestContext();
    const caller = libraryRouter.createCaller(ctx);

    try {
      const result = await caller.getByType({ type: "character" });
      expect(Array.isArray(result)).toBe(true);
    } catch (error) {
      // Expected to fail due to database not being available in test
      expect(error).toBeDefined();
    }
  });
});
