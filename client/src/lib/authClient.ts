export type AuthResponse<T = Record<string, unknown>> = T & {
  success: boolean;
  error: string;
};

export async function readJsonSafely<T extends Record<string, unknown>>(
  response: Response
): Promise<AuthResponse<T>> {
  const raw = await response.text();
  if (!raw) return {} as AuthResponse<T>;

  const normalized = raw.trim();
  if (!normalized || normalized === "undefined" || normalized === "null") {
    throw new Error(
      "O servidor devolveu uma resposta inválida. Reinicie o site e tente novamente."
    );
  }

  try {
    return JSON.parse(normalized) as AuthResponse<T>;
  } catch {
    throw new Error(
      "O servidor devolveu uma resposta inválida. Reinicie o site e tente novamente."
    );
  }
}

export function toFriendlyErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Falha inesperada. Tente novamente.";
  }

  if (error.message === "Failed to fetch") {
    return "Servidor indisponível. Confirme se o comando pnpm dev está rodando.";
  }

  return error.message;
}
