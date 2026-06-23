import { UserVisibleError } from "@shared/_core/errors";
import { z } from "zod";
import { invokeLLM, type InvokeResult, type Message } from "../_core/llm";
import {
  buildEvidenceCorpus,
  excerptAppearsInCorpus,
  extractSpecificTerms,
  hasConcreteEditVerb,
  hasEnoughExplanation,
  hasLocalEvidenceSequence,
  isGenericGuidance,
  normalizeEvidenceText,
} from "../_core/evidenceQuality";
import { protectedProcedure, router } from "../_core/trpc";
import { ensureReadableWork, ensureWritableWork } from "../_core/workGuard";
import {
  countUserDrafts,
  createDraft,
  deleteDraft,
  getCharactersByUserId,
  getDraftById,
  getOrCreateAuthorProfile,
  getSeriesContextForWork,
  getUserChapters,
  getUserDrafts,
  getUserLibraryEntries,
  getUserSubscription,
  getWorkById,
  setDraftStatus,
  updateDraft,
} from "../db";
import { consumeAuxiliaryUsage, releaseAuxiliaryUsage } from "../generation/auxiliaryUsage";
import { countWords, maxDraftWordsPerGeneration, minDraftWordsToReview, resolvePlanTier, type PlanTier } from "../generation/planConfig";
import { invokeDeepSeek } from "../generation/deepseekClient";
import { type DeepSeekTask, isDeepSeekEngineName } from "../generation/deepseekConfig";
import { selectGenerationEngine } from "../generation/engineConfig";

const paginationInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

const REVIEW_LIMIT_MESSAGE = "Você atingiu o limite mensal de revisões/inspirações do seu plano.";

function responseText(value: InvokeResult) {
  const content = value.choices[0]?.message.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => part.type === "text" ? part.text : "").join("").trim();
  }
  return "";
}

async function invokeDraftAiTask(args: {
  task: Extract<DeepSeekTask, "review" | "inspiration">;
  planTier: PlanTier;
  maxTokens: number;
  messages: Message[];
}) {
  const engine = selectGenerationEngine({ task: args.task, planTier: args.planTier });
  if (isDeepSeekEngineName(engine)) {
    return invokeDeepSeek({
      task: args.task,
      planTier: args.planTier,
      maxTokens: args.maxTokens,
      messages: args.messages,
      temperature: args.task === "review" ? 0.25 : 0.65,
    });
  }
  return invokeLLM({ maxTokens: args.maxTokens, messages: args.messages });
}

function stripFence(raw: string) {
  return raw.replace(/^```(?:json|text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseJsonObject<T>(raw: string): T | null {
  const cleaned = stripFence(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function extractReviewedTextField(raw: string) {
  const cleaned = stripFence(raw);
  const match = cleaned.match(/"reviewedText"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"changesSummary"|}\s*$)/);
  if (!match?.[1]) return "";
  return match[1]
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
}

function takeLastWords(value: string, maxWords: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value.trim();
  return words.slice(-maxWords).join(" ");
}

function compact(value: string | null | undefined, maxChars = 1200) {
  const text = (value ?? "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}...`;
}

async function getActiveWorkId(ctxWorkId: number | null | undefined, inputWorkId?: number | null) {
  const workId = ctxWorkId ?? inputWorkId;
  if (!workId) throw new UserVisibleError("Selecione uma obra ativa antes de usar o rascunho.");
  return workId;
}

async function buildDraftAssistContext(args: {
  userId: number;
  workId: number;
  draftId?: number | null;
  currentDraftText: string;
  maxDraftWords: number;
}) {
  const draft = args.draftId
    ? await getDraftById(args.draftId, args.userId, args.workId)
    : null;
  if (args.draftId && !draft) throw new UserVisibleError("Rascunho não encontrado.");

  const draftText = args.currentDraftText.trim() || draft?.content?.trim() || "";
  const draftExcerpt = takeLastWords(draftText, Math.min(args.maxDraftWords, 2500));
  const [work, profile, characters, libraryEntries, chapters, seriesContext] = await Promise.all([
    getWorkById(args.workId, args.userId),
    getOrCreateAuthorProfile(args.userId, args.workId),
    getCharactersByUserId(args.userId, args.workId, { limit: 80 }),
    getUserLibraryEntries(args.userId, undefined, args.workId, { limit: 40 }),
    getUserChapters(args.userId, args.workId, { limit: 8 }),
    getSeriesContextForWork(args.userId, args.workId),
  ]);

  const haystack = `${draftText}\n${draft?.summary ?? ""}\n${draft?.notes ?? ""}`.toLowerCase();
  const relevantCharacters = characters
    .filter((character) => haystack.includes(character.name.toLowerCase()))
    .concat(characters.slice(0, 8))
    .filter((character, index, array) => array.findIndex((item) => item.id === character.id) === index)
    .slice(0, 10);

  return [
    `Obra ativa: ${work?.title ?? "Obra sem título"}`,
    work?.subtitle ? `Subtítulo: ${work.subtitle}` : "",
    work?.genre ? `Gênero: ${work.genre}` : "",
    work?.description ? `Descrição da obra: ${compact(work.description, 900)}` : "",
    profile.storyFoundation ? `Base da obra:\n${compact(profile.storyFoundation, 1600)}` : "",
    profile.negativeRules ? `Universo/regras:\n${compact(profile.negativeRules, 1800)}` : "",
    profile.keyElements ? `Elementos-chave:\n${compact(profile.keyElements, 1600)}` : "",
    profile.narrativeStyle ? `Tom/estilo ativo:\n${compact(profile.narrativeStyle, 1200)}` : "",
    seriesContext.contextText ? `Contexto de série:\n${compact(seriesContext.contextText, 1600)}` : "",
    relevantCharacters.length
      ? `Personagens relevantes:\n${relevantCharacters.map((character) => `- ${character.name} (${character.role ?? "sem papel"}): ${compact([character.history, character.personality, character.motivations, character.relationships].filter(Boolean).join(" "), 550)}`).join("\n")}`
      : "",
    libraryEntries.length
      ? `Cânone/biblioteca da obra:\n${libraryEntries.slice(0, 16).map((entry) => `- ${entry.name} (${entry.type}): ${compact([entry.description, entry.details].filter(Boolean).join(" "), 450)}`).join("\n")}`
      : "",
    chapters.length
      ? `Capítulos já existentes:\n${chapters.slice(0, 5).map((chapter) => `- ${chapter.title}: ${compact(chapter.content, 600)}`).join("\n")}`
      : "",
    draft?.summary ? `Resumo do rascunho:\n${compact(draft.summary, 900)}` : "",
    draft?.sceneLocation ? `Local da cena: ${draft.sceneLocation}` : "",
    draft?.canonicalFacts ? `Fatos manuais do rascunho:\n${compact(draft.canonicalFacts, 900)}` : "",
    draft?.untouchableDialogue ? `Falas intocáveis:\n${compact(draft.untouchableDialogue, 800)}` : "",
    draft?.untouchableScenes ? `Trechos intocáveis:\n${compact(draft.untouchableScenes, 800)}` : "",
    draft?.notes ? `Observações do autor:\n${compact(draft.notes, 900)}` : "",
    `Trecho atual do rascunho ${countWords(draftText) > countWords(draftExcerpt) ? "(recorte final inteligente)" : "(integral)"}:\n${draftExcerpt}`,
  ].filter(Boolean).join("\n\n---\n\n");
}

type RawInspirationSuggestion = {
  title?: string;
  description?: string;
  whyItFits?: string;
  affectedCharacters?: string[];
  narrativeRisk?: string;
  continuationHint?: string;
  evidence?: string[];
};

const INSPIRATION_DIAGNOSTIC_SEQUENCE_RE = [
  /\b(ritmo|tensao|tom|progressao|escalada|climax|exposicao|historico|documental)\b.{0,120}\b(quebra|quebrou|cai|cair|interrompe|interromper|diminui|enfraquece|desloca|contrasta)\b/,
  /\b(quebra|quebrou|cai|cair|interrompe|interromper|diminui|enfraquece|desloca|contrasta)\b.{0,120}\b(ritmo|tensao|tom|progressao|escalada|climax|exposicao|historico|documental)\b/,
];

const INSPIRATION_EVIDENCE_STOPWORDS = new Set([
  "sobre",
  "entre",
  "quando",
  "porque",
  "depois",
  "antes",
  "mostrar",
  "manter",
  "continuar",
  "caminho",
  "cena",
  "texto",
  "obra",
  "capitulo",
  "rascunho",
  "narrativa",
  "personagem",
]);

function hasInspirationDiagnosticSequenceClaim(...values: Array<string | null | undefined>) {
  const normalized = normalizeEvidenceText(values.filter(Boolean).join(" "));
  return INSPIRATION_DIAGNOSTIC_SEQUENCE_RE.some((pattern) => pattern.test(normalized));
}

function evidenceSearchTokens(...values: Array<string | string[] | null | undefined>) {
  const terms = extractSpecificTerms(...values).map((term) => normalizeEvidenceText(term));
  const words = normalizeEvidenceText(values.flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).join(" "))
    .split(/\s+/)
    .filter((word) => word.length >= 5 && !INSPIRATION_EVIDENCE_STOPWORDS.has(word))
    .slice(0, 20);
  return Array.from(new Set([...terms, ...words])).filter(Boolean);
}

function evidenceSegments(source: string) {
  return source
    .replace(/\r/g, "")
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .filter((part) => {
      const words = countWords(part);
      return words >= 5 && words <= 90;
    });
}

function recoverInspirationEvidence(source: string, suggestion: {
  title: string;
  description: string;
  whyItFits: string;
  continuationHint: string;
  evidence: string[];
  affectedCharacters: string[];
}) {
  const trimmed = source.trim();
  if (!trimmed) return "";
  const tokens = evidenceSearchTokens(
    suggestion.title,
    suggestion.description,
    suggestion.whyItFits,
    suggestion.continuationHint,
    suggestion.evidence,
    suggestion.affectedCharacters,
  );
  const scored = evidenceSegments(trimmed)
    .map((segment) => {
      const normalized = normalizeEvidenceText(segment);
      const score = tokens.reduce((total, token) => total + (normalized.includes(token) ? 1 : 0), 0);
      return { segment, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || countWords(b.segment) - countWords(a.segment));

  if (scored[0]) return compact(scored[0].segment, 320);
  if (countWords(trimmed) >= 20) return takeLastWords(trimmed, 45);
  return "";
}

function reviewLooksStructurallySafe(source: string, reviewed: string) {
  const sourceWords = countWords(source);
  const reviewedWords = countWords(reviewed);
  if (!reviewed.trim()) return false;
  if (/^\s*[{[]/.test(reviewed) && /reviewedText|changesSummary/.test(reviewed)) return false;

  if (sourceWords >= 80) {
    const ratio = reviewedWords / Math.max(sourceWords, 1);
    if (ratio < 0.85 || ratio > 1.15) return false;
  }

  const sourceTerms = extractSpecificTerms(source);
  if (sourceTerms.length >= 3) {
    const reviewedNormalized = normalizeEvidenceText(reviewed);
    const kept = sourceTerms.filter((term) => reviewedNormalized.includes(normalizeEvidenceText(term))).length;
    if (kept < Math.ceil(sourceTerms.length * 0.65)) return false;
  }

  return true;
}

export function normalizeInspirationSuggestions(
  raw: RawInspirationSuggestion[] | undefined,
  context: string,
  currentDraftText: string,
) {
  const corpus = buildEvidenceCorpus([{ content: context }]);
  const currentDraftCorpus = buildEvidenceCorpus([{ content: currentDraftText }]);
  const shouldRequireCurrentEvidence = countWords(currentDraftText) >= 80;
  return (raw ?? [])
    .map((item) => {
      const evidence = Array.isArray(item.evidence)
        ? item.evidence.map(String).filter((excerpt) => excerptAppearsInCorpus(excerpt, corpus)).slice(0, 3)
        : [];
      const affectedCharacters = Array.isArray(item.affectedCharacters)
        ? item.affectedCharacters.map(String).filter(Boolean).slice(0, 6)
        : [];
      const suggestion = {
        title: String(item.title ?? "Caminho possivel").trim(),
        description: String(item.description ?? "").trim(),
        whyItFits: String(item.whyItFits ?? "").trim(),
        affectedCharacters,
        narrativeRisk: item.narrativeRisk ? String(item.narrativeRisk).trim() : "",
        continuationHint: String(item.continuationHint ?? "").trim(),
        evidence,
      };

      if (
        shouldRequireCurrentEvidence &&
        !suggestion.evidence.some((excerpt) => excerptAppearsInCorpus(excerpt, currentDraftCorpus))
      ) {
        const recovered = recoverInspirationEvidence(currentDraftText, suggestion);
        if (recovered && excerptAppearsInCorpus(recovered, currentDraftCorpus)) {
          suggestion.evidence = [recovered, ...suggestion.evidence].slice(0, 3);
        }
      }

      if (!suggestion.evidence.length) {
        const recovered = recoverInspirationEvidence(context, suggestion);
        if (recovered && excerptAppearsInCorpus(recovered, corpus)) {
          suggestion.evidence = [recovered];
        }
      }

      const terms = extractSpecificTerms(
        suggestion.title,
        suggestion.description,
        suggestion.whyItFits,
        suggestion.continuationHint,
        suggestion.evidence,
        suggestion.affectedCharacters,
      );
      if (!suggestion.description || !suggestion.continuationHint) return null;
      if (!suggestion.evidence.length) return null;
      if (
        shouldRequireCurrentEvidence &&
        !suggestion.evidence.some((excerpt) => excerptAppearsInCorpus(excerpt, currentDraftCorpus))
      ) return null;
      if (!hasEnoughExplanation(suggestion.description, 10)) return null;
      if (!hasEnoughExplanation(suggestion.whyItFits, 8)) return null;
      if (!hasEnoughExplanation(suggestion.continuationHint, 7)) return null;
      if (
        hasInspirationDiagnosticSequenceClaim(
          suggestion.title,
          suggestion.description,
          suggestion.whyItFits,
          suggestion.narrativeRisk,
          suggestion.continuationHint,
        ) &&
        !hasLocalEvidenceSequence(suggestion.evidence, corpus, { minAnchors: 2, maxSpan: 14_000 })
      ) return null;
      if (isGenericGuidance(suggestion.description, terms)) return null;
      if (isGenericGuidance(suggestion.continuationHint, terms) && !hasConcreteEditVerb(suggestion.continuationHint)) return null;
      return suggestion;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 5);
}

export const draftsRouter = router({
  list: protectedProcedure
    .input(paginationInput.optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.activeWorkId) {
        return { data: [], total: 0, hasMore: false };
      }
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const [data, total] = await Promise.all([
        getUserDrafts(ctx.user!.id, ctx.activeWorkId, { limit, offset }),
        countUserDrafts(ctx.user!.id, ctx.activeWorkId),
      ]);
      return {
        data,
        total,
        hasMore: offset + limit < total,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ draftId: z.number() }))
    .query(async ({ input, ctx }) => {
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const draft = await getDraftById(input.draftId, ctx.user!.id, ctx.activeWorkId);
      if (!draft) throw new UserVisibleError("Rascunho não encontrado.");
      return draft;
    }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().optional().default(""),
      content: z.string().default(""),
      sceneLocation: z.string().optional(),
      bookReference: z.string().optional(),
      chapterNumber: z.string().optional(),
      mainCharacters: z.array(z.union([z.string(), z.number()])).optional(),
      summary: z.string().optional(),
      untouchableDialogue: z.string().optional(),
      untouchableScenes: z.string().optional(),
      canonicalFacts: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["draft", "sent_to_writing", "archived"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const created = await createDraft(ctx.user!.id, {
        title: input.title ?? "",
        content: input.content,
        sceneLocation: input.sceneLocation ?? null,
        bookReference: input.bookReference ?? null,
        chapterNumber: input.chapterNumber ?? null,
        mainCharacters: JSON.stringify(input.mainCharacters || []),
        summary: input.summary ?? null,
        untouchableDialogue: input.untouchableDialogue ?? null,
        untouchableScenes: input.untouchableScenes ?? null,
        canonicalFacts: input.canonicalFacts ?? null,
        notes: input.notes ?? null,
        status: input.status || "draft",
        workId: ctx.activeWorkId,
      }, ctx.activeWorkId);
      return { success: true, data: created };
    }),

  update: protectedProcedure
    .input(z.object({
      draftId: z.number(),
      title: z.string().optional(),
      content: z.string().optional(),
      sceneLocation: z.string().optional(),
      bookReference: z.string().optional(),
      chapterNumber: z.string().optional(),
      mainCharacters: z.array(z.union([z.string(), z.number()])).optional(),
      summary: z.string().optional(),
      untouchableDialogue: z.string().optional(),
      untouchableScenes: z.string().optional(),
      canonicalFacts: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["draft", "sent_to_writing", "archived"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const existing = await getDraftById(input.draftId, ctx.user!.id, ctx.activeWorkId);
      if (!existing) throw new UserVisibleError("Rascunho não encontrado.");
      const { draftId, mainCharacters, ...rest } = input;
      const updated = await updateDraft(draftId, ctx.user!.id, {
        ...rest,
        ...(mainCharacters ? { mainCharacters: JSON.stringify(mainCharacters) } : {}),
      }, ctx.activeWorkId);
      return { success: true, data: updated };
    }),

  sendToWriting: protectedProcedure
    .input(z.object({ draftId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const existing = await getDraftById(input.draftId, ctx.user!.id, ctx.activeWorkId);
      if (!existing) throw new UserVisibleError("Rascunho não encontrado.");
      await setDraftStatus(input.draftId, ctx.user!.id, "sent_to_writing", ctx.activeWorkId);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ draftId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const existing = await getDraftById(input.draftId, ctx.user!.id, ctx.activeWorkId);
      if (!existing) throw new UserVisibleError("Rascunho não encontrado.");
      const removed = await deleteDraft(input.draftId, ctx.user!.id, ctx.activeWorkId);
      if (!removed) throw new UserVisibleError("Não foi possível excluir o rascunho.");
      return { success: true };
    }),

  reviewText: protectedProcedure
    .input(z.object({
      draftId: z.number().optional(),
      text: z.string(),
      mode: z.literal("grammar").default("grammar"),
    }))
    .mutation(async ({ input, ctx }) => {
      const workId = await getActiveWorkId(ctx.activeWorkId);
      await ensureReadableWork(ctx.user!.id, workId);
      if (input.draftId) {
        const draft = await getDraftById(input.draftId, ctx.user!.id, workId);
        if (!draft) throw new UserVisibleError("Rascunho não encontrado.");
      }

      const wordCount = countWords(input.text);
      if (wordCount < minDraftWordsToReview) {
        throw new UserVisibleError("Escreva um pouco mais antes de revisar o texto.");
      }

      const subscription = await getUserSubscription(ctx.user!.id);
      const planTier = resolvePlanTier(subscription);
      if (wordCount > maxDraftWordsPerGeneration[planTier]) {
        throw new UserVisibleError(`O texto tem ${wordCount} palavras. O limite do seu plano é ${maxDraftWordsPerGeneration[planTier]}.`);
      }

      let consumed = false;
      try {
        await consumeAuxiliaryUsage(ctx.user!.id, "textReview");
        consumed = true;
        const response = await invokeDraftAiTask({
          task: "review",
          planTier,
          maxTokens: Math.min(5000, Math.max(1000, Math.ceil(input.text.length / 2))),
          messages: [
            {
              role: "system",
              content: [
                "Você é um revisor de texto literário em português brasileiro.",
                "Corrija gramática, ortografia, pontuação, concordância e pequenos problemas de clareza.",
                "Preserve voz do autor, ordem dos acontecimentos, estrutura dos parágrafos quando possível, intenção emocional e tom original.",
                "Não expanda cena, não adicione acontecimentos, não troque estilo, não reescreva como capítulo novo.",
                "Não reordene eventos, não antecipe revelações e não transforme exposição em diagnóstico narrativo.",
                "Responda apenas JSON válido no formato {\"reviewedText\":\"...\",\"changesSummary\":[\"...\"]}.",
              ].join("\n"),
            },
            { role: "user", content: input.text },
          ],
        });
        const raw = responseText(response);
        const parsed = parseJsonObject<{ reviewedText?: string; changesSummary?: string[] }>(raw);
        const reviewedText = parsed?.reviewedText?.trim() || extractReviewedTextField(raw) || stripFence(raw);
        const safeReviewedText = reviewLooksStructurallySafe(input.text, reviewedText)
          ? reviewedText
          : input.text.trim();
        const changesSummary = Array.isArray(parsed?.changesSummary) ? parsed!.changesSummary!.map(String).slice(0, 8) : [];
        return {
          reviewedText: safeReviewedText,
          changesSummary: safeReviewedText === reviewedText
            ? changesSummary
            : ["A revisão automática foi limitada porque alterava estrutura, sequência ou conteúdo além de correção textual."],
        };
      } catch (error) {
        if (consumed) await releaseAuxiliaryUsage(ctx.user!.id, "textReview");
        if (error instanceof Error && error.message === REVIEW_LIMIT_MESSAGE) throw error;
        throw error;
      }
    }),

  generateInspiration: protectedProcedure
    .input(z.object({
      draftId: z.number().optional(),
      workId: z.number().optional(),
      currentDraftText: z.string().default(""),
    }))
    .mutation(async ({ input, ctx }) => {
      const workId = await getActiveWorkId(ctx.activeWorkId, input.workId);
      await ensureReadableWork(ctx.user!.id, workId);
      const subscription = await getUserSubscription(ctx.user!.id);
      const planTier = resolvePlanTier(subscription);

      let consumed = false;
      try {
        await consumeAuxiliaryUsage(ctx.user!.id, "inspiration");
        consumed = true;
        const context = await buildDraftAssistContext({
          userId: ctx.user!.id,
          workId,
          draftId: input.draftId,
          currentDraftText: input.currentDraftText,
          maxDraftWords: maxDraftWordsPerGeneration[planTier],
        });
        const response = await invokeDraftAiTask({
          task: "inspiration",
          planTier,
          maxTokens: 2200,
          messages: [
            {
              role: "system",
              content: [
                "Você é um assistente de desenvolvimento narrativo para escritores.",
                "Sua função é sugerir caminhos, não escrever o capítulo.",
                "Toda ideia nova deve ser marcada como hipótese/sugestão, nunca como cânone.",
                "Não contradiga o cânone fornecido. Não atualize memória, perfil, universo ou rascunho.",
                "Use universo, personagens, política, poderes, tom, acontecimentos anteriores e o trecho atual.",
                "Cada sugestão precisa nascer de evidências do contexto enviado, não de leitura genérica.",
                "Não transforme Inspiração em auditoria editorial: não diagnostique defeitos como 'quebra de ritmo' ou 'tensão fraca' salvo se for indispensável. O foco é sugerir próximos caminhos concretos para a cena.",
                "Quando houver rascunho em andamento, parta do estado emocional e factual do último trecho. Medo, paralisia, choro, fuga e reações corporais contam como consequências narrativas.",
                "Inclua evidence com 1 a 3 trechos literais curtos do contexto usado para sustentar a sugestão.",
                "Pelo menos uma evidência deve vir do trecho atual quando houver rascunho em andamento.",
                "Se falar de ritmo, tensão, tom, progressão ou exposição, cite evidências próximas que provem a sequência local. Não trate preparação anterior como quebra de tensão posterior.",
                "Antes de sugerir, verifique se o trecho atual já resolveu esse ponto. Se resolveu, não sugira.",
                "Retorne apenas JSON válido com a chave suggestions.",
                "Formato: {\"suggestions\":[{\"title\":\"...\",\"description\":\"...\",\"whyItFits\":\"...\",\"affectedCharacters\":[\"...\"],\"narrativeRisk\":\"...\",\"continuationHint\":\"...\",\"evidence\":[\"trecho literal\"]}]}",
                "Crie de 4 a 5 caminhos distintos, específicos e úteis.",
              ].join("\n"),
            },
            { role: "user", content: context },
          ],
        });
        const parsed = parseJsonObject<{
          suggestions?: RawInspirationSuggestion[];
        }>(responseText(response));
        const suggestions = normalizeInspirationSuggestions(parsed?.suggestions, context, input.currentDraftText);

        if (!suggestions.length) throw new UserVisibleError("A IA não retornou sugestões específicas o bastante. Tente novamente com mais texto no rascunho.");
        return { suggestions };
      } catch (error) {
        if (consumed) await releaseAuxiliaryUsage(ctx.user!.id, "inspiration");
        if (error instanceof Error && error.message === REVIEW_LIMIT_MESSAGE) throw error;
        throw error;
      }
    }),
});
