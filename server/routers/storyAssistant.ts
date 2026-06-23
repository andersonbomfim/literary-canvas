import { UserVisibleError } from "@shared/_core/errors";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import {
  chargeCredits,
  getCharactersByUserId,
  getOrCreateAuthorProfile,
  getUserChapters,
  getUserDrafts,
  grantCredits,
} from "../db";
import { ensureReadableWork } from "../_core/workGuard";
import {
  escapePromptInjection,
  PROMPT_HARDENING_CLAUSE,
} from "../_core/promptSanitize";

const STORY_ASSISTANT_COST = 8;
const modeSchema = z.enum([
  "new_work",
  "resume_work",
  "ideation",
  "finish_work",
]);

function buildModeInstruction(mode: z.infer<typeof modeSchema>) {
  switch (mode) {
    case "new_work":
      return "Ajude o autor a estruturar uma nova obra de forma objetiva. Gere uma premissa, eixo de conflito, tom e próximos passos sem clichês.";
    case "resume_work":
      return "Ajude o autor a retomar uma obra já iniciada. Organize onde ele parou, o que está pendente e quais são os próximos passos práticos.";
    case "ideation":
      return "Ajude o autor a destravar uma ideia inicial. Gere hipóteses fortes, comparações úteis e caminhos possíveis sem soar genérico.";
    case "finish_work":
      return "Ajude o autor a finalizar uma obra em andamento. Organize o que falta resolver, riscos de incoerência e plano de reta final.";
  }
}

function buildFallback(
  mode: z.infer<typeof modeSchema>,
  answers: Record<string, string>
) {
  const intro: Record<z.infer<typeof modeSchema>, string> = {
    new_work: "Base inicial da obra",
    resume_work: "Plano de retomada",
    ideation: "Destravando a ideia",
    finish_work: "Plano de conclusão",
  };

  return `${intro[mode]}\n\nResumo do pedido:\n${Object.entries(answers)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join(
      "\n"
    )}\n\nPróximos passos sugeridos:\n1. Fechar a direção desta etapa.\n2. Converter isso em um rascunho prático.\n3. Levar o rascunho para a escrita.\n4. Revisar a coerência antes de expandir.`;
}

// C8: charge atomically up-front; refund on failure. See writing.ts for full
// rationale. The previous "check-then-charge-after-LLM" pattern allowed
// concurrent requests to all pass the check and overdraw the wallet.
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
    console.error("[storyAssistant] failed to refund credits", {
      userId,
      amount,
      err,
    });
  }
}

export const storyAssistantRouter = router({
  runMode: protectedProcedure
    .input(
      z.object({
        mode: modeSchema,
        title: z.string().optional(),
        genre: z.string().optional(),
        style: z.string().optional(),
        inspiration: z.string().optional(),
        premise: z.string().optional(),
        summary: z.string().optional(),
        currentPoint: z.string().optional(),
        helpNeeded: z.string().optional(),
        biggestBlock: z.string().optional(),
        remainingPercentage: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await chargeBeforeWork(
        ctx.user!.id,
        ctx.activeWorkId,
        STORY_ASSISTANT_COST,
        "Assistente de história",
        `storyAssistant:${input.mode}`
      );
      let charged = true;

      if (ctx.activeWorkId)
        await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const [drafts, chapters, characters, profile] = ctx.activeWorkId
        ? await Promise.all([
            getUserDrafts(ctx.user!.id, ctx.activeWorkId),
            getUserChapters(ctx.user!.id, ctx.activeWorkId),
            getCharactersByUserId(ctx.user!.id, ctx.activeWorkId),
            getOrCreateAuthorProfile(ctx.user!.id, ctx.activeWorkId),
          ])
        : [[], [], [], { narrativeStyle: "" }];

      const recentDrafts =
        drafts
          .slice(0, 3)
          .map(
            draft =>
              `- ${draft.title}: ${draft.summary || draft.content.slice(0, 180)}`
          )
          .join("\n") || "Nenhum";
      const recentChapters =
        chapters
          .slice(0, 3)
          .map(
            chapter => `- ${chapter.title}: ${chapter.content.slice(0, 180)}`
          )
          .join("\n") || "Nenhum";
      const recentCharacters =
        characters
          .slice(0, 6)
          .map(
            character =>
              `- ${character.name}: ${character.history.slice(0, 140)}`
          )
          .join("\n") || "Nenhum";
      const answers = {
        titulo: input.title || "",
        genero: input.genre || "",
        estilo: input.style || "",
        inspiracao: input.inspiration || "",
        premissa: input.premise || "",
        resumo: input.summary || "",
        pontoAtual: input.currentPoint || "",
        ajuda: input.helpNeeded || "",
        bloqueio: input.biggestBlock || "",
        faltaParaTerminar: input.remainingPercentage || "",
      };

      const systemPrompt = `${buildModeInstruction(input.mode)}\nResponda em português do Brasil, sem floreio.\nEstruture a resposta com: leitura do cenário, direção recomendada e próximos passos.\n\n${PROMPT_HARDENING_CLAUSE}`;
      const userPrompt = `
Modo: ${input.mode}

Respostas do autor:
${escapePromptInjection(
  Object.entries(answers)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "Sem respostas adicionais."
)}

Contexto já existente no sistema:
- Estilo salvo: ${profile.narrativeStyle || "Não informado"}
- Rascunhos recentes:
${recentDrafts}

- Capítulos recentes:
${recentChapters}

- Personagens recentes:
${recentCharacters}

Quero uma orientação prática para o próximo passo do autor.`;

      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          maxTokens: 900,
        });
        const content = response.choices[0].message.content;
        const guidance = typeof content === "string" ? content.trim() : "";
        if (!guidance || guidance.split(/\s+/).filter(Boolean).length < 60) {
          throw new UserVisibleError(
            "A IA não devolveu orientação útil. Nada foi cobrado."
          );
        }
        charged = false;
        return { success: true, guidance };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[StoryAssistant] Guidance failed:", error);
        throw error;
      } finally {
        if (charged)
          await refundCharge(
            ctx.user!.id,
            ctx.activeWorkId,
            STORY_ASSISTANT_COST,
            "Assistente de história",
            `storyAssistant:${input.mode}`
          );
      }
    }),
});
