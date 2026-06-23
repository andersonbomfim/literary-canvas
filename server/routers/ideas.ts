import { UserVisibleError } from "@shared/_core/errors";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { chargeCredits, grantCredits } from "../db";
import { buildStyleCalibrationOptions } from "../_core/styleRepertoire";
import {
  escapePromptInjection,
  PROMPT_HARDENING_CLAUSE,
} from "../_core/promptSanitize";

const IDEA_QUESTION_COST = 2;
const IDEA_PROPOSAL_COST = 5;
const IDEA_REPERTOIRE_COST = 1;

const literaryTasteSchema = z
  .object({
    detectedSignals: z.array(z.string()).optional(),
    selectedAuthors: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string(),
          reason: z.string().optional(),
          works: z.array(z.string()).optional(),
          toneDirections: z.array(z.string()).optional(),
        })
      )
      .optional(),
    selectedWorks: z
      .array(
        z.object({
          id: z.string().optional(),
          authorId: z.string().optional(),
          authorName: z.string().optional(),
          title: z.string(),
        })
      )
      .optional(),
    toneDirections: z.array(z.string()).optional(),
    selectedToneDirections: z.array(z.string()).optional(),
    customTone: z.string().optional(),
  })
  .optional();

const ideaSeedSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  genre: z.string().optional(),
  description: z.string().min(1),
  tone: z.string().optional(),
  protagonist: z.string().optional(),
  conflict: z.string().optional(),
  setting: z.string().optional(),
  literaryTaste: literaryTasteSchema,
});

const ideaAnswerSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
});

type IdeaSeed = z.infer<typeof ideaSeedSchema>;
type IdeaAnswer = z.infer<typeof ideaAnswerSchema>;

function extractJsonObject<T>(raw: string): T | null {
  // Fix: regex anterior `(:json)` capturava ":json" literal em vez de tornar
  // "json" opcional. Substituído por grupo não-capturado + ? — cobre
  // ```json, ```JSON e ``` sem linguagem.
  const cleaned = raw
    .replace(/^```(?:json|JSON)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function normalizeForSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isQuestionAboutGeneratedCalibration(question: string) {
  const source = normalizeForSearch(question);
  return [
    "mini cena",
    "minicena",
    "sua cena sugere",
    "a sua cena",
    "na sua cena",
    "voce descreve",
    "voce escreveu",
    "voce criou",
    "voce apresentou",
    "cena escolhida",
    "exemplo escolhido",
  ].some(pattern => source.includes(pattern));
}

function slugId(value: string) {
  const slug = normalizeForSearch(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `item_${Date.now().toString(36)}`;
}

function ideaSource(seed: IdeaSeed) {
  return [
    seed.title,
    seed.subtitle,
    seed.genre,
    seed.description,
    seed.tone,
    seed.protagonist,
    seed.conflict,
    seed.setting,
  ]
    .map(item => item?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

function hasSourceAny(source: string, words: string[]) {
  return words.some(word => source.includes(normalizeForSearch(word)));
}

function detectIdeaSignals(seed: IdeaSeed) {
  const source = normalizeForSearch(ideaSource(seed));
  const groups = [
    {
      label: "submundo digital",
      words: [
        "deepweb",
        "dark web",
        "internet",
        "rede",
        "hacker",
        "forum",
        "dados",
        "algoritmo",
      ],
    },
    {
      label: "suspense investigativo",
      words: [
        "suspense",
        "mistério",
        "investigação",
        "crime",
        "segredo",
        "desaparecimento",
      ],
    },
    {
      label: "romance sob ameaça",
      words: ["romance", "amor", "relação", "casal", "paixão", "desejo"],
    },
    {
      label: "fantasia medieval",
      words: [
        "medieval",
        "reino",
        "castelo",
        "coroa",
        "nobreza",
        "cavaleiro",
        "feudal",
      ],
    },
    {
      label: "política e poder",
      words: [
        "política",
        "governo",
        "estado",
        "imperio",
        "conspiração",
        "poder",
        "corrupcao",
      ],
    },
    {
      label: "terror e estranhamento",
      words: [
        "terror",
        "horror",
        "assombração",
        "ritual",
        "sobrenatural",
        "maldito",
      ],
    },
    {
      label: "identidade e moralidade",
      words: [
        "identidade",
        "culpa",
        "obsessão",
        "moral",
        "mentira",
        "trauma",
        "paranoia",
      ],
    },
  ];
  return groups
    .filter(group => hasSourceAny(source, group.words))
    .map(group => group.label);
}

function makeAuthorSuggestion(input: {
  name: string;
  reason: string;
  genres: string[];
  signals: string[];
  works: string[];
  toneDirections: string[];
}) {
  return {
    id: slugId(input.name),
    name: input.name,
    reason: input.reason,
    genres: input.genres,
    signals: input.signals,
    works: input.works,
    toneDirections: input.toneDirections,
  };
}

function fallbackRepertoire(seed: IdeaSeed) {
  const source = normalizeForSearch(ideaSource(seed));
  const detectedSignals = detectIdeaSignals(seed);
  const authors: ReturnType<typeof makeAuthorSuggestion>[] = [];
  const add = (author: ReturnType<typeof makeAuthorSuggestion>) => {
    if (!authors.some(item => item.id === author.id)) authors.push(author);
  };

  if (
    hasSourceAny(source, [
      "deepweb",
      "dark web",
      "internet",
      "rede",
      "hacker",
      "forum",
      "dados",
    ])
  ) {
    add(
      makeAuthorSuggestion({
        name: "William Gibson",
        reason:
          "A premissa aponta para internet como submundo e identidade contaminada por tecnologia, não apenas suspense genérico.",
        genres: ["ficção científica", "suspense", "noir tecnológico"],
        signals: ["submundo digital", "identidade", "paranoia tecnológica"],
        works: ["Neuromancer", "Count Zero", "Reconhecimento de Padrões"],
        toneDirections: [
          "noir tecnológico com paranoia social",
          "submundo digital como espelho moral",
          "cidade/rede como labirinto",
        ],
      })
    );
    add(
      makeAuthorSuggestion({
        name: "Stieg Larsson",
        reason:
          "A ideia de investigação, mulher em risco e estruturas escondidas combina com thriller contemporâneo conectado a redes e violência real.",
        genres: ["suspense", "mistério", "crime"],
        signals: [
          "investigação",
          "violência institucional",
          "rede clandestina",
        ],
        works: [
          "Os Homens que Não Amavam as Mulheres",
          "A Menina que Brincava com Fogo",
          "A Rainha do Castelo de Ar",
        ],
        toneDirections: [
          "thriller investigativo com camadas sociais",
          "perigo digital chegando ao mundo físico",
          "tensão entre intimidade e sistema",
        ],
      })
    );
    add(
      makeAuthorSuggestion({
        name: "Neal Stephenson",
        reason:
          "Ajuda quando o mundo digital precisa ter regras, cultura própria e consequências concretas na trama.",
        genres: ["ficção científica", "thriller tecnológico"],
        signals: ["cultura hacker", "infraestrutura digital", "sistema"],
        works: ["Snow Crash", "Cryptonomicon", "Reamde"],
        toneDirections: [
          "tecnologia com regras narrativas claras",
          "conspiração de rede em escala ampla",
          "energia de thriller técnico",
        ],
      })
    );
  }

  if (
    hasSourceAny(source, [
      "mulher",
      "romance",
      "relação",
      "desejo",
      "segredo",
      "moral",
    ])
  ) {
    add(
      makeAuthorSuggestion({
        name: "Gillian Flynn",
        reason:
          "A combinação de protagonista feminina, segredo e ameaça pede tensão psicológica concreta, com desejo e suspeita convivendo.",
        genres: ["suspense", "drama", "mistério"],
        signals: [
          "segredo íntimo",
          "protagonista feminina",
          "ambiguidade moral",
        ],
        works: ["Garota Exemplar", "Objetos Cortantes", "Lugares Escuros"],
        toneDirections: [
          "suspense psicológico venenoso",
          "intimidade como campo de ameaça",
          "voz afiada e desconfiável",
        ],
      })
    );
    add(
      makeAuthorSuggestion({
        name: "Patricia Highsmith",
        reason:
          "Serve como referência se o centro for desejo, culpa e fascínio por algo moralmente perigoso.",
        genres: ["suspense", "psicológico", "romance"],
        signals: ["culpa", "obsessão", "identidade"],
        works: ["O Talentoso Ripley", "Pacto Sinistro", "Carol"],
        toneDirections: [
          "moralidade ambígua sem explicar demais",
          "tensão de desejo e culpa",
          "crime como pressão psicológica",
        ],
      })
    );
  }

  if (
    hasSourceAny(source, [
      "medieval",
      "reino",
      "castelo",
      "coroa",
      "nobreza",
      "guerra",
    ])
  ) {
    add(
      makeAuthorSuggestion({
        name: "George R. R. Martin",
        reason:
          "A premissa pede política, famílias e consequências duras em escala de poder, não fantasia decorativa.",
        genres: ["fantasia", "drama", "política"],
        signals: ["poder", "família", "guerra"],
        works: [
          "A Guerra dos Tronos",
          "A Fúria dos Reis",
          "O Festim dos Corvos",
        ],
        toneDirections: [
          "intriga política brutal",
          "fantasia adulta com consequências morais",
          "poder como máquina de trauma",
        ],
      })
    );
    add(
      makeAuthorSuggestion({
        name: "Umberto Eco",
        reason:
          "Ajuda se o medieval estiver ligado a mistério, instituições, símbolos, religião ou conhecimento proibido.",
        genres: ["histórico", "mistério", "suspense"],
        signals: ["investigação", "instituição", "conhecimento proibido"],
        works: ["O Nome da Rosa", "Baudolino", "O Pêndulo de Foucault"],
        toneDirections: [
          "mistério histórico intelectual",
          "atmosfera de segredo institucional",
          "símbolo virando conflito",
        ],
      })
    );
  }

  if (!authors.length) {
    add(
      makeAuthorSuggestion({
        name: "Ursula K. Le Guin",
        reason:
          "Referência ampla para transformar uma premissa inicial em sociedade, regra de mundo e dilema humano.",
        genres: ["ficção especulativa", "fantasia", "drama"],
        signals: ["sociedade", "ética", "mundo"],
        works: [
          "A Mão Esquerda da Escuridão",
          "O Feiticeiro de Terramar",
          "Os Despossuídos",
        ],
        toneDirections: [
          "mundo revelado por escolhas humanas",
          "conflito ético sem maniqueísmo",
          "atmosfera especulativa clara",
        ],
      })
    );
  }

  const limitedAuthors = authors.slice(0, 7);
  const works = limitedAuthors.flatMap(author =>
    author.works.map(title => ({
      id: `${author.id}:${slugId(title)}`,
      authorId: author.id,
      authorName: author.name,
      title,
    }))
  );

  return {
    detectedSignals,
    authors: limitedAuthors,
    works,
    toneDirections: uniqueStrings(
      limitedAuthors.flatMap(author => author.toneDirections)
    ).slice(0, 10),
  };
}

function normalizeRepertoireResponse(parsed: any, seed: IdeaSeed) {
  const fallback = fallbackRepertoire(seed);
  const rawAuthors = Array.isArray(parsed.authors)
    ? parsed.authors
    : Array.isArray(parsed.selectedAuthors)
      ? parsed.selectedAuthors
      : [];
  const authors = rawAuthors
    .map((item: any) => {
      const name = asString(item.name);
      const works = asStringArray(item.works).slice(0, 5);
      if (!name) return null;
      return {
        id: asString(item.id) || slugId(name),
        name,
        reason: asString(item.reason) || "Sugerido pela leitura da premissa.",
        genres: asStringArray(item.genres),
        signals: asStringArray(item.signals),
        works,
        toneDirections: asStringArray(item.toneDirections).slice(0, 6),
      };
    })
    .filter(Boolean)
    .slice(0, 7) as typeof fallback.authors;

  const rawWorks = Array.isArray(parsed.works) ? parsed.works : [];
  const works = rawWorks
    .map((item: any) => {
      const title = asString(item.title);
      if (!title) return null;
      const authorName =
        asString(item.authorName) || asString(item.author) || "";
      const authorId = asString(item.authorId) || slugId(authorName || title);
      return {
        id: asString(item.id) || `${authorId}:${slugId(title)}`,
        authorId,
        authorName,
        title,
      };
    })
    .filter(Boolean) as typeof fallback.works;

  const selectedAuthors = authors.length ? authors : fallback.authors;
  const selectedWorks = works.length
    ? works
    : selectedAuthors.flatMap(author =>
        author.works.map(title => ({
          id: `${author.id}:${slugId(title)}`,
          authorId: author.id,
          authorName: author.name,
          title,
        }))
      );

  return {
    detectedSignals: uniqueStrings([
      ...asStringArray(parsed.detectedSignals),
      ...fallback.detectedSignals,
    ]).slice(0, 10),
    authors: selectedAuthors,
    works: selectedWorks,
    toneDirections: uniqueStrings([
      ...asStringArray(parsed.toneDirections),
      ...selectedAuthors.flatMap(author => author.toneDirections),
      ...fallback.toneDirections,
    ]).slice(0, 10),
  };
}

function inferProtagonistLabel(seed: IdeaSeed) {
  const explicit = asString(seed.protagonist);
  if (explicit) return explicit;
  const source = normalizeForSearch(ideaSource(seed));
  if (hasSourceAny(source, ["mulher", "garota", "jovem", "mae", "filha"]))
    return "essa mulher";
  if (hasSourceAny(source, ["grupo", "família", "casal"])) return "esse núcleo";
  return "o protagonista";
}

function formatTaste(seed: IdeaSeed) {
  const taste = seed.literaryTaste;
  if (!taste) return "";
  const authors = (taste.selectedAuthors || [])
    .map(author => author.name)
    .filter(Boolean)
    .join(", ");
  const works = (taste.selectedWorks || [])
    .map(
      work => `${work.title}${work.authorName ? ` (${work.authorName})` : ""}`
    )
    .join(", ");
  const tones = [
    ...(taste.selectedToneDirections || []),
    taste.customTone || "",
  ]
    .map(item => item.trim())
    .filter(Boolean)
    .join(", ");
  return [
    authors
      ? `Repertório literário selecionado ou sugerido para inspiração: ${authors}`
      : "",
    works ? `Obras de referência selecionadas ou sugeridas: ${works}` : "",
    tones ? `Direção de tom escolhida: ${tones}` : "",
    (taste.detectedSignals || []).length
      ? `Sinais detectados: ${(taste.detectedSignals || []).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function fallbackQuestions(seed: IdeaSeed) {
  const taste = formatTaste(seed);
  const protagonist = inferProtagonistLabel(seed);
  const source = normalizeForSearch(ideaSource(seed));
  const digital = hasSourceAny(source, [
    "deepweb",
    "dark web",
    "internet",
    "rede",
    "hacker",
    "forum",
    "dados",
  ]);
  const romance = hasSourceAny(source, [
    "romance",
    "amor",
    "relação",
    "casal",
    "paixão",
    "desejo",
  ]);
  const setting =
    asString(seed.setting) ||
    (digital ? "internet/deep web" : "ambiente principal");
  return [
    {
      id: "specific_discovery",
      label: digital ? "Descoberta digital" : "Descoberta central",
      question: digital
        ? `O que exatamente ${protagonist} encontra no submundo digital, e por que essa descoberta não pode ser simplesmente ignorada ou denunciada`
        : `Qual descoberta, perda ou desejo faz ${protagonist} atravessar a fronteira entre vida comum e trama principal`,
      reason:
        "Amarra a premissa a um gatilho concreto, não a uma descrição abstrata.",
    },
    {
      id: "threat_structure",
      label: digital ? "Ameaça por trás da rede" : "Força antagônica",
      question: digital
        ? `Quem controla, lucra ou protege esse submundo da ${setting}, e como essa força alcança a vida física de ${protagonist}`
        : `Que força antagônica transforma essa ideia em conflito contínuo: uma pessoa, instituição, comunidade, segredo, sistema ou desejo interno`,
      reason:
        "Define a máquina de pressão que sustenta capítulos, personagens e universo.",
    },
    {
      id: "moral_limit",
      label: "Limite moral",
      question: `Que limite ${protagonist} aceita cruzar para continuar, e qual limite ainda seria imperdovel para essa pessoa`,
      reason:
        "Tira a história do lugar comum e cria escolhas narrativas fortes.",
    },
    ...(romance
      ? [
          {
            id: "romance_function",
            label: "Romance na trama",
            question:
              "O romance deve ser refgio, armadilha, cumplicidade, chantagem ou uma segunda investigação dentro da história",
            reason: "Evita que o romance fique solto como etiqueta de gênero.",
          },
        ]
      : []),
    ...(taste
      ? [
          {
            id: "taste_distance",
            label: "Distancia das referências",
            question:
              "Das referências e direções sugeridas, o que você quer manter como sensação e o que quer evitar para a história não parecer derivada",
            reason: "Usa repertório do autor como bússola, não como cópia.",
          },
        ]
      : []),
    {
      id: "final_shadow",
      label: "Promessa de final",
      question:
        "Sem fechar o final, que revelação ou transformação faria essa história valer a jornada",
      reason: "Cria direção para a proposta sem engessar a escrita.",
    },
  ].slice(0, 6);
}

function fallbackProposal(seed: IdeaSeed, answers: IdeaAnswer[]) {
  const answerText = answers
    .map(item => `- ${item.question}\n${item.answer}`)
    .join("\n\n");
  const taste = formatTaste(seed);
  const protagonist = inferProtagonistLabel(seed);
  const source = normalizeForSearch(ideaSource(seed));
  const digital = hasSourceAny(source, [
    "deepweb",
    "dark web",
    "internet",
    "rede",
    "hacker",
    "forum",
    "dados",
  ]);
  return {
    title: seed.title || "Obra sem título",
    subtitle: seed.subtitle || "",
    genre: seed.genre || "Gênero a definir",
    logline: seed.description,
    summary: `${seed.description}\n\nA ideia ganha força quando ${protagonist} deixa de ser uma função genérica e passa a enfrentar uma ameaça com regras próprias${digital ? " ligada ao submundo digital e ao modo como a rede invade a vida real" : ""}. O conflito deve nascer de ${seed.conflict || "uma pressão central ainda em definição"} e das respostas do autor, preservando detalhes concretos antes de virar Bíblia da Obra.${taste ? `\n\nPreferências literárias declaradas:\n${taste}` : ""}\n\n${answerText}`,
    tone: seed.tone || "Tom a definir pelo autor",
    protagonist,
    centralConflict: seed.conflict || "",
    setting: seed.setting || "",
    universe: {
      overview: seed.description,
      timePeriod: seed.setting || "",
      locations: seed.setting || "",
      lore: "",
      powerRules: "",
      factions: "",
      timeline: "",
      themesTone: seed.tone || "",
      continuityConstraints: answerText,
      openQuestions:
        "Refinar personagens, estrutura de capítulos e eventos da timeline.",
    },
    characters: [
      {
        name:
          seed.protagonist ||
          (protagonist === "essa mulher"
            ? "Protagonista provisória"
            : "Protagonista provisório"),
        role: "Núcleo inicial da história",
        description: `${protagonist} carrega a premissa: ${seed.description}. Precisa ganhar desejo concreto, medo, limite moral e relações antes do primeiro rascunho.`,
      },
    ],
    timeline: [],
    styleBrief: [seed.tone || "", taste].filter(Boolean).join("\n\n"),
  };
}

function normalizeQuestionResponse(parsed: any, seed: IdeaSeed) {
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .map((item: any, index: number) => ({
          id: asString(item.id) || `question_${index + 1}`,
          label: asString(item.label) || `Pergunta ${index + 1}`,
          question: asString(item.question),
          reason: asString(item.reason),
        }))
        .filter(
          (item: any) =>
            item.question && !isQuestionAboutGeneratedCalibration(item.question)
        )
        .slice(0, 6)
    : [];
  return questions.length >= 3 ? questions : fallbackQuestions(seed);
}

function normalizeProposalResponse(
  parsed: any,
  seed: IdeaSeed,
  answers: IdeaAnswer[]
) {
  const fallback = fallbackProposal(seed, answers);
  const universe =
    parsed.universe && typeof parsed.universe === "object"
      ? parsed.universe
      : {};
  const characters = Array.isArray(parsed.characters)
    ? parsed.characters
        .map((item: any) => ({
          name: asString(item.name),
          role: asString(item.role),
          description: asString(item.description),
        }))
        .filter((item: any) => item.name || item.description)
        .slice(0, 12)
    : [];
  return {
    title: asString(parsed.title) || fallback.title,
    subtitle: asString(parsed.subtitle) || fallback.subtitle,
    genre: asString(parsed.genre) || fallback.genre,
    logline: asString(parsed.logline) || fallback.logline,
    summary: asString(parsed.summary) || fallback.summary,
    tone: asString(parsed.tone) || fallback.tone,
    protagonist: asString(parsed.protagonist) || fallback.protagonist,
    centralConflict:
      asString(parsed.centralConflict) || fallback.centralConflict,
    setting: asString(parsed.setting) || fallback.setting,
    universe: {
      overview: asString(universe.overview) || fallback.universe.overview,
      timePeriod: asString(universe.timePeriod) || fallback.universe.timePeriod,
      locations: asString(universe.locations) || fallback.universe.locations,
      lore: asString(universe.lore) || fallback.universe.lore,
      powerRules: asString(universe.powerRules) || fallback.universe.powerRules,
      factions: asString(universe.factions) || fallback.universe.factions,
      timeline: asString(universe.timeline) || fallback.universe.timeline,
      themesTone: asString(universe.themesTone) || fallback.universe.themesTone,
      continuityConstraints:
        asString(universe.continuityConstraints) ||
        fallback.universe.continuityConstraints,
      openQuestions:
        asString(universe.openQuestions) || fallback.universe.openQuestions,
    },
    characters: characters.length ? characters : fallback.characters,
    timeline: Array.isArray(parsed.timeline)
      ? parsed.timeline
          .map((item: any) => ({
            period: asString(item.period),
            event: asString(item.event),
            impact: asString(item.impact),
          }))
          .filter((item: any) => item.event)
          .slice(0, 16)
      : fallback.timeline,
    styleBrief: asString(parsed.styleBrief) || fallback.styleBrief,
  };
}

async function chargeBeforeWork(
  userId: number,
  amount: number,
  reason: string,
  reference: string
) {
  await chargeCredits(userId, amount, reason, { reference });
}

async function refundCharge(
  userId: number,
  amount: number,
  reason: string,
  reference: string
) {
  try {
    await grantCredits(userId, amount, `Estorno: ${reason}`, {
      reference: `refund:${reference}`,
      type: "refund",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ideas] failed to refund credits", { userId, amount, err });
  }
}

function requireJsonPayload<T>(parsed: T | null, label: string): T {
  if (!parsed || typeof parsed !== "object") {
    throw new UserVisibleError(
      `A IA não conseguiu devolver ${label} em formato válido. Nada foi cobrado.`
    );
  }
  return parsed;
}

function assertUsefulRepertoire(
  profile: ReturnType<typeof normalizeRepertoireResponse>
) {
  const concreteAuthors = profile.authors.filter(
    author => author.name && author.reason && author.reason.length > 30
  );
  if (!concreteAuthors.length) {
    throw new UserVisibleError(
      "A IA não encontrou repertório útil a partir da ideia. Refine a premissa ou tente novamente. Nada foi cobrado."
    );
  }
}

function assertUsefulQuestions(
  questions: ReturnType<typeof normalizeQuestionResponse>
) {
  if (
    questions.length < 3 ||
    questions.some((item: { question: string }) => item.question.length < 40)
  ) {
    throw new UserVisibleError(
      "A IA gerou perguntas rasas demais para desenvolver a ideia. Tente novamente. Nada foi cobrado."
    );
  }
}

function assertUsefulProposal(
  proposal: ReturnType<typeof normalizeProposalResponse>
) {
  const summaryWords = proposal.summary.split(/\s+/).filter(Boolean).length;
  if (
    summaryWords < 120 ||
    proposal.characters.length === 0 ||
    !proposal.universe.overview.trim()
  ) {
    throw new UserVisibleError(
      "A proposta da IA ficou superficial demais para virar Bíblia da Obra. Tente novamente. Nada foi cobrado."
    );
  }
}

export const ideasRouter = router({
  styleOptions: protectedProcedure
    .input(
      z.object({
        idea: ideaSeedSchema,
      })
    )
    .query(({ input }) => {
      return {
        success: true,
        options: buildStyleCalibrationOptions({
          title: input.idea.title,
          subtitle: input.idea.subtitle,
          genre: input.idea.genre,
          description: input.idea.description,
          sceneContext: input.idea.conflict || input.idea.protagonist,
          universeContext: [input.idea.setting, input.idea.tone]
            .filter(Boolean)
            .join("\n"),
        }),
      };
    }),

  analyzeRepertoire: protectedProcedure
    .input(
      z.object({
        idea: ideaSeedSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      await chargeBeforeWork(
        ctx.user!.id,
        IDEA_REPERTOIRE_COST,
        "Ideias: leitura de repertório",
        "ideas:repertoire"
      );
      let charged = true;

      const prompt = `
Você é um editor literário que escolhe repertório de INSPIRAÇÃO para calibrar perguntas, não para copiar.
Leia a ideia inteira antes de sugerir autores e obras.

Regras obrigatórias:
- Não escolha autor por gênero isolado. Use a conjunção de premissa, protagonista/núcleo, conflito, ambiente, tom, promessa emocional, época, tecnologia/poder e riscos morais.
- A justificativa de cada autor precisa citar elementos concretos da ideia do autor.
- Se a ideia estiver vaga, sugira menos repertório e sinalize lacunas; não force meia dúzia de nomes.
- Sugira autores/obras conhecidos o bastante para o autor reconhecer, mas mantenha variedade real.
- As sugestões são apenas repertório e direção de gosto. Nunca diga para copiar estilo, mundo, personagens, cenas ou marcas registradas.
- Pense também em autores que combinam por estrutura, atmosfera, tipo de conflito, protagonista e sistema de mundo, não só por prateleira de livraria.
- Devolva apenas JSON válido.

${PROMPT_HARDENING_CLAUSE}

Ideia:
${escapePromptInjection(JSON.stringify(input.idea, null, 2))}

Formato:
{
  "detectedSignals": ["sinais específicos detectados na premissa"],
  "authors": [
    {
      "id": "slug_opcional",
      "name": "Autor ou autora",
      "reason": "por que essa referência conversa com ESTA ideia, citando elementos concretos",
      "genres": ["famílias narrativas"],
      "signals": ["sinais da ideia que conectam"],
      "works": ["Obra conhecida 1", "Obra conhecida 2"],
      "toneDirections": ["direções de tom/estrutura que podem inspirar sem copiar"]
    }
  ],
  "works": [
    { "id": "slug_opcional", "authorId": "slug do autor", "authorName": "Autor", "title": "Obra" }
  ],
  "toneDirections": ["opções de tom baseadas nesta ideia"]
}
`;

      try {
        const response = await invokeLLM({
          messages: [{ role: "user", content: prompt }],
          maxTokens: 2600,
        });
        const raw = response.choices[0].message.content;
        const parsed = requireJsonPayload(
          typeof raw === "string" ? extractJsonObject<any>(raw) : null,
          "o repertório"
        );
        if (
          !Array.isArray((parsed as any).authors) ||
          !(parsed as any).authors.length
        ) {
          throw new UserVisibleError(
            "A IA não encontrou autores/referências específicos o bastante a partir da ideia. Nada foi cobrado."
          );
        }
        const profile = normalizeRepertoireResponse(parsed, input.idea);
        assertUsefulRepertoire(profile);
        charged = false;
        return { success: true, profile };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[Ideas] Repertoire analysis failed:", error);
        throw error;
      } finally {
        if (charged)
          await refundCharge(
            ctx.user!.id,
            IDEA_REPERTOIRE_COST,
            "Ideias: leitura de repertório",
            "ideas:repertoire"
          );
      }
    }),

  askQuestions: protectedProcedure
    .input(
      z.object({
        idea: ideaSeedSchema,
        answers: z.array(ideaAnswerSchema).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await chargeBeforeWork(
        ctx.user!.id,
        IDEA_QUESTION_COST,
        "Ideias: perguntas da IA",
        "ideas:questions"
      );
      let charged = true;

      const prompt = `
Você é um editor de desenvolvimento literário para autores de ficção.
Leia a ideia inicial e faça perguntas realmente úteis antes de criar a obra.

Regras:
- Não escreva a história ainda.
- Não seja genérico.
- Leia a premissa, a descrição, o gênero, o tom, o ambiente e o repertório como uma coisa só. Não formule perguntas baseadas apenas no gênero.
- Cada pergunta deve nascer de algo concreto informado pelo autor. Se a ideia menciona internet, deep web, reino medieval, romance, conspiração ou qualquer outro elemento, a pergunta precisa tocar esse elemento.
- Pergunte coisas que mudam personagens, mundo, conflito, estrutura, promessa narrativa e final possível.
- Crie de 4 a 6 perguntas. Pelo menos uma deve tratar do mecanismo único da premissa, uma da escolha moral do protagonista/núcleo e uma do sistema/força antagônica.
- Se o autor já informou algo, não pergunte a mesma coisa.
- Se houver preferências literárias, use-as para formular perguntas complementares sobre gosto, distância das referências e tom. Não pergunte de novo se ele conhece autores/obras já marcados.
- Use rótulos específicos. Evite labels vazios como "Pressão do protagonista" se puder dizer "Descoberta na deep web", "Romance como armadilha" ou outro rótulo da ideia.
- Devolva apenas JSON válido.

${PROMPT_HARDENING_CLAUSE}

- Se houver "Calibração técnica de escrita", use apenas como direção de tom, ritmo e densidade. Não trate mini-cenas, exemplos de calibração ou repertório sugerido como se fossem conteúdo escrito pelo autor.
- Nunca pergunte sobre "sua mini-cena", "a cena que você escreveu" ou "você descreveu", a menos que esse texto esteja explicitamente na descrição da ideia do autor.

Ideia inicial:
${escapePromptInjection(JSON.stringify(input.idea, null, 2))}

Respostas já dadas:
${escapePromptInjection(JSON.stringify(input.answers || [], null, 2))}

Formato:
{
  "questions": [
    { "id": "string_curta", "label": "rótulo curto", "question": "pergunta em português", "reason": "por que isso importa" }
  ]
}
`;

      try {
        const response = await invokeLLM({
          messages: [{ role: "user", content: prompt }],
          maxTokens: 2600,
        });
        const raw = response.choices[0].message.content;
        const parsed = requireJsonPayload(
          typeof raw === "string" ? extractJsonObject<any>(raw) : null,
          "as perguntas"
        );
        if (
          !Array.isArray((parsed as any).questions) ||
          !(parsed as any).questions.length
        ) {
          throw new UserVisibleError(
            "A IA não devolveu perguntas específicas para esta ideia. Nada foi cobrado."
          );
        }
        const questions = normalizeQuestionResponse(parsed, input.idea);
        assertUsefulQuestions(questions);
        charged = false;
        return { success: true, questions };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[Ideas] Question generation failed:", error);
        throw error;
      } finally {
        if (charged)
          await refundCharge(
            ctx.user!.id,
            IDEA_QUESTION_COST,
            "Ideias: perguntas da IA",
            "ideas:questions"
          );
      }
    }),

  generateProposal: protectedProcedure
    .input(
      z.object({
        idea: ideaSeedSchema,
        answers: z.array(ideaAnswerSchema).default([]),
        previousProposal: z.any().optional(),
        revisionRequest: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await chargeBeforeWork(
        ctx.user!.id,
        IDEA_PROPOSAL_COST,
        "Ideias: proposta narrativa",
        "ideas:proposal"
      );
      let charged = true;

      const prompt = `
Você é um editor de desenvolvimento literário. Com base na ideia e nas respostas, proponha uma versão de obra que pareça específica, autoral e utilizável.

Regras:
- Não transforme em descrição curta e clichê.
- Preserve o que o autor informou.
- Leia a descrição da ideia como prioridade máxima. Gênero e repertório são suporte, não substitutos da premissa.
- Se o protagonista não tiver nome, crie uma ficha provisória funcional em vez de deixar personagens vazio.
- Expanda o suficiente para alimentar uma Bíblia da Obra.
- Use preferências literárias como bússola de gosto, ritmo, tom e expectativa, mas NÃO copie autores, obras, personagens, mundos ou marcas registradas.
- Se o autor escolheu uma direção de tom antes de gerar, ela tem prioridade sobre sugestões genéricas.
- Se houver pedido de mudança, reescreva a proposta obedecendo ao pedido.
- A proposta precisa responder ao que torna ESTA ideia específica: mecanismo de ameaça, desejo do protagonista/núcleo, regra do mundo, relações, riscos morais, promessa de final e diferença em relação a histórias parecidas.
- Devolva apenas JSON válido.

${PROMPT_HARDENING_CLAUSE}

Ideia inicial:
${escapePromptInjection(JSON.stringify(input.idea, null, 2))}

Respostas do autor:
${escapePromptInjection(JSON.stringify(input.answers, null, 2))}

Proposta anterior:
${escapePromptInjection(JSON.stringify(input.previousProposal || null, null, 2))}

Pedido de mudança:
${escapePromptInjection(input.revisionRequest || "Nenhum.")}

Formato:
{
  "title": "título",
  "subtitle": "subtítulo opcional",
  "genre": "gêneros",
  "logline": "frase de promessa narrativa",
  "summary": "resumo desenvolvido em 6 a 10 parágrafos, com começo de estrutura, conflitos, viradas e promessa de final, sem escrever a obra inteira",
  "tone": "tom e atmosfera",
  "protagonist": "protagonista ou núcleo central",
  "centralConflict": "conflito central",
  "setting": "cenário, época, ambiente",
  "universe": {
    "overview": "visão geral do universo",
    "timePeriod": "período e ano se houver",
    "locations": "lugares relevantes",
    "lore": "lore, regras historicas ou mitológicas",
    "powerRules": "regras de poder, tecnologia, política, magia ou instituições",
    "factions": "facções, governos, famílias, sociedades",
    "timeline": "eventos em ordem cronológica ou sem data definida",
    "themesTone": "temas e tom",
    "continuityConstraints": "fatos que não devem ser contraditos",
    "openQuestions": "lacunas para o autor decidir depois"
  },
  "characters": [
    { "name": "nome", "role": "função narrativa", "description": "descrição inicial com desejo, medo, conflito e relação com a trama" }
  ],
  "timeline": [
    { "period": "ano/período/sem data", "event": "evento", "impact": "impacto narrativo" }
  ],
  "styleBrief": "orientação inicial de estilo para a próxima etapa"
}
`;

      try {
        const response = await invokeLLM({
          messages: [{ role: "user", content: prompt }],
          maxTokens: 5500,
        });
        const raw = response.choices[0].message.content;
        const parsed = requireJsonPayload(
          typeof raw === "string" ? extractJsonObject<any>(raw) : null,
          "a proposta"
        );
        if (
          !asString((parsed as any).summary) ||
          !(parsed as any).universe ||
          typeof (parsed as any).universe !== "object"
        ) {
          throw new UserVisibleError(
            "A IA não devolveu uma proposta completa com resumo e universo. Nada foi cobrado."
          );
        }
        const proposal = normalizeProposalResponse(
          parsed,
          input.idea,
          input.answers
        );
        assertUsefulProposal(proposal);
        charged = false;
        return { success: true, proposal };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[Ideas] Proposal generation failed:", error);
        throw error;
      } finally {
        if (charged)
          await refundCharge(
            ctx.user!.id,
            IDEA_PROPOSAL_COST,
            "Ideias: proposta narrativa",
            "ideas:proposal"
          );
      }
    }),
});
