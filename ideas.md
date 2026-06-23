# Literary Canvas — Brainstorming de Design

## Contexto
Plataforma privada de escrita literária assistida por IA. Ambiente de trabalho íntimo, sério, focado. O usuário é um autor de obra longa, complexa e politicamente densa. A interface deve honrar o peso da escrita literária.

---

<response>
<text>
## Ideia 1 — "Scriptorium Moderno"

**Design Movement**: Modernismo Editorial + Brutalismo Tipográfico Suave

**Core Principles**:
- Hierarquia tipográfica extremamente clara: tudo é comunicado pela fonte, não pela cor
- Espaço em branco como respiro literário — margens generosas como páginas de livro
- Contraste alto sem ser agressivo: fundo quase-branco (creme) com texto quase-preto (carvão)
- Estrutura editorial: colunas, réguas, numeração — como uma edição crítica

**Color Philosophy**:
- Fundo: #F5F0E8 (creme de papel antigo)
- Texto: #1A1614 (carvão profundo)
- Acento primário: #8B2635 (vermelho borgonha — tinta de caneta)
- Acento secundário: #2C4A3E (verde-floresta — couro de livro)
- Superfícies: branco puro para cards, cinza muito claro para painéis

**Layout Paradigm**:
- Sidebar fixa à esquerda com ícones + labels
- Área central com largura máxima de 72ch (como coluna de livro)
- Painéis laterais deslizantes para contexto e controles
- Sem grid simétrico — assimetria editorial intencional

**Signature Elements**:
- Linha fina horizontal como separador (1px, cor acento)
- Numeração de capítulos em fonte serifada grande e levemente opaca
- Tags com bordas finas e sem preenchimento (outline style)

**Interaction Philosophy**:
- Transições suaves e lentas (300-500ms) — como virar páginas
- Hover com sublinhado deslizante, não mudança de cor
- Focus states com borda fina colorida, sem glow

**Animation**:
- Entrada de conteúdo: fade-in + slide-up sutil (20px, 400ms ease-out)
- Sidebar items: stagger de 50ms entre cada item
- Modais: scale de 0.97 para 1.0 + fade

**Typography System**:
- Display: Playfair Display (serifada, elegante, literária)
- Body: Source Serif 4 (leitura longa, confortável)
- UI/Labels: DM Sans (limpa, moderna, sem serifa)
- Monospace (editor): JetBrains Mono
</text>
<probability>0.08</probability>
</response>

<response>
<text>
## Ideia 2 — "Ateliê Noturno"

**Design Movement**: Dark Academia + Minimalismo Funcional

**Core Principles**:
- Interface escura como um escritório de trabalho noturno
- Foco total no texto — tudo que não é conteúdo deve recuar
- Densidade informacional alta mas sem caos — cada elemento tem lugar preciso
- Atmosfera de concentração: sem distrações visuais, sem gradientes chamativos

**Color Philosophy**:
- Fundo base: #0F0D0B (quase-preto quente)
- Superfície de cards: #1C1916 (marrom escuro)
- Sidebar: #161310
- Texto principal: #E8E0D5 (branco-creme)
- Texto secundário: #8A7F74
- Acento primário: #5B8DEE (azul-violeta — foco e profundidade)
- Acento secundário: #E8E0D5 (branco-creme para destaques)
- Sucesso/canônico: #4A7C59 (verde musgo)

**Layout Paradigm**:
- Sidebar vertical estreita (64px) com ícones, expandível para 240px com labels
- Área de trabalho ocupa toda a largura restante
- Painéis contextuais deslizam da direita (drawer pattern)
- Barra de status na parte inferior (como um editor de código)

**Signature Elements**:
- Bordas sutis com opacidade baixa (1px, rgba branco 8%)
- Badges de status com cores semânticas (canônico=dourado, rascunho=cinza, etc.)
- Cursor de texto personalizado na área de escrita

**Interaction Philosophy**:
- Micro-animações discretas — o sistema responde sem chamar atenção
- Ações destrutivas com confirmação visual clara
- Tooltips ricos com contexto adicional

**Animation**:
- Sidebar expand: width transition 200ms cubic-bezier
- Conteúdo principal: fade 250ms ao trocar de aba
- Painéis laterais: slide-in 300ms ease-out
- Skeleton loading para conteúdo assíncrono

**Typography System**:
- Display/Títulos: Cormorant Garamond (serifada dramática)
- Body: Lora (serifada para leitura)
- UI: Geist Sans (moderna, técnica)
- Editor: Geist Mono
</text>
<probability>0.09</probability>
</response>

<response>
<text>
## Ideia 3 — "Manuscrito Digital"

**Design Movement**: Novo Classicismo + Editorial Contemporâneo

**Core Principles**:
- Interface clara e luminosa como uma mesa de trabalho bem iluminada
- Tipografia como elemento visual principal — fontes com caráter forte
- Estrutura assimétrica: coluna de navegação à esquerda, conteúdo à direita com espaço diferente
- Elementos de "papel" e "escrita" como metáfora visual sutil

**Color Philosophy**:
- Fundo: #FAFAF8 (branco levemente quente)
- Sidebar: #F0EDE6 (papel envelhecido suave)
- Texto: #1E1B18 (tinta escura)
- Acento primário: #3D5A80 (azul-marinho literário)
- Acento secundário: #E07A5F (terracota — marcador de página)
- Muted: #9B9189

**Layout Paradigm**:
- Sidebar de largura fixa (220px) com hierarquia visual clara
- Conteúdo principal com padding generoso
- Área de editor com largura limitada para conforto de leitura
- Painéis de contexto integrados ao layout (não drawer)

**Signature Elements**:
- Linha vertical sutil separando sidebar do conteúdo
- Ícones de linha fina (stroke, não fill)
- Status badges com forma de "etiqueta" (tag shape)

**Interaction Philosophy**:
- Hover states suaves com transição de cor
- Seleção de texto com cor de acento
- Drag-and-drop para reorganizar itens da biblioteca

**Animation**:
- Page transitions: crossfade 200ms
- Hover: color transition 150ms
- Accordion/collapse: height transition 250ms

**Typography System**:
- Títulos: Libre Baskerville (serifada clássica)
- Body: Merriweather (leitura confortável)
- UI: Nunito Sans (amigável, clara)
- Editor: Fira Code
</text>
<probability>0.07</probability>
</response>

---

## Decisão

**Escolhida: Ideia 2 — "Ateliê Noturno" (Refinado)

Razão: A natureza da plataforma — escrita noturna, concentração profunda, obra densa e política — pede uma interface que recue e deixe o texto em primeiro plano. O tema escuro com azul-violeta e verde musgo cria a atmosfera certa de um escritório literário sério e sofisticado. A sidebar compacta maximiza a área de trabalho. Sem ouro — apenas tons literários puros.
