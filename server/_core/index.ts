import express from "express";
import helmet from "helmet";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { ZodError } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { UserVisibleError } from "@shared/_core/errors";
import { registerOAuthRoutes } from "./oauth";
import { registerMapsProxyRoutes } from "./mapProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { getSessionCookieOptions } from "./cookies";
import { serveStatic, setupVite } from "./vite";
import { createRateLimit } from "./rateLimit";
import { ENV } from "./env";
import { createLogger } from "./logger";
import {
  registerInputSchema,
  loginInputSchema,
  emailSchema,
  passwordSchema,
  hashPassword,
  hashToken,
  verifyPassword,
  normalizeEmail,
  sanitizeUser,
  issueSessionCookie,
} from "./localAuth";
import { z } from "zod";
import {
  getUserByEmail,
  countUsers,
  createLocalUser,
  savePasswordResetToken,
  getUserByResetTokenHash,
  updateUserPassword,
  clearPasswordResetToken,
  recordFailedLogin,
  resetFailedLogins,
} from "../db";
import { startGenerationWorker } from "../generation/worker";

const useLocalDataOnly = process.env.LOCAL_DATA_ONLY === "true";

const LOCAL_EXPORTS_DIR = path.resolve(process.cwd(), ".local-exports");

/** Build the canonical reset URL with a proper query string. */
function buildResetUrl(token: string): string {
  return `/reset-password?token=${encodeURIComponent(token)}`;
}

/** Generic message used for both "wrong password" and "no such user" to avoid enumeration. */
const GENERIC_INVALID_CREDENTIALS = "E-mail ou senha incorretos.";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * A05 (OWASP) — Convert any thrown value into a `{status, message}` pair that
 * is SAFE to send back to the client.
 *
 * Rules:
 *   - ZodError → 400 com mensagens de validação (já são amigáveis).
 *   - UserVisibleError → o status e a message foram explicitamente marcados
 *     pelo nosso código como seguros para o usuário.
 *   - HttpError com código tRPC conhecido → status mapeado, mensagem genérica
 *     (não vazamos a `message` original porque pode vir de camadas baixas).
 *   - Qualquer outro erro → 500 com mensagem genérica. O erro real é logado
 *     internamente para debugging.
 */
function toHttpError(error: unknown) {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => issue.message).filter(Boolean);
    return {
      status: 400,
      message: details.length > 0 ? details.join(". ") : "Dados inválidos.",
    };
  }

  if (error instanceof UserVisibleError) {
    return { status: error.status, message: error.message };
  }

  if (error && typeof error === "object") {
    const anyError = error as { message?: string; code?: string };
    if (anyError.code === "BAD_REQUEST") return { status: 400, message: "Requisição inválida." };
    if (anyError.code === "UNAUTHORIZED") return { status: 401, message: "Não autorizado." };
    if (anyError.code === "FORBIDDEN") return { status: 403, message: "Acesso negado." };
    if (anyError.code === "NOT_FOUND") return { status: 404, message: "Recurso não encontrado." };
  }

  // Default: log the original error internally, return a generic message.
  // eslint-disable-next-line no-console
  console.error("[toHttpError] uncaught", error);
  return { status: 500, message: "Erro interno do servidor. Tente novamente." };
}

async function startServer() {
  process.env.NODE_ENV ||= "development";
  const log = createLogger('server');
  const app = express();
  const server = createServer(app);

  // Trust proxy only when explicitly configured. Without this, Express ignores
  // X-Forwarded-* headers entirely, which is the safe default — otherwise the
  // rate limiter (and req.ip) would be spoofable from any client.
  if (process.env.TRUST_PROXY) {
    app.set("trust proxy", process.env.TRUST_PROXY);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Security headers (Helmet)
  // ────────────────────────────────────────────────────────────────────────
  // CSP is intentionally permissive in dev (Vite needs eval/inline for HMR)
  // and tightened in production. HSTS only enabled in production over TLS.
  const isProd = process.env.NODE_ENV === "production";
  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:", "https:"],
              fontSrc: ["'self'", "data:"],
              connectSrc: ["'self'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // CORS — explicit allow-list. In production CORS_ORIGINS is required.
  // In development we allow only localhost/127.0.0.1 (any port). Any other
  // origin is silently dropped (no Access-Control-Allow-Origin header set).
  // ────────────────────────────────────────────────────────────────────────
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [];

  if (isProd && allowedOrigins.length === 0) {
    log.warn(
      "CORS_ORIGINS is empty in production — cross-origin requests will be rejected. " +
        "Set CORS_ORIGINS=https://yourdomain.com to allow specific origins.",
    );
  }

  function isOriginAllowed(origin: string): boolean {
    if (allowedOrigins.includes(origin)) return true;
    if (!isProd) {
      try {
        const { hostname } = new URL(origin);
        return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
      } catch {
        return false;
      }
    }
    return false;
  }

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && isOriginAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-active-work-id");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const meta = { method: req.method, url: req.originalUrl, status: res.statusCode, durationMs: duration };
      if (res.statusCode >= 500) {
        log.error('Request completed with server error', meta);
      } else if (res.statusCode >= 400) {
        log.warn('Request completed with client error', meta);
      } else {
        log.debug('Request completed', meta);
      }
    });
    next();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Body parsing. tRPC carrega uploads de capa (data URL base64) que podem
  // inflar até ~5MB para imagens de ~3MB. Por isso o limit em /api/trpc é
  // 6mb. Demais rotas seguem com 1mb pra mitigar DoS por payload gigante.
  // O Zod schema em cada rota faz a checagem fina por campo
  // (ex: works.coverImage max 5.5MB).
  // ────────────────────────────────────────────────────────────────────────
  app.use("/api/trpc", express.json({ limit: "6mb" }));
  app.use("/api/trpc", express.urlencoded({ limit: "6mb", extended: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mode: process.env.NODE_ENV, uptime: process.uptime() });
  });

  // ────────────────────────────────────────────────────────────────────────
  // CSRF protection — applied to BOTH /api/auth and /api/trpc.
  // Strategy: every state-changing request (non-GET) must carry an Origin
  // header that matches APP_BASE_URL or one of CORS_ORIGINS. Same-origin
  // browser fetches always include Origin, so this only blocks cross-origin
  // attacks that try to ride the user's session cookie.
  // ────────────────────────────────────────────────────────────────────────
  function normalizeOrigin(value: string): string {
    try {
      return new URL(value).origin.replace(/\/+$/, "");
    } catch {
      return value.replace(/\/+$/, "");
    }
  }

  function isAppOriginAllowed(value: string): boolean {
    const normalized = normalizeOrigin(value);
    if (allowedOrigins.includes(normalized)) return true;
    if (process.env.APP_BASE_URL && normalized === process.env.APP_BASE_URL.replace(/\/+$/, "")) return true;
    return !isProd && isOriginAllowed(normalized);
  }

  function csrfGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const origin = req.headers.origin;
    if (typeof origin === "string") {
      if (!isAppOriginAllowed(origin)) {
        res.status(403).json({ success: false, error: "Origem não permitida." });
        return;
      }
    } else {
      // No Origin header on a state-changing request: only allow JSON XHR with
      // a referer pointing to our app. This is the path used by some legacy
      // clients and same-origin XHR in old browsers.
      const referer = req.headers.referer;
      const contentType = (req.headers["content-type"] || "").toString();
      if (!contentType.includes("application/json")) {
        res.status(403).json({ success: false, error: "Requisição não permitida." });
        return;
      }
      if (typeof referer === "string") {
        if (!isAppOriginAllowed(referer)) {
          res.status(403).json({ success: false, error: "Origem não permitida." });
          return;
        }
      }
    }
    next();
  }

  app.use("/api/auth", csrfGuard);
  app.use("/api/trpc", csrfGuard);

  // Rate limit auth endpoints to prevent brute-force attacks
  const authRateLimiter = createRateLimit({
    windowMs: ENV.authRateLimitWindowMs,
    maxRequests: ENV.authRateLimitMaxRequests,
    message: 'Muitas tentativas de autenticação. Aguarde um momento.',
  });
  app.use("/api/auth", authRateLimiter);

  // A04.1 (OWASP) — Rate limit tRPC mutations/queries.
  // Generous default (60 req/minute) — typical UI usage stays well under
  // this. Designed to slow down credit-burn / LLM-token-burn attacks where
  // a malicious user fires generateChapter in parallel.
  const trpcRateLimiter = createRateLimit({
    windowMs: 60_000,
    maxRequests: Number(process.env.TRPC_RATE_LIMIT_MAX ?? 60),
    message: 'Muitas requisições. Aguarde um instante e tente novamente.',
  });
  app.use("/api/trpc", trpcRateLimiter);

  app.post("/api/auth/register", async (req, res) => {
    try {
      const body = req.body ?? {};
      // No more `body.confirmPassword ? body.password` — that fallback let any
      // client skip the "passwords match" check entirely.
      const payload = {
        name: body.name,
        email: body.email,
        password: body.password,
        confirmPassword: body.confirmPassword,
      };

      const parsed = registerInputSchema.safeParse(payload);
      if (!parsed.success) {
        const messages = parsed.error.issues.map((i: any) => i.message).filter(Boolean);
        res.status(400).json({ success: false, error: messages.join(". ") || "Dados inválidos." });
        return;
      }

      const input = parsed.data;
      const email = normalizeEmail(input.email);
      const existing = await getUserByEmail(email);
      if (existing) {
        res.status(400).json({ success: false, error: "Já existe uma conta com este e-mail." });
        return;
      }

      const passwordHash = await hashPassword(input.password);
      // Auto-promote first user to admin ONLY in local-data mode. In a real
      // multi-user deployment, the first visitor must not own the system —
      // provision admins explicitly via scripts/create-local-user.mjs or by
      // setting ADMIN_EMAIL in the environment.
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
          role: shouldBeAdmin ? "admin" : "user",
        });
      } catch (err: any) {
        // Race condition fallback: unique-constraint violation on email.
        if (err?.code === "ER_DUP_ENTRY" || /duplicate/i.test(err?.message || "")) {
          res.status(400).json({ success: false, error: "Já existe uma conta com este e-mail." });
          return;
        }
        throw err;
      }

      await issueSessionCookie(req, res, user);
      res.json({ success: true, user: sanitizeUser(user), redirectTo: "/home" });
    } catch (error: any) {
      log.error("Register failed", {
        errorName: error.name,
        errorMessage: error.message,
      });
      const httpError = toHttpError(error);
      res.status(httpError.status).json({ success: false, error: httpError.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const body = req.body ?? {};
      const parsed = loginInputSchema.safeParse({ email: body.email, password: body.password });
      if (!parsed.success) {
        // Validation messages can be specific (e.g. malformed email) — that
        // doesn't reveal account existence.
        const messages = parsed.error.issues.map((i) => i.message).filter(Boolean);
        res.status(400).json({ success: false, error: messages.join(". ") || "Dados inválidos." });
        return;
      }

      const input = parsed.data;
      const email = normalizeEmail(input.email);
      const user = await getUserByEmail(email);
      // Same generic message whether the account doesn't exist, isn't a local
      // account, or the password is wrong — prevents user enumeration.
      if (!user || user.loginMethod !== "local") {
        res.status(400).json({ success: false, error: GENERIC_INVALID_CREDENTIALS });
        return;
      }

      // A07.1 — bloqueio temporário após várias falhas seguidas. Mensagem
      // intencionalmente genérica para não revelar a existência da conta a
      // quem não tem ela; só quem é o dono percebe a diferença.
      if ((user as any).lockedUntil && new Date((user as any).lockedUntil).getTime() > Date.now()) {
        res.status(429).json({ success: false, error: 'Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em alguns minutos.' });
        return;
      }

      const validPassword = await verifyPassword(input.password, user.passwordHash);
      if (!validPassword) {
        await recordFailedLogin(user.id);
        res.status(400).json({ success: false, error: GENERIC_INVALID_CREDENTIALS });
        return;
      }

      await resetFailedLogins(user.id);
      await issueSessionCookie(req, res, user);
      res.json({ success: true, user: sanitizeUser(user), redirectTo: "/home" });
    } catch (error: any) {
      log.error("Login failed", {
        errorName: error.name,
        errorMessage: error.message,
      });
      const httpError = toHttpError(error);
      res.status(httpError.status).json({ success: false, error: httpError.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      res.json({ success: true });
    } catch (error) {
      const httpError = toHttpError(error);
      res.status(httpError.status).json({ success: false, error: httpError.message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      if (!ctx.user) {
        res.status(401).json({ success: false, error: "Não autenticado." });
        return;
      }
      res.json({ success: true, user: ctx.user });
    } catch (error) {
      const httpError = toHttpError(error);
      res.status(httpError.status).json({ success: false, error: httpError.message });
    }
  });

  app.post("/api/auth/request-password-reset", async (req, res) => {
    try {
      const body = req.body ?? {};
      const parsed = emailSchema.safeParse(body.email);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "E-mail inválido." });
        return;
      }

      const email = normalizeEmail(parsed.data);
      const user = await getUserByEmail(email);

      if (user && user.loginMethod === "local") {
        const token = randomBytes(24).toString("hex");
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
        await savePasswordResetToken(user.id, tokenHash, expiresAt);

        const resetUrl = buildResetUrl(token);
        res.json({
          success: true,
          message: ENV.isProduction
             ? "Se o e-mail existir, enviamos um link de recuperação."
            : "Link de recuperação gerado para ambiente de desenvolvimento.",
          resetUrl: ENV.isProduction ? undefined : resetUrl,
        });
        return;
      }

      res.json({ success: true, message: "Se o e-mail existir, enviamos um link de recuperação." });
    } catch (error) {
      const httpError = toHttpError(error);
      res.status(httpError.status).json({ success: false, error: httpError.message });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const body = req.body ?? {};

      const schema = z.object({
        token: z.string().min(10, "Token inválido"),
        password: passwordSchema,
        confirmPassword: z.string(),
      }).refine((data) => data.password === data.confirmPassword, {
        message: "As senhas não batem",
        path: ["confirmPassword"],
      });

      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        const messages = parsed.error.issues.map((i) => i.message).filter(Boolean);
        res.status(400).json({ success: false, error: messages.join(". ") || "Dados inválidos." });
        return;
      }

      const input = parsed.data;
      const tokenHash = hashToken(input.token);
      const user = await getUserByResetTokenHash(tokenHash);
      if (!user) {
        res.status(400).json({ success: false, error: "O link de recuperação expirou ou é inválido." });
        return;
      }

      const passwordHash = await hashPassword(input.password);
      const updated = await updateUserPassword(user.id, passwordHash);
      await clearPasswordResetToken(user.id);
      await issueSessionCookie(req, res, updated);

      res.json({ success: true, user: sanitizeUser(updated), redirectTo: "/home" });
    } catch (error) {
      const httpError = toHttpError(error);
      res.status(httpError.status).json({ success: false, error: httpError.message });
    }
  });

  registerOAuthRoutes(app);
  registerMapsProxyRoutes(app);

  // ────────────────────────────────────────────────────────────────────────
  // Authenticated download endpoint for files written by storage.ts when no
  // remote object store (Forge/S3) is configured. We resolve the requested
  // path against LOCAL_EXPORTS_DIR and refuse anything that escapes it
  // (defense in depth — the keys that produced these files are server-built,
  // but path traversal here would be a disaster).
  // ────────────────────────────────────────────────────────────────────────
  app.get("/local-exports/*", async (req, res) => {
    try {
      const ctx = await createContext({ req, res });
      if (!ctx.user) {
        res.status(401).json({ success: false, error: "Não autenticado." });
        return;
      }
      const requested = decodeURIComponent(req.path.replace(/^\/local-exports\/?/, ""));
      const resolved = path.resolve(LOCAL_EXPORTS_DIR, requested);
      if (!resolved.startsWith(LOCAL_EXPORTS_DIR + path.sep) && resolved !== LOCAL_EXPORTS_DIR) {
        res.status(400).json({ success: false, error: "Caminho inválido." });
        return;
      }
      // Ownership check: storage.ts writes under exports/<userId>/...
      const segments = requested.split("/").filter(Boolean);
      if (segments[0] === "exports" && segments[1] && segments[1] !== String(ctx.user.id)) {
        res.status(403).json({ success: false, error: "Acesso negado." });
        return;
      }
      if (!fs.existsSync(resolved)) {
        res.status(404).json({ success: false, error: "Arquivo não encontrado." });
        return;
      }
      res.sendFile(resolved);
    } catch (error) {
      const httpError = toHttpError(error);
      res.status(httpError.status).json({ success: false, error: httpError.message });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV !== "production") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    log.warn(`Port ${preferredPort} is busy, using port ${port} instead`, { preferredPort, actualPort: port });
  }

  server.listen(port, () => {
    log.info(`Server running on http://localhost:${port}/`, { port, mode: process.env.NODE_ENV });
    startGenerationWorker();
  });
}

startServer().catch(console.error);
