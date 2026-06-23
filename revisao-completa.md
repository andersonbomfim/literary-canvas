# Revisão completa — Literary Canvas

Data: 2026-05-15
Escopo: código completo (server + client + shared) **após** a aplicação dos fixes de `relatorio-auditoria.md`, `correcoes-aplicadas.md` e `auditoria-owasp.md`.

Foco desta passada: **experiência do usuário, fluxos confusos, qualidade de código e dívida técnica** — assuntos que ficaram fora das auditorias anteriores (que cobriram segurança e bugs lógicos pontuais).

Severidades:

- **P0** — quebra a experiência ou bloqueia tarefa. Conserta hoje.
- **P1** — usuário consegue continuar mas vai reclamar. Conserta esta semana.
- **P2** — qualidade/limpeza. Conserta no próximo refator de área.
- **P3** — gosto pessoal, opcional.

---

## P0 — Bloqueia ou trava o usuário

### P0.1 — 4 links com URL malformada (mesma família dos `split("")` já corrigidos)

Mesmo padrão dos bugs `/reset-passwordtoken=` e `/writingchapterId=` que já consertamos: faltou o `?` separando path do query string. Esses 4 links levam a 404 ou a página errada sem param.

| Arquivo | Linha | Atual | Deve ser |
|---|---|---|---|
| `client/src/pages/Home.tsx` | 87 | `` `/draftdraftId=${recentDrafts[0].id}` `` | `` `/draft?draftId=${recentDrafts[0].id}` `` |
| `client/src/pages/Home.tsx` | 203 | `` `/draftdraftId=${draft.id}` `` | `` `/draft?draftId=${draft.id}` `` |
| `client/src/pages/IdeasPage.tsx` | 644 | `"/profiletab=style"` | `"/profile?tab=style"` |
| `client/src/pages/ReviewPage.tsx` | 320 | `` `/reviewchapterId=${item.id}` `` | `` `/review?chapterId=${item.id}` `` |

**Impacto:** o card "Próxima ação" da Home, a lista de rascunhos recentes da Home, o atalho "ver perfil de estilo" das Ideias e a navegação dentro do próprio Review estão todos quebrados. Conserta com find-replace.

### P0.2 — `Home.tsx:91` parâmetro inconsistente em `forceWorkCreator`

```ts
const forceWorkCreator = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("createWork") === "1"
  : location.includes("createWork=1");
```

O fallback SSR usa `location.includes("createWork=1")` mas `location` do wouter é só o pathname. Sem janela, sempre devolve `false`. Não é P0 puro porque o app é client-only, mas se você adicionar SSR algum dia vira bug. Use só `window.location.search` — quem renderiza no servidor não precisa do creator.

### P0.3 — `WritingPage` mostra "ocupado" pra sempre quando job falha

`client/src/pages/WritingPage.tsx:276-281`

```ts
const generationInProgress = Boolean(
  activeGenerationJobId &&
    activeGenerationStatus &&
    !["completed", "failed", "canceled"].includes(activeGenerationStatus),
);
```

Tecnicamente certo, mas o estado `activeGenerationJobId` vem de `setActiveGenerationJobId` no `onSuccess` da mutation. Se o usuário fecha a aba durante a geração, ao voltar o `activeGenerationJobId` está null e a UI não sabe que existe um job rodando. Solução: persistir o `jobId` ativo na URL (já está sendo feito em `navigate(`/writing?...&jobId=${result.data.jobId}`)`) e LER do query string no boot.

### P0.4 — Lista de rascunhos pode ter botão dentro de botão (a11y + ESLint warning)

Eu acabei de consertar isso na DraftPage, mas vale conferir nas outras listagens (`Home.tsx`, `DashboardPage.tsx`, `LibraryPage.tsx`) — qualquer card-link com botão de ação dentro precisa do mesmo wrapper que fiz na DraftPage. Caso contrário, leitor de tela anuncia o botão de exclusão como parte do link de abrir.

### P0.5 — `ProfilePage.tsx` tem **3.291 linhas** num único arquivo

Não é problema do usuário diretamente, mas qualquer alteração ali vira roleta russa: tabs de Perfil, Universo, Personagens, Estilo, Continuidade, Importação tudo no mesmo arquivo. Já tem 4 efeitos colaterais documentados de regex falsos positivos só nesta passada de revisão. Risco real de quebra acidental.

**Recomendado:** quebrar em `ProfilePage/StyleTab.tsx`, `UniverseTab.tsx`, `KeyChaptersTab.tsx`, `CharactersTab.tsx`, `ImportTab.tsx`. Cada uma vira ~500 linhas.

---

## P1 — Usuário consegue mas vai reclamar

### P1.1 — Termos do produto sem nenhum tooltip / glossário

O app usa vocabulário próprio que NÃO é óbvio pra quem chega:

- "Bíblia da Obra"
- "Memória de continuidade"
- "Pacote canônico"
- "Capítulo canônico" vs "Em escrita" vs "Hipótese" vs "Descartado"
- "Essência absorvida" (na aba Estilo)
- "Universo da obra"
- "Capítulos-chave"
- "Cânone pesquisável"
- "Limites canônicos"
- "Story foundation"
- "Negative rules"

Um escritor que entra pela primeira vez encontra esses termos sem explicação. Sugestões:

1. **Tooltip** (`<HoverCard>` do Radix já está disponível) em cada um na primeira ocorrência por sessão.
2. **Página `/glossario`** com todos definidos.
3. **Onboarding tour** opcional na primeira sessão (ver P1.7).

### P1.2 — Erros do tRPC ainda chegam crus em pontos sensíveis

Apesar do `errorFormatter` (A05 OWASP), muitos `toast.error(error.message)` no frontend mostram mensagens ainda técnicas:

- `client/src/components/ExportChapter.tsx:33,52,70` — `toast.error(\`Erro ao exportar: ${error.message}\`)` — se o erro vem do storagePut, vira "Erro ao exportar: Storage upload failed (502...)".
- `client/src/pages/AdminPage.tsx:27,34,41` — `onError: (error) => toast.error(error.message)` — admin vê detalhes ok, mas se for o usuário não-admin vê a string crua.

**Padrão a adotar:** wrapper `friendlyError(err)` que filtra prefixos técnicos comuns e cai num genérico se a mensagem tiver `HTTP`, `ECONN`, `ENOENT`, etc.

### P1.3 — Empty states muito secos

Vários lugares só mostram "Nenhum item":

- `client/src/pages/LibraryPage.tsx` listagem sem entradas → não explica que personagens/eventos/locais entram aqui.
- `client/src/pages/SeriesPage.tsx` sem séries → faltam orientações sobre quando criar uma série (vs uma obra solta).
- `client/src/pages/ReviewPage.tsx` filas vazias → diz "Nenhum capítulo aqui." sem explicar que precisa enviar da Escrita.
- `client/src/pages/Home.tsx` quando todas as métricas são 0 → mostra zeros sem chamada de ação clara.

**Padrão recomendado:** todo empty state deve ter (1) ícone, (2) frase explicando o que entra ali, (3) botão de ação primária pra resolver.

### P1.4 — `LandingPage.tsx` tem texto sem acento aparecendo na hero

`client/src/pages/LandingPage.tsx:104` — *"A proxima cena"* (mockup do "Obra ativa" no banner). Falta o til em "próxima". Cosmético, mas é literalmente a primeira impressão do produto.

Mesma página, linha 47: *"produção literária com escopo real"* — frase sem maiúscula inicial num lugar onde o título do produto está com maiúscula (`Literary Canvas`). Inconsistência visual.

### P1.5 — Texto do `RegisterPage` tem 3 acentos faltando + placeholder questionável

`client/src/pages/RegisterPage.tsx`:

- Linha 60: *"Ja tem conta"* → "Já tem conta"
- Linha 78: *"Use no minimo 8 caracteres, com maiuscula, minuscula e numero."* → "Use no mínimo 8 caracteres, com maiúscula, minúscula e número."
- Linha 96: *"Politica de Privacidade"* → "Política de Privacidade"
- Linha 80: `placeholder="Ex.: Senha123"` — colocar uma senha real como exemplo treina o usuário a ESCOLHER `Senha123` e cair em ataques de dicionário. Trocar por `"Mínimo 8, com maiúscula, número"` ou simplesmente remover o exemplo.

### P1.6 — `NotFound.tsx` redireciona para `/home` em rotas de auth — comportamento traiçoeiro

`client/src/pages/NotFound.tsx:7-22`

```ts
const LOCAL_AUTH_PATHS = new Set(["/login","/register","/forgot-password","/reset-password"]);
useEffect(() => {
  if (LOCAL_AUTH_PATHS.has(location)) {
    setLocation("/home");
  }
}, [location, setLocation]);
```

Se as rotas de auth caírem aqui (já vimos que em algum momento caíam), o usuário é jogado pra `/home`, que se ele não estiver logado vai jogar pro login → loop ou redirecionamento sem feedback. Esse fallback é tampão; melhor garantir que as rotas de auth nunca caiam no NotFound (já está garantido pelo `Switch` do wouter no App.tsx, então este `useEffect` deveria sumir).

### P1.7 — Não tem onboarding/tour pro usuário novo

Quando o usuário cria a conta, vai pra `/home` que mostra o `WorkOnboarding`. OK. Mas o `WorkOnboarding` tem **1.789 linhas** e mostra TUDO de uma vez: importar livro, criar manual, definir estilo, configurar universo. Um escritor com pressa só quer "começar a escrever" — não tem caminho rápido.

**Sugestão:** dois botões grandes na Home vazia: **"Quero importar um livro pronto"** e **"Quero começar do zero"**. O atual joga tudo num formulário gigante.

### P1.8 — Confirmações destrutivas usam `window.confirm` (eu mesmo coloquei na DraftPage)

`window.confirm` é nativo, feio, não combina com o resto da UI (que usa Radix). Já existe `<AlertDialog>` em `client/src/components/ui/alert-dialog.tsx` — usa ele.

Outros lugares com excluir/descartar que merecem alert dialog ao invés de toast direto:

- `client/src/components/CharacterManager.tsx:173` — toast "Personagem removido" sem confirmar.
- `client/src/pages/IdeasPage.tsx:380` — toast "Ideia descartada" sem confirmar.
- `client/src/pages/WorksPage.tsx` — descobrir como funciona softDelete/permanentDelete e garantir que `permanentDelete` exige confirmação dupla.

### P1.9 — `ResetPasswordPage` mostra o token cru no input apenas se vier corretamente

`client/src/pages/ResetPasswordPage.tsx` lê `?token=...` da URL. Se o token estiver ausente (link velho, copy-paste cortou), o `handleSubmit` faz `if (isSubmitting || !token) return;` silenciosamente. Usuário clica "Redefinir" e nada acontece. Mostre uma mensagem clara: *"Link de recuperação inválido ou expirado. Peça um novo."*

### P1.10 — Senha sem indicador de força

`RegisterPage` aceita `Aaaaaaa1` (atende ao schema), mas obviamente é fraca. Adicionar uma barra simples (verde/amarelo/vermelho) calculada client-side. zxcvbn é overkill — uma heurística baseada em comprimento + variedade de classes resolve.

### P1.11 — `ProtectedRoute` mostra só "Verificando sessão..." em texto

Sem skeleton, sem layout. Se a checagem demora 2s (rede lenta), o usuário vê uma tela em branco com micro-texto. Use o `DashboardLayoutSkeleton.tsx` que já existe.

### P1.12 — `WorkOnboarding` força criação de obra antes de explorar nada

Quando `works.length === 0`, a Home **substitui-se inteira** pelo `WorkOnboarding`. O usuário não consegue ver Profile, Library, Settings, ou ler a documentação até criar uma obra. Bloqueio total. Permitir explorar com aviso "Crie uma obra primeiro" em cada página específica.

### P1.13 — `Home.tsx:23` o `chapterStatusLabel` mistura status do produto com fallback do banco

```ts
default: return status || "Sem status";
```

Se o backend mudar o enum, o usuário vê o nome interno do status no UI (ex: "in_review_pending"). Defina exhaustive switch que loga warning interno e exibe um placeholder limpo.

### P1.14 — `MainLayout.tsx` tem todas as rotas hardcoded num objeto

Linhas ~70-85:

```ts
'/review': { title: 'Revisão', subtitle: '...', primaryAction: {...} },
'/library': { title: 'Biblioteca', subtitle: '...' },
```

Se você renomear uma rota no `App.tsx`, esquece de mudar aqui. Centralizar num módulo `routesConfig.ts` que tanto o `App` quanto o `MainLayout` consomem.

### P1.15 — `ErrorBoundary` mostra "Algo deu errado" em produção mas não loga em servidor

Já corrigi pra esconder stack em prod (A11). Falta enviar pro Sentry/equivalente. Em produção real, sem isso você não sabe que tem usuários quebrando.

---

## P2 — Qualidade e dívida técnica

### P2.1 — Testes têm cobertura desigual

Routers com teste:
- `auth.logout`, `library`, `notifications`, `profile`, `workGuard`, `works`, `writing` (parcial), `writing.no-fallback`

Routers SEM teste:
- `ideas` (1057 linhas), `storyAssistant`, `series`, `versions`, `export`, `billing`, `characters`, `drafts`, `search`, `review`, `promptTemplates`
- `_core/llm` (434 linhas, lógica complexa de fallback de modelos)
- `_core/sdk` (auth + OAuth)
- todo o módulo `generation/*` (worker, engines, qualityGate, runpodClient, usageLimiter, payloadBuilder, planConfig)

Frontend tem **zero testes** (não vi arquivo `.test.ts(x)` em `client/src`).

### P2.2 — 97 ocorrências de `: any`

`grep -rn ": any" --include="*.ts" --include="*.tsx" server client | wc -l` → 97. A maioria em parsing de respostas LLM (`(parsed as any).authors`) e em propagação de erro. Alguns são razoáveis (resposta de LLM é unknown por natureza), outros são preguiça.

### P2.3 — `WorkOnboarding.tsx` com 1.789 linhas

Mesmo problema do ProfilePage (P0.5) em escala menor. O componente faz: importar arquivo, ler PDF, ler DOCX, sugerir título, sugerir gênero, fazer upload de capa, criar série, criar obra, ler estilo. Cada uma dessas é candidato a componente próprio.

### P2.4 — `IdeasPage.tsx` com 1.057 linhas e `DraftPage.tsx` com 949

Mesma história. Quebrar em sub-componentes por seção/aba.

### P2.5 — Logger usa `console.log` em vários pontos do frontend

`client/src/pages/ProfilePage.tsx:1042` (corrigido), `client/src/pages/IdeasPage.tsx:449` (eslint-disable). Centralizar num util client-side que respeita `import.meta.env.DEV`.

### P2.6 — Vários `.useQuery()` sem `enabled` quando dependem de estado

Exemplos no `WritingPage`:

```ts
const chapterQuery = trpc.writing.getById.useQuery({ chapterId: chapterId || 0 }, { enabled: Boolean(chapterId) });
```

Bom. Mas tem outros lugares onde a query é disparada com `id || 0` e o `enabled` está ausente, gerando 404 silencioso a cada navegação. Auditoria visual seria suficiente.

### P2.7 — Não há `loading.tsx` ou skeleton padrão

Páginas pesadas (Profile, Writing, Review) carregam queries em paralelo e a UI aparece em "trechos". O `Card` com conteúdo `undefined` vira espaço vazio. Padronizar `<Skeleton>` por seção (já existe `client/src/components/ui/skeleton.tsx`).

### P2.8 — `key={index}` ainda em 2 lugares

`client/src/components/ui/field.tsx:209` — em renderização de erros, OK em pratica porque a lista é rebuilt do zero. `client/src/pages/ReviewPage.tsx:620` — em renderização de parágrafos. Risco se a lista for editada in-place.

### P2.9 — `epub-gen-memory` não está nos `node_modules` do dev sandbox da última verificação

O `pnpm install` que fiz na minha sandbox falhou (sandbox quebrada), mas no seu Windows você precisa rodar `pnpm install` de novo após eu ter trocado `epub-gen` por `epub-gen-memory` no `package.json`. Confirmar que `pnpm list epub-gen-memory` mostra a dep.

### P2.10 — Vários `tab IDs` e `enums` repetidos como string-literal

`PROFILE_TAB_IDS`, `chapterStatusLabel`, `reviewStatusLabels` — se você muda um lugar, esquece o outro. Centralizar como `as const` em `shared/_core/enums.ts`.

### P2.11 — Faltam migrations registradas no `_journal.json` do drizzle pra as 3 últimas

`drizzle/0011_unique_email.sql`, `drizzle/0012_account_lockout.sql`, `drizzle/0013_audit_logs.sql` foram escritas à mão por mim — o `drizzle-kit` não conhece. Quando você rodar `pnpm db:push`, ele vai tentar gerar uma migration NOVA com a mesma mudança e/ou pular as minhas. Solução: rodar `pnpm db:push` uma vez agora, deixar ele gerar a migration "oficial" a partir do diff schema, e apagar minhas 3 SQLs manuais (deixei elas como referência do que precisa rodar).

### P2.12 — `recharts 2.15` usado com React 19

Não bloqueia, mas o `package.json` deveria explicitar override compatível ou bumpar pra recharts 3.x. Nas auditorias anteriores marquei como B7.

---

## P3 — Gosto pessoal / opcional

### P3.1 — Animações de spinner do Lucide são todas `animate-spin` padrão Tailwind

Funciona, mas em produto literário poderia ter loaders temáticos (pena escrevendo, livro abrindo). Detalhe.

### P3.2 — Cor `bg-accent` é única e sempre a mesma

Sem variantes pra contextos (sucesso, alerta, neutro). Funciona, é coerente, mas dá monotonia.

### P3.3 — `LandingPage` mostra mockup com ícones em mini-cards. Bonito, mas estático. Um vídeo curto ou GIF venderia melhor.

### P3.4 — Falta dark/light toggle visível na UI principal

Existe `ThemeContext` configurado (`defaultTheme="dark"`), mas não vi onde o usuário troca. Provavelmente está escondido em algum menu — deveria estar no header.

### P3.5 — Não tem keyboard shortcut pra "salvar" (Ctrl+S)

Editor de capítulo é o caso óbvio. Auto-save de 30s ajuda mas atalho explícito é esperado em editor.

---

## Próximos passos sugeridos

1. **Hoje**: P0.1 (4 URLs sem `?`), P0.4 (botão dentro de botão na Home/Library/Dashboard).
2. **Esta semana**: P1.1 (glossário/tooltips), P1.4/P1.5 (typos visíveis), P1.8 (`AlertDialog` no lugar de `window.confirm`), P1.12 (deixar Profile acessível sem obra), P2.11 (rodar `pnpm db:push` e limpar minhas SQLs).
3. **Próximo mês**: P0.5 (quebrar ProfilePage), P2.1 (escrever testes pelo menos para `ideas.ts`, `review.ts`, `generation/*`), P2.3 (quebrar WorkOnboarding).
4. **Quando der**: P3.

---

## Resumo numérico

- **5 P0** (4 são URL malformada — fix de 5 minutos).
- **15 P1** — 1 a 3 dias de trabalho focado.
- **12 P2** — projeto contínuo de 1-2 sprints.
- **5 P3** — quando o produto estiver maduro.

Quer que eu já consertar os 4 URLs do P0.1 agora? É find-replace literal.
