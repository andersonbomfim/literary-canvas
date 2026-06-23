import { getRunpod4090Config } from "./engineConfig";

export class RunpodGenerationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "RunpodGenerationError";
  }
}

export type RunpodGenerationResult = {
  text: string;
  providerRequestId: string | null;
  estimatedCostUsd: string | null;
  dryRun: boolean;
};

function extractText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) {
    return payload.map(extractText).filter(Boolean).join("\n\n");
  }
  if (!payload || typeof payload !== "object") return "";

  const record = payload as Record<string, unknown>;
  const direct = record.text ?? record.output ?? record.generated_text ?? record.generatedText;
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct) || (direct && typeof direct === "object")) return extractText(direct);

  const nestedOutput = record.output;
  if (nestedOutput && typeof nestedOutput === "object") {
    const outputRecord = nestedOutput as Record<string, unknown>;
    if (typeof outputRecord.text === "string") return outputRecord.text;
    if (typeof outputRecord.generated_text === "string") return outputRecord.generated_text;
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string") return message.content;
    if (typeof first?.text === "string") return first.text;
  }

  return "";
}

function extractProviderRequestId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const id = record.id ?? record.requestId ?? record.request_id ?? record.jobId ?? record.job_id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export async function generateWithRunpod4090(args: {
  prompt: string;
  requestedMaxOutputWords: number;
  publicJobId: string;
}): Promise<RunpodGenerationResult> {
  const config = getRunpod4090Config();

  if (config.dryRun) {
    return {
      providerRequestId: `dry_run_${args.publicJobId}`,
      estimatedCostUsd: "0",
      dryRun: true,
      text: `[DRY RUN - RUNPOD 4090]

Este é um texto simulado de geração para validar o fluxo assíncrono, logs, reserva de créditos e interface de espera.

O conteúdo real será gerado apenas quando RUNPOD_4090_DRY_RUN=false. Este parágrafo existe para passar pelo quality gate de forma previsível, sem chamar a RunPod real e sem consumir GPU durante o teste controlado.`,
    };
  }

  if (!config.endpoint || !config.apiKey) {
    throw new RunpodGenerationError("runpod_not_configured", "RunPod 4090 não está configurada.");
  }

  const endpointUrl = buildRunpodEndpointUrl(config.endpoint, config.timeoutSeconds);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);

  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        authorization: config.apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        input: {
          model: config.model,
          prompt: args.prompt,
          maxOutputWords: args.requestedMaxOutputWords,
          metadata: {
            jobId: args.publicJobId,
            engine: "runpod_4090",
          },
        },
      }),
    });

    const responseText = await response.text();
    let payload: unknown = responseText;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = responseText;
    }

    if (!response.ok) {
      throw new RunpodGenerationError("runpod_http_error", `RunPod retornou HTTP ${response.status}.`);
    }

    const status = typeof payload === "object" && payload !== null
      ? String((payload as Record<string, unknown>).status ?? "").toUpperCase()
      : "";
    if (status === "FAILED" || status === "ERROR" || status === "CANCELLED" || status === "TIMED_OUT") {
      throw new RunpodGenerationError(`runpod_${status.toLowerCase()}`, `RunPod retornou status ${status}.`);
    }

    return {
      text: extractText(payload).trim(),
      providerRequestId: extractProviderRequestId(payload),
      estimatedCostUsd: null,
      dryRun: false,
    };
  } catch (error) {
    if (error instanceof RunpodGenerationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new RunpodGenerationError("runpod_timeout", "RunPod excedeu o tempo limite.");
    }
    throw new RunpodGenerationError("runpod_request_failed", "Falha técnica ao chamar RunPod.");
  } finally {
    clearTimeout(timeout);
  }
}

function buildRunpodEndpointUrl(endpointOrUrl: string, timeoutSeconds: number) {
  if (/^https?:\/\//i.test(endpointOrUrl)) return endpointOrUrl;
  const endpointId = encodeURIComponent(endpointOrUrl.trim());
  const waitMs = Math.min(300_000, Math.max(1_000, timeoutSeconds * 1000));
  return `https://api.runpod.ai/v2/${endpointId}/runsync?wait=${waitMs}`;
}
