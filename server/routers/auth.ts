import { UserVisibleError } from "@shared/_core/errors";
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { COOKIE_NAME } from '@shared/const';
import { getSessionCookieOptions } from '../_core/cookies';
import { adminProcedure, protectedProcedure, publicProcedure, router } from '../_core/trpc';
import { ENV } from '../_core/env';
import {
  changePassword,
  clearPasswordResetToken,
  countUsers,
  createLocalUser,
  deleteUserAccount,
  getUserByEmail,
  getUserByResetTokenHash,
  listUsers,
  recordFailedLogin,
  resetFailedLogins,
  savePasswordResetToken,
  updateUserPassword,
  updateUserRole,
  writeAuditLog,
} from '../db';
import {
  emailSchema,
  hashPassword,
  hashToken,
  issueSessionCookie,
  loginInputSchema,
  normalizeEmail,
  passwordSchema,
  registerInputSchema,
  sanitizeUser,
  verifyPassword,
} from '../_core/localAuth';

const RESET_TOKEN_TTL_MS = 1000 * 60 * 30;
const useLocalDataOnly = process.env.LOCAL_DATA_ONLY === 'true';
const GENERIC_INVALID_CREDENTIALS = 'E-mail ou senha incorretos.';

export const authRouter = router({
  me: protectedProcedure.query(({ ctx }) => ctx.user),

  login: publicProcedure.input(loginInputSchema).mutation(async ({ input, ctx }) => {
    const email = normalizeEmail(input.email);
    const user = await getUserByEmail(email);
    // Single generic message — never reveal whether the e-mail is registered.
    if (!user || user.loginMethod !== 'local') {
      throw new UserVisibleError(GENERIC_INVALID_CREDENTIALS);
    }

    // A07.1 (OWASP) — account lockout depois de N falhas seguidas.
    if ((user as any).lockedUntil && new Date((user as any).lockedUntil).getTime() > Date.now()) {
      throw new UserVisibleError(
        'Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em alguns minutos.',
        429,
      );
    }

    const validPassword = await verifyPassword(input.password, user.passwordHash);
    if (!validPassword) {
      await recordFailedLogin(user.id);
      throw new UserVisibleError(GENERIC_INVALID_CREDENTIALS);
    }

    await resetFailedLogins(user.id);
    await issueSessionCookie(ctx.req, ctx.res, user);
    return {
      success: true,
      user: sanitizeUser(user),
      redirectTo: '/home',
    };
  }),

  register: publicProcedure.input(registerInputSchema).mutation(async ({ input, ctx }) => {
    const email = normalizeEmail(input.email);
    const existing = await getUserByEmail(email);
    if (existing) {
      throw new UserVisibleError('Já existe uma conta com este e-mail.');
    }

    const passwordHash = await hashPassword(input.password);
    // Auto-promote first user to admin ONLY in local-data mode. In multi-user
    // deployments, provision admins explicitly via ADMIN_EMAIL or the
    // create-local-user.mjs script.
    let shouldBeAdmin = false;
    if (ENV.adminEmail && normalizeEmail(ENV.adminEmail) === email) {
      shouldBeAdmin = true;
    } else if (useLocalDataOnly) {
      const totalUsers = await countUsers();
      shouldBeAdmin = totalUsers === 0;
    }

    let user;
    try {
      user = await createLocalUser({
        name: input.name.trim(),
        email,
        passwordHash,
        role: shouldBeAdmin ? 'admin' : 'user',
      });
    } catch (err: any) {
      // Race-safe handling for the email unique constraint.
      if (err?.code === 'ER_DUP_ENTRY' || /duplicate/i.test(err?.message || '')) {
        throw new UserVisibleError('Já existe uma conta com este e-mail.');
      }
      throw err;
    }

    await issueSessionCookie(ctx.req, ctx.res, user);
    return {
      success: true,
      user: sanitizeUser(user),
      redirectTo: '/home',
    };
  }),

  requestPasswordReset: publicProcedure.input(z.object({ email: emailSchema })).mutation(async ({ input }) => {
    const email = normalizeEmail(input.email);
    const user = await getUserByEmail(email);
    // A07.2 (OWASP) — resposta SEMPRE genérica. Caminho idêntico para e-mail
    // existente vs inexistente para não permitir enumeration. Em dev, o
    // resetUrl é gravado no log do servidor (operador acessa via terminal)
    // em vez de devolvido na resposta — antes a resposta diferenciava entre
    // os dois casos pelo `resetUrl` presente.
    const GENERIC_MESSAGE = 'Se o e-mail existir, enviamos um link de recuperação.';

    if (user && user.loginMethod === 'local') {
      const token = randomBytes(24).toString('hex');
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await savePasswordResetToken(user.id, tokenHash, expiresAt);

      if (!ENV.isProduction) {
        // eslint-disable-next-line no-console
        console.info(`[auth] dev-only reset link for ${email}: /reset-password?token=${encodeURIComponent(token)}`);
      }
    }

    return { success: true, message: GENERIC_MESSAGE };
  }),

  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string().min(10, 'Token inválido'),
        password: passwordSchema,
        confirmPassword: z.string(),
      }).refine((data) => data.password === data.confirmPassword, {
        message: 'As senhas não batem',
        path: ['confirmPassword'],
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tokenHash = hashToken(input.token);
      const user = await getUserByResetTokenHash(tokenHash);
      if (!user) {
        throw new UserVisibleError('O link de recuperação expirou ou é inválido.');
      }

      const passwordHash = await hashPassword(input.password);
      const updated = await updateUserPassword(user.id, passwordHash);
      await clearPasswordResetToken(user.id);
      await issueSessionCookie(ctx.req, ctx.res, updated);

      return {
        success: true,
        user: sanitizeUser(updated),
        redirectTo: '/home',
      };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    // A09 — registra logout quando há sessão; útil para reconciliação em
    // incidente (quem deslogou de onde, quando). Logout anônimo (cookie já
    // expirado, sem ctx.user) não gera entrada. Best-effort: falha do
    // audit log não impede o logout em si.
    if (ctx.user) {
      try {
        await writeAuditLog({
          actorId: ctx.user.id,
          actorEmail: ctx.user.email ?? null,
          action: 'user.logout',
          targetType: 'user',
          targetId: ctx.user.id,
          metadata: null,
          ipAddress: ctx.req.ip ?? null,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[auth] logout audit log falhou', err);
      }
    }
    return { success: true } as const;
  }),

  listUsers: adminProcedure.query(async () => {
    const users = await listUsers();
    return users.map((user) => sanitizeUser(user));
  }),

  updateUserRole: adminProcedure
    .input(z.object({ userId: z.number(), role: z.enum(['user', 'admin']) }))
    .mutation(async ({ input, ctx }) => {
      const user = await updateUserRole(input.userId, input.role);
      // A09 (OWASP) — registra mudança de role para reconstrução em incidente.
      await writeAuditLog({
        actorId: ctx.user!.id,
        actorEmail: ctx.user!.email ?? null,
        action: 'user.role_changed',
        targetType: 'user',
        targetId: input.userId,
        metadata: JSON.stringify({ newRole: input.role }),
        ipAddress: ctx.req.ip ?? null,
      });
      return { success: true, user: sanitizeUser(user) };
    }),

  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string().min(1, 'Senha atual obrigatória'),
      newPassword: passwordSchema,
      confirmNewPassword: z.string(),
    }).refine((data) => data.newPassword === data.confirmNewPassword, {
      message: 'As senhas não batem',
      path: ['confirmNewPassword'],
    }))
    .mutation(async ({ input, ctx }) => {
      const email = ctx.user.email;
      if (!email) {
        throw new UserVisibleError('Alteração de senha disponível apenas para contas locais.');
      }
      const user = await getUserByEmail(email);
      if (!user || user.loginMethod !== 'local') {
        throw new UserVisibleError('Alteração de senha disponível apenas para contas locais.');
      }

      const validPassword = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!validPassword) {
        throw new UserVisibleError('Senha atual incorreta.');
      }

      const newHash = await hashPassword(input.newPassword);
      await changePassword(ctx.user!.id, newHash);
      return { success: true, message: 'Senha alterada com sucesso.' };
    }),

  deleteAccount: protectedProcedure
    .input(z.object({
      password: z.string().min(1, 'Senha obrigatória para confirmar exclusão'),
      confirmation: z.literal('EXCLUIR MINHA CONTA'),
    }))
    .mutation(async ({ input, ctx }) => {
      const email = ctx.user.email;
      if (!email) {
        throw new UserVisibleError('Exclusão disponível apenas para contas locais.');
      }
      const user = await getUserByEmail(email);
      if (!user || user.loginMethod !== 'local') {
        throw new UserVisibleError('Exclusão disponível apenas para contas locais.');
      }

      const validPassword = await verifyPassword(input.password, user.passwordHash);
      if (!validPassword) {
        throw new UserVisibleError('Senha incorreta.');
      }

      await deleteUserAccount(ctx.user!.id);

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });

      return { success: true, message: 'Conta excluída permanentemente.' };
    }),
});
