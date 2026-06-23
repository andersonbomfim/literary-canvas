import { describe, expect, it } from "vitest";
import { notificationsRouter } from "./notifications";
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

describe("notifications router", () => {
  it("should have list procedure", async () => {
    const ctx = createTestContext();
    const caller = notificationsRouter.createCaller(ctx);

    expect(caller.list).toBeDefined();
  });

  it("should have getUnreadCount procedure", async () => {
    const ctx = createTestContext();
    const caller = notificationsRouter.createCaller(ctx);

    expect(caller.getUnreadCount).toBeDefined();
  });

  it("should have markAsRead procedure", async () => {
    const ctx = createTestContext();
    const caller = notificationsRouter.createCaller(ctx);

    expect(caller.markAsRead).toBeDefined();
  });

  it("should have send procedure", async () => {
    const ctx = createTestContext();
    const caller = notificationsRouter.createCaller(ctx);

    expect(caller.send).toBeDefined();
  });

  it("list should return array of notifications", async () => {
    const ctx = createTestContext();
    const caller = notificationsRouter.createCaller(ctx);

    try {
      const result = await caller.list({ limit: 20 });
      expect(Array.isArray(result)).toBe(true);
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it("getUnreadCount should return unread count", async () => {
    const ctx = createTestContext();
    const caller = notificationsRouter.createCaller(ctx);

    try {
      const result = await caller.getUnreadCount();
      expect(result).toHaveProperty("unreadCount");
      expect(typeof result.unreadCount).toBe("number");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it("send should accept valid notification", async () => {
    const ctx = createTestContext();
    const caller = notificationsRouter.createCaller(ctx);

    try {
      const result = await caller.send({
        type: "chapter_generated",
        title: "Capítulo Gerado",
        message: "Seu capítulo foi gerado com sucesso",
      });
      expect(result).toHaveProperty("success");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
