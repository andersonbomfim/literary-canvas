import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GenerationJob } from "../../drizzle/schema";
import { generateWithJobEngine } from "./engines";
import { selectGenerationEngine } from "./engineConfig";
import type { GenerationPromptInput } from "./currentEngine";

const ENV_KEYS = [
  "NODE_ENV",
  "RUNPOD_4090_ENABLED",
  "RUNPOD_4090_DRY_RUN",
  "RUNPOD_4090_ALLOWED_PLANS",
  "ALLOW_RUNPOD_IN_PRODUCTION",
  "RUNPOD_4090_ENDPOINT",
  "RUNPOD_API_KEY",
  "DEEPSEEK_ENABLED",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_FREE_MODEL",
  "DEEPSEEK_ESSENTIAL_MODEL",
  "DEEPSEEK_ULTRA_MODEL",
  "DEEPSEEK_REVIEW_MODEL",
  "DEEPSEEK_INSPIRATION_MODEL",
];

const previousEnv = new Map<string, string | undefined>();

function promptInput(): GenerationPromptInput {
  return {
    title: "Teste",
    sceneContext: "Rascunho do autor com conflito, personagem e uma decisao clara para a cena.",
    authorStyle: "Prosa tensa, visual e direta.",
    libraryContext: "Cidade murada, ordem religiosa e conflito politico.",
    negativeRules: ["Nao contradizer o canon."],
    universeContext: "Fantasia sombria em uma cidade isolada.",
    styleRepertoire: "Use subtexto, gesto e consequencia emocional.",
    characterContexts: [{ name: "Lia", role: "protagonista", history: "Carrega culpa e quer proteger a cidade." }],
    referenceContexts: [],
    storyFoundation: "A cidade sobreviveu a ataques noturnos por seculos.",
    continuityMemories: [],
  };
}

function job(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: 1,
    publicId: "gen_dry_run",
    idempotencyKey: "dry-run",
    userId: 1,
    workId: 2,
    draftId: 3,
    chapterId: null,
    outputChapterId: null,
    action: "generate",
    generationMode: "standard",
    planTier: "essential",
    engine: "runpod_4090",
    fallbackEngine: null,
    status: "generating",
    progressMessage: "",
    inputSnapshot: null,
    outputText: null,
    draftVersion: null,
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
    lockedAt: null,
    lockedBy: null,
    lockExpiresAt: null,
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

describe("generation engines", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
  });

  it("selects runpod_4090 only when enabled and the plan is allowed", () => {
    process.env.RUNPOD_4090_ENABLED = "true";
    process.env.RUNPOD_4090_ALLOWED_PLANS = "essential";

    expect(selectGenerationEngine("free")).toBe("current");
    expect(selectGenerationEngine("essential")).toBe("runpod_4090");
  });

  it("refuses accidental RunPod activation in production", () => {
    process.env.NODE_ENV = "production";
    process.env.RUNPOD_4090_ENABLED = "true";
    process.env.RUNPOD_4090_ALLOWED_PLANS = "essential";

    expect(() => selectGenerationEngine("essential")).toThrow(/production/i);
  });

  it("selects DeepSeek by task and plan when enabled", () => {
    process.env.DEEPSEEK_ENABLED = "true";
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DEEPSEEK_FREE_MODEL = "deepseek-free";
    process.env.DEEPSEEK_ESSENTIAL_MODEL = "deepseek-essential";
    process.env.DEEPSEEK_ULTRA_MODEL = "deepseek-ultra";
    process.env.DEEPSEEK_REVIEW_MODEL = "deepseek-review";
    process.env.DEEPSEEK_INSPIRATION_MODEL = "deepseek-inspiration";

    expect(selectGenerationEngine({ planTier: "free", task: "generate" })).toBe("deepseek_free");
    expect(selectGenerationEngine({ planTier: "essential", task: "generate" })).toBe("deepseek_essential");
    expect(selectGenerationEngine({ planTier: "ultra", task: "regenerate" })).toBe("deepseek_ultra");
    expect(selectGenerationEngine({ planTier: "free", task: "review" })).toBe("deepseek_review");
    expect(selectGenerationEngine({ planTier: "ultra", task: "inspiration" })).toBe("deepseek_inspiration");
  });

  it("fails clearly when DeepSeek is enabled without the required model", () => {
    process.env.DEEPSEEK_ENABLED = "true";
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DEEPSEEK_FREE_MODEL = "deepseek-free";

    expect(() => selectGenerationEngine({ planTier: "essential", task: "generate" })).toThrow(/modelo DeepSeek/i);
  });

  it("runs RunPod dry-run without calling a real endpoint", async () => {
    process.env.RUNPOD_4090_ENABLED = "true";
    process.env.RUNPOD_4090_DRY_RUN = "true";

    const result = await generateWithJobEngine(job(), {
      promptInput: promptInput(),
      draftVersion: 1,
      chapterVersion: null,
      requestedMaxOutputWords: 1500,
      inputWordCount: 13,
    });

    expect(result.engine).toBe("runpod_4090");
    expect(result.providerRequestId).toBe("dry_run_gen_dry_run");
    expect(result.estimatedCostUsd).toBe("0");
    expect(result.generationPrompt).toMatch(/Payload compacto/);
    expect(result.content).toMatch(/DRY RUN - RUNPOD 4090/);
    expect(result.outputWordCount).toBeGreaterThan(20);
    expect(result.inputCharCount).toBeGreaterThan(100);
  });
});
