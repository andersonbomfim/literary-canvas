import { TRPCError } from '@trpc/server';
import { getWorkById } from '../db';

const BLOCKED_WRITE_STATUSES = new Set(['paused', 'completed', 'archived']);

const statusLabels: Record<string, string> = {
  paused: 'pausada',
  completed: 'concluída',
  archived: 'arquivada',
};

export async function ensureWritableWork(userId: number, workId: number | null | undefined) {
  if (!workId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selecione uma obra ativa antes de alterar conteúdo.' });
  }

  const work = await ensureReadableWork(userId, workId);
  if (BLOCKED_WRITE_STATUSES.has(work.status || '')) {
    const status = statusLabels[work.status || ''] || work.status;
    throw new TRPCError({ code: 'FORBIDDEN', message: `A obra "${work.title}" está ${status}. Retome a obra antes de alterar conteúdo.` });
  }

  return work;
}

export async function ensureReadableWork(userId: number, workId: number | null | undefined) {
  if (!workId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selecione uma obra ativa antes de carregar conteúdo.' });
  }

  const work = await getWorkById(workId, userId);
  if (!work) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Obra ativa não encontrada.' });
  }

  return work;
}
