/**
 * Base HTTP error class with status code.
 * Throw this from route handlers to send specific HTTP errors.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * A05 (OWASP) — Marker class for error messages that are SAFE to show to the
 * end user. Anything else thrown by the server (driver errors, parse failures,
 * upstream errors) gets a generic "Erro interno do servidor" message instead
 * of leaking the original `error.message`, which often contains schema names,
 * stack frames, library identifiers or internal IPs/ports.
 *
 * Usage:
 *   throw new UserVisibleError('Capítulo não encontrado.', 404);
 *   throw new UserVisibleError('Já existe uma conta com este e-mail.');  // 400 default
 */
export class UserVisibleError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UserVisibleError';
    this.status = status;
  }
}

// Convenience constructors
export const BadRequestError = (msg: string) => new HttpError(400, msg);
export const UnauthorizedError = (msg: string) => new HttpError(401, msg);
export const ForbiddenError = (msg: string) => new HttpError(403, msg);
export const NotFoundError = (msg: string) => new HttpError(404, msg);
