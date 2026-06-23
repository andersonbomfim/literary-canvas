import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';

// Load public/local defaults first, then a gitignored secrets overlay.
// Shell/container environment variables still win over .env, while
// .env.secrets.local keeps API keys out of the visible project config.
dotenv.config({ path: '.env', override: false, quiet: true });
dotenv.config({ path: '.env.secrets.local', override: true, quiet: true });

const isProduction = process.env.NODE_ENV === 'production';
const rawCookieSecret = (process.env.JWT_SECRET ?? '').trim();

// In production a real secret is mandatory.
// In development we no longer fall back to a known constant
// ("dev-local-session-secret") — anyone who knew it could forge JWTs against
// any non-prod deployment. Instead generate a fresh random secret per process
// and warn loudly. Sessions are invalidated on every restart, which is the
// correct dev behaviour anyway.
let resolvedCookieSecret = rawCookieSecret;
if (!resolvedCookieSecret) {
  if (isProduction) {
    throw new Error('JWT_SECRET é obrigatório em produção. Gere com: openssl rand -base64 48');
  }
  resolvedCookieSecret = randomBytes(48).toString('base64');
  // eslint-disable-next-line no-console
  console.warn(
    '[env] JWT_SECRET ausente — gerando um secret efêmero para esta execução. ' +
      'Defina JWT_SECRET no .env para sessões persistentes entre restarts.',
  );
} else if (resolvedCookieSecret.length < 32) {
  // eslint-disable-next-line no-console
  console.warn(
    `[env] JWT_SECRET tem apenas ${resolvedCookieSecret.length} caracteres. ` +
      'Recomenda-se 32+ bytes aleatórios (openssl rand -base64 48).',
  );
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? '',
  cookieSecret: resolvedCookieSecret,
  databaseUrl: process.env.DATABASE_URL ?? '',
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? '',
  ownerOpenId: process.env.OWNER_OPEN_ID ?? '',
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  authRateLimitWindowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000),
  authRateLimitMaxRequests: Number(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS ?? 10),
  isProduction,
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? '',
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? '',

  // ── DeepSeek-only ─────────────────────────────────────────────────────
  // O Gemini foi cortado em 2026. Tudo passa por DeepSeek via `_core/llm.ts`.
  // Modelo padrão `deepseek-chat` (64k de contexto). Caller pode override
  // por DEEPSEEK_ANALYSIS_MODEL pra usar outro (ex.: deepseek-reasoner).
  /**
   * Provider rótulo (informativo). Mantido só pra logs/labels — não é mais
   * usado pra rotear código (todo caller agora cai em DeepSeek).
   */
  auditProvider: 'deepseek',
  auditModel: process.env.DEEPSEEK_ANALYSIS_MODEL ?? process.env.DEEPSEEK_ULTRA_MODEL ?? 'deepseek-chat',
  /**
   * Janela de contexto efetiva do modelo, em tokens. DeepSeek-chat = 64k.
   * Usamos 60k como sweet-spot deixando ~4k pra system prompt + output JSON.
   * Override via AUDIT_MODEL_CONTEXT_TOKENS no .env se trocar de modelo.
   */
  auditModelContextTokens: Number(process.env.AUDIT_MODEL_CONTEXT_TOKENS ?? 60_000),
  /**
   * Tamanho de chunk (em palavras) usado no pipeline de análise/resumo.
   * 5000 palavras ≈ 7.5k tokens — folga grande dentro do contexto 60k pra
   * sobreviver a prompt envolvente + output. Obras de 100k palavras viram
   * 20 chunks; obras de 200k viram 40.
   */
  analysisChunkWords: Math.max(
    1_000,
    Number(process.env.ANALYSIS_CHUNK_WORDS ?? 5_000) || 5_000,
  ),
  /**
   * Timeout (segundos) por chamada de análise. 900s = 15min, dá folga pra
   * obras longas com DeepSeek sob carga.
   */
  auditTimeoutSeconds: Math.max(60, Number(process.env.AUDIT_TIMEOUT_SECONDS ?? 900) || 900),
};
