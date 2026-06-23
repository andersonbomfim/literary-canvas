import type { GenerationJob } from "../../drizzle/schema";
import type { PlanTier } from "./planConfig";
import {
  assertDeepSeekConfiguredForTask,
  type DeepSeekEngineName,
  type DeepSeekTask,
  getDeepSeekEngineForTask,
  isDeepSeekEnabled,
  isDeepSeekEngineName,
} from "./deepseekConfig";

export type GenerationEngineName = "current" | "runpod_4090" | DeepSeekEngineName;
export type SelectGenerationEngineArgs = PlanTier | { planTier: PlanTier; task?: DeepSeekTask };

function envFlag(name: string) {
  return process.env[name]?.toLowerCase() === "true";
}

function parseAllowedPlans(value: string | undefined): PlanTier[] {
  const raw = value?.trim() || "essential";
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is PlanTier => item === "free" || item === "essential" || item === "ultra");
}

export function getRunpod4090Config() {
  return {
    enabled: envFlag("RUNPOD_4090_ENABLED"),
    dryRun: envFlag("RUNPOD_4090_DRY_RUN"),
    allowProduction: envFlag("ALLOW_RUNPOD_IN_PRODUCTION"),
    allowedPlans: parseAllowedPlans(process.env.RUNPOD_4090_ALLOWED_PLANS),
    endpoint: process.env.RUNPOD_4090_ENDPOINT?.trim() || "",
    apiKey: process.env.RUNPOD_API_KEY?.trim() || "",
    model: process.env.RUNPOD_4090_MODEL?.trim() || "runpod-4090",
    timeoutSeconds: Math.max(1, Number(process.env.RUNPOD_4090_TIMEOUT_SECONDS ?? 600) || 600),
  };
}

export function selectGenerationEngine(args: SelectGenerationEngineArgs): GenerationEngineName {
  const planTier = typeof args === "string" ? args : args.planTier;
  const task = typeof args === "string" ? "generate" : args.task ?? "generate";

  if (isDeepSeekEnabled()) {
    assertDeepSeekConfiguredForTask({ task, planTier });
    return getDeepSeekEngineForTask(task, planTier);
  }

  const config = getRunpod4090Config();
  if (!config.enabled) return "current";

  if (task === "review" || task === "inspiration") return "current";

  if (process.env.NODE_ENV === "production" && !config.allowProduction) {
    throw new Error("RUNPOD_4090_ENABLED cannot be used in production without ALLOW_RUNPOD_IN_PRODUCTION=true.");
  }

  if (!config.allowedPlans.includes(planTier)) return "current";
  return "runpod_4090";
}

export function normalizeJobEngine(engine: GenerationJob["engine"]): GenerationEngineName {
  if (engine === "runpod_4090") return "runpod_4090";
  if (isDeepSeekEngineName(engine)) return engine;
  return "current";
}
