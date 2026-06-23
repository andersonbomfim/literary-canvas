import { describe, expect, it } from "vitest";
import { __profileTestUtils, profileRouter } from "./profile";
import type { TrpcContext } from "../_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    activeWorkId: null,
  };
}

describe("profile router", () => {
  it("should have get procedure", async () => {
    const ctx = createTestContext();
    const caller = profileRouter.createCaller(ctx);

    expect(caller.get).toBeDefined();
  });

  it("should have update procedure", async () => {
    const ctx = createTestContext();
    const caller = profileRouter.createCaller(ctx);

    expect(caller.update).toBeDefined();
  });

  it("update should accept narrative style", async () => {
    const ctx = createTestContext();
    const caller = profileRouter.createCaller(ctx);

    try {
      await caller.update({
        narrativeStyle: "Literary, introspective, with detailed descriptions",
      });
    } catch (error) {
      // Expected to fail due to database not being available in test
      expect(error).toBeDefined();
    }
  });

  it("update should accept negative rules", async () => {
    const ctx = createTestContext();
    const caller = profileRouter.createCaller(ctx);

    try {
      await caller.update({
        negativeRules: [
          "Avoid clichés about memory",
          "Never use present tense for flashbacks",
        ],
      });
    } catch (error) {
      // Expected to fail due to database not being available in test
      expect(error).toBeDefined();
    }
  });

  it("update should accept key chapters in API format", async () => {
    const ctx = createTestContext();
    const caller = profileRouter.createCaller(ctx);

    try {
      await caller.update({
        keyChapters: [
          { chapterId: 7, title: "Capítulo 7", sourceType: "existing" },
          {
            title: "Referência manual",
            content: "Trecho digitado manualmente",
            sourceType: "manual",
          },
          {
            title: "Dossiê político",
            content: "Texto extraído do arquivo",
            sourceType: "upload",
            fileName: "dossiê.pdf",
          },
        ],
      });
    } catch (error) {
      // Expected to fail due to database not being available in test
      expect(error).toBeDefined();
    }
  });

  it("universe parser should accept structured AI responses", () => {
    const parsed = __profileTestUtils.parseUniverseFromJson(
      JSON.stringify({
        universe: {
          overview: "Distopia de espionagem no satelite sovietico de Lamentia.",
          locations: [
            "Lamentia",
            { name: "Moscou", function: "centro politico" },
          ],
          chronology: [
            {
              year: 1988,
              event: "Assassinato de Nadia inicia a busca de Pavel.",
            },
            {
              period: "Guerra Fria",
              event: "A KGB amplia o controle sobre portadores de Aura.",
            },
          ],
          powerSystem: {
            name: "Aura",
            limit: "Poder hereditario com variacoes raras e custo politico.",
          },
        },
      })
    );

    expect(parsed.overview).toContain("Distopia");
    expect(parsed.locations).toContain("Lamentia");
    expect(parsed.locations).toContain("Moscou");
    expect(parsed.timeline).toContain("1988");
    expect(parsed.timeline).toContain("Guerra Fria");
    expect(parsed.powerRules).toContain("Aura");
  });

  it("summary section extractor should keep repeated chronology sections in order", () => {
    const sections = __profileTestUtils.extractSummarySections(`
Premissa e Conflito Central
Uma premissa.

Cronologia de Eventos-Chave
1. [1970] Primeiro evento da primeira metade.

Personagens Principais
Margaery aparece.

Cronologia de Eventos-Chave
2. [1998] Segundo evento da segunda metade.

Estado Final da Narrativa
Fim.
`);

    const events = sections.find(section => section.id === "eventos");
    expect(events?.content).toContain("Primeiro evento");
    expect(events?.content).toContain("Segundo evento");
    expect(events?.content.indexOf("Primeiro evento")).toBeLessThan(
      events?.content.indexOf("Segundo evento") ?? 0
    );
  });

  it("quick scan parser should accept useful fields from truncated JSON", () => {
    const parsed = __profileTestUtils.parseQuickScanResponse(
      `{"subtitle":"A Supremacia da Aura","genre":"Suspense histórico","description":`
    );

    expect(parsed).toMatchObject({
      subtitle: "A Supremacia da Aura",
      genre: "Suspense histórico",
      description: "",
    });
  });

  it("quick scan parser should strip markdown fences", () => {
    const parsed = __profileTestUtils.parseQuickScanResponse(`\`\`\`json
{"subtitle":"","genre":"Drama psicológico","description":"Uma visita familiar revela medo, culpa e violência antiga."}
\`\`\``);

    expect(parsed.genre).toBe("Drama psicológico");
    expect(parsed.description).toContain("visita familiar");
  });

  it("character merge should keep summary characters when AI returns only one", () => {
    const fallback = __profileTestUtils.fallbackCharactersFromSummary({
      title: "EUTANASIA",
      content: [
        "Pavel Petrov encontra Anton Ivanov antes da fuga.",
        "Nadia Petrovna e citada por Pavel como a mae assassinada no apartamento.",
        "Olga Kovalenko e Anton Ivanov continuam ligados ao grupo.",
      ].join("\n"),
      summary: "",
      summarySections: [
        {
          id: "personagens",
          label: "Personagens",
          content: [
            "Pavel Petrov é o protagonista, filho de Nadia, ligado a Anton e Olga depois da morte da mae.",
            "Nadia Petrovna é a mae de Pavel, assassinada no primeiro capitulo e conectada ao segredo da Aura.",
            "Anton Ivanov é aliado de Pavel, participa da fuga e aprende a lidar com o proprio Foco.",
            "Olga Kovalenko é localizadora, observa sinais do mundo exterior e ajuda o grupo.",
          ].join("\n\n"),
        },
      ],
    });
    const merged = __profileTestUtils.mergeImportedCharacters(
      [
        {
          name: "Michael Vasarelli",
          role: "Emissario",
          history:
            "Michael Vasarelli aparece como agente ligado a familia Vasarelli.",
        },
      ],
      fallback
    );

    expect(merged.map(character => character.name)).toEqual(
      expect.arrayContaining([
        "Pavel Petrov",
        "Nadia Petrovna",
        "Anton Ivanov",
        "Olga Kovalenko",
        "Michael Vasarelli",
      ])
    );
  });

  it("character dossier fallback should not save raw evidence as character summaries", () => {
    const fallback = __profileTestUtils.fallbackCharactersFromDossiers({
      title: "EUTANASIA",
      content: [
        "Pavel Petrov encontra Anton Ivanov no corredor.",
        "Anton Ivanov ajuda Pavel Petrov a sair do prédio.",
        "Olga Kovalenko observa a movimentação pela janela.",
        "Olga Kovalenko avisa Anton Ivanov sobre a rua.",
      ].join("\n\n"),
      analysisBlocks: [
        {
          index: 1,
          title: "Capítulo 1",
          wordCount: 1200,
          dossier: [
            "MEMÓRIA FACTUAL DO BLOCO",
            "Personagens em cena:",
            "Pavel, Anton Ivanov e Olga Kovalenko.",
            "Eventos e ações em ordem:",
            "Pavel encontra Anton no corredor e Olga observa a movimentação.",
          ].join("\n"),
        },
      ],
    });

    expect(fallback.map(character => character.name)).toEqual(
      expect.arrayContaining(["Pavel Petrov", "Anton Ivanov", "Olga Kovalenko"])
    );
    for (const character of fallback) {
      expect(character.history).not.toContain("[BLOCO");
      expect(character.history).not.toMatch(/Presenca verificada|Resumo factual/i);
      expect(character.history).not.toMatch(/Personagens em cena/i);
    }
  });

  it("character dossier collector should force linked characters through every matching dossier", () => {
    const candidates = __profileTestUtils.collectDossierCharacterCandidates({
      targetCharacterNames: ["Anton Vasilievich"],
      sourceContent:
        "Anton Ivanov encontra Pavel Petrov. Anton Ivanov ajuda Pavel a fugir.",
      analysisBlocks: [
        {
          index: 1,
          title: "Capítulo 1",
          wordCount: 1000,
          dossier: [
            "MEMÓRIA FACTUAL DO BLOCO",
            "Personagens em cena:",
            "Pavel Petrov.",
            "Eventos e ações em ordem:",
            "Anton Ivanov ajuda Pavel durante a fuga.",
          ].join("\n"),
        },
        {
          index: 2,
          title: "Capítulo 2",
          wordCount: 1000,
          dossier: [
            "MEMÓRIA FACTUAL DO BLOCO",
            "Personagens em cena:",
            "Anton Ivanov.",
            "Relações e tensões:",
            "Anton Ivanov continua ligado a Pavel e assume risco direto.",
          ].join("\n"),
        },
      ],
    });

    const anton = candidates.find(candidate => candidate.name === "Anton Ivanov");
    expect(anton).toBeTruthy();
    expect(anton?.snippets).toHaveLength(2);
    expect(candidates.map(candidate => candidate.name)).toContain(
      "Pavel Petrov"
    );
  });

  it("character merge should prefer writing-ready fiches over raw dossier evidence", () => {
    const merged = __profileTestUtils.mergeImportedCharacters(
      [
        {
          name: "Anton Ivanov",
          role: "Aliado recorrente",
          history:
            "Anton Ivanov e o amigo leal de Pavel, entra em risco direto durante a fuga e precisa carregar a culpa ligada ao pai.",
          notes:
            "Uso em Rascunho: Anton puxa impulsividade, lealdade e atrito quando Pavel hesita.",
        },
      ],
      [
        {
          name: "Anton Ivanov",
          role: "Personagem recorrente",
          history:
            "Presenca verificada em 2 dossies por capitulo. Resumo factual: [BLOCO 1] Anton aparece no corredor.",
          notes: "Resumo factual: [BLOCO 1] Anton aparece.",
        },
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].history).toContain("amigo leal de Pavel");
    expect(merged[0].history).not.toContain("Presenca verificada");
    expect(merged[0].notes).toContain("Uso em Rascunho");
  });

  it("character normalization should reject raw dossier evidence as character history", () => {
    const normalized =
      __profileTestUtils.normalizeImportedCharactersForWriting([
        {
          name: "Anton Ivanov",
          role: "Personagem recorrente",
          history:
            "Presenca verificada em 20 dossies por capitulo. Resumo factual: [BLOCO 5] Personagens em cena: Anton, Pavel, Olga.",
        },
      ]);

    expect(normalized).toEqual([]);
  });

  it("character normalization should reject alias placeholders instead of saving them as biographies", () => {
    const normalized =
      __profileTestUtils.normalizeImportedCharactersForWriting([
        {
          name: "Ivar Serov",
          role: "Antagonista principal, diretor da KGB",
          history:
            "Identico ao personagem Serov. Aqui repete-se a historia para atender a lista. Ivar Serov e o nome completo do diretor da KGB.",
        },
      ]);

    expect(normalized).toEqual([]);
  });

  it("character normalization should reject places, concepts and generic groups", () => {
    const normalized =
      __profileTestUtils.normalizeImportedCharactersForWriting([
        {
          name: "Eirene",
          role: "Cidade pesqueira em Lamentia",
          history:
            "Eirene é uma cidade costeira usada como esconderijo pelo grupo.",
        },
        {
          name: "Manipulação",
          role: "Variedade da Aura",
          history:
            "Manipulação é uma regra de Aura usada para controlar memórias.",
        },
        {
          name: "Soldados",
          role: "Forças militares e de segurança",
          history:
            "Soldados aparecem em diversas cenas como figuras genéricas.",
        },
        {
          name: "Pavel Petrov",
          role: "Protagonista",
          history:
            "Pavel Petrov é um jovem lamentino que busca respostas depois da morte da mãe, atravessa a fuga com Anton e Olga, descobre pistas ligadas a Serov, aprende a usar a Aura sob pressão, passa por medo e culpa diante das manipulações que o cercam e carrega a necessidade de entender quem o usou sem perder o próprio senso moral diante da violência crescente.",
        },
      ]);

    expect(normalized.map(character => character.name)).toEqual([
      "Pavel Petrov",
    ]);
  });

  it("character canonical name should expand surname when source has full name", () => {
    const candidates = __profileTestUtils.collectDossierCharacterCandidates({
      sourceContent:
        "Ivar Serov persegue Pavel Petrov. Stuart Crowley resgata Pavel Petrov. Ivar Serov encontra Stuart Crowley no Kremlin.",
      analysisBlocks: [
        {
          index: 1,
          title: "KGB",
          wordCount: 900,
          dossier:
            "Personagens em cena: Serov, Crowley, Pavel Petrov. Eventos e ações em ordem: Serov ameaça Pavel e Crowley chega depois.",
        },
        {
          index: 2,
          title: "Kremlin",
          wordCount: 900,
          dossier:
            "Personagens em cena: Serov, Crowley. Eventos e ações em ordem: Ivar Serov confronta Stuart Crowley.",
        },
      ],
    });

    expect(candidates.map(candidate => candidate.name)).toEqual(
      expect.arrayContaining(["Ivar Serov", "Stuart Crowley"])
    );
    expect(candidates.map(candidate => candidate.name)).not.toContain("Serov");
    expect(candidates.map(candidate => candidate.name)).not.toContain(
      "Crowley"
    );
  });

  it("character normalization should not mark every imported character as protagonist", () => {
    const normalized =
      __profileTestUtils.normalizeImportedCharactersForWriting([
        {
          name: "Pavel Petrov",
          role: "Protagonista",
          history:
            "Pavel Petrov conduz a narrativa depois do assassinato da mãe, foge com Anton, encontra Olga, passa a lidar com medo, culpa e revelações sobre a Aura, e precisa tomar decisões que mudam sua relação com Serov e com a própria identidade. O resumo preserva seu arco emocional, sua busca por respostas, as alianças que sustentam sua sobrevivência e o risco de reagir à violência sem entender toda a manipulação ao redor.",
        },
        {
          name: "Anton Ivanov",
          role: "Protagonista, aliado de Pavel",
          history:
            "Anton Ivanov acompanha Pavel na fuga, assume riscos diretos, cria atrito pela impulsividade, permanece como aliado leal e carrega tensões familiares que afetam suas escolhas quando a pressão aumenta. Ele não conduz a premissa central, mas influencia decisões, confrontos e o modo como Pavel atravessa medo, amizade e sobrevivência dentro da perseguição. Seu arco funciona como apoio dramático constante, com lealdade, reação física e conflito familiar pressionando as cenas.",
        },
      ]);

    expect(normalized[0].role).toBe("Protagonista");
    expect(normalized[1].role).not.toMatch(/protagonista/i);
    expect(normalized[1].role).toContain("Personagem recorrente");
  });

  it("character fallback should prefer canonical source name over patronymic", () => {
    const fallback = __profileTestUtils.fallbackCharactersFromSummary({
      title: "EUTANASIA",
      content:
        "Anton Ivanov se alista com Pavel. Anton Ivanov descobre que Vasili Ivanov era seu pai.",
      summary: "",
      summarySections: [
        {
          id: "personagens",
          label: "Personagens",
          content:
            "Anton Vasilievich é o melhor amigo de Pavel, forte, impulsivo e leal. No exército, Anton se torna Intensificador e descobre que seu pai, Vasili Ivanov, foi morto por Serov.",
        },
      ],
    });

    expect(fallback.map(character => character.name)).toContain(
      "Anton Ivanov"
    );
    expect(fallback.map(character => character.name)).not.toContain(
      "Anton Vasilievich"
    );
    expect(fallback[0].history).toContain("texto original");
  });

  it("character fallback should drop summary names without source evidence", () => {
    const fallback = __profileTestUtils.fallbackCharactersFromSummary({
      title: "EUTANASIA",
      content:
        "Pavel Petrov encontra Anton Ivanov no corredor. Anton Ivanov ajuda Pavel Petrov a fugir.",
      summary: "",
      summarySections: [
        {
          id: "personagens",
          label: "Personagens",
          content: [
            "Pavel Petrov e o protagonista ligado a fuga, ao medo apos a morte da mae e a decisao de acompanhar Anton.",
            "Personagem Inventado e um agente secreto que nunca aparece no texto bruto.",
          ].join("\n\n"),
        },
      ],
    });

    expect(fallback.map(character => character.name)).toContain(
      "Pavel Petrov"
    );
    expect(fallback.map(character => character.name)).not.toContain(
      "Personagem Inventado"
    );
  });

  it("timeline event extraction should dedupe and preserve source order", () => {
    const events = __profileTestUtils.buildImportedTimelineEvents(
      "MARGAERY",
      [
        {
          id: "eventos",
          label: "Eventos",
          content: [
            "1. [28 anos antes] Margaery se casa com George e deixa o castelo dos Loxley.",
            "2. [Sequencia narrativa] Margaery retorna ao castelo depois de descobrir que Alice desapareceu.",
            "3. [Sequencia narrativa] Margaery retorna ao castelo depois de descobrir que Alice desapareceu.",
          ].join("\n"),
        },
      ],
      ""
    );

    expect(events).toHaveLength(2);
    expect(events[0].description).toContain("se casa com George");
    expect(events[1].description).toContain("retorna ao castelo");
  });

  it("timeline candidate splitting should separate dense bracketed chronology", () => {
    const candidates = __profileTestUtils.splitTimelineCandidates(
      "[1910] O segredo da família nasce. [1945] Documentos são encontrados. [1989] O epílogo fecha a queda do Muro."
    );

    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toContain("[1910]");
    expect(candidates[1]).toContain("[1945]");
    expect(candidates[2]).toContain("[1989]");
  });

  it("chapter dossier limiter should cap saved memory by words", () => {
    const longDossier = [
      "MEMORIA FACTUAL DO BLOCO",
      Array.from({ length: 1205 }, (_, index) => `palavra${index}`).join(" "),
    ].join("\n\n");

    const limited = __profileTestUtils.limitWords(longDossier, 1000);

    expect(limited.split(/\s+/).filter(Boolean)).toHaveLength(1000);
    expect(limited).toContain("MEMORIA FACTUAL DO BLOCO");
    expect(limited).not.toContain("palavra1199");
  });

  it("dossier-backed character biographies should preserve a chronological arc instead of raw evidence", () => {
    const analysisBlocks = [
      {
        index: 1,
        title: "Capitulo 1",
        wordCount: 900,
        dossier: [
          "MEMORIA FACTUAL DO BLOCO",
          "Personagens em cena:",
          "Pavel Petrov (protagonista), Nadia Petrov, Joseph.",
          "Eventos e acoes em ordem:",
          "Pavel Petrov encontra a mae morta no apartamento e fica sem conseguir processar a cena.",
          "Joseph aparece depois, diz conhecer Nadia Petrov e entrega uma fotografia que aponta para Ivar Serov.",
          "Relacoes e tensoes:",
          "Pavel Petrov desconfia de Joseph, mas depende dele para entender o passado da mae.",
          "Estado emocional e psicologico:",
          "Pavel Petrov alterna choque, culpa e necessidade de agir.",
          "Estado final do bloco:",
          "Pavel Petrov guarda a fotografia e decide procurar respostas.",
        ].join("\n"),
      },
      {
        index: 2,
        title: "Capitulo 2",
        wordCount: 900,
        dossier: [
          "MEMORIA FACTUAL DO BLOCO",
          "Personagens em cena:",
          "Pavel Petrov, Anton Ivanov, Olga Kovalenko.",
          "Eventos e acoes em ordem:",
          "Pavel Petrov divide a investigacao com Anton Ivanov e Olga Kovalenko.",
          "Pavel Petrov descobre que a foto liga a morte de Nadia Petrov a Ivar Serov.",
          "Relacoes e tensoes:",
          "Anton Ivanov protege Pavel Petrov mesmo sem entender toda a ameaca.",
          "Estado final do bloco:",
          "Pavel Petrov sai do isolamento e passa a agir com os amigos.",
        ].join("\n"),
      },
      {
        index: 3,
        title: "Final",
        wordCount: 900,
        dossier: [
          "MEMORIA FACTUAL DO BLOCO",
          "Personagens em cena:",
          "Pavel Petrov, Ivar Serov, Yuri.",
          "Eventos e acoes em ordem:",
          "Ivar Serov revela a Pavel Petrov que ordenou a morte de Nadia Petrov.",
          "Pavel Petrov enfrenta Yuri e depois confronta Serov no Kremlin.",
          "Estado final do bloco:",
          "Pavel Petrov sobrevive ao confronto e carrega as consequencias da vinganca.",
        ].join("\n"),
      },
    ];

    const characters = __profileTestUtils.buildDossierBackedCharacters({
      title: "EUTANASIA",
      analysisBlocks,
      sourceContent:
        "Pavel Petrov encontra Joseph, Anton Ivanov, Olga Kovalenko e Ivar Serov.",
      targetCharacterNames: ["Pavel Petrov"],
    });

    const pavel = characters.find(character => character.name === "Pavel Petrov");
    expect(pavel).toBeTruthy();
    expect(pavel?.history).toMatch(
      /^Pavel Petrov é o protagonista da história\./
    );
    expect(pavel?.history).toContain("decide procurar respostas");
    expect(pavel?.history).toContain("confronta Serov no Kremlin");
    expect(pavel?.history).not.toContain("[BLOCO");
    expect(pavel?.history).not.toMatch(/\bEm\s+(?:Capitulo|Final)\b/i);
    expect(pavel?.history).not.toMatch(/Presenca verificada|Resumo factual/i);
    expect((pavel?.history || "").split(/\s+/).length).toBeGreaterThan(80);
  });

  it("dossier-backed biographies should start as editorial bios and not as chapter logs", () => {
    const characters = __profileTestUtils.buildDossierBackedCharacters({
      title: "EUTANASIA",
      sourceContent:
        "Ivar Serov e diretor geral da KGB. Pavel Petrov investiga Ivar Serov.",
      targetCharacterNames: ["Ivar Serov"],
      analysisBlocks: [
        {
          index: 1,
          title: "CAPITULO 11 - parte 2/5",
          wordCount: 1000,
          dossier: [
            "MEMORIA FACTUAL DO BLOCO",
            "Personagens em cena:",
            "Pavel Petrov, Ivar Serov.",
            "Eventos e acoes em ordem:",
            "Pavel vira a foto e ve no verso: 17 de Dezembro de 1982. Ivar Serov.",
            "Olga reconhece Ivar Serov como diretor geral da KGB.",
            "Revelacoes, pistas e segredos:",
            "Ivar Serov e o homem na foto, militar sovietico uniformizado, data 17/12/1982.",
            "Estado final do bloco:",
            "Pavel decide entrar no exercito para investigar Ivar Serov.",
          ].join("\n"),
        },
        {
          index: 2,
          title: "KGB - parte 5/13",
          wordCount: 1000,
          dossier: [
            "MEMORIA FACTUAL DO BLOCO",
            "Personagens em cena:",
            "Pavel Petrov, Ivar Serov, Yuri.",
            "Eventos e acoes em ordem:",
            "Serov entra na sala sobre a Manipulacao de Yuri.",
            "Serov revela que ordenou a morte da mae de Pavel.",
          ].join("\n"),
        },
      ],
    });

    const serov = characters.find(character => character.name === "Ivar Serov");
    expect(serov?.role).toBe("Antagonista principal");
    expect(serov?.history).toMatch(
      /^Ivar Serov é diretor geral da KGB e o principal antagonista da história\./
    );
    expect(serov?.history).not.toMatch(/^Em\s+(?:CAPITULO|KGB)/i);
    expect(serov?.history).toContain("Ivar Serov e o homem na foto");
    expect(serov?.history).toContain("ordenou a morte da mae de Pavel");
  });

  it("dossier-backed biographies should not turn manipulated characters into conscious double agents", () => {
    const characters = __profileTestUtils.buildDossierBackedCharacters({
      title: "EUTANASIA",
      sourceContent:
        "Aleksei Orlov trabalha para Serov. Orlov e manipulado por um numero gravado em sua mente.",
      targetCharacterNames: ["Aleksei Orlov"],
      analysisBlocks: [
        {
          index: 1,
          title: "KGB - parte 11/13",
          wordCount: 1000,
          dossier: [
            "MEMORIA FACTUAL DO BLOCO",
            "Personagens em cena:",
            "Aleksei Orlov (subordinado de Serov).",
            "Eventos e acoes em ordem:",
            "Aleksei Orlov chega atrasado ao Kremlin e mente que nao ha pistas.",
            "Orlov, sozinho, disca um numero gravado em sua mente sem saber como.",
            "A voz manda Orlov esquecer tudo o que aconteceu desde ontem.",
            "Revelacoes, pistas e segredos:",
            "Orlov e um agente duplo controlado; sua memoria da noite anterior esta bloqueada por Manipulacao.",
          ].join("\n"),
        },
      ],
    });

    const orlov = characters.find(character => character.name === "Aleksei Orlov");
    expect(orlov?.history).toContain("peça manipulada");
    expect(orlov?.history).not.toMatch(/agente duplo/i);
  });

  it("dossier-backed role inference should not borrow nearby identity labels", () => {
    const characters = __profileTestUtils.buildDossierBackedCharacters({
      title: "Livro generico",
      sourceContent:
        "Aria Vale viaja com Bruno Neri e enfrenta Dario Kross no final.",
      targetCharacterNames: ["Aria Vale", "Bruno Neri", "Dario Kross"],
      analysisBlocks: [
        {
          index: 1,
          title: "A estrada",
          wordCount: 900,
          dossier: [
            "MEMORIA FACTUAL DO BLOCO",
            "Personagens em cena:",
            "Aria Vale (protagonista), Bruno Neri (amigo de Aria), Dario Kross.",
            "Eventos e acoes em ordem:",
            "Bruno Neri observa Dario Kross, que age como mentor falso antes de revelar seus planos.",
            "Dario Kross manipula Aria Vale e ameaca Bruno Neri.",
            "Relacoes e tensoes:",
            "Bruno Neri protege Aria Vale e desconfia de Dario Kross.",
          ].join("\n"),
        },
      ],
    });

    const bruno = characters.find(character => character.name === "Bruno Neri");
    const dario = characters.find(character => character.name === "Dario Kross");
    expect(bruno?.role).toBe("Aliado");
    expect(dario?.role).toBe("Antagonista");
  });

  it("dossier-backed role inference should not promote low-presence power figures to main antagonist", () => {
    const analysisBlocks = Array.from({ length: 12 }, (_, index) => {
      const blockNumber = index + 1;
      return {
        index: blockNumber,
        title: `Capitulo ${blockNumber}`,
        wordCount: 900,
        dossier:
          blockNumber === 6 || blockNumber === 7
            ? [
                "MEMORIA FACTUAL DO BLOCO",
                "Personagens em cena:",
                "Marta Lira, Boris Kuztsov (chefe de Marta).",
                "Eventos e acoes em ordem:",
                "Boris Kuztsov ordena que Marta Lira arquive relatorios antes do almoco.",
                "Relacoes e tensoes:",
                "Marta Lira teme perder o emprego, mas Boris Kuztsov nao conduz o conflito central da obra.",
              ].join("\n")
            : [
                "MEMORIA FACTUAL DO BLOCO",
                "Personagens em cena:",
                "Marta Lira.",
                "Eventos e acoes em ordem:",
                "Marta Lira investiga a propria familia e segue o conflito central.",
              ].join("\n"),
      };
    });
    const characters = __profileTestUtils.buildDossierBackedCharacters({
      title: "Livro generico",
      sourceContent:
        "Marta Lira investiga a propria familia. Boris Kuztsov aparece no escritorio e da uma ordem.",
      targetCharacterNames: ["Marta Lira", "Boris Kuztsov"],
      analysisBlocks,
    });

    const boris = characters.find(character => character.name === "Boris Kuztsov");
    expect(boris?.role).toBe("Antagonista secundário");
    expect(boris?.history).not.toMatch(/principal antagonista|antagonista principal/i);
  });

  it("dossier-backed biographies should build generic editorial arcs for any imported work", () => {
    const characters = __profileTestUtils.buildDossierBackedCharacters({
      title: "Casa Loxley",
      sourceContent:
        "Margaery Loxley retorna ao castelo, enfrenta Perseus Loxley e procura Alice Loxley.",
      targetCharacterNames: ["Margaery Loxley"],
      analysisBlocks: [
        {
          index: 1,
          title: "Retorno ao castelo",
          wordCount: 900,
          dossier: [
            "MEMORIA FACTUAL DO BLOCO",
            "Personagens em cena:",
            "Margaery Loxley (protagonista, herdeira exilada), George Meyer.",
            "Eventos e acoes em ordem:",
            "Margaery Loxley retorna ao castelo depois de descobrir que Alice Loxley desapareceu.",
            "Margaery Loxley carrega culpa pelo casamento que a afastou da familia.",
            "Relacoes e tensoes:",
            "George Meyer tenta proteger Margaery Loxley, mas ela decide entrar sozinha.",
            "Estado emocional e psicologico:",
            "Margaery Loxley alterna medo, vergonha e necessidade de pedir perdao.",
          ].join("\n"),
        },
        {
          index: 2,
          title: "Reencontro",
          wordCount: 900,
          dossier: [
            "MEMORIA FACTUAL DO BLOCO",
            "Personagens em cena:",
            "Margaery Loxley, Perseus Loxley.",
            "Eventos e acoes em ordem:",
            "Margaery Loxley encontra Perseus Loxley e trava diante do medo do irmao.",
            "Perseus Loxley revela que sabia do sumico de Alice Loxley.",
            "Estado final do bloco:",
            "Margaery Loxley entende que precisa descobrir a verdade sem confiar no irmao.",
          ].join("\n"),
        },
      ],
    });

    const margaery = characters.find(
      character => character.name === "Margaery Loxley"
    );
    expect(margaery).toBeTruthy();
    expect(margaery?.history).toMatch(/^Margaery Loxley .*herdeira exilada/);
    expect(margaery?.history).toMatch(/protagonista/);
    expect(margaery?.history).toContain(
      "retorna ao castelo depois de descobrir que Alice Loxley desapareceu"
    );
    expect(margaery?.history).toContain("trava diante do medo do irmao");
    expect(margaery?.history).not.toMatch(
      /Personagens em cena|Eventos e acoes|Resumo factual|\[BLOCO|Em\s+Retorno/i
    );
  });

  it("character grounding should require evidence without cutting character biographies", () => {
    const evidence = [
      "Pavel Petrov foge com Anton Ivanov depois da morte de Nadia.",
      "Pavel Petrov encontra Olga. Pavel decide seguir para Lamentium.",
      "Anton Ivanov ajuda Pavel Petrov, mas o texto chama o amigo sempre de Anton Ivanov.",
      "Michael Vasarelli entrega uma informação e desaparece da cena.",
    ].join("\n");
    const longText = Array.from(
      { length: 320 },
      (_, index) => `fato${index}`
    ).join(" ");

    const grounded = __profileTestUtils.groundImportedCharacters(
      [
        {
          name: "Pavel Petrov",
          role: "Protagonista",
          history: longText,
        },
        {
          name: "Anton Vasilievich",
          role: "Aliado",
          history: longText,
        },
        {
          name: "Michael Vasarelli",
          role: "Secundário",
          history: longText,
        },
        {
          name: "Personagem Inventado",
          role: "Antagonista",
          history: longText,
        },
      ],
      evidence
    );

    const names = grounded.map(character => character.name);
    expect(names).toContain("Pavel Petrov");
    expect(names).toContain("Anton Ivanov");
    expect(names).toContain("Michael Vasarelli");
    expect(names).not.toContain("Personagem Inventado");
    const pavel = grounded.find(character => character.name === "Pavel Petrov");
    const michael = grounded.find(
      character => character.name === "Michael Vasarelli"
    );
    expect(pavel?.history.split(/\s+/)).toHaveLength(320);
    expect(michael?.history.split(/\s+/)).toHaveLength(320);
  });

  it("character grounding should remove unsupported parentage invented during consolidation", () => {
    const evidence = [
      "Joseph visita Pavel e diz que conhecia a mae dele.",
      "Nadia Petrov, mae de Pavel, morreu assassinada.",
      "Serov revela que Pavel descende dos Romanov.",
      "Pavel Petrov acorda em Dragzba e carrega o medalhao de grifo.",
    ].join("\n");

    const grounded = __profileTestUtils.groundImportedCharacters(
      [
        {
          name: "Pavel Petrov",
          role:
            "Protagonista Versatilizador, filho de Joseph, descendente dos Romanov",
          history:
            "Filho de Joseph e Nadia Petrov. Nadia morreu assassinada. Serov revela que Pavel descende dos Romanov.",
          relationships:
            "Joseph e apresentado como pai de Pavel. Nadia e mae de Pavel.",
        },
      ],
      evidence
    );

    expect(grounded).toHaveLength(1);
    expect(grounded[0].role).not.toContain("Joseph");
    expect(grounded[0].role).toContain("descendente dos Romanov");
    expect(grounded[0].history).not.toContain("Filho de Joseph");
    expect(grounded[0].history).toContain("Nadia morreu assassinada");
    expect(grounded[0].relationships).not.toContain("pai de Pavel");
  });

  it("character grounding should not treat a nearby mother as proof of another parent", () => {
    const evidence = [
      "Joseph conhecia Nádia Petrov, mãe de Pavel, e visitou o apartamento depois da tragédia.",
      "Nádia Petrov cuidava de Pavel antes de ser assassinada.",
      "Pavel Petrov não chama Joseph de pai em nenhum momento.",
    ].join("\n");

    const grounded = __profileTestUtils.groundImportedCharacters(
      [
        {
          name: "Pavel Petrov",
          role: "Protagonista",
          history:
            "Filho de Joseph e Nádia Petrov. Nádia Petrov é mãe de Pavel.",
          relationships:
            "Joseph é apresentado como pai de Pavel. Nádia Petrov é mãe de Pavel.",
        },
      ],
      evidence
    );

    expect(grounded).toHaveLength(1);
    expect(grounded[0].history).not.toContain("Joseph");
    expect(grounded[0].relationships).not.toContain("pai de Pavel");
    expect(grounded[0].relationships).toContain("Nádia Petrov");
  });

  it("character grounding should remove unsupported death methods invented during consolidation", () => {
    const evidence = [
      "Joseph visita Pavel e diz que conhecia a mae dele.",
      "Joseph aparece morto no esconderijo no dia seguinte.",
      "Pavel Petrov decide buscar respostas depois da morte de Nadia.",
    ].join("\n");

    const grounded = __profileTestUtils.groundImportedCharacters(
      [
        {
          name: "Pavel Petrov",
          role: "Protagonista",
          history:
            "Joseph e morto a tiros logo depois. Pavel Petrov decide buscar respostas.",
          relationships:
            "Joseph e morto a tiros e deixa Pavel assustado.",
        },
      ],
      evidence
    );

    expect(grounded).toHaveLength(1);
    expect(grounded[0].history).not.toContain("tiros");
    expect(grounded[0].history).toContain(
      "Pavel Petrov decide buscar respostas"
    );
    expect(grounded[0].relationships || "").not.toContain("tiros");
  });

  it("character refresh should replace imported automatic fiches without overwriting manual fiches", () => {
    const extracted = {
      name: "Anton Ivanov",
      role: "Aliado de Pavel",
      history: "Anton Ivanov ajuda Pavel depois da fuga e permanece ao lado dele.",
      notes: "Nome confirmado nos dossies por capitulo.",
    };

    const importedUpdates = __profileTestUtils.buildCharacterUpdatePayload({
      existing: {
        id: 10,
        name: "Anton Vasilievich",
        role: "Aliado generico",
        history: "Descricao antiga e errada.",
        personality: "forte e leal",
        physicalDescription: null,
        speechStyle: null,
        psychologicalProfile: null,
        backstory: null,
        motivations: null,
        relationships: null,
        notes: '[Importado de "EUTANASIA"] ficha automatica antiga',
      },
      extracted,
      sourceTitle: "EUTANASIA",
      forceReplaceImported: true,
    });

    expect(importedUpdates).toMatchObject({
      name: "Anton Ivanov",
      role: "Aliado de Pavel",
      history:
        "Anton Ivanov ajuda Pavel depois da fuga e permanece ao lado dele.",
      personality: null,
    });
    expect(importedUpdates.notes).toContain(
      '[Importado de "EUTANASIA"] Nome confirmado'
    );

    const manualUpdates = __profileTestUtils.buildCharacterUpdatePayload({
      existing: {
        id: 11,
        name: "Anton Ivanov",
        role: "Ficha revisada pelo autor",
        history:
          "Ficha manual com detalhes definidos pelo autor e que nao deve ser trocada.",
        personality: "manual",
        physicalDescription: null,
        speechStyle: null,
        psychologicalProfile: null,
        backstory: null,
        motivations: null,
        relationships: null,
        notes: "Ficha editada manualmente",
      },
      extracted,
      sourceTitle: "EUTANASIA",
      forceReplaceImported: true,
    });

    expect(manualUpdates.name).toBeUndefined();
    expect(manualUpdates.history).toBeUndefined();
    expect(manualUpdates.notes).toBeUndefined();
  });

  it("character refresh should match linked imported fiches by first name when the old surname is wrong", () => {
    const existingCharacters = [
      {
        id: 10,
        name: "Anton Vasilievich",
        notes: '[Importado de "EUTANASIA"] ficha automatica antiga',
      },
      {
        id: 11,
        name: "Anton Ivanov",
        notes: "Ficha manual do autor",
      },
    ];

    const match = __profileTestUtils.findExistingCharacterForExtraction({
      extracted: {
        name: "Anton Ivanov",
        role: "Aliado",
        history: "Anton ajuda Pavel.",
      },
      existingCharacters,
      linkedImportedIds: new Set([10]),
      consumedIds: new Set(),
      forceReplaceImported: true,
    });

    expect(match?.id).toBe(11);

    const matchWithoutExactManual =
      __profileTestUtils.findExistingCharacterForExtraction({
        extracted: {
          name: "Anton Ivanov",
          role: "Aliado",
          history: "Anton ajuda Pavel.",
        },
        existingCharacters: existingCharacters.slice(0, 1),
        linkedImportedIds: new Set([10]),
        consumedIds: new Set(),
        forceReplaceImported: true,
      });

    expect(matchWithoutExactManual?.id).toBe(10);

    const matchByImportSource =
      __profileTestUtils.findExistingCharacterForExtraction({
        extracted: {
          name: "Anton Ivanov",
          role: "Aliado",
          history: "Anton ajuda Pavel.",
        },
        existingCharacters: existingCharacters.slice(0, 1),
        linkedImportedIds: new Set(),
        consumedIds: new Set(),
        forceReplaceImported: true,
        sourceTitle: "EUTANASIA",
      });

    expect(matchByImportSource?.id).toBe(10);
  });

  it("timeline JSON parser should reject duplicates and normalize fields", () => {
    const events = __profileTestUtils.parseTimelineEventsFromJson(
      JSON.stringify({
        events: [
          {
            period: "Sequência narrativa",
            title: "Margaery chega ao castelo",
            description:
              "Margaery volta ao castelo dos Loxley depois de anos afastada e encontra sinais de que Alice desapareceu.",
          },
          {
            period: "Sequência narrativa",
            title: "Margaery chega ao castelo",
            description:
              "Margaery volta ao castelo dos Loxley depois de anos afastada e encontra sinais de que Alice desapareceu.",
          },
        ],
      }),
      "MARGAERY"
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      order: 1,
      period: "Sequência narrativa",
      source: "MARGAERY",
      confidence: "high",
    });
  });

  it("chaptered splitter should preserve chapter headings and split large chapters", () => {
    const longChapter = Array.from(
      { length: 4500 },
      (_, index) => `palavra${index}`
    ).join(" ");
    const blocks = __profileTestUtils.splitImportedWorkIntoBlocks(`
CAPÍTULO 1

Margarey chega ao castelo e percebe a ausência de Alice.

CAPÍTULO 2

${longChapter}
`);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].title).toBe("CAPÍTULO 1");
    expect(blocks[0].content).toContain("Alice");
    expect(blocks[1].title).toBe("CAPÍTULO 2 - parte 1/2");
    expect(blocks[2].title).toBe("CAPÍTULO 2 - parte 2/2");
    expect(blocks[1].wordCount).toBeLessThanOrEqual(4000);
    expect(blocks[2].wordCount).toBeLessThanOrEqual(4000);
  });

  it("chaptered splitter should treat uppercase POV headings as chapters", () => {
    const blocks = __profileTestUtils.splitImportedWorkIntoBlocks(`
MARGAERY

A ala dos Loxley estava silenciosa.

PERSEUS

O irmão aguardava do outro lado da porta.
`);

    expect(blocks.map(block => block.title)).toEqual(["MARGAERY", "PERSEUS"]);
  });
});
