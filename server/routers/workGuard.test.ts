import { describe, expect, it } from "vitest";
import { draftsRouter } from "./drafts";
import { libraryRouter } from "./library";
import { worksRouter } from "./works";
import type { TrpcContext } from "../_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(userId: number, activeWorkId: number | null = null): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `work-guard-${userId}`,
    email: `work-guard-${userId}@example.com`,
    name: "Work Guard",
    loginMethod: "local",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    activeWorkId,
  };
}

function uniqueUserId() {
  return Math.floor(200000 + Math.random() * 700000);
}

describe("work write guard", () => {
  it("blocks draft creation without an active work", async () => {
    const caller = draftsRouter.createCaller(createTestContext(uniqueUserId()));

    await expect(caller.create({
      title: "Rascunho sem obra",
      content: "Texto bruto do autor.",
    })).rejects.toThrow("Selecione uma obra ativa");
  });

  it("blocks drafts and library writes while the active work is paused", async () => {
    const userId = uniqueUserId();
    const worksCaller = worksRouter.createCaller(createTestContext(userId));
    const created = await worksCaller.create({ title: "Obra pausada", status: "paused" });
    const pausedContext = createTestContext(userId, created.data.id);

    await expect(draftsRouter.createCaller(pausedContext).create({
      title: "Rascunho pausado",
      content: "Texto bruto do autor.",
    })).rejects.toThrow("está pausada");

    await expect(libraryRouter.createCaller(pausedContext).create({
      type: "location",
      name: "Cidade congelada",
      description: "Lugar do cânone.",
    })).rejects.toThrow("está pausada");
  });
});
