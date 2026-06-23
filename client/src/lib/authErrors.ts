export function getFriendlyAuthErrorMessage(message: string) {
  if (message === "Failed to fetch") {
    return "Servidor indisponível. Confirme se o comando pnpm dev está rodando.";
  }

  if (
    /Failed query|Unknown column|ER_BAD_FIELD_ERROR|doesn't exist|Duplicate column name/i.test(
      message
    )
  ) {
    return "O banco estava com estrutura antiga. Reinicie o servidor e tente novamente.";
  }

  return message;
}
