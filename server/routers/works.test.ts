import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { worksRouter } from "./works";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `works-${userId}`,
    email: `works-${userId}@example.com`,
    name: "Works Test",
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
    activeWorkId: null,
  };
}

function uniqueUserId() {
  return Math.floor(1_000_000 + Math.random() * 8_000_000);
}

describe("works router trash flow", () => {
  it("removes a deleted work from active list and keeps it in trash", async () => {
    const caller = worksRouter.createCaller(createTestContext(uniqueUserId()));
    const created = await caller.create({
      title: "Obra para lixeira",
      subtitle: "Teste",
      description: "Obra criada para validar o fluxo de lixeira.",
    });

    await caller.softDelete({ workId: created.data.id });

    const active = await caller.list();
    const trash = await caller.listTrash();

    expect(active.data.some((work) => work.id === created.data.id)).toBe(false);
    expect(trash.data.some((work) => work.id === created.data.id)).toBe(true);
  });

  it("restores only the trashed work without creating an empty placeholder", async () => {
    const caller = worksRouter.createCaller(createTestContext(uniqueUserId()));
    const created = await caller.create({
      title: "Obra restaurada",
      subtitle: "Subtítulo",
      description: "Obra real que deve voltar sozinha.",
      genre: "Suspense",
    });

    await caller.softDelete({ workId: created.data.id });
    await caller.restore({ workId: created.data.id });

    const active = await caller.list();
    const restored = active.data.filter((work) => work.id === created.data.id);
    const emptyPlaceholders = active.data.filter((work) =>
      work.title === "Obra principal" &&
      work.description === "Obra criada automaticamente para organizar o ambiente local."
    );

    expect(restored).toHaveLength(1);
    expect(emptyPlaceholders).toHaveLength(0);
  });

  it("permanently deletes a trashed work", async () => {
    const caller = worksRouter.createCaller(createTestContext(uniqueUserId()));
    const created = await caller.create({ title: "Obra sem volta" });

    await caller.softDelete({ workId: created.data.id });
    await caller.permanentDelete({ workId: created.data.id });

    const trash = await caller.listTrash();

    expect(trash.data.some((work) => work.id === created.data.id)).toBe(false);
  });
});
