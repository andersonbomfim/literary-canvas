import { TRPCError } from "@trpc/server";
import type { Character, Draft, LibraryEntry } from "../../drizzle/schema";
import {
  getCharactersByUserId,
  getChapterById,
  getDraftById,
  getOrCreateAuthorProfile,
  getSeriesContextForWork,
  getUserChapters,
  getUserLibraryEntries,
  getWorkById,
} from "../db";
import { buildStyleRepertoireGuidance } from "../_core/styleRepertoire";
import { escapePromptInjection } from "../_core/promptSanitize";
import { clampRequestedMaxOutputWords, countWords, maxDraftWordsPerGeneration, minDraftWordsToGenerate, type PlanTier } from "./planConfig";
import type { GenerationPromptInput } from "./currentEngine";
import { normalizeOptionalTitle } from "./currentEngine";
import type { GenerationEngineName } from "./engineConfig";

// Match com `generationJobs.action` no schema.ts. `consistency_audit` e
// `narrative_improvements` estão listados pra compat com o enum do banco,
// mas este builder NÃO monta payload pra eles — Auditoria vai por
// createAuditJob.ts e Melhorias por createImprovementsJob.ts. Os routers
// narrativos filtram essas duas fora do schema Zod aceito.
export type GenerationAction = "generate" | "regenerate" | "localized_edit" | "consistency_audit" | "narrative_improvements";
export type NarrativeGenerationAction = Exclude<GenerationAction, "consistency_audit" | "narrative_improvements">;

export type BuildGenerationPayloadArgs = {
  userId: number;
  workId: number;
  draftId?: number | null;
  chapterId?: number | null;
  action?: GenerationAction;
  generationMode?: "standard" | "premium";
  requestedMaxOutputWords?: number | null;
  planTier: PlanTier;
  remainingNarrativeCredits: number;
  legacyPromptInput?: GenerationPromptInput | null;
};

export type GenerationPayload = {
  inputSnapshot: string;
  promptInput: GenerationPromptInput;
  draftVersion: number | null;
  chapterVersion: number | null;
  requestedMaxOutputWords: number;
  inputWordCount: number;
};

export type EnginePromptPayload = {
  prompt: string;
  inputWordCount: number;
  inputCharCount: number;
  compact: boolean;
};

function timestampVersion(date: Date | string | null | undefined) {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000);
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asTextList(value: string | null | undefined) {
  const parsed = safeJsonParse<unknown>(value, null);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => typeof item === "string" ? item.trim() : JSON.stringify(item))
      .filter(Boolean);
  }
  return value?.trim() ? [value.trim()] : [];
}

function clipped(value: string | null | undefined, maxChars: number) {
  const text = value?.trim() ?? "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}\n[recorte aplicado para manter o contexto compacto]`;
}

function compactReferenceContent(value: unknown) {
  const text = String(value ?? "").trim();
  if (text.length <= 9000) return text;
  const opening = clipped(text, 4500);
  const ending = text.slice(Math.max(0, text.length - 3500)).trim();
  return [
    "Trecho inicial da referencia importada:",
    opening,
    "Trecho final da referencia importada:",
    ending,
    "[referencia longa recortada no prompt de escrita; a analise profunda usa o arquivo integral por blocos]",
  ].join("\n\n");
}

function compactReferenceAnalysisBlocks(value: unknown) {
  if (!Array.isArray(value)) return "";
  const validBlocks = value.filter(
    item =>
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).dossier === "string" &&
      String((item as Record<string, unknown>).dossier).trim()
  );
  const maxTotalChars = 52_000;
  const maxPerBlock = Math.max(
    1500,
    Math.min(4200, Math.floor(maxTotalChars / Math.max(1, validBlocks.length)))
  );
  const blocks = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      const title = String(record.title ?? `Bloco ${index + 1}`).trim();
      const dossier = clipped(String(record.dossier ?? "").trim(), maxPerBlock);
      if (!dossier) return "";
      const anchors = Array.isArray(record.sourceAnchors)
        ? record.sourceAnchors
            .filter(item => typeof item === "string" && item.trim())
            .slice(0, 80)
            .join(", ")
        : "";
      const blockIndex =
        typeof record.index === "number" && Number.isFinite(record.index)
          ? record.index
          : index + 1;
      return [
        `[Bloco ${blockIndex}] ${title}`,
        anchors ? `Âncoras literais: ${anchors}` : "",
        dossier,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean);

  if (!blocks.length) return "";
  return [
    "Dossies preservados por capitulo/bloco da importacao:",
    "Use todos os blocos em ordem como memoria factual da obra importada. Quando houver conflito com fichas, universo ou biblioteca, estes dossies prevalecem.",
    blocks.join("\n\n---\n\n"),
  ].join("\n\n");
}

function compactReferenceFromRecord(
  record: Record<string, unknown>,
  fallback: unknown
) {
  const analysis = compactReferenceAnalysisBlocks(record.analysisBlocks);
  return (
    analysis ||
    compactReferenceContent(record.content ?? record.description ?? fallback ?? "")
  );
}

function compactSection(title: string, body: string | null | undefined) {
  const text = body?.trim();
  return text ? `## ${title}\n${escapePromptInjection(text)}` : "";
}

function buildDraftSourceContext(draft: Draft) {
  return [
    draft.content?.trim() ? `Rascunho bruto integral do autor:\n${draft.content.trim()}` : "",
    draft.summary?.trim() ? `Resumo opcional do autor:\n${draft.summary.trim()}` : "",
    draft.sceneLocation?.trim() ? `Local da cena:\n${draft.sceneLocation.trim()}` : "",
    draft.bookReference?.trim() ? `Livro/parte indicada:\n${draft.bookReference.trim()}` : "",
    draft.chapterNumber?.trim() ? `Capítulo indicado:\n${draft.chapterNumber.trim()}` : "",
    draft.untouchableDialogue?.trim() ? `Falas que devem ser preservadas:\n${draft.untouchableDialogue.trim()}` : "",
    draft.untouchableScenes?.trim() ? `Trechos que devem ser preservados:\n${draft.untouchableScenes.trim()}` : "",
    draft.canonicalFacts?.trim() ? `Fatos canônicos manuais:\n${draft.canonicalFacts.trim()}` : "",
    draft.notes?.trim() ? `Observações do autor:\n${draft.notes.trim()}` : "",
  ].filter(Boolean).join("\n\n");
}

function characterText(character: Character) {
  return [
    character.history,
    character.personality ? `Personalidade: ${character.personality}` : "",
    character.speechStyle ? `Voz/fala: ${character.speechStyle}` : "",
    character.psychologicalProfile ? `Psicológico: ${character.psychologicalProfile}` : "",
    character.motivations ? `Motivações: ${character.motivations}` : "",
    character.relationships ? `Relações: ${character.relationships}` : "",
    character.notes ? `Notas: ${character.notes}` : "",
  ].filter(Boolean).join("\n");
}

function selectCharactersForDraft(draft: Draft, characters: Character[]) {
  const refs = safeJsonParse<Array<string | number>>(draft.mainCharacters, []);
  const refSet = new Set(refs.map((item) => String(item).toLowerCase()));
  const content = `${draft.content}\n${draft.summary ?? ""}\n${draft.notes ?? ""}`.toLowerCase();
  const selected = characters.filter((character) =>
    refSet.has(String(character.id).toLowerCase()) ||
    refSet.has(character.name.toLowerCase()) ||
    content.includes(character.name.toLowerCase()),
  );
  return (selected.length ? selected : characters.slice(0, 6)).slice(0, 12);
}

function libraryText(entries: LibraryEntry[]) {
  return entries.map((entry) => {
    const details = [entry.description, entry.details].filter(Boolean).join("\n");
    return `**${entry.name}** (${entry.type}, ${entry.status ?? "sem status"})\n${details}`;
  }).join("\n\n----------------\n\n");
}

function profileReferences(raw: string | null | undefined): GenerationPromptInput["referenceContexts"] {
  const parsed = safeJsonParse<unknown>(raw, null);
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown> | null)?.customReferences)
      ? ((parsed as Record<string, unknown>).customReferences as unknown[])
      : [];
  if (!candidates.length) {
    return raw?.trim()
      ? [{ title: "Capítulos-chave", content: compactReferenceContent(raw), notes: "", sourceType: "profile", fileName: "" }]
      : [];
  }
  return candidates.slice(0, 8).map((item, index) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return {
      title: String(record.title ?? record.name ?? `Referência ${index + 1}`),
      content: compactReferenceFromRecord(record, item),
      notes: String(record.notes ?? ""),
      sourceType: String(record.sourceType ?? record.type ?? "profile"),
      fileName: String(record.fileName ?? ""),
    };
  }).filter((item) => item.content.trim());
}

function compactProfileReferences(
  raw: string | null | undefined
): GenerationPromptInput["referenceContexts"] {
  const parsed = safeJsonParse<unknown>(raw, null);
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown> | null)?.customReferences)
      ? ((parsed as Record<string, unknown>).customReferences as unknown[])
      : [];

  if (!candidates.length) {
    return raw?.trim()
      ? [
          {
            title: "Capitulos-chave",
            content: compactReferenceContent(raw),
            notes: "",
            sourceType: "profile",
            fileName: "",
          },
        ]
      : [];
  }

  return candidates
    .slice(0, 8)
    .map((item, index) => {
      const record =
        typeof item === "object" && item !== null
          ? (item as Record<string, unknown>)
          : {};
      return {
        title: String(record.title ?? record.name ?? `Referencia ${index + 1}`),
        content: compactReferenceFromRecord(record, item),
        notes: String(record.notes ?? ""),
        sourceType: String(record.sourceType ?? record.type ?? "profile"),
        fileName: String(record.fileName ?? ""),
      };
    })
    .filter(item => item.content.trim());
}

function continuityMemories(raw: string | null | undefined): GenerationPromptInput["continuityMemories"] {
  const parsed = safeJsonParse<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(-20).map((item) => {
    const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
    return {
      chapterId: Number(record.chapterId ?? 0),
      chapterTitle: String(record.chapterTitle ?? record.title ?? "Capítulo"),
      summary: String(record.summary ?? ""),
      stateChanges: Array.isArray(record.stateChanges) ? record.stateChanges.map(String) : [],
      canonicalFacts: Array.isArray(record.canonicalFacts) ? record.canonicalFacts.map(String) : [],
      openLoops: Array.isArray(record.openLoops) ? record.openLoops.map(String) : [],
      impactedCharacters: Array.isArray(record.impactedCharacters) ? record.impactedCharacters.map(String) : [],
    };
  }).filter((item) => item.summary.trim());
}

function buildSnapshot(payload: Omit<GenerationPayload, "inputSnapshot"> & { source: string; action: GenerationAction }) {
  return JSON.stringify({
    version: 1,
    source: payload.source,
    action: payload.action,
    promptInput: payload.promptInput,
    draftVersion: payload.draftVersion,
    chapterVersion: payload.chapterVersion,
    requestedMaxOutputWords: payload.requestedMaxOutputWords,
    inputWordCount: payload.inputWordCount,
  });
}

export function parseGenerationSnapshot(inputSnapshot: string | null | undefined): Omit<GenerationPayload, "inputSnapshot"> | null {
  const parsed = safeJsonParse<Record<string, unknown>>(inputSnapshot, {});
  const promptInput = parsed.promptInput as GenerationPromptInput | undefined;
  if (!promptInput?.sceneContext) return null;
  return {
    promptInput,
    draftVersion: typeof parsed.draftVersion === "number" ? parsed.draftVersion : null,
    chapterVersion: typeof parsed.chapterVersion === "number" ? parsed.chapterVersion : null,
    requestedMaxOutputWords: Number(parsed.requestedMaxOutputWords ?? 0),
    inputWordCount: Number(parsed.inputWordCount ?? countWords(promptInput.sceneContext)),
  };
}

export function buildPayloadForEngine(
  promptInput: GenerationPromptInput,
  engine: GenerationEngineName,
  requestedMaxOutputWords: number,
): EnginePromptPayload {
  if (engine === "current") {
    return {
      prompt: promptInput.sceneContext,
      inputWordCount: countWords(promptInput.sceneContext),
      inputCharCount: promptInput.sceneContext.length,
      compact: false,
    };
  }

  const characters = promptInput.characterContexts
    .slice(0, 12)
    .map((character) => `- ${character.name} (${character.role || "personagem"}): ${clipped(character.history, 1600)}`)
    .join("\n");
  const references = promptInput.referenceContexts
    .slice(0, 4)
    .map((item) => `- ${item.title}: ${clipped([item.notes, item.content].filter(Boolean).join("\n"), 900)}`)
    .join("\n");
  const continuity = promptInput.continuityMemories
    .slice(-6)
    .map((item) => [
      `- ${item.chapterTitle}: ${clipped(item.summary, 500)}`,
      item.stateChanges.length ? `  Mudanças: ${item.stateChanges.slice(0, 5).join("; ")}` : "",
      item.canonicalFacts.length ? `  Fatos: ${item.canonicalFacts.slice(0, 5).join("; ")}` : "",
      item.openLoops.length ? `  Pontas abertas: ${item.openLoops.slice(0, 5).join("; ")}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n");

  const prompt = [
    "TAREFA PRINCIPAL: transformar o rascunho integral do autor em um capitulo final, mantendo a mesma historia, a mesma cronologia e os mesmos acontecimentos.",
    "O rascunho e a fonte primaria obrigatoria. Nao crie outro capitulo, nao substitua a trama, nao transforme a viagem/cena em resumo e nao pule blocos narrativos importantes.",
    "Cobertura obrigatoria: leia o rascunho do primeiro ao ultimo paragrafo, monte internamente uma lista de eventos e cubra todos em ordem. Se houver repeticoes, una as repeticoes sem perder detalhes unicos.",
    "Preserve nomes, termos do universo, regras de poder, relacoes, motivacoes, locais, datas aproximadas, falas intocaveis e consequencias. Nao contradiga o canon fornecido.",
    "Aprimore prosa, ritmo, transicoes, descricao e subtexto, mas sem apagar fatos do autor. Expanda apenas para dar cena, sensacao e continuidade; nunca para trocar o sentido.",
    `Você é um motor literário. Escreva um capítulo completo a partir do rascunho do autor, sem resumir e sem trocar a história por premissa genérica.`,
    `Teto operacional: até ${requestedMaxOutputWords} palavras. O teto é limite, não meta.`,
    `Preserve intenção, fatos, ordem emocional, personagens, falas intocáveis e consequências. Não contradiga o cânone fornecido.`,
    normalizeOptionalTitle(promptInput.title)
      ? `Título informado: ${normalizeOptionalTitle(promptInput.title)}`
      : "Título não informado: crie um título provisório curto e específico.",
    compactSection("Tom e estilo", clipped([
      promptInput.authorStyle ? `Essência absorvida:\n${promptInput.authorStyle}` : "",
      promptInput.styleRepertoire ? `Repertório técnico:\n${promptInput.styleRepertoire}` : "",
    ].filter(Boolean).join("\n\n"), 6_000)),
    compactSection("Rascunho integral do autor - fonte primaria obrigatoria", promptInput.sceneContext),
    "Saida obrigatoria: prosa corrida de capitulo, nao sinopse. Use o material do autor como espinha dorsal e entregue uma versao final completa dentro do teto.",
    compactSection("Personagens ativos", characters || "Não informado"),
    compactSection("Universo essencial", clipped([
      promptInput.storyFoundation ? `Base da obra/série:\n${promptInput.storyFoundation}` : "",
      promptInput.universeContext ? `Universo:\n${promptInput.universeContext}` : "",
      promptInput.libraryContext ? `Cânone pesquisável:\n${promptInput.libraryContext}` : "",
      promptInput.negativeRules.length ? `Regras/limites:\n${promptInput.negativeRules.map((rule) => `- ${rule}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"), 5_000)),
    compactSection("Acontecimentos recentes e referências", clipped([continuity, references].filter(Boolean).join("\n\n"), 4_000)),
    `Saída: prosa corrida. Se criar título provisório, use a primeira linha "TITULO_PROVISORIO: ...", depois "CAPITULO:" e o texto.`,
  ].filter(Boolean).join("\n\n");

  return {
    prompt,
    inputWordCount: countWords(prompt),
    inputCharCount: prompt.length,
    compact: true,
  };
}

export async function buildGenerationPayload(args: BuildGenerationPayloadArgs): Promise<GenerationPayload> {
  const action = args.action ?? "generate";
  const requestedMaxOutputWords = clampRequestedMaxOutputWords({
    planTier: args.planTier,
    userRequestedMaxOutputWords: args.requestedMaxOutputWords,
    remainingNarrativeCredits: args.remainingNarrativeCredits,
    action,
  });
  if (requestedMaxOutputWords <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem créditos narrativos disponíveis para gerar este capítulo." });
  }

  if (args.legacyPromptInput) {
    const inputWordCount = countWords(args.legacyPromptInput.sceneContext);
    if (inputWordCount > maxDraftWordsPerGeneration[args.planTier]) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `O rascunho tem ${inputWordCount} palavras. O limite do seu plano é ${maxDraftWordsPerGeneration[args.planTier]}.`,
      });
    }
    const chapter = args.chapterId ? await getChapterById(args.chapterId, args.userId, args.workId) : undefined;
    const payload = {
      promptInput: args.legacyPromptInput,
      draftVersion: null,
      chapterVersion: timestampVersion(chapter?.updatedAt),
      requestedMaxOutputWords,
      inputWordCount,
    };
    return {
      ...payload,
      inputSnapshot: buildSnapshot({ ...payload, source: "writing_legacy_input", action }),
    };
  }

  if (!args.draftId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione um rascunho salvo para gerar na Escrita." });
  }

  const draft = await getDraftById(args.draftId, args.userId, args.workId);
  if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Rascunho não encontrado." });
  const draftWordCount = countWords(draft.content);
  if (draftWordCount <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "O rascunho está vazio." });
  }
  if (action === "generate" && draftWordCount < minDraftWordsToGenerate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Para gerar um capítulo com IA, escreva pelo menos 1.000 palavras no rascunho. Isso ajuda a IA a entender melhor sua intenção, o ritmo da cena e o caminho narrativo.",
    });
  }
  if (draftWordCount > maxDraftWordsPerGeneration[args.planTier]) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Rascunho com ${draftWordCount.toLocaleString("pt-BR")} palavras excede o limite do seu plano (${maxDraftWordsPerGeneration[args.planTier].toLocaleString("pt-BR")}). Reduza o rascunho ou faça upgrade de plano para gerar.`,
    });
  }

  const [work, profile, characters, libraryEntries, chapters, seriesContext] = await Promise.all([
    getWorkById(args.workId, args.userId),
    getOrCreateAuthorProfile(args.userId, args.workId),
    getCharactersByUserId(args.userId, args.workId, { limit: 100 }),
    getUserLibraryEntries(args.userId, undefined, args.workId, { limit: 40 }),
    getUserChapters(args.userId, args.workId, { limit: 20 }),
    getSeriesContextForWork(args.userId, args.workId),
  ]);

  const selectedCharacters = selectCharactersForDraft(draft, characters);
  const universeContext = [
    profile.negativeRules?.trim() ? profile.negativeRules.trim() : "",
    profile.keyElements?.trim() ? profile.keyElements.trim() : "",
  ].filter(Boolean).join("\n\n");
  const storyFoundation = [
    seriesContext.contextText?.trim() ? `Contexto de série:\n${seriesContext.contextText.trim()}` : "",
    profile.storyFoundation?.trim() ? profile.storyFoundation.trim() : "",
  ].filter(Boolean).join("\n\n================\n\n");
  const libraryContext = clipped(libraryText(libraryEntries.slice(0, 25)), 9000);
  const styleRepertoire = buildStyleRepertoireGuidance({
    title: normalizeOptionalTitle(draft.title) || work?.title,
    subtitle: work?.subtitle,
    genre: work?.genre,
    description: work?.description,
    sceneContext: draft.content,
    universeContext,
    libraryContext,
    authorStyle: profile.narrativeStyle,
  });
  const promptInput: GenerationPromptInput = {
    title: normalizeOptionalTitle(draft.title),
    sceneContext: buildDraftSourceContext(draft),
    authorStyle: profile.narrativeStyle ?? "",
    libraryContext,
    negativeRules: asTextList(profile.negativeRules),
    universeContext,
    styleRepertoire,
    characterContexts: selectedCharacters.map((character) => ({
      name: character.name,
      history: characterText(character),
      role: character.role ?? "",
    })),
    referenceContexts: [
      ...compactProfileReferences(profile.keyChapters),
      ...chapters.slice(0, 6).map((chapter) => ({
        title: chapter.title,
        content: chapter.content.slice(0, 4000),
        notes: "Capítulo já existente da obra.",
        sourceType: "chapter",
        fileName: "",
      })),
    ],
    storyFoundation,
    continuityMemories: continuityMemories(profile.continuityMemories),
  };
  const payload = {
    promptInput,
    draftVersion: timestampVersion(draft.updatedAt),
    chapterVersion: null,
    requestedMaxOutputWords,
    inputWordCount: draftWordCount,
  };
  return {
    ...payload,
    inputSnapshot: buildSnapshot({ ...payload, source: "draft", action }),
  };
}
