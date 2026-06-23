import { UserVisibleError } from "@shared/_core/errors";
import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import {
  createBookSeries,
  deleteBookSeries,
  getSeriesContextForWork,
  listSeriesLibraryEntries,
  listBookSeriesByUserId,
  listWorksBySeriesId,
  replaceSeriesLibraryEntries,
  updateBookSeries,
} from '../db';
import { invokeLLM } from '../_core/llm';

const seriesInput = z.object({
  title: z.string().trim().min(1, 'Nome da série obrigatório'),
  description: z.string().optional(),
  genre: z.string().optional(),
  universeNotes: z.string().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

const seriesLibraryEntrySchema = z.object({
  type: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(255),
  description: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  sourceWorkIds: z.array(z.number()).nullable().optional(),
  confidence: z.number().min(0).max(100).nullable().optional(),
  status: z.enum(['canonical', 'needs_review', 'conflict']).optional(),
});

const seriesLibraryResponseSchema = z.object({
  entries: z.array(seriesLibraryEntrySchema).default([]),
});

function getMessageText(value: unknown) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => typeof part === 'object' && part && 'text' in part ? String((part as any).text ?? '') : '').join('\n');
  }
  return '';
}

function parseJsonObject(raw: string) {
  const withoutFence = raw.replace(/```json|```/gi, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new UserVisibleError('A IA não devolveu JSON válido para a biblioteca da série.');
  }
  return JSON.parse(withoutFence.slice(start, end + 1));
}

export const seriesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const series = await listBookSeriesByUserId(ctx.user!.id);
    const worksBySeries = await Promise.all(series.map(async (item) => ({
      seriesId: item.id,
      works: await listWorksBySeriesId(ctx.user!.id, item.id),
    })));
    const libraryBySeries = await Promise.all(series.map(async (item) => ({
      seriesId: item.id,
      library: await listSeriesLibraryEntries(ctx.user!.id, item.id),
    })));

    return {
      success: true,
      data: series.map((item) => ({
        ...item,
        works: worksBySeries.find((entry) => entry.seriesId === item.id)?.works ?? [],
        library: libraryBySeries.find((entry) => entry.seriesId === item.id)?.library ?? [],
      })),
    };
  }),

  library: protectedProcedure
    .input(z.object({ seriesId: z.number() }))
    .query(async ({ input, ctx }) => {
      const library = await listSeriesLibraryEntries(ctx.user!.id, input.seriesId);
      return { success: true, data: library };
    }),

  generateLibrary: protectedProcedure
    .input(z.object({ seriesId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const works = await listWorksBySeriesId(userId, input.seriesId);
      if (works.length < 2) {
        throw new UserVisibleError('Conecte pelo menos dois livros a esta série antes de gerar a biblioteca compartilhada.');
      }

      const contexts = await Promise.all(works.map((work) => getSeriesContextForWork(userId, work.id)));
      const series = contexts.find((context) => context.series)?.series;
      const contextText = contexts
        .map((context, index) => [
          `### Leitura cruzada ${index + 1}`,
          context.contextText,
        ].filter(Boolean).join('\n'))
        .join('\n\n==============================\n\n');

      const worksText = works.map((work) => [
        `ID ${work.id}: ${work.title}${work.subtitle ? ` - ${work.subtitle}` : ''}`,
        work.bookNumber != null ? `Número na série: ${work.bookNumber}` : '',
        work.genre ? `Gênero: ${work.genre}` : '',
        work.description ? `Premissa do volume: ${work.description}` : '',
      ].filter(Boolean).join('\n')).join('\n\n');

      const response = await invokeLLM({
        maxTokens: 14000,
        messages: [
          {
            role: 'system',
            content: [
              'Você é um arquivista canônico de séries literárias.',
              'Sua função é ler o material completo dos livros conectados e consolidar uma Biblioteca da Série que sirva para escrita futura.',
              'Não faça resumo genérico por gênero. Extraia entidades, regras, eventos, lugares, instituições, poderes, objetos, conflitos, temas recorrentes e dependências de continuidade que realmente ajudam uma IA a escrever outro livro sem contradizer os anteriores.',
              'Cada item precisa ser específico, acionável e conectado aos livros de origem. Evite clichês, frases vazias e descrições de uma linha.',
              'Se houver contradição entre livros, crie um item com status "conflict" explicando o conflito em details.',
              'Retorne apenas JSON puro no formato: {"entries":[{"type":"character|event|location|faction|power_rule|object|institution|theme|conflict|chronology|style_bridge","name":"...","description":"...","details":"...","sourceWorkIds":[1,2],"confidence":0-100,"status":"canonical|needs_review|conflict"}]}',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `SÉRIE: ${series?.title ?? 'Série sem título'}`,
              series?.description ? `DESCRIÇÃO DA SÉRIE:\n${series.description}` : '',
              series?.universeNotes ? `NOTAS DO UNIVERSO:\n${series.universeNotes}` : '',
              `LIVROS CONECTADOS:\n${worksText}`,
              `MATERIAL LIDO DOS LIVROS:\n${contextText}`,
              'Gere de 20 a 80 entradas se houver material suficiente. Prefira menos itens muito uteis a muitos itens vagos.',
            ].filter(Boolean).join('\n\n'),
          },
        ],
      });

      const raw = getMessageText(response.choices[0]?.message.content);
      const parsed = seriesLibraryResponseSchema.parse(parseJsonObject(raw));
      const library = await replaceSeriesLibraryEntries(userId, input.seriesId, parsed.entries);
      return { success: true, data: library };
    }),

  create: protectedProcedure
    .input(seriesInput)
    .mutation(async ({ input, ctx }) => {
      const series = await createBookSeries(ctx.user!.id, input);
      return { success: true, data: series };
    }),

  update: protectedProcedure
    .input(seriesInput.partial().extend({ seriesId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const { seriesId, ...data } = input;
      const series = await updateBookSeries(seriesId, ctx.user!.id, data);
      return { success: true, data: series };
    }),

  delete: protectedProcedure
    .input(z.object({ seriesId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await deleteBookSeries(input.seriesId, ctx.user!.id);
      return { success: true };
    }),

  contextForWork: protectedProcedure
    .input(z.object({ workId: z.number() }))
    .query(async ({ input, ctx }) => {
      const context = await getSeriesContextForWork(ctx.user!.id, input.workId);
      return { success: true, data: context };
    }),
});
