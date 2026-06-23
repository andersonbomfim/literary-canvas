export type LiteraryTasteAuthorSuggestion = {
  id: string;
  name: string;
  reason: string;
  genres: string[];
  signals: string[];
  works: string[];
  toneDirections: string[];
};

export type LiteraryTasteWorkSuggestion = {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
};

export type LiteraryTasteProfile = {
  detectedSignals: string[];
  authors: LiteraryTasteAuthorSuggestion[];
  works: LiteraryTasteWorkSuggestion[];
  toneDirections: string[];
};

export type LiteraryTasteSelection = {
  detectedSignals: string[];
  selectedAuthors: Array<{
    id: string;
    name: string;
    reason: string;
    works: string[];
    toneDirections: string[];
  }>;
  selectedWorks: LiteraryTasteWorkSuggestion[];
  toneDirections: string[];
  selectedToneDirections: string[];
  customTone: string;
};

const AUTHOR_CATALOG: LiteraryTasteAuthorSuggestion[] = [
  {
    id: "george_rr_martin",
    name: "George R. R. Martin",
    reason:
      "Intriga política, casas rivais, fantasia de baixa magia e consequências duras.",
    genres: ["fantasia", "suspense", "drama", "histórico"],
    signals: [
      "medieval",
      "reino",
      "trono",
      "nobreza",
      "guerra",
      "intriga",
      "política",
      "poder",
      "familia",
    ],
    works: ["A Guerra dos Tronos", "A Fúria dos Reis", "O Festim dos Corvos"],
    toneDirections: [
      "intriga política brutal",
      "fantasia adulta com consequências morais",
      "jogo de poder entre famílias",
    ],
  },
  {
    id: "umberto_eco",
    name: "Umberto Eco",
    reason:
      "Mistério intelectual em ambiente medieval, símbolos, religião, manuscritos e investigação.",
    genres: ["suspense", "mistério", "histórico"],
    signals: [
      "medieval",
      "mosteiro",
      "igreja",
      "monge",
      "crime",
      "investigação",
      "manuscrito",
      "heresia",
    ],
    works: ["O Nome da Rosa", "Baudolino", "O Pêndulo de Foucault"],
    toneDirections: [
      "mistério histórico intelectual",
      "suspense de investigação em mundo religioso",
      "densidade simbólica e atmosfera erudita",
    ],
  },
  {
    id: "maurice_druon",
    name: "Maurice Druon",
    reason:
      "Dinastias, sucessão, traição política e tragédia histórica em escala de reino.",
    genres: ["histórico", "drama", "suspense"],
    signals: [
      "medieval",
      "rei",
      "rainha",
      "coroa",
      "dinastia",
      "sucessão",
      "trair",
      "nobreza",
    ],
    works: ["Os Reis Malditos", "O Rei de Ferro", "A Lei dos Machos"],
    toneDirections: [
      "tragédia dinástica",
      "conspiração de corte",
      "história política seca e cruel",
    ],
  },
  {
    id: "ken_follett",
    name: "Ken Follett",
    reason:
      "Construção histórica ampla, instituições, ambição social e conflito de longo fôlego.",
    genres: ["histórico", "drama", "suspense"],
    signals: [
      "medieval",
      "construcao",
      "cidade",
      "igreja",
      "familia",
      "século",
      "guerra",
      "instituio",
    ],
    works: ["Os Pilares da Terra", "Mundo Sem Fim", "A Coluna de Fogo"],
    toneDirections: [
      "épico histórico acessível",
      "drama social com grandes instituições",
      "conflitos atravessando anos",
    ],
  },
  {
    id: "bernard_cornwell",
    name: "Bernard Cornwell",
    reason:
      "Aventura histórica, guerra, estrategia, honra e sobrevivência em mundo violento.",
    genres: ["histórico", "aventura", "suspense"],
    signals: [
      "medieval",
      "batalha",
      "guerra",
      "espada",
      "exército",
      "invasão",
      "sobrevivência",
    ],
    works: ["As Crônicas de Artur", "O Último Reino", "Stonehenge"],
    toneDirections: [
      "ação histórica áspera",
      "sobrevivência em guerra",
      "honra testada por violência",
    ],
  },
  {
    id: "agatha_christie",
    name: "Agatha Christie",
    reason:
      "Mistério de estrutura limpa, suspeitos, pistas, viradas e solução elegante.",
    genres: ["mistério", "suspense"],
    signals: [
      "assassinato",
      "crime",
      "detetive",
      "suspeito",
      "investigação",
      "pista",
      "mansão",
    ],
    works: [
      "Assassinato no Expresso do Oriente",
      "E Não Sobrou Nenhum",
      "Morte no Nilo",
    ],
    toneDirections: [
      "mistério de pistas e suspeitos",
      "suspense clássico de investigação",
      "estrutura de revelação elegante",
    ],
  },
  {
    id: "patricia_highsmith",
    name: "Patricia Highsmith",
    reason:
      "Suspense psicológico, culpa, obsessão, identidade e moralidade instável.",
    genres: ["suspense", "drama", "psicológico"],
    signals: [
      "culpa",
      "obsessão",
      "identidade",
      "psicológico",
      "mentira",
      "crime",
      "moralidade",
    ],
    works: ["O Talentoso Ripley", "Pacto Sinistro", "Carol"],
    toneDirections: [
      "suspense psicológico íntimo",
      "moralidade ambígua",
      "tensão de identidade e culpa",
    ],
  },
  {
    id: "gillian_flynn",
    name: "Gillian Flynn",
    reason:
      "Narradores pouco confiáveis, relações tóxicas, segredos familiares e violência íntima.",
    genres: ["suspense", "drama", "mistério"],
    signals: [
      "segredo",
      "familia",
      "casamento",
      "mentira",
      "violência",
      "mulher",
      "investigação",
    ],
    works: ["Garota Exemplar", "Objetos Cortantes", "Lugares Escuros"],
    toneDirections: [
      "suspense doméstico venenoso",
      "narrador instável",
      "segredos íntimos e violência emocional",
    ],
  },
  {
    id: "stephen_king",
    name: "Stephen King",
    reason:
      "Horror popular com comunidade, trauma, cotidiano corroído e ameaça crescente.",
    genres: ["terror", "suspense", "fantasia"],
    signals: [
      "terror",
      "cidade",
      "crianca",
      "monstro",
      "sobrenatural",
      "trauma",
      "mal",
      "comunidade",
    ],
    works: ["It: A Coisa", "O Iluminado", "Carrie"],
    toneDirections: [
      "horror de cotidiano contaminado",
      "ameaça sobrenatural crescendo",
      "trauma pessoal virando terror coletivo",
    ],
  },
  {
    id: "shirley_jackson",
    name: "Shirley Jackson",
    reason:
      "Horror psicológico, casa, paranoia social e estranhamento elegante.",
    genres: ["terror", "drama", "psicológico"],
    signals: [
      "casa",
      "familia",
      "paranoia",
      "isolamento",
      "estranho",
      "ritual",
      "cidade",
    ],
    works: [
      "A Assombração da Casa da Colina",
      "Sempre Vivemos no Castelo",
      "A Loteria",
    ],
    toneDirections: [
      "horror psicológico discreto",
      "paranoia social",
      "estranhamento doméstico",
    ],
  },
  {
    id: "jrr_tolkien",
    name: "J. R. R. Tolkien",
    reason: "Fantasia mítica, línguas, povos, jornada, destino e mundo antigo.",
    genres: ["fantasia", "aventura"],
    signals: [
      "elfo",
      "anão",
      "magia",
      "reino",
      "profecia",
      "jornada",
      "mitologia",
      "antigo",
    ],
    works: ["O Senhor dos Anéis", "O Hobbit", "O Silmarillion"],
    toneDirections: [
      "fantasia mítica e épica",
      "jornada heroica",
      "mundo antigo com senso de lenda",
    ],
  },
  {
    id: "brandon_sanderson",
    name: "Brandon Sanderson",
    reason:
      "Sistemas de poder claros, regras, viradas de escala e fantasia estrutural.",
    genres: ["fantasia", "aventura"],
    signals: [
      "magia",
      "poder",
      "regra",
      "sistema",
      "ordem",
      "imperio",
      "deus",
      "energia",
    ],
    works: ["Mistborn", "O Caminho dos Reis", "Elantris"],
    toneDirections: [
      "fantasia de sistema de poder",
      "conflito de escala épica",
      "regras mágicas claras",
    ],
  },
  {
    id: "ursula_le_guin",
    name: "Ursula K. Le Guin",
    reason:
      "Mundo especulativo com antropologia, equilíbrio, linguagem, ética e imaginação social.",
    genres: ["fantasia", "ficção científica", "drama"],
    signals: [
      "sociedade",
      "linguagem",
      "ilha",
      "equilibrio",
      "povo",
      "costume",
      "etica",
      "magia",
    ],
    works: [
      "A Mão Esquerda da Escuridão",
      "O Feiticeiro de Terramar",
      "Os Despossuídos",
    ],
    toneDirections: [
      "fantasia antropológica",
      "ficção social contemplativa",
      "ética e linguagem como conflito",
    ],
  },
  {
    id: "frank_herbert",
    name: "Frank Herbert",
    reason:
      "Ecologia, religião, império, messianismo, política e poder em escala civilizatória.",
    genres: ["ficção científica", "fantasia", "política"],
    signals: [
      "imperio",
      "religião",
      "deserto",
      "ecologia",
      "profecia",
      "messias",
      "poder",
      "familia",
    ],
    works: ["Duna", "O Messias de Duna", "Filhos de Duna"],
    toneDirections: [
      "política messiânica",
      "ecologia como destino",
      "conflito imperial e religioso",
    ],
  },
  {
    id: "george_orwell",
    name: "George Orwell",
    reason:
      "Distopia política, vigilância, linguagem como controle e opressão institucional.",
    genres: ["distopia", "ficção política", "drama"],
    signals: [
      "estado",
      "vigilância",
      "ditadura",
      "controle",
      "propaganda",
      "opressão",
      "revolução",
    ],
    works: ["1984", "A Revolução dos Bichos", "Na Pior em Paris e Londres"],
    toneDirections: [
      "distopia política opressiva",
      "linguagem como controle",
      "instituições esmagando o indivíduo",
    ],
  },
  {
    id: "margaret_atwood",
    name: "Margaret Atwood",
    reason:
      "Distopia íntima, corpo político, controle social e resistência subjetiva.",
    genres: ["distopia", "drama", "ficção política"],
    signals: [
      "mulher",
      "corpo",
      "controle",
      "religião",
      "estado",
      "opressão",
      "fertilidade",
      "resistência",
    ],
    works: ["O Conto da Aia", "Oryx e Crake", "Vulgo Grace"],
    toneDirections: [
      "distopia íntima e política",
      "controle social sobre o corpo",
      "resistência subjetiva",
    ],
  },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function hasAny(source: string, values: string[]) {
  return values.some(value => source.includes(normalize(value)));
}

function detectSignals(source: string) {
  const signalGroups = [
    {
      label: "suspense",
      words: [
        "suspense",
        "mistério",
        "crime",
        "investigação",
        "assassinato",
        "detetive",
      ],
    },
    {
      label: "medieval",
      words: [
        "medieval",
        "reino",
        "castelo",
        "rei",
        "rainha",
        "coroa",
        "feudal",
        "nobreza",
        "cavaleiro",
      ],
    },
    {
      label: "fantasia",
      words: [
        "fantasia",
        "magia",
        "poder",
        "profecia",
        "dragao",
        "elfo",
        "reino",
      ],
    },
    {
      label: "política",
      words: [
        "política",
        "estado",
        "governo",
        "imperio",
        "ditadura",
        "revolução",
        "guerra fria",
        "espionagem",
      ],
    },
    {
      label: "terror",
      words: [
        "terror",
        "horror",
        "monstro",
        "sobrenatural",
        "maldição",
        "assombracao",
        "ritual",
      ],
    },
    {
      label: "distopia",
      words: [
        "distopia",
        "opressão",
        "vigilância",
        "controle",
        "propaganda",
        "regime",
      ],
    },
    {
      label: "psicológico",
      words: [
        "psicológico",
        "obsessão",
        "culpa",
        "trauma",
        "paranoia",
        "identidade",
      ],
    },
  ];
  return signalGroups
    .filter(group => hasAny(source, group.words))
    .map(group => group.label);
}

export function detectLiteraryTaste(input: {
  genre: string;
  description: string;
  tone: string;
  setting: string;
}): LiteraryTasteProfile {
  const source = normalize(
    [input.genre, input.description, input.tone, input.setting]
      .filter(Boolean)
      .join(" ")
  );
  const detectedSignals = detectSignals(source);

  const scored = AUTHOR_CATALOG.map(author => {
    let score = 0;
    if (hasAny(source, author.genres)) score += 2;
    if (hasAny(source, author.signals)) score += 1;
    detectedSignals.forEach(signal => {
      if (
        hasAny(normalize(signal), author.genres) ||
        hasAny(normalize(signal), author.signals)
      )
        score += 1;
    });
    return { author, score };
  })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(item => item.author);

  const authors = scored.length ? scored : AUTHOR_CATALOG.slice(0, 4);
  const works = authors.flatMap(author =>
    author.works.map(title => ({
      id: `${author.id}:${normalize(title).replace(/\s+/g, "_")}`,
      authorId: author.id,
      authorName: author.name,
      title,
    }))
  );

  return {
    detectedSignals,
    authors,
    works,
    toneDirections: unique(
      authors.flatMap(author => author.toneDirections)
    ).slice(0, 10),
  };
}

export function buildToneDirectionOptions(selection: LiteraryTasteSelection) {
  const authorDirections =
    selection.selectedAuthors.flatMap(author =>
      author.toneDirections.map(direction => `${direction} (${author.name})`)
    ) || [];
  return unique([
    ...authorDirections,
    ...(selection.toneDirections || []),
    "mais literário e atmosférico",
    "mais direto, tenso e cinematográfico",
    "mais político e moralmente ambíguo",
    "mais íntimo, psicológico e lento",
  ]).slice(0, 10);
}
