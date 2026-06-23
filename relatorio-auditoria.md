# RelatÃ³rio de Auditoria â€” Literary Canvas

Varredura focada em **seguranÃ§a, bugs lÃ³gicos, performance e qualidade**, em todo o projeto (`server/`, `client/`, `shared/`, configs e Dockerfile). Os achados estÃ£o ordenados por severidade. Cada item indica arquivo, linha aproximada, impacto e recomendaÃ§Ã£o.

---

## ðŸ”´ CRÃTICOS

### C1. Chave da API provedor antigo real comitada em `.env`
**Arquivo:** `.env`
**Trecho:** `IA_API_KEY_ANTIGA=<redigido>`

`.env` estÃ¡ no `.gitignore`, mas o arquivo existe no disco com o que parece ser uma chave Google real. Qualquer pessoa que abra o projeto, qualquer screenshot, qualquer backup â€” vaza a chave. Como ela jÃ¡ apareceu nesta sessÃ£o, deve ser considerada **comprometida**.

**AÃ§Ã£o:** Revogar a chave imediatamente no Google Cloud Console e gerar outra. Trocar `JWT_SECRET` tambÃ©m (estÃ¡ em texto claro no mesmo arquivo). Confirmar que `.env` nunca foi commitado (`git log --all -- .env`).

---

### C2. CORS em produÃ§Ã£o libera **todas as origens** se `CORS_ORIGINS` nÃ£o estiver configurada
**Arquivo:** `server/_core/index.ts:82-91`

```ts
if (process.env.NODE_ENV !== 'production' || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  ...
}
```

Em produÃ§Ã£o, se `CORS_ORIGINS` estÃ¡ vazia (`allowedOrigins.length === 0` â†’ `true`), a condiÃ§Ã£o inteira vira `true` e **qualquer origem** recebe `Access-Control-Allow-Origin` refletido com `Allow-Credentials: true`. Isso anula a proteÃ§Ã£o e permite que qualquer site execute tRPC autenticado em nome do usuÃ¡rio logado.

**AÃ§Ã£o:** Trocar para `&&` ou exigir explicitamente `allowedOrigins.length > 0` em produÃ§Ã£o:
```ts
if (process.env.NODE_ENV === 'production' && (!allowedOrigins.length || !allowedOrigins.includes(origin))) return next();
```

---

### C3. Fluxo de reset de senha **totalmente quebrado**
Dois bugs em sÃ©rie anulam o recurso:

**a) URL malformada gerada pelo backend**
`server/_core/index.ts:291` e `server/routers/auth.ts:94`
```ts
const resetUrl = `/reset-passwordtoken=${token}`;
```
Falta o `?`. Deveria ser `/reset-password?token=${token}`.

**b) Parser de query string usa `split("")` (string vazia) no frontend**
`client/src/pages/ResetPasswordPage.tsx:19`
```ts
const params = useMemo(() => new URLSearchParams(location.split("")[1] || ""), [location]);
```
`"abc".split("")` devolve `["a","b","c"]`; `[1]` retorna a **segunda letra**, nÃ£o a query string. O token nunca Ã© lido. Bug se repete em mais 3 pÃ¡ginas (ver C4).

**AÃ§Ã£o:** Corrigir a URL para `?token=...` e trocar `location.split("")` por `window.location.search` (em wouter v3, `useLocation` devolve sÃ³ o path).

---

### C4. Parsing de query string quebrado em 4 pÃ¡ginas (`split("")` â‰  `split("?")`)
Mesmo bug, em todos esses pontos:

- `client/src/components/WorkOnboarding.tsx:233` â€” parÃ¢metro `?createWork=1&mode=...` ignorado, criaÃ§Ã£o de obra via deep link nÃ£o funciona.
- `client/src/pages/ProfilePage.tsx:854` â€” `?tab=...` ignorado, navegaÃ§Ã£o direta para abas falha.
- `client/src/pages/ResetPasswordPage.tsx:19` â€” ver C3.
- `client/src/pages/ReviewPage.tsx:77` â€” `?chapterId=...` ignorado, links externos pra revisÃ£o quebram.

**AÃ§Ã£o:** Substituir por `new URLSearchParams(window.location.search)` ou usar o helper de wouter.

---

### C5. Fallback do `JWT_SECRET` para string conhecida em dev
**Arquivo:** `server/_core/env.ts:6-10`
```ts
const cookieSecret = process.env.JWT_SECRET ?? '';
...
cookieSecret: cookieSecret || 'dev-local-session-secret',
```

Se alguÃ©m roda o servidor com `NODE_ENV != 'production'` e sem variÃ¡vel, qualquer pessoa que conheÃ§a a string `dev-local-session-secret` (agora ela estÃ¡ aqui, no cÃ³digo e neste relatÃ³rio) pode forjar JWTs e logar como qualquer usuÃ¡rio. Em ambientes de teste/staging que escapam dessa checagem, a falha Ã© total.

**AÃ§Ã£o:** Falhar duro se o secret nÃ£o estiver definido, mesmo em dev. Ou gerar um secret aleatÃ³rio por boot e logar um aviso.

---

### C6. Sem `unique` constraint em `users.email`
**Arquivo:** `drizzle/schema.ts:5-18`

A coluna `email` tem sÃ³ Ã­ndice, nÃ£o constraint Ãºnica. Duas chamadas concorrentes em `/api/auth/register` com o mesmo e-mail passam o `getUserByEmail` antes de qualquer um inserir â†’ duas contas com o mesmo e-mail. Isso quebra `getUserByEmail` (retorna `LIMIT 1`) e produz comportamento imprevisÃ­vel em login e reset de senha.

**AÃ§Ã£o:** Migration que adicione `UNIQUE` em `email` e em `openId` (jÃ¡ Ã© `.unique()` em `openId`). Tratar `ER_DUP_ENTRY` no insert.

---

### C7. CSRF nÃ£o cobre `/api/trpc`
**Arquivo:** `server/_core/index.ts:120-145`

A checagem de origem sÃ³ roda em `/api/auth`. Toda a API de mutaÃ§Ã£o (criaÃ§Ã£o/ediÃ§Ã£o/exclusÃ£o de obras, cobranÃ§a de crÃ©ditos, geraÃ§Ã£o de capÃ­tulos) estÃ¡ em `/api/trpc` e usa cookie `httpOnly`, sem token CSRF nem checagem de origem. SameSite=`lax` mitiga POST top-level, mas requisiÃ§Ãµes XHR cross-site com credenciais ainda passam se C2 estiver ativo. Combine C2 + C7 e qualquer site pode gastar crÃ©ditos do usuÃ¡rio.

**AÃ§Ã£o:** Aplicar a mesma verificaÃ§Ã£o de origem em `/api/trpc` ou exigir um header customizado (jÃ¡ se usa `x-active-work-id` â€” basta tornar obrigatÃ³rio qualquer header nÃ£o-padrÃ£o para forÃ§ar preflight).

---

### C8. Race condition em cobranÃ§a de crÃ©ditos (overdraft)
**Arquivo:** `server/routers/writing.ts:307-330`, `server/routers/profile.ts:1596`, `server/routers/storyAssistant.ts:108-118`, `server/routers/ideas.ts` (vÃ¡rios)

O padrÃ£o Ã© sempre o mesmo:
```ts
await ensureSufficientCredits(userId, COST);   // SELECT
... await invokeLLM(...) ...
await chargeCredits(userId, COST, ...);        // UPDATE
```
Sem lock pessimista, transaÃ§Ã£o ou `UPDATE ... WHERE balance >= cost`. O usuÃ¡rio com 25 crÃ©ditos pode disparar 5 requisiÃ§Ãµes paralelas de geraÃ§Ã£o (custo 25 cada) e gastar todas, ficando com saldo negativo. Em modo local (`localDb`) nÃ£o hÃ¡ nem transaÃ§Ã£o possÃ­vel â€” o JSON Ã© reescrito sem mutex (ver C9).

**AÃ§Ã£o:** Trocar para dÃ©bito atÃ´mico: `UPDATE creditWallets SET balance = balance - ? WHERE userId = ? AND balance >= ?` e checar `affectedRows`. Usar transaÃ§Ã£o ao redor de criar capÃ­tulo + cobrar.

---

### C9. `localDb` reescreve JSON sem locking nem escrita atÃ´mica
**Arquivo:** `server/localDb.ts:185-235`

`readStore()` lÃª todo o arquivo, `writeStore()` faz `fs.writeFileSync` sem renomear via tmp. Duas requisiÃ§Ãµes concorrentes:
1. A lÃª store, B lÃª store
2. A muta, B muta
3. A escreve, B escreve â†’ mudanÃ§as de A perdidas
4. Se a escrita for interrompida, o JSON fica corrompido (e o `catch` em `readStore` *substitui o store por EMPTY_STORE* â€” perda de dados silenciosa)

**AÃ§Ã£o:** Usar `proper-lockfile` ou similar; gravar em `tmp + rename`; manter um cache em memÃ³ria com fila de escrita.

---

### C10. Login revela existÃªncia da conta (user enumeration)
**Arquivo:** `server/_core/index.ts:204-215`, `server/routers/auth.ts:42-49`
```ts
if (!user || user.loginMethod !== 'local') {
  throw new Error('Conta nÃ£o encontrada para este e-mail.');
}
...
throw new Error('Senha incorreta.');
```
Mensagens distintas permitem ao atacante mapear quais e-mails tÃªm conta â€” combinado com vazamentos pÃºblicos, vira ataque de phishing direcionado. O endpoint de reset (`requestPasswordReset`) usa mensagem genÃ©rica em produÃ§Ã£o, mas o login nÃ£o.

**AÃ§Ã£o:** Mensagem Ãºnica tipo `"E-mail ou senha incorretos."` para ambos os casos.

---

## ðŸŸ  ALTOS

### A1. `confirmPassword` falsificÃ¡vel no registro
**Arquivo:** `server/_core/index.ts:155-160`
```ts
confirmPassword: body.confirmPassword ?? body.password,
```
Se o atacante nÃ£o enviar `confirmPassword`, o backend usa o prÃ³prio password como confirmaÃ§Ã£o. A regra `password === confirmPassword` no schema vira sempre `true`. A validaÃ§Ã£o de "duas senhas iguais" depende **sÃ³ do frontend**.

**AÃ§Ã£o:** Remover o fallback. Exigir `confirmPassword` explÃ­cito.

---

### A2. Chave provedor antigo enviada na URL como query string
**Arquivo:** `server/_core/llm.ts:188-190`
```ts
const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;
```
URLs com query string vazam em logs de proxy, em mensagens de erro repassadas, em ferramentas de observabilidade. A prÃ³pria mensagem de erro do provedor antigo Ã© colocada em `Error()` e propagada via tRPC para o cliente (`...errorText}`), o que pode incluir o `key=...` se o Google ecoÃ¡-lo.

**AÃ§Ã£o:** Usar header `x-goog-api-key: <chave>` em vez de query string.

---

### A3. Logging de resposta bruta da provedor antigo em todo request bem-sucedido
**Arquivo:** `server/_core/llm.ts:379`
```ts
console.log(`[provedor antigo] Raw response (${model}):`, JSON.stringify(rawJson).slice(0, 1000));
```
Loga 1 KB do conteÃºdo gerado (que pode conter trechos do rascunho do usuÃ¡rio, fragmentos de capÃ­tulo, dados do perfil). Em produÃ§Ã£o, vai parar em CloudWatch/datadog/onde for. Vazamento de PII e de propriedade intelectual do autor.

**AÃ§Ã£o:** Remover esse log ou reduzir a `rawJson?.usageMetadata` apenas.

---

### A4. JWT de sessÃ£o dura 1 ano e nÃ£o tem revogaÃ§Ã£o
**Arquivo:** `shared/const.ts` (`ONE_YEAR_MS`), `server/_core/sdk.ts:171-186`

O cookie Ã© `httpOnly` (bom), mas qualquer token roubado vale por 12 meses, sem lista de revogaÃ§Ã£o. Logout sÃ³ apaga o cookie no browser â€” o JWT continua vÃ¡lido se jÃ¡ foi exfiltrado.

**AÃ§Ã£o:** Reduzir TTL para algumas horas + refresh; armazenar `jti` revogado em cache; ou usar tabela de sessÃµes em vez de JWT puro.

---

### A5. Body parser de **50 MB** em todas as rotas
**Arquivo:** `server/_core/index.ts:111-112`
```ts
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
```
Permite a qualquer requisiÃ§Ã£o autenticada (e a algumas nÃ£o autenticadas) consumir 50 MB de RAM por payload. Concurrency de 20 = 1 GB. DoS trivial.

**AÃ§Ã£o:** Limitar a 1â€“2 MB e aplicar limites maiores **apenas** nas rotas que recebem upload (com `multer` ou parser dedicado).

---

### A6. Rate limiter cresce sem cleanup e confia em `x-forwarded-for`
**Arquivo:** `server/_core/rateLimit.ts`

Dois problemas:
- O `Map` `buckets` nunca remove entradas expiradas â€” vaza memÃ³ria proporcional ao nÃºmero de IPs distintos vistos.
- `getClientKey` lÃª `x-forwarded-for` direto, sem `app.set('trust proxy', ...)`. Se o servidor estÃ¡ exposto sem proxy reverso, qualquer cliente pode setar o header para evitar o limite.

**AÃ§Ã£o:** Usar `express-rate-limit` (com store que limpa) ou rodar um `setInterval` para purgar entradas. Ativar `trust proxy` apenas se hÃ¡ proxy confiÃ¡vel e usar `req.ip`.

---

### A7. Sem cabeÃ§alhos de seguranÃ§a (Helmet, CSP, HSTS, X-Frame-Options)
**Arquivo:** `server/_core/index.ts`

Nenhum middleware de seguranÃ§a HTTP. Sem CSP â†’ XSS Ã© sÃ³ uma falha distÃ¢ncia de virar takeover. Sem HSTS â†’ downgrade attack. Sem X-Frame-Options â†’ clickjacking. Sem `Referrer-Policy` â†’ vaza URL completa para terceiros.

**AÃ§Ã£o:** Adicionar `helmet()` com CSP estrita logo no topo.

---

### A8. Exports locais nunca sÃ£o servÃ¡veis pelo Express
**Arquivo:** `server/storage.ts:49,71` + `server/_core/index.ts`

`storagePut` retorna `url: '/local-exports/...'`, mas nada em `app.use(...)` serve esse path. O usuÃ¡rio recebe um link 404. Em produÃ§Ã£o (sem `BUILT_IN_FORGE_API_URL`/`BUILT_IN_FORGE_API_KEY`), exportar capÃ­tulo estÃ¡ **quebrado**.

**AÃ§Ã£o:** Adicionar `app.use('/local-exports', express.static(LOCAL_EXPORTS_DIR))` **com autenticaÃ§Ã£o** (nÃ£o pode ser pÃºblico, contÃ©m capÃ­tulos privados de outros usuÃ¡rios!).

---

### A9. EPUBs temporÃ¡rios nunca sÃ£o deletados
**Arquivo:** `server/routers/export.ts:75-86`
```ts
const tempPath = path.resolve(process.cwd(), '.local-exports', `tmp-...`);
await new Epub(option).promise;
const buffer = await fs.readFile(tempPath);
const { url } = await storagePut(...);
```
O arquivo `tmp-*.epub` fica em disco para sempre. Cada export adiciona um arquivo. Vazamento de espaÃ§o + risco de leak (alguÃ©m com acesso ao container vÃª os capÃ­tulos).

**AÃ§Ã£o:** `await fs.unlink(tempPath)` num `finally`. Considerar gerar EPUB em memÃ³ria.

---

### A10. Erros do upstream provedor antigo propagados ao cliente
**Arquivo:** `server/_core/llm.ts:288-294, 318-325`

`new Error(\`provedor antigo API error (${model}): ${response.status} ${response.statusText} - ${errorText}\`)` Ã© jogado para fora. tRPC empacota a `message` no payload de erro. O frontend mostra/loga a mensagem. Detalhes do nome do modelo, conta, projeto, motivo de bloqueio chegam ao cliente final.

**AÃ§Ã£o:** Logar internamente o erro detalhado e devolver mensagem genÃ©rica para o usuÃ¡rio (`"Falha ao gerar conteÃºdo. Tente novamente."`).

---

### A11. `ErrorBoundary` mostra stack trace completo em produÃ§Ã£o
**Arquivo:** `client/src/components/ErrorBoundary.tsx:31-47`
```tsx
<pre>{this.state.error?.stack ?? this.state.error?.message ?? "Erro desconhecido."}</pre>
```
Stack trace expÃµe estrutura de pastas (`/src/...`), nomes internos, possÃ­veis trechos de payload.

**AÃ§Ã£o:** Mostrar mensagem amigÃ¡vel em produÃ§Ã£o e enviar o stack para Sentry/log.

---

### A12. Primeiro usuÃ¡rio cadastrado vira admin automaticamente
**Arquivo:** `server/_core/index.ts:177-179`, `server/routers/auth.ts:69-71`
```ts
const shouldBeAdmin = totalUsers === 0 || ...
```
Em ambientes onde alguÃ©m escapa de seguir as instruÃ§Ãµes e expÃµe o app antes de criar a conta-mÃ£e, o primeiro visitante vira admin do sistema. Combinado com `countUsers()` ineficiente (ver M2), isso Ã© silencioso.

**AÃ§Ã£o:** Provisionar o admin via script (jÃ¡ existe `scripts/create-local-user.mjs` â€” remover o atalho do registro).

---

### A13. Dados do usuÃ¡rio em `localStorage`/`sessionStorage`
**Arquivo:** `client/src/_core/hooks/useAuth.ts:42-58`

O objeto inteiro do usuÃ¡rio (id, openId, email, role) Ã© serializado em `localStorage` E em `sessionStorage` a cada `refresh`. NÃ£o Ã© o token de sessÃ£o (que Ã© `httpOnly` cookie, ok), mas qualquer XSS â€” e ainda nÃ£o hÃ¡ CSP â€” drena PII e a role do usuÃ¡rio, que pode ser usada para redirecionamentos cruzados.

**AÃ§Ã£o:** Manter o estado sÃ³ em React. `localStorage` para dados sensÃ­veis nunca Ã© boa ideia.

---

### A14. CORS reflete origin em dev sem nenhuma checagem
**Arquivo:** `server/_core/index.ts:84-87`

Em desenvolvimento, qualquer origem recebe `Access-Control-Allow-Credentials: true`. Se o dev abrir uma pÃ¡gina maliciosa enquanto estÃ¡ logado no localhost, ela tem acesso total Ã  sua conta.

**AÃ§Ã£o:** Mesmo em dev, restringir a `localhost`/`127.0.0.1` (e portas configurÃ¡veis).

---

## ðŸŸ¡ MÃ‰DIOS

### M1. PaginaÃ§Ã£o fake (slice em memÃ³ria)
`server/routers/drafts.ts:20-26`, `server/routers/characters.ts:34-50`, `server/routers/library.ts:33-50`, `server/routers/writing.ts:359-372`, etc.

VÃ¡rios endpoints fazem `getUserChapters(...)` (sem LIMIT) e depois `.slice(offset, offset+limit)`. Quando o usuÃ¡rio tiver 1.000 capÃ­tulos, cada listagem trafega tudo do MySQL para o Node, descarta e devolve 50.

**AÃ§Ã£o:** Empurrar `limit/offset` para o nÃ­vel Drizzle (`.limit().offset()`).

---

### M2. `countUsers` carrega todos para contar
`server/db.mysql.ts:122-126`
```ts
export async function countUsers() {
  const allUsers = await listUsers();
  return allUsers.length;
}
```
Trivial mas roda em **todo registro** (para decidir admin). Em qualquer escala, lento.

**AÃ§Ã£o:** `db.select({ c: count() }).from(users)`.

---

### M3. `searchLibraryEntriesBroad` faz `LIKE %query%` sem escapar `%` e `_`
`server/db.mysql.ts:1605-1613`

NÃ£o Ã© SQLi (Drizzle parametriza), mas o usuÃ¡rio pode digitar `%` ou `_` e quebrar a semÃ¢ntica/explodir o custo da query (varre todas as colunas TEXT). Junto com 3 colunas no `OR`, MySQL nÃ£o usa Ã­ndice â€” full scan.

**AÃ§Ã£o:** Escapar `%` e `_`; considerar FULLTEXT index.

---

### M4. `workGuard` lanÃ§a `Error` puro (nÃ£o `TRPCError`)
`server/_core/workGuard.ts`

`throw new Error('Selecione uma obra ativa...')` cai no fallback de tRPC e vira cÃ³digo `INTERNAL_SERVER_ERROR` (500), embora seja erro de cliente (400/403). Quebra rastreabilidade de erros e a `toHttpError` em `index.ts` nÃ£o pega.

**AÃ§Ã£o:** Trocar por `throw new TRPCError({ code: 'BAD_REQUEST', message: '...' })`.

---

### M5. ValidaÃ§Ãµes Zod sem teto de tamanho
A maioria dos `z.string()` em routers (chapter title, content, draft notes, etc.) nÃ£o tem `.max()`. Combinado com body-parser de 50 MB, dÃ¡ pra inflar uma Ãºnica coluna atÃ© estourar a tabela.

**AÃ§Ã£o:** `.max(255)` para tÃ­tulos, `.max(100_000)` para conteÃºdo, etc.

---

### M6. Filtro de seguranÃ§a da provedor antigo em `BLOCK_ONLY_HIGH`
`server/_core/llm.ts:117-122`

Para uma ferramenta de escrita literÃ¡ria faz sentido afrouxar, mas isso significa que conteÃºdo violento, sexual ou de assÃ©dio passa fÃ¡cil. Vale tornar configurÃ¡vel por usuÃ¡rio/perfil em vez de global.

---

### M7. ConcorrÃªncia ao "salvar capÃ­tulo" sem versionamento atÃ´mico
`server/routers/writing.ts` `save:` cria `chapterVersion` antes do `updateChapter`, sem transaÃ§Ã£o. Se o update falhar, a versÃ£o fica Ã³rfÃ£ apontando para conteÃºdo desatualizado.

**AÃ§Ã£o:** Envolver em transaÃ§Ã£o Drizzle (`db.transaction`).

---

### M8. `epub-gen` versÃ£o 0.1.0 (abandonado)
`package.json:61` â†’ `"epub-gen": "^0.1.0"`. Ãšltima publicaÃ§Ã£o Ã© antiga, com vulnerabilidades transitivas (jsdom, request).

**AÃ§Ã£o:** Migrar para `epub-gen-memory` ou `nodepub`.

---

### M9. `console.log` em rotas de produÃ§Ã£o
`server/_core/llm.ts:379`, `server/routers/profile.ts:1251,1288,1313,1716`, `client/src/pages/ProfilePage.tsx:1042`, `server/db.ts:9-11`

Logs com payload do usuÃ¡rio. Usar o `logger.ts` que jÃ¡ existe (e respeita `LOG_LEVEL`).

---

### M10. Dynamic `await import("crypto")`/`zod`/`localAuth` em rotas crÃ­ticas
`server/_core/index.ts:281-305`

Imports dinÃ¢micos no caminho quente das rotas de auth introduzem latÃªncia sem motivo (jÃ¡ Ã© `type: module`). Trazer para o topo.

---

### M11. `CORS` aceita header `Authorization` mas auth Ã© via cookie
`server/_core/index.ts:88` â€” header `Authorization` permitido, embora o servidor nÃ£o use. SuperfÃ­cie desnecessÃ¡ria.

---

### M12. Cobertura de testes desbalanceada
- HÃ¡ `auth.logout.test.ts`, `library.test.ts`, `notifications.test.ts`, `profile.test.ts`, `workGuard.test.ts`, `works.test.ts`, `writing.test.ts`, `writing.no-fallback.test.ts`.
- Sem testes: `ideas.ts` (722 linhas, vÃ¡rios endpoints pagos), `storyAssistant.ts`, `series.ts`, `versions.ts`, `export.ts`, `billing.ts`, `characters.ts`, `drafts.ts`, `search.ts`, `review.ts`, `promptTemplates.ts`, todo `_core/llm.ts`, `_core/sdk.ts`.

---

## ðŸŸ¢ BAIXOS

### B1. Muitos `any` espalhados (~97 ocorrÃªncias `: any`)
Reduz garantia de tipos. `(data as any).platforms` em `sdk.ts`, `(row as any).content` em `search.ts`, etc. Refatorar para tipos discriminados ou `unknown` + validaÃ§Ã£o Zod.

### B2. Arquivos gigantes (manutenÃ§Ã£o)
- `server/db.mysql.ts` â€” 1934 linhas
- `server/localDb.ts` â€” 1664 linhas
- `server/routers/profile.ts` â€” 1735 linhas
- `server/routers/ideas.ts` â€” 722 linhas

Quebrar por domÃ­nio (works, drafts, libraryâ€¦).

### B3. Reset token recebido na resposta da API em dev
`server/routers/auth.ts:97`, `server/_core/index.ts:296-298`. Conveniente, mas pode vazar em logs de cliente. Documentar / remover quando houver e-mail real.

### B4. Senha padrÃ£o fraca no script CLI
`scripts/create-local-user.mjs:7` â€” `passwordArg = 'Senha123'`. UsÃ¡vel em testes, perigoso se rodado por engano em ambiente real.

### B5. `findAvailablePort` ignora `PORT` se ocupada
`server/_core/index.ts:39-49` â€” sobe na prÃ³xima livre e sÃ³ loga warning. Em produÃ§Ã£o isso esconde port collisions sÃ©rias.

### B6. `Authorization` redirect de logout/login usa `window.location.href`
VÃ¡rias pÃ¡ginas (`useAuth.ts`, `ProtectedRoute.tsx`) fazem `window.location.href = ...`. Funciona, mas perde estado e descarta cache react-query. Preferir `navigate()` do wouter quando possÃ­vel.

### B7. `recharts: ^2.15.2` com `react: ^19` â€” compat instÃ¡vel
Recharts 2.x ainda nÃ£o declara suporte oficial a React 19; pode quebrar em build de produÃ§Ã£o dependendo da versÃ£o exata.

### B8. `LOCAL_DATA_ONLY` decidido em boot via `process.env.LOCAL_DATA_ONLY === 'true'`, mas `databaseUrl.ts` tambÃ©m tenta MySQL por conta prÃ³pria â€” comportamento ambÃ­guo se as duas variÃ¡veis estÃ£o setadas.

---

## PriorizaÃ§Ã£o sugerida

1. **Antes de qualquer commit**: rotacionar a chave provedor antigo exposta (C1) e o `JWT_SECRET` (C5). Adicionar ambos a um secret manager.
2. **Hot-fix imediato no cÃ³digo**: corrigir CORS (C2), CSRF tRPC (C7), `split("")` (C3+C4), `confirmPassword` fallback (A1).
3. **Curto prazo (esta semana)**: race condition de crÃ©ditos (C8), unique constraint em email (C6), helmet/CSP (A7), reduzir body parser (A5).
4. **MÃ©dio prazo**: paginaÃ§Ã£o real (M1), revogaÃ§Ã£o de sessÃ£o (A4), limpeza de tmp files (A9), proteger `/local-exports` (A8).
5. **Refator/qualidade**: dividir arquivos enormes (B2), eliminar `any`, ampliar testes para `ideas/profile/llm`.

---

_RelatÃ³rio gerado em 2026-05-07 a partir da varredura estÃ¡tica do cÃ³digo em `C:\Users\Anderson\Downloads\literary-canvas-rebuild-v3-fixed\project`._
