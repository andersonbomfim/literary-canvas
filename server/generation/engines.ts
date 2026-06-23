import type { GenerationJob } from "../../drizzle/schema";
import { countWords } from "./planConfig";
import { generateWithCurrentEngine, normalizeOptionalTitle } from "./currentEngine";
import type { GenerationPayload } from "./payloadBuilder";
import { buildPayloadForEngine } from "./payloadBuilder";
import { normalizeJobEngine, type GenerationEngineName } from "./engineConfig";
import { generateWithRunpod4090, RunpodGenerationError } from "./runpodClient";
import { GenerationQualityError, validateGenerationOutput } from "./qualityGate";
import { DeepSeekGenerationError, invokeDeepSeek } from "./deepseekClient";
import { isDeepSeekEngineName, type DeepSeekTask } from "./deepseekConfig";

export type EngineGenerationResult = {
  engine: GenerationEngineName;
  title: string;
  content: string;
  generationPrompt: string;
  inputWordCount: number;
  inputCharCount: number;
  outputWordCount: number;
  outputCharCount: number;
  providerRequestId: string | null;
  estimatedCostUsd: string | null;
  fallbackUsed: number;
};

export class GenerationEngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "GenerationEngineError";
  }
}

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json|text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractGeneratedTitle(raw: string) {
  const cleaned = stripCodeFence(raw);
  const titleLine = cleaned.match(/^\s*T(?:I|\u00cd)TULO(?:[\s_]+PROVIS(?:O|\u00d3)RIO)?\s*:\s*(.+)\s*$/im);
  if (!titleLine) return { title: "", content: cleaned };

  const title = titleLine[1]
    .trim()
    .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "")
    .slice(0, 255);
  const withoutTitle = cleaned.replace(titleLine[0], "").trim();
  const content = withoutTitle.replace(/^\s*CAP(?:I|\u00cd)TULO\s*:\s*/i, "").trim();
  return { title, content };
}

function toEngineError(error: unknown): never {
  if (error instanceof GenerationQualityError) {
    throw new GenerationEngineError(error.code, error.message);
  }
  if (error instanceof RunpodGenerationError) {
    throw new GenerationEngineError(error.code, error.message);
  }
  if (error instanceof DeepSeekGenerationError) {
    throw new GenerationEngineError(error.code, error.message);
  }
  throw error;
}

function responseText(value: Awaited<ReturnType<typeof invokeDeepSeek>>) {
  const content = value.choices[0]?.message.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => part.type === "text" ? part.text : "").join("").trim();
  }
  return "";
}

function taskFromJobAction(action: GenerationJob["action"]): DeepSeekTask {
  if (action === "regenerate") return "regenerate";
  if (action === "localized_edit") return "localized_edit";
  return "generate";
}

export async function generateWithJobEngine(
  job: GenerationJob,
  snapshot: Omit<GenerationPayload, "inputSnapshot">,
): Promise<EngineGenerationResult> {
  const engine = normalizeJobEngine(job.engine);

  try {
    if (isDeepSeekEngineName(engine)) {
      const compactPayload = buildPayloadForEngine(snapshot.promptInput, engine, snapshot.requestedMaxOutputWords);
      const task = taskFromJobAction(job.action);
      const deepSeekResult = await invokeDeepSeek({
        task,
        planTier: job.planTier,
        messages: [
          {
            role: "system",
            content: [
              "Voce e um motor literario para escritores profissionais.",
              "Escreva em portugues brasileiro natural, com prosa literaria, concreta e especifica.",
              "Nao resuma o rascunho, nao transforme a historia em sinopse e nao use linguagem generica de IA.",
              "O rascunho do autor e a espinha dorsal obrigatoria: cubra os eventos em ordem, sem trocar a trama por outra e sem cortar blocos inteiros.",
              "Se o rascunho for longo, trabalhe como editor literario de capitulo: organize, lapide e complete a cena, mas preserve a substancia.",
              "Respeite o canon, o tom, os personagens, as restricoes e o objetivo do capitulo.",
            ].join("\n"),
          },
          { role: "user", content: compactPayload.prompt },
        ],
      });
      const rawText = responseText(deepSeekResult);

      validateGenerationOutput({
        content: rawText,
        requestedMaxOutputWords: snapshot.requestedMaxOutputWords,
        sourceWordCount: snapshot.inputWordCount,
        action: job.action,
      });

      const parsed = extractGeneratedTitle(rawText);
      const title = parsed.title || normalizeOptionalTitle(snapshot.promptInput.title) || "Capitulo provisorio";
      const content = parsed.content || rawText;
      return {
        engine,
        title,
        content,
        generationPrompt: `[${engine}] Payload compacto nao armazenado para privacidade.`,
        inputWordCount: compactPayload.inputWordCount,
        inputCharCount: compactPayload.inputCharCount,
        outputWordCount: countWords(content),
        outputCharCount: content.length,
        providerRequestId: deepSeekResult.id ?? null,
        estimatedCostUsd: null,
        fallbackUsed: 0,
      };
    }

    if (engine === "runpod_4090") {
      const compactPayload = buildPayloadForEngine(snapshot.promptInput, engine, snapshot.requestedMaxOutputWords);
      const runpodResult = await generateWithRunpod4090({
        publicJobId: job.publicId,
        prompt: compactPayload.prompt,
        requestedMaxOutputWords: snapshot.requestedMaxOutputWords,
      });

      validateGenerationOutput({
        content: runpodResult.text,
        requestedMaxOutputWords: snapshot.requestedMaxOutputWords,
        dryRun: runpodResult.dryRun,
        sourceWordCount: snapshot.inputWordCount,
        action: job.action,
      });

      const parsed = extractGeneratedTitle(runpodResult.text);
      const title = parsed.title || normalizeOptionalTitle(snapshot.promptInput.title) || "Capítulo provisório";
      const content = parsed.content || runpodResult.text;
      return {
        engine,
        title,
        content,
        generationPrompt: "[runpod_4090] Payload compacto não armazenado para privacidade.",
        inputWordCount: compactPayload.inputWordCount,
        inputCharCount: compactPayload.inputCharCount,
        outputWordCount: countWords(content),
        outputCharCount: content.length,
        providerRequestId: runpodResult.providerRequestId,
        estimatedCostUsd: runpodResult.estimatedCostUsd,
        fallbackUsed: 0,
      };
    }

    const currentResult = await generateWithCurrentEngine(snapshot.promptInput, snapshot.requestedMaxOutputWords);
    validateGenerationOutput({
      content: currentResult.content,
      requestedMaxOutputWords: snapshot.requestedMaxOutputWords,
      sourceWordCount: snapshot.inputWordCount,
      action: job.action,
    });

    return {
      engine,
      title: currentResult.title,
      content: currentResult.content,
      generationPrompt: currentResult.userPrompt,
      inputWordCount: countWords(currentResult.userPrompt),
      inputCharCount: currentResult.userPrompt.length,
      outputWordCount: countWords(currentResult.content),
      outputCharCount: currentResult.content.length,
      providerRequestId: null,
      estimatedCostUsd: null,
      fallbackUsed: 0,
    };
  } catch (error) {
    toEngineError(error);
  }
}
