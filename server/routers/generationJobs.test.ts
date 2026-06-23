import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const dbMocks = vi.hoisted(() => ({
  getChapterById: vi.fn(),
  getGenerationJobByPublicId: vi.fn(),
  listActiveGenerationJobs: vi.fn(),
  updateGenerationJob: vi.fn(),
}));

const usageMocks = vi.hoisted(() => ({
  releaseNarrativeCredits: vi.fn(),
}));

vi.mock("../db", () => dbMocks);
vi.mock("../generation/usageLimiter", () => usageMocks);
vi.mock("../generation/createJob", () => ({
  createGenerationJobForUser: vi.fn(),
  serializeGenerationJob: (job: any) => ({
    jobId: job.publicId,
    status: job.status,
    progressMessage: job.progressMessage,
    outputChapterId: job.outputChapterId,
    generatedWordCount: job.generatedWordCount,
    requestedMaxOutputWords: job.requestedMaxOutputWords,
    reservedCredits: job.reservedCredits,
    confirmedCredits: job.confirmedCredits,
  }),
}));
vi.mock("../generation/worker", () => ({ scheduleGenerationWorker: vi.fn() }));
vi.mock("../generation/payloadBuilder", () => ({ parseGenerationSnapshot: vi.fn() }));

function context(): TrpcContext {
  return {
    user: {
      id: 10,
      openId: "generation-jobs",
      email: "generation@example.com",
      name: "Generation User",
      loginMethod: "local",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    activeWorkId: 20,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    publicId: "gen_cancel",
    userId: 10,
    workId: 20,
    outputChapterId: null,
    status: "queued",
    progressMessage: "Seu capítulo entrou na fila de geração.",
    requestedMaxOutputWords: 1500,
    generatedWordCount: 0,
    reservedCredits: 1500,
    confirmedCredits: 0,
    releasedCredits: 0,
    startedAt: null,
    ...overrides,
  };
}

describe("generationJobs router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getGenerationJobByPublicId.mockResolvedValue(makeJob());
    usageMocks.releaseNarrativeCredits.mockImplementation(async (job: any) => ({
      ...job,
      releasedCredits: job.reservedCredits,
    }));
    dbMocks.updateGenerationJob.mockImplementation(async (_id: number, patch: Record<string, unknown>) => ({
      ...makeJob(),
      ...patch,
    }));
  });

  it("cancels a queued job and releases its reservation", async () => {
    const { generationJobsRouter } = await import("./generationJobs");
    const caller = generationJobsRouter.createCaller(context());

    const result = await caller.cancel({ jobId: "gen_cancel" });

    expect(usageMocks.releaseNarrativeCredits).toHaveBeenCalledWith(
      expect.objectContaining({ publicId: "gen_cancel" }),
      expect.stringMatching(/Cancelamento/),
    );
    expect(dbMocks.updateGenerationJob).toHaveBeenCalledWith(1, expect.objectContaining({
      status: "canceled",
      releasedCredits: 1500,
    }));
    expect(result.data.status).toBe("canceled");
  });

  it("does not cancel a job that already started generating", async () => {
    dbMocks.getGenerationJobByPublicId.mockResolvedValue(makeJob({
      status: "generating",
      startedAt: new Date(),
    }));
    const { generationJobsRouter } = await import("./generationJobs");
    const caller = generationJobsRouter.createCaller(context());

    await expect(caller.cancel({ jobId: "gen_cancel" })).rejects.toThrow(/já começou|cancelamento/i);
    expect(usageMocks.releaseNarrativeCredits).not.toHaveBeenCalled();
  });
});
