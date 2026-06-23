# Relatorio de UX Design - Literary Canvas

Data da revisao: 2026-05-30

## Escopo

Auditoria focada em UX, design system, navegacao, acessibilidade, responsividade, clareza de fluxo e percepcao de produto premium. A analise foi feita por leitura do front-end, varreduras estaticas e verificacao HTTP local das rotas publicas.

Validado localmente:

- `GET /api/health` respondeu 200.
- `GET /`, `/login` e `/register` responderam 200.
- O projeto nao possui Playwright instalado, entao nao houve captura automatizada de screenshots.

## Resumo executivo

O produto tem uma base funcional forte e uma proposta clara: transformar ideia, rascunho, escrita, revisao e biblia da obra em um fluxo unico. O problema de UX esta menos na ausencia de funcionalidades e mais na forma como elas aparecem para o cliente.

Hoje a interface passa uma sensacao de produto denso e poderoso, mas ainda nao de alto padrao. Os principais motivos sao:

- Excesso de telas grandes e componentes enormes, dificultando consistencia.
- Navegacao com duplicidade conceitual entre `Obras`, `Profile`, `Biblia da Obra`, `Library` e `WorksPage`.
- Visual muito dependente de vidro, gradiente, sombras e serifas em toda a UI.
- Falta de um sistema padronizado para estados vazios, loading, erro, salvamento e confirmacoes.
- Acessibilidade incompleta em botoes icon-only e configuracao HTML.
- Responsividade com muitos paineis altos, abas horizontais longas e grids densos.

Direcao recomendada: transformar o produto em uma experiencia de escrita premium operacional. A tela deve parecer uma mesa de trabalho editorial, nao uma landing decorativa repetida dentro do app.

---

## P0 - Critico

### P0.1 - HTML configurado para ingles e zoom limitado

Arquivos:

- `client/index.html:2`
- `client/index.html:8`

Problema:

- O documento esta com `lang="en"`, mas o produto esta em portugues.
- O viewport usa `maximum-scale=1`, o que pode bloquear zoom no mobile.

Impacto no cliente:

- Leitores de tela, corretor, SEO e tradutores interpretam o app no idioma errado.
- Usuarios com baixa visao podem ter dificuldade para ampliar a interface.
- Isso reduz percepcao de qualidade e acessibilidade.

Solucao:

- Trocar para `lang="pt-BR"`.
- Remover `maximum-scale=1` do viewport.
- Manter `width=device-width, initial-scale=1.0`.

Prioridade: corrigir antes de qualquer refinamento visual.

### P0.2 - Arquitetura de informacao confunde obra, perfil e biblioteca

Arquivos:

- `client/src/App.tsx:50`
- `client/src/App.tsx:53`
- `client/src/pages/WorksPage.tsx:47`
- `client/src/pages/ProfilePage.tsx:376`
- `client/src/components/MainLayout.tsx:32`
- `client/src/components/MainLayout.tsx:70`

Problema:

- `/works` aponta para `ProfilePage`.
- `/profile` tambem aponta para `ProfilePage`.
- Existe `WorksPage.tsx`, mas ela nao esta roteada.
- No menu, o item aparece como `Obras`, mas a descricao diz `Biblia da Obra`.
- `LibraryPage` tambem existe como arquivo canonico, mas aparece fora do fluxo principal.

Impacto no cliente:

- O usuario nao entende se esta gerenciando obras, editando biblia da obra ou consultando biblioteca.
- Produto premium precisa de mapa mental simples. Aqui a hierarquia fica ambigua.

Solucao:

- Definir tres conceitos fixos:
  - `Biblioteca de Obras`: lista, criar, pausar, arquivar, lixeira.
  - `Biblia da Obra`: universo, estilo, referencias, personagens, continuidade.
  - `Arquivo Canonico`: material aprovado e pesquisavel.
- Roteamento recomendado:
  - `/works` usa `WorksPage`.
  - `/profile` vira `/bible` ou `/work-bible`.
  - Menu mostra `Obras`, `Biblia`, `Arquivo`, sem misturar nomes.

Prioridade: alta. Isso afeta toda a compreensao do produto.

### P0.3 - Botoes somente com icone sem nome acessivel consistente

Arquivos exemplares:

- `client/src/components/NotificationCenter.tsx:33`
- `client/src/components/CharacterManager.tsx:93`
- `client/src/components/CharacterManager.tsx:94`
- `client/src/pages/ProfilePage.tsx`
- `client/src/pages/DraftPage.tsx`
- `client/src/pages/ReviewPage.tsx`

Problema:

- Ha botoes com apenas icones que nao possuem `aria-label`.
- Alguns usam `title`, mas `title` nao substitui acessibilidade robusta.
- O componente de Tooltip existe, mas nao e usado de forma sistematica.

Impacto no cliente:

- Usuario com leitor de tela recebe botoes sem significado.
- Em produto denso, icone sem tooltip aumenta tentativa e erro.
- Parece ferramenta tecnica, nao experiencia premium.

Solucao:

- Criar um `IconButton` padrao que exige:
  - `aria-label`
  - tooltip visivel no hover/focus
  - variante visual
  - estado disabled com motivo opcional
- Migrar todos os botoes icon-only para esse componente.

Prioridade: alta, principalmente em acoes destrutivas e editoriais.

### P0.4 - Componentes gigantes impedem consistencia de UX

Arquivos:

- `client/src/pages/ProfilePage.tsx` - mais de 3000 linhas.
- `client/src/components/WorkOnboarding.tsx` - mais de 1600 linhas.
- `client/src/pages/IdeasPage.tsx`
- `client/src/pages/WritingPage.tsx`
- `client/src/pages/DraftPage.tsx`
- `client/src/pages/ReviewPage.tsx`

Problema:

- Varias telas concentram dados, regras, mutacoes, estado visual, dialogos e componentes internos no mesmo arquivo.
- Isso cria microcopys, espacamentos, estados e padroes diferentes em cada rota.

Impacto no cliente:

- A experiencia muda de comportamento entre etapas.
- Pequenas inconsistencias acumuladas reduzem percepcao de produto refinado.

Solucao:

- Quebrar `ProfilePage` por tabs:
  - `WorkHeader`
  - `ReferencesTab`
  - `StyleTab`
  - `ContinuityTab`
  - `UniverseTab`
  - `CharactersTab`
  - `TimelineTab`
  - `AuditTab`
  - `ImprovementsTab`
- Quebrar `WorkOnboarding` por modo:
  - `UploadWorkFlow`
  - `ManualWorkFlow`
  - `DiscoveryFlow`
  - `CoverPicker`
  - `StyleSampleUploader`
- Centralizar estados vazios, loading e erros em componentes compartilhados.

Prioridade: alta. Sem isso, qualquer melhoria visual vira retrabalho.

---

## P1 - Alta

### P1.1 - Landing page parece mais template visual do que produto real

Arquivo:

- `client/src/pages/LandingPage.tsx:59`
- `client/src/pages/LandingPage.tsx:65`
- `client/src/pages/LandingPage.tsx:93`

Problema:

- Hero em split layout com texto de um lado e mockup/card do outro.
- O H1 e uma frase de valor, nao o nome/produto/categoria.
- O visual usa capa sintetica, glass cards e gradientes em vez de mostrar a experiencia real do produto.

Impacto no cliente:

- A primeira impressao fica bonita, mas generica.
- Produto premium precisa mostrar dominio e clareza imediatamente.

Solucao:

- Hero full-bleed ou mais imersivo, com imagem/screenshot real da mesa de escrita.
- H1 recomendado: `Literary Canvas` ou `Plataforma editorial para escrita com IA`.
- Subcopy explica o valor: contexto, continuidade, biblia da obra e revisao canonica.
- Mostrar uma previa real: obra ativa, proxima acao, contexto carregado, rascunho em progresso.

### P1.2 - Tipografia serifada em toda a UI reduz legibilidade operacional

Arquivo:

- `client/src/index.css:11`
- `client/src/index.css:12`
- `client/src/index.css:49`
- `client/src/index.css:273`
- `client/src/index.css:282`

Problema:

- `--font-sans` e `--font-serif` apontam para `Lora`.
- Botoes, inputs, labels, tabs, cards e paineis usam uma fonte editorial.

Impacto no cliente:

- A fonte combina com literatura, mas dificulta escaneamento em paineis densos.
- Um app premium de produtividade precisa de UI limpa e legivel.

Solucao:

- Usar uma fonte sans para interface, por exemplo `Inter`, `Geist`, `Source Sans 3` ou equivalente.
- Reservar `Lora` para marca, titulos editoriais, previews de texto e momentos literarios.
- Separar tokens:
  - `--font-ui`
  - `--font-editorial`
  - `--font-code`

### P1.3 - Microinteracoes globais geram movimento excessivo

Arquivo:

- `client/src/index.css:160`
- `client/src/index.css:197`
- `client/src/index.css:217`

Problema:

- Todo botao, link, tab, select e item de menu escala no hover e active.
- `will-change: scale` e aplicado de forma ampla.

Impacto no cliente:

- Em telas densas, o movimento constante parece instavel.
- Em UI premium, microinteracao deve reforcar intencao, nao chamar atencao em tudo.

Solucao:

- Remover escala global.
- Aplicar movimento apenas em:
  - cards selecionaveis importantes
  - CTAs primarios
  - capas/obras
- Para controles de rotina, usar mudanca sutil de cor, borda e sombra.

### P1.4 - Visual muito dependente de glass, gradiente e sombra

Arquivos:

- `client/src/index.css:290`
- `client/src/index.css:327`
- `client/src/index.css:339`
- `client/src/pages/LandingPage.tsx:85`
- `client/src/components/AuthShell.tsx`
- `client/src/pages/ProfilePage.tsx`

Problema:

- `Card` padrao herda `literary-card`.
- Muitos paineis usam vidro, blur, sombra forte, borda translucida e gradiente.

Impacto no cliente:

- A interface fica atmosferica, mas menos objetiva.
- Repeticao do mesmo efeito reduz hierarquia: tudo parece igualmente importante.

Solucao:

- Criar variantes de superficie:
  - `surface`: base quieta para paineis de trabalho.
  - `panel`: areas principais.
  - `item`: listas e linhas clicaveis.
  - `hero`: uso raro, landing/capa.
  - `modal`: dialogos.
- Tornar o `Card` padrao mais neutro.
- Reservar glass para capa, onboarding e marketing.

### P1.5 - Abas longas e paineis altos prejudicam mobile e notebooks pequenos

Arquivos:

- `client/src/pages/ProfilePage.tsx:2599`
- `client/src/pages/WritingPage.tsx:789`
- `client/src/pages/DraftPage.tsx:693`
- `client/src/pages/ReviewPage.tsx:375`
- `client/src/components/WorkOnboarding.tsx:1786`

Problema:

- `ProfilePage` tem muitas tabs horizontais.
- Editores e listas usam `min-h-[520px]`, `min-h-[620px]`, `max-h-[70vh]`, `max-h-[92vh]`.
- O conteudo pode exigir rolagem excessiva e esconder a proxima acao.

Impacto no cliente:

- Usuario mobile perde orientacao.
- Notebook pequeno vira experiencia de rolagem e busca.

Solucao:

- No mobile, trocar tabs longas por seletor/accordion ou grupos:
  - `Contexto`
  - `Estilo`
  - `Continuidade`
  - `Analise`
- Fixar a acao primaria no rodape em fluxos longos.
- Usar alturas responsivas baseadas em `clamp()` e viewport disponivel.

---

## P2 - Media

### P2.1 - Estados de loading, vazio, erro e salvamento nao formam um sistema

Arquivos exemplares:

- `client/src/App.tsx:35`
- `client/src/pages/Home.tsx`
- `client/src/pages/ProfilePage.tsx`
- `client/src/pages/WritingPage.tsx`
- `client/src/pages/LibraryPage.tsx`

Problema:

- Ha muitos `Carregando...`, spinners isolados e mensagens `Nenhum...`.
- Alguns fluxos usam toast direto com `error.message`.
- Auth usa `toFriendlyErrorMessage`, mas o padrao nao esta espalhado pelo app.

Impacto no cliente:

- O usuario nao sabe se deve esperar, corrigir algo, tentar novamente ou seguir outro caminho.

Solucao:

- Criar componentes:
  - `PageSkeleton`
  - `PanelSkeleton`
  - `EmptyState`
  - `InlineError`
  - `SavingIndicator`
  - `BlockedState`
- Criar mapper unico de erros amigaveis.
- Diferenciar estados:
  - carregando
  - salvando
  - gerando com IA
  - vazio inicial
  - vazio por filtro
  - erro recuperavel
  - erro bloqueante

### P2.2 - Copy precisa ficar mais consistente e menos tecnica

Arquivos:

- `client/src/components/NotificationCenter.tsx:44`
- `client/src/pages/ProfilePage.tsx:1502`
- `client/src/pages/ProfilePage.tsx:1507`
- `client/src/pages/WritingPage.tsx:736`

Problema:

- Existem textos sem acento: `Notificacoes`, `Resumo rapido`, `sera maior`.
- Existem textos muito internos: `v6`, `pra aplicar`, `IA gera e corrige`.

Impacto no cliente:

- Produto de alto padrao precisa de linguagem polida e consistente.
- Texto tecnico demais faz o cliente sentir que esta operando uma ferramenta inacabada.

Solucao:

- Criar guia de microcopy:
  - tom claro, editorial, sem jargao tecnico.
  - evitar versoes internas no texto do cliente.
  - manter acentos e padrao formal leve.
- Trocar exemplos:
  - `Notificacoes` -> `Notificações`.
  - `Resumo rapido` -> `Resumo rápido`.
  - `sera maior` -> `será maior`.
  - `pra aplicar` -> `para aplicar`.
  - `v6` -> remover ou traduzir para uma descricao funcional.

### P2.3 - Login e cadastro precisam de validacao visual melhor

Arquivos:

- `client/src/pages/LoginPage.tsx`
- `client/src/pages/RegisterPage.tsx`
- `client/src/pages/ForgotPasswordPage.tsx`
- `client/src/pages/ResetPasswordPage.tsx`

Problema:

- Inputs usam `autoComplete`, mas nao ha `required`/`minLength` sistematicos no HTML.
- Feedback de senha e confirmacao poderia ser mais orientado.

Impacto no cliente:

- Erros aparecem tarde.
- Cadastro premium deve parecer guiado e seguro.

Solucao:

- Adicionar validacao inline:
  - email valido
  - senha minima
  - senha forte
  - confirmacao igual
  - termos aceitos
- Usar mensagens abaixo do campo, nao apenas toast.

### P2.4 - Home tem boa direcao, mas precisa virar o modelo de navegacao

Arquivo:

- `client/src/pages/Home.tsx`

Ponto positivo:

- A tela `Home` ja trabalha com `Proxima acao`, `Onde parei`, `Contexto que a IA vai usar` e atalhos.

Problema:

- Esse modelo nao governa o restante do app.
- O menu ainda obriga o usuario a conhecer a arquitetura interna.

Solucao:

- Transformar `Home` em cockpit editorial:
  - proxima acao sempre visivel
  - progresso do fluxo
  - pendencias por gravidade
  - atalhos contextuais
- Replicar esse padrao no topo das telas de `Rascunho`, `Escrita`, `Revisao` e `Exportacao`.

---

## P3 - Baixa

### P3.1 - Imagens de capa sem texto alternativo quando sao conteudo

Arquivos:

- `client/src/pages/IdeasPage.tsx:667`
- `client/src/pages/ProfilePage.tsx`
- `client/src/components/WorkOnboarding.tsx:780`

Problema:

- Algumas imagens usam `alt=""`.
- Se a imagem for puramente decorativa, isso esta correto.
- Se representar uma capa de obra, deve ter alt descritivo.

Solucao:

- Capa real: `alt={"Capa de " + tituloDaObra}`.
- Imagem decorativa/background: manter `alt=""` e garantir que o texto principal nao dependa dela.

### P3.2 - Debug no console reduz polimento

Arquivo:

- `client/src/pages/ProfilePage.tsx:1099`
- `client/src/pages/ProfilePage.tsx:1143`

Problema:

- Ha `console.log` e `console.error` de fluxo de scan.

Impacto:

- Nao afeta a maioria dos clientes, mas reduz polimento em ambiente de producao.

Solucao:

- Centralizar logs atras de `import.meta.env.DEV`.
- Remover logs de sucesso em producao.

### P3.3 - Sidebar customizada duplica componente existente

Arquivos:

- `client/src/components/MainLayout.tsx`
- `client/src/components/ui/sidebar.tsx`

Problema:

- Existe um componente `ui/sidebar.tsx` robusto, mas `MainLayout` usa sidebar propria.

Impacto:

- A chance de comportamento divergente cresce.

Solucao:

- Escolher um sistema de sidebar.
- Se o `ui/sidebar.tsx` for mantido, migrar `MainLayout`.
- Se nao for usado, remover ou reduzir para evitar confusao.

---

## O que precisa entrar

1. Sistema de navegacao por fluxo:
   - Ideia
   - Biblia
   - Rascunho
   - Escrita
   - Revisao
   - Publicacao

2. Cockpit editorial:
   - proxima acao
   - pendencias
   - progresso
   - contexto carregado
   - credito/uso de IA com explicacao clara

3. Design system operacional:
   - variantes de Card
   - `IconButton`
   - `EmptyState`
   - `PageSkeleton`
   - `InlineError`
   - `SavingIndicator`
   - `StatusBadge`

4. Validacao inline em formularios.

5. Tooltips acessiveis para icones e acoes menos obvias.

6. Mobile UX propria:
   - stepper compacto
   - bottom action bar
   - tabs agrupadas ou select em telas longas

7. Guia de microcopy:
   - linguagem editorial
   - sem jargao tecnico
   - sem nomes internos de versao
   - mensagens de erro acionaveis

---

## O que precisa sair

1. `maximum-scale=1` do viewport.

2. Escala global em todo elemento interativo.

3. Uso de Lora como fonte universal da UI.

4. Glass/gradiente/sombra como padrao de todos os cards.

5. Duplicidade `/works` e `/profile` apontando para a mesma tela.

6. Arquivo `WorksPage.tsx` solto sem rota ou decisao clara.

7. Toasts com `error.message` bruto em fluxos do cliente.

8. Textos internos como `v6` e logs de debug em producao.

---

## O que precisa melhorar

1. Hierarquia visual:
   - Menos efeitos simultaneos.
   - Mais contraste entre area principal, secundaria e item clicavel.

2. Fluxo mental:
   - O cliente deve saber sempre: onde estou, o que falta, qual o proximo passo.

3. Responsividade:
   - Menos alturas fixas.
   - Melhor tratamento para tabs longas.
   - Acoes primarias persistentes em fluxos longos.

4. Acessibilidade:
   - `lang`.
   - zoom.
   - aria labels.
   - tooltips.
   - alt text quando imagem for conteudo.

5. Consistencia de estado:
   - loading.
   - vazio.
   - erro.
   - salvando.
   - processando IA.
   - sucesso.

6. Linguagem:
   - acentos corretos.
   - tom mais premium.
   - menos tecnico.

---

## Ordem recomendada de correcao

1. Corrigir `client/index.html`: `lang="pt-BR"` e remover `maximum-scale=1`.
2. Resolver arquitetura `/works`, `/profile`, `WorksPage` e nomenclatura do menu.
3. Criar `IconButton` com `aria-label` obrigatorio e tooltip.
4. Ajustar tipografia: sans para UI, Lora apenas editorial.
5. Remover microinteracao global de escala.
6. Criar variantes de superficie e reduzir `literary-card` como default.
7. Padronizar estados vazios, loading, erro e salvamento.
8. Redesenhar landing com foco em produto real.
9. Redesenhar mobile das tabs e paineis altos.
10. Quebrar `ProfilePage` e `WorkOnboarding` em componentes menores.

## Resultado esperado

Depois dessas correcoes, a percepcao do cliente deve mudar de "ferramenta poderosa e densa" para "ambiente editorial premium, claro e confiavel". A prioridade nao deve ser adicionar mais efeitos visuais, e sim reduzir ambiguidade, aumentar previsibilidade e fazer cada tela conduzir o usuario para a proxima decisao.
