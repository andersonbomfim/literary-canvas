import type { PlanTier } from "./planConfig";

// "consistency_audit" entra aqui só por compatibilidade de tipo na
// `selectGenerationEngine` — a auditoria NÃO usa o engine do DeepSeek
// (ela tem seu próprio adapter provider-agnostic em auditEngine.ts).
export type DeepSeekTask = "generate" | "regenerate" | "localized_edit" | "review" | "inspiration" | "consistency_audit";
export type DeepSeekEngineName =
  | "deepseek_free"
  | "deepseek_essential"
  | "deepseek_ultra"
  | "deepseek_review"
  | "deepseek_inspiration";

function envFlag(name: string) {
  return process.env[name]?.toLowerCase() === "true";
}

function intEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function optionalEnv(name: string) {
  return process.env[name]?.trim() || "";
}

export function getDeepSeekConfig() {
  // DeepSeek é o provider ÚNICO desde 2026 (Gemini foi removido). `enabled`
  // é true se há chave configurada — `DEEPSEEK_ENABLED=true` continua sendo
  // aceito como override explícito pra compat com .env antigos.
  const hasKey = Boolean(optionalEnv("DEEPSEEK_API_KEY"));
  return {
    enabled: envFlag("DEEPSEEK_ENABLED") || hasKey,
    apiKey: optionalEnv("DEEPSEEK_API_KEY"),
    baseUrl: optionalEnv("DEEPSEEK_BASE_URL") || "https://api.deepseek.com",
    timeoutSeconds: intEnv("DEEPSEEK_TIMEOUT_SECONDS", 900),
    models: {
      free: optionalEnv("DEEPSEEK_FREE_MODEL"),
      essential: optionalEnv("DEEPSEEK_ESSENTIAL_MODEL"),
      ultra: optionalEnv("DEEPSEEK_ULTRA_MODEL"),
      review: optionalEnv("DEEPSEEK_REVIEW_MODEL"),
      inspiration: optionalEnv("DEEPSEEK_INSPIRATION_MODEL"),
    },
    // ATENÇÃO: DeepSeek-chat tem HARD LIMIT de 8192 tokens de output por
    // chamada. Defaults antigos (12000 pra ultra) faziam a API retornar
    // 400 silenciosamente, resultado: job falhava e o usuário via "cobrou
    // mas não gerou". Capamos em 8000 com folga de 192 tokens. Quem
    // precisar mais (deepseek-reasoner suporta 32k) pode subir via env.
    maxTokens: {
      free: intEnv("DEEPSEEK_FREE_MAX_TOKENS", 2000),
      essential: intEnv("DEEPSEEK_ESSENTIAL_MAX_TOKENS", 6000),
      ultra: intEnv("DEEPSEEK_ULTRA_MAX_TOKENS", 8000),
      review: intEnv("DEEPSEEK_REVIEW_MAX_TOKENS", 4000),
      inspiration: intEnv("DEEPSEEK_INSPIRATION_MAX_TOKENS", 3000),
    },
  };
}

export function isDeepSeekEnabled() {
  return getDeepSeekConfig().enabled;
}

export function isDeepSeekEngineName(engine: string): engine is DeepSeekEngineName {
  return engine === "deepseek_free" ||
    engine === "deepseek_essential" ||
    engine === "deepseek_ultra" ||
    engine === "deepseek_review" ||
    engine === "deepseek_inspiration";
}

export function getDeepSeekEngineForTask(task: DeepSeekTask, planTier: PlanTier): DeepSeekEngineName {
  if (task === "review") return "deepseek_review";
  if (task === "inspiration") return "deepseek_inspiration";
  if (planTier === "ultra") return "deepseek_ultra";
  if (planTier === "essential") return "deepseek_essential";
  return "deepseek_free";
}

export function getDeepSeekModelForTask(args: { task: DeepSeekTask; planTier: PlanTier }) {
  const config = getDeepSeekConfig();
  if (args.task === "review") return config.models.review;
  if (args.task === "inspiration") return config.models.inspiration;
  return config.models[args.planTier];
}

export function getDeepSeekMaxTokensForTask(args: { task: DeepSeekTask; planTier: PlanTier }) {
  const config = getDeepSeekConfig();
  if (args.task === "review") return config.maxTokens.review;
  if (args.task === "inspiration") return config.maxTokens.inspiration;
  return config.maxTokens[args.planTier];
}

export function assertDeepSeekConfiguredForTask(args: { task: DeepSeekTask; planTier: PlanTier }) {
  const config = getDeepSeekConfig();
  if (!config.enabled) return;
  if (!config.apiKey) {
    throw new Error("DEEPSEEK_ENABLED=true, mas DEEPSEEK_API_KEY nao foi configurada.");
  }
  const model = getDeepSeekModelForTask(args);
  if (!model) {
    throw new Error(`DEEPSEEK_ENABLED=true, mas o modelo DeepSeek para ${args.task}/${args.planTier} nao foi configurado.`);
  }
}
