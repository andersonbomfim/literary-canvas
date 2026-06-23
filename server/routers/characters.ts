import { UserVisibleError } from "@shared/_core/errors";
import { z } from 'zod';
import { protectedProcedure, router } from '../_core/trpc';
import { countCharactersByUserId, createCharacter, deleteCharacter, getCharacterById, getCharactersByUserId, incrementLibraryCount, searchCharactersByName, updateCharacter } from '../db';
import { ensureReadableWork, ensureWritableWork } from '../_core/workGuard';

const characterInputSchema = z.object({
  name: z.string().min(1, 'Character name is required'),
  history: z.string().min(1, 'Character history is required'),
  personality: z.string().optional(),
  physicalDescription: z.string().optional(),
  role: z.string().optional(),
  appearance: z.string().optional(),
  family: z.string().optional(),
  birthDate: z.string().optional(),
  speechStyle: z.string().optional(),
  psychologicalProfile: z.string().optional(),
  backstory: z.string().optional(),
  motivations: z.string().optional(),
  relationships: z.string().optional(),
  notes: z.string().optional(),
});

export const charactersRouter = router({
  create: protectedProcedure.input(characterInputSchema).mutation(async ({ input, ctx }) => {
    await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
    const character = await createCharacter(ctx.user!.id, input, ctx.activeWorkId);
    await incrementLibraryCount(ctx.user!.id, 'character', ctx.activeWorkId);
    return { success: true, data: character };
  }),

  list: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.activeWorkId) {
        return { success: true, data: [], total: 0, hasMore: false };
      }
      await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
      const limit = input?.limit ?? 100;
      const offset = input?.offset ?? 0;
      const [data, total] = await Promise.all([
        getCharactersByUserId(ctx.user!.id, ctx.activeWorkId, { limit, offset }),
        countCharactersByUserId(ctx.user!.id, ctx.activeWorkId),
      ]);
      return {
        success: true,
        data,
        total,
        hasMore: offset + limit < total,
      };
    }),

  search: protectedProcedure.input(z.object({ query: z.string() })).query(async ({ input, ctx }) => {
    if (!ctx.activeWorkId) return { success: true, data: [] };
    await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
    const characters = await searchCharactersByName(ctx.user!.id, input.query, ctx.activeWorkId);
    return {
      success: true,
      data: characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        history: c.history,
        personality: c.personality,
        physicalDescription: c.physicalDescription,
        speechStyle: c.speechStyle,
        psychologicalProfile: c.psychologicalProfile,
        backstory: c.backstory,
        motivations: c.motivations,
        relationships: c.relationships,
        notes: c.notes,
      })),
    };
  }),

  getById: protectedProcedure.input(z.object({ characterId: z.number() })).query(async ({ input, ctx }) => {
    await ensureReadableWork(ctx.user!.id, ctx.activeWorkId);
    const character = await getCharacterById(input.characterId, ctx.user!.id, ctx.activeWorkId);
    if (!character) throw new UserVisibleError('Personagem não encontrado.');
    return { success: true, data: character };
  }),

  update: protectedProcedure.input(characterInputSchema.partial().extend({ characterId: z.number() })).mutation(async ({ input, ctx }) => {
    await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
    const { characterId, ...rest } = input;
    const updated = await updateCharacter(characterId, ctx.user!.id, rest, ctx.activeWorkId);
    return { success: true, data: updated };
  }),

  delete: protectedProcedure.input(z.object({ characterId: z.number() })).mutation(async ({ input, ctx }) => {
    await ensureWritableWork(ctx.user!.id, ctx.activeWorkId);
    await deleteCharacter(input.characterId, ctx.user!.id, ctx.activeWorkId);
    return { success: true };
  }),
});
