import type { InvokeResult, Message, MessageContent, Role } from "../_core/llm";
import type { PlanTier } from "./planConfig";
import {
  type DeepSeekTask,
  getDeepSeekConfig,
  getDeepSeekMaxTokensForTask,
  getDeepSeekModelForTask,
} from "./deepseekConfig";

export class DeepSeekGenerationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DeepSeekGenerationError";
  }
}

function messageContentToText(content: MessageContent | MessageContent[]) {
  if (typeof content === "string") return content;
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.type === "text") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeRole(role: Role): "system" | "user" | "assistant" {
  if (role === "system" || role === "assistant") return role;
  return "user";
}

function mapStatusToErrorCode(status: number) {
  if (status === 401 || status === 403) return "deepseek_auth_error";
  if (status === 429) return "deepseek_rate_limit";
  if (status === 400) return "deepseek_bad_request";
  if (status >= 500) return "deepseek_server_error";
  return "deepseek_unknown_error";
}

function safeErrorMessage(status: number, statusText: string) {
  return `DeepSeek retornou erro ${status}${statusText ? ` (${statusText})` : ""}.`;
}

export async function invokeDeepSeek(args: {
  task: DeepSeekTask;
  planTier: PlanTier;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
}): Promise<InvokeResult> {
  const config = getDeepSeekConfig();
  if (!config.enabled) {
    throw new DeepSeekGenerationError("deepseek_disabled", "DeepSeek nao esta habilitado.");
  }
  if (!config.apiKey) {
    throw new DeepSeekGenerationError("deepseek_auth_error", "DeepSeek esta habilitado, mas a chave nao foi configurada.");
  }

  const model = getDeepSeekModelForTask({ task: args.task, planTier: args.planTier });
  if (!model) {
    throw new DeepSeekGenerationError("deepseek_missing_model", "Modelo DeepSeek nao configurado para esta tarefa/plano.");
  }

  // Cap defensivo: DeepSeek-chat tem hard limit de 8192 tokens de output.
  // Mesmo que config.maxTokens diga 12000 (defaults antigos), o provider
  // recusa com HTTP 400 "max_tokens exceeds limit". Capamos em 8192 aqui
  // pra que qualquer caller (mesmo legado) funcione sem reservar créditos
  // que vão acabar sendo refundados por causa de erro 400.
  // Override via env DEEPSEEK_MAX_OUTPUT_TOKENS (ex.: deepseek-reasoner=32k).
  const PROVIDER_HARD_CAP = Math.max(
    1024,
    Number(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS ?? 8192) || 8192,
  );
  const maxTokens = Math.min(
    args.maxTokens ?? Number.MAX_SAFE_INTEGER,
    getDeepSeekMaxTokensForTask({ task: args.task, planTier: args.planTier }),
    PROVIDER_HARD_CAP,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: args.messages.map((message) => ({
          role: normalizeRole(message.role),
          content: messageContentToText(message.content),
        })),
        temperature: args.temperature ?? 0.7,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    let json: InvokeResult;
    try {
      json = JSON.parse(raw) as InvokeResult;
    } catch {
      throw new DeepSeekGenerationError("deepseek_unknown_error", "DeepSeek retornou uma resposta invalida.");
    }

    if (!response.ok) {
      throw new DeepSeekGenerationError(mapStatusToErrorCode(response.status), safeErrorMessage(response.status, response.statusText));
    }

    const content = json.choices?.[0]?.message?.content;
    const text = typeof content === "string"
      ? content.trim()
      : Array.isArray(content)
        ? content.map((part) => part.type === "text" ? part.text : "").join("").trim()
        : "";

    if (!text) {
      throw new DeepSeekGenerationError("deepseek_empty_output", "DeepSeek retornou uma resposta vazia.");
    }

    return json;
  } catch (error) {
    if (error instanceof DeepSeekGenerationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DeepSeekGenerationError("deepseek_timeout", "Tempo limite da DeepSeek excedido.");
    }
    throw new DeepSeekGenerationError("deepseek_unknown_error", "Falha ao chamar a DeepSeek.");
  } finally {
    clearTimeout(timeout);
  }
}
