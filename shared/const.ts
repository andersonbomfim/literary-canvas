export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
/** Default lifetime of a freshly-issued session cookie / JWT (30 days). */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Sua sessão expirou. Faça login novamente para continuar.';
export const NOT_ADMIN_ERR_MSG = 'Você não tem permissão para fazer isso.';
