import { UserVisibleError } from "@shared/_core/errors";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  chargeCredits,
  countUserChapters,
  createChapter,
  createChapterVersion,
  createNotification,
  getChapterById,
  getChapterReview,
  getCreditWallet,
  getDraftById,
  getSeriesContextForWork,
  getUserSubscription,
  getWorkById,
  getUserChapters,
  grantCredits,
  incrementChapterCount,
  setDraftStatus,
  updateChapter,
  upsertChapterReview,
} from "../db";
import { invokeLLM, type InvokeResult, type Message } from "../_core/llm";
import { ensureReadableWork, ensureWritableWork } from "../_core/workGuard";
import { buildStyleRepertoireGuidance } from "../_core/styleRepertoire";
import {
  escapePromptInjection,
  PROMPT_HARDENING_CLAUSE,
} from "../_core/promptSanitize";
import { createGenerationJobForUser } from "../generation/createJob";
import { invokeDeepSeek } from "../generation/deepseekClient";
import {
  type DeepSeekTask,
  isDeepSeekEngineName,
} from "../generation/deepseekConfig";
import { selectGenerationEngine } from "../generation/engineConfig";
import { resolvePlanTier, type PlanTier } from "../generation/planConfig";
import { buildRevisionBriefFromStoredReview } from "../review/revisionBrief";

const REGENERATE_CHAPTER_COST = 18;
const MANUAL_SAVE_COST = 0;
const MAX_CONTINUITY_MEMORIES = 20;

const continuityMemorySchema = z.object({
  chapterId: z.number(),
  chapterTitle: z.string(),
  summary: z.string(),
  stateChanges: z.array(z.string()).optional(),
  canonicalFacts: z.array(z.string()).optional(),
  openLoops: z.array(z.string()).optional(),
  impactedCharacters: z.array(z.string()).optional(),
});

const referenceContextSchema = z.object({
  title: z.string(),
  content: z.string(),
  notes: z.string().optional(),
  sourceType: z.string().optional(),
  fileName: z.string().optional(),
});

const characterContextSchema = z.object({
  name: z.string(),
  history: z.string(),
  role: z.string().optional(),
});

function normalizeOptionalTitle(value: string | null) {
  const title = value?.trim() || "";
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!title) return "";
  if (normalized === "rascunho sem título") return "";
  return title;
}

function buildPrompt(input: {
  title: string;
  sceneContext: string;
  authorStyle: string;
  libraryContext: string;
  negativeRules: string[];
  universeContext: string;
  styleRepertoire: string;
  characterContexts: Array<{ name: string; history: string; role: string }>;
  referenceContexts: Array<{
    title: string;
    content: string;
    notes: string;
    sourceType: string;
    fileName: string;
  }>;
  storyFoundation: string;
  continuityMemories: Array<{
    chapterId: number;
    chapterTitle: string;
    summary: string;
    stateChanges: string[];
    canonicalFacts: string[];
    openLoops: string[];
    impactedCharacters: string[];
  }>;
}) {
  const providedTitle = normalizeOptionalTitle(input.title);
  const needsProvisionalTitle = !providedTitle;
  const characterContext =
    input.characterContexts
      .map(c => `**${c.name}** (${c.role || "personagem"}): ${c.history}`)
      .join("\n\n") || "Não informado";
  const referenceContext = input.referenceContexts.length
    ? input.referenceContexts
        .map(
          item =>
            `**${item.title}**${item.sourceType ? ` (${item.sourceType})` : ""}${item.fileName ? ` - ${item.fileName}` : ""}\n${item.notes ? `Notas: ${item.notes}\n` : ""}${item.content}`
        )
        .join("\n\n----------------\n\n")
    : "Nenhuma referência ativa";
  const continuityContext =
    [
      input.storyFoundation.trim()
        ? `Base canônica da obra anterior / saga:\n${input.storyFoundation.trim()}`
        : "",
      input.continuityMemories.length
        ? `Memória dos capítulos já finalizados da obra atual:\n${input.continuityMemories
            .slice(-MAX_CONTINUITY_MEMORIES)
            .map(
              item =>
                `Capítulo ${item.chapterId}: ${item.chapterTitle}\nResumo: ${item.summary}${item.stateChanges.length ? `\nMudanças de estado: ${item.stateChanges.join("; ")}` : ""}${item.canonicalFacts.length ? `\nFatos canônicos: ${item.canonicalFacts.join("; ")}` : ""}${item.openLoops.length ? `\nPontas em aberto: ${item.openLoops.join("; ")}` : ""}${item.impactedCharacters.length ? `\nPersonagens impactados: ${item.impactedCharacters.join(", ")}` : ""}`
            )
            .join("\n\n----------------\n\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n================\n\n") ||
    "Nenhuma memória de continuidade carregada";

  const styleContext =
    [
      input.authorStyle.trim()
        ? `Estilo salvo/absorvido no Perfil:\n${input.authorStyle.trim()}`
        : "",
      input.styleRepertoire.trim()
        ? `Repertório técnico de apoio quando não houver amostra autoral suficiente:\n${input.styleRepertoire.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n================\n\n") || "Não informado";

  const systemPrompt = `Você é um assistente literário especializado em desenvolver capítulos de romance a partir do rascunho bruto do autor.
O rascunho bruto é a fonte primária da cena: leia tudo, preserve intenções, fatos, ordem emocional, personagens citados, conflitos e detalhes concretos. Não substitua o rascunho por uma premissa genérica.
O rascunho pode estar incompleto, irregular ou fragmentado. Transforme esse material em capítulo completo sem apagar a intenção do autor.
Use o campo Estilo como ficha de essência autoral já absorvida pela aba Perfil: aplique ponto de vista, distância emocional, cadência, ritmo de frase, ritmo de parágrafo, densidade descritiva, diálogos, subtexto, escolha lexical, imagens, tensão e lógica emocional. Não copie frases, cenas, imagens específicas, personagens ou eventos das amostras.
Quando não houver essência autoral suficiente, use o repertório técnico por gênero como estudo de ferramentas narrativas transferíveis. Isso serve para evitar prosa genérica, não para imitar autor real.
Se o Estilo trouxer regras práticas/checklist, trate como critério obrigatório de revisão antes de responder.
Use o contexto de personagens como ficha de cena: voz/fala, gatilhos, motivações, relações, limites canônicos e notas de uso precisam aparecer no comportamento, nas escolhas e nos diálogos. Não use os personagens como nomes soltos.
Mantenha coerência interna, voz autoral, progressão dramática e subtexto. Evite prosa genérica, frases de preenchimento e explicação emocional óbvia. Não explique sua lógica.
Capítulos-chave são regra global de escrita. A base canônica e as memórias de continuidade definem o que já aconteceu e não pode ser contradito.
Se a obra ativa pertence a uma série, o contexto de série é cânone de universo compartilhado: respeite livros anteriores, consequências, personagens recorrentes, regras e tom macro sem copiar cenas.
Quando o autor pedir uma correção de trecho, reescreva também tudo o que esse ajuste afetar no restante do capítulo para manter causa, consequência, ritmo e continuidade.

${PROMPT_HARDENING_CLAUSE}`;

  const outputInstruction = needsProvisionalTitle
    ? `Como o autor não informou título, crie um título provisório curto, literário e específico a partir do rascunho.
Responda exatamente neste formato:
TITULO_PROVISORIO: [título]
CAPITULO:
- [capítulo final em prosa corrida, sem cabeçalhos dentro do texto]`
    : "Escreva o capítulo final em prosa corrida, sem cabeçalhos extras.";

  const userPrompt = `
Título: ${providedTitle || "Não informado pelo autor; gere título provisório."}

Essência de escrita absorvida no Perfil:
${styleContext}

Rascunho bruto / contexto do autor:
${escapePromptInjection(input.sceneContext)}

Contexto de personagens:
${escapePromptInjection(characterContext)}

Capítulos-chave e referências estruturais:
${escapePromptInjection(referenceContext)}

Memória de continuidade da história:
${escapePromptInjection(continuityContext)}

Contexto da biblioteca:
${escapePromptInjection(input.libraryContext || "Não informado")}

Universo da obra:
${escapePromptInjection(input.universeContext || (input.negativeRules.length ? input.negativeRules.map(r => `- ${r}`).join("\n") : "Não informado"))}

${outputInstruction}`;

  return { systemPrompt, userPrompt, needsProvisionalTitle, providedTitle };
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```(?:json|text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractGeneratedTitle(raw: string) {
  const cleaned = stripCodeFence(raw);
  const titleLine = cleaned.match(
    /^\s*T[IÍ]TULO(?:[\s_]+PROVIS[ÓO]RIO)?\s*:\s*(.+)\s*$/im
  );
  if (!titleLine) {
    return { title: "", content: cleaned };
  }

  const title = titleLine[1]
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .slice(0, 255);
  const withoutTitle = cleaned.replace(titleLine[0], "").trim();
  const content = withoutTitle.replace(/^\s*CAP[IÍ]TULO\s*:\s*/i, "").trim();
  return { title, content };
}

function responseText(response: InvokeResult) {
  const messageContent = response.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") return messageContent.trim();
  if (Array.isArray(messageContent)) {
    return messageContent
      .map(part => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

async function invokeWritingAi(args: {
  task: DeepSeekTask;
  planTier: PlanTier;
  messages: Message[];
}) {
  const engine = selectGenerationEngine({
    task: args.task,
    planTier: args.planTier,
  });
  if (isDeepSeekEngineName(engine)) {
    return invokeDeepSeek({
      task: args.task,
      planTier: args.planTier,
      messages: args.messages,
    });
  }
  return invokeLLM({ messages: args.messages });
}

async function generateContent(
  input: Parameters<typeof buildPrompt>[0],
  options?: {
    task?: DeepSeekTask;
    planTier?: PlanTier;
  }
) {
  const { systemPrompt, userPrompt, needsProvisionalTitle, providedTitle } =
    buildPrompt(input);
  try {
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
    const response = options?.planTier
      ? await invokeWritingAi({
          task: options.task ?? "regenerate",
          planTier: options.planTier,
          messages,
        })
      : await invokeLLM({ messages });
    const generatedContent = responseText(response);
    if (generatedContent) {
      if (!needsProvisionalTitle)
        return { title: providedTitle, content: generatedContent, userPrompt };

      const parsed = extractGeneratedTitle(generatedContent);
      return {
        title: parsed.title || "Capítulo provisório",
        content: parsed.content || generatedContent,
        userPrompt,
      };
    }
  } catch (error) {
    console.warn(
      "[Writing] AI generation unavailable, generation aborted:",
      error instanceof Error ? error.message : error
    );
    throw new UserVisibleError(
      "A IA não conseguiu gerar o texto agora. Nenhum crédito foi cobrado."
    );
  }
  throw new UserVisibleError(
    "A IA não retornou conteúdo válido. Nenhum crédito foi cobrado."
  );
}

function buildDraftSourceContext(
  draft: NonNullable<Awaited<ReturnType<typeof getDraftById>>>
) {
  return [
    draft.content?.trim()
      ? `Rascunho bruto integral do autor:\n${draft.content.trim()}`
      : "",
    draft.summary?.trim()
      ? `Resumo opcional do autor:\n${draft.summary.trim()}`
      : "",
    draft.sceneLocation?.trim()
      ? `Local da cena:\n${draft.sceneLocation.trim()}`
      : "",
    draft.chapterNumber?.trim()
      ? `Capítulo indicado:\n${draft.chapterNumber.trim()}`
      : "",
    draft.untouchableDialogue?.trim()
      ? `Falas que devem ser preservadas:\n${draft.untouchableDialogue.trim()}`
      : "",
    draft.untouchableScenes?.trim()
      ? `Trechos que devem ser preservados:\n${draft.untouchableScenes.trim()}`
      : "",
    draft.canonicalFacts?.trim()
      ? `Fatos canônicos manuais:\n${draft.canonicalFacts.trim()}`
      : "",
    draft.notes?.trim() ? `Observações do autor:\n${draft.notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const generationInputSchema = z.object({
  draftId: z.number().optional(),
  idempotencyKey: z.string().min(1).max(255).optional(),
  requestedMaxOutputWords: z.number().int().positive().optional(),
  title: z.string().optional().default(""),
  sceneContext: z.string().trim().min(1, "Escreva um rascunho antes de gerar."),
  authorStyle: z.string().optional(),
  libraryContext: z.string().optional(),
  negativeRules: z.array(z.string()).optional(),
  universeContext: z.string().optional(),
  styleRepertoire: z.string().optional(),
  characterContexts: z.array(characterContextSchema).optional(),
  referenceContexts: z.array(referenceContextSchema).optional(),
  storyFoundation: z.string().optional(),
  continuityMemories: z.array(continuityMemorySchema).optional(),
});

type GenerationInput = z.infer<typeof generationInputSchema>;

type PromptInput = Parameters<typeof buildPrompt>[0];

function normalizeGenerationForPrompt(input: GenerationInput): PromptInput {
  return {
    title: input.title ?? "",
    sceneContext: input.sceneContext,
    authorStyle: input.authorStyle ?? "",
    libraryContext: input.libraryContext ?? "",
    negativeRules: input.negativeRules ?? [],
    universeContext: input.universeContext ?? "",
    styleRepertoire: input.styleRepertoire ?? "",
    characterContexts: (input.characterContexts ?? []).map(item => ({
      name: item.name,
      history: item.history,
      role: item.role ?? "",
    })),
    referenceContexts: (input.referenceContexts ?? []).map(item => ({
      title: item.title,
      content: item.content,
      notes: item.notes ?? "",
      sourceType: item.sourceType ?? "",
      fileName: item.fileName ?? "",
    })),
    storyFoundation: input.storyFoundation ?? "",
    continuityMemories: (input.continuityMemories ?? []).map(item => ({
      chapterId: item.chapterId,
      chapterTitle: item.chapterTitle,
      summary: item.summary,
      stateChanges: item.stateChanges ?? [],
      canonicalFacts: item.canonicalFacts ?? [],
      openLoops: item.openLoops ?? [],
      impactedCharacters: item.impactedCharacters ?? [],
    })),
  };
}

const regenerationInputSchema = z.object({
  chapterId: z.number(),
  adjustments: z.string().min(1),
  authorStyle: z.string().optional(),
  libraryContext: z.string().optional(),
  universeContext: z.string().optional(),
  characterContexts: z.array(characterContextSchema).optional(),
  referenceContexts: z.array(referenceContextSchema).optional(),
  storyFoundation: z.string().optional(),
  continuityMemories: z.array(continuityMemorySchema).optional(),
});

async function mergeDraftContextIntoGenerationInput(
  userId: number,
  workId: number | null,
  input: GenerationInput
): Promise<GenerationInput> {
  if (!input.draftId)
    throw new UserVisibleError(
      "A Escrita só gera capítulos a partir de um rascunho salvo."
    );

  const draft = await getDraftById(input.draftId, userId, workId);
  if (!draft)
    throw new UserVisibleError(
      "Rascunho não encontrado para gerar o capítulo."
    );

  const draftContext = buildDraftSourceContext(draft);
  const draftContent = draft.content?.trim() || "";
  if (!draftContent)
    throw new UserVisibleError("O rascunho vinculado está vazio.");
  const alreadyIncludesDraft = Boolean(
    draftContent &&
      input.sceneContext.includes(
        draftContent.slice(0, Math.min(500, draftContent.length))
      )
  );

  return {
    ...input,
    title:
      normalizeOptionalTitle(input.title) ||
      normalizeOptionalTitle(draft.title),
    sceneContext:
      [
        alreadyIncludesDraft ? "" : draftContext,
        input.sceneContext.trim()
          ? `Contexto montado na Escrita:\n${input.sceneContext.trim()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n================\n\n") || draftContext,
  };
}

async function mergeSeriesContextIntoGenerationInput(
  userId: number,
  workId: number | null,
  input: GenerationInput
): Promise<GenerationInput> {
  if (!workId) return input;
  const seriesContext = await getSeriesContextForWork(userId, workId);
  const contextText = seriesContext.contextText?.trim();
  if (!contextText) return input;

  return {
    ...input,
    storyFoundation: [
      contextText,
      input.storyFoundation?.trim()
        ? `Contexto da obra ativa:\n${input.storyFoundation.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n================\n\n"),
  };
}

async function mergeStyleRepertoireIntoGenerationInput(
  userId: number,
  workId: number | null,
  input: GenerationInput
): Promise<GenerationInput> {
  const work = workId ? await getWorkById(workId, userId) : undefined;
  const styleRepertoire = buildStyleRepertoireGuidance({
    title: normalizeOptionalTitle(input.title) || work?.title,
    subtitle: work?.subtitle,
    genre: work?.genre,
    description: work?.description,
    sceneContext: input.sceneContext,
    universeContext: input.universeContext,
    libraryContext: input.libraryContext,
    authorStyle: input.authorStyle,
  });

  if (!styleRepertoire) return input;
  return { ...input, styleRepertoire };
}

/**
 * C8: charge credits BEFORE the LLM call, atomically. The previous
 * "check-then-charge-after" pattern lets a single user fire N parallel
 * requests and overdraw - every parallel request sees the same balance, every
 * one passes the LLM stage, every one would have wanted to charge.
 *
 * Now `chargeCredits` runs `UPDATE wallet SET balance = balance - cost WHERE
 * balance >= cost` atomically and throws if zero rows match. The first N
 * (where N = floor(balance/cost)) win; the rest fail BEFORE doing any LLM
 * work, which means we don't waste upstream tokens on losing races either.
 *
 * If the LLM/DB step fails after a successful charge we issue a refund.
 */
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
  // Tenta o refund até 3x com backoff curto. Se TODAS falharem, registra
  // entrada de "pending compensation" no auditLog para um operador reconciliar
  // manualmente. Antes era 1 tentativa silenciosa: usuário perdia créditos
  // sem nenhum rastro além de um console.error.
  const MAX_ATTEMPTS = 3;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await grantCredits(userId, amount, `Estorno: ${reason}`, {
        workId,
        reference: `refund:${reference}`,
        type: "refund",
      });
      return;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS)
        await new Promise(resolve => setTimeout(resolve, 200 * attempt));
    }
  }
  // eslint-disable-next-line no-console
  console.error(
    "[writing] refund FAILED após retries — registrando para reconciliação",
    {
      userId,
      amount,
      reason,
      reference,
      err: lastError instanceof Error ? lastError.message : lastError,
    }
  );
  try {
    const { writeAuditLog } = await import("../db");
    await writeAuditLog({
      actorId: userId,
      action: "billing.refund_failed",
      targetType: "creditWallet",
      targetId: userId,
      metadata: JSON.stringify({
        amount,
        reason,
        reference,
        error:
          lastError instanceof Error ? lastError.message : String(lastError),
      }),
    });
  } catch (auditErr) {
    // eslint-disable-next-line no-console
    console.error("[writing] audit log do refund também falhou", auditErr);
  }
}

async function ensureWorkAcceptsWriting(userId: number, workId: number | null) {
  return ensureWritableWork(userId, workId);
}

async function syncExistingReviewAfterWritingChange(
  userId: number,
  chapterId: number
) {
  const review = await getChapterReview(chapterId, userId);
  if (!review) return;

  // Se o capítulo já voltou da Revisão, o brief selecionado continua sendo a
  // tarefa editorial do autor. Em qualquer outro estado, uma edição invalida
  // a revisão anterior e tira o capítulo da fila até ele ser reenviado.
  if (review.status === "revision_needed") return;
  await upsertChapterReview(userId, chapterId, {
    status: "in_writing",
    revisionBrief: null,
    revisionFixCount: 0,
  });
}

export const writingRouter = router({
  costEstimate: protectedProcedure
    .input(z.object({ action: z.enum(["generate", "regenerate", "save"]) }))
    .query(async ({ input, ctx }) => {
      const costs: Record<string, number> = {
        generate: 0,
        regenerate: REGENERATE_CHAPTER_COST,
        save: MANUAL_SAVE_COST,
      };
      const cost = costs[input.action] || 0;
      const wallet = await getCreditWallet(ctx.user!.id);
      return {
        action: input.action,
        cost,
        balance: wallet.balance,
        canAfford: wallet.balance >= cost,
      };
    }),

  generateChapter: protectedProcedure
    .input(generationInputSchema)
    .mutation(async ({ input, ctx }) => {
      await ensureWorkAcceptsWriting(ctx.user!.id, ctx.activeWorkId);
      if (!input.draftId)
        throw new UserVisibleError(
          "A Escrita só gera capítulos a partir de um rascunho salvo."
        );
      const result = await createGenerationJobForUser({
        userId: ctx.user!.id,
        workId: ctx.activeWorkId,
        input: {
          draftId: input.draftId,
          action: "generate",
          generationMode: "standard",
          requestedMaxOutputWords: input.requestedMaxOutputWords ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
      return {
        success: true,
        data: { ...result.response, reused: result.reused },
      };
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.activeWorkId) {
        return { data: [], total: 0, hasMore: false };
      }
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const [data, total] = await Promise.all([
        getUserChapters(ctx.user!.id, ctx.activeWorkId, { limit, offset }),
        countUserChapters(ctx.user!.id, ctx.activeWorkId),
      ]);
      return {
        data,
        total,
        hasMore: offset + limit < total,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ chapterId: z.number() }))
    .query(async ({ input, ctx }) => {
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      return chapter;
    }),

  getRevisionContext: protectedProcedure
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
      if (!review) {
        return {
          status: null,
          comments: [],
          alerts: [],
          selectedComments: [],
          selectedAlerts: [],
          revisionBrief: "",
          fixCount: 0,
        };
      }

      const storedBrief = review.revisionBrief?.trim();
      const brief =
        review.status === "revision_needed"
          ? storedBrief
            ? {
                comments: [],
                alerts: [],
                selectedComments: [],
                selectedAlerts: [],
                revisionBrief: storedBrief,
                revisionFixCount: review.revisionFixCount ?? 0,
                fixCount: review.revisionFixCount ?? 0,
              }
            // Compatibilidade com devoluções criadas antes de o brief passar
            // a ser persistido.
            : buildRevisionBriefFromStoredReview(review)
          : {
              comments: [],
              alerts: [],
              selectedComments: [],
              selectedAlerts: [],
              revisionBrief: "",
              revisionFixCount: 0,
              fixCount: 0,
            };
      return {
        status: review.status,
        ...brief,
      };
    }),

  save: protectedProcedure
    .input(
      z.object({
        chapterId: z.number().optional(),
        draftId: z.number().optional(),
        title: z.string().min(1),
        content: z.string().min(1),
        status: z
          .enum(["canonical", "in_development", "hypothesis", "discarded"])
          .optional(),
        changeDescription: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ensureWorkAcceptsWriting(ctx.user!.id, ctx.activeWorkId);

      if (input.chapterId) {
        const existing = await getChapterById(
          input.chapterId,
          ctx.user!.id,
          ctx.activeWorkId
        );
        if (!existing) throw new UserVisibleError("Capítulo não encontrado.");
        await createChapterVersion(
          input.chapterId,
          ctx.user!.id,
          existing.content,
          input.changeDescription || "Backup before save"
        );
        const updated = await updateChapter(
          input.chapterId,
          ctx.user!.id,
          {
            title: input.title,
            content: input.content,
            // Editar um capítulo canônico reabre sua edição; ele só volta a
            // entrar no cânone após passar novamente pela Revisão.
            status:
              input.status ||
              (existing.status === "canonical"
                ? "in_development"
                : existing.status),
          },
          ctx.activeWorkId
        );
        if (!input.status)
          await syncExistingReviewAfterWritingChange(
            ctx.user!.id,
            input.chapterId
          );
        return { success: true, data: updated };
      }

      const created = await createChapter(
        ctx.user!.id,
        {
          title: input.title,
          content: input.content,
          draftId: input.draftId ?? null,
          bookNumber: null,
          chapterNumber: null,
          status: input.status || "in_development",
          generationPrompt: null,
          workId: ctx.activeWorkId,
        },
        ctx.activeWorkId
      );
      await createChapterVersion(
        created.id,
        ctx.user!.id,
        created.content,
        input.changeDescription || "Versão inicial manual"
      );
      await incrementChapterCount(
        ctx.user!.id,
        created.content.split(/\s+/).filter(Boolean).length,
        ctx.activeWorkId
      );
      return { success: true, data: created };
    }),

  submitForReview: protectedProcedure
    .input(z.object({ chapterId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ensureWorkAcceptsWriting(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      if (!chapter.content.trim())
        throw new UserVisibleError("O capítulo está vazio.");

      const review = await upsertChapterReview(ctx.user!.id, input.chapterId, {
        status: "pending",
        revisionBrief: null,
        revisionFixCount: 0,
      });
      if (chapter.status !== "canonical") {
        await updateChapter(
          input.chapterId,
          ctx.user!.id,
          { status: "in_development" },
          ctx.activeWorkId
        );
      }

      return { success: true, data: review };
    }),

  regenerate: protectedProcedure
    .input(regenerationInputSchema)
    .mutation(async ({ input, ctx }) => {
      await ensureWorkAcceptsWriting(ctx.user!.id, ctx.activeWorkId);
      const chapter = await getChapterById(
        input.chapterId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!chapter) throw new UserVisibleError("Capítulo não encontrado.");
      await chargeBeforeWork(
        ctx.user!.id,
        ctx.activeWorkId,
        REGENERATE_CHAPTER_COST,
        "Regeneração de capítulo",
        "writing:regenerate"
      );
      let charged = true;
      try {
        const linkedDraft = chapter.draftId
          ? await getDraftById(chapter.draftId, ctx.user!.id, ctx.activeWorkId)
          : null;
        const draftContext = linkedDraft
          ? buildDraftSourceContext(linkedDraft)
          : "";
        const correctionContext = [
          draftContext
            ? `Rascunho original vinculado ao capítulo:\n${draftContext}`
            : "",
          `Capítulo atual a ser corrigido:\n${chapter.content}`,
          `Ajustes pedidos pelo autor:\n${input.adjustments}`,
          "Reescreva o capítulo inteiro quando necessário. Se o ajuste em uma parte afetar causa, consequência, ritmo, personagem, promessa dramática ou continuidade, corrija também os trechos dependentes.",
        ]
          .filter(Boolean)
          .join("\n\n================\n\n");
        const seriesContext = ctx.activeWorkId
          ? await getSeriesContextForWork(ctx.user!.id, ctx.activeWorkId)
          : null;
        const storyFoundation = [
          seriesContext?.contextText?.trim()
            ? seriesContext.contextText.trim()
            : "",
          input.storyFoundation?.trim()
            ? `Contexto da obra ativa:\n${input.storyFoundation.trim()}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n================\n\n");
        const work = ctx.activeWorkId
          ? await getWorkById(ctx.activeWorkId, ctx.user!.id)
          : undefined;
        const styleRepertoire = buildStyleRepertoireGuidance({
          title: chapter.title,
          subtitle: work?.subtitle,
          genre: work?.genre,
          description: work?.description,
          sceneContext: correctionContext,
          universeContext: input.universeContext,
          libraryContext: input.libraryContext,
          authorStyle: input.authorStyle,
        });
        const planTier = resolvePlanTier(
          await getUserSubscription(ctx.user!.id)
        );
        const { content, userPrompt } = await generateContent(
          {
            title: chapter.title,
            sceneContext: correctionContext,
            authorStyle: input.authorStyle ?? "",
            libraryContext: input.libraryContext ?? "",
            negativeRules: [],
            universeContext: input.universeContext ?? "",
            styleRepertoire,
            characterContexts: (input.characterContexts ?? []).map(item => ({
              ...item,
              role: item.role ?? "",
            })),
            referenceContexts: (input.referenceContexts ?? []).map(item => ({
              ...item,
              notes: item.notes ?? "",
              sourceType: item.sourceType ?? "",
              fileName: item.fileName ?? "",
            })),
            storyFoundation,
            continuityMemories: (input.continuityMemories ?? []).map(item => ({
              ...item,
              stateChanges: item.stateChanges ?? [],
              canonicalFacts: item.canonicalFacts ?? [],
              openLoops: item.openLoops ?? [],
              impactedCharacters: item.impactedCharacters ?? [],
            })),
          },
          { task: "regenerate", planTier }
        );
        await createChapterVersion(
          input.chapterId,
          ctx.user!.id,
          chapter.content,
          "Backup before regeneration"
        );
        const updated = await updateChapter(
          input.chapterId,
          ctx.user!.id,
          { content, generationPrompt: userPrompt, status: "in_development" },
          ctx.activeWorkId
        );
        await syncExistingReviewAfterWritingChange(
          ctx.user!.id,
          input.chapterId
        );
        charged = false;
        return {
          success: true,
          data: updated,
          message: "Chapter regenerated successfully",
        };
      } finally {
        if (charged)
          await refundCharge(
            ctx.user!.id,
            ctx.activeWorkId,
            REGENERATE_CHAPTER_COST,
            "Regeneração de capítulo",
            "writing:regenerate"
          );
      }
    }),

  getDraftContext: protectedProcedure
    .input(z.object({ draftId: z.number() }))
    .query(async ({ input, ctx }) => {
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const draft = await getDraftById(
        input.draftId,
        ctx.user!.id,
        ctx.activeWorkId
      );
      if (!draft) throw new UserVisibleError("Rascunho não encontrado.");
      const related =
        (await getUserChapters(ctx.user!.id, ctx.activeWorkId)).find(
          chapter => chapter.draftId === draft.id
        ) || null;
      return { draft, chapter: related };
    }),
});
