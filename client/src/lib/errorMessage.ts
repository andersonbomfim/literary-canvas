export function formatApiErrorMessage(error: unknown) {
  const fallback = "Ocorreu um erro inesperado.";

  const rawMessage = (() => {
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message: unknown }).message;
      return typeof message === "string" ? message : "";
    }
    return "";
  })().trim();

  if (!rawMessage) return fallback;
  if (rawMessage === "Failed to fetch") {
    return "Servidor indisponível. Confirme se o comando pnpm dev está rodando.";
  }

  const parsed = safeParseJson(rawMessage);
  if (Array.isArray(parsed)) {
    const messages = parsed
      .map(item => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && "message" in item) {
          const message = (item as { message: unknown }).message;
          return typeof message === "string" ? message.trim() : "";
        }
        return "";
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return Array.from(new Set(messages)).join(" ");
    }
  }

  if (parsed && typeof parsed === "object") {
    const objectMessage =
      (parsed as { message: unknown; error: unknown }).message ??
      (parsed as { error: unknown }).error;
    if (typeof objectMessage === "string" && objectMessage.trim()) {
      return objectMessage.trim();
    }
  }

  return rawMessage;
}

function safeParseJson(value: string) {
  const firstChar = value[0];
  if (firstChar !== "[" && firstChar !== "{") return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
