type AuthorLens = {
  author: string;
  keywords: string[];
  guidance: string;
  example: string;
  avoid: string;
};

type GenreStyleCluster = {
  id: string;
  label: string;
  keywords: string[];
  baseline: string;
  lenses: AuthorLens[];
};

const STYLE_REPERTOIRE: GenreStyleCluster[] = [
  {
    id: 'terror',
    label: 'Terror',
    keywords: ['terror', 'horror', 'sobrenatural', 'medo', 'assombração', 'monstro', 'gótico', 'macabro'],
    baseline: 'Terror literário funciona por antecipação, vulnerabilidade e percepção. A cena deve transformar o comum em ameaça: detalhe doméstico, silêncio, cheiro, luz ruim, objeto fora do lugar. Evite explicar o medo cedo demais; faça a ameaça pressionar o corpo do personagem antes de ganhar nome.',
    lenses: [
      {
        author: 'Edgar Allan Poe',
        keywords: ['gótico', 'culpa', 'obsessão', 'mansão', 'loucura', 'sepultamento'],
        guidance: 'Use quando o terror nasce de culpa, obsessão ou percepção instável. A prosa pode estreitar a câmera para um narrador febril, que mede o mundo por sons, pulsos, sombras e interpretações paranoicas. Frases podem alternar controle formal e aceleração nervosa; a cena deve sugerir que a mente do narrador é parte da armadilha. O conflito externo importa menos que a erosão da certeza.',
        example: 'O relógio não fazia mais que cumprir seu ofício, mas cada batida parecia escolher meu nome antes de cair no silêncio.',
        avoid: 'Não transforme tudo em adjetivo sombrio. O efeito depende de precisão sensorial e progressão psicológica, não de repetir "macabro" ou "sinistro".',
      },
      {
        author: 'Mary Shelley',
        keywords: ['criatura', 'criador', 'ciência', 'culpa', 'abandono', 'monstruosidade'],
        guidance: 'Use quando o horror vem da responsabilidade moral. A cena deve perguntar quem criou o monstro: a experiência, a sociedade, a família, o abandono ou o próprio desejo de grandeza. Trabalhe contrastes entre paisagem grandiosa e solidão íntima. Personagens devem defender ideias, mas a emoção precisa aparecer nas consequências físicas e sociais dessas ideias.',
        example: 'Ele olhou para a coisa viva sobre a mesa e compreendeu, tarde demais, que criar um coração não era o mesmo que saber recebê-lo.',
        avoid: 'Não reduza a criatura a susto. O terror aqui nasce de empatia desconfortável e culpa prolongada.',
      },
      {
        author: 'H. P. Lovecraft',
        keywords: ['cósmico', 'ancestral', 'culto', 'indizível', 'geometria', 'entidade'],
        guidance: 'Use para terror cósmico e insignificância humana. A linguagem deve construir escala: documentos, ruínas, rumores, mapas, relatos antigos, nomes parcialmente compreendidos. Mostre a mente tentando organizar algo maior que ela. O medo cresce quando padrões aparentemente racionais revelam uma ordem impossível.',
        example: 'As pedras não estavam tortas; era o ângulo do mundo que parecia obedecer a uma matemática sem lugar para nós.',
        avoid: 'Não dependa de "indescritível". Dê indícios concretos suficientes para o leitor sentir a impossibilidade.',
      },
      {
        author: 'Shirley Jackson',
        keywords: ['casa', 'vizinhança', 'família', 'normalidade', 'ritual', 'pressão social'],
        guidance: 'Use quando o horror mora na etiqueta, no costume e na casa. A prosa deve ser limpa, quase educada, deixando a violência moral aparecer pela normalidade com que todos a aceitam. Trabalhe microgestos: xícaras, portas, olhares, frases gentis demais. A ameaça não precisa gritar; ela pode sorrir.',
        example: 'A senhora serviu chá para todos, inclusive para a menina que ninguém pretendia deixar sair depois do pôr do sol.',
        avoid: 'Não explique o ritual social logo no início. Deixe o leitor perceber que a cordialidade está torta.',
      },
      {
        author: 'Stephen King',
        keywords: ['cidade pequena', 'infância', 'cotidiano', 'grupo', 'trauma', 'monstro'],
        guidance: 'Use quando o horror atravessa pessoas comuns. Antes do susto, dê textura social: apelidos, trabalho, escola, dívida, vergonha, memória de infância. A ameaça deve contaminar rotinas reconhecíveis. O ritmo pode abrir espaço para lembranças e conversas, mas cada desvio precisa aumentar a intimidade com o medo.',
        example: 'No posto, todos sabiam que Mauro mentia sobre o filho; ninguém sabia por que o rádio repetia a voz do menino às três da manhã.',
        avoid: 'Não copie maneirismos nem excesso de cultura pop. Use a técnica: cotidiano concreto invadido por uma ameaça íntima.',
      },
    ],
  },
  {
    id: 'fantasia',
    label: 'Fantasia',
    keywords: ['fantasia', 'magia', 'reino', 'dragão', 'feiticeiro', 'mito', 'épico', 'poder'],
    baseline: 'Fantasia forte precisa de maravilhamento com consequência. Magia e mitologia devem alterar economia, religião, guerra, hierarquia e intimidade. A cena deve fazer o leitor sentir que o mundo existia antes dela e continuará depois.',
    lenses: [
      {
        author: 'J. R. R. Tolkien',
        keywords: ['épico', 'mitologia', 'jornada', 'línguas', 'reinos', 'ancestral'],
        guidance: 'Use para grandeza mítica e história profunda. A prosa pode carregar solenidade, paisagem, genealogia e peso moral. Objetos e lugares devem parecer herdados de eras anteriores. A ação precisa dialogar com memória coletiva: juramentos, quedas, canções, linhagens e perdas antigas.',
        example: 'Na ponte coberta de musgo, o nome do rei morto ainda era dito baixo, como se as pedras soubessem responder.',
        avoid: 'Não despeje lore em bloco. Faça a antiguidade aparecer por rituais, nomes, ruínas e escolhas presentes.',
      },
      {
        author: 'Ursula K. Le Guin',
        keywords: ['magia', 'equilíbrio', 'antropologia', 'ilha', 'nome verdadeiro', 'ética'],
        guidance: 'Use quando a fantasia investiga cultura, linguagem e responsabilidade. A magia deve ter custo ético e relação com equilíbrio. Prefira clareza contemplativa: gestos simples, reflexão precisa, sociedades com lógica própria. Conflito não precisa ser barulhento; pode ser uma escolha moral que muda o mundo.',
        example: 'Ela sabia o nome do vento, mas não o chamou; naquela ilha, mandar era sempre uma forma de ferir.',
        avoid: 'Não use magia como botão de solução. Ela deve revelar maturidade, limite e consequência.',
      },
      {
        author: 'George R. R. Martin',
        keywords: ['intriga', 'poder', 'guerra', 'casa', 'traição', 'política'],
        guidance: 'Use para fantasia política com ambiguidade moral. Cada cena deve ter interesse material: aliança, herança, refém, reputação, medo, comida, dívida, sangue. Personagens não "representam o bem"; eles querem sobreviver, vencer ou proteger algo. A violência deve ter custo social e emocional, não ser enfeite.',
        example: 'O conde sorriu ao beijar o anel da rainha; por baixo da mesa, seu irmão contava quantos guardas ainda respiravam.',
        avoid: 'Não confunda maturidade com choque gratuito. A força está em consequência política e desejo conflitante.',
      },
      {
        author: 'Neil Gaiman',
        keywords: ['mito urbano', 'sonho', 'conto', 'deuses', 'estranho', 'maravilhoso'],
        guidance: 'Use quando o fantástico entra pela fresta do cotidiano. O tom pode ser de fábula adulta: simples na superfície, estranho por baixo. Objetos comuns ganham vida simbólica; personagens aceitam o impossível com uma lógica emocional quase infantil, mas as consequências são maduras.',
        example: 'No armário de sapatos havia uma estrada pequena, e toda terça-feira alguém deixava pegadas de lama na sola do pai dela.',
        avoid: 'Não faça surrealismo aleatório. O estranho precisa obedecer a uma verdade emocional clara.',
      },
      {
        author: 'Brandon Sanderson',
        keywords: ['sistema de magia', 'regras', 'treinamento', 'estratégia', 'limites'],
        guidance: 'Use quando a magia tem regras visíveis. Mostre limitações, custos, exceções e uso tático em cena. O leitor deve conseguir antecipar possibilidades e se surpreender com aplicações inteligentes, não com regras inventadas na hora. Explique por ação, treino, falha e consequência.',
        example: 'A moeda subiu apenas um palmo; Lia sorriu, porque bastava um palmo para mudar a direção da lâmina.',
        avoid: 'Não transforme a cena em manual. Faça a regra aparecer quando alguém arrisca algo usando-a.',
      },
    ],
  },
  {
    id: 'ficcao_cientifica',
    label: 'Ficção científica',
    keywords: ['ficção científica', 'sci-fi', 'espaço', 'robô', 'android', 'tecnologia', 'cyberpunk', 'futuro', 'ia'],
    baseline: 'Ficção científica precisa de hipótese com impacto humano. A tecnologia deve mudar trabalho, corpo, linguagem, desigualdade, memória, política e afeto. Evite explicar a invenção como catálogo; mostre quem ganha, quem perde e que tipo de pessoa nasce desse sistema.',
    lenses: [
      {
        author: 'Isaac Asimov',
        keywords: ['robô', 'lógica', 'fundação', 'império', 'paradoxo'],
        guidance: 'Use quando a tensão nasce de regra lógica, instituição ou dilema racional. A cena deve apresentar premissas claras e deixar o conflito emergir de uma contradição interna. Diálogos podem ser mais analíticos, mas precisam esconder medo, ambição ou orgulho por trás da razão.',
        example: 'O robô cumpriu a ordem com perfeição; por isso mesmo, ninguém no conselho podia continuar chamando aquilo de obediência.',
        avoid: 'Não deixe a cena virar ensaio. A ideia deve gerar decisão, risco e virada dramática.',
      },
      {
        author: 'Arthur C. Clarke',
        keywords: ['espaço', 'maravilhamento', 'artefato', 'cosmos', 'primeiro contato'],
        guidance: 'Use para escala cósmica e assombro científico. Frases podem ser claras, elegantes, quase serenas, enquanto a cena amplia o horizonte humano. O conflito nasce do contato com grandeza: distância, silêncio, objeto impossível, descoberta que torna velhas certezas pequenas.',
        example: 'A estação levou doze minutos para atravessar a sombra do artefato, e nesse tempo nenhum cientista ousou fingir que ainda estava no centro do universo.',
        avoid: 'Não confunda maravilhamento com frieza. O humano precisa reagir à escala.',
      },
      {
        author: 'Philip K. Dick',
        keywords: ['realidade', 'memória', 'paranoia', 'identidade', 'simulação'],
        guidance: 'Use quando a realidade é instável. A prosa deve plantar pequenas falhas: recibos impossíveis, lembranças incompatíveis, instituições contraditórias, objetos que mudam de função. O personagem não investiga apenas o mundo; investiga a própria percepção.',
        example: 'Na carteira, havia uma foto de seu casamento com uma mulher que ele só conheceria na tarde seguinte.',
        avoid: 'Não revele a fraude cedo. O prazer está na dúvida acumulada e na identidade em colapso.',
      },
      {
        author: 'Octavia Butler',
        keywords: ['corpo', 'poder', 'sobrevivência', 'alteridade', 'genética', 'dominação'],
        guidance: 'Use quando tecnologia ou biologia reorganizam relações de poder. A cena deve ser corporal, social e moral ao mesmo tempo: fome, toque, dependência, consentimento, hierarquia, adaptação. Personagens sobrevivem fazendo concessões difíceis, não por pureza abstrata.',
        example: 'Quando a marca começou a brilhar sob a pele, Ana entendeu que a cura também era uma coleira.',
        avoid: 'Não trate diferença como decoração. O estranho precisa alterar poder, desejo e sobrevivência.',
      },
      {
        author: 'William Gibson',
        keywords: ['cyberpunk', 'rede', 'neon', 'corporação', 'hacker', 'cidade'],
        guidance: 'Use para tecnologia saturada, urbana e sensorial. A prosa pode ser cortante, visual, cheia de marcas, interfaces, ruído e economia subterrânea. Explique pouco; deixe o leitor entrar no fluxo por contexto. O mundo deve parecer usado, vendido, hackeado e desigual.',
        example: 'O anúncio no vidro sabia seu nome antigo; Clara pagou para esquecê-lo e entrou no metrô com outra pele emprestada.',
        avoid: 'Não empilhe termos técnicos vazios. Cada detalhe de tecnologia precisa mostrar classe, controle ou desejo.',
      },
    ],
  },
  {
    id: 'suspense_thriller',
    label: 'Suspense e thriller',
    keywords: ['suspense', 'thriller', 'perseguição', 'conspiração', 'espionagem', 'assassino', 'segredo', 'investigação'],
    baseline: 'Suspense exige pergunta ativa, informação controlada e consequência imediata. Toda cena deve empurrar uma ameaça, uma suspeita ou uma decisão. O leitor precisa saber o bastante para temer, mas não o bastante para relaxar.',
    lenses: [
      {
        author: 'John le Carré',
        keywords: ['espionagem', 'guerra fria', 'serviço secreto', 'duplo agente', 'burocracia'],
        guidance: 'Use quando a tensão vem de lealdade, instituição e traição. A cena deve ter subtexto administrativo: memorandos, salas sem glamour, conversas educadas que escondem abandono moral. O suspense é lento, humano e amargo; ninguém sai limpo de um segredo bem guardado.',
        example: 'O relatório não acusava ninguém; por isso mesmo, todos na mesa entenderam quem seria sacrificado.',
        avoid: 'Não transforme espionagem em explosão constante. O poder está no silêncio institucional.',
      },
      {
        author: 'Patricia Highsmith',
        keywords: ['obsessão', 'dupla vida', 'moral ambígua', 'crime íntimo'],
        guidance: 'Use quando o suspense nasce da psicologia do transgressor. A câmera pode ficar perto de alguém culpado ou prestes a cruzar uma linha. O tom é frio, observador, com ansiedade subterrânea. O leitor deve sentir desconforto por entender a lógica do erro.',
        example: 'Ele devolveu a carteira antes que dessem falta; guardou apenas a fotografia, porque certas vidas pareciam mais fáceis de roubar aos poucos.',
        avoid: 'Não moralize demais. O suspense vem da proximidade perigosa com o desejo errado.',
      },
      {
        author: 'Gillian Flynn',
        keywords: ['relacionamento tóxico', 'segredo familiar', 'voz ácida', 'mídia', 'manipulação'],
        guidance: 'Use para narradores feridos, mordazes e pouco confiáveis. A voz deve ter inteligência emocional agressiva: comentários cortantes, vergonha, desejo de controlar a imagem, memória que se corrige. Relações íntimas são campos de batalha.',
        example: 'Ela chorou no velório do marido com a precisão de quem treinou diante do espelho e odiou cada lágrima que saiu bonita.',
        avoid: 'Não use cinismo como enfeite. A acidez precisa proteger uma ferida ou esconder uma mentira.',
      },
      {
        author: 'Dan Brown',
        keywords: ['código', 'símbolo', 'corrida', 'enigma', 'instituição secreta'],
        guidance: 'Use quando o motor é enigma em movimento. Capítulos curtos, perguntas claras, pistas visuais e cortes de cena mantêm urgência. O conhecimento deve virar ação: decifrar leva a correr, correr leva a perigo, perigo revela outra pergunta.',
        example: 'O desenho no vitral não era santo nem brasão; era um mapa, e alguém havia quebrado exatamente o pedaço que mostrava a saída.',
        avoid: 'Não explique pesquisa por páginas. Transforme cada dado em pista, ameaça ou escolha.',
      },
      {
        author: 'Lee Child',
        keywords: ['ação', 'solitário', 'combate', 'justiça', 'estrada'],
        guidance: 'Use para thriller direto, físico e procedural. A cena deve ser legível: espaço, ameaça, cálculo, movimento. Frases tendem a clareza e impacto. O protagonista observa antes de agir; a tensão vem de competência aplicada sob pressão.',
        example: 'Havia três portas, dois homens armados e uma lâmpada ruim. Ele escolheu a lâmpada primeiro.',
        avoid: 'Não alongue introspecção no meio da ação. O prazer está na precisão da decisão.',
      },
    ],
  },
  {
    id: 'misterio_policial',
    label: 'Mistério e policial',
    keywords: ['mistério', 'policial', 'detetive', 'crime', 'assassinato', 'pista', 'suspeito'],
    baseline: 'Mistério precisa de justiça lógica: pistas visíveis, suspeitos com motivos, falso caminho e revelação inevitável em retrospecto. O leitor deve poder perder a resposta por interpretação, não por falta de informação.',
    lenses: [
      {
        author: 'Arthur Conan Doyle',
        keywords: ['detetive', 'dedução', 'londres', 'observação'],
        guidance: 'Use quando a investigação valoriza observação brilhante. Mostre detalhes aparentemente banais que depois mudam de sentido. O investigador raciocina por contraste: o que todos viram, o que ninguém perguntou, o que não deveria estar ali.',
        example: 'Todos notaram o sangue no tapete; só Irene perguntou por que as botas do morto estavam limpas.',
        avoid: 'Não tire solução do nada. A dedução deve reorganizar pistas já vistas.',
      },
      {
        author: 'Agatha Christie',
        keywords: ['whodunit', 'suspeitos', 'salão', 'herança', 'álibi'],
        guidance: 'Use para enigma social. Cada personagem deve ter fachada, motivo e pequeno segredo que não necessariamente é o crime. Estruture cenas de conversa como tabuleiro: quem entra, quem sai, quem mente por vergonha, quem mente por sobrevivência.',
        example: 'Na hora do chá, cinco pessoas mentiram sobre a chuva; apenas uma precisava que a lama no corredor não fosse lembrada.',
        avoid: 'Não transforme suspeitos em caricaturas. Cada mentira deve ter razão humana.',
      },
      {
        author: 'Raymond Chandler',
        keywords: ['noir', 'detetive cínico', 'cidade', 'corrupção', 'voz dura'],
        guidance: 'Use para investigação em cidade moralmente podre. A voz pode ser seca, metafórica e desencantada. Ambientes importam: bares, escritórios, chuva, neon, dinheiro velho. O mistério revela uma doença social, não só um culpado.',
        example: 'O escritório cheirava a perfume caro e medo barato; era o tipo de lugar onde a verdade pedia recibo.',
        avoid: 'Não empilhe frases duronas sem função. A imagem noir deve revelar caráter e sistema.',
      },
      {
        author: 'Dashiell Hammett',
        keywords: ['hardboiled', 'gangue', 'corrupção', 'ação seca'],
        guidance: 'Use para policial enxuto, externo e objetivo. Mostre comportamento em vez de explicar psicologia. A ação é econômica; o diálogo é disputa. Personagens testam limites por dinheiro, poder ou autopreservação.',
        example: 'O homem sorriu, puxou a cadeira e deixou a arma sobre a mesa como quem oferecia café.',
        avoid: 'Não psicologize demais. A força está no gesto observado e na pressão do submundo.',
      },
      {
        author: 'Georges Simenon',
        keywords: ['maigret', 'rotina', 'compaixão', 'crime comum', 'ambiente'],
        guidance: 'Use quando o mistério é humano e atmosférico. O investigador entende hábitos, vergonha, pobreza, casamento, tédio e pequenas humilhações. A solução vem menos de espetáculo e mais de compreender por que alguém quebrou.',
        example: 'No terceiro dia, o inspetor já sabia o horário do padeiro; faltava apenas descobrir quando aquela rua aprendera a mentir.',
        avoid: 'Não force reviravolta exagerada. O crime pode ser simples se a alma for complexa.',
      },
    ],
  },
  {
    id: 'romance',
    label: 'Romance',
    keywords: ['romance', 'amor', 'relacionamento', 'paixão', 'casamento', 'desejo', 'sentimental'],
    baseline: 'Romance vive de desejo, obstáculo e vulnerabilidade. A atração precisa mudar escolhas, não apenas aparência. Cada cena deve mover aproximação, recuo, revelação ou ferida.',
    lenses: [
      {
        author: 'Jane Austen',
        keywords: ['sociedade', 'ironia', 'casamento', 'classe', 'costumes'],
        guidance: 'Use para romance de observação social. Diálogo e etiqueta carregam poder. O narrador pode ser sutilmente irônico, revelando contradições entre o que a pessoa diz, o que deseja e o que a sociedade permite. O amor amadurece por autoconhecimento.',
        example: 'Ela respondeu que não se importava com o convite, num tom cuidadosamente escolhido para provar o contrário a todos na sala.',
        avoid: 'Não reduza a ironia a piada. Ela deve revelar classe, orgulho e autoengano.',
      },
      {
        author: 'Charlotte Brontë',
        keywords: ['paixão moral', 'governanta', 'voz íntima', 'independência'],
        guidance: 'Use quando o romance é afirmação de identidade. A voz pode ser intensa e confessional, mas precisa preservar dignidade. O desejo entra em conflito com autonomia, fé, classe ou honra. Emoção forte deve vir acompanhada de escolha moral.',
        example: 'Eu o amava, sim; mas havia em mim uma porta que nem o amor tinha permissão de arrombar.',
        avoid: 'Não faça submissão parecer profundidade. A tensão está em amar sem se perder.',
      },
      {
        author: 'Emily Brontë',
        keywords: ['paixão destrutiva', 'charneca', 'obsessão', 'família', 'vingança'],
        guidance: 'Use para amor tempestuoso e quase mítico. Paisagem e emoção devem refletir violência interna. Relações podem ser feridas abertas, heranças tóxicas, desejos que sobrevivem ao tempo. O romance não precisa curar; pode assombrar.',
        example: 'O vento batia na janela com a mesma teimosia com que ele voltava ao nome dela, mesmo quando jurava odiá-lo.',
        avoid: 'Não romantize abuso sem consequência. A intensidade precisa mostrar dano.',
      },
      {
        author: 'Nora Roberts',
        keywords: ['romance contemporâneo', 'família', 'comunidade', 'suspense romântico'],
        guidance: 'Use para romance acessível com trama externa clara. Construa química por convivência, competência, humor e apoio prático. O casal deve ter objetivos além do amor, e o vínculo cresce quando um reconhece a vida real do outro.',
        example: 'Ela não se apaixonou quando ele sorriu; apaixonou-se quando ele consertou a porta sem perguntar por que ela tremia.',
        avoid: 'Não resolva conflito só com declaração. Amor precisa virar ação concreta.',
      },
      {
        author: 'Nicholas Sparks',
        keywords: ['emoção', 'perda', 'memória', 'segunda chance', 'cidade pequena'],
        guidance: 'Use quando o romance mira catarse emocional. Trabalhe memória, promessa, perda e sacrifício. A prosa deve ser clara e sentimental com controle: objetos simples guardam significado, e a emoção cresce por acúmulo de lembranças.',
        example: 'A carta estava dobrada no mesmo lugar havia vinte anos; ele só percebeu que envelhecera quando suas mãos tremeram antes do papel.',
        avoid: 'Não force lágrima com frase pronta. Construa vínculo antes da perda.',
      },
    ],
  },
  {
    id: 'drama_literario',
    label: 'Drama literário',
    keywords: ['drama', 'literário', 'introspectivo', 'família', 'trauma', 'psicológico', 'existencial'],
    baseline: 'Drama literário depende de interioridade com forma. O conflito pode ser pequeno por fora e vasto por dentro. A linguagem deve observar contradições, memória, corpo, silêncio e o que não se consegue dizer.',
    lenses: [
      {
        author: 'Fiódor Dostoiévski',
        keywords: ['culpa', 'fé', 'crime', 'consciência', 'debate moral'],
        guidance: 'Use para conflito moral em ebulição. Personagens devem pensar contra si mesmos, justificar o injustificável, contradizer crenças e se expor em diálogos intensos. Ideias não ficam abstratas: elas adoecem o corpo e empurram ações extremas.',
        example: 'Ele havia decidido ser inocente; faltava convencer as mãos, que ainda escondiam o recibo como se fosse uma faca.',
        avoid: 'Não transforme debate em palestra. Cada ideia precisa ferir alguém na cena.',
      },
      {
        author: 'Virginia Woolf',
        keywords: ['consciência', 'tempo', 'memória', 'percepção', 'fluxo'],
        guidance: 'Use para prosa de percepção e fluxo interno. O tempo pode deslizar entre presente, memória e sensação. A cena acompanha pensamentos em ondas: um som chama uma lembrança, a lembrança altera o gesto, o gesto revela perda. Ritmo e imagem importam tanto quanto evento.',
        example: 'A colher tocou a xícara, e por um instante a tarde inteira voltou a ser aquela cozinha onde ninguém dizia adeus direito.',
        avoid: 'Não use fluxo como confusão. A associação interna precisa ter música e direção emocional.',
      },
      {
        author: 'Toni Morrison',
        keywords: ['memória coletiva', 'ancestralidade', 'raça', 'comunidade', 'trauma'],
        guidance: 'Use quando o drama individual carrega história coletiva. A linguagem pode ser lírica, oral, sensorial e simbólica, mas sempre ancorada em corpo, comunidade e herança. O passado não é informação: ele age no presente.',
        example: 'Naquela casa, o assoalho lembrava passos que a família preferia chamar de vento.',
        avoid: 'Não transforme trauma em decoração poética. A beleza da frase deve carregar peso histórico.',
      },
      {
        author: 'Gabriel García Márquez',
        keywords: ['realismo mágico', 'família', 'cidade', 'memória', 'destino'],
        guidance: 'Use quando o extraordinário é tratado como parte da vida social. A frase pode ser ampla, narrativa, cheia de gerações, rumores e destino. O fantástico deve revelar verdade histórica ou familiar, não servir apenas como surpresa.',
        example: 'Quando Rosa parou de envelhecer, a vila não chamou médico; chamou o tabelião, porque aquilo mudava heranças.',
        avoid: 'Não cole magia aleatória no realismo. O impossível precisa expressar memória, poder ou desejo coletivo.',
      },
      {
        author: 'Clarice Lispector',
        keywords: ['epifania', 'introspecção', 'identidade', 'banal', 'deslocamento'],
        guidance: 'Use para interioridade radical. Um gesto mínimo pode abrir crise existencial. A linguagem investiga a percepção enquanto acontece, com frases que contornam o indizível. A cena deve transformar o banal em espelho incômodo.',
        example: 'Ao descascar a laranja, ela percebeu que também vivia assim: inteira por fora, dividida em silêncio por dentro.',
        avoid: 'Não imite abstração vazia. A epifania precisa nascer de objeto, corpo ou gesto concreto.',
      },
    ],
  },
  {
    id: 'historico',
    label: 'Histórico',
    keywords: ['histórico', 'época', 'medieval', 'guerra', 'império', 'revolução', 'século', 'monarquia'],
    baseline: 'Ficção histórica precisa de mundo material: roupa, comida, transporte, dinheiro, religião, hierarquia, doença, documentos, medo político. A pesquisa deve aparecer como restrição dramática, não como aula.',
    lenses: [
      {
        author: 'Hilary Mantel',
        keywords: ['corte', 'tudor', 'política', 'poder', 'intriga'],
        guidance: 'Use para política histórica íntima. A cena acompanha cálculo de poder por dentro: quem observa, quem deve favores, qual frase pode matar alguém. O passado deve parecer presente vivo, não vitrine. Linguagem precisa ter precisão psicológica e material.',
        example: 'Ele inclinou a cabeça antes do rei terminar a frase; sobreviver na corte era obedecer ao verbo que ainda não fora dito.',
        avoid: 'Não enfeite época com arcaísmo artificial. Faça o período limitar escolhas.',
      },
      {
        author: 'Ken Follett',
        keywords: ['saga', 'construção', 'guerra', 'famílias', 'engenharia'],
        guidance: 'Use para grandes panoramas com personagens práticos. Estruture conflitos pessoais dentro de obras, guerras, cidades, instituições. O leitor acompanha trabalho, ambição e mudança histórica por ações concretas e objetivos claros.',
        example: 'A ponte não era apenas pedra; era a promessa de que o filho de um pedreiro poderia atravessar a cidade sem pedir licença.',
        avoid: 'Não perca personagem dentro da escala. História grande precisa de desejo individual.',
      },
      {
        author: 'Robert Graves',
        keywords: ['roma', 'memórias fictícias', 'imperador', 'voz histórica'],
        guidance: 'Use quando a narrativa soa como testemunho antigo. A voz pode parecer memorialista, irônica, consciente de posteridade. O personagem conta não só o que aconteceu, mas por que a versão oficial é insuficiente.',
        example: 'Escrevo isto porque os vencedores já pagaram poetas; alguém precisa deixar trabalho para os ratos da verdade.',
        avoid: 'Não deixe a narração virar cronologia seca. A voz precisa ter interesse e ressentimento.',
      },
      {
        author: 'Bernard Cornwell',
        keywords: ['batalha', 'guerreiro', 'escudo', 'medieval', 'campanha'],
        guidance: 'Use para aventura histórica física. Batalhas devem ser sujas, espaciais e compreensíveis: lama, peso, medo, formação, arma, fome. O protagonista percebe por experiência, não por aula. A história vem pelo chão da cena.',
        example: 'O escudo pesava mais depois da terceira investida; não por causa da madeira, mas pelos homens que ele não conseguira salvar.',
        avoid: 'Não romantize batalha limpa. A força está em logística, corpo e sobrevivência.',
      },
      {
        author: 'Alexandre Dumas',
        keywords: ['duelo', 'amizade', 'vingança', 'capa e espada', 'aventura histórica'],
        guidance: 'Use para história com impulso de aventura, honra e conspiração. A cena deve ter movimento, lealdade, disfarce, promessa e virada. O tom pode ser elegante e teatral, com prazer narrativo claro.',
        example: 'Ele entrou pela porta como mensageiro, saiu pela janela como traidor e voltou pelo telhado como amigo.',
        avoid: 'Não deixe a teatralidade virar superficialidade. Lealdade e honra precisam custar algo.',
      },
    ],
  },
  {
    id: 'distopia_politica',
    label: 'Distopia e ficção política',
    keywords: ['distopia', 'regime', 'ditadura', 'controle', 'vigilância', 'estado', 'propaganda', 'opressão'],
    baseline: 'Distopia precisa mostrar sistema no cotidiano: linguagem oficial, fila, aplicativo, uniforme, punição, escola, família, trabalho. O terror político é mais forte quando o personagem participa de pequenos rituais de submissão.',
    lenses: [
      {
        author: 'George Orwell',
        keywords: ['vigilância', 'propaganda', 'partido', 'verdade', 'linguagem'],
        guidance: 'Use quando o poder controla linguagem e percepção. A cena deve mostrar slogans, burocracia, medo de ser observado e autocensura. O conflito não é só fugir do Estado; é tentar preservar a capacidade de pensar.',
        example: 'No formulário, a palavra fome fora substituída por ajuste alimentar; Marta assinou antes que a barriga denunciasse discordância.',
        avoid: 'Não explique a tirania em discursos longos. Mostre a linguagem deformando o dia.',
      },
      {
        author: 'Aldous Huxley',
        keywords: ['prazer', 'condicionamento', 'consumo', 'tecnocracia', 'felicidade falsa'],
        guidance: 'Use quando a opressão vem por conforto e distração. O mundo deve parecer eficiente, sedutor e espiritualmente vazio. Conflito nasce quando alguém percebe que prazer administrado também é prisão.',
        example: 'Todos receberam a pílula das oito com música e aplausos; só Bento notou que ninguém mais sabia terminar uma tristeza.',
        avoid: 'Não faça o sistema só cruel. Ele precisa ser tentador.',
      },
      {
        author: 'Margaret Atwood',
        keywords: ['patriarcado', 'corpo', 'teocracia', 'memória', 'resistência'],
        guidance: 'Use quando política invade corpo, gênero, família e linguagem íntima. A narração pode alternar presente controlado e memória de liberdade. Objetos pequenos viram relíquias de autonomia. A violência institucional aparece em regras domésticas.',
        example: 'Ela guardava o batom vazio como quem guarda uma chave; não abria portas, mas lembrava que um dia houve rosto.',
        avoid: 'Não transforme opressão em cenário genérico. Mostre o corpo pagando a lei.',
      },
      {
        author: 'Ray Bradbury',
        keywords: ['censura', 'livros', 'televisão', 'memória', 'fogo'],
        guidance: 'Use para distopia poética e humanista. A tecnologia ou censura deve empobrecer a atenção. A linguagem pode ser imagética, com contraste entre beleza sensorial e vazio cultural. A esperança nasce de memória preservada.',
        example: 'A tela ria por quatro paredes, mas o velho livro no forno ainda cheirava a chuva que ninguém transmitia.',
        avoid: 'Não pregue contra tecnologia de forma simplista. Ataque a perda de pensamento e imaginação.',
      },
      {
        author: 'José Saramago',
        keywords: ['alegoria', 'coletivo', 'instituição', 'absurdo', 'voz contínua'],
        guidance: 'Use quando uma premissa absurda revela sociedade. A voz pode ser reflexiva, irônica, observadora de coletivos e instituições. A cena deve tratar o impossível como teste moral: o que governos, casais, mercados e vizinhos fazem quando a regra comum falha.',
        example: 'Quando todos esqueceram o próprio nome, a prefeitura abriu um balcão para vender lembranças certificadas.',
        avoid: 'Não use alegoria sem consequência social. A ideia precisa reorganizar comportamento coletivo.',
      },
    ],
  },
  {
    id: 'aventura',
    label: 'Aventura',
    keywords: ['aventura', 'viagem', 'tesouro', 'expedição', 'sobrevivência', 'pirata', 'selva', 'mar'],
    baseline: 'Aventura precisa de objetivo visível, ambiente ativo e risco progressivo. O cenário não é fundo: ele empurra, atrasa, pune e revela caráter. Cada etapa deve cobrar preço físico ou moral.',
    lenses: [
      {
        author: 'Jules Verne',
        keywords: ['expedição', 'máquina', 'descoberta', 'viagem', 'ciência'],
        guidance: 'Use quando a aventura é descoberta organizada. Dê prazer ao mecanismo, rota, mapa, cálculo e maravilha. A cena deve transformar conhecimento em deslocamento e obstáculo.',
        example: 'O motor tossiu uma vez, como se duvidasse do próprio inventor, e então empurrou o barco contra uma noite sem mapas.',
        avoid: 'Não faça inventário técnico sem ameaça. A informação precisa mover a jornada.',
      },
      {
        author: 'Robert Louis Stevenson',
        keywords: ['pirata', 'tesouro', 'ilha', 'dupla face', 'juventude'],
        guidance: 'Use para aventura com sedução moral. O perigo deve ser carismático. Mapas, promessas e mentores ambíguos atraem o personagem para fora da inocência. A jornada muda a ideia de coragem.',
        example: 'O velho marinheiro ensinou o menino a ler estrelas e mentiras, mas cobrou por ambas no mesmo sorriso.',
        avoid: 'Não deixe vilões planos. A aventura cresce quando o perigo tem encanto.',
      },
      {
        author: 'Jack London',
        keywords: ['natureza', 'frio', 'sobrevivência', 'instinto', 'selvagem'],
        guidance: 'Use quando ambiente é antagonista. A prosa deve ser física: frio, fome, músculo, animalidade, cálculo de energia. A natureza não odeia ninguém; ela apenas exige adaptação.',
        example: 'A neve não queria matá-lo. Esse era o horror: ela só continuava caindo.',
        avoid: 'Não personifique demais o ambiente. A indiferença é mais forte que maldade.',
      },
      {
        author: 'Patrick O’Brian',
        keywords: ['navio', 'marinha', 'amizade', 'guerra naval', 'detalhe técnico'],
        guidance: 'Use para aventura de competência e camaradagem. Vocabulário técnico pode aparecer, mas precisa ser compreendido pelo efeito em pessoas: disciplina, medo, amizade, comando, rotina. O prazer está em ver uma equipe funcionar sob pressão.',
        example: 'Quando a vela rasgou, ninguém perguntou quem errara; no convés, culpa era luxo para depois da tempestade.',
        avoid: 'Não afogue o leitor em jargão. O detalhe técnico deve virar drama humano.',
      },
      {
        author: 'Clive Cussler',
        keywords: ['tesouro', 'conspiração', 'oceano', 'ação', 'relíquia'],
        guidance: 'Use para aventura moderna de alto conceito. Comece com mistério material: naufrágio, relíquia, mapa, máquina antiga. Alterne descoberta, ação e ameaça organizada. O ritmo deve premiar curiosidade com perigo.',
        example: 'A moeda encontrada no submarino tinha dois mil anos; a bala presa nela era de ontem.',
        avoid: 'Não deixe a relíquia ser só objeto bonito. Ela precisa mudar o presente.',
      },
    ],
  },
  {
    id: 'jovem_adulto',
    label: 'Jovem adulto',
    keywords: ['jovem adulto', 'ya', 'adolescente', 'escola', 'iniciação', 'primeiro amor', 'rebelião'],
    baseline: 'Jovem adulto precisa de urgência identitária. O conflito externo deve pressionar pertencimento, escolha, amizade, família, primeiro desejo e descoberta de poder ou voz. Evite falar de cima; a emoção deve ser imediata e específica.',
    lenses: [
      {
        author: 'J. K. Rowling',
        keywords: ['escola mágica', 'amizade', 'mistério escolar', 'crescimento'],
        guidance: 'Use quando a aventura cresce por ano, escola, amizade e segredo. Combine rotina encantadora, regras institucionais e perigo progressivo. O leitor precisa sentir lar e ameaça no mesmo lugar.',
        example: 'A biblioteca aceitava devoluções atrasadas; o problema eram os livros que voltavam contando o que tinham ouvido.',
        avoid: 'Não copie escola mágica. Use a técnica de comunidade, regra e descoberta gradual.',
      },
      {
        author: 'Suzanne Collins',
        keywords: ['arena', 'rebelião', 'mídia', 'sobrevivência', 'estado'],
        guidance: 'Use quando juventude enfrenta espetáculo político. A cena deve misturar medo físico, manipulação de imagem e escolha moral. O protagonista aprende que sobreviver diante das câmeras também comunica algo.',
        example: 'Lia não ergueu a faca para ameaçar; ergueu para que a cidade visse que sua mão ainda era dela.',
        avoid: 'Não reduza rebelião a pose. O símbolo nasce de risco real.',
      },
      {
        author: 'S. E. Hinton',
        keywords: ['gangue', 'classe', 'amizade', 'juventude marginalizada'],
        guidance: 'Use para juventude crua e emocionalmente direta. Voz próxima, leal, ferida. Conflito de classe e pertencimento aparece em brigas, roupas, ruas, família e vergonha. Amizade é sobrevivência.',
        example: 'Ele disse que não ligava para o corte no supercílio, mas passou a noite perguntando se a jaqueta ficara manchada.',
        avoid: 'Não romantize violência adolescente. Mostre lealdade e custo.',
      },
      {
        author: 'John Green',
        keywords: ['introspecção adolescente', 'amor', 'doença', 'filosofia', 'humor'],
        guidance: 'Use quando adolescentes pensam com intensidade e ironia. Diálogos podem carregar humor, referências e perguntas existenciais, mas a emoção precisa ficar vulnerável. O tema grande entra pela vida pequena.',
        example: 'Ela dizia que odiava metáforas, o que era injusto, porque transformava qualquer silêncio em um quarto sem janela.',
        avoid: 'Não faça todo jovem soar como ensaísta adulto. A inteligência precisa ter insegurança.',
      },
      {
        author: 'Rick Riordan',
        keywords: ['mitologia', 'humor', 'missão', 'grupo', 'monstros'],
        guidance: 'Use para aventura jovem com humor e mitologia acessível. A ação deve ser rápida, a voz espirituosa, e o mito precisa virar problema de hoje. Equipe, piada e perigo caminham juntos.',
        example: 'O deus do estacionamento exigiu tributo em moedas, chiclete e paciência; Theo só tinha as duas primeiras coisas.',
        avoid: 'Não use humor para anular perigo. A piada deve aliviar e revelar caráter.',
      },
    ],
  },
  {
    id: 'humor_satira',
    label: 'Humor e sátira',
    keywords: ['humor', 'sátira', 'comédia', 'absurdo', 'ironia', 'paródia'],
    baseline: 'Humor literário precisa de alvo, ritmo e surpresa. A piada deve revelar personagem ou sistema. Sátira funciona melhor quando a lógica absurda é seguida com seriedade.',
    lenses: [
      {
        author: 'Douglas Adams',
        keywords: ['absurdo', 'espaço', 'burocracia', 'nonsense', 'filosofia'],
        guidance: 'Use para absurdo lógico. A cena deve levar uma premissa ridícula até sua consequência burocrática mais séria. O humor surge do contraste entre escala cósmica e inconveniência cotidiana.',
        example: 'O planeta seria salvo, informou o comitê, assim que alguém preenchesse o formulário de existência em três vias.',
        avoid: 'Não jogue aleatoriedade sem encadeamento. O absurdo precisa seguir uma lógica própria.',
      },
      {
        author: 'Terry Pratchett',
        keywords: ['fantasia satírica', 'instituições', 'guilda', 'morte', 'cidade'],
        guidance: 'Use quando fantasia comenta trabalho, política e costume. A piada deve nascer de uma instituição funcionando exatamente como não deveria, mas como as pessoas aceitam. Humor e ternura podem coexistir.',
        example: 'A guilda dos ladrões reclamou da criminalidade; afinal, alguém estava roubando sem emitir recibo.',
        avoid: 'Não faça paródia vazia de fantasia. A sátira precisa entender a instituição que critica.',
      },
      {
        author: 'Mark Twain',
        keywords: ['voz oral', 'ironia social', 'aventura', 'hipocrisia'],
        guidance: 'Use para humor de voz e crítica social. A narração pode parecer simples, mas enxerga hipocrisias que adultos sofisticados ignoram. O ritmo vem de oralidade, observação e reversão de senso comum.',
        example: 'O juiz era tão honesto que só aceitava suborno depois de explicar a lei, para ninguém se sentir enganado.',
        avoid: 'Não confunda voz simples com pensamento pobre. A ingenuidade pode ser lâmina.',
      },
      {
        author: 'Voltaire',
        keywords: ['filosofia', 'sarcasmo', 'otimismo', 'instituições', 'fábula'],
        guidance: 'Use para sátira filosófica rápida. Cenas podem ser exemplares, quase fábulas, expondo uma ideia ao ridículo por excesso de coerência. O narrador trata absurdos humanos com secura elegante.',
        example: 'Declararam a cidade perfeitamente livre, exceto nos assuntos de fala, culto, comércio, amor e saída.',
        avoid: 'Não explique a moral depois. A contradição deve bastar.',
      },
      {
        author: 'Machado de Assis',
        keywords: ['ironia', 'digressão', 'elite', 'autoengano', 'narrador'],
        guidance: 'Use para ironia psicológica e social. O narrador pode se aproximar do leitor, desviar, corrigir, negar e revelar vaidade. A crítica é elegante, venenosa e íntima. O humor nasce do autoengano refinado.',
        example: 'Não direi que ele mentiu; apenas arrumou a verdade de modo que ela coubesse melhor no colete.',
        avoid: 'Não copie forma diretamente. Use a técnica de narrador consciente, ironia e máscara social.',
      },
    ],
  },
  {
    id: 'autoajuda',
    label: 'Autoajuda e desenvolvimento pessoal',
    keywords: ['autoajuda', 'desenvolvimento pessoal', 'produtividade', 'hábito', 'liderança', 'motivacional', 'carreira'],
    baseline: 'Autoajuda forte precisa de problema claro, experiência reconhecível, princípio aplicável e exercício concreto. Evite promessa vazia; transforme ideia em prática verificável.',
    lenses: [
      {
        author: 'Dale Carnegie',
        keywords: ['relacionamento', 'influência', 'comunicação', 'amizade'],
        guidance: 'Use quando o foco é relação humana. Abra com situação comum, mostre erro de abordagem, ofereça princípio simples e exemplo prático. O tom deve ser encorajador, conversacional e orientado a pequenas mudanças sociais.',
        example: 'Antes de convencer alguém, pergunte o que essa pessoa tem medo de perder se concordar com você.',
        avoid: 'Não manipule o leitor com promessa de controle sobre os outros. Foque empatia prática.',
      },
      {
        author: 'Stephen Covey',
        keywords: ['princípios', 'hábitos', 'liderança', 'prioridades', 'caráter'],
        guidance: 'Use quando o livro precisa de estrutura conceitual robusta. Organize por princípios, não truques. Cada capítulo deve ligar escolha diária a visão de longo prazo, responsabilidade e alinhamento entre valores e agenda.',
        example: 'Se sua semana não reserva espaço para o que você diz ser essencial, sua agenda já respondeu por você.',
        avoid: 'Não transforme princípio em frase de efeito. Mostre aplicação, consequência e revisão.',
      },
      {
        author: 'Brené Brown',
        keywords: ['vulnerabilidade', 'coragem', 'vergonha', 'liderança humana'],
        guidance: 'Use quando o tema é coragem emocional. Combine pesquisa, história pessoal controlada e linguagem compassiva. O leitor precisa sentir permissão para nomear vergonha sem ser diminuído. Prática nasce de honestidade.',
        example: 'Vulnerabilidade não é contar tudo; é parar de fingir que nada importa quando importa demais.',
        avoid: 'Não confunda acolhimento com suavidade sem ação. A ideia deve levar a conversa difícil.',
      },
      {
        author: 'James Clear',
        keywords: ['hábitos', 'sistema', 'pequenas melhorias', 'identidade'],
        guidance: 'Use para produtividade prática e hábitos. Frases claras, exemplos curtos, regra aplicável e foco em sistema. A mudança deve parecer mensurável: gatilho, rotina, ambiente, recompensa, identidade.',
        example: 'Não comece prometendo correr cinco quilômetros; comece deixando o tênis onde a desculpa tropeça nele.',
        avoid: 'Não venda disciplina como força de vontade infinita. Mostre desenho de ambiente.',
      },
      {
        author: 'Carol Dweck',
        keywords: ['mentalidade', 'aprendizado', 'crescimento', 'fracasso'],
        guidance: 'Use quando o tema é aprendizagem e mudança de crença. Explique diferença entre identidade fixa e processo. Mostre erro como informação, não sentença. O tom deve ser didático, mas humano.',
        example: 'A nota baixa não diz quem você é; diz qual estratégia acabou de pedir substituição.',
        avoid: 'Não simplifique mentalidade em otimismo. Crescimento exige método e feedback.',
      },
    ],
  },
  {
    id: 'memorias_biografia',
    label: 'Memórias e biografia',
    keywords: ['memórias', 'biografia', 'autobiografia', 'vida real', 'relato', 'trajetória'],
    baseline: 'Memórias precisam de verdade narrativa, seleção e reflexão. A cena deve equilibrar acontecimento, contexto e significado posterior. Biografia precisa ligar escolha individual a época, rede de relações e consequência.',
    lenses: [
      {
        author: 'Maya Angelou',
        keywords: ['memória', 'voz lírica', 'infância', 'resiliência', 'dignidade'],
        guidance: 'Use quando memória pessoal carrega dor e dignidade. A prosa pode ser lírica sem perder clareza. Cenas de infância devem preservar sensação, voz, vergonha e força. O significado surge sem apagar a ferida.',
        example: 'A menina aprendeu cedo que silêncio também tinha peso; carregava-o no colo quando ninguém queria vê-lo.',
        avoid: 'Não estetize sofrimento sem agência. A voz precisa permanecer dona da própria história.',
      },
      {
        author: 'Anne Frank',
        keywords: ['diário', 'confinamento', 'adolescência', 'guerra', 'esperança'],
        guidance: 'Use para intimidade diarística sob pressão histórica. O texto deve registrar o cotidiano pequeno enquanto a ameaça grande cerca a página. Honestidade, irritação, esperança e medo convivem sem pose heroica.',
        example: 'Hoje contei os passos no corredor outra vez; é estranho como o medo aprende matemática antes da gente.',
        avoid: 'Não transforme diário em discurso histórico amplo. O poder está no detalhe íntimo.',
      },
      {
        author: 'Michelle Obama',
        keywords: ['formação', 'família', 'carreira', 'identidade', 'serviço público'],
        guidance: 'Use para memória de trajetória e identidade pública. Estruture episódios como formação: casa, estudo, trabalho, dilema, responsabilidade. A voz deve ser acessível, reflexiva e consciente de comunidade.',
        example: 'Só entendi o tamanho da sala quando percebi quantas meninas parecidas comigo nunca tinham sido convidadas a entrar.',
        avoid: 'Não faça autopromoção linear. Mostre dúvida, trabalho e contexto social.',
      },
      {
        author: 'Malala Yousafzai',
        keywords: ['educação', 'coragem', 'família', 'ativismo', 'violência política'],
        guidance: 'Use quando a memória articula juventude, família e causa. O tom deve ligar experiência pessoal a direito coletivo. Coragem aparece em rotina, escola, voz e risco, não só em grandes eventos.',
        example: 'Naquela manhã, levar livros era um gesto pequeno; pequeno como uma faísca antes de saber que ilumina.',
        avoid: 'Não transforme a protagonista em símbolo sem vida cotidiana. Mostre família, medo e humor.',
      },
      {
        author: 'Walter Isaacson',
        keywords: ['biografia', 'inovação', 'gênio', 'processo', 'história oral'],
        guidance: 'Use para biografia analítica. A narrativa deve alternar cena, contexto, depoimento e análise de decisão. Mostre talento junto de falhas, rede de colaboração e ambiente histórico.',
        example: 'A ideia não nasceu no quadro branco; nasceu no atrito entre três pessoas que discordavam do problema certo.',
        avoid: 'Não trate biografado como mito isolado. Mostre equipe, época e contradições.',
      },
    ],
  },
  {
    id: 'infantojuvenil',
    label: 'Infantil e infantojuvenil',
    keywords: ['infantil', 'infantojuvenil', 'criança', 'fábula', 'conto', 'maravilhoso'],
    baseline: 'Literatura infantil forte respeita inteligência emocional da criança. Simplicidade não é pobreza: imagem clara, ritmo, regra lúdica e medo seguro. O mundo deve convidar descoberta.',
    lenses: [
      {
        author: 'Lewis Carroll',
        keywords: ['nonsense', 'jogo de linguagem', 'lógica absurda', 'maravilha'],
        guidance: 'Use para fantasia de lógica brincalhona. A cena deve seguir regras linguísticas estranhas com seriedade. Perguntas literais, trocadilhos conceituais e inversões de sentido criam maravilha.',
        example: 'A porta só abria para quem perguntasse errado; felizmente, Nina nunca soube perguntar direito.',
        avoid: 'Não faça aleatoriedade solta. O nonsense precisa ter regra interna.',
      },
      {
        author: 'Roald Dahl',
        keywords: ['criança esperta', 'adulto grotesco', 'humor sombrio', 'revolta'],
        guidance: 'Use quando criança enfrenta adultos absurdamente injustos. O humor pode ser exagerado e um pouco cruel, mas a justiça emocional deve favorecer imaginação, esperteza e coragem infantil.',
        example: 'O diretor dizia que doces estragavam o caráter, embora escondesse pudim até dentro do dicionário.',
        avoid: 'Não humilhe por humilhar. O exagero precisa libertar a criança do abuso ou da opressão.',
      },
      {
        author: 'C. S. Lewis',
        keywords: ['portal', 'alegoria', 'irmãos', 'reino mágico', 'coragem'],
        guidance: 'Use para aventura moral e encantamento clássico. A criança entra em mundo maior, enfrenta tentação, medo e responsabilidade. Objetos simples podem virar portais de vocação.',
        example: 'O guarda-chuva no canto pingava neve, embora a sala estivesse fechada desde abril.',
        avoid: 'Não pregue a moral diretamente. Faça a escolha da criança carregar o valor.',
      },
      {
        author: 'L. Frank Baum',
        keywords: ['jornada colorida', 'companheiros', 'terra mágica', 'desejo'],
        guidance: 'Use para jornada maravilhosa com companheiros simbólicos. Cada personagem representa desejo ou falta, mas precisa agir como pessoa divertida. O mundo deve ser visual, estranho e acolhedor.',
        example: 'A estrada era feita de botões dourados, e cada passo fechava uma saudade diferente.',
        avoid: 'Não transforme símbolos em lição seca. Eles devem brincar, errar e surpreender.',
      },
      {
        author: 'Maurice Sendak',
        keywords: ['emoção infantil', 'monstro', 'raiva', 'casa', 'imaginação'],
        guidance: 'Use quando a fantasia dá forma a emoção da criança. Raiva, medo e desejo viram criaturas, ilhas, quartos, coroas. A aventura deve permitir sentir intensamente e voltar transformado.',
        example: 'Quando Tom bateu a porta, o quarto cresceu dentes; ele só voltou a ser pequeno quando pediu sopa.',
        avoid: 'Não moralize emoção infantil. A fantasia deve acolher e organizar o sentimento.',
      },
    ],
  },
];

export const STYLE_REPERTOIRE_GENRE_COUNT = STYLE_REPERTOIRE.length;
export const STYLE_REPERTOIRE_AUTHOR_COUNT = STYLE_REPERTOIRE.reduce((sum, cluster) => sum + cluster.lenses.length, 0);

export type StyleCalibrationOption = {
  id: string;
  title: string;
  description: string;
  example: string;
  technicalNotes: string;
};

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function scoreKeywordSet(keywords: string[], haystack: string) {
  return keywords.reduce((score, keyword) => {
    const normalized = normalize(keyword);
    if (!normalized) return score;
    return haystack.includes(normalized) ? score + 1 : score;
  }, 0);
}

function hasUsableAuthorStyle(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length < 280) return false;
  return !/^(nao informado|não informado|sem essencia|sem essência|sem estilo)$/i.test(trimmed);
}

function selectStyleLenses(input: {
  title?: string | null;
  subtitle?: string | null;
  genre?: string | null;
  description?: string | null;
  sceneContext?: string | null;
  universeContext?: string | null;
  libraryContext?: string | null;
}) {
  const haystack = normalize([
    input.title,
    input.subtitle,
    input.genre,
    input.description,
    input.sceneContext,
    input.universeContext,
    input.libraryContext,
  ].filter(Boolean).join('\n'));

  const scoredClusters = STYLE_REPERTOIRE
    .map((cluster) => ({
      cluster,
      score: scoreKeywordSet(cluster.keywords, haystack) + (input.genre && normalize(input.genre).includes(normalize(cluster.label)) ? 4 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const primary = scoredClusters[0]?.score ? scoredClusters[0].cluster : STYLE_REPERTOIRE.find((cluster) => cluster.id === 'drama_literario')!;
  const secondary = scoredClusters.filter((item) => item.cluster.id !== primary.id && item.score > 0).slice(0, 2).map((item) => item.cluster);
  const lensPool = [primary, ...secondary].flatMap((cluster) =>
    cluster.lenses.map((lens) => ({
      cluster,
      lens,
      score: scoreKeywordSet([...lens.keywords, ...cluster.keywords], haystack),
    })),
  );
  const selected = lensPool.sort((a, b) => b.score - a.score).slice(0, 5);
  return {
    primary,
    chosen: selected.length >= 3 ? selected : primary.lenses.slice(0, 5).map((lens) => ({ cluster: primary, lens, score: 0 })),
  };
}

function baseSituation(input: {
  title?: string | null;
  genre?: string | null;
  description?: string | null;
  sceneContext?: string | null;
}) {
  const text = (input.sceneContext || input.description || input.title || '').trim();
  if (!text) return 'uma pessoa encontra um detalhe pequeno que muda o sentido da vida que levava';
  return text.replace(/\s+/g, ' ').replace(/[.!?].*$/, '').trim().slice(0, 220);
}

function sceneKit(situation: string) {
  const normalized = normalize(situation);

  if (/(deepweb|internet|rede|site|online|tecnologia|hacker|perfil|senha)/.test(normalized)) {
    return {
      protagonist: 'ela',
      place: 'o quarto iluminado pelo monitor',
      location: 'no quarto iluminado pelo monitor',
      arrival: 'sentou-se diante do monitor',
      placeSubject: 'O quarto iluminado pelo monitor',
      concreteDetail: 'um link sem título piscando no histórico',
      threat: 'alguém do outro lado já saber seu nome completo',
      reportedDanger: 'que alguém do outro lado já sabia seu nome completo',
      catastrophe: 'alguém do outro lado já soubesse seu nome completo',
      publicPressure: 'a rede que transforma curiosidade em rastro',
      intimateObject: 'o celular virado para baixo',
      closingImage: 'a tela apagada refletindo um rosto que parecia menos dela',
    };
  }

  if (/(medieval|castelo|reino|muralha|caverna|criatura|monstro|noite|passado|subterr)/.test(normalized)) {
    return {
      protagonist: 'ela',
      place: 'a muralha úmida antes do amanhecer',
      location: 'junto à muralha úmida antes do amanhecer',
      arrival: 'subiu à muralha úmida antes do amanhecer',
      placeSubject: 'A muralha úmida',
      concreteDetail: 'uma sequência recente de marcas de unha na pedra antiga',
      threat: 'as criaturas voltarem antes que os portões fossem fechados',
      reportedDanger: 'a volta das criaturas antes do fechamento dos portões',
      catastrophe: 'as criaturas voltassem antes que os portões fossem fechados',
      publicPressure: 'a lei da cidade, que preferia sacrificar pobres a admitir medo',
      intimateObject: 'a faca curta escondida sob o manto',
      closingImage: 'o sino preso na torre tremendo sem que ninguém o tocasse',
    };
  }

  if (/(crime|policia|trafico|investiga|assassin|corrup|facção|facçao)/.test(normalized)) {
    return {
      protagonist: 'ela',
      place: 'a sala de arquivo com cheiro de papel molhado',
      location: 'na sala de arquivo com cheiro de papel molhado',
      arrival: 'entrou na sala de arquivo com cheiro de papel molhado',
      placeSubject: 'A sala de arquivo',
      concreteDetail: 'um nome repetido em três boletins diferentes',
      threat: 'o caso subir para gente poderosa demais',
      reportedDanger: 'que o caso chegaria a gente poderosa demais',
      catastrophe: 'o caso subisse para gente poderosa demais',
      publicPressure: 'a cidade que chamava silêncio de ordem',
      intimateObject: 'a foto dobrada dentro do bolso',
      closingImage: 'a luz do corredor se apagando antes do passo seguinte',
    };
  }

  return {
    protagonist: 'ela',
    place: 'um lugar comum que de repente pareceu errado',
    location: 'num lugar comum que de repente pareceu errado',
    arrival: 'parou num lugar comum que de repente pareceu errado',
    placeSubject: 'O lugar',
    concreteDetail: 'um detalhe pequeno que ninguém mais tinha notado',
    threat: 'a verdade cobrar uma escolha antes de estar completa',
    reportedDanger: 'a verdade antes de estar completa',
    catastrophe: 'a verdade cobrasse uma escolha antes de estar completa',
    publicPressure: 'um mundo que continuava funcionando porque todos fingiam não ver',
    intimateObject: 'o objeto na mão ficando pesado demais',
    closingImage: 'o silêncio abrindo espaço para uma decisão sem volta',
  };
}

function optionTitle(lens: AuthorLens, cluster: GenreStyleCluster) {
  const source = normalize(`${cluster.label} ${lens.keywords.join(' ')} ${lens.guidance}`);
  if (source.includes('culpa') || source.includes('moral') || source.includes('obsess')) return 'Tensão psicológica e escolha moral';
  if (source.includes('investiga') || source.includes('crime') || source.includes('pista')) return 'Suspense de descoberta concreta';
  if (source.includes('mundo') || source.includes('sociedade') || source.includes('politica') || source.includes('sistema')) return 'Mundo e sistema pressionando a cena';
  if (source.includes('sensor') || source.includes('casa') || source.includes('horror') || source.includes('terror')) return 'Atmosfera sensorial e ameaça crescente';
  if (source.includes('romance') || source.includes('desejo') || source.includes('rela')) return 'Intimidade, desejo e subtexto';
  if (source.includes('epic') || source.includes('mit') || source.includes('guerra')) return 'Escala, consequência e promessa épica';
  return 'Prosa literária com cena específica';
}

function renderCalibrationExample(title: string, situation: string) {
  const kit = sceneKit(situation);
  if (title.includes('psicológica')) {
    return `${kit.protagonist[0].toUpperCase()}${kit.protagonist.slice(1)} percebeu ${kit.concreteDetail} e ficou imóvel, como se o corpo tivesse entendido antes da cabeça. Não era medo ainda; era aquela vergonha infantil de ter aberto uma porta proibida e descoberto que a porta também olhava de volta. Ali, ${kit.location}, tudo continuava no lugar, mas o ar parecia usado por outra pessoa. ${kit.intimateObject[0].toUpperCase()}${kit.intimateObject.slice(1)} não servia para defesa nenhuma, mesmo assim ela manteve a mão ali até doer. Podia chamar alguém. Podia fingir que não vira. Podia apagar a prova e continuar viva por mais uma noite. O problema era simples: depois de ver, ela teria que escolher que tipo de covarde queria ser.`;
  }
  if (title.includes('descoberta')) {
    return `O primeiro indício parecia pequeno demais para merecer pânico: ${kit.concreteDetail}. O segundo veio quando ${kit.protagonist} voltou ao ponto exato onde tudo começara e percebeu uma segunda marca, quase apagada. O terceiro estava no silêncio dos outros. Ninguém comentava ${kit.reportedDanger}; comentavam banalidades, atrasos, notícias, qualquer coisa que mantivesse as mãos ocupadas. Ela comparou marcas, horários e mentiras, e só então a cena ganhou forma. Não havia monstro visível. Havia preparação. Havia método. Havia alguém contando com a pressa dela. Quando levantou os olhos, entendeu que a pista não apontava para uma resposta. Apontava para a próxima armadilha.`;
  }
  if (title.includes('sistema')) {
    return `A regra nunca estava escrita onde todos pudessem ler, mas todos obedeciam: quando surgia ${kit.concreteDetail}, alguém de menor importância pagava pela tranquilidade dos outros. ${kit.protagonist[0].toUpperCase()}${kit.protagonist.slice(1)} aprendeu isso antes de aprender os nomes das ruas. Ali, ${kit.location}, os guardas não olhavam para cima, os comerciantes baixavam as portas devagar, e as famílias importantes chamavam prudência aquilo que, nos becos, tinha outro nome. ${kit.publicPressure[0].toUpperCase()}${kit.publicPressure.slice(1)}, apertava mais que qualquer corrente. Se ela denunciasse ${kit.reportedDanger}, salvaria talvez uma vida e condenaria a própria casa. Se calasse, a cidade continuaria inteira. Inteira e podre.`;
  }
  if (title.includes('Atmosfera')) {
    return `Antes de entender o perigo, ${kit.protagonist} sentiu o lugar mudar de temperatura. ${kit.placeSubject} soltava um frio que não vinha do vento. A sombra nos cantos parecia mais espessa, e ${kit.concreteDetail} tinha a delicadeza nojenta das coisas recém-feitas. Ela escutou o próprio fôlego, depois escutou a falta de outro som que deveria estar ali. Nenhum grito. Nenhum aviso. Só ${kit.closingImage}. O medo não chegou como susto; chegou como uma certeza lenta, espalhando-se pelos dedos, subindo pelos braços, ensinando ao coração uma batida mais curta.`;
  }
  if (title.includes('Intimidade')) {
    return `"Você viu também?", ele perguntou, baixo demais para ser uma pergunta comum.\n\n${kit.protagonist[0].toUpperCase()}${kit.protagonist.slice(1)} não respondeu de imediato. Entre eles havia ${kit.concreteDetail}, mas havia também anos de pequenas proteções, favores não cobrados, promessas ditas quando ninguém mais escutava. Era isso que tornava tudo pior. Um estranho ela poderia denunciar. Um inimigo ela poderia abandonar. Mas aquela voz conhecia seus medos pelo nome, e ${kit.intimateObject} lembrava que confiança também podia ser usada contra alguém. Quando ele deu um passo, ela não recuou. Só perguntou o que custaria continuar acreditando nele.`;
  }
  if (title.includes('épica')) {
    return `Ninguém chamaria aquilo de começo. Começos, nas histórias antigas, vinham com presságios claros e nomes gravados em metal. Ali havia apenas ${kit.protagonist}, ${kit.intimateObject} e ${kit.concreteDetail}. Mesmo assim, ${kit.location}, algo antigo pareceu prender a respiração. Se ${kit.catastrophe}, não seria uma tragédia privada; cairiam portas, juramentos, mapas, famílias inteiras que dormiam confiando em muralhas e versões oficiais. Ela pensou em correr. Pensou em rezar. Depois pensou que toda lenda, antes de virar canção, devia ter sido apenas uma pessoa cansada fazendo a escolha que ninguém queria fazer.`;
  }
  return `${kit.protagonist[0].toUpperCase()}${kit.protagonist.slice(1)} ${kit.arrival} com a impressão de que chegara tarde a uma conversa importante. ${kit.concreteDetail[0].toUpperCase()}${kit.concreteDetail.slice(1)} bastava para desmentir a versão tranquila do mundo. Nada explodiu, ninguém confessou, nenhuma verdade se explicou inteira. Ainda assim, cada coisa ao redor parecia escolher lado: a porta, o chão, ${kit.intimateObject}. Quando enfim se moveu, ela não tinha certeza do que faria depois. Tinha apenas a certeza de que, se continuasse parada, outra pessoa escreveria o final por ela.`;
}

export function buildStyleCalibrationOptions(input: {
  title?: string | null;
  subtitle?: string | null;
  genre?: string | null;
  description?: string | null;
  sceneContext?: string | null;
  universeContext?: string | null;
  libraryContext?: string | null;
}): StyleCalibrationOption[] {
  const { chosen } = selectStyleLenses(input);
  const situation = baseSituation(input);
  const usedTitles = new Set<string>();
  const options: StyleCalibrationOption[] = [];

  for (const { cluster, lens } of chosen) {
    const title = optionTitle(lens, cluster);
    if (usedTitles.has(title)) continue;
    usedTitles.add(title);
    options.push({
      id: `${cluster.id}:${normalize(title).replace(/[^a-z0-9]+/g, '_')}`,
      title,
      description: `Mini-cena escrita para testar a mesma situação com outra condução: ritmo, foco, densidade e tipo de tensão.`,
      example: renderCalibrationExample(title, situation),
      technicalNotes: `${lens.guidance}\n\nEvitar: ${lens.avoid}`,
    });
    if (options.length === 4) break;
  }

  for (const title of ['Tensão psicológica e escolha moral', 'Suspense de descoberta concreta', 'Mundo e sistema pressionando a cena', 'Atmosfera sensorial e ameaça crescente']) {
    if (options.length === 4) break;
    if (usedTitles.has(title)) continue;
    options.push({
      id: `fallback:${normalize(title).replace(/[^a-z0-9]+/g, '_')}`,
      title,
      description: 'Mini-cena complementar para calibrar gosto antes da obra nascer.',
      example: renderCalibrationExample(title, situation),
      technicalNotes: 'Use como bússola de ritmo, foco e atmosfera. A história continua sendo definida pelas respostas do autor.',
    });
  }

  return options;
}

export function buildStyleRepertoireGuidance(input: {
  title?: string | null;
  subtitle?: string | null;
  genre?: string | null;
  description?: string | null;
  sceneContext?: string | null;
  universeContext?: string | null;
  libraryContext?: string | null;
  authorStyle?: string | null;
}) {
  if (hasUsableAuthorStyle(input.authorStyle)) return '';
  const { primary, chosen } = selectStyleLenses(input);

  return `REPERTÓRIO TÉCNICO DE ESTILO POR GÊNERO
Use este repertório como estudo de técnicas literárias transferíveis. Histórias diferentes não copiam uma escrita; elas aproveitam ferramentas: ritmo, ponto de vista, construção de cena, densidade sensorial, subtexto, progressão dramática e tipo de imagem.

Gênero-base detectado: ${primary.label}
Direção geral do gênero: ${primary.baseline}

Lentes técnicas recomendadas para esta obra:
${chosen.map(({ cluster, lens }, index) => `${index + 1}. ${lens.author} (${cluster.label})
- Quando usar: ${lens.guidance}
- Exemplo original de mecanismo, não de imitação: ${lens.example}
- Evitar: ${lens.avoid}`).join('\n\n')}

Aplicação obrigatória na Escrita:
- Antes de escrever, escolha mentalmente a lente que melhor combina com o rascunho e com o gênero da obra.
- Transforme o rascunho em cena específica, com ação, consequência, textura e voz humana.
- Se não houver Estilo salvo no Perfil, este repertório deve impedir prosa genérica de IA: nada de explicações óbvias de emoção, nada de frases de preenchimento, nada de resumo disfarçado de capítulo.
- Se houver conflito entre repertório e rascunho do autor, o rascunho vence.`;
}
