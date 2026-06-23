import { UserVisibleError } from "@shared/_core/errors";
import { ENV } from "./env";

/**
 * Core LLM client — DeepSeek-only.
 *
 * Histórico: o app começou Gemini-only, depois ganhou DeepSeek opcional, e
 * por fim teve o Gemini cortado completamente porque (a) o projeto Gemini
 * estava sendo negado repetidamente pela Google em produção, (b) DeepSeek
 * dá controle melhor do tamanho de output, e (c) ter dois providers
 * pendurados causava bugs sutis (clamping de maxTokens, fallbacks que
 * mascaravam falhas reais, etc).
 *
 * Hoje TUDO que faz `invokeLLM(...)` cai em DeepSeek. A interface pública
 * (`InvokeParams`, `InvokeResult`, `Message`, ...) foi preservada pra que
 * nenhum caller precise mudar.
 *
 * Configuração esperada no .env:
 *   DEEPSEEK_API_KEY: <sua-chave>                 (obrigatório)
 *   DEEPSEEK_BASE_URL=https://api.deepseek.com    (opcional)
 *   DEEPSEEK_ANALYSIS_MODEL=deepseek-chat         (opcional)
 *   DEEPSEEK_TIMEOUT_SECONDS=900                  (opcional)
 *
 * Observação sobre context: DeepSeek-chat tem 64k tokens. Nós capamos
 * cada chamada em maxTokens 32k de OUTPUT — o input fica com 32k pra
 * prompt+conteúdo. Pra obras maiores, o caller (analysisSource,
 * summarizeReference, audit/improvements engines) SPLITTA em chunks de
 * ~5k palavras (≈7.5k tokens) e faz map-reduce.
 */

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  timeoutMs?: number;
  /** Override pontual do modelo DeepSeek. Default vem do .env. */
  model?: string;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  /** Temperatura DeepSeek. Default 0.7. */
  temperature?: number;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

// ─────────────────────────────────────────────────────────────────────────
// Helpers de mensagem (compatíveis com qualquer caller já existente).
// ─────────────────────────────────────────────────────────────────────────

function deepseekRoleFor(role: Role): "system" | "user" | "assistant" {
  if (role === "system" || role === "assistant") return role;
  return "user";
}

function deepseekMessageText(content: MessageContent | MessageContent[]): string {
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

const DEFAULT_MAX_TOKENS = 8192;
// DeepSeek-chat tem MAX OUTPUT de 8192 tokens (hard limit do provider).
// Pedidos maiores são silenciosamente cortados em 8192. Pra resumos longos
// (>5k palavras), o caller precisa encadear chamadas. Ver
// `routers/profile.ts:summarizeReference` que gera em duas partes.
// `deepseek-reasoner` aceita até 32k de output, mas é mais caro/lento;
// quem usar pode subir esse cap via env DEEPSEEK_MAX_OUTPUT_TOKENS.
const HARD_CAP_OUTPUT_TOKENS = Math.max(
  1024,
  Number(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS ?? 8192) || 8192,
);
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_RETRIES = 2; // total de tentativas em erros transitórios (5xx/429/timeout)
const RETRY_BASE_MS = 1500;

function isTransientStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────
// invokeLLM — chamada única ao DeepSeek com retry em transientes
// ─────────────────────────────────────────────────────────────────────────

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new UserVisibleError(
      "DEEPSEEK_API_KEY não está configurada no .env. Configure-a para ativar a IA.",
    );
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  // Prioridade: param.model > DEEPSEEK_ANALYSIS_MODEL > DEEPSEEK_ULTRA_MODEL > default.
  // Permite que callers narrativos (writingRouter via invokeDeepSeek) escolham
  // modelo diferente do default das análises.
  const model = params.model?.trim()
    || process.env.DEEPSEEK_ANALYSIS_MODEL?.trim()
    || process.env.DEEPSEEK_ULTRA_MODEL?.trim()
    || "deepseek-chat";

  const requested = params.maxTokens || params.max_tokens || DEFAULT_MAX_TOKENS;
  const maxTokens = Math.min(requested, HARD_CAP_OUTPUT_TOKENS);
  const temperature = params.temperature ?? DEFAULT_TEMPERATURE;

  const timeoutSeconds = Math.max(60, Number(process.env.DEEPSEEK_TIMEOUT_SECONDS ?? 900) || 900);
  const timeoutMs = params.timeoutMs ?? timeoutSeconds * 1000;

  const payload: Record<string, unknown> = {
    model,
    messages: params.messages.map((message) => ({
      role: deepseekRoleFor(message.role),
      content: deepseekMessageText(message.content),
    })),
    temperature,
    max_tokens: maxTokens,
  };
  const responseFormat = params.response_format || params.responseFormat;
  if (responseFormat) payload.response_format = responseFormat;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < DEFAULT_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const rawText = await response.text();

      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.error(`[DeepSeek] HTTP ${response.status} (${model}): ${rawText.slice(0, 500)}`);
        if (isTransientStatus(response.status) && attempt < DEFAULT_RETRIES - 1) {
          const backoff = RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
          await sleep(backoff);
          continue;
        }
        // Erro do tipo "auth/key inválida/quota": joga user-facing genérico.
        if (response.status === 401 || response.status === 403) {
          throw new UserVisibleError("Chave de API inválida ou sem acesso. Verifique DEEPSEEK_API_KEY.");
        }
        if (response.status === 400) {
          // 400 normalmente é input mal montado ou maxTokens > contexto.
          throw new UserVisibleError("Requisição inválida para o provedor de IA. Tente novamente.");
        }
        throw new Error(`DeepSeek HTTP ${response.status}`);
      }

      let json: InvokeResult;
      try {
        json = JSON.parse(rawText) as InvokeResult;
      } catch {
        // eslint-disable-next-line no-console
        console.error(`[DeepSeek] resposta não-JSON (${model}): ${rawText.slice(0, 500)}`);
        throw new Error("DeepSeek devolveu resposta inesperada.");
      }

      if (process.env.LOG_LEVEL === "debug") {
        // eslint-disable-next-line no-console
        console.debug(`[DeepSeek] usage (${model}):`, (json as { usage?: unknown }).usage);
      }
      return json;
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        // eslint-disable-next-line no-console
        console.warn(`[DeepSeek] timeout (${timeoutMs}ms) em ${model}, tentativa ${attempt + 1}/${DEFAULT_RETRIES}`);
        lastError = new Error(`DeepSeek timeout após ${timeoutMs / 1000}s`);
        if (attempt < DEFAULT_RETRIES - 1) {
          const backoff = RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
          await sleep(backoff);
          continue;
        }
        throw new UserVisibleError("A IA demorou demais para responder. Tente novamente em instantes.");
      }
      // UserVisibleError ou erro já formatado — só repassa.
      if (error instanceof UserVisibleError) throw error;
      lastError = error as Error;
      if (attempt < DEFAULT_RETRIES - 1) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
        await sleep(backoff);
        continue;
      }
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  // eslint-disable-next-line no-console
  console.error("[DeepSeek] todas as tentativas falharam:", lastError);
  throw new UserVisibleError("Falha ao gerar conteúdo com a IA. Tente novamente em instantes.");
}
