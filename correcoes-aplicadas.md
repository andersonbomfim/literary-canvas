# Correções aplicadas — Literary Canvas

Esta é a memória das mudanças feitas em cima do `relatorio-auditoria.md`. Cobre todos os achados **Críticos** e **Altos** (exceto C1, que você disse que ia tratar separado).

## Você precisa rodar isso antes de subir o servidor

```bash
pnpm install                 # baixa helmet + proper-lockfile (novas deps)
pnpm db:push                 # aplica drizzle/0011_unique_email.sql (UNIQUE em users.email)
pnpm check                   # opcional: tsc --noEmit pra confirmar tipos
pnpm test                    # roda os testes existentes
```

E não esquece de **rotacionar a chave Gemini e o JWT_SECRET** (C1).

## Arquivos modificados

| Arquivo | O que mudou | Achado |
|---|---|---|
| `shared/const.ts` | Novo `SESSION_TTL_MS = 30 dias` | A4 |
| `server/_core/env.ts` | Sem fallback `dev-local-session-secret`. Em dev, gera um secret aleatório e avisa | C5 |
| `server/_core/index.ts` | Helmet com CSP/HSTS, CORS allow-list explícita, CSRF guard em `/api/auth` **e** `/api/trpc`, body parser de 1 MB, `/local-exports/*` autenticado, login com mensagem genérica, registro sem fallback `confirmPassword`, auto-admin só em `LOCAL_DATA_ONLY`, URL de reset corrigida, captura de `ER_DUP_ENTRY` no email | C2, C7, C10, A1, A5, A7, A8, A12, A14 |
| `server/_core/localAuth.ts` | `issueSessionCookie` usa `SESSION_TTL_MS` e `ENV.appId` | A4 |
| `server/_core/oauth.ts` / `sdk.ts` | TTL padrão `SESSION_TTL_MS` | A4 |
| `server/_core/llm.ts` | Chave da Gemini no header `x-goog-api-key`, sem `console.log` da resposta bruta, erros internos colapsados em mensagem genérica para o cliente | A2, A3, A10 |
| `server/_core/rateLimit.ts` | Cleanup periódico, cap de 50k buckets, usa `req.ip` (respeita `app.set('trust proxy')`) | A6 |
| `server/routers/auth.ts` | Mesma mensagem de login para "não existe" e "senha errada", auto-admin só em modo local, captura de `ER_DUP_ENTRY`, URL de reset com `?` | C6, C10, A12 |
| `server/routers/writing.ts` / `storyAssistant.ts` / `ideas.ts` / `profile.ts` / `review.ts` | Cobrança atômica antes do LLM + estorno em `finally` quando algo falha | C8 |
| `server/routers/export.ts` | `unlink` do `.epub` temporário em `finally` | A9 |
| `server/db.mysql.ts` | `chargeCredits` com `UPDATE ... WHERE balance >= cost`; falha se zero rows | C8 |
| `server/localDb.ts` | `proper-lockfile.lockSync` em todo `withStore`, escrita atômica via tmp+rename, JSON corrompido vira backup `.corrupt.<ts>` em vez de truncar | C9 |
| `drizzle/schema.ts` + `drizzle/0011_unique_email.sql` | `UNIQUE` em `users.email` | C6 |
| `client/src/pages/ResetPasswordPage.tsx`, `ReviewPage.tsx`, `ProfilePage.tsx`, `components/WorkOnboarding.tsx` | `window.location.search` no lugar de `location.split("")[1]` | C3, C4 |
| `client/src/components/ErrorBoundary.tsx` | Stack trace só em dev; produção mostra mensagem amigável | A11 |
| `client/src/_core/hooks/useAuth.ts` | Removido o mirror do user em `localStorage`/`sessionStorage`; só limpa as chaves legadas | A13 |
| `package.json` | Novas deps: `helmet`, `proper-lockfile`, `@types/proper-lockfile` | A7, C9 |

## Mudanças de comportamento que valem ler antes

- **Sessão expira em 30 dias** (era 1 ano). Tokens emitidos antes continuam válidos pelos 365 dias originais até serem reissued.
- **CORS_ORIGINS é obrigatório em produção.** Sem ele, requests cross-origin são rejeitados (você verá um warn no boot).
- **CSRF strict.** Toda mutation precisa carregar `Origin` igual ao `APP_BASE_URL` (ou um valor de `CORS_ORIGINS`). Browsers fazem isso sozinhos; clientes server-to-server precisam mandar `Origin` explicitamente ou usar `Referer` + `Content-Type: application/json`.
- **Body parser caiu de 50 MB pra 1 MB.** Se algum endpoint legítimo manda payload grande (upload de capítulo bruto, importação de arquivo), monta um `express.json({ limit: 'X' })` específico naquela rota.
- **Cobrança de créditos é débito-primeiro com estorno.** Se a IA falhar, o estorno é gravado como `creditLedgerEntries.type = 'adjustment'` com `reference = refund:<original>`. UI que mostra histórico já entende esses tipos.
- **Auto-admin só em `LOCAL_DATA_ONLY=true`.** Em produção MySQL, o primeiro usuário que se cadastrar entra como `user`. Para criar o admin inicial, use `pnpm create:user admin@dominio Senha123 "Nome"` e depois promova manualmente, **ou** defina `ADMIN_EMAIL` no `.env` antes do registro.
- **Stack trace some em produção** quando o ErrorBoundary dispara. Devs continuam vendo no console.
- **`localStorage`/`sessionStorage` deixou de guardar PII**. Se você tinha código lendo `manus-runtime-user-info`, ele agora vai ler `null`. Use o `useAuth()` ou refaz a chamada `/api/auth/me`.
- **Migration 0011** adiciona `UNIQUE` em `users.email`. Se houver duplicados existentes, o `pnpm db:push` vai falhar — limpe antes (`SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1;`).

## Não cobrei nesta passada

- **C1 — chaves expostas no .env**: você disse que ia tratar.
- **Médios e baixos** (M1–M12, B1–B8) do relatório original. Estão no `relatorio-auditoria.md` esperando.
