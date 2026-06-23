import { UserVisibleError } from "@shared/_core/errors";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  chargeCredits,
  getChapterById,
  getChapterReview,
  getCharactersByUserId,
  getOrCreateAuthorProfile,
  getUserChapters,
  grantCredits,
  updateAuthorProfile,
  updateChapter,
  updateCharacter,
  upsertChapterReview,
} from "../db";
import { invokeLLM } from "../_core/llm";
import {
  buildEvidenceCorpus,
  excerptAppearsInCorpus,
  extractSpecificTerms,
  hasConcreteEditVerb,
  hasEnoughExplanation,
  hasLocalEvidenceSequence,
  hasSequenceSensitiveClaim,
  isGenericGuidance,
} from "../_core/evidenceQuality";
import {
  ContinuityMemory,
  createContinuityMemoryId,
  getContinuityMemoryByChapter,
  parseContinuityMemories,
  serializeContinuityMemories,
  upsertContinuityMemory,
} from "../../shared/continuity";
import { ensureReadableWork, ensureWritableWork } from "../_core/workGuard";
import {
  buildRevisionBriefFromStoredReview,
  parseStoredReviewArray,
} from "../review/revisionBrief";

const REVIEW_ANALYZE_COST = 12;
const CONTINUITY_MEMORY_COST = 5;
const CHARACTER_SUGGESTIONS_COST = 3;

const commentSchema = z.object({
  id: z.number(),
  type: z.enum(["logic", "style", "character", "spelling"]),
  severity: z.enum(["high", "medium", "low"]),
  line: z.number(),
  excerpt: z.string().optional(),
  sequenceEvidence: z.array(z.string()).optional(),
  text: z.string(),
  suggestion: z.string(),
});

const alertSchema = z.object({
  type: z.enum(["info", "warning", "error"]),
  title: z.string(),
  description: z.string(),
});

const continuityMemoryShape = z.object({
  summary: z.string(),
  stateChanges: z.array(z.string()),
  canonicalFacts: z.array(z.string()),
  openLoops: z.array(z.string()),
  impactedCharacters: z.array(z.string()),
});

type ReviewComment = z.infer<typeof commentSchema>;
type ReviewAlert = z.infer<typeof alertSchema>;

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toLimitedText(value: unknown, fallback: string, max = 1200) {
  const text =
    typeof value === "string"
      ? value.trim()
      : value == null
        ? ""
        : String(value).trim();
  return (text || fallback).slice(0, max);
}

function normalizeReviewType(
  raw: unknown,
  record: Record<string, unknown>
): ReviewComment["type"] {
  const combined = stripAccents(
    [
      raw,
      record.text,
      record.message,
      record.description,
      record.suggestion,
      record.title,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  );

  if (/\b(spelling|ortograf|gramatic|pontuac|concordanc)\b/.test(combined))
    return "spelling";
  if (/\b(character|personagem|relacionament|motivac|voz)\b/.test(combined))
    return "character";
  if (
    /\b(style|estilo|ritmo|tom|subtexto|densidade|cliche|repetic)\b/.test(
      combined
    )
  )
    return "style";
  return "logic";
}

function normalizeSeverity(raw: unknown): ReviewComment["severity"] {
  const value = stripAccents(String(raw ?? "").toLowerCase());
  if (
    ["high", "alta", "grave", "critica", "critical"].some(item =>
      value.includes(item)
    )
  )
    return "high";
  if (["low", "baixa", "leve", "minor"].some(item => value.includes(item)))
    return "low";
  return "medium";
}

function normalizeLine(raw: unknown) {
  if (typeof raw === "number" && Number.isFinite(raw))
    return Math.max(1, Math.round(raw));
  const match = String(raw ?? "").match(/\d+/);
  return match ? Math.max(1, Number(match[0])) : 1;
}

function normalizeAlertType(raw: unknown): ReviewAlert["type"] {
  const value = stripAccents(String(raw ?? "").toLowerCase());
  if (
    ["error", "erro", "critico", "critica", "grave"].some(item =>
      value.includes(item)
    )
  )
    return "error";
  if (
    ["warning", "alerta", "aviso", "atencao", "medio", "media"].some(item =>
      value.includes(item)
    )
  )
    return "warning";
  return "info";
}

function shouldKeepReviewComment(comment: ReviewComment, corpus: string) {
  if (!comment.excerpt || !excerptAppearsInCorpus(comment.excerpt, corpus)) return false;
  const sequenceEvidence = [
    comment.excerpt,
    ...(comment.sequenceEvidence ?? []).filter((excerpt) => excerptAppearsInCorpus(excerpt, corpus)),
  ];
  if (
    hasSequenceSensitiveClaim(comment.text, comment.suggestion) &&
    !hasLocalEvidenceSequence(sequenceEvidence, corpus, { minAnchors: 2, maxSpan: 12_000 })
  ) return false;

  const terms = extractSpecificTerms(comment.text, comment.suggestion, sequenceEvidence);
  if (!hasEnoughExplanation(comment.text, 7)) return false;
  if (!hasEnoughExplanation(comment.suggestion, 5)) return false;
  if (isGenericGuidance(comment.suggestion, terms) && !hasConcreteEditVerb(comment.suggestion)) return false;
  return true;
}

function normalizeReviewComments(raw: unknown, corpus: string): ReviewComment[] {
  const items = Array.isArray(raw) ? raw : [];
  return items
    .map((item, index): ReviewComment | null => {
      const record = asRecord(item);
      const text = toLimitedText(
        record.text ??
          record.message ??
          record.description ??
          record.comment ??
          record.issue,
        ""
      );
      const suggestion = toLimitedText(
        record.suggestion ??
          record.recommendation ??
          record.fix ??
          record.action,
        "Revise o trecho indicado preservando a intenção da cena."
      );
      const excerpt = toLimitedText(
        record.excerpt ?? record.quote ?? record.snippet ?? record.trecho,
        "",
        420
      );
      const rawSequenceEvidence = Array.isArray(record.sequenceEvidence)
        ? record.sequenceEvidence
        : Array.isArray(record.relatedExcerpts)
          ? record.relatedExcerpts
          : Array.isArray(record.supportingExcerpts)
            ? record.supportingExcerpts
            : record.relatedExcerpt
              ? [record.relatedExcerpt]
              : [];
      const sequenceEvidence = rawSequenceEvidence
        .map((value) => toLimitedText(value, "", 420))
        .filter(Boolean)
        .slice(0, 3);
      if (!text) return null;
      return {
        id: normalizeLine(record.id) || index + 1,
        type: normalizeReviewType(record.type, record),
        severity: normalizeSeverity(record.severity ?? record.priority),
        line: normalizeLine(record.line ?? record.paragraph ?? record.position),
        excerpt: excerpt || undefined,
        sequenceEvidence: sequenceEvidence.length ? sequenceEvidence : undefined,
        text,
        suggestion,
      };
    })
    .filter((item): item is ReviewComment => Boolean(item))
    .filter(item => shouldKeepReviewComment(item, corpus))
    .slice(0, 30)
    .map((item, index) => ({ ...item, id: index + 1 }));
}

function normalizeReviewAlerts(
  raw: unknown,
  comments: ReviewComment[]
): ReviewAlert[] {
  const items = Array.isArray(raw) ? raw : [];
  const alerts = items
    .map(item => {
      const record = asRecord(item);
      const title = toLimitedText(record.title ?? record.name, "", 160);
      const description = toLimitedText(
        record.description ?? record.message ?? record.text,
        "",
        600
      );
      if (!title && !description) return null;
      return {
        type: normalizeAlertType(record.type ?? record.severity),
        title: title || "Alerta de revisão",
        description:
          description ||
          "A revisão automática encontrou um ponto que merece atenção.",
      } satisfies ReviewAlert;
    })
    .filter((item): item is ReviewAlert => Boolean(item))
    .slice(0, 12);

  if (alerts.length) return alerts;
  return [
    {
      type: comments.some(comment => comment.severity === "high")
        ? "warning"
        : "info",
      title: comments.length ? "Revisão gerada" : "Sem alertas críticos",
      description: comments.length
        ? "A revisão automática encontrou pontos concretos para avaliar."
        : "Nenhum alerta relevante foi encontrado pela revisão automática.",
    },
  ];
}

function normalizeReviewPayload(
  parsed: unknown,
  fallback: ReturnType<typeof fallbackReview>,
  sourceContent: string
) {
  const record = asRecord(parsed);
  const nestedReview = asRecord(record.review);
  const rawComments = record.comments ?? nestedReview.comments;
  const rawAlerts = record.alerts ?? nestedReview.alerts;
  const corpus = buildEvidenceCorpus([{ content: sourceContent }]);
  const parsedObject = Boolean(parsed && typeof parsed === "object");
  const comments = normalizeReviewComments(rawComments, corpus);
  const finalComments = comments.length ? comments : parsedObject ? [] : fallback.comments;
  const alerts = normalizeReviewAlerts(rawAlerts, finalComments);
  return {
    comments: finalComments,
    alerts: alerts.length ? alerts : fallback.alerts,
  };
}

function fallbackReview(content: string) {
  const paragraphs = content.split(/\n+/).filter(Boolean);
  const words = content.trim().split(/\s+/).filter(Boolean);
  const comments: ReviewComment[] = [];
  const alerts: ReviewAlert[] = [];

  if (words.length < 400) {
    comments.push({
      id: 1,
      type: "logic",
      severity: "medium",
      line: 1,
      text: "O capítulo está curto para sustentar progressão dramática consistente.",
      suggestion:
        "Expanda ação, reação e consequência antes do desfecho da cena.",
    });
  }
  if (!content.includes("\n")) {
    comments.push({
      id: comments.length + 1,
      type: "style",
      severity: "medium",
      line: 1,
      text: "O texto está em bloco único, o que prejudica ritmo e leitura.",
      suggestion:
        "Separe melhor os parágrafos por mudança de ação, foco ou tensão.",
    });
  }
  if (/!!|\\/.test(content)) {
    comments.push({
      id: comments.length + 1,
      type: "style",
      severity: "low",
      line: 1,
      text: "Há pontuação enfática demais em alguns trechos.",
      suggestion:
        "Troque excesso de ênfase por detalhe concreto ou reação do personagem.",
    });
  }

  alerts.push({
    type: comments.some(c => c.severity === "high") ? "error" : "info",
    title: comments.length
      ? "Revisão preliminar gerada"
      : "Sem alertas críticos",
    description: comments.length
      ? "A revisão automática encontrou pontos de estrutura e legibilidade para revisar."
      : "O capítulo não apresentou problemas óbvios na checagem básica.",
  });

  if (paragraphs.length < 3) {
    alerts.push({
      type: "warning",
      title: "Densidade estrutural baixa",
      description:
        "Poucos blocos narrativos detectados. Pode haver falta de progressão interna.",
    });
  }

  return { comments, alerts };
}

function fallbackContinuityMemory(chapter: {
  id: number;
  title: string;
  content: string;
}): z.infer<typeof continuityMemoryShape> {
  const cleaned = chapter.content.replace(/\s+/g, " ").trim();
  const summary =
    cleaned
      .split(/(?<=[.!])\s+/)
      .slice(0, 3)
      .join(" ")
      .slice(0, 900) || cleaned.slice(0, 900);
  const paragraphs = chapter.content
    .split(/\n+/)
    .map(item => item.trim())
    .filter(Boolean);
  const stateChanges = paragraphs.slice(0, 2).map(item => item.slice(0, 220));
  return {
    summary,
    stateChanges,
    canonicalFacts: [],
    openLoops: [],
    impactedCharacters: [],
  };
}

async function generateContinuityPayload(chapter: {
  id: number;
  title: string;
  content: string;
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um assistente de continuidade narrativa. Leia o capítulo inteiro como acontecimento canônico e devolva APENAS um JSON puro (sem markdown, sem explicação) com estes campos:
{"summary":"resumo denso do capítulo","stateChanges":["mudança concreta de estado"],"canonicalFacts":["fato que não pode ser contradito"],"openLoops":["ponta em aberto"],"impactedCharacters":["nome do personagem afetado"]}

Regras:
- Não faça resumo genérico. Registre causa, consequência, decisões, perdas, alianças, ferimentos, revelações, mudanças de poder, lugares e objetos importantes.
- Se algo mudou para um personagem, diga o que mudou e por quê.
- Se uma informação orienta capítulos futuros, coloque em canonicalFacts.
- Se uma promessa narrativa ficou pendente, coloque em openLoops.
- Se não houver um campo com informação real, retorne array vazio nesse campo.`,
      },
      {
        role: "user",
        content: `Capítulo ${chapter.id}: ${chapter.title}\n\n${chapter.content}`,
      },
    ],
  });
  let raw = response.choices[0].message.content;
  if (typeof raw !== "string")
    throw new UserVisibleError("A IA não retornou memória de continuidade.");
  // Fix: regex anterior `(:json)` capturava ":json" literal; agora aceita ```json, ```JSON ou ``` sem linguagem.
  raw = raw
    .replace(/^```(?:json|JSON)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    try {
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {
      parsed = null;
    }
  }
  if (!parsed)
    throw new UserVisibleError(
      "A IA não retornou JSON válido para a memória de continuidade."
    );
  return continuityMemoryShape.parse(parsed);
}

async function saveContinuityMemoryForChapter(
  userId: number,
  workId: number | null,
  chapter: { id: number; title: string; content: string },
  payload: z.infer<typeof continuityMemoryShape> & { isActive?: boolean }
) {
  const profile = await getOrCreateAuthorProfile(userId, workId);
  const memories = parseContinuityMemories(profile.continuityMemories);
  const nextMemory: ContinuityMemory = {
    id: createContinuityMemoryId(chapter.id),
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    summary: payload.summary,
    stateChanges: payload.stateChanges,
    canonicalFacts: payload.canonicalFacts,
    openLoops: payload.openLoops,
    impactedCharacters: payload.impactedCharacters,
    isActive: payload.isActive !== false,
    updatedAt: new Date().toISOString(),
  };
  const nextMemories = upsertContinuityMemory(memories, nextMemory);
  await updateAuthorProfile(
    userId,
    {
      continuityMemories: JSON.stringify(
        serializeContinuityMemories(nextMemories)
      ),
    },
    workId
  );
  return nextMemory;
}

async function chargeBeforeWork(
  userId: number,
  workId: number | null,
  amount: number,
  reason: string,
  reference: string
) {
  await chargeCredits(userId, amount, reason, { workId, reference });
}

async function refundCharge(
  userId: number,
  workId: number | null,
  amount: number,
  reason: string,
  reference: string
) {
  try {
    await grantCredits(userId, amount, `Estorno: ${reason}`, {
      workId,
      reference: `refund:${reference}`,
      type: "refund",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[review] failed to refund credits", { userId, amount, err });
  }
}

const characterSuggestionSchema = z.object({
  characterId: z.number(),
  characterName: z.string(),
  suggestions: z.array(
    z.object({
      field: z.string(),
      currentValue: z.string(),
      suggestedAppend: z.string(),
      reason: z.string(),
    })
  ),
});

async function generateCharacterSuggestions(
  chapter: { id: number; title: string; content: string },
  characters: Array<{
    id: number;
    name: string;
    history: string;
    personality: string | null;
    relationships: string | null;
    notes: string | null;
    backstory: string | null;
    motivations: string | null;
  }>
) {
  if (!characters.length) return [];

  const characterSummaries = characters
    .map(
      c =>
        `ID: ${c.id} | Nome: ${c.name} | História: ${(c.history || "").slice(0, 300)} | Personalidade: ${(c.personality || "").slice(0, 200)} | Relacionamentos: ${(c.relationships || "").slice(0, 200)}`
    )
    .join("\n\n");

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Você é um assistente de continuidade narrativa. Dado um capítulo aprovado e a ficha dos personagens que participam, identifique APENAS mudanças concretas que aconteceram no capítulo e que devem ser registradas na ficha do personagem. Foque em:
- Novos fatos revelados (passado, motivações, segredos)
- Mudanças de estado (ferimentos, alianças quebradas, mudanças de humor/postura permanentes)
- Novos relacionamentos ou mudanças em relacionamentos existentes
- Decisões irreversíveis

NÃO sugira mudanças se nada relevante aconteceu com o personagem no capítulo.
Devolva APENAS um JSON puro (sem markdown, sem explicação) neste formato:
{"suggestions":[{"characterId":1,"characterName":"Nome","field":"history","suggestedAppend":"texto a adicionar","reason":"motivo em uma frase"}]}
Campos de field aceitos: history, personality, relationships, backstory, motivations, notes.`,
        },
        {
          role: "user",
          content: `Capítulo aprovado: "${chapter.title}"\n\n${chapter.content.slice(0, 30000)}\n\n--- Fichas dos personagens ---\n${characterSummaries}`,
        },
      ],
    });
    let raw = response.choices[0].message.content;
    if (typeof raw !== "string")
      throw new UserVisibleError(
        "A IA não devolveu nenhuma resposta. Tente novamente."
      );
    // Fix: regex anterior `(:json)` capturava ":json" literal; agora aceita ```json, ```JSON ou ``` sem linguagem.
    raw = raw
      .replace(/^```(?:json|JSON)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      try {
        parsed = m ? JSON.parse(m[0]) : null;
      } catch {
        parsed = null;
      }
    }
    if (parsed.suggestions) {
      const validFields = [
        "history",
        "personality",
        "relationships",
        "backstory",
        "motivations",
        "notes",
        "physicalDescription",
        "psychologicalProfile",
      ];
      // Group by character, filtering out invalid fields
      const grouped = new Map<
        number,
        z.infer<typeof characterSuggestionSchema>
      >();
      for (const s of parsed.suggestions) {
        const charId = Number(s.characterId);
        const char = characters.find(c => c.id === charId);
        if (!char) continue;
        if (!validFields.includes(s.field)) continue;
        if (!grouped.has(charId)) {
          grouped.set(charId, {
            characterId: charId,
            characterName: char.name,
            suggestions: [],
          });
        }
        const currentValue = (char as any)[s.field] || "";
        grouped.get(charId)!.suggestions.push({
          field: s.field,
          currentValue:
            typeof currentValue === "string" ? currentValue.slice(0, 300) : "",
          suggestedAppend: s.suggestedAppend,
          reason: s.reason,
        });
      }
      return Array.from(grouped.values()).filter(g => g.suggestions.length > 0);
    }
  } catch (error) {
    console.warn("[Review] Failed to generate character suggestions:", error);
    throw new UserVisibleError(
      "A IA não conseguiu sugerir atualizações de personagens agora. Nenhum crédito foi cobrado."
    );
  }
  return [];
}

export const reviewRouter = router({
  listChapters: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeWorkId) return [];
    await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
    const chapters = await getUserChapters(ctx.user!.id, ctx.activeWorkId);
    const reviews = await Promise.all(
      chapters.map(chapter => getChapterReview(chapter.id, ctx.user!.id))
    );
    return chapters.map((chapter, index) => ({
      ...chapter,
      reviewStatus: reviews[index]?.status ?? null,
      reviewUpdatedAt: reviews[index]?.updatedAt ?? null,
    }));
  }),

  getByChapter: protectedProcedure
    .input(z.object({ chapterId: z.number() }))
    .query(async ({ input, ctx }) => {
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      const review = await getChapterReview(input.chapterId, ctx.user!.id);
      const profile = await getOrCreateAuthorProfile(
        ctx.user!.id,
        ctx.activeWorkId
      );
      const continuityMemory = getContinuityMemoryByChapter(
        parseContinuityMemories(profile.continuityMemories),
        input.chapterId
      );
      return {
        chapter,
        review: review
          ? {
              ...review,
              comments: parseStoredReviewArray<ReviewComment>(review.comments),
              alerts: parseStoredReviewArray<ReviewAlert>(review.alerts),
            }
          : null,
        continuityMemory,
      };
    }),

  analyze: protectedProcedure
    .input(
      z.object({
        chapterId: z.number(),
        referenceContexts: z
          .array(
            z.object({
              title: z.string(),
              content: z.string(),
              notes: z.string().optional(),
              sourceType: z.string().optional(),
              fileName: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      await chargeBeforeWork(
        ctx.user!.id,
        ctx.activeWorkId,
        REVIEW_ANALYZE_COST,
        "Análise de revisão",
        "review:analyze"
      );
      let charged = true;
      try {
        const referenceContexts = input.referenceContexts ?? [];
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `Você é um revisor literário técnico. Analise o capítulo inteiro e devolva JSON puro com comments e alerts.
comments deve ter id, type, severity, line, excerpt, text, suggestion. Se o comentário falar de ritmo, tensão, tom, progressão, exposição, causa/efeito ou quebra de sequência, inclua sequenceEvidence com 1 a 3 trechos literais próximos que provem a sequência local.
alerts deve ter type, title, description.

Critérios obrigatórios:
- lógica de causa e consequência;
- continuidade com capítulos-chave e cânone;
- comportamento e voz de personagens;
- ritmo, densidade, subtexto e estilo;
- promessas narrativas abertas;
- problemas de clareza, repetição, superficialidade ou clichê.

Se houver capítulos-chave de referência, use-os para avaliar coerência de voz, densidade e limites canônicos sem exigir cópia literal.
Não faça comentários genéricos: todo apontamento precisa citar um problema concreto do capítulo.
Cada comment.excerpt deve ser um trecho literal curto do capítulo analisado. Sem trecho literal, não comente.
Antes de apontar problema, verifique se o próprio texto já explica aquilo. Se já explica, não marque.
Não trate preparação anterior como quebra de tensão posterior. Para ritmo/tom/tensão, prove antes -> problema -> retomada/depois, ou não comente.
Não transforme gosto pessoal em correção: só retorne comentários que tenham ação prática específica.`,
            },
            {
              role: "user",
              content: `Título: ${chapter.title}\n\nCapítulo:\n${chapter.content}${referenceContexts.length ? `\n\nCapítulos-chave e referências:\n${referenceContexts.map(item => `**${item.title}**${item.sourceType ? ` (${item.sourceType})` : ""}${item.fileName ? ` — ${item.fileName}` : ""}\n${item.notes ? `Notas: ${item.notes}\n` : ""}${item.content}`).join("\n\n----------------\n\n")}` : ""}`,
            },
          ],
        });
        const raw = response.choices[0].message.content;
        let parsed: any = null;
        if (typeof raw === "string") {
          // Fix: mesmo bug do `(:json)` — corrigido pra grupo opcional não-capturado.
          const cleaned = raw
            .replace(/^```(?:json|JSON)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
          try {
            parsed = JSON.parse(cleaned);
          } catch {
            const m = cleaned.match(/\{[\s\S]*\}/);
            try {
              parsed = m ? JSON.parse(m[0]) : null;
            } catch {
              parsed = null;
            }
          }
        }
        const finalReview = normalizeReviewPayload(
          parsed,
          fallbackReview(chapter.content),
          chapter.content
        );
        const saved = await upsertChapterReview(ctx.user!.id, input.chapterId, {
          comments: JSON.stringify(finalReview.comments),
          alerts: JSON.stringify(finalReview.alerts),
          // Encontrar um erro grave não devolve o capítulo sozinho: a pessoa
          // revisora ainda escolhe quais pontos mandar para a Escrita.
          status: "pending",
          revisionBrief: null,
          revisionFixCount: 0,
        });
        charged = false;
        return {
          success: true,
          data: {
            ...saved,
            comments: finalReview.comments,
            alerts: finalReview.alerts,
          },
        };
      } catch (error) {
        console.warn(
          "[Review] Failed to analyze chapter:",
          error instanceof Error ? error.message : error
        );
        throw new UserVisibleError(
          "Não foi possível rodar a revisão agora. Tente novamente em alguns instantes."
        );
      } finally {
        if (charged)
          await refundCharge(
            ctx.user!.id,
            ctx.activeWorkId,
            REVIEW_ANALYZE_COST,
            "Análise de revisão",
            "review:analyze"
          );
      }
    }),

  generateContinuityMemory: protectedProcedure
    .input(z.object({ chapterId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      await chargeBeforeWork(
        ctx.user!.id,
        ctx.activeWorkId,
        CONTINUITY_MEMORY_COST,
        "Memória de continuidade",
        "review:continuity-memory"
      );
      let charged = true;
      try {
        const payload = await generateContinuityPayload(chapter);
        const saved = await saveContinuityMemoryForChapter(
          ctx.user!.id,
          ctx.activeWorkId,
          chapter,
          payload
        );
        charged = false;
        return { success: true, data: saved };
      } finally {
        if (charged)
          await refundCharge(
            ctx.user!.id,
            ctx.activeWorkId,
            CONTINUITY_MEMORY_COST,
            "Memória de continuidade",
            "review:continuity-memory"
          );
      }
    }),

  saveContinuityMemory: protectedProcedure
    .input(
      z.object({
        chapterId: z.number(),
        summary: z.string().min(1),
        stateChanges: z.array(z.string()),
        canonicalFacts: z.array(z.string()),
        openLoops: z.array(z.string()),
        impactedCharacters: z.array(z.string()),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      const saved = await saveContinuityMemoryForChapter(
        ctx.user!.id,
        ctx.activeWorkId,
        chapter,
        input
      );
      return { success: true, data: saved };
    }),

  sendBackToWriting: protectedProcedure
    .input(
      z.object({
        chapterId: z.number(),
        commentIds: z.array(z.number()).default([]),
        alertIndexes: z.array(z.number()).default([]),
        note: z.string().max(1200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      const review = await getChapterReview(input.chapterId, ctx.user!.id);
      if (!review)
        throw new UserVisibleError(
          "Rode a revisão antes de devolver o capítulo para a Escrita."
        );
      if (review.status !== "pending") {
        throw new UserVisibleError(
          "Este capítulo não está aguardando decisão da Revisão. Reenvie-o pela Escrita antes de devolvê-lo novamente."
        );
      }

      const brief = buildRevisionBriefFromStoredReview(review, {
        commentIds: input.commentIds,
        alertIndexes: input.alertIndexes,
        note: input.note,
      });
      if (brief.fixCount === 0) {
        throw new UserVisibleError(
          "Marque pelo menos um alerta ou comentário antes de devolver para a Escrita."
        );
      }

      const saved = await upsertChapterReview(ctx.user!.id, input.chapterId, {
        status: "revision_needed",
        revisionBrief: brief.revisionBrief,
        revisionFixCount: brief.fixCount,
      });
      await updateChapter(
        input.chapterId,
        ctx.user!.id,
        { status: "in_development" },
        ctx.activeWorkId
      );
      return {
        success: true,
        data: {
          chapterId: input.chapterId,
          review: saved,
          revisionBrief: brief.revisionBrief,
          fixCount: brief.fixCount,
        },
      };
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        chapterId: z.number(),
        status: z.enum(["pending", "approved", "rejected"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      const existingReview = await getChapterReview(input.chapterId, ctx.user!.id);
      if (existingReview?.status !== "pending") {
        throw new UserVisibleError(
          "Este capítulo não está aguardando decisão da Revisão. Envie-o pela Escrita antes de decidir seu status."
        );
      }
      const review = await upsertChapterReview(ctx.user!.id, input.chapterId, {
        status: input.status,
        ...(input.status === "pending"
          ? { revisionBrief: null, revisionFixCount: 0 }
          : {}),
      });
      if (input.status === "approved") {
        await updateChapter(
          input.chapterId,
          ctx.user!.id,
          { status: "canonical" },
          ctx.activeWorkId
        );
        try {
          const profile = await getOrCreateAuthorProfile(
            ctx.user!.id,
            ctx.activeWorkId
          );
          const existingMemory = getContinuityMemoryByChapter(
            parseContinuityMemories(profile.continuityMemories),
            chapter.id
          );
          if (!existingMemory) {
            const payload = await generateContinuityPayload(chapter);
            await saveContinuityMemoryForChapter(
              ctx.user!.id,
              ctx.activeWorkId,
              chapter,
              payload
            );
          }
        } catch (error) {
          console.warn(
            "[Review] Failed to auto-save continuity memory:",
            error
          );
        }
      } else if (input.status === "rejected") {
        await updateChapter(
          input.chapterId,
          ctx.user!.id,
          { status: "discarded" },
          ctx.activeWorkId
        );
      } else {
        await updateChapter(
          input.chapterId,
          ctx.user!.id,
          { status: "in_development" },
          ctx.activeWorkId
        );
      }
      return { success: true, data: review };
    }),

  suggestCharacterUpdates: protectedProcedure
    .input(z.object({ chapterId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      const characters = await getCharactersByUserId(
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!characters.length) return { success: true, data: [] };
      await chargeBeforeWork(
        ctx.user!.id,
        ctx.activeWorkId,
        CHARACTER_SUGGESTIONS_COST,
        "Sugestões de atualização de personagens",
        "review:character-suggestions"
      );
      let charged = true;
      try {
        const suggestions = await generateCharacterSuggestions(
          chapter,
          characters
        );
        charged = false;
        return { success: true, data: suggestions };
      } finally {
        if (charged)
          await refundCharge(
            ctx.user!.id,
            ctx.activeWorkId,
            CHARACTER_SUGGESTIONS_COST,
            "Sugestões de atualização de personagens",
            "review:character-suggestions"
          );
      }
    }),

  applyCharacterSuggestion: protectedProcedure
    .input(
      z.object({
        characterId: z.number(),
        field: z.string(),
        appendText: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
      const validFields = [
        "history",
        "personality",
        "relationships",
        "backstory",
        "motivations",
        "notes",
        "physicalDescription",
        "psychologicalProfile",
      ];
      if (!validFields.includes(input.field))
        throw new UserVisibleError("Campo inválido para atualização.");
      const characters = await getCharactersByUserId(
        ctx.user!.id,
        ctx.activeWorkId
      );
      const char = characters.find(c => c.id === input.characterId);
      if (!char) throw new UserVisibleError("Personagem não encontrado.");
      const currentValue = (char as any)[input.field] || "";
      const separator = currentValue.trim() ? "\n\n" : "";
      const newValue = `${currentValue}${separator}[Atualizado automaticamente] ${input.appendText}`;
      await updateCharacter(
        input.characterId,
        ctx.user!.id,
        { [input.field]: newValue },
        ctx.activeWorkId
      );
      return { success: true };
    }),
});
