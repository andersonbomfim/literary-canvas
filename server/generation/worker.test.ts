import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  acquireNextGenerationJob: vi.fn(),
  createChapter: vi.fn(),
  createChapterVersion: vi.fn(),
  createGenerationCostLog: vi.fn(),
  createNotification: vi.fn(),
  getWorkById: vi.fn(),
  incrementChapterCount: vi.fn(),
  setDraftStatus: vi.fn(),
  updateGenerationJob: vi.fn(),
}));

const engineMocks = vi.hoisted(() => ({
  generateWithJobEngine: vi.fn(),
  GenerationEngineError: class GenerationEngineError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

const usageMocks = vi.hoisted(() => ({
  confirmNarrativeCredits: vi.fn(),
  releaseNarrativeCredits: vi.fn(),
}));

vi.mock("../db", () => dbMocks);
vi.mock("./engines", () => engineMocks);
vi.mock("./usageLimiter", () => usageMocks);

function snapshot() {
  return JSON.stringify({
    version: 1,
    source: "draft",
    action: "generate",
    draftVersion: 1,
    chapterVersion: null,
    requestedMaxOutputWords: 1500,
    inputWordCount: 42,
    promptInput: {
      title: "Cena inicial",
      sceneContext: "Rascunho do autor com conflito claro.",
      authorStyle: "",
      libraryContext: "",
      negativeRules: [],
      universeContext: "",
      styleRepertoire: "",
      characterContexts: [],
      referenceContexts: [],
      storyFoundation: "",
      continuityMemories: [],
    },
  });
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    publicId: "gen_worker",
    idempotencyKey: "draft:7",
    userId: 10,
    workId: 20,
    draftId: 30,
    chapterId: null,
    outputChapterId: null,
    action: "generate",
    generationMode: "standard",
    planTier: "free",
    engine: "current",
    fallbackEngine: null,
    status: "preparing",
    progressMessage: "",
    inputSnapshot: snapshot(),
    outputText: null,
    draftVersion: 1,
    chapterVersion: null,
    requestedMaxOutputWords: 1500,
    generatedWordCount: 0,
    reservedCredits: 1500,
    reservedMonthlyCredits: 1500,
    reservedExtraCredits: 0,
    confirmedCredits: 0,
    confirmedMonthlyCredits: 0,
    confirmedExtraCredits: 0,
    releasedCredits: 0,
    attempts: 1,
    maxAttempts: 2,
    lockedAt: new Date(),
    lockedBy: "test",
    lockExpiresAt: new Date(Date.now() + 1000),
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("generation worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.acquireNextGenerationJob.mockResolvedValue(makeJob());
    dbMocks.getWorkById.mockResolvedValue({
      id: 20,
      userId: 10,
      title: "Obra ativa",
      status: "in_progress",
    });
    dbMocks.updateGenerationJob.mockImplementation(async (_jobId: number, patch: Record<string, unknown>) => ({
      ...makeJob(),
      ...patch,
    }));
    dbMocks.createChapter.mockResolvedValue({
      id: 55,
      title: "Cena inicial",
      content: "Texto gerado com quatro palavras.",
    });
    dbMocks.createChapterVersion.mockResolvedValue(undefined);
    dbMocks.incrementChapterCount.mockResolvedValue(undefined);
    dbMocks.setDraftStatus.mockResolvedValue(undefined);
    dbMocks.createNotification.mockResolvedValue(undefined);
    dbMocks.createGenerationCostLog.mockImplementation(async (row: Record<string, unknown>) => row);
    usageMocks.confirmNarrativeCredits.mockImplementation(async (job: unknown) => job);
    usageMocks.releaseNarrativeCredits.mockImplementation(async (job: unknown) => job);
    engineMocks.generateWithJobEngine.mockResolvedValue({
      engine: "current",
      title: "Cena inicial",
      content: "Texto gerado com quatro palavras.",
      generationPrompt: "prompt usado",
      inputWordCount: 2,
      inputCharCount: 11,
      outputWordCount: 5,
      outputCharCount: 33,
      providerRequestId: null,
      estimatedCostUsd: null,
      fallbackUsed: 0,
    });
  });

  it("generates with the current engine, saves the chapter and confirms credits", async () => {
    const { runGenerationWorkerOnce } = await import("./worker");

    const processed = await runGenerationWorkerOnce("worker-test");

    expect(processed).toBe(true);
    expect(engineMocks.generateWithJobEngine).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "current" }),
      expect.objectContaining({
        requestedMaxOutputWords: 1500,
        promptInput: expect.objectContaining({ sceneContext: "Rascunho do autor com conflito claro." }),
      }),
    );
    expect(dbMocks.createChapter).toHaveBeenCalledWith(10, expect.objectContaining({
      title: "Cena inicial",
      content: "Texto gerado com quatro palavras.",
      draftId: 30,
      workId: 20,
    }), 20);
    expect(dbMocks.createChapterVersion).toHaveBeenCalledWith(55, 10, "Texto gerado com quatro palavras.", expect.any(String));
    expect(dbMocks.setDraftStatus).toHaveBeenCalledWith(30, 10, "sent_to_writing", 20);
    expect(usageMocks.confirmNarrativeCredits).toHaveBeenCalledWith(
      expect.objectContaining({ outputChapterId: 55 }),
      5,
    );
    expect(dbMocks.createGenerationCostLog).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
      inputWordCount: 2,
      outputWordCount: 5,
      inputCharCount: 11,
      outputCharCount: 33,
      fallbackUsed: 0,
    }));
  });

  it("releases the reservation and writes a failed cost log when generation fails", async () => {
    const failingJob = makeJob();
    dbMocks.acquireNextGenerationJob.mockResolvedValue(failingJob);
    engineMocks.generateWithJobEngine.mockRejectedValue(new Error("engine down"));
    dbMocks.updateGenerationJob.mockImplementation(async (_jobId: number, patch: Record<string, unknown>) => ({
      ...failingJob,
      ...patch,
    }));
    const { runGenerationWorkerOnce } = await import("./worker");

    const processed = await runGenerationWorkerOnce("worker-test");

    expect(processed).toBe(true);
    expect(usageMocks.releaseNarrativeCredits).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "generation_failed" }),
      expect.stringMatching(/Falha t[eé]cnica/),
    );
    expect(dbMocks.createGenerationCostLog).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "generation_failed",
      outputWordCount: 0,
      inputCharCount: expect.any(Number),
      outputCharCount: 0,
      fallbackUsed: 0,
    }));
  });

  it("cancels and releases credits when the work is already in trash", async () => {
    dbMocks.getWorkById.mockResolvedValue(undefined);
    const { runGenerationWorkerOnce } = await import("./worker");

    const processed = await runGenerationWorkerOnce("worker-test");

    expect(processed).toBe(true);
    expect(engineMocks.generateWithJobEngine).not.toHaveBeenCalled();
    expect(dbMocks.createChapter).not.toHaveBeenCalled();
    expect(dbMocks.updateGenerationJob).toHaveBeenCalledWith(7, expect.objectContaining({
      status: "canceled",
      errorCode: "work_deleted",
    }));
    expect(usageMocks.releaseNarrativeCredits).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled", errorCode: "work_deleted" }),
      expect.stringMatching(/obra removida/i),
    );
  });

  it("does not save generated text if the work is trashed before finalizing", async () => {
    dbMocks.getWorkById
      .mockResolvedValueOnce({
        id: 20,
        userId: 10,
        title: "Obra ativa",
        status: "in_progress",
      })
      .mockResolvedValueOnce(undefined);
    const { runGenerationWorkerOnce } = await import("./worker");

    const processed = await runGenerationWorkerOnce("worker-test");

    expect(processed).toBe(true);
    expect(engineMocks.generateWithJobEngine).toHaveBeenCalled();
    expect(dbMocks.createChapter).not.toHaveBeenCalled();
    expect(usageMocks.confirmNarrativeCredits).not.toHaveBeenCalled();
    expect(dbMocks.updateGenerationJob).toHaveBeenCalledWith(7, expect.objectContaining({
      status: "canceled",
      errorCode: "work_deleted",
    }));
    expect(usageMocks.releaseNarrativeCredits).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled", errorCode: "work_deleted" }),
      expect.stringMatching(/obra removida/i),
    );
  });
});
