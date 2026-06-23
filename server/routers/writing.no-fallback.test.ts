import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 101,
    openId: "writing-no-fallback",
    email: "writing-no-fallback@example.com",
    name: "Writing No Fallback",
    loginMethod: "local",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    failedLoginCount: 0,
    lockedUntil: null,
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    activeWorkId: 777,
  };
}

describe("writing router async generation entrypoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../db");
    vi.doUnmock("../generation/createJob");
    vi.doUnmock("../_core/llm");
  });

  it("creates a generation job instead of calling the LLM synchronously", async () => {
    const getWorkById = vi.fn().mockResolvedValue({
      id: 777,
      userId: 101,
      title: "Obra ativa",
      status: "planning",
      isDefault: "true",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const createGenerationJobForUser = vi.fn().mockResolvedValue({
      reused: false,
      response: {
        jobId: "gen_public_123",
        status: "queued",
        progressMessage: "Seu capítulo entrou na fila de geração.",
        reservedCredits: 1500,
      },
    });
    const invokeLLM = vi.fn();

    vi.doMock("../db", () => ({ getWorkById }));
    vi.doMock("../generation/createJob", () => ({ createGenerationJobForUser }));
    vi.doMock("../_core/llm", () => ({ invokeLLM }));

    const { writingRouter } = await import("./writing");
    const caller = writingRouter.createCaller(createTestContext());

    const result = await caller.generateChapter({
      draftId: 11,
      title: "Capítulo de teste",
      sceneContext: "Rascunho bruto com material suficiente para gerar capítulo.",
      idempotencyKey: "test-key-1",
    });

    expect(result.data).toMatchObject({
      jobId: "gen_public_123",
      status: "queued",
      reused: false,
    });
    expect(createGenerationJobForUser).toHaveBeenCalledWith({
      userId: 101,
      workId: 777,
      input: {
        draftId: 11,
        action: "generate",
        generationMode: "standard",
        requestedMaxOutputWords: null,
        idempotencyKey: "test-key-1",
      },
    });
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  it("returns the existing queued job when idempotency reuses one", async () => {
    const getWorkById = vi.fn().mockResolvedValue({
      id: 777,
      userId: 101,
      title: "Obra ativa",
      status: "planning",
      isDefault: "true",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const createGenerationJobForUser = vi.fn().mockResolvedValue({
      reused: true,
      response: {
        jobId: "gen_public_reused",
        status: "queued",
        progressMessage: "Já existe uma geração em andamento para este rascunho.",
        reservedCredits: 1500,
      },
    });

    vi.doMock("../db", () => ({ getWorkById }));
    vi.doMock("../generation/createJob", () => ({ createGenerationJobForUser }));

    const { writingRouter } = await import("./writing");
    const caller = writingRouter.createCaller(createTestContext());

    const result = await caller.generateChapter({
      draftId: 44,
      sceneContext: "Mesmo rascunho.",
      idempotencyKey: "same-draft",
    });

    expect(result.data.jobId).toBe("gen_public_reused");
    expect(result.data.reused).toBe(true);
  });

  it("requires a saved draft before creating a job", async () => {
    const getWorkById = vi.fn().mockResolvedValue({
      id: 777,
      userId: 101,
      title: "Obra ativa",
      status: "planning",
      isDefault: "true",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const createGenerationJobForUser = vi.fn();

    vi.doMock("../db", () => ({ getWorkById }));
    vi.doMock("../generation/createJob", () => ({ createGenerationJobForUser }));

    const { writingRouter } = await import("./writing");
    const caller = writingRouter.createCaller(createTestContext());

    await expect(caller.generateChapter({
      sceneContext: "Texto solto sem rascunho salvo.",
    })).rejects.toThrow(/rascunho salvo/);
    expect(createGenerationJobForUser).not.toHaveBeenCalled();
  });
});
