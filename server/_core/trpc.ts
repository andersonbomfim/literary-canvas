import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { UserVisibleError } from '@shared/_core/errors';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from 'zod';
import type { TrpcContext } from "./context";

// A05 (OWASP) — Filter every error before it leaves the server.
// Same policy as toHttpError() in index.ts: only ZodError, TRPCError, and our
// UserVisibleError are allowed to keep their original message. Everything else
// (driver crashes, parse failures, upstream timeouts) becomes a generic
// "Erro interno do servidor" + the real cause is logged for the operator.
const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause;

    // Zod validation errors — already user-friendly, keep them.
    if (cause instanceof ZodError) return shape;

    // Our explicit "this is safe to show" marker.
    if (cause instanceof UserVisibleError) {
      return { ...shape, message: cause.message };
    }

    // tRPC's own errors with explicit code — their messages were set by us
    // (in middlewares, in routers via `throw new TRPCError({...})`, ou em
    // helpers como createGenerationJobForUser). Todas seguras pra exibir.
    const safeCodes = new Set([
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'BAD_REQUEST',
      'TOO_MANY_REQUESTS',
      'CONFLICT',
      'PRECONDITION_FAILED',
      'PAYLOAD_TOO_LARGE',
      'METHOD_NOT_SUPPORTED',
      'UNSUPPORTED_MEDIA_TYPE',
      'UNPROCESSABLE_CONTENT',
      'TIMEOUT',
    ]);
    if (safeCodes.has(error.code)) {
      return shape;
    }

    // Any other thrown Error — log the real cause, return generic message.
    // eslint-disable-next-line no-console
    console.error('[tRPC] uncaught error:', { code: error.code, original: cause, message: error.message });
    return {
      ...shape,
      message: 'Erro interno do servidor. Tente novamente.',
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
