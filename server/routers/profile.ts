import { UserVisibleError } from "@shared/_core/errors";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  chargeCredits,
  createCharacter,
  createLibraryEntry,
  createNotification,
  deleteCharacter,
  getCharactersByUserId,
  getOrCreateAuthorProfile,
  getUserLibraryEntries,
  incrementLibraryCount,
  updateAuthorProfile,
  updateCharacter,
} from "../db";
import { invokeLLM } from "../_core/llm";
import { ensureReadableWork, ensureWritableWork } from "../_core/workGuard";
import { createLogger } from "../_core/logger";

const logger = createLogger("profile");

const continuityMemoryInput = z.object({
  id: z.string().optional(),
  chapterId: z.number(),
  chapterTitle: z.string(),
  summary: z.string(),
  stateChanges: z.array(z.string()).default([]),
  canonicalFacts: z.array(z.string()).default([]),
  openLoops: z.array(z.string()).default([]),
  impactedCharacters: z.array(z.string()).default([]),
  isActive: z.boolean().optional(),
  updatedAt: z.string().optional(),
});

const existingKeyChapterInput = z.object({
  chapterId: z.number(),
  title: z.string().min(1),
  notes: z.string().optional(),
  sourceType: z.literal("existing"),
});

const referenceSummarySectionInput = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  content: z.string().min(1),
});

const referenceAnalysisBlockInput = z.object({
  index: z.number(),
  title: z.string().min(1),
  wordCount: z.number(),
  dossier: z.string().min(1),
  sourceAnchors: z.array(z.string()).optional(),
  part: z.number().optional(),
  totalParts: z.number().optional(),
});

const customKeyChapterInput = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  summary: z.string().optional(),
  summarySections: z.array(referenceSummarySectionInput).optional(),
  analysisBlocks: z.array(referenceAnalysisBlockInput).optional(),
  continuitySnippet: z.string().optional(),
  importedCharacterIds: z.array(z.number()).optional(),
  importedTimelineEvents: z
    .array(
      z.object({
        order: z.number(),
        period: z.string(),
        title: z.string(),
        description: z.string(),
        source: z.string().optional(),
        confidence: z.enum(["high", "medium", "low"]).optional(),
      })
    )
    .optional(),
  summaryStatus: z.enum(["pending", "done", "error"]).optional(),
  notes: z.string().optional(),
  fileName: z.string().optional(),
  sourceType: z.enum(["manual", "upload"]),
  isActive: z.boolean().optional(),
});

const keyChapterInput = z.union([
  existingKeyChapterInput,
  customKeyChapterInput,
]);
const SUMMARY_FORMAT_RULES = `Use exatamente estes títulos de seção, nesta ordem:
Premissa e Conflito Central
Personagens Principais
Personagens Secundários Relevantes
Cronologia de Eventos-Chave
Elementos Estabelecidos do Universo
Conflitos e Pontas Abertas
Tom, Estilo Narrativo e Voz
Estado Final da Narrativa

Cada seção deve ter seu próprio bloco de texto.
Não use markdown decorativo como ###, **, bullets artificiais ou frases de abertura.
Preserve nomes próprios, decisões, viradas, perdas, conflitos e consequências concretas.
Não reduza personagens a adjetivos como "complexo", "forte", "determinado" ou "resiliente"; descreva o que fazem e o que muda por causa deles.
Evite repetir o mesmo conteúdo em seções diferentes.`;

const SUMMARY_SECTION_DEFS = [
  { id: "premissa", label: "Premissa", match: /Premissa e Conflito Central/i },
  { id: "personagens", label: "Personagens", match: /Personagens Principais/i },
  {
    id: "secundários",
    label: "Secundários",
    match: /Personagens Secund[aá]rios Relevantes/i,
  },
  { id: "eventos", label: "Eventos", match: /Cronologia de Eventos-Chave/i },
  {
    id: "universo",
    label: "Universo",
    match: /Elementos Estabelecidos do Universo/i,
  },
  { id: "conflitos", label: "Conflitos", match: /Conflitos e Pontas Abertas/i },
  { id: "tom", label: "Tom e Temas", match: /Tom, Estilo Narrativo e Voz/i },
  { id: "estado", label: "Estado Final", match: /Estado Final da Narrativa/i },
] as const;

const importedCharacterSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  history: z.string().min(1),
  personality: z.string().optional(),
  physicalDescription: z.string().optional(),
  speechStyle: z.string().optional(),
  psychologicalProfile: z.string().optional(),
  backstory: z.string().optional(),
  motivations: z.string().optional(),
  relationships: z.string().optional(),
  notes: z.string().optional(),
});

const styleAnalysisSchema = z.object({
  essence: z.string().default(""),
  pointOfView: z.string().default(""),
  narrativeDistance: z.string().default(""),
  sentenceRhythm: z.string().default(""),
  paragraphRhythm: z.string().default(""),
  diction: z.string().default(""),
  imagery: z.string().default(""),
  sensoryDetail: z.string().default(""),
  dialogue: z.string().default(""),
  introspection: z.string().default(""),
  pacing: z.string().default(""),
  tension: z.string().default(""),
  transitions: z.string().default(""),
  emotionalLogic: z.string().default(""),
  doRules: z.array(z.string()).default([]),
  avoidRules: z.array(z.string()).default([]),
  writingChecklist: z.array(z.string()).default([]),
});

const universeProfileDataSchema = z.object({
  overview: z.string().default(""),
  genre: z.string().default(""),
  timePeriod: z.string().default(""),
  locations: z.string().default(""),
  narrativeStructure: z.string().default(""),
  pov: z.string().default(""),
  chapterStructure: z.string().default(""),
  lore: z.string().default(""),
  powerRules: z.string().default(""),
  factions: z.string().default(""),
  timeline: z.string().default(""),
  socialRules: z.string().default(""),
  themesTone: z.string().default(""),
  continuityConstraints: z.string().default(""),
  openQuestions: z.string().default(""),
  notes: z.string().default(""),
});

const universeProfilePayloadSchema = z.object({
  type: z.literal("universe-profile"),
  data: universeProfileDataSchema,
});

type ReferenceSummarySection = { id: string; label: string; content: string };
type ReferenceAnalysisBlock = {
  index: number;
  title: string;
  wordCount: number;
  dossier: string;
  sourceAnchors?: string[];
  part?: number;
  totalParts?: number;
};
type ImportedTimelineEvent = {
  order: number;
  period: string;
  title: string;
  description: string;
  source?: string;
  confidence?: "high" | "medium" | "low";
};
type ImportedCharacter = z.infer<typeof importedCharacterSchema>;
type StyleAnalysis = z.infer<typeof styleAnalysisSchema>;
type UniverseProfileData = z.infer<typeof universeProfileDataSchema>;
type QuickScanResult = {
  subtitle: string;
  genre: string;
  description: string;
};

const INTEGRAL_REFERENCE_MAX_WORDS = 100000;
const CHAPTERED_REFERENCE_MAX_WORDS = 4000;
const CHAPTER_DOSSIER_TARGET_WORDS = 850;
const CHAPTER_DOSSIER_MAX_WORDS = 1000;
const FACTUAL_EXTRACTION_TEMPERATURE = 0.1;
const CHARACTER_CHUNK_WORDS = INTEGRAL_REFERENCE_MAX_WORDS;
const UNIVERSE_CHUNK_WORDS = INTEGRAL_REFERENCE_MAX_WORDS;
const FINAL_OBSERVATION_MAX_CHARS = 56000;
const OBSERVATION_BATCH_MAX_CHARS = 36000;
const LONG_ANALYSIS_TIMEOUT_MS = 600_000;
const CHAPTERED_SUMMARY_CONCURRENCY = Math.min(
  4,
  Math.max(1, Number(process.env.CHAPTERED_SUMMARY_CONCURRENCY ?? 3) || 3)
);

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length || 1);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    })
  );

  return results;
}

function stripJsonCodeFence(raw: string) {
  return raw
    .replace(/^```(?:json|JSON)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function decodeJsonStringFragment(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  try {
    return String(JSON.parse(`"${trimmed}"`)).trim();
  } catch {
    return trimmed
      .replace(/\\"/g, '"')
      .replace(/\\n/g, " ")
      .replace(/\\\\/g, "\\")
      .trim();
  }
}

function extractJsonStringField(raw: string, field: string) {
  const quoted = new RegExp(
    `"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`,
    "i"
  ).exec(raw);
  if (quoted?.[1]) return decodeJsonStringFragment(quoted[1]);

  const loose = new RegExp(`"${field}"\\s*:\\s*([^,}\\n]+)`, "i").exec(raw);
  if (!loose?.[1]) return "";
  return loose[1].replace(/^["']|["']$/g, "").trim();
}

function normalizeQuickScanPayload(payload: any): QuickScanResult {
  const source =
    payload && typeof payload === "object" && payload.data
      ? payload.data
      : payload;
  return {
    subtitle:
      typeof source?.subtitle === "string" ? source.subtitle.trim() : "",
    genre: typeof source?.genre === "string" ? source.genre.trim() : "",
    description:
      typeof source?.description === "string" ? source.description.trim() : "",
  };
}

function parseQuickScanResponse(raw: string): QuickScanResult {
  const cleaned = stripJsonCodeFence(raw);
  const startIndex = cleaned.indexOf("{");
  const endIndex = cleaned.lastIndexOf("}");

  if (startIndex >= 0 && endIndex > startIndex) {
    try {
      return normalizeQuickScanPayload(
        JSON.parse(cleaned.slice(startIndex, endIndex + 1))
      );
    } catch {
      // Continua para o modo tolerante abaixo. Alguns provedores devolvem
      // JSON truncado, mas ainda trazem campos úteis como subtitle/genre.
    }
  }

  return {
    subtitle: extractJsonStringField(cleaned, "subtitle"),
    genre: extractJsonStringField(cleaned, "genre"),
    description: extractJsonStringField(cleaned, "description"),
  };
}

const UNIVERSE_PROFILE_FIELD_KEYS = [
  "overview",
  "genre",
  "timePeriod",
  "locations",
  "narrativeStructure",
  "pov",
  "chapterStructure",
  "lore",
  "powerRules",
  "factions",
  "timeline",
  "socialRules",
  "themesTone",
  "continuityConstraints",
  "openQuestions",
  "notes",
] as const satisfies ReadonlyArray<keyof UniverseProfileData>;

const UNIVERSE_PROFILE_ALIASES: Partial<
  Record<keyof UniverseProfileData, string[]>
> = {
  overview: ["summary", "premise", "visaoGeral", "visao_geral"],
  genre: ["gênero", "genres"],
  timePeriod: [
    "period",
    "era",
    "year",
    "período",
    "periodoAno",
    "periodo_e_ano",
    "settingTime",
  ],
  locations: ["places", "settings", "lugares", "locais", "cenários"],
  narrativeStructure: [
    "structure",
    "estrutura",
    "estruturaNarrativa",
    "estrutura_narrativa",
  ],
  pov: ["pointOfView", "focus", "focoNarrativo", "foco_narrativo"],
  chapterStructure: [
    "chapters",
    "chapterFormat",
    "estruturaCapitulos",
    "estrutura_de_captulos",
  ],
  lore: [
    "worldbuilding",
    "mythology",
    "cosmology",
    "history",
    "historiaDoMundo",
    "loreDoUniverso",
  ],
  powerRules: [
    "rules",
    "magicRules",
    "powerSystem",
    "technologyRules",
    "regras",
    "regrasDePoder",
  ],
  factions: [
    "institutions",
    "organizations",
    "groups",
    "facções",
    "organizações",
  ],
  timeline: ["chronology", "events", "cronologia", "eventos"],
  socialRules: [
    "society",
    "políticalRules",
    "regrasSociais",
    "regras_políticas",
  ],
  themesTone: ["themes", "tone", "atmosphere", "temas", "tom", "temasETom"],
  continuityConstraints: [
    "canon",
    "constraints",
    "continuityRules",
    "restrições",
    "restricoesDeContinuidade",
  ],
  openQuestions: [
    "mysteries",
    "unresolvedQuestions",
    "questions",
    "pontasAbertas",
    "perguntasAbertas",
  ],
};

function sanitizeReferenceSummary(raw: string): string {
  return raw
    .replace(/^Com certeza[\.\!\,\:\-\s]*/i, "")
    .replace(/^Claro[\.\!\,\:\-\s]*/i, "")
    .replace(/^Aqui est?[aa][^.\n]*[\.\n]\s*/i, "")
    .replace(/^Segue o resumo[^.\n]*[\.\n]\s*/i, "")
    .replace(/^Como analista liter[aa]rio,[^\n]*\n+/i, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .trim();
}

function extractSummarySections(summary: string) {
  const normalized = sanitizeReferenceSummary(summary).replace(/\r\n/g, "\n");
  const found: Array<
    (typeof SUMMARY_SECTION_DEFS)[number] & { index: number; text: string }
  > = [];

  for (const section of SUMMARY_SECTION_DEFS) {
    const flags = section.match.flags.includes("i") ? "gi" : "g";
    const matcher = new RegExp(section.match.source, flags);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(normalized)) !== null) {
      found.push({ ...section, index: match.index, text: match[0] });
      if (match.index === matcher.lastIndex) matcher.lastIndex += 1;
    }
  }

  if (!found.length) {
    return [{ id: "resumo", label: "Resumo", content: normalized.trim() }];
  }

  found.sort((a, b) => a.index - b.index);

  const grouped = new Map<string, ReferenceSummarySection>();
  const seenBlocks = new Map<string, Set<string>>();

  for (let idx = 0; idx < found.length; idx += 1) {
    const section = found[idx];
    const start = section.index;
    const end =
      idx < found.length - 1 ? found[idx + 1].index : normalized.length;
    const block = normalized.slice(start, end).trim();
    const content = block
      .slice(section.text.length)
      .replace(/^[:\s\-–—]+/, "")
      .trim();
    if (!content) continue;

    const signature = content.toLowerCase().replace(/\s+/g, " ").slice(0, 320);
    const sectionSeen = seenBlocks.get(section.id) ?? new Set<string>();
    if (sectionSeen.has(signature)) continue;
    sectionSeen.add(signature);
    seenBlocks.set(section.id, sectionSeen);

    const current = grouped.get(section.id);
    grouped.set(section.id, {
      id: section.id,
      label: section.label,
      content: current?.content
        ? `${current.content}\n\n${content}`.trim()
        : content,
    });
  }

  return SUMMARY_SECTION_DEFS.map(section => grouped.get(section.id)).filter(
    Boolean
  ) as ReferenceSummarySection[];
}

function buildContinuitySnippet(
  title: string,
  sections: Array<{ id: string; label: string; content: string }>,
  fallback: string
) {
  const blocks = (sections || [])
    .filter(section =>
      [
        "premissa",
        "universo",
        "conflitos",
        "estado",
        "personagens",
        "secundários",
        "eventos",
      ].includes(section.id)
    )
    .map(section => `${section.label}\n${section.content.trim()}`);

  const body = blocks.length ? blocks.join("\n\n") : (fallback || "").trim();

  return body
    ? `Base importada de referência: ${title.trim()}\n\n${body}`.trim()
    : "";
}

function buildSourceContinuitySnippet(title: string, content: string) {
  const blocks = splitImportedWorkIntoBlocks(content);
  const selected = blocks.length
    ? [
        ...blocks.slice(0, 2),
        ...(blocks.length > 3 ? blocks.slice(-1) : blocks.slice(2, 3)),
      ]
    : [];
  const body = selected
    .map(block => {
      const clipped =
        block.content.length > 2600
          ? `${sliceAtWordBoundary(block.content, 2600).trim()}...`
          : block.content.trim();
      return `[${block.title}]\n${clipped}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  return body
    ? `Base importada de referência: ${title.trim()}\n\nTrechos do documento original para continuidade:\n\n${body}`.trim()
    : "";
}

function normalizeTimelineText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTimelineCandidates(text: string) {
  const clean = sanitizeReferenceSummary(text)
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];

  const splitBracketedEntries = (value: string) =>
    value
      .replace(
        /\s+(?=\[(?:1[5-9]\d{2}|20\d{2}|21\d{2}|s[eé]culo|seculo|d[eé]cada|decada|anos)\b)/gi,
        "\n"
      )
      .split(/\n+/)
      .map(line => line.trim())
      .filter(line => line.length >= 28);

  const lines = clean
    .split(/\n+/)
    .map(line => line.replace(/^\s*[-*•\u2022]?\s*/, "").trim())
    .map(line => line.replace(/^\d{1,3}[\.)]\s*/, "").trim())
    .flatMap(line => splitBracketedEntries(line))
    .filter(line => line.length >= 28);

  if (lines.length > 1) return lines;

  return splitBracketedEntries(clean)
    .flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÈÊÍÓÔÕÚÇ0-9\[])/))
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 45);
}

function extractTimelinePeriod(text: string) {
  const bracket = text.match(/^\s*\[([^\]]{2,48})\]/);
  if (bracket?.[1]) return bracket[1].trim();
  const fullDate = text.match(
    /\b(?:janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?(1[5-9]\d{2}|20\d{2}|21\d{2})\b/i
  );
  if (fullDate?.[0]) return fullDate[0].trim();
  const year = text.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
  if (year?.[1]) return year[1];
  const period = text.match(
    /\b(?:século|seculo|década|decada|anos)\s+[A-ZIVXLCDM0-9]+(?:\s+de\s+\d{4})?/i
  );
  if (period?.[0]) return period[0].trim();
  return "Ordem narrativa";
}

function buildTimelineTitle(text: string) {
  const cleaned = text
    .replace(/^\s*\[[^\]]+\]\s*[-:–—]?\s*/, "")
    .replace(/^\d{1,3}[\.)]\s*/, "")
    .trim();
  const [beforeSeparator] = cleaned.split(/\s[-:–—]\s/);
  const candidate =
    beforeSeparator && beforeSeparator.length >= 8 ? beforeSeparator : cleaned;
  return candidate.length <= 96
    ? candidate
    : `${candidate.slice(0, 96).replace(/\s+\S*$/, "")}...`;
}

function buildImportedTimelineEvents(
  title: string,
  sections: ReferenceSummarySection[],
  summary: string
): ImportedTimelineEvent[] {
  const eventSections = sections
    .filter(section =>
      ["eventos", "timeline", "cronologia"].includes(section.id)
    )
    .map(section => section.content)
    .join("\n");
  const sourceText = eventSections || summary;
  const candidates = splitTimelineCandidates(sourceText);
  const seen = new Set<string>();
  const events: ImportedTimelineEvent[] = [];

  for (const candidate of candidates) {
    const description = candidate
      .replace(/^\s*\[[^\]]+\]\s*[-:–—]?\s*/, "")
      .trim();
    if (description.length < 24) continue;
    const signature = normalizeTimelineText(description).slice(0, 220);
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    events.push({
      order: events.length + 1,
      period: extractTimelinePeriod(candidate),
      title: buildTimelineTitle(candidate),
      description:
        description.length > 900
          ? `${description.slice(0, 900).replace(/\s+\S*$/, "")}...`
          : description,
      source: title,
      confidence: eventSections ? "high" : "medium",
    });
    if (events.length >= 180) break;
  }

  return events;
}

function parseTimelineEventsFromJson(
  raw: string,
  sourceTitle: string
): ImportedTimelineEvent[] {
  const cleaned = raw
    .replace(/^```(?:json|JSON)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  const rawEvents = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as any)?.events)
      ? (parsed as any).events
      : Array.isArray((parsed as any)?.timeline)
        ? (parsed as any).timeline
        : [];

  const seen = new Set<string>();
  const events: ImportedTimelineEvent[] = [];

  for (const item of rawEvents) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const rawDescription =
      typeof record.description === "string"
        ? record.description
        : typeof record.event === "string"
          ? record.event
          : "";
    const description = rawDescription.trim();
    if (description.length < 24) continue;

    const rawPeriod =
      typeof record.period === "string"
        ? record.period
        : typeof record.date === "string"
          ? record.date
          : typeof record.when === "string"
            ? record.when
            : "";
    const period =
      rawPeriod.trim() ||
      extractTimelinePeriod(
        `${typeof record.title === "string" ? record.title : ""} ${description}`
      );

    const title =
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : buildTimelineTitle(description);
    const source =
      typeof record.source === "string" && record.source.trim()
        ? record.source.trim()
        : sourceTitle;
    const confidence =
      record.confidence === "high" ||
      record.confidence === "medium" ||
      record.confidence === "low"
        ? record.confidence
        : "high";
    const signature = normalizeTimelineText(
      `${period} ${title} ${description}`
    ).slice(0, 320);
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);

    events.push({
      order: events.length + 1,
      period,
      title:
        title.length > 120
          ? `${title.slice(0, 120).replace(/\s+\S*$/, "")}...`
          : title,
      description:
        description.length > 1000
          ? `${description.slice(0, 1000).replace(/\s+\S*$/, "")}...`
          : description,
      source,
      confidence,
    });

    if (events.length >= 160) break;
  }

  return events;
}

async function extractTimelineEventsFromChunk(input: {
  title: string;
  chunkLabel: string;
  chunkContent: string;
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você esta extraindo a TIMELINE de um trecho de obra literária.
Retorne APENAS JSON puro.
Use somente este trecho. Não use conhecimento histórico externo nem datas famosas se elas não aparecem literalmente no trecho.
Extraia apenas acontecimentos concretos, viradas, revelações, deslocamentos, decisões, mortes, casamentos, traições, descobertas e mudanças de estado que afetem a continuidade.
A timeline deve representar a CRONOLOGIA HISTÓRICA INTERNA da obra, não o índice de capítulos.
O campo "period" é a data do acontecimento narrado. Não use uma data apenas citada em uma fala, carta, lembrança ou explicação como se fosse a data da cena atual.
Se uma cena tardia revela um fato antigo, crie o evento antigo no período em que aconteceu; crie também um evento tardio apenas se a revelação em si mudar a continuidade.
Quando houver data confiável, use essa data em "period". Quando não houver, use "Sequência narrativa".
Não repita o mesmo acontecimento com outra frase. Não transforme descrição de personagem em evento.
Cada descrição precisa dizer causa, ação e consequência quando o trecho mostrar isso.

Formato:
{"events":[{"period":"ano, data, período ou Sequência narrativa","title":"evento curto e específico","description":"1 a 3 frases concretas, sem genérico","source":"capítulo/trecho se identificável","confidence":"high|medium|low"}]}`,
      },
      {
        role: "user",
        content: `Obra: "${input.title}"\n${input.chunkLabel}\n\n${input.chunkContent}`,
      },
    ],
    maxTokens: 8192,
    temperature: FACTUAL_EXTRACTION_TEMPERATURE,
    response_format: { type: "json_object" },
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  return typeof raw === "string" ? raw.trim() : "";
}

async function extractTimelineEventsFromObservationGroup(input: {
  title: string;
  batchLabel: string;
  observations: string[];
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você está extraindo TIMELINE a partir de dossiês por capítulo de uma obra.
Retorne APENAS JSON puro.
Use somente os dossiês recebidos. Não use conhecimento histórico externo, datas famosas ou suposição de gênero.
Extraia acontecimentos concretos, revelações, mortes, deslocamentos, decisões, alianças, traições, mudanças de estado e fatos de mundo com efeito de continuidade.
A timeline deve representar a cronologia histórica interna da obra.
O campo "period" é a data/período do acontecimento narrado. Não use uma data apenas citada como se fosse a data da cena.
Se uma cena posterior revela um fato antigo, registre o fato antigo no período em que ocorreu; registre a revelação posterior apenas se ela muda a continuidade.
Não duplique o mesmo evento. Não misture vários anos em um único cartão.
Cada descrição precisa dizer causa, ação e consequência quando o dossiê sustentar.

Formato:
{"events":[{"period":"ano, data, período ou Sequência narrativa","title":"evento curto e específico","description":"1 a 3 frases concretas","source":"bloco/capítulo se houver","confidence":"high|medium|low"}]}`,
      },
      {
        role: "user",
        content: `Obra: "${input.title}"\n${input.batchLabel}\n\nDossiês:\n\n${input.observations.join("\n\n---\n\n")}`,
      },
    ],
    maxTokens: 12000,
    temperature: FACTUAL_EXTRACTION_TEMPERATURE,
    response_format: { type: "json_object" },
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  return typeof raw === "string" ? raw.trim() : "";
}

async function consolidateTimelineObservationEvents(input: {
  title: string;
  observations: string[];
}) {
  const sourceObservations = input.observations.filter(Boolean);
  if (!sourceObservations.length) return [];

  const groupedObservations =
    totalTextLength(sourceObservations) > FINAL_OBSERVATION_MAX_CHARS
      ? (
          await mapWithConcurrency(
            groupTextsByLength(sourceObservations, OBSERVATION_BATCH_MAX_CHARS),
            CHAPTERED_SUMMARY_CONCURRENCY,
            (group, index) =>
              extractTimelineEventsFromObservationGroup({
                title: input.title,
                batchLabel: `Lote ${index + 1}`,
                observations: group,
              })
          )
        ).filter(Boolean)
      : sourceObservations;

  if (!groupedObservations.length) return [];

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você vai consolidar eventos de timeline extraídos de dossiês por capítulo.
Retorne APENAS JSON puro.
Use as observações na ordem fornecida, remova duplicatas e corrija inversões de antes/depois usando apenas evidências presentes.
Ordene a saída pela cronologia histórica interna dos acontecimentos quando houver data/período.
O campo "period" deve ser a data do acontecimento, não a data apenas citada dentro de uma cena.
Se a data for incerta, mantenha "Sequência narrativa" e coloque depois dos eventos datados, preservando a ordem de revelação.
Nada com data anterior ao epílogo/final pode aparecer depois do epílogo/final.
Não invente anos. Não misture eventos de anos diferentes no mesmo cartão.

Formato:
{"events":[{"period":"ano, data, período ou Sequência narrativa","title":"evento curto e específico","description":"1 a 3 frases concretas","source":"trecho/capítulo se houver","confidence":"high|medium|low"}]}`,
      },
      {
        role: "user",
        content: `Obra: "${input.title}"\nObservações de timeline, em ordem de leitura:\n\n${groupedObservations.join("\n\n---\n\n")}`,
      },
    ],
    maxTokens: 16384,
    temperature: FACTUAL_EXTRACTION_TEMPERATURE,
    response_format: { type: "json_object" },
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  return typeof raw === "string"
    ? parseTimelineEventsFromJson(raw, input.title)
    : [];
}

async function extractTimelineEventsFromReference(input: {
  title: string;
  content: string;
  summary: string;
  summarySections: ReferenceSummarySection[];
  analysisBlocks?: ReferenceAnalysisBlock[];
}) {
  try {
    if (input.analysisBlocks?.length) {
      const parsedFromDossiers = await consolidateTimelineObservationEvents({
        title: input.title,
        observations: buildAnalysisObservationBlocks(input.analysisBlocks),
      });
      if (parsedFromDossiers.length) return parsedFromDossiers;
    }

    const analysisContent = buildAnalysisBlocksContent(input.analysisBlocks);
    const sourceContent = analysisContent || input.content;
    const wordCount = countWords(sourceContent);
    const blocks = analysisContent
      ? buildAnalysisTextBlocks(input.analysisBlocks)
      : splitImportedWorkIntoBlocks(sourceContent);

    if (!shouldAnalyzeReferenceByBlocks(sourceContent, blocks)) {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Você é um editor de continuidade responsável pela TIMELINE de uma obra literária.
Você receberá o texto integral da obra. Leia tudo primeiro e só depois monte a timeline.

REGRAS CRÍTICAS:
- A fonte de verdade é o texto integral. Não use resumo antigo como fonte principal.
- Não invente motivação, causa, tempo ou consequência. Se não estiver claro, marque confidence "medium" ou "low".
- Preserve nuance: medo, culpa, paralisia, silêncio ou submissão não são ausência automática de conflito; descreva o que a cena mostra.
- Separe evento de comentário. Um evento é algo que aconteceu ou foi revelado, com efeito na continuidade.
- Não duplique o mesmo evento em versões diferentes.
- A timeline é a CRONOLOGIA HISTÓRICA INTERNA da obra, não a ordem de leitura.
- O campo "period" é a data do acontecimento em si. Não use uma data apenas mencionada dentro da cena como data do evento principal.
- Se um capítulo tardio revela um fato antigo, registre o fato antigo no ano/período em que ele ocorreu. Se a revelação tardia também muda o presente narrativo, registre outro evento para a revelação.
- Quando não houver data confiável, mantenha "Sequência narrativa" e posicione depois dos eventos datados.
- Quando houver datas confiáveis, ordene pelos acontecimentos históricos da obra. Nada anterior pode ficar depois do epílogo/final só porque foi mencionado tarde.
- A descrição precisa trazer nomes, ação e consequência concreta. Nada de "tensão aumenta" sem dizer por quê.

Retorne APENAS JSON puro neste formato:
{"events":[{"period":"ano, data, período ou Sequência narrativa","title":"evento curto e específico","description":"1 a 3 frases concretas, com causa/efeito quando existir","source":"capítulo/trecho se identificável","confidence":"high|medium|low"}]}`,
          },
          {
            role: "user",
            content: `Obra: "${input.title}"\nFonte integral (${wordCount.toLocaleString("pt-BR")} palavras):\n\n${sourceContent.trim()}`,
          },
        ],
        maxTokens: 16384,
        temperature: FACTUAL_EXTRACTION_TEMPERATURE,
        response_format: { type: "json_object" },
        timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
      });

      const raw = response.choices[0].message.content;
      const parsed =
        typeof raw === "string"
          ? parseTimelineEventsFromJson(raw, input.title)
          : [];
      if (parsed.length) return parsed;
    } else {
      const sourceBlocks = blocks.length
        ? blocks
        : splitTextIntoWordChunks(sourceContent, UNIVERSE_CHUNK_WORDS).map(
            (chunk, index) => ({
              index: index + 1,
              title: chunk.label,
              content: chunk.content,
              wordCount: countWords(chunk.content),
            })
          );
      const observations = (
        await mapWithConcurrency(
          sourceBlocks,
          CHAPTERED_SUMMARY_CONCURRENCY,
          async block =>
            extractTimelineEventsFromChunk({
              title: input.title,
              chunkLabel: `Bloco ${block.index} de ${sourceBlocks.length}: ${block.title}`,
              chunkContent: block.content,
            })
        )
      ).filter(Boolean);

      if (observations.length) {
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `Você vai consolidar eventos de timeline extraídos de trechos sequenciais de uma obra.
Retorne APENAS JSON puro.
Use os trechos na ordem fornecida, remova duplicatas e corrija inversões de antes/depois usando apenas evidências presentes.
Não compacte eventos distintos em frases vagas.
Ordene a saída pela cronologia histórica interna dos acontecimentos quando houver data/período.
O campo "period" deve ser a data do acontecimento, não a data apenas citada dentro de uma cena.
Se a data for incerta, mantenha "Sequência narrativa" e coloque depois dos eventos datados, preservando a ordem de revelação.
Nada com data anterior ao epílogo/final pode aparecer depois do epílogo/final.

Formato:
{"events":[{"period":"ano, data, período ou Sequência narrativa","title":"evento curto e específico","description":"1 a 3 frases concretas","source":"trecho/capítulo se houver","confidence":"high|medium|low"}]}`,
            },
            {
              role: "user",
              content: `Obra: "${input.title}"\nObservações por trecho, na ordem do arquivo:\n\n${observations.join("\n\n---\n\n")}`,
            },
          ],
          maxTokens: 16384,
          temperature: FACTUAL_EXTRACTION_TEMPERATURE,
          response_format: { type: "json_object" },
          timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
        });
        const raw = response.choices[0].message.content;
        const parsed =
          typeof raw === "string"
            ? parseTimelineEventsFromJson(raw, input.title)
            : [];
        if (parsed.length) return parsed;
      }
    }
  } catch (error) {
    console.warn("[Profile] Failed to extract timeline from reference:", error);
  }

  return buildImportedTimelineEvents(
    input.title,
    [],
    buildAnalysisBlocksContent(input.analysisBlocks) || input.content
  );
}

function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 3)
  );
  const wordsB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 3)
  );
  if (!wordsA.size || !wordsB.size) return 0;
  let overlap = 0;
  for (const word of Array.from(wordsB)) {
    if (wordsA.has(word)) overlap++;
  }
  return overlap / Math.min(wordsA.size, wordsB.size);
}

function mergeCharacterText(
  currentValue: string | null | undefined,
  incomingValue: string | undefined,
  _prefix: string
) {
  const current = (currentValue || "").trim();
  const incoming = (incomingValue || "").trim();
  if (!incoming) return currentValue || undefined;
  if (!current) return incoming;
  if (isRawCharacterEvidenceText(current) && !isRawCharacterEvidenceText(incoming))
    return incoming;
  if (isLowValueCharacterText(current) && !isLowValueCharacterText(incoming))
    return incoming;
  // Se >60% das palavras do incoming já estão no current, é duplicata — ignorar
  if (textSimilarity(current, incoming) > 0.6) return current;
  return current;
}

function isRawCharacterEvidenceText(value: string | null | undefined) {
  const text = compactWhitespace(value || "");
  if (!text) return false;
  return (
    /^evid[eê]ncias?\s+no\s+texto\s+original\s*:/i.test(text) ||
    /^presen[cç]a\s+verificada\s+em\s+\d+\s+dossi/i.test(text) ||
    /\bResumo factual:\s*\[BLOCO\s+\d+\]/i.test(text) ||
    /\[BLOCO\s+\d+\]/i.test(text)
  );
}

function sliceAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(" ", maxChars);
  return cut > maxChars * 0.8 ? text.slice(0, cut) : text.slice(0, maxChars);
}

function limitWords(text: string, maxWords: number): string {
  const source = text.trim();
  const matches = Array.from(source.matchAll(/\S+/g));
  if (matches.length <= maxWords) return source;
  const last = matches[maxWords - 1];
  return source.slice(0, (last.index ?? 0) + last[0].length).trim();
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeEvidenceText(value: string) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countTermOccurrences(source: string, term: string) {
  const normalizedSource = normalizeSearchText(source);
  const normalizedTerm = normalizeSearchText(term).trim();
  if (!normalizedSource || normalizedTerm.length < 3) return 0;
  const pattern = new RegExp(`\\b${escapeRegExp(normalizedTerm)}\\b`, "g");
  return normalizedSource.match(pattern)?.length ?? 0;
}

function characterNameVariants(name: string) {
  const compacted = compactWhitespace(name);
  const parts = compacted.split(" ").filter(Boolean);
  const firstName = parts[0] || compacted;
  const surnameTerms = parts.slice(1).filter(part => part.length >= 4);
  return Array.from(
    new Set(
      [compacted, firstName, ...surnameTerms]
        .map(normalizeEvidenceText)
        .filter(Boolean)
    )
  );
}

function countCharacterMentions(source: string, name: string) {
  if (!source.trim()) return 0;
  const variants = characterNameVariants(name).filter(term => term.length >= 3);
  if (!variants.length) return 0;
  return Math.max(...variants.map(term => countTermOccurrences(source, term)));
}

function sourceSupportsParentChildRelation(
  evidenceText: string,
  childName: string,
  parentName: string
) {
  const source = normalizeEvidenceText(evidenceText);
  const childVariants = characterNameVariants(childName);
  const parentVariants = characterNameVariants(parentName);
  if (!source || !childVariants.length || !parentVariants.length) return false;

  for (const child of childVariants) {
    for (const parent of parentVariants) {
      const childThenParent = new RegExp(
        `\\b${escapeRegExp(child)}\\b.{0,140}\\bfilh[oa]\\s+de\\b.{0,80}\\b${escapeRegExp(parent)}\\b`
      );
      const parentThenChild = new RegExp(
        `\\b${escapeRegExp(parent)}\\b\\s*(?:mae|pai)\\s+de\\s+\\b${escapeRegExp(child)}\\b`
      );
      const parentThenChildWithPunctuation = new RegExp(
        `\\b${escapeRegExp(parent)}\\b(?:\\s+(?!(?:e|ou|de|do|da|dos|das|com|conhecid[oa]|amig[oa]|vizinh[oa]|filh[oa])\\b)[a-z0-9]+){0,2}\\s*(?:\\(|,|;|:|-)?\\s*(?:mae|pai)\\s+de\\s+\\b${escapeRegExp(child)}\\b`
      );

      if (
        childThenParent.test(source) ||
        parentThenChild.test(source) ||
        parentThenChildWithPunctuation.test(source)
      )
        return true;
    }
  }

  return false;
}

function sourceSupportsDescendantRelation(
  evidenceText: string,
  characterName: string,
  lineageName: string
) {
  const source = normalizeEvidenceText(evidenceText);
  const characterVariants = characterNameVariants(characterName);
  const lineageVariants = characterNameVariants(lineageName);
  if (!source || !characterVariants.length || !lineageVariants.length)
    return false;

  for (const character of characterVariants) {
    for (const lineage of lineageVariants) {
      const direct = new RegExp(
        `\\b${escapeRegExp(character)}\\b.{0,140}\\b(?:descende|descendente|descendia)\\b.{0,80}\\b${escapeRegExp(lineage)}\\b`
      );
      if (direct.test(source)) return true;
    }
  }

  return false;
}

function extractRelatedNamesFromRelationSegment(segment: string) {
  const stopAt = segment.search(/[.;:!?]/);
  const cleaned = (stopAt >= 0 ? segment.slice(0, stopAt) : segment)
    .replace(/\b(?:por ordem|por mando|a mando|por causa|em decorrencia|em decorrência)\b[\s\S]*$/i, "")
    .trim();
  const namePattern =
    /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+(?:\s+(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+|da|de|do|dos|das|van|von)){0,3}/g;
  return Array.from(cleaned.matchAll(namePattern))
    .map(match => compactWhitespace(match[0]))
    .filter(name => name.length >= 3);
}

function nameMatchesCharacter(candidateName: string, characterName: string) {
  const candidateVariants = characterNameVariants(candidateName);
  const characterVariants = characterNameVariants(characterName);
  return candidateVariants.some(candidate =>
    characterVariants.some(
      character =>
        candidate === character ||
        (candidate.length >= 4 && character.length >= 4 && candidate.includes(character)) ||
        (candidate.length >= 4 && character.length >= 4 && character.includes(candidate))
    )
  );
}

function claimHasUnsupportedKinship(
  sentence: string,
  characterName: string,
  evidenceText: string
) {
  const childOfMatches = Array.from(
    sentence.matchAll(/\bfilh[oa]\s+de\s+([^.;:!?]+)/gi)
  );
  for (const match of childOfMatches) {
    const relatedNames = extractRelatedNamesFromRelationSegment(match[1] || "");
    if (!relatedNames.length) return true;
    for (const relatedName of relatedNames) {
      if (
        !sourceSupportsParentChildRelation(
          evidenceText,
          characterName,
          relatedName
        )
      )
        return true;
    }
  }

  const parentOfMatches = Array.from(
    sentence.matchAll(/([\s\S]{0,180})\b(?:pai|m[aã]e)\s+de\s+([^.;:!?]+)/gi)
  );
  for (const match of parentOfMatches) {
    const childNames = extractRelatedNamesFromRelationSegment(match[2] || "");
    if (
      !childNames.some(childName =>
        nameMatchesCharacter(childName, characterName)
      )
    )
      continue;

    const parentNames = extractRelatedNamesFromRelationSegment(match[1] || "");
    for (const parentName of parentNames) {
      if (
        !sourceSupportsParentChildRelation(
          evidenceText,
          characterName,
          parentName
        )
      )
        return true;
    }
  }

  const descendantMatches = Array.from(
    sentence.matchAll(/\bdescendent[ea]?\s+d(?:e|o|a|os|as)\s+([^.;:!?]+)/gi)
  );
  for (const match of descendantMatches) {
    const relatedNames = extractRelatedNamesFromRelationSegment(match[1] || "");
    if (!relatedNames.length) return true;
    for (const relatedName of relatedNames) {
      if (
        !sourceSupportsDescendantRelation(
          evidenceText,
          characterName,
          relatedName
        )
      )
        return true;
    }
  }

  return false;
}

const LETHAL_CLAIM_PATTERN =
  /\b(?:morr(?:eu|e|eram|era)|mort[oa]s?|assassinad[oa]s?|executad[oa]s?|balead[oa]s?|estrangulad[oa]s?|torturad[oa]s?|envenenad[oa]s?)\b/;
const LETHAL_METHOD_PATTERN =
  /\b(?:tiro|tiros|balead[oa]s?|facad[ao]s?|cianeto|veneno|envenenad[oa]s?|estrangulad[oa]s?|torturad[oa]s?)\b/;

function extractClaimNames(sentence: string) {
  return extractRelatedNamesFromRelationSegment(sentence).filter(name => {
    const normalized = normalizeEvidenceText(name);
    return (
      normalized.length >= 3 &&
      !NON_CHARACTER_DOSSIER_TERMS.has(normalized) &&
      !/^[A-Z0-9.]{2,}$/.test(name)
    );
  });
}

function sourceSupportsLethalClaim(
  evidenceText: string,
  subjectName: string,
  requiresMethod: boolean
) {
  const source = normalizeEvidenceText(evidenceText);
  if (!source) return false;

  for (const subject of characterNameVariants(subjectName)) {
    const subjectThenClaim = new RegExp(
      `\\b${escapeRegExp(subject)}\\b.{0,260}\\b${LETHAL_CLAIM_PATTERN.source}\\b.{0,140}`
    );
    const claimThenSubject = new RegExp(
      `\\b${LETHAL_CLAIM_PATTERN.source}\\b.{0,180}\\b${escapeRegExp(subject)}\\b.{0,140}`
    );
    const windows = [
      source.match(subjectThenClaim)?.[0],
      source.match(claimThenSubject)?.[0],
    ].filter(Boolean) as string[];

    if (
      windows.some(window =>
        requiresMethod ? LETHAL_METHOD_PATTERN.test(window) : true
      )
    ) {
      return true;
    }
  }

  return false;
}

function claimHasUnsupportedLethalFact(
  sentence: string,
  evidenceText: string
) {
  const normalizedSentence = normalizeEvidenceText(sentence);
  if (!LETHAL_CLAIM_PATTERN.test(normalizedSentence)) return false;

  const names = extractClaimNames(sentence);
  if (!names.length) return false;
  const requiresMethod = LETHAL_METHOD_PATTERN.test(normalizedSentence);

  return names.some(
    name => !sourceSupportsLethalClaim(evidenceText, name, requiresMethod)
  );
}

function splitCharacterSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function removeUnsupportedKinshipClaims(
  text: string | undefined,
  characterName: string,
  evidenceText: string,
  mode: "sentences" | "clauses" = "sentences"
) {
  if (!text) return undefined;
  const parts =
    mode === "clauses"
      ? text.split(/\s*(?:,|;)\s*/).map(item => item.trim())
      : splitCharacterSentences(text);
  const kept = parts.filter(
    part => !claimHasUnsupportedKinship(part, characterName, evidenceText)
  );
  const separator = mode === "clauses" ? ", " : " ";
  const cleaned = compactWhitespace(kept.join(separator));
  return cleaned || undefined;
}

function removeUnsupportedLethalClaims(
  text: string | undefined,
  evidenceText: string
) {
  if (!text) return undefined;
  const kept = splitCharacterSentences(text).filter(
    sentence => !claimHasUnsupportedLethalFact(sentence, evidenceText)
  );
  const cleaned = compactWhitespace(kept.join(" "));
  return cleaned || undefined;
}

function sanitizeCharacterFactualClaims(
  character: ImportedCharacter,
  evidenceText: string
): ImportedCharacter {
  const cleanSentences = (value: string | undefined) =>
    removeUnsupportedLethalClaims(
      removeUnsupportedKinshipClaims(value, character.name, evidenceText),
      evidenceText
    );

  return {
    ...character,
    role: removeUnsupportedLethalClaims(
      removeUnsupportedKinshipClaims(
        character.role,
        character.name,
        evidenceText,
        "clauses"
      ),
      evidenceText
    ),
    history: cleanSentences(character.history) || "",
    personality: cleanSentences(character.personality),
    physicalDescription: cleanSentences(character.physicalDescription),
    speechStyle: cleanSentences(character.speechStyle),
    psychologicalProfile: cleanSentences(character.psychologicalProfile),
    backstory: cleanSentences(character.backstory),
    motivations: cleanSentences(character.motivations),
    relationships: cleanSentences(character.relationships),
    notes: cleanSentences(character.notes),
  };
}

function estimateCharacterEvidence(
  character: ImportedCharacter,
  evidenceText: string
) {
  const canonicalName = resolveCanonicalCharacterName(
    character.name,
    evidenceText
  );
  const parts = compactWhitespace(canonicalName)
    .split(" ")
    .filter(part => part.length >= 3);
  const firstName = parts[0] || canonicalName;
  const surnameTerms = parts.slice(1).filter(part => part.length >= 4);
  const exactCount = countTermOccurrences(evidenceText, canonicalName);
  const firstNameCount = countTermOccurrences(evidenceText, firstName);
  const surnameCount = surnameTerms.reduce(
    (total, term) => total + countTermOccurrences(evidenceText, term),
    0
  );
  const roleText = normalizeSearchText(character.role || "");
  const score = exactCount * 4 + firstNameCount + surnameCount * 2;
  const hasEvidence =
    exactCount > 0 ||
    firstNameCount >= 2 ||
    (firstNameCount > 0 && surnameCount > 0);
  const primaryByRole =
    /\b(protagonista|antagonista principal|principal)\b/.test(roleText);
  const primary = primaryByRole || exactCount >= 4 || score >= 18;
  const secondary =
    primary ||
    exactCount >= 2 ||
    score >= 6 ||
    /\b(antagonista|aliad|mentor|secundari|coadjuvante|recorrente)\b/.test(
      roleText
    );

  return {
    canonicalName,
    hasEvidence,
    level: primary ? "primary" : secondary ? "secondary" : "incidental",
    score,
  } as const;
}

function groundImportedCharacters(
  characters: ImportedCharacter[],
  evidenceText: string
) {
  const grounded: ImportedCharacter[] = [];

  for (const character of characters) {
    const evidence = estimateCharacterEvidence(character, evidenceText);
    if (!evidence.hasEvidence) continue;
    const sanitized = sanitizeCharacterFactualClaims(
      { ...character, name: evidence.canonicalName },
      evidenceText
    );
    const normalized: ImportedCharacter = {
      ...sanitized,
      name: evidence.canonicalName,
    };

    grounded.push(normalized);
  }

  return mergeImportedCharacters(grounded, []);
}

function limitUniverseFieldWords(profile: UniverseProfileData) {
  const limits: Record<keyof UniverseProfileData, number> = {
    overview: 130,
    genre: 80,
    timePeriod: 95,
    locations: 180,
    narrativeStructure: 130,
    pov: 95,
    chapterStructure: 120,
    lore: 180,
    powerRules: 150,
    factions: 160,
    timeline: 240,
    socialRules: 130,
    themesTone: 110,
    continuityConstraints: 180,
    openQuestions: 120,
    notes: 0,
  };

  const next = { ...profile };
  for (const key of UNIVERSE_PROFILE_FIELD_KEYS) {
    const limit = limits[key];
    if (limit <= 0) {
      if (key === "notes") next[key] = "";
      continue;
    }
    next[key] = limitWords(next[key] || "", limit);
  }
  return next;
}

function buildCharacterExtractionSource(input: {
  content: string;
  summary: string;
  summarySections: ReferenceSummarySection[];
}) {
  const original = input.content.trim();
  const summary = input.summarySections.length
    ? input.summarySections
        .map(section => `${section.label}\n${section.content.trim()}`)
        .join("\n\n")
    : input.summary.trim();

  return [
    summary
      ? `Mapa narrativo gerado anteriormente (use apenas como apoio, não como fonte única):\n${summary}`
      : "",
    `Texto original integral da referência:\n${original}`,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function inferCharacterRoleFromText(text: string) {
  if (/\bprotagonista\b/i.test(text)) return "Protagonista";
  if (/\bantagonista\b/i.test(text)) return "Antagonista";
  if (/\bmentor(?:a)?\b/i.test(text)) return "Mentor";
  if (/\baliad[oa]\b/i.test(text)) return "Aliado";
  if (/\bsecund[aá]ri[oa]\b/i.test(text)) return "Secundário";
  if (/\bcoadjuvante\b/i.test(text)) return "Coadjuvante";
  return undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLikelyRussianPatronymic(value: string) {
  return /(?:ovich|evich|vich|ich|ovna|evna|ichna|inichna)$/i.test(
    value.trim()
  );
}

const CANONICAL_NAME_PREFIX_STOPWORDS = new Set(
  [
    "Dr",
    "Dra",
    "Doutor",
    "Doutora",
    "Sr",
    "Sra",
    "Senhor",
    "Senhora",
    "Capitão",
    "Capitao",
    "Comandante",
    "General",
    "Coronel",
    "Diretor",
    "Professor",
    "Professora",
    "Agente",
    "Para",
    "Era",
    "Eram",
    "Capitulo",
    "Capítulo",
    "Prólogo",
    "Prologo",
    "Epílogo",
    "Epilogo",
    "Tchecoslováquia",
    "Tchecoslovaquia",
  ].map(term => normalizeSearchText(term))
);

function resolveCanonicalCharacterName(name: string, sourceText: string) {
  const parts = compactWhitespace(name).split(" ");
  const firstName = parts[0];
  if (!firstName || !sourceText.trim()) return name;

  const needsSourceCheck =
    parts.length === 1 ||
    parts.slice(1).some(part => isLikelyRussianPatronymic(part));
  if (!needsSourceCheck) return name;

  const candidateCounts = new Map<string, number>();
  const nameWord = `[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+`;
  const matcher = new RegExp(
    `(^|[^A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç])${escapeRegExp(firstName)}\\s+(${nameWord})`,
    "g"
  );
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(sourceText)) !== null) {
    const candidate = (match[2] || "")
      .replace(/[.,;:!?()[\]{}"“”]+$/g, "")
      .trim();
    if (!candidate) continue;
    if (candidate.toLowerCase() === firstName.toLowerCase()) continue;
    if (isLikelyRussianPatronymic(candidate)) continue;
    const fullName = `${firstName} ${candidate}`;
    candidateCounts.set(fullName, (candidateCounts.get(fullName) || 0) + 1);
  }

  if (parts.length === 1) {
    const previousMatcher = new RegExp(
      `\\b(${nameWord})\\s+${escapeRegExp(firstName)}\\b`,
      "g"
    );
    while ((match = previousMatcher.exec(sourceText)) !== null) {
      const candidate = (match[1] || "")
        .replace(/[.,;:!?()[\]{}"“”]+$/g, "")
        .trim();
      if (!candidate) continue;
      if (CANONICAL_NAME_PREFIX_STOPWORDS.has(normalizeSearchText(candidate)))
        continue;
      if (candidate.toLowerCase() === firstName.toLowerCase()) continue;
      if (isLikelyRussianPatronymic(candidate)) continue;
      const fullName = `${candidate} ${firstName}`;
      candidateCounts.set(fullName, (candidateCounts.get(fullName) || 0) + 1);
    }
  }

  const sortedCandidates = Array.from(candidateCounts.entries()).sort(
    (left, right) => right[1] - left[1]
  );
  const bestCandidate = sortedCandidates[0]?.[0] ?? "";
  const bestCount = sortedCandidates[0]?.[1] ?? 0;
  if (parts.length === 1 && bestCount < 2) return name;
  return bestCandidate || name;
}

function findCharacterEvidenceSnippets(
  name: string,
  sourceText: string,
  maxSnippets = 4
) {
  const normalizedSource = sourceText.replace(/\r/g, "").trim();
  if (!normalizedSource) return [];

  const parts = compactWhitespace(name).split(" ").filter(Boolean);
  const firstName = parts[0];
  const terms = [
    name,
    parts.length > 1 ? firstName : "",
    ...parts.slice(1).filter(part => part.length >= 4),
  ]
    .filter(Boolean)
    .map(term => term.toLowerCase());

  const paragraphs = normalizedSource
    .split(/\n{2,}/)
    .map(paragraph => compactWhitespace(paragraph))
    .filter(paragraph => paragraph.length >= 60);

  const snippets: string[] = [];
  const seen = new Set<string>();
  for (const paragraph of paragraphs) {
    const lowered = paragraph.toLowerCase();
    if (!terms.some(term => lowered.includes(term))) continue;
    const clipped =
      paragraph.length > 620
        ? `${sliceAtWordBoundary(paragraph, 620).trim()}...`
        : paragraph;
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(clipped);
    if (snippets.length >= maxSnippets) break;
  }

  return snippets;
}

function buildSourceBackedCharacterHistory(
  name: string,
  sourceText: string
) {
  const snippets = findCharacterEvidenceSnippets(name, sourceText);
  if (!snippets.length) return "";

  return [
    "Evidências no texto original:",
    ...snippets.map(snippet => `- ${snippet}`),
  ].join("\n");
}

const DOSSIER_SECTION_HEADINGS = [
  "MEMÓRIA FACTUAL DO BLOCO",
  "Personagens em cena",
  "Eventos e ações em ordem",
  "Relações e tensões",
  "Revelações, pistas e segredos",
  "Lugares, objetos, regras e instituições",
  "Estado emocional e psicológico",
  "Falas ou gestos que mudam a cena",
  "Estado final do bloco",
  "Alertas de continuidade",
] as const;

const NON_CHARACTER_DOSSIER_TERMS = new Set(
  [
    "Aura",
    "Foco",
    "KGB",
    "CIA",
    "URSS",
    "SISA",
    "S.I.S.A",
    "S.I.S.A.",
    "Soldados",
    "Policiais",
    "Agentes",
    "Forças militares",
    "Forcas militares",
  ].map(term => normalizeSearchText(term).replace(/[^a-z0-9]+/g, " ").trim())
);

function cutAtNextDossierHeading(text: string, currentHeading?: string) {
  let earliest = -1;
  for (const heading of DOSSIER_SECTION_HEADINGS) {
    if (currentHeading && normalizeSearchText(heading) === normalizeSearchText(currentHeading)) {
      continue;
    }
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(heading)}\\s*:`, "i");
    const match = pattern.exec(text);
    if (!match) continue;
    const index = match.index;
    if (earliest === -1 || index < earliest) earliest = index;
  }
  return earliest >= 0 ? text.slice(0, earliest).trim() : text.trim();
}

function extractDossierSection(dossier: string, heading: string) {
  const lines = dossier.replace(/\r/g, "").split("\n");
  const headingPattern = new RegExp(`^\\s*${escapeRegExp(heading)}\\s*:?`, "i");
  const anyHeadingPattern = new RegExp(
    `^\\s*(?:${DOSSIER_SECTION_HEADINGS.map(escapeRegExp).join("|")})\\s*:?`,
    "i"
  );
  const normalizedHeading = normalizeEvidenceText(heading);
  const normalizedHeadings = DOSSIER_SECTION_HEADINGS.map(item =>
    normalizeEvidenceText(item)
  );
  const matchHeadingLength = (line: string) => {
    const direct = line.match(headingPattern);
    if (direct) return direct[0].length;

    const leading = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.slice(leading);
    const normalized = normalizeEvidenceText(trimmed);
    if (!normalized.startsWith(normalizedHeading)) return null;
    const colonIndex = trimmed.indexOf(":");
    return leading + (colonIndex >= 0 ? colonIndex + 1 : trimmed.length);
  };
  const isAnyHeadingLine = (line: string) => {
    if (anyHeadingPattern.test(line)) return true;
    const normalized = normalizeEvidenceText(line);
    return normalizedHeadings.some(item => normalized.startsWith(item));
  };
  const collected: string[] = [];
  let active = false;

  for (const line of lines) {
    if (!active) {
      const matchLength = matchHeadingLength(line);
      if (matchLength === null) continue;
      active = true;
      const remainder = cutAtNextDossierHeading(
        line.slice(matchLength).trim(),
        heading
      );
      if (remainder) collected.push(remainder);
      continue;
    }

    if (isAnyHeadingLine(line)) break;
    const safeLine = cutAtNextDossierHeading(line);
    if (safeLine) collected.push(safeLine);
    if (safeLine !== line.trim()) break;
  }

  return collected.join("\n").trim();
}

function isLikelyDossierCharacterName(name: string) {
  const cleaned = cleanDossierCharacterName(name);
  if (!cleaned) return false;
  if (/[.]/.test(cleaned)) return false;
  const normalized = normalizeSearchText(cleaned)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized || NON_CHARACTER_DOSSIER_TERMS.has(normalized)) return false;
  if (
    /\b(cidade|pais|pa[ií]s|reino|imp[eé]rio|rep[uú]blica|vila|bairro|lago|rio|montanha|floresta|castelo|hotel|caf[eé]|casa|pal[aá]cio|organiza[cç][aã]o|institui[cç][aã]o|fac[cç][aã]o|ex[eé]rcito|pol[ií]cia|governo|partido|empresa|fam[ií]lia|linhagem|conceito|regra|poder|for[cç]a|magia|habilidade|t[eé]cnica|variedade|classe|objeto|documento|tratado|op[eçc][aã]o|opera[cç][aã]o)\b/i.test(
      cleaned
    )
  ) {
    return false;
  }
  if (/^(?:Estados|Uni[aã]o|Reino|Rep[uú]blica|Imp[eé]rio)\b/i.test(cleaned)) {
    return false;
  }
  if (/^[A-Z0-9.]{2,}$/.test(cleaned)) return false;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length > 5) return false;
  if (parts.some(part => /^\d+$/.test(part))) return false;
  const first = normalizeSearchText(parts[0] || "");
  if (CANONICAL_NAME_PREFIX_STOPWORDS.has(first)) return false;
  if (NON_CHARACTER_DOSSIER_TERMS.has(first)) return false;
  return true;
}

function cleanDossierCharacterName(name: string) {
  return compactWhitespace(name)
    .replace(/^(?:Era|Eram|Para|Mencionados|Referenciados|Referenciadas)\s+/i, "")
    .replace(/^(?:Em|No|Na|Nos|Nas|Proposta|Operação|Operacao|Missão|Missao)\s+/i, "")
    .replace(/^(?:Dr\.?|Dra\.?|Doutor(?:a)?|Capit[aã]o|Comandante|General|Coronel|Diretor(?:a)?|Professor(?:a)?|Senhor(?:a)?)\s+/i, "")
    .replace(/[.,;:!?()[\]{}"“”]+$/g, "")
    .trim();
}

function findDossierEvidenceSnippets(
  name: string,
  analysisBlocks: ReferenceAnalysisBlock[],
  maxSnippets = 3
) {
  const terms = characterNameVariants(name);
  const snippets: string[] = [];
  const seen = new Set<string>();

  for (const block of analysisBlocks.slice().sort((a, b) => a.index - b.index)) {
    const text = compactWhitespace(block.dossier);
    const normalized = normalizeEvidenceText(text);
    if (!terms.some(term => normalized.includes(term))) continue;
    const clipped =
      text.length > 520 ? `${sliceAtWordBoundary(text, 520).trim()}...` : text;
    const key = normalizeSearchText(clipped);
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(`[${block.title}] ${clipped}`);
    if (snippets.length >= maxSnippets) break;
  }

  return snippets;
}

type DossierCharacterCandidate = {
  name: string;
  firstBlock: number;
  lastBlock: number;
  blockIndexes: number[];
  sourceMentions: number;
  totalBlocks: number;
  score: number;
  snippets: string[];
};

function buildCharacterFocusedDossierSnippet(
  name: string,
  block: ReferenceAnalysisBlock
) {
  const terms = characterNameVariants(name);
  const normalizedBlock = normalizeEvidenceText(block.dossier);
  if (!terms.some(term => normalizedBlock.includes(term))) return "";

  const sectionHeadings = [
    "Personagens em cena",
    "Eventos e ações em ordem",
    "Relações e tensões",
    "Revelações, pistas e segredos",
    "Estado emocional e psicológico",
    "Falas ou gestos que mudam a cena",
    "Estado final do bloco",
    "Alertas de continuidade",
  ];
  const selectedSections = sectionHeadings
    .map(heading => {
      const content = extractDossierSection(block.dossier, heading);
      return content ? `${heading}: ${content}` : "";
    })
    .filter(Boolean);

  const content = selectedSections.length
    ? selectedSections.join("\n")
    : block.dossier;
  const clipped = limitWords(compactWhitespace(content), CHAPTER_DOSSIER_MAX_WORDS);
  return clipped
    ? `[BLOCO ${block.index}] ${block.title}\n${clipped}`
    : "";
}

function collectDossierCharacterCandidates(input: {
  analysisBlocks: ReferenceAnalysisBlock[];
  sourceContent?: string;
  targetCharacterNames?: string[];
}) {
  const evidenceText = [
    input.sourceContent || "",
    buildAnalysisBlocksContent(input.analysisBlocks),
  ]
    .filter(Boolean)
    .join("\n\n");
  const candidates = new Map<string, DossierCharacterCandidate>();
  const targetNames = input.targetCharacterNames?.filter(Boolean) ?? [];
  const forcedTargetNames = new Set<string>();

  const addCandidate = (rawName: string, block?: ReferenceAnalysisBlock) => {
    const cleaned = cleanDossierCharacterName(rawName);
    if (!isLikelyDossierCharacterName(cleaned)) return;
    const name = cleanDossierCharacterName(
      resolveCanonicalCharacterName(cleaned, evidenceText)
    );
    if (!isLikelyDossierCharacterName(name)) return;
    const normalizedName = name.toLowerCase();
    const current =
      candidates.get(normalizedName) ?? {
        name,
        firstBlock: block?.index ?? 9999,
        lastBlock: block?.index ?? 0,
        blockIndexes: [],
        sourceMentions: 0,
        totalBlocks: input.analysisBlocks.length,
        score: 0,
        snippets: [],
      };
    current.firstBlock = Math.min(current.firstBlock, block?.index ?? 9999);
    current.lastBlock = Math.max(current.lastBlock, block?.index ?? 0);
    current.score += 1 + countTermOccurrences(evidenceText, name);
    candidates.set(normalizedName, current);
  };

  for (const targetName of targetNames) {
    const cleaned = cleanDossierCharacterName(targetName);
    const canonical = resolveCanonicalCharacterName(cleaned, evidenceText);
    if (canonical) forcedTargetNames.add(canonical.toLowerCase());
    addCandidate(targetName);
  }

  for (const block of input.analysisBlocks.slice().sort((a, b) => a.index - b.index)) {
    const section = extractDossierSection(block.dossier, "Personagens em cena");
    if (!section || /nenhum|não identificado/i.test(section)) continue;

    const rawNames = Array.from(section.matchAll(
      /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+(?:\s+(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+|da|de|do|dos|das|van|von)){0,4}/g
    ));
    rawNames.forEach(match => addCandidate(match[0], block));
  }

  const orderedBlocks = input.analysisBlocks.slice().sort((a, b) => a.index - b.index);
  for (const candidate of Array.from(candidates.values())) {
    const terms = characterNameVariants(candidate.name);
    for (const block of orderedBlocks) {
      const normalizedBlock = normalizeEvidenceText(block.dossier);
      if (!terms.some(term => normalizedBlock.includes(term))) continue;
      const snippet = buildCharacterFocusedDossierSnippet(candidate.name, block);
      if (snippet) {
        candidate.snippets.push(snippet);
        candidate.firstBlock = Math.min(candidate.firstBlock, block.index);
        candidate.lastBlock = Math.max(candidate.lastBlock, block.index);
        if (!candidate.blockIndexes.includes(block.index)) {
          candidate.blockIndexes.push(block.index);
        }
      }
    }
    candidate.sourceMentions = countCharacterMentions(
      input.sourceContent || "",
      candidate.name
    );
    candidate.totalBlocks = orderedBlocks.length;
  }

  const candidateList = Array.from(candidates.values());
  const exactSourceMentionsFor = (candidate: DossierCharacterCandidate) =>
    countTermOccurrences(input.sourceContent || "", candidate.name);
  const hasStrongerSameFirstName = (candidate: DossierCharacterCandidate) => {
    const firstName = firstCharacterNameToken(candidate.name);
    if (!firstName) return false;
    const exactMentions = exactSourceMentionsFor(candidate);
    if (exactMentions > 1) return false;
    return candidateList.some(other => {
      if (other.name === candidate.name) return false;
      if (firstCharacterNameToken(other.name) !== firstName) return false;
      return (
        exactSourceMentionsFor(other) > exactMentions &&
        other.score >= candidate.score
      );
    });
  };

  return candidateList
    .filter(candidate => candidate.snippets.length > 0)
    .filter(
      candidate => {
        const sourceMentions = countTermOccurrences(
          input.sourceContent || "",
          candidate.name
        );
        const nameParts = compactWhitespace(candidate.name).split(/\s+/);
        if (forcedTargetNames.has(candidate.name.toLowerCase())) return true;
        if (nameParts.length > 1 && hasStrongerSameFirstName(candidate)) {
          return false;
        }
        const hasPersonSignal = dossierCandidateHasPersonSignal(candidate);
        if (nameParts.length <= 1) {
          if (!hasPersonSignal) return false;
          return candidate.snippets.length >= 1 && sourceMentions >= 1;
        }
        if (
          !hasPersonSignal &&
          sourceMentions < 2 &&
          candidate.snippets.length < 2 &&
          candidate.score < 18
        ) {
          return false;
        }
        return (
          candidate.snippets.length >= 2 ||
          sourceMentions >= 2 ||
          candidate.score >= 18
        );
      }
    )
    .sort(
      (left, right) =>
        right.score - left.score || left.firstBlock - right.firstBlock
    );
}

function splitDossierStatements(section: string) {
  return section
    .replace(/\r/g, "")
    .split(/\n+/)
    .map(line =>
      compactWhitespace(
        line
          .replace(/^\s*(?:[-*•]\s+|\d+[.)]\s*)+/, "")
          .replace(/\s+-\s+/g, " — ")
      )
    )
    .filter(line => line.length >= 24);
}

function textMentionsCharacter(text: string, terms: string[]) {
  const normalized = normalizeEvidenceText(text);
  return terms.some(term => {
    if (!term || term.length < 3) return false;
    return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(normalized);
  });
}

function removeDossierNoise(value: string) {
  return compactWhitespace(value)
    .replace(/\[BLOCO\s+\d+\][^.!?;:]*/gi, " ")
    .replace(/\b(?:Personagens em cena|Eventos e ações em ordem|Referenciados|Resumo factual|Presença verificada)\s*:?/gi, " ")
    .replace(/\bMencionados\s*:/gi, " ")
    .replace(/\bReferenciados\s*:/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pushUniqueStatement(
  target: string[],
  seen: Set<string>,
  value: string
) {
  const cleaned = removeDossierNoise(value);
  if (!cleaned || cleaned.length < 24) return;
  const key = normalizeEvidenceText(cleaned);
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push(cleaned);
}

function collectCharacterStatementsFromSection(input: {
  section: string;
  terms: string[];
  maxFallbackItems?: number;
}) {
  const statements = splitDossierStatements(input.section);
  const selected = statements.filter(statement =>
    textMentionsCharacter(statement, input.terms)
  );
  if (selected.length) return selected;
  return statements.slice(0, input.maxFallbackItems ?? 0);
}

type CharacterNarrativeFact = {
  text: string;
  blockIndex: number;
  blockTitle: string;
  kind:
    | "event"
    | "revelation"
    | "final"
    | "emotion"
    | "relationship"
    | "continuity";
};

function normalizeLeadingDossierSubjectLabel(value: string) {
  const text = compactWhitespace(value);
  const match = text.match(
    /^([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*)?(?:\s+(?:e|&|vs)\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*)?){0,3})\s*:\s*(.+)$/i
  );
  if (!match?.[1] || !match[2]) return text;

  const label = compactWhitespace(match[1]);
  const rest = compactWhitespace(match[2]);
  if (!rest) return "";
  const duelMatch = label.match(
    /^([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*)?)\s+vs\s+/i
  );
  if (duelMatch?.[1]) {
    const subject = compactWhitespace(duelMatch[1]);
    if (/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ"“'’—–-]/.test(rest)) return rest;
    if (
      /^(?:paralisad[oa]|ferid[oa]|assustad[oa]|amedrontad[oa]|culpad[oa]|confus[oa]|nervos[oa]|exaust[oa]|desesperad[oa]|abalad[oa]|traumatizad[oa]|inconsciente|desacordad[oa])\b/i.test(
        rest
      )
    ) {
      return `${subject} fica ${rest}`;
    }
    return `${subject} ${rest}`;
  }
  if (/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ"“'’—–-]/.test(rest)) return rest;
  if (
    /^(?:paralisad[oa]|ferid[oa]|assustad[oa]|amedrontad[oa]|culpad[oa]|confus[oa]|nervos[oa]|exaust[oa]|desesperad[oa]|abalad[oa]|traumatizad[oa]|inconsciente|desacordad[oa])\b/i.test(
      rest
    )
  ) {
    return `${label} fica ${rest}`;
  }
  if (/^(?:confus[aã]o|medo|culpa|raiva|luto|vergonha|pavor|choque|tristeza|d[uú]vida)\b/i.test(rest)) {
    return `${label} demonstra ${rest}`;
  }
  return `${label} ${rest}`;
}

function stripDossierSourceLabels(value: string) {
  return normalizeLeadingDossierSubjectLabel(removeDossierNoise(value))
    .replace(/^\s*Em\s+(?:CAP[IÍ]TULO|PR[OÓ]LOGO|EP[IÍ]LOGO|KGB|BLOCO|PARTE)\b[^,.:;!?]{0,140}[,.:;!?]\s*/i, "")
    .replace(/^\s*Em\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9][^,.:;!?]{0,140}[,.:;!?]\s*/i, "")
    .replace(/\bCena curta\s*:\s*/gi, "")
    .replace(/^\s*(?:Transi[cç][aã]o\s+para|Cena\s+corta)\s*:?\s*/i, "")
    .replace(/\bparte\s+\d+\s*\/\s*\d+\s*,?\s*/gi, "")
    .replace(/\bcap[ií]tulo\s+\d+\s*[-–—:]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeManipulatedCharacterFact(value: string) {
  const text = compactWhitespace(value);
  if (
    /\bagente\s+duplo\b/i.test(text) &&
    /\b(controlad[oa]|manipula[cç][aã]o|mem[oó]ria\s+bloquead[ao]|esque[cç]a|sem saber)\b/i.test(text)
  ) {
    return text
      .replace(/\bum\s+agente\s+duplo\s+controlad[oa]\b/gi, "uma peça manipulada")
      .replace(/\buma\s+agente\s+duplo\s+controlad[oa]\b/gi, "uma peça manipulada")
      .replace(/\bagente\s+duplo\b/gi, "agente manipulado");
  }
  return text;
}

function cleanCharacterNarrativeFact(value: string) {
  return sanitizeManipulatedCharacterFact(stripDossierSourceLabels(value))
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pushUniqueFact(
  target: CharacterNarrativeFact[],
  seen: Set<string>,
  fact: CharacterNarrativeFact
) {
  const cleaned = cleanCharacterNarrativeFact(fact.text);
  if (!cleaned || cleaned.length < 24) return;
  const key = normalizeEvidenceText(cleaned);
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push({ ...fact, text: cleaned });
}

function extractSelfDescriptorsForCharacter(name: string, snippets: string[]) {
  const parts = compactWhitespace(name).split(" ").filter(Boolean);
  const lookupNames = Array.from(
    new Set([
      name,
      parts[0] || "",
      ...parts.slice(1).filter(part => part.length >= 4),
    ].filter(Boolean))
  );
  const descriptors: string[] = [];
  const seen = new Set<string>();

  for (const snippet of snippets) {
    for (const lookupName of lookupNames) {
      const pattern = new RegExp(
        `\\b${escapeRegExp(lookupName)}\\s*\\(([^)]{2,160})\\)`,
        "gi"
      );
      const isSurnameOnlyLookup =
        lookupName !== name &&
        lookupName !== (parts[0] || "") &&
        parts.slice(1).includes(lookupName);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(snippet)) !== null) {
        if (isSurnameOnlyLookup) {
          const before = snippet.slice(Math.max(0, match.index - 48), match.index);
          if (
            /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+\s+$/.test(
              before
            )
          ) {
            continue;
          }
        }
        const descriptor = compactWhitespace(match[1] || "");
        const key = normalizeEvidenceText(descriptor);
        if (
          !descriptor ||
          /\b(?:n[aã]o confirmado|nao confirmado|possa ser|pode ser|talvez|incerto)\b/i.test(
            descriptor
          ) ||
          seen.has(key)
        )
          continue;
        seen.add(key);
        descriptors.push(descriptor);
      }
    }
  }

  return descriptors;
}

function extractIdentityDescriptor(text: string) {
  const normalized = compactWhitespace(text);
  const patterns = [
    /\b(?:diretor(?:a)?(?:-geral| geral)?|ex-diretor(?:a)?(?:-geral| geral)?|chefe|ex-chefe|l[ií]der|general|comandante|capit[aã]o|capit[aã]|rei|rainha|pr[ií]ncipe|princesa|duque|duquesa|ministro|ministra|presidente)\s+(?:da|do|de|dos|das)\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^,.!?;]{1,80}/i,
    /\b(?:diretor(?:-geral| geral)?|ex-diretor(?:-geral| geral)?|chefe|ex-chefe)\s+da\s+KGB\b/i,
    /\bagente\s+da\s+CIA\b/i,
    /\bm[eé]dico\s+(?:aprimorado|da\s+CIA|americano)\b/i,
    /\b(?:m[eé]dic[oa]|professor(?:a)?|estudante|investigador(?:a)?|espi[aã]o|agente|guarda|soldad[oa]|jornalista|herdeir[oa]|nobre|servo|serva|sacerdote|sacerdotisa|mago|maga|brux[ao]|crian[cç]a|adolescente|jovem|garot[ao])(?:\s+[a-záàâãéêíóôõúüç-]+){0,4}\b/i,
    /\bjornalista\b/i,
    /\bLocalizadora\b/i,
    /\bIntensificador\b/i,
    /\bManipulador\b/i,
    /\bsoldado\s+(?:raso|do\s+ex[eé]rcito)\b/i,
    /\bsubordinad[oa]\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
    /\bm[aã]e\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
    /\bpai\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
    /\bamig[oa]\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
    /\bmentor\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
    /\bprotagonista\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[0]) return compactWhitespace(match[0]);
  }
  return "";
}

function extractCharacterIdentityDescriptor(candidate: DossierCharacterCandidate) {
  const nameParts = compactWhitespace(candidate.name).split(/\s+/).filter(Boolean);
  const terms = (
    nameParts.length > 1 ? [candidate.name] : characterNameVariants(candidate.name)
  )
    .filter(term => term.length >= 3)
    .sort((left, right) => right.length - left.length);
  const statements = characterFocusedEvidenceStatements(candidate);
  const descriptorPatterns = [
    /\b(?:diretor(?:a)?(?:-geral| geral)?|ex-diretor(?:a)?(?:-geral| geral)?|chefe|ex-chefe|l[ií]der|general|comandante|capit[aã]o|capit[aã]|rei|rainha|pr[ií]ncipe|princesa|duque|duquesa|ministro|ministra|presidente)\s+(?:da|do|de|dos|das)\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^,.!?;]{1,80}/i,
    /\b(?:diretor(?:-geral| geral)?|ex-diretor(?:-geral| geral)?|chefe|ex-chefe)\s+da\s+KGB\b/i,
    /\bagente\s+da\s+CIA\b/i,
    /\bm[eé]dico\s+(?:aprimorado|da\s+CIA|americano)\b/i,
    /\b(?:m[eé]dic[oa]|professor(?:a)?|estudante|investigador(?:a)?|espi[aã]o|agente|guarda|soldad[oa]|jornalista|herdeir[oa]|nobre|servo|serva|sacerdote|sacerdotisa|mago|maga|brux[ao]|crian[cç]a|adolescente|jovem|garot[ao])(?:\s+[a-záàâãéêíóôõúüç-]+){0,4}\b/i,
    /\bjornalista\b/i,
    /\bLocalizadora\b/i,
    /\bIntensificador\b/i,
    /\bManipulador\b/i,
    /\bsoldado\s+(?:raso|do\s+ex[eé]rcito)\b/i,
    /\bsubordinad[oa]\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
    /\bm[aã]e\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
    /\bpai\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
    /\bamig[oa]\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
    /\bmentor\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\s,.]+/i,
  ];

  for (const statement of statements) {
    for (const term of terms) {
      const exactTerm = escapeRegExp(term);
      const directPatterns = [
        new RegExp(`\\b${exactTerm}\\b\\s*(?:\\([^)]{2,140}\\))`, "i"),
        new RegExp(
          `\\b${exactTerm}\\b\\s+(?:é|é|era|foi|como)\\s+([^.!?;]{0,180})`,
          "i"
        ),
        new RegExp(
          `\\b(?:reconhece|identifica|apresenta|descreve|chama)\\s+\\b${exactTerm}\\b\\s+como\\s+([^.!?;]{0,180})`,
          "i"
        ),
      ];

      for (const pattern of directPatterns) {
        const match = statement.match(pattern);
        const candidateText = compactWhitespace(match?.[1] || match?.[0] || "");
        if (!candidateText) continue;
        const descriptor = extractIdentityDescriptor(candidateText);
        if (
          descriptor &&
          descriptorPatterns.some(descriptorPattern =>
            descriptorPattern.test(descriptor)
          )
        ) {
          return descriptor;
        }
      }
    }
  }

  return "";
}

function extractSourceIdentityDescriptor(name: string, sourceContent?: string) {
  const source = sourceContent?.replace(/\r/g, "").trim();
  if (!source) return "";
  const compactedName = compactWhitespace(name);
  const parts = compactedName.split(/\s+/).filter(Boolean);
  const literalCandidates = [
    compactedName,
    parts.length > 1 ? parts[0] : "",
    ...parts.slice(1).filter(part => part.length >= 4),
  ]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const variants = literalCandidates
    .map(variant => escapeRegExp(variant).replace(/\s+/g, "\\s+"))
    .filter(Boolean);
  if (!variants.length) return "";

  let match: RegExpExecArray | null = null;
  for (const variant of variants) {
    const candidateMatch = new RegExp(`\\b${variant}\\b`, "i").exec(source);
    if (!candidateMatch) continue;
    if (!match || candidateMatch.index < match.index) match = candidateMatch;
    if (literalCandidates[0] && variant.includes("\\s+")) {
      match = candidateMatch;
      break;
    }
  }
  if (!match) return "";
  const end = Math.min(source.length, match.index + 4200);
  const afterNameWindow = source.slice(match.index, end);
  const sourceSentences = splitCharacterSentences(afterNameWindow.slice(0, 3600));
  const nameTerms = characterNameVariants(name);
  const roleWords =
    "(jovem|adolescente|rapaz|garoto|garota|homem|mulher|crian[cç]a|soldad[oa]|estudante|m[eé]dic[oa]|jornalista|agente|investigador|investigadora|herdeir[oa]|professor|professora)";
  const targetPattern = nameTerms.length
    ? `(?:${nameTerms.map(escapeRegExp).join("|")})`
    : escapeRegExp(normalizeEvidenceText(name));
  const normalizeRole = (value: string | undefined) =>
    normalizeEvidenceText(value || "").replace(/^rapaz$/, "jovem");
  const extractRoleFromSentence = (sentence: string, ownsByPronoun: boolean) => {
    const normalized = normalizeEvidenceText(sentence);
    const direct = new RegExp(
      `\\b${targetPattern}\\b.{0,140}\\b(?:e|é|era|foi|como)\\s+(?:um|uma|o|a)?\\s*${roleWords}\\b`
    ).exec(normalized);
    if (direct?.[1]) return normalizeRole(direct[1]);
    if (ownsByPronoun) {
      const pronoun = new RegExp(
        `^(?:ele|ela)\\s+(?:e|é|era|foi|parece|parecia|surge|aparece)\\s+(?:um|uma|o|a)?\\s*${roleWords}\\b`
      ).exec(normalized);
      if (pronoun?.[1]) return normalizeRole(pronoun[1]);
    }
    return "";
  };
  let activeTargetSubject = false;
  const ownsSentence = (sentence: string) => {
    const normalized = normalizeEvidenceText(sentence);
    const mentionsTarget = nameTerms.some(term => normalized.includes(term));
    if (mentionsTarget) {
      activeTargetSubject = true;
      return true;
    }
    const otherNamePattern =
      /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+/g;
    const otherNames = Array.from(sentence.matchAll(otherNamePattern))
      .map(item => normalizeEvidenceText(item[0]))
      .filter(item => !nameTerms.includes(item));
    if (
      otherNames.length ||
      /^(?:o|a|um|uma)\s+(?:professor|professora|doutor|doutora|senhor|senhora|capitao|capita|comandante|general|rei|rainha|principe|princesa|homem|mulher)\b/.test(
        normalized
      )
    ) {
      activeTargetSubject = false;
    }
    return activeTargetSubject && /^(ele|ela)\b/.test(normalized);
  };
  let role = "";
  let age = "";
  for (const sentence of sourceSentences.slice(0, 24)) {
    const owned = ownsSentence(sentence);
    if (!owned) continue;
    const ownsByPronoun = /^(ele|ela)\b/.test(normalizeEvidenceText(sentence));
    if (!role) {
      role = extractRoleFromSentence(sentence, ownsByPronoun);
    }
    if (!age) {
      const ageMatch = sentence.match(
        /\b(?:completaria|completa|tinha|tem|teria|possui|possu[ií]a)\s+([A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç0-9 -]{1,32})\s+anos\b/i
      );
      if (ageMatch?.[1]) {
        age = compactWhitespace(ageMatch[1]).replace(
          /\b(?:de|do|da|dos|das)\s+$/i,
          ""
        );
      }
    }
    if (role && age) break;
  }
  if (role && age) return `${role} de ${age} anos`;
  if (role) return role;
  if (age) return `jovem de ${age} anos`;
  return "";
}

function characterFocusedEvidenceStatements(candidate: DossierCharacterCandidate) {
  const terms = characterNameVariants(candidate.name);
  return candidate.snippets
    .flatMap(snippet => splitCharacterSentences(snippet))
    .map(statement => cleanCharacterNarrativeFact(statement))
      .filter(statement => textMentionsCharacter(statement, terms));
}

function characterSubjectStatements(candidate: DossierCharacterCandidate) {
  const terms = characterNameVariants(candidate.name);
  return characterFocusedEvidenceStatements(candidate).filter(statement => {
    const normalized = normalizeEvidenceText(statement);
    return terms.some(term =>
      new RegExp(`(?:^|[.!?;]\\s*)${escapeRegExp(term)}\\b`).test(normalized)
    );
  });
}

function characterHasIdentityDescriptor(
  candidate: DossierCharacterCandidate,
  pattern: RegExp
) {
  const terms = characterNameVariants(candidate.name);
  const statements = characterFocusedEvidenceStatements(candidate);
  return statements.some(statement => {
    const normalized = normalizeEvidenceText(statement);
    return terms.some(term => {
      const termPattern = escapeRegExp(term);
      const directDescriptorPatterns = [
        new RegExp(
          `\\b${termPattern}\\b\\s*\\([^)]*${pattern.source}[^)]*\\)`
        ),
        new RegExp(
          `(?:^|[.!?;]\\s*)\\b${termPattern}\\b\\s+(?:e|é|era|foi|atua|age)\\s+(?:como\\s+)?(?:um|uma|o|a)?\\s*${pattern.source}`
        ),
        new RegExp(
          `\\b(?:descreve|apresenta|identifica|reconhece|chama)\\s+\\b${termPattern}\\b\\s+como\\s+(?:um|uma|o|a)?\\s*${pattern.source}`
        ),
      ];
      return directDescriptorPatterns.some(descriptorPattern =>
        descriptorPattern.test(normalized)
      );
    });
  });
}

function characterHasSubjectAction(
  candidate: DossierCharacterCandidate,
  pattern: RegExp
) {
  const terms = characterNameVariants(candidate.name);
  const statements = characterSubjectStatements(candidate);
  return statements.some(statement => {
    const normalized = normalizeEvidenceText(statement);
    return terms.some(term => {
      const subjectPattern = new RegExp(
        `(?:^|[.!?;]\\s*|\\bque\\s+)${escapeRegExp(term)}\\b`,
        "g"
      );
      let match: RegExpExecArray | null = null;
      while ((match = subjectPattern.exec(normalized))) {
        const after = normalized.slice(match.index + match[0].length);
        const action = new RegExp(pattern.source).exec(after.slice(0, 80));
        if (!action) continue;
        const between = after.slice(0, action.index);
        if (between.length > 48) continue;
        if (/\b(?:que|porque|pois|quando|enquanto)\b/.test(between)) continue;
        return true;
      }
      return false;
    });
  });
}

function dossierCandidateHasPersonSignal(candidate: DossierCharacterCandidate) {
  const descriptors = extractSelfDescriptorsForCharacter(
    candidate.name,
    candidate.snippets
  );
  const descriptorText = normalizeEvidenceText(descriptors.join(" "));
  if (
    /\b(cidade|pais|pa[ií]s|capital|vila|bairro|lago|rio|floresta|castelo|hotel|caf[eé]|instituicao|institui[cç][aã]o|organizacao|organiza[cç][aã]o|fac[cç][aã]o|familia|fam[ií]lia|linhagem|regra|poder|variedade|conceito|documento|tratado|operacao|opera[cç][aã]o|missao|miss[aã]o)\b/.test(
      descriptorText
    )
  ) {
    return false;
  }
  if (
    /\b(protagonista|antagonista|aliad|mentor|amig|companheir|pai|mae|m[aã]e|filh|irmao|irm[aã]|soldad|agente|espiao|espi[aã]|medic|m[eé]dic|jornalista|professor|professora|diretor|diretora|chefe|general|comandante|capitao|capit[aã]o|rei|rainha|principe|pr[ií]ncipe|princesa|duque|duquesa|herdeir|nobre|servo|serva|crian[cç]a|adolescente|jovem|garot|homem|mulher|brux|mago|sacerdote|sacerdotisa)\b/.test(
      descriptorText
    )
  ) {
    return true;
  }

  const subjectText = normalizeEvidenceText(
    characterSubjectStatements(candidate).join(" ")
  );
  if (!subjectText) return false;
  return /\b(diz|fala|pergunta|responde|pede|decide|recusa|aceita|entra|sai|foge|retorna|chega|parte|procura|investiga|descobre|revela|mente|confessa|amea[cç]a|ordena|manda|trai|ajuda|protege|salva|captura|resgata|manipula|controla|mata|morre|sobrevive|confronta|enfrenta|chora|teme|desconfia|observa|entrega|recebe|carrega|luta|ataca|defende|sofre|lembra|esconde)\b/.test(
    subjectText
  );
}

function characterDossierBlockCount(candidate: DossierCharacterCandidate) {
  return candidate.blockIndexes.length || candidate.snippets.length;
}

function hasPrincipalNarrativeWeight(candidate: DossierCharacterCandidate) {
  const blockCount = characterDossierBlockCount(candidate);
  const totalBlocks = Math.max(candidate.totalBlocks || blockCount || 1, 1);
  const sourceMentions = candidate.sourceMentions || 0;
  const blockRatio = blockCount / totalBlocks;
  const minimumBroadBlocks = Math.min(
    totalBlocks,
    Math.max(5, Math.ceil(totalBlocks * 0.24))
  );

  if (totalBlocks <= 4) {
    return blockCount >= Math.max(2, Math.ceil(totalBlocks * 0.5));
  }
  if (blockCount >= minimumBroadBlocks) return true;
  if (blockRatio >= 0.18 && sourceMentions >= 24) return true;
  return sourceMentions >= 40 && blockCount >= 3;
}

function demotePrincipalRoleByPresence(candidate: DossierCharacterCandidate) {
  const blockCount = characterDossierBlockCount(candidate);
  if (blockCount >= 6 || (candidate.sourceMentions || 0) >= 18) {
    return "Personagem recorrente";
  }
  return "Personagem de apoio";
}

function antagonistRoleByPresence(
  candidate: DossierCharacterCandidate,
  hasPrincipalWeight: boolean
) {
  if (hasPrincipalWeight || (candidate.totalBlocks || 0) <= 4) {
    return "Antagonista";
  }
  return "Antagonista secundário";
}

function inferDossierCharacterRole(candidate: DossierCharacterCandidate) {
  const descriptors = extractSelfDescriptorsForCharacter(
    candidate.name,
    candidate.snippets
  );
  const descriptorText = normalizeEvidenceText(descriptors.join(" "));
  const identityDescriptor = normalizeEvidenceText(
    extractCharacterIdentityDescriptor(candidate)
  );
  const focusedText = normalizeEvidenceText(
    characterFocusedEvidenceStatements(candidate).join(" ")
  );
  const hasPrincipalWeight = hasPrincipalNarrativeWeight(candidate);
  if (/\bprotagonista\b/.test(descriptorText)) {
    return hasPrincipalWeight
      ? "Protagonista"
      : demotePrincipalRoleByPresence(candidate);
  }
  if (
    /\b(controlad|manipulad|memoria bloquead|memoria apagada|sem saber)\b/.test(
      focusedText
    ) &&
    !/\b(traidor|manipulador|antagonista)\b/.test(descriptorText)
  ) {
    return "Personagem de apoio";
  }
  const oppressiveActionPattern =
    /\b(ordena|ordenou|manda|mandou|tortura|torturou|captura|capturou|persegue|perseguiu|manipula|manipulou|controla|controlou|amea[cç]a|amea[cç]ou|chantageia|chantageou|trai|traiu|coage|coagiu|oprime|oprimiu|condena|condenou|aprisiona|aprisionou|interroga|interrogou|obriga|obrigou|sequestra|sequestrou|planeja|planejou)\b/;
  const powerRolePattern =
    /\b(chefe|diretor|diretora|diretor-geral|diretora-geral|lider|l[ií]der|general|comandante|capit[aã]o|capit[aã]|rei|rainha|pr[ií]ncipe|princesa|duque|duquesa|ministro|ministra|presidente|senhor|senhora|patriarca|matriarca)\b/;
  const hasPowerRole =
    powerRolePattern.test(identityDescriptor) ||
    /\b(?:chefe|diretor(?:a)?|diretor(?:a)?-geral|l[ií]der|general|comandante|capit[aã]o|capit[aã]|rei|rainha|pr[ií]ncipe|princesa|duque|duquesa|ministro|ministra|presidente|patriarca|matriarca)\b\s+(?:da|do|de|dos|das)\b/.test(
      descriptorText
    );
  const explicitMainAntagonist =
    /\b(antagonista principal|principal antagonista|vil[aã]o principal|vil[aã] principal)\b/.test(
      descriptorText
    );
  const antagonistDescriptor =
    /\b(antagonista|vil[aã]o|vil[aã]|inimig[oa]s?|opressor(?:a)?|traidor(?:a)?|manipulador(?:a)?|interrogador(?:a)?|executor(?:a)?)\b/.test(
      descriptorText
    );
  const mentorSignal =
    /\b(mentor|resgatador|salvador|treinador|orientador)\b/.test(
      descriptorText
    ) ||
    characterHasSubjectAction(
      candidate,
      /\b(orienta|orientou|treina|treinou|ensina|ensinou)\b/
    );
  const allyDescriptor =
    /\b(amig[oa]s?|companheir[oa]s?|aliad[oa]s?|protetor(?:a)?|parceir[oa]s?|recruta|soldad[oa]s?)\b/.test(
      descriptorText
    );
  if (mentorSignal && !antagonistDescriptor) return "Mentor";
  if (allyDescriptor && !antagonistDescriptor) return "Aliado";
  const localAntagonistSignal =
    antagonistDescriptor ||
    (hasPowerRole && oppressiveActionPattern.test(focusedText)) ||
    characterHasSubjectAction(
      candidate,
      /\b(trai|traiu|manipula|manipulou|controla|controlou|coage|coagiu|amea[cç]a|amea[cç]ou|tortura|torturou|persegue|perseguiu|oprime|oprimiu|ordena|ordenou|manda|mandou|obriga|obrigou|sequestra|sequestrou)\b/
    );
  if (
    hasPrincipalWeight &&
    (explicitMainAntagonist ||
      (hasPowerRole && oppressiveActionPattern.test(focusedText)))
  ) {
    return "Antagonista principal";
  }
  if (localAntagonistSignal) {
    return antagonistRoleByPresence(candidate, hasPrincipalWeight);
  }
  if (/\b(mae|m[aã]e|pai|filh[oa]s?|familia|fam[ií]lia)\b/.test(descriptorText))
    return "Família";
  if (
    /\b(controlad|manipulad|memoria bloquead|memoria apagada|sem saber)\b/.test(
      focusedText
    )
  ) {
    return "Personagem de apoio";
  }
  return candidate.snippets.length >= 10
    ? "Personagem recorrente"
    : "Personagem de apoio";
}

function roleForOpening(role: string | undefined) {
  const normalized = normalizeSearchText(role || "");
  if (/\bprotagonista\b/.test(normalized)) return "o protagonista da história";
  if (/\bantagonista principal\b|\bprincipal antagonista\b/.test(normalized)) {
    return "o principal antagonista da história";
  }
  if (/\bantagonista secund/.test(normalized)) {
    return "um antagonista secundário da história";
  }
  if (/\bantagonista\b/.test(normalized)) return "um antagonista da história";
  if (/\bmentor\b/.test(normalized)) return "uma figura de mentor na história";
  if (/\baliad/.test(normalized)) return "um aliado importante na história";
  if (/\bfamilia\b|\bfam[ií]lia\b/.test(normalized))
    return "uma figura familiar relevante na história";
  if (/\brecorrente\b/.test(normalized))
    return "um personagem recorrente da história";
  return "um personagem de apoio na história";
}

function cleanOpeningDescriptor(value: string) {
  const descriptor = compactWhitespace(value)
    .replace(/\b(?:importado|principal|recorrente|personagem|figura)\b/gi, "")
    .replace(/\b(?:protagonista|antagonista|aliado|aliada|mentor|mentora)\b/gi, "")
    .replace(/[()]+/g, " ")
    .replace(
      /\s+\b(?:amig[oa]|companheir[oa]|aliad[oa]|parceir[oa])\s+de\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^,.!?;]+$/i,
      ""
    )
    .replace(/\s+\b(?:em|no|na)\s+\d{1,2}\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
    .trim();
  if (!descriptor) return "";
  if (/^(?:amig[oa]|companheir[oa]|aliad[oa]|parceir[oa])\s+de\b/i.test(descriptor)) {
    return "";
  }
  if (/^\d+(?:[,.]\d+)?\s*m(?:etro|etros)?\b/i.test(descriptor)) return "";
  if (/\b(cabelo|cabelos|olho|olhos|rosto|pele|altura|metro|metros|sarda|sardas|baixo|baixa|alto|alta|magro|magra|forte|ruivo|ruiva|loiro|loira|castanho|castanha|p[aá]lido|p[aá]lida)\b/i.test(descriptor)) {
    return "";
  }
  if (/\b(algemad[oa]|ferid[oa]|desacordad[oa]|inconsciente|presente|ausente|morto|morta|vivo|viva|sentad[oa]|deitad[oa]|armad[oa])\b/i.test(descriptor)) {
    return "";
  }
  if (descriptor.split(/\s+/).length > 12) return "";
  if (normalizeEvidenceText(descriptor).length < 4) return "";
  return descriptor;
}

function isWeakGenericOpeningDescriptor(value: string) {
  const normalized = normalizeEvidenceText(value);
  return /^(?:jovem|adolescente|crianca|criança|garoto|garota|homem|mulher|rapaz|moca|moça)$/.test(
    normalized
  );
}

function openingDescriptorScore(value: string) {
  const normalized = normalizeEvidenceText(value);
  let score = 0;
  if (/\b(diretor|diretora|chefe|lider|general|comandante|capitao|capita|rei|rainha|principe|princesa|duque|duquesa|presidente|ministro|ministra)\b/.test(normalized)) {
    score += 8;
  }
  if (/\b(jovem|adolescente|crianca|homem|mulher|garoto|garota|herdeiro|herdeira|soldado|agente|medico|medica|jornalista|professor|professora|estudante|espiao|espia|investigador|investigadora|nobre|servo|serva|guarda|sacerdote|sacerdotisa|mago|maga|bruxa|bruxo)\b/.test(normalized)) {
    score += 6;
  }
  if (/\b(de|da|do|dos|das)\b/.test(normalized)) score += 2;
  if (/\b(localizadora|localizador|intensificador|manipulador|versatilizador)\b/.test(normalized)) {
    score += 1;
  }
  if (/\b(lider)\b/.test(normalized) && normalized.split(/\s+/).length === 1) {
    score -= 4;
  }
  return score;
}

function selectOpeningDescriptor(
  descriptors: string[],
  fallbackDescriptor: string,
  role?: string
) {
  const normalizedRole = normalizeEvidenceText(role || "");
  const roleIsCore = /\b(protagonista|antagonista principal|principal)\b/.test(
    normalizedRole
  );
  const candidates = [
    ...descriptors.flatMap((descriptor, descriptorIndex) =>
      descriptor
        .split(/[,;/]+/)
        .map(cleanOpeningDescriptor)
        .filter(Boolean)
        .map(candidate => ({ value: candidate, priority: descriptorIndex }))
    ),
    {
      value: cleanOpeningDescriptor(fallbackDescriptor),
      priority: descriptors.length + 1,
    },
  ].filter(item => item.value);

  const ranked = candidates.sort(
    (left, right) =>
      openingDescriptorScore(right.value) - openingDescriptorScore(left.value) ||
      left.priority - right.priority ||
      right.value.length - left.value.length
  );

  return (
    ranked.find(candidate =>
      /\b(jovem|adolescente|crian[cç]a|homem|mulher|garot[ao]|soldad[oa]|agente|m[eé]dic[oa]|jornalista|diretor|diretora|chefe|l[ií]der|rei|rainha|pr[ií]ncipe|princesa|duque|duquesa|professor|professora|estudante|espi[aã]o|investigador|investigadora|nobre|servo|serva|guarda|capit[aã]o|comandante|general|sacerdote|sacerdotisa|mago|maga|bruxa|bruxo|herdeir[oa])\b/i.test(
        candidate.value
      ) ||
      (!roleIsCore &&
        /\b(m[aã]e|pai|filh[oa]|irm[aã]o|amig[oa])\b/i.test(candidate.value))
    )?.value ||
    ranked.find(
      candidate =>
        !roleIsCore ||
        !/\b(amig[oa]|m[aã]e|pai|filh[oa]|irm[aã]o)\b/i.test(candidate.value)
    )?.value ||
    ""
  );
}

function capitalizeSentence(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function sentenceEnds(value: string) {
  return /[.!?]"?$/.test(value.trim());
}

function ensureSentence(value: string) {
  const trimmed = compactWhitespace(value);
  if (!trimmed) return "";
  return sentenceEnds(trimmed) ? trimmed : `${trimmed}.`;
}

function characterFactFocusScore(name: string, fact: CharacterNarrativeFact) {
  const text = normalizeEvidenceText(fact.text);
  const variants = characterNameVariants(name).map(normalizeEvidenceText);
  const variantPattern = variants.length
    ? `(?:${variants.map(escapeRegExp).join("|")})`
    : escapeRegExp(normalizeEvidenceText(name));
  let score = 0;

  if (new RegExp(`^${variantPattern}\\b`).test(text)) score += 10;
  if (
    new RegExp(
      `\\b${variantPattern}\\b\\s+(?:e\\s+(?:diretor|protagonista|antagonista|amig|aliad|mentor|mae|m[aã]e|pai|soldado|agente|jornalista|localizador|localizadora|intensificador|manipulador)|era|foi|revela|ordena|declara|entra|explica|mata|manipula|confronta|prop[oõ]e|pede|manda|admite|confessa|tenta|morre|surge|aparece|decide|mant[eé]m|controla)\\b`
    ).test(text)
  ) {
    score += 8;
  }
  if (
    new RegExp(
      `\\b(?:reconhece|identifica|aponta|mostra|v[eê]|descobre|liga|conecta)\\b.{0,90}\\b${variantPattern}\\b`
    ).test(text)
  ) {
    score += 5;
  }
  if (
    new RegExp(
      `\\b${variantPattern}\\b.{0,120}\\b(?:ordena|revela|mata|manipula|amea[cç]a|persegue|controla|resgata|protege|descobre|decide|confronta|morre|sobrevive)\\b`
    ).test(text)
  ) {
    score += 5;
  }
  if (fact.kind === "revelation") score += 3;
  if (fact.kind === "final") score += 2;
  if (/\b(photo|foto|verso|data|porta|abajur|trancad[ao])\b/.test(text))
    score -= 2;
  if (!variants.some(variant => text.includes(variant))) score -= 8;

  return score;
}

const CHARACTER_ARC_IMPACT_PATTERN =
  /\b(morte|morre|morta|morto|assassin|execut|mata|matou|ordena|manda|descobre|descoberta|revela|revelacao|revelacao|confessa|confronta|enfrenta|ameaca|persegue|manipula|controla|captura|resgata|foge|fuga|decide|investiga|procura|vinganca|culpa|medo|pavor|trauma|trai|traidor|sobrevive|sacrifica|perde|separa|reencontra|desaparece|tortura|prisao|acusa|promete|alia|alianca|rompe|transforma|treina|aprende|protege|salva|falha|mentira|segredo|pista|suspeita|consequencia|consequencias)\b/;

const CHARACTER_RELATION_PATTERN =
  /\b(amig|companheir|aliad|mentor|protetor|proteg|mae|m[aã]e|pai|filh|irma|irm[aã]o|familia|fam[ií]lia|desconfia|confia|lealdade|atrai|abandona|trai|rela[cç][aã]o|tens[aã]o)\b/;

const CHARACTER_LOW_VALUE_SCENE_PATTERN =
  /\b(se arruma|uniforme|aula|hino|porta|abajur|corredor|janela|mesa|sofa|caf[eé]|caminha|olha|observa|senta|levanta|entra na sala|vira a foto|v[eê] no verso|data|picha[cç][aã]o|picha[cç][oõ]es|slogan|brincadeira|chiclete|professor|professora|jogo|atari|pac man|vai para casa|decide ir para casa)\b/;

function isLowValueBiographyFact(fact: CharacterNarrativeFact) {
  const normalized = normalizeEvidenceText(fact.text);
  if (
    fact.kind === "revelation" &&
    /\b(foto|carta|documento|registro|pista|nome|assinatura|simbolo|sinal)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  if (!CHARACTER_LOW_VALUE_SCENE_PATTERN.test(normalized)) return false;
  return !/\b(assassin|morte da|mae morta|m[aã]e morta|pai morto|desaparec|revela|descobre|confronta|captura|resgata|manipula|controla|tortura|foge|fuga|trai|traidor|pavor|medo|culpa)\b/.test(
    normalized
  );
}

function characterFactImpactScore(fact: CharacterNarrativeFact) {
  const normalized = normalizeEvidenceText(fact.text);
  let score = 0;

  if (fact.kind === "revelation") score += 6;
  if (fact.kind === "final") score += 5;
  if (fact.kind === "relationship") score += 4;
  if (fact.kind === "emotion") score += 3;
  if (fact.kind === "continuity") score += 2;

  if (CHARACTER_ARC_IMPACT_PATTERN.test(normalized)) score += 7;
  if (CHARACTER_RELATION_PATTERN.test(normalized)) score += 3;
  if (/\b(quer|deseja|objetivo|motiva|precisa|tenta|recusa|aceita)\b/.test(normalized)) {
    score += 3;
  }
  if (/\b(estado final|final|desfecho|epilogo|epilogo)\b/.test(normalized)) {
    score += 2;
  }
  if (isLowValueBiographyFact(fact)) score -= 16;
  if (normalized.split(/\s+/).length > 90) score -= 3;

  return score;
}

function characterRoleWeight(role: string | undefined) {
  const normalizedRole = normalizeEvidenceText(role || "");
  if (/\b(protagonista|antagonista principal|principal)\b/.test(normalizedRole))
    return "core";
  if (/\b(mentor|aliad|recorrente|antagonista)\b/.test(normalizedRole))
    return "recurring";
  return "support";
}

function isHighSignalCharacterFact(name: string, fact: CharacterNarrativeFact) {
  const focus = characterFactFocusScore(name, fact);
  const impact = characterFactImpactScore(fact);
  if (isLowValueBiographyFact(fact)) return false;
  return focus + impact >= 10 || (focus >= 5 && impact >= 5);
}

function selectNarrativeFactsForCharacter(input: {
  name: string;
  role?: string;
  facts: CharacterNarrativeFact[];
}) {
  const roleWeight = characterRoleWeight(input.role);
  const ordered = input.facts
    .filter(fact => isCharacterCenteredBiographyFact(input.name, fact))
    .slice()
    .sort((left, right) => left.blockIndex - right.blockIndex);
  const scored = ordered.map(fact => ({
    fact,
    score:
      characterFactFocusScore(input.name, fact) +
      characterFactImpactScore(fact),
  }));
  const selected: CharacterNarrativeFact[] = [];
  const seen = new Set<string>();
  const minimumByRole =
    roleWeight === "core" ? 10 : roleWeight === "recurring" ? 6 : 2;
  const maximumByRole =
    roleWeight === "core" ? 72 : roleWeight === "recurring" ? 36 : 12;

  const add = (fact: CharacterNarrativeFact) => {
    const key = normalizeEvidenceText(fact.text);
    if (!key || seen.has(key)) return;
    if (
      selected.some(existing => textSimilarity(existing.text, fact.text) > 0.68)
    ) {
      return;
    }
    seen.add(key);
    selected.push(fact);
  };

  const firstStrong = scored.find(item =>
    isHighSignalCharacterFact(input.name, item.fact)
  )?.fact;
  if (firstStrong) add(firstStrong);

  for (const item of scored) {
    if (item.score >= 10) add(item.fact);
  }

  const finalStrong = scored
    .slice()
    .reverse()
    .find(item => item.fact.kind === "final" || item.score >= 10)?.fact;
  if (finalStrong) add(finalStrong);

  if (selected.length < minimumByRole) {
    for (const item of scored.sort((left, right) => right.score - left.score)) {
      if (item.score >= 6) add(item.fact);
      if (selected.length >= minimumByRole) break;
    }
  }

  return selected
    .slice()
    .sort((left, right) => left.blockIndex - right.blockIndex)
    .slice(0, maximumByRole);
}

function buildCharacterOpeningSentence(input: {
  name: string;
  role: string | undefined;
  descriptors: string[];
  facts: CharacterNarrativeFact[];
  candidate: DossierCharacterCandidate;
}) {
  let descriptor = selectOpeningDescriptor(
    input.descriptors,
    extractIdentityDescriptor(input.descriptors.join(" ")) ||
      extractCharacterIdentityDescriptor(input.candidate),
    input.role
  );
  const firstName = compactWhitespace(input.name).split(/\s+/)[0] || "";
  const normalizedDescriptor = normalizeEvidenceText(descriptor);
  const normalizedFirstName = normalizeEvidenceText(firstName);
  if (
    normalizedFirstName &&
    new RegExp(`\\b(mae|pai|m[aã]e)\\s+de\\s+${escapeRegExp(normalizedFirstName)}\\b`).test(
      normalizedDescriptor
    )
  ) {
    descriptor = "";
  }
  const roleText = roleForOpening(input.role);

  if (
    descriptor &&
    !isWeakGenericOpeningDescriptor(descriptor) &&
    !normalizeEvidenceText(roleText).includes(normalizeEvidenceText(descriptor))
  ) {
    return `${input.name} é ${descriptor} e ${roleText}.`;
  }
  return `${input.name} é ${roleText}.`;
}

function isLikelyFirstAppearanceFact(fact: CharacterNarrativeFact) {
  return fact.kind === "event" || fact.kind === "revelation" || fact.kind === "final";
}

function lowerFirstForBiography(value: string) {
  const trimmed = compactWhitespace(value);
  if (!trimmed) return "";
  const firstWord = trimmed.split(/\s+/)[0] || "";
  if (
    /^(A|O|As|Os|Um|Uma|Uns|Umas|No|Na|Nos|Nas|Em|Durante|Depois|Antes|Quando|Apos|Após|Ele|Ela|Eles|Elas|Seu|Sua|Seus|Suas)$/.test(
      firstWord
    )
  ) {
    return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
  }
  if (/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(trimmed)) return trimmed;
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

function stripBiographyEvidenceSyntax(value: string) {
  const withoutLeadingLabel = (text: string) =>
    text.replace(/^([^;.!?]{2,90});\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/i, (match, label) => {
      const normalizedLabel = normalizeEvidenceText(label);
      const looksLikeRealCharacterStatement =
        /\b(?:e|era|foi|faz|fez|tem|tinha|mantem|mantinha|mant[eé]m|surpreende|surpreendeu|sente|sentiu|carrega|carregou|afirma|afirmou|entra|entrou|fala|falou|lembra|lembrou|declara|declarou|explica|explicou|nega|negou|insiste|insistiu|quer|tenta|tentou|planeja|planejou|prop[oõ]e|prop[oô]s|mata|matou|morre|morreu|revela|revelou|ordena|ordenou|manipula|manipulou|descobre|descobriu|confronta|confrontou|protege|proteg[eê]u|salva|salvou|decide|decidiu)\b/.test(
          normalizedLabel
        ) &&
        /\b(?:agente|personagem|protagonista|antagonista|mentor|jovem|jornalista|diretor|chefe|lider|general|comandante|morto|morta|vivo|viva|mae|pai)\b|\b(?:subordinad|aliad|soldad|medic|controlad|manipulad|filh|amig|peca manipulad)/.test(
          normalizedLabel
        );
      if (
        looksLikeRealCharacterStatement
      ) {
        return match;
      }
      return "";
    });

  const cleaned = withoutLeadingLabel(compactWhitespace(value).replace(/^[-–—]\s*/, ""))
    .replace(/\s*\[[^\]]+\]\s*/g, " ")
    .replace(/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^.!?;:]{0,48}\s+vs\.?\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^.!?;:]{0,80}:\s*/g, " ")
    .replace(/\b(?:Resumo factual|Personagens em cena|Eventos e ações em ordem|Eventos e acoes em ordem|Referenciados|Mencionados)\s*:?\s*/gi, " ")
    .replace(/\b(?:Relações e tensões|Relacoes e tensoes|Estado emocional e psicológico|Estado emocional e psicologico|Revelações, pistas e segredos|Revelacoes, pistas e segredos|Estado final do bloco|Alertas de continuidade)\s*:?\s*/gi, " ")
    .replace(/\b(?:Em\s+)?(?:CAP[IÍ]TULO|PR[OÓ]LOGO|EP[IÍ]LOGO|BLOCO|PARTE)\s+\d+[^\w]{0,3}/gi, " ")
    .replace(/\b(?:KGB|Final|Capitulo|Capítulo)\s+-\s+parte\s+\d+\s*\/\s*\d+\s*,?\s*/gi, " ")
    .replace(/["“”][^"“”]{1,220}["“”]/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s*\([^)]{1,120}\)\s*$/g, " ")
    .replace(/\s*[:;]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return withoutLeadingLabel(cleaned).trim();
}

function biographySentence(value: string) {
  const cleaned = stripBiographyEvidenceSyntax(value)
    .replace(/^[-–—]\s*/, "")
    .trim();
  if (!cleaned || cleaned.length < 16) return "";
  return ensureSentence(capitalizeSentence(cleaned));
}

function trimFinalPunctuation(value: string) {
  return value.trim().replace(/[.!?]+["”']?$/g, "");
}

function startsWithConnector(value: string) {
  return /^(no|na|nos|nas|em|durante|depois|antes|ap[oó]s|quando|enquanto)\b/i.test(
    value.trim()
  );
}

function joinBiographyIntro(intro: string, sentence: string) {
  const cleanIntro = compactWhitespace(intro);
  const cleanSentence = trimFinalPunctuation(sentence);
  if (!cleanIntro || !cleanSentence) return "";
  const lowered = lowerFirstForBiography(cleanSentence);
  if (startsWithConnector(lowered)) {
    return ensureSentence(
      `${cleanIntro.replace(/\s+quando$/i, "")} ${lowered}`
    );
  }
  return ensureSentence(`${cleanIntro} ${lowered}`);
}

function addBiographySentence(
  target: string[],
  seen: Set<string>,
  value: string
) {
  const sentence = biographySentence(value);
  if (!sentence) return;
  const key = normalizeEvidenceText(sentence);
  if (!key || seen.has(key)) return;
  if (target.some(existing => textSimilarity(existing, sentence) > 0.72)) return;
  seen.add(key);
  target.push(sentence);
}

function selectFactsByKind(
  facts: CharacterNarrativeFact[],
  kinds: CharacterNarrativeFact["kind"][],
  count: number
) {
  const kindSet = new Set(kinds);
  return facts
    .filter(fact => kindSet.has(fact.kind))
    .slice(0, count);
}

function selectHighestImpactFacts(
  name: string,
  facts: CharacterNarrativeFact[],
  count: number
) {
  return facts
    .filter(fact => isCharacterCenteredBiographyFact(name, fact))
    .slice()
    .sort(
      (left, right) =>
        characterFactImpactScore(right) +
          characterFactFocusScore(name, right) -
        (characterFactImpactScore(left) + characterFactFocusScore(name, left))
    )
    .slice(0, count)
    .sort((left, right) => left.blockIndex - right.blockIndex);
}

function characterVariantPattern(name: string) {
  const variants = characterNameVariants(name)
    .map(normalizeEvidenceText)
    .filter(variant => variant.length >= 3)
    .sort((left, right) => right.length - left.length);
  return variants.length
    ? `(?:${variants.map(escapeRegExp).join("|")})`
    : escapeRegExp(normalizeEvidenceText(name));
}

function isCharacterCenteredBiographyFact(
  name: string,
  fact: CharacterNarrativeFact
) {
  const text = normalizeEvidenceText(fact.text);
  if (!text) return false;
  const variantPattern = characterVariantPattern(name);
  if (!new RegExp(`\\b${variantPattern}\\b`).test(text)) return false;
  if (new RegExp(`^${variantPattern}\\b`).test(text)) return true;
  if (
    new RegExp(
      `^(?:m[aã]e|mae|pai|filh[oa]|irm[aã]o|irmao|irm[aã]|irma)\\s+(?:de|do|da|dos|das)\\s+${variantPattern}\\b`
    ).test(text)
  ) {
    return true;
  }

  if (
    /^(?:ele|ela|eles|elas|seu|sua|seus|suas|dele|dela|deles|delas)\b/.test(
      text
    )
  ) {
    return false;
  }

  if (fact.kind === "relationship" || fact.kind === "emotion") return false;

  const directActionTowardCharacter = new RegExp(
    `\\b(?:ajuda|ajudou|protege|protegeu|salva|salvou|resgata|resgatou|captura|capturou|prende|prendeu|amea[cç]a|ameacou|tortura|torturou|manipula|manipulou|controla|controlou|trai|traiu|mata|matou|ordena|ordenou|manda|mandou|revela|revelou|confessa|confessou|entrega|entregou|informa|informou|procura|procurou|persegue|perseguiu|confronta|confrontou|ataca|atacou|fere|feriu|abandona|abandonou|chama|chamou)\\b.{0,110}\\b${variantPattern}\\b`
  );
  if (directActionTowardCharacter.test(text)) return true;

  return characterFactFocusScore(name, fact) >= 5;
}

function buildBiographyParagraph(
  intro: string,
  facts: CharacterNarrativeFact[],
  seen: Set<string>
) {
  const sentences: string[] = [];
  for (const fact of facts) addBiographySentence(sentences, seen, fact.text);
  if (!sentences.length) return "";
  const first = sentences[0];
  const rest = sentences.slice(1);
  return [
    joinBiographyIntro(intro, first),
    ...rest,
  ]
    .filter(Boolean)
    .join(" ");
}

function selectFirstAppearanceFact(
  name: string,
  facts: CharacterNarrativeFact[]
) {
  return (
    facts.find(
      fact =>
        isLikelyFirstAppearanceFact(fact) &&
        isHighSignalCharacterFact(name, fact)
    ) || facts.find(isLikelyFirstAppearanceFact)
  );
}

function buildFirstAppearanceSentence(
  name: string,
  facts: CharacterNarrativeFact[]
) {
  const first = selectFirstAppearanceFact(name, facts);
  if (!first) return "";
  const text = biographySentence(first.text);
  if (!text) return "";
  if (!isBiographySentenceCenteredOnCharacter(name, text)) return "";
  return joinBiographyIntro("Na narrativa,", text);
}

function editorialDevelopmentBudget(roleWeight: ReturnType<typeof characterRoleWeight>) {
  if (roleWeight === "core") {
    return { early: 4, conflict: 7, arc: 5, relationship: 4, final: 3 };
  }
  if (roleWeight === "recurring") {
    return { early: 3, conflict: 4, arc: 3, relationship: 3, final: 2 };
  }
  return { early: 2, conflict: 3, arc: 1, relationship: 1, final: 1 };
}

function isBookLikeBiographySentence(value: string) {
  const normalized = normalizeEvidenceText(value);
  if (!normalized) return false;
  const hasNarrativeVerb =
    /\b(?:é|era|foi|são|sao|est[aá]|estava|estavam|estão|estao|tem|tinha|mant[eé]m|mantem|mantinha|entra|entrou|surge|surgiu|aparece|apareceu|fala|falou|diz|disse|pergunta|perguntou|responde|respondeu|mente|mentiu|nega|negou|insiste|insistiu|lembra|lembrou|declara|declarou|explica|explicou|revela|revelou|confessa|confessou|ordena|ordenou|manda|mandou|decide|decidiu|descobre|descobriu|investiga|investigou|procura|procurou|desconfia|desconfiou|suspeita|suspeitou|confronta|confrontou|enfrenta|enfrentou|captura|capturou|resgata|resgatou|protege|protegeu|salva|salvou|ajuda|ajudou|trai|traiu|manipula|manipulou|controla|controlou|mata|matou|morre|morreu|sobrevive|sobreviveu|tenta|tentou|quer|queria|carrega|carregou|sente|sentiu|fica|ficou|teme|temeu|trava|travou|paralisa|paralisou|congela|congelou|apoia|apoiou|reconhece|reconheceu|acusa|acusou|promete|prometeu|recusa|recusou|aceita|aceitou)\b/i.test(
      value
    ) ||
    /\be\s+(?:o|a|um|uma|diretor|diretora|chefe|l[ií]der|general|comandante|agente|m[eé]dico|m[eé]dica|jornalista|soldado|protagonista|antagonista|mentor|aliado|aliada|subordinado|subordinada)\b/.test(
      normalized
    );
  if (!hasNarrativeVerb) return false;
  if (
    /\b(?:dossie|dossies|bloco|capitulo|parte \d|personagens em cena|eventos e acoes|resumo factual|presenca verificada|estado final do bloco)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  if (
    /\b(?:a trajetoria avanca|sua primeira aparicao relevante|no estado final conhecido)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  if (
    /^(?:a voz do outro lado diz|diz que|pergunta se|responde que)$/.test(
      normalized
    ) ||
    /\b(?:a voz do outro lado diz|pergunta sem complemento|diz sem complemento)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  return true;
}

function isBiographySentenceCenteredOnCharacter(name: string, value: string) {
  const normalized = normalizeEvidenceText(value);
  if (!normalized) return false;
  const variantPattern = characterVariantPattern(name);
  const targetMatch = new RegExp(`\\b${variantPattern}\\b`).exec(normalized);
  if (!targetMatch) return false;
  if (new RegExp(`^${variantPattern}\\b`).test(normalized)) return true;
  if (
    new RegExp(
      `^(?:m[aã]e|mae|pai|filh[oa]|irm[aã]o|irmao|irm[aã]|irma)\\s+(?:de|do|da|dos|das)\\s+${variantPattern}\\b`
    ).test(normalized)
  ) {
    return true;
  }
  if (
    /^(?:ele|ela|eles|elas|seu|sua|seus|suas|dele|dela|deles|delas)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  const beforeTarget = normalized.slice(0, targetMatch.index).trim();
  if (
    beforeTarget &&
    /^(?:ele|ela|eles|elas|seu|sua|seus|suas|dele|dela|deles|delas)\b/.test(
      beforeTarget
    )
  ) {
    return false;
  }
  return targetMatch.index <= 140;
}

function addEditorialBiographySentence(
  target: string[],
  seen: Set<string>,
  name: string,
  fact: CharacterNarrativeFact
) {
  if (!isCharacterCenteredBiographyFact(name, fact)) return;
  const sentence = biographySentence(fact.text);
  if (
    !sentence ||
    !isBookLikeBiographySentence(sentence) ||
    !isBiographySentenceCenteredOnCharacter(name, sentence)
  )
    return;
  const key = normalizeEvidenceText(sentence);
  if (!key || seen.has(key)) return;
  if (target.some(existing => textSimilarity(existing, sentence) > 0.72)) return;
  seen.add(key);
  target.push(sentence);
}

function buildEditorialBiographyParagraph(
  intro: string,
  name: string,
  facts: CharacterNarrativeFact[],
  seen: Set<string>
) {
  const sentences: string[] = [];
  for (const fact of facts)
    addEditorialBiographySentence(sentences, seen, name, fact);
  if (!sentences.length) return "";
  const [first, ...rest] = sentences;
  return [joinBiographyIntro(intro, first), ...rest]
    .filter(Boolean)
    .join(" ");
}

function buildCharacterHistoryFromFacts(input: {
  name: string;
  role: string | undefined;
  descriptors: string[];
  facts: CharacterNarrativeFact[];
  candidate: DossierCharacterCandidate;
  sourceContent?: string;
}) {
  const roleWeight = characterRoleWeight(input.role);
  const budget = editorialDevelopmentBudget(roleWeight);
  const orderedFacts = selectNarrativeFactsForCharacter({
    name: input.name,
    role: input.role,
    facts: input.facts,
  });
  const opening = buildCharacterOpeningSentence({
    name: input.name,
    role: input.role,
    descriptors: [
      extractSourceIdentityDescriptor(input.name, input.sourceContent),
      extractCharacterIdentityDescriptor(input.candidate),
      ...input.descriptors,
    ].filter(Boolean),
    facts: orderedFacts,
    candidate: input.candidate,
  });
  const seen = new Set<string>([normalizeEvidenceText(opening)]);
  const firstAppearanceFact = selectFirstAppearanceFact(input.name, orderedFacts);
  const firstAppearanceFactKey = normalizeEvidenceText(
    firstAppearanceFact?.text || ""
  );
  const firstAppearance = buildFirstAppearanceSentence(input.name, orderedFacts);
  if (firstAppearance) seen.add(normalizeEvidenceText(firstAppearance));

  const relationshipFacts = selectFactsByKind(
    orderedFacts,
    ["relationship", "emotion"],
    budget.relationship
  );
  const finalFacts = selectFactsByKind(
    orderedFacts,
    ["final"],
    budget.final
  );
  const developmentFacts = selectHighestImpactFacts(
    input.name,
    orderedFacts.filter(
      fact =>
        !relationshipFacts.includes(fact) &&
        !finalFacts.includes(fact) &&
        !isLowValueBiographyFact(fact) &&
        normalizeEvidenceText(fact.text) !== firstAppearanceFactKey
    ),
    budget.early + budget.conflict + budget.arc
  );
  const earlyFacts = developmentFacts.slice(0, budget.early);
  const conflictFacts = developmentFacts.slice(
    budget.early,
    budget.early + budget.conflict
  );
  const arcFacts = developmentFacts.slice(budget.early + budget.conflict);

  const paragraphs = [
    buildEditorialBiographyParagraph(
      "O arco começa a tomar forma quando",
      input.name,
      earlyFacts,
      seen
    ),
    buildEditorialBiographyParagraph(
      "Sua função na trama se firma quando",
      input.name,
      conflictFacts,
      seen
    ),
    buildEditorialBiographyParagraph(
      "Ao longo da obra,",
      input.name,
      arcFacts,
      seen
    ),
    buildEditorialBiographyParagraph(
      "Nas relações centrais,",
      input.name,
      relationshipFacts,
      seen
    ),
    buildEditorialBiographyParagraph(
      "No desfecho do arco,",
      input.name,
      finalFacts,
      seen
    ),
  ].filter(Boolean);

  return [opening, firstAppearance, ...paragraphs]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildDossierBackedCharacter(input: {
  title: string;
  candidate: DossierCharacterCandidate;
  analysisBlocks: ReferenceAnalysisBlock[];
  sourceContent?: string;
}) {
  const { candidate } = input;
  const terms = characterNameVariants(candidate.name);
  const descriptors = extractSelfDescriptorsForCharacter(
    candidate.name,
    candidate.snippets
  );
  const seenHistory = new Set<string>();
  const seenRelations = new Set<string>();
  const seenPsychology = new Set<string>();
  const seenBackstory = new Set<string>();
  const seenNotes = new Set<string>();
  const seenSpeech = new Set<string>();
  const historyFacts: CharacterNarrativeFact[] = [];
  const relationships: string[] = [];
  const psychology: string[] = [];
  const backstory: string[] = [];
  const speech: string[] = [];
  const notes: string[] = [];

  for (const block of input.analysisBlocks.slice().sort((a, b) => a.index - b.index)) {
    const dossier = block.dossier || "";
    if (!textMentionsCharacter(dossier, terms)) continue;

    const events = collectCharacterStatementsFromSection({
      section: extractDossierSection(dossier, "Eventos e ações em ordem"),
      terms,
    });
    const revelations = collectCharacterStatementsFromSection({
      section: extractDossierSection(dossier, "Revelações, pistas e segredos"),
      terms,
    });
    const finalState = collectCharacterStatementsFromSection({
      section: extractDossierSection(dossier, "Estado final do bloco"),
      terms,
    });
    const emotionalState = collectCharacterStatementsFromSection({
      section: extractDossierSection(dossier, "Estado emocional e psicológico"),
      terms,
    });
    const relationState = collectCharacterStatementsFromSection({
      section: extractDossierSection(dossier, "Relações e tensões"),
      terms,
    });
    const continuity = collectCharacterStatementsFromSection({
      section: extractDossierSection(dossier, "Alertas de continuidade"),
      terms,
    });
    const speechAndGestures = collectCharacterStatementsFromSection({
      section: extractDossierSection(dossier, "Falas ou gestos que mudam a cena"),
      terms,
    });

    const blockFacts = [...events, ...revelations, ...speechAndGestures, ...finalState];
    for (const statement of blockFacts) {
      const kind = events.includes(statement)
        ? "event"
        : revelations.includes(statement)
          ? "revelation"
          : speechAndGestures.includes(statement)
            ? "relationship"
          : "final";
      pushUniqueFact(historyFacts, seenHistory, {
        text: statement,
        blockIndex: block.index,
        blockTitle: block.title,
        kind,
      });
    }

    for (const statement of relationState) {
      pushUniqueStatement(relationships, seenRelations, statement);
      pushUniqueFact(historyFacts, seenHistory, {
        text: statement,
        blockIndex: block.index,
        blockTitle: block.title,
        kind: "relationship",
      });
    }
    for (const statement of emotionalState) {
      pushUniqueStatement(psychology, seenPsychology, statement);
      pushUniqueFact(historyFacts, seenHistory, {
        text: statement,
        blockIndex: block.index,
        blockTitle: block.title,
        kind: "emotion",
      });
    }
    for (const statement of revelations) {
      if (/\b(?:passado|m[aã]e|pai|filh|descend|origem|orfanato|fam[ií]lia|inf[aâ]ncia|antes)\b/i.test(statement)) {
        pushUniqueStatement(backstory, seenBackstory, statement);
      }
    }
    for (const statement of continuity) {
      pushUniqueStatement(notes, seenNotes, statement);
      pushUniqueFact(historyFacts, seenHistory, {
        text: statement,
        blockIndex: block.index,
        blockTitle: block.title,
        kind: "continuity",
      });
    }
    for (const statement of speechAndGestures) {
      pushUniqueStatement(speech, seenSpeech, statement);
    }
  }

  if (!historyFacts.length) return null;

  const role = inferDossierCharacterRole(candidate);
  const history = buildCharacterHistoryFromFacts({
    name: candidate.name,
    role,
    descriptors,
    facts: historyFacts,
    candidate,
    sourceContent: input.sourceContent,
  });

  const result: ImportedCharacter = {
    name: candidate.name,
    role,
    history,
    speechStyle: speech.length ? speech.join("\n") : undefined,
    relationships: relationships.length ? relationships.join("\n") : undefined,
    psychologicalProfile: psychology.length ? psychology.join("\n") : undefined,
    backstory: backstory.length ? backstory.join("\n") : undefined,
    notes: [
      "Uso em Rascunho: ficha reconstruída diretamente dos dossiês por capítulo; preservar a sequência factual acima ao escrever novas cenas.",
      notes.length
        ? `Alertas dos dossiês: ${notes.join(" ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  };

  return result;
}

function buildDossierBackedCharacters(input: {
  title: string;
  analysisBlocks: ReferenceAnalysisBlock[];
  sourceContent?: string;
  targetCharacterNames?: string[];
}) {
  const candidates = collectDossierCharacterCandidates({
    analysisBlocks: input.analysisBlocks,
    sourceContent: input.sourceContent,
    targetCharacterNames: input.targetCharacterNames,
  });

  return normalizeImportedCharactersForWriting(
    candidates
      .map(candidate =>
        buildDossierBackedCharacter({
          title: input.title,
          candidate,
          analysisBlocks: input.analysisBlocks,
          sourceContent: input.sourceContent,
        })
      )
      .filter(Boolean) as ImportedCharacter[]
  );
}

function fallbackCharactersFromDossiers(input: {
  title: string;
  content?: string;
  analysisBlocks: ReferenceAnalysisBlock[];
  targetCharacterNames?: string[];
}) {
  return buildDossierBackedCharacters({
    title: input.title,
    analysisBlocks: input.analysisBlocks,
    sourceContent: input.content,
    targetCharacterNames: input.targetCharacterNames,
  });
}

function normalizeImportedCharacterField(value: string | undefined) {
  const cleaned = cleanImportedCharacterField(value);
  if (!cleaned) return undefined;
  return cleaned
    .replace(/^evid[eê]ncias?\s+no\s+texto\s+original\s*:\s*/i, "")
    .replace(/^resumo\s+factual\s*:\s*/i, "")
    .replace(/\s*\[BLOCO\s+\d+\][^\n]*\n?/gi, " ")
    .trim();
}

function resolveImportedCharacterAliasName(character: ImportedCharacter) {
  const text = [
    character.name,
    character.role,
    character.history,
    character.backstory,
    character.relationships,
    character.notes,
  ]
    .filter(Boolean)
    .join(" ");
  const nameWord =
    "[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+";
  const aliasPatterns = [
    new RegExp(
      `(?:pseud[oô]nimo|alias|nome real)[^.!?]{0,80}\\b(?:de|por|é|e)\\s+(?:Dr\\.?\\s*)?(${nameWord}\\s+${nameWord}(?:\\s+${nameWord})?)`,
      "i"
    ),
    new RegExp(
      `(?:tamb[eé]m conhecido como|conhecido como)\\s+(?:Dr\\.?\\s*)?(${nameWord}\\s+${nameWord}(?:\\s+${nameWord})?)`,
      "i"
    ),
  ];
  for (const pattern of aliasPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return compactWhitespace(match[1]);
  }
  return character.name;
}

function isNonCharacterImportedOutput(character: ImportedCharacter) {
  const name = normalizeEvidenceText(character.name || "");
  const role = normalizeEvidenceText(character.role || "");
  const identityText = `${name} ${role}`;
  const text = `${identityText} ${normalizeEvidenceText(character.history || "")}`;
  if (!name) return true;
  if (NON_CHARACTER_DOSSIER_TERMS.has(name)) return true;
  if (
    /\b(hotel|cafe|caf[eé]|habitacional|alianca|alian[cç]a|manipulador|manipuladores|manipulacao|manipula[cç][aã]o|referencia|refer[eê]ncia|mencionados|grupo de|soldado classe|localizacao|localiza[cç][aã]o)\b/.test(
      name
    )
  ) {
    return true;
  }
  if (/\b(cidade|pais|pais ficticio|vila|bairro|lago|local|lugar|instituicao|organizacao|facccao|faccao|conceito|regra|variedade|poder|forca|forcas|soldados|policiais|agentes|grupo generico|figuras genericas)\b/.test(identityText)) {
    return true;
  }
  if (/\b(personagens em cena|eventos e acoes em ordem|referenciados|resumo factual|presenca verificada)\b/.test(text)) {
    return true;
  }
  return false;
}

function isUnusableImportedCharacterSummary(character: ImportedCharacter) {
  const history = compactWhitespace(character.history || "");
  const text = normalizeEvidenceText(
    [
      character.name,
      character.role,
      character.history,
      character.personality,
      character.backstory,
      character.motivations,
      character.relationships,
      character.notes,
    ]
      .filter(Boolean)
      .join(" ")
  );
  if (!history) return true;
  if (
    /\b(identico ao personagem|repete se a historia|para atender a lista|sem individualizacao|figuras genericas|personagem generico)\b/.test(
      text
    )
  ) {
    return true;
  }
  if (
    /\b(personagens em cena|eventos e acoes em ordem|referenciados|presenca verificada|resumo factual)\b/.test(
      text
    )
  ) {
    return true;
  }
  if (
    /^em\s+(?:capitulo|prologo|epilogo|kgb|bloco|parte)\b/.test(
      normalizeEvidenceText(history)
    ) ||
    (history.match(/\bEm\s+(?:CAP[IÍ]TULO|PR[OÓ]LOGO|EP[IÍ]LOGO|KGB|BLOCO|PARTE)\b/g) || [])
      .length >= 2
  ) {
    return true;
  }
  return false;
}

function normalizeImportedCharacterRoles(characters: ImportedCharacter[]) {
  let protagonistSeen = false;
  return characters.map(character => {
    const role = character.role || "";
    const normalizedRole = normalizeSearchText(role);
    if (!/\bprotagonista\b/.test(normalizedRole)) return character;
    if (!protagonistSeen) {
      protagonistSeen = true;
      return character;
    }
    return {
      ...character,
      role: compactWhitespace(
        role
          .replace(/\bprotagonista\b/gi, "Personagem recorrente")
          .replace(/\s{2,}/g, " ")
      ),
    };
  });
}

function normalizeImportedCharacterForWriting(
  character: ImportedCharacter
): ImportedCharacter | null {
  const normalized: ImportedCharacter = {
    ...character,
    name: resolveImportedCharacterAliasName(character),
    role: normalizeImportedCharacterField(character.role),
    history: normalizeImportedCharacterField(character.history) || character.history,
    personality: normalizeImportedCharacterField(character.personality),
    physicalDescription: normalizeImportedCharacterField(
      character.physicalDescription
    ),
    speechStyle: normalizeImportedCharacterField(character.speechStyle),
    psychologicalProfile: normalizeImportedCharacterField(
      character.psychologicalProfile
    ),
    backstory: normalizeImportedCharacterField(character.backstory),
    motivations: normalizeImportedCharacterField(character.motivations),
    relationships: normalizeImportedCharacterField(character.relationships),
    notes: normalizeImportedCharacterField(character.notes),
  };

  if (isRawCharacterEvidenceText(normalized.history)) {
    return null;
  }
  if (isNonCharacterImportedOutput(normalized)) return null;
  if (isUnusableImportedCharacterSummary(normalized)) return null;

  if (!normalized.notes || isRawCharacterEvidenceText(normalized.notes)) {
    normalized.notes =
      "Resumo do personagem importado dos dossiês por capítulo; use os fatos confirmados como memória de continuidade para Escrita.";
  }

  return normalized;
}

function normalizeImportedCharactersForWriting(characters: ImportedCharacter[]) {
  return normalizeImportedCharacterRoles(
    characters
      .map(normalizeImportedCharacterForWriting)
      .filter(Boolean) as ImportedCharacter[]
  );
}

async function consolidateCharactersByDossierGroups(input: {
  title: string;
  analysisBlocks: ReferenceAnalysisBlock[];
  sourceContent?: string;
  targetCharacterNames?: string[];
}) {
  const candidates = collectDossierCharacterCandidates({
    analysisBlocks: input.analysisBlocks,
    sourceContent: input.sourceContent,
    targetCharacterNames: input.targetCharacterNames,
  });
  if (!candidates.length) return [];

  const dossierBackedCharacters = normalizeImportedCharactersForWriting(
    candidates
      .map(candidate =>
        buildDossierBackedCharacter({
          title: input.title,
          candidate,
          analysisBlocks: input.analysisBlocks,
          sourceContent: input.sourceContent,
        })
      )
      .filter(Boolean) as ImportedCharacter[]
  );

  return dossierBackedCharacters;
}

function extractCharacterNameFromParagraph(paragraph: string) {
  const cleaned = paragraph
    .replace(/^\s*(?:[-*•]\s+|\d+[.)]\s*)+/, "")
    .replace(/^\s*#+\s+/, "")
    .replace(/^\*\*/, "")
    .trim();

  const colonMatch = cleaned.match(
    /^([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*(?:\s+(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*|da|de|do|dos|das|del|della|di|du|la|le|van|von|vonn|y)){0,6})\s*(?:\*\*)?\s*[:—–-]/
  );
  if (colonMatch?.[1]) return compactWhitespace(colonMatch[1]);

  const sentenceMatch = cleaned.match(
    /^([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*(?:\s+(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]*|da|de|do|dos|das|del|della|di|du|la|le|van|von|vonn|y)){0,6})\s+(?:é|e|foi|era|aparece|surge|representa|funciona|tem)(?=\s|$|[,.])/
  );
  if (sentenceMatch?.[1]) return compactWhitespace(sentenceMatch[1]);

  return null;
}

function fallbackCharactersFromSummary(input: {
  title: string;
  content?: string;
  summary: string;
  summarySections: ReferenceSummarySection[];
}) {
  const sections = (
    input.summarySections.length
      ? input.summarySections
      : extractSummarySections(input.summary)
  ) as ReferenceSummarySection[];
  const characterSections = sections.filter(
    section =>
      section.id === "personagens" ||
      section.id === "secundários" ||
      /personagens/i.test(section.label)
  );
  const originalSource = input.content?.trim() || "";
  const sourceText = [
    originalSource,
    input.summary || "",
    ...sections.map(section => section.content),
  ].join("\n\n");
  const extracted: ImportedCharacter[] = [];
  const seen = new Set<string>();

  for (const section of characterSections) {
    const paragraphs = section.content
      .split(/\n{2,}/)
      .map(item => item.trim())
      .filter(item => item.length >= 80);

    for (const paragraph of paragraphs) {
      const rawName = extractCharacterNameFromParagraph(paragraph);
      if (!rawName) continue;
      const name = resolveCanonicalCharacterName(
        rawName,
        originalSource || sourceText
      );
      const normalizedName = name.toLowerCase();
      if (seen.has(normalizedName)) continue;

      const history = originalSource
        ? buildSourceBackedCharacterHistory(name, originalSource)
        : paragraph;
      if (originalSource && !history) continue;
      seen.add(normalizedName);

      extracted.push({
        name,
        role: inferCharacterRoleFromText(history),
        history,
        notes: `Resumo importado a partir de evidências do documento original de "${input.title}". Revise antes de usar em produção final.`,
      });
    }
  }

  return extracted;
}

function mergeImportedCharacters(
  primary: ImportedCharacter[],
  fallback: ImportedCharacter[]
) {
  const merged: ImportedCharacter[] = [];
  const indexByName = new Map<string, number>();

  const addOrMerge = (character: ImportedCharacter) => {
    const normalizedName = character.name.trim().toLowerCase();
    if (!normalizedName) return;
    const existingIndex = indexByName.get(normalizedName);
    if (existingIndex === undefined) {
      indexByName.set(normalizedName, merged.length);
      merged.push(character);
      return;
    }

    const current = merged[existingIndex];
    merged[existingIndex] = {
      ...current,
      role: current.role || character.role,
      history:
        mergeCharacterText(current.history, character.history, "") ||
        current.history ||
        character.history,
      personality: mergeCharacterText(
        current.personality,
        character.personality,
        ""
      ),
      physicalDescription: mergeCharacterText(
        current.physicalDescription,
        character.physicalDescription,
        ""
      ),
      speechStyle: mergeCharacterText(
        current.speechStyle,
        character.speechStyle,
        ""
      ),
      psychologicalProfile: mergeCharacterText(
        current.psychologicalProfile,
        character.psychologicalProfile,
        ""
      ),
      backstory: mergeCharacterText(current.backstory, character.backstory, ""),
      motivations: mergeCharacterText(
        current.motivations,
        character.motivations,
        ""
      ),
      relationships: mergeCharacterText(
        current.relationships,
        character.relationships,
        ""
      ),
      notes: mergeCharacterText(current.notes, character.notes, ""),
    };
  };

  fallback.forEach(addOrMerge);
  primary.forEach(addOrMerge);
  return merged;
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

const PROPER_NOUN_STOPWORDS = new Set(
  [
    "A",
    "O",
    "As",
    "Os",
    "Um",
    "Uma",
    "Uns",
    "Umas",
    "De",
    "Do",
    "Da",
    "Dos",
    "Das",
    "Em",
    "No",
    "Na",
    "Nos",
    "Nas",
    "Por",
    "Para",
    "Com",
    "Sem",
    "Que",
    "Quando",
    "Enquanto",
    "Depois",
    "Antes",
    "Logo",
    "Mas",
    "Como",
    "Se",
    "Ele",
    "Ela",
    "Eles",
    "Elas",
    "Seu",
    "Sua",
    "Seus",
    "Suas",
    "Este",
    "Esta",
    "Esse",
    "Essa",
    "Obra",
    "Capitulo",
    "Capítulo",
    "Parte",
    "Bloco",
    "Texto",
    "Trecho",
    "Fonte",
    "Titulo",
    "Título",
  ].map(item => item.toLowerCase())
);

function extractSourceAnchors(text: string, maxAnchors = 120) {
  const counts = new Map<string, number>();
  const word =
    "[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç'’.-]+";
  const connector = "(?:d[aeo]s?|e|a|o|de|do|da|dos|das)";
  const matcher = new RegExp(
    `\\b${word}(?:\\s+(?:${connector}\\s+)?${word}){0,4}`,
    "g"
  );
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const raw = compactWhitespace(match[0])
      .replace(/[.,;:!?()[\]{}"“”]+$/g, "")
      .trim();
    if (!raw || raw.length < 3 || raw.length > 90) continue;
    const first = raw.split(/\s+/)[0].toLowerCase();
    if (PROPER_NOUN_STOPWORDS.has(first)) continue;
    if (/^\d+$/.test(raw)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxAnchors)
    .map(([anchor]) => anchor);
}

function formatSourceAnchors(anchors: string[] | undefined) {
  if (!anchors?.length) return "";
  return anchors.join(", ");
}

function splitTextIntoWordChunks(
  text: string,
  chunkWords = CHARACTER_CHUNK_WORDS
) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: Array<{ label: string; content: string }> = [];
  for (let start = 0; start < words.length; start += chunkWords) {
    const end = Math.min(start + chunkWords, words.length);
    chunks.push({
      label: `Trecho ${chunks.length + 1} de ${Math.ceil(words.length / chunkWords)} (palavras ${start + 1}-${end})`,
      content: words.slice(start, end).join(" "),
    });
  }
  return chunks;
}

type ImportedWorkTextBlock = {
  index: number;
  title: string;
  content: string;
  wordCount: number;
  sourceAnchors?: string[];
  part?: number;
  totalParts?: number;
};

function isBlankLine(value: string | undefined) {
  return !value || !value.trim();
}

function isLikelyChapterHeading(
  line: string,
  previousLine?: string,
  nextLine?: string
) {
  const text = line.trim().replace(/\s+/g, " ");
  if (!text || text.length > 120) return false;

  if (
    /^(?:cap[ií]tulo|capitulo|chapter)\s+(?:\d{1,4}|[ivxlcdm]+|[a-z]+)(?:\s*[:.\-–—]\s*.+)?$/i.test(
      text
    )
  ) {
    return true;
  }

  if (
    /^(?:pr[oó]logo|prologo|ep[ií]logo|epilogo|prologue|epilogue)$/i.test(text)
  ) {
    return true;
  }

  if (
    /^(?:parte|part|livro|book)\s+(?:\d{1,4}|[ivxlcdm]+|[a-z]+)(?:\s*[:.\-–—]\s*.+)?$/i.test(
      text
    )
  ) {
    return true;
  }

  const hasLowercase = /[a-záàâãéêíóôõúüç]/.test(text);
  const hasLetter = /[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]/.test(text);
  const words = text.split(/\s+/).filter(Boolean);
  const surroundedByWhitespace =
    isBlankLine(previousLine) || isBlankLine(nextLine);

  return (
    surroundedByWhitespace &&
    hasLetter &&
    !hasLowercase &&
    words.length <= 8 &&
    text.length <= 70 &&
    !/[.!?]$/.test(text)
  );
}

function splitWordsIntoParts(content: string, maxWords: number) {
  const words = content.split(/\s+/).filter(Boolean);
  const totalParts = Math.max(1, Math.ceil(words.length / maxWords));
  const targetWords = Math.ceil(words.length / totalParts);
  const parts: string[] = [];

  for (let start = 0; start < words.length; start += targetWords) {
    parts.push(words.slice(start, start + targetWords).join(" "));
  }

  return parts;
}

function splitImportedWorkIntoBlocks(
  text: string,
  maxWords = CHAPTERED_REFERENCE_MAX_WORDS
): ImportedWorkTextBlock[] {
  const normalized = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const chapterCandidates: Array<{ title: string; content: string }> = [];
  let currentTitle = "Texto importado";
  let currentLines: string[] = [];
  let foundHeading = false;

  const pushCurrent = () => {
    const content = currentLines.join("\n").trim();
    if (content) {
      chapterCandidates.push({
        title: currentTitle,
        content,
      });
    }
    currentLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previousLine = lines[index - 1];
    const nextLine = lines[index + 1];
    if (isLikelyChapterHeading(line, previousLine, nextLine)) {
      foundHeading = true;
      pushCurrent();
      currentTitle = line.trim().replace(/\s+/g, " ");
      continue;
    }
    currentLines.push(line);
  }
  pushCurrent();

  const sourceBlocks =
    foundHeading && chapterCandidates.length
      ? chapterCandidates
      : [{ title: "Texto importado", content: normalized }];

  const blocks: ImportedWorkTextBlock[] = [];
  for (const sourceBlock of sourceBlocks) {
    const wordCount = countWords(sourceBlock.content);
    if (!wordCount) continue;

    if (wordCount <= maxWords) {
      blocks.push({
        index: blocks.length + 1,
        title: sourceBlock.title,
        content: sourceBlock.content,
        wordCount,
      });
      continue;
    }

    const parts = splitWordsIntoParts(sourceBlock.content, maxWords);
    parts.forEach((partContent, partIndex) => {
      blocks.push({
        index: blocks.length + 1,
        title: `${sourceBlock.title} - parte ${partIndex + 1}/${parts.length}`,
        content: partContent,
        wordCount: countWords(partContent),
        part: partIndex + 1,
        totalParts: parts.length,
      });
    });
  }

  return blocks;
}

function shouldAnalyzeReferenceByBlocks(
  content: string,
  blocks = splitImportedWorkIntoBlocks(content)
) {
  const words = countWords(content);
  return blocks.length > 1 || words > CHAPTERED_REFERENCE_MAX_WORDS;
}

function buildAnalysisBlocksContent(
  analysisBlocks: ReferenceAnalysisBlock[] | undefined
) {
  if (!analysisBlocks?.length) return "";
  return analysisBlocks
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(block =>
      [
        `[BLOCO ${block.index}] ${block.title}`,
        `${block.wordCount.toLocaleString("pt-BR")} palavras no bloco original`,
        block.sourceAnchors?.length
          ? `Âncoras literais do bloco: ${formatSourceAnchors(block.sourceAnchors)}`
          : "",
        block.dossier.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n---\n\n");
}

function buildAnalysisTextBlocks(
  analysisBlocks: ReferenceAnalysisBlock[] | undefined
): ImportedWorkTextBlock[] {
  if (!analysisBlocks?.length) return [];
  return analysisBlocks
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(block => ({
      index: block.index,
      title: block.title,
      content: block.dossier,
      wordCount: countWords(block.dossier),
      sourceAnchors: block.sourceAnchors,
      part: block.part,
      totalParts: block.totalParts,
    }));
}

function buildAnalysisObservationBlocks(
  analysisBlocks: ReferenceAnalysisBlock[] | undefined
) {
  return buildAnalysisTextBlocks(analysisBlocks).map(
    block =>
      [
        `[BLOCO ${block.index}] ${block.title}`,
        `${block.wordCount.toLocaleString("pt-BR")} palavras no bloco original`,
        block.sourceAnchors?.length
          ? `Âncoras literais do bloco: ${formatSourceAnchors(block.sourceAnchors)}`
          : "",
        block.content,
      ]
        .filter(Boolean)
        .join("\n\n")
  );
}

function totalTextLength(values: string[]) {
  return values.reduce((total, value) => total + value.length, 0);
}

function groupTextsByLength(values: string[], maxLength: number) {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const value of values) {
    if (current.length && currentLength + value.length > maxLength) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(value);
    currentLength += value.length;
  }

  if (current.length) groups.push(current);
  return groups;
}

function emptyUniverseProfile(): UniverseProfileData {
  return {
    overview: "",
    genre: "",
    timePeriod: "",
    locations: "",
    narrativeStructure: "",
    pov: "",
    chapterStructure: "",
    lore: "",
    powerRules: "",
    factions: "",
    timeline: "",
    socialRules: "",
    themesTone: "",
    continuityConstraints: "",
    openQuestions: "",
    notes: "",
  };
}

function parseUniverseProfilePayload(value: unknown): UniverseProfileData {
  if (Array.isArray(value)) {
    return {
      ...emptyUniverseProfile(),
      continuityConstraints: value
        .filter(item => typeof item === "string" && item.trim())
        .join("\n"),
    };
  }

  if (value && typeof value === "object") {
    const parsed = universeProfilePayloadSchema.safeParse(value);
    if (parsed.success) return parsed.data.data;
  }

  return emptyUniverseProfile();
}

function parseUniverseProfileJson(
  raw: string | null | undefined
): UniverseProfileData {
  if (!raw) return emptyUniverseProfile();
  try {
    return parseUniverseProfilePayload(JSON.parse(raw));
  } catch {
    return emptyUniverseProfile();
  }
}

function serializeUniverseProfile(profile: UniverseProfileData) {
  return JSON.stringify({ type: "universe-profile", data: profile });
}

function mergeTextField(current: string, incoming: string) {
  const currentText = current.trim();
  const incomingText = incoming.trim();
  if (!incomingText) return currentText;
  if (!currentText) return incomingText;
  if (textSimilarity(currentText, incomingText) > 0.82) return currentText;
  return `${currentText}\n\n${incomingText}`;
}

function mergeUniverseProfiles(
  current: UniverseProfileData,
  incoming: UniverseProfileData
): UniverseProfileData {
  return {
    overview: incoming.overview.trim(),
    genre: incoming.genre.trim(),
    timePeriod: incoming.timePeriod.trim(),
    locations: incoming.locations.trim(),
    narrativeStructure:
      incoming.narrativeStructure.trim(),
    pov: incoming.pov.trim(),
    chapterStructure: incoming.chapterStructure.trim(),
    lore: incoming.lore.trim(),
    powerRules: incoming.powerRules.trim(),
    factions: incoming.factions.trim(),
    timeline: incoming.timeline.trim(),
    socialRules: incoming.socialRules.trim(),
    themesTone: incoming.themesTone.trim(),
    continuityConstraints: incoming.continuityConstraints.trim(),
    openQuestions: incoming.openQuestions.trim(),
    notes: current.notes,
  };
}

function formatUniverseKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function stringifyUniverseValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);

  if (Array.isArray(value)) {
    return value
      .map(item => stringifyUniverseValue(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => {
        const text = stringifyUniverseValue(nested);
        return text ? `${formatUniverseKey(key)}: ${text}` : "";
      })
      .filter(Boolean);
    return entries.join("; ");
  }

  return "";
}

function pickUniverseCandidate(
  parsed: unknown
): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const object = parsed as Record<string, unknown>;

  if (
    object.type === "universe-profile" &&
    object.data &&
    typeof object.data === "object" &&
    !Array.isArray(object.data)
  ) {
    return object.data as Record<string, unknown>;
  }

  const nestedKeys = [
    "data",
    "universe",
    "universeProfile",
    "profile",
    "worldbuilding",
  ];
  for (const key of nestedKeys) {
    const value = object[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      if (
        UNIVERSE_PROFILE_FIELD_KEYS.some(field => nested[field] !== undefined)
      )
        return nested;
      if (
        Object.values(UNIVERSE_PROFILE_ALIASES)
          .flat()
          .some(alias => nested[alias] !== undefined)
      )
        return nested;
    }
  }

  if (
    UNIVERSE_PROFILE_FIELD_KEYS.some(field => object[field] !== undefined) ||
    Object.values(UNIVERSE_PROFILE_ALIASES)
      .flat()
      .some(alias => object[alias] !== undefined)
  ) {
    return object;
  }

  return null;
}

function coerceUniverseProfile(parsed: unknown): UniverseProfileData | null {
  const candidate = pickUniverseCandidate(parsed);
  if (!candidate) return null;

  const profile = emptyUniverseProfile();

  for (const field of UNIVERSE_PROFILE_FIELD_KEYS) {
    const aliases = UNIVERSE_PROFILE_ALIASES[field] || [];
    const rawValue =
      candidate[field] ??
      aliases.map(alias => candidate[alias]).find(value => value !== undefined);
    profile[field] = stringifyUniverseValue(rawValue);
  }

  return hasUniverseProfileValue(profile) ? profile : null;
}

function hasUniverseProfileValue(profile: UniverseProfileData) {
  return UNIVERSE_PROFILE_FIELD_KEYS.some(
    field => field !== "notes" && profile[field].trim()
  );
}

function parseUniverseFromJson(raw: string): UniverseProfileData | null {
  // Fix: regex anterior `(:json)` capturava ":json" literal; agora cobre ```json/```JSON/```.
  const cleaned = raw
    .replace(/^```(?:json|JSON)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  const direct = universeProfileDataSchema.safeParse(parsed);
  if (direct.success && hasUniverseProfileValue(direct.data))
    return direct.data;
  const wrapped = universeProfilePayloadSchema.safeParse(parsed);
  if (wrapped.success && hasUniverseProfileValue(wrapped.data.data))
    return wrapped.data.data;
  return coerceUniverseProfile(parsed);
}

function parseStyleAnalysisFromJson(raw: string): StyleAnalysis | null {
  // Fix: regex anterior `(:json)` capturava ":json" literal; agora cobre ```json/```JSON/```.
  const cleaned = raw
    .replace(/^```(?:json|JSON)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  const result = styleAnalysisSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanImportedCharacterField(value: string | undefined) {
  if (!value) return undefined;
  const cleaned = compactWhitespace(value)
    .replace(/^N\/A$/i, "")
    .replace(/^Não informado\.$/i, "")
    .replace(/^Não mencionado\.$/i, "")
    .trim();
  return cleaned || undefined;
}

function isLowValueCharacterText(value: string | null | undefined) {
  const text = compactWhitespace(value || "");
  if (!text) return true;
  const genericHits = [
    /\b(personagem|figura)\s+(complex[oa]|importante|central|relevante)\b/i,
    /\b(determinad[oa]|corajos[oa]|resiliente|mistrios[oa]|forte|inteligente)\b/i,
    /\btem um papel importante\b/i,
    /\benfrenta desafios\b/i,
    /\bpassa por uma jornada\b/i,
    /\bbusca seu lugar\b/i,
  ].filter(pattern => pattern.test(text)).length;
  const synopsisHits = [
    /\binicialmente apresentado\b/i,
    /\b(:ele|ela)\s+(:se alista|participa|descobre|passa|termina|confronta|treina|mata|foge|retorna)\b/i,
    /\b(:ap[oo]s|durante|no final|ao longo)\b/i,
    /\bmiss[aã]o\b/i,
    /\bhist[oo]ria\b/i,
    /\b(:e capturado|e resgatado|e abordado|e manipulado)\b/i,
  ].filter(pattern => pattern.test(text)).length;
  const writingReadySignals = [
    /\bsob press[aã]o\b/i,
    /\b(:voz|fala|cad[eê]ncia|vocabul[aá]rio)\b/i,
    /\b(:gatilho|limite|contradi[cç][aã]o|ferida|autoengano)\b/i,
    /\b(:medo|desejo|culpa|lealdade|ambio|ambição)\b/i,
    /\b(:em cena|para escrever|na escrita|rascunho)\b/i,
  ].some(pattern => pattern.test(text));

  return (
    text.length < 140 ||
    (text.length < 280 && genericHits >= 2) ||
    (text.length > 420 && synopsisHits >= 4 && !writingReadySignals)
  );
}

function isImportedAutomaticField(notes: string | null | undefined) {
  return Boolean(notes?.includes("[Importado"));
}

function shouldUseIncomingCharacterField(
  currentValue: string | null | undefined,
  incomingValue: string | undefined,
  notes: string | null | undefined
) {
  const current = compactWhitespace(currentValue || "");
  const incoming = compactWhitespace(incomingValue || "");
  if (!incoming) return false;
  if (!current) return true;
  if (!isImportedAutomaticField(notes)) return false;
  const currentIsLowValue = isLowValueCharacterText(current);
  if (
    (currentIsLowValue || current.length > 520) &&
    incoming.length < current.length * 0.85 &&
    textSimilarity(current, incoming) < 0.82
  )
    return true;
  if (!currentIsLowValue) return false;
  return (
    incoming.length > current.length + 80 ||
    textSimilarity(current, incoming) < 0.75
  );
}

function importedCharacterNote(title: string, notes: string | undefined) {
  const importNotePrefix = `[Importado de "${title}"] `;
  return `${importNotePrefix}${(notes || "").trim()}`.trim() ||
    importNotePrefix.trim();
}

function compactNullable(value: string | null | undefined) {
  const compacted = compactWhitespace(value || "");
  return compacted || null;
}

function characterValueChanged(
  current: string | null | undefined,
  next: string | null | undefined
) {
  return compactNullable(current) !== compactNullable(next);
}

function addChangedCharacterField(
  updates: Record<string, string | null | undefined>,
  existing: Record<string, unknown>,
  key: string,
  value: string | null | undefined
) {
  const nextValue = compactNullable(value);
  if (characterValueChanged(existing[key] as string | null | undefined, nextValue)) {
    updates[key] = nextValue;
  }
}

function buildCharacterUpdatePayload(input: {
  existing: Record<string, unknown>;
  extracted: ImportedCharacter;
  sourceTitle: string;
  forceReplaceImported: boolean;
}) {
  const { existing, extracted, sourceTitle, forceReplaceImported } = input;
  const importedAutomatic = isImportedAutomaticField(
    existing.notes as string | null | undefined
  );
  const updates: Record<string, string | null | undefined> = {};

  if (forceReplaceImported && importedAutomatic) {
    addChangedCharacterField(updates, existing, "name", extracted.name.trim());
    addChangedCharacterField(updates, existing, "role", extracted.role ?? null);
    addChangedCharacterField(
      updates,
      existing,
      "history",
      extracted.history.trim()
    );
    addChangedCharacterField(
      updates,
      existing,
      "personality",
      extracted.personality ?? null
    );
    addChangedCharacterField(
      updates,
      existing,
      "physicalDescription",
      extracted.physicalDescription ?? null
    );
    addChangedCharacterField(
      updates,
      existing,
      "speechStyle",
      extracted.speechStyle ?? null
    );
    addChangedCharacterField(
      updates,
      existing,
      "psychologicalProfile",
      extracted.psychologicalProfile ?? null
    );
    addChangedCharacterField(
      updates,
      existing,
      "backstory",
      extracted.backstory ?? null
    );
    addChangedCharacterField(
      updates,
      existing,
      "motivations",
      extracted.motivations ?? null
    );
    addChangedCharacterField(
      updates,
      existing,
      "relationships",
      extracted.relationships ?? null
    );
    addChangedCharacterField(
      updates,
      existing,
      "notes",
      importedCharacterNote(sourceTitle, extracted.notes)
    );
    return updates;
  }

  if (!existing.role && extracted.role) updates.role = extracted.role;
  if (
    shouldUseIncomingCharacterField(
      existing.history as string | null | undefined,
      extracted.history,
      existing.notes as string | null | undefined
    )
  )
    updates.history = extracted.history;
  if (
    shouldUseIncomingCharacterField(
      existing.personality as string | null | undefined,
      extracted.personality,
      existing.notes as string | null | undefined
    )
  )
    updates.personality = extracted.personality;
  if (
    shouldUseIncomingCharacterField(
      existing.physicalDescription as string | null | undefined,
      extracted.physicalDescription,
      existing.notes as string | null | undefined
    )
  )
    updates.physicalDescription = extracted.physicalDescription;
  if (
    shouldUseIncomingCharacterField(
      existing.speechStyle as string | null | undefined,
      extracted.speechStyle,
      existing.notes as string | null | undefined
    )
  )
    updates.speechStyle = extracted.speechStyle;
  if (
    shouldUseIncomingCharacterField(
      existing.psychologicalProfile as string | null | undefined,
      extracted.psychologicalProfile,
      existing.notes as string | null | undefined
    )
  )
    updates.psychologicalProfile = extracted.psychologicalProfile;
  if (
    shouldUseIncomingCharacterField(
      existing.backstory as string | null | undefined,
      extracted.backstory,
      existing.notes as string | null | undefined
    )
  )
    updates.backstory = extracted.backstory;
  if (
    shouldUseIncomingCharacterField(
      existing.motivations as string | null | undefined,
      extracted.motivations,
      existing.notes as string | null | undefined
    )
  )
    updates.motivations = extracted.motivations;
  if (
    shouldUseIncomingCharacterField(
      existing.relationships as string | null | undefined,
      extracted.relationships,
      existing.notes as string | null | undefined
    )
  )
    updates.relationships = extracted.relationships;
  if (
    shouldUseIncomingCharacterField(
      existing.notes as string | null | undefined,
      extracted.notes,
      existing.notes as string | null | undefined
    )
  )
    updates.notes = `${(existing.notes as string | null) || ""}\n\n${
      extracted.notes
    }`.trim();

  return updates;
}

function firstCharacterNameToken(name: string) {
  return normalizeSearchText(compactWhitespace(name).split(" ")[0] || "");
}

function findExistingCharacterForExtraction<
  T extends { id: number; name: string; notes?: string | null },
>(input: {
  extracted: ImportedCharacter;
  existingCharacters: T[];
  linkedImportedIds: Set<number>;
  consumedIds: Set<number>;
  forceReplaceImported: boolean;
  sourceTitle?: string;
}): T | undefined {
  const normalizedName = input.extracted.name.trim().toLowerCase();
  const exact = input.existingCharacters.find(character => {
    const id = Number(character.id);
    return (
      !input.consumedIds.has(id) &&
      String(character.name || "").trim().toLowerCase() === normalizedName
    );
  });
  if (exact) return exact;

  if (!input.forceReplaceImported) return undefined;
  const extractedFirstName = firstCharacterNameToken(input.extracted.name);
  if (!extractedFirstName) return undefined;

  return input.existingCharacters.find(character => {
    const id = Number(character.id);
    if (input.consumedIds.has(id)) return false;
    const notes = character.notes as string | null | undefined;
    if (!isImportedAutomaticField(notes)) return false;
    const linkedToReference =
      input.linkedImportedIds.has(id) ||
      Boolean(
        input.sourceTitle &&
          notes?.includes(`[Importado de "${input.sourceTitle}"]`)
      );
    if (!linkedToReference) return false;
    return firstCharacterNameToken(String(character.name || "")) === extractedFirstName;
  });
}

function normalizeImportedCharacter(
  character: ImportedCharacter
): ImportedCharacter | null {
  const history = cleanImportedCharacterField(character.history);
  if (!history) return null;

  const normalized: ImportedCharacter = {
    name: compactWhitespace(character.name),
    role: cleanImportedCharacterField(character.role),
    history,
    personality: cleanImportedCharacterField(character.personality),
    physicalDescription: cleanImportedCharacterField(
      character.physicalDescription
    ),
    speechStyle: cleanImportedCharacterField(character.speechStyle),
    psychologicalProfile: cleanImportedCharacterField(
      character.psychologicalProfile
    ),
    backstory: cleanImportedCharacterField(character.backstory),
    motivations: cleanImportedCharacterField(character.motivations),
    relationships: cleanImportedCharacterField(character.relationships),
    notes: cleanImportedCharacterField(character.notes),
  };

  for (const field of [
    "personality",
    "speechStyle",
    "psychologicalProfile",
    "backstory",
    "motivations",
    "relationships",
    "notes",
  ] as const) {
    const value = normalized[field];
    if (value && textSimilarity(history, value) > 0.86) {
      normalized[field] = undefined;
    }
  }

  return normalized.name ? normalized : null;
}

function parseImportedCharactersFromJson(raw: string): ImportedCharacter[] {
  // Bug fix: o regex anterior era `/^```(:json)\s*/i` — `(:json)` é um grupo
  // capturando literalmente ":json" em vez de tornar "json" opcional. Como
  // resultado, blocos markdown ```json ... ``` não eram limpos, JSON.parse
  // quebrava nas crases e o fallback do match também falhava se o LLM
  // colocasse texto antes/depois. Agora `(?:json|JSON)?` é grupo NÃO-capturado
  // e opcional, cobrindo ```json, ```JSON e ``` sem linguagem.
  const cleaned = raw
    .replace(/^```(?:json|JSON)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*"characters"[\s\S]*\}/);
    if (!jsonMatch) return [];
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }
  }
  if (!parsed?.characters || !Array.isArray(parsed.characters)) return [];

  // Bug fix: antes era `z.array(importedCharacterSchema).parse(...)`, que é
  // ALL-OR-NOTHING — se um único personagem viesse sem `history`, o parse
  // jogava exceção e o array INTEIRO era perdido (caía no catch externo
  // em extractCharactersFromReference, retornando []). Resultado prático:
  // nenhum personagem era importado quando o LLM retornava um resumo
  // levemente incompleta. Agora validamos UM POR UM com safeParse e
  // descartamos só os malformados, preservando os bons.
  const validated: ImportedCharacter[] = [];
  for (const raw of parsed.characters) {
    const result = importedCharacterSchema.safeParse(raw);
    if (!result.success) {
      // Não derrubamos o batch — logamos pra observabilidade e seguimos.
      // eslint-disable-next-line no-console
      console.warn(
        "[Profile] Personagem ignorado por schema inválido:",
        result.error.issues
          .map(i => i.path.join(".") + ": " + i.message)
          .join(", ")
      );
      continue;
    }
    const normalized = normalizeImportedCharacter(result.data);
    if (normalized) validated.push(normalized);
  }
  return validated;
}

async function extractCharacterObservationsFromChunk(input: {
  title: string;
  chunkLabel: string;
  chunkContent: string;
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você esta fazendo a leitura integral de uma obra em trechos sequênciais para mapear personagens.
Retorne APENAS JSON puro.
Não crie resumos finais ainda. Extraia evidências concretas deste trecho.
Use somente o trecho recebido. Não complete sobrenomes, datas, parentescos, motivações, organizações ou passado com conhecimento externo, memória do gênero ou dedução solta.
Não transfira parentesco entre personagens que aparecem próximos. Se A conhece a mãe de B, isso não torna A pai de B. Se A é filho de informante, esse fato pertence a A.
Não invente causa ou método de morte. "aparece morto" não autoriza "morto a tiros", "assassinado", "executado" ou "envenenado" sem frase explícita no trecho.
Use o nome mais completo que aparece no trecho. Não crie uma ficha por sobrenome isolado se o nome completo aparece.
Se uma informação não estiver literalmente no trecho, omita. Se houver inferência inevitável, marque como inferência e explique qual frase do trecho sustenta.
Inclua todo personagem nomeado que apareça com ação, relação, decisão, trauma, conflito, revelacao, mudança de estado ou função narrativa.
Não use frases genéricas. Cada item precisa citar eventos, relações, cenas ou consequências presentes no trecho.
Registre sinais úteis para escrita: como a pessoa decide sob pressão, como fala, o que evita, o que deseja, que relação muda e que detalhes um autor não pode contradizer depois.
Se o trecho não mostrar fala direta, registre "speech" apenas quando for possível inferir por comportamento, hierarquia social ou reação emocional. Marque como inferência.

Formato:
{"characters":[{"name":"Nome","aliases":["apelidos se houver"],"roleHint":"função aparente no trecho","evidence":["ação concreta, escolha, conflito ou consequência"],"relationships":["relação concreta com outro personagem + efeito da relação"],"psychology":["comportamento observável sob pressão"],"speech":["voz, vocabulário, formalidade, silêncio, jeito de reagir verbalmente"],"sceneUse":["como este personagem deve ser usado em cenas futuras"],"backstory":["passado revelado"],"continuityLocks":["fato que não pode ser contradito"],"openQuestions":["pontos ainda inconclusos"]}]}`,
      },
      {
        role: "user",
        content: `Obra: "${input.title}"\n${input.chunkLabel}\n\n${input.chunkContent}`,
      },
    ],
    maxTokens: 8192,
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  return typeof raw === "string" ? raw.trim() : "";
}

async function compactCharacterObservationBatch(input: {
  title: string;
  batchLabel: string;
  observations: string[];
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você esta consolidando dossiês intermediários por capítulo.
Isto NÃO é o resumo final de personagens.
Preserve todos os fatos concretos encontrados: nomes, aliases, ações, escolhas, perdas, traições, relações, mudanças de lado, segredos, motivações, estado final e consequências.
Preserve tambm voz/fala, gatilhos emocionais, padrões de decisão, limites canônicos e usos práticos em cena.
Não reduza histórias a descrições curtas. Não apague personagens secundários relevantes.
Se o mesmo personagem aparecer em observações diferentes, una tudo em um dossiê contínuo, mantendo a evolução cronológica.
Retorne texto estruturado por personagem, denso e específico, para uma consolidação global posterior.`,
      },
      {
        role: "user",
        content: `Obra: "${input.title}"\n${input.batchLabel}\n\n${input.observations.join("\n\n---\n\n")}`,
      },
    ],
    maxTokens: 12000,
    temperature: FACTUAL_EXTRACTION_TEMPERATURE,
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  return typeof raw === "string" ? raw.trim() : "";
}

async function prepareCharacterObservationsForFinal(input: {
  title: string;
  observations: string[];
}) {
  let current = input.observations.filter(Boolean);

  for (
    let pass = 0;
    pass < 2 && totalTextLength(current) > FINAL_OBSERVATION_MAX_CHARS;
    pass += 1
  ) {
    const groups = groupTextsByLength(current, OBSERVATION_BATCH_MAX_CHARS);
    const compacted = (
      await mapWithConcurrency(
        groups,
        CHAPTERED_SUMMARY_CONCURRENCY,
        (group, index) =>
          compactCharacterObservationBatch({
            title: input.title,
            batchLabel: `Consolidação intermediaria ${index + 1} de ${groups.length}`,
            observations: group,
          })
      )
    ).filter(Boolean);

    if (
      !compacted.length ||
      compacted.join("\n").length >= current.join("\n").length
    )
      break;
    current = compacted;
  }

  return current;
}

async function consolidateCharacterObservations(input: {
  title: string;
  summary: string;
  summarySections: ReferenceSummarySection[];
  observations: string[];
  sourceContent?: string;
}) {
  const summary = input.summarySections.length
    ? input.summarySections
        .map(section => `${section.label}\n${section.content.trim()}`)
        .join("\n\n")
    : input.summary.trim();
  const completeObservations = await prepareCharacterObservationsForFinal({
    title: input.title,
    observations: input.observations,
  });

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você vai consolidar dossiês por capítulo de uma obra inteira.
Sua tarefa é criar RESUMOS BIOGRÁFICOS finais de personagens a partir desses dossiês, sem depender de amostragem.

REGRAS CRITICAS:
- Retorne APENAS JSON puro.
- Use somente as observações abaixo como fonte. O resumo importado não é fonte canônica para nomes, datas, relações ou motivações.
- Não complete lacunas com conhecimento externo, expectativa de gênero ou suposição narrativa. Se a observação não sustenta, omita.
- As "Âncoras literais" de cada bloco são nomes/termos que apareceram no texto original. Não crie nome próprio, sobrenome, família, país, empresa ou facção fora delas ou fora das observações.
- Una aliases e nomes alternativos do mesmo personagem.
- Não transfira parentesco entre nomes próximos. "A conhece a mãe de B" não torna A pai de B. "A é filho de informante" é fato de A, não de outro personagem citado na cena.
- Inclua personagens narrativamente relevantes do livro inteiro, não apenas protagonistas.
- A profundidade do resumo precisa ser proporcional ao peso narrativo: protagonistas/antagonistas centrais devem ter resumo muito maior; secundários recorrentes devem ser médios; personagem citado ou funcional deve ser curto ou omitido. Não iguale todo mundo.
- Antes de escrever qualquer campo, pergunte: "qual dossiê sustenta isto?". Se não houver resposta, omita.
- Não transforme hipótese, medo, boato ou crença de personagem em fato canônico.
- Não invente causa ou método de morte. Se a observação só diz que alguém morreu/apareceu morto, não escreva "a tiros", "envenenado", "executado" ou "assassinado" sem suporte explícito.
- Use o nome canônico mais completo sustentado pelo texto. Não crie ficha por sobrenome isolado quando o nome completo existe.
- Preserve acontecimentos, escolhas, perdas, traições, mudanças de lado, relações de poder, segredos e estado final.
- Não use frases-clich como "personagem complexo", "determinado", "enfrenta desafios", "passa por uma jornada", "busca seu lugar".
- Não repita o mesmo texto em campos diferentes.
- Se houver contradição entre observações, mantenha a evolução cronológica em vez de apagar a contradição.

QUALIDADE DOS RESUMOS:
- O campo "history" é o produto principal. Ele precisa servir para o autor escolher o personagem no Rascunho e escrever uma cena sem pesquisar de novo.
- "history" deve ser um resumo biográfico narrativo, em prosa e em ordem: origem/estado inicial, eventos vividos, decisões, revelações, perdas, relações que mudam, consequências e estado final conhecido.
- Não há limite artificial de palavras para protagonista/antagonista central/aliados centrais; preserve o arco inteiro sem transformar em lista. Secundários recorrentes ficam menores e personagens funcionais ficam curtos.
- Se o personagem atravessa vários blocos, escreva a biografia como linha de vida em ordem, com consequências, e não como amontoado de evidências.
- Nunca escreva "Presença verificada", "Resumo factual", "Personagens em cena", "Eventos e ações em ordem", "Referenciados" ou marcadores de bloco dentro de "history".
- "personality": padrões de comportamento demonstrados em cena, contradições, como age sob pressão, o que faz quando est? com medo, irritado, leal, culpado ou acuado.
- "speechStyle": jeito de falar/escrever em cena: formalidade, ritmo, vocabulário, agressividade, silêncio, ironia, hesitao, termos recorrentes, postura em diálogo. Se for inferência, diga que e inferência.
- "backstory": passado antes da narrativa, com fatos concretos, não frases vagas.
- "relationships": relações por nome, com dinâmica, tensão, dependência, dúvida, traição, proteção ou medo; indique o evento que alterou a relação quando houver.
- "motivations": desejo visível, medo escondido, objetivo declarado, objetivo real e como isso muda ao longo da história.
- "psychologicalProfile": ferida interna, mecanismo de defesa, autoengano, limite moral, gatilhos emocionais e tipo de escolha que tende a fazer.
- "notes": escreva "Uso em Rascunho:" e inclua função em cena, conflitos que ele puxa, pares/personagens que rendem atrito, detalhes que não podem ser contraditos e alertas para a IA não escrever de forma genérica.
- Se um campo não tiver evidência suficiente, omita o campo. Não preencha com "não informado".

Formato:
{"characters":[{"name":"Nome Completo","role":"função narrativa específica","history":"resumo biográfico narrativo completo do personagem, em ordem","personality":"comportamento em cena e contradições","physicalDescription":"aparência se mencionada","speechStyle":"voz, fala, ritmo e postura em diálogo","psychologicalProfile":"feridas, gatilhos e padrões de decisão","backstory":"passado anterior","motivations":"desejos, medos e mudanças","relationships":"relações concretas por nome","notes":"alertas de continuidade para Escrita"}]}`,
      },
      {
        role: "user",
        content: [
          `Obra: "${input.title}"`,
          `Dossiês por capítulo preservados para síntese global:\n${completeObservations.map((item, index) => `[BLOCO GLOBAL ${index + 1}]\n${item}`).join("\n\n")}`,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n"),
      },
    ],
    maxTokens: 16384,
    temperature: FACTUAL_EXTRACTION_TEMPERATURE,
    response_format: { type: "json_object" },
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  const parsed = typeof raw === "string" ? parseImportedCharactersFromJson(raw) : [];
  const evidenceText = [
    completeObservations.join("\n\n"),
    input.sourceContent || "",
  ]
    .filter(Boolean)
    .join("\n\n--- TEXTO ORIGINAL ---\n\n");
  return groundImportedCharacters(
    parsed,
    evidenceText
  );
}

async function extractUniverseObservationsFromChunk(input: {
  title: string;
  chunkLabel: string;
  chunkContent: string;
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você esta lendo uma obra inteira em trechos sequênciais para mapear o UNIVERSO da obra.
Retorne APENAS JSON puro.
Não crie a ficha final ainda. Extraia observações concretas deste trecho.
Use somente este trecho. Não use conhecimento histórico externo, Wikipedia mental, contexto de Guerra Fria, gênero, nem datas famosas se elas não aparecem literalmente no material.
Não transforme data mencionada como referência em data do evento principal. Registre o que aconteceu no trecho e a data somente quando o texto sustentar.
Cada item de timeline deve indicar o bloco/capítulo em que apareceu e diferenciar "aconteceu em" de "foi revelado em".
Registre: época/ano, gênero, lugares, estrutura narrativa, POV/foco, estrutura de capítulos, lore, regras de poder/magia/tecnologia, facções, história do mundo, regras sociais, temas, tom, limites canônicos e perguntas abertas.
Se uma categoria não aparecer no trecho, use string vazia ou array vazio. Não invente.

Formato:
{"overview":["observações gerais"],"genre":["gênero/tom indicado"],"timePeriod":["ano/período"],"locations":["lugares"],"narrativeStructure":["estrutura narrativa"],"pov":["POV/foco narrativo"],"chapterStructure":["padrões de capítulo"],"lore":["lore e cosmologia"],"powerRules":["regras de poder se existirem"],"factions":["grupos/instituições"],"timeline":["[ANO] evento com ano obrigatório"],"socialRules":["normas sociais/políticas"],"themesTone":["temas e tom"],"continuityConstraints":["fatos que não podem ser contraditos"],"openQuestions":["lacunas/pontas abertas"]}`,
      },
      {
        role: "user",
        content: `Obra: "${input.title}"\n${input.chunkLabel}\n\n${input.chunkContent}`,
      },
    ],
    maxTokens: 8192,
    temperature: FACTUAL_EXTRACTION_TEMPERATURE,
    response_format: { type: "json_object" },
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  return typeof raw === "string" ? raw.trim() : "";
}

async function compactUniverseObservationBatch(input: {
  title: string;
  batchLabel: string;
  observations: string[];
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você esta consolidando observações intermediarias sobre o UNIVERSO de uma obra.
Isto NÃO é a ficha final.
Preserve todos os elementos concretos: anos, períodos, lugares, eventos históricos, POV, estrutura de capítulos, lore, regras de poder, facções, regras sociais, temas, limites canônicos e pontas abertas.
Não misture categorias de forma vaga e não escreva resumo genérico.
Una observações repetidas, mantenha contradições como evolução temporal quando fizer sentido e prepare um bloco completo para a síntese global posterior.
Retorne texto estruturado por categorias.`,
      },
      {
        role: "user",
        content: `Obra: "${input.title}"\n${input.batchLabel}\n\n${input.observations.join("\n\n---\n\n")}`,
      },
    ],
    maxTokens: 12000,
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  return typeof raw === "string" ? raw.trim() : "";
}

async function prepareUniverseObservationsForFinal(input: {
  title: string;
  observations: string[];
}) {
  let current = input.observations.filter(Boolean);

  for (
    let pass = 0;
    pass < 2 && totalTextLength(current) > FINAL_OBSERVATION_MAX_CHARS;
    pass += 1
  ) {
    const groups = groupTextsByLength(current, OBSERVATION_BATCH_MAX_CHARS);
    const compacted = (
      await mapWithConcurrency(
        groups,
        CHAPTERED_SUMMARY_CONCURRENCY,
        (group, index) =>
          compactUniverseObservationBatch({
            title: input.title,
            batchLabel: `Consolidação intermediaria ${index + 1} de ${groups.length}`,
            observations: group,
          })
      )
    ).filter(Boolean);

    if (
      !compacted.length ||
      compacted.join("\n").length >= current.join("\n").length
    )
      break;
    current = compacted;
  }

  return current;
}

async function consolidateUniverseObservations(input: {
  title: string;
  observations: string[];
  currentProfile: UniverseProfileData;
}) {
  const completeObservations = await prepareUniverseObservationsForFinal({
    title: input.title,
    observations: input.observations,
  });

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você vai consolidar dossiês por capítulo de uma obra inteira.
Crie uma ficha completa do UNIVERSO para orientar escrita futura. Use o conjunto completo de dossiês, não amostragem.
Cada campo deve funcionar como regra operacional para Rascunho/Escrita, não como resumo bonito.
Retorne APENAS JSON puro, com strings longas e especficas em cada campo.

REGRAS DE FONTE:
- Use somente as observações extraídas dos blocos. Não use conhecimento histórico externo, datas famosas ou relações causais que não estejam nas observações.
- Não aproveite universo salvo anteriormente como fonte factual. Preserve apenas notas manuais do autor.
- As "Âncoras literais" são nomes/termos extraídos do texto original. Não crie nomes de países, famílias, empresas, facções, lugares ou pessoas fora das observações/âncoras.
- Não transforme contexto histórico real em evento da obra. Só registre evento se os dossiês disserem que aconteceu dentro da narrativa ou do passado canônico da obra.
- Não transforme hipótese, crença, medo, boato ou fala manipuladora de personagem em verdade do universo.
- Se um bloco menciona uma data antiga dentro de uma fala/memória, registre essa data apenas se houver um evento concreto associado a ela.
- A timeline deve ser cronologia histórica interna da obra: evento antigo primeiro, presente narrativo depois, epílogo por último. Nada pode ficar depois do epílogo se a observação indicar que ele é o encerramento.
- Não misture vários anos em um único evento. Um cartão de timeline deve conter um acontecimento específico.

Campos:
- overview: o que  este universo/obra e sua lógica central.
- genre: gênero, subgêneros e promessa narrativa.
- timePeriod: ano, período histórico, tecnologia, calendário ou temporalidade.
- locations: lugares, territórios, cidades, ambientes e sua função dramática.
- narrativeStructure: estrutura narrativa observada, alternncia de tramas, molduras, saltos temporais.
- pov: POV/foco narrativo, narrador, distância emocional, alternncia de perspectivas se houver.
- chapterStructure: padro dos capítulos/cenas, ritmo, tamanho, cliffhangers, interldios, documentos internos se existirem.
- lore: mitologia, cosmologia, história do mundo, fatos canônicos.
- powerRules: regras de poder/magia/tecnologia/sobrenatural/política, custo, limite e exceções.
- factions: grupos, famílias, governos, ordens, religies, sociedades, empresas ou exércitos.
- timeline: cronologia do mundo e da trama. OBRIGATÓRIO: cada evento DEVE começar com o ano ou período entre colchetes, usando apenas datas existentes no material, no formato "[ANO] Evento específico da obra..." ou "[MÊS de ANO] Evento específico da obra...". Não use exemplos históricos externos. Sem exceção — se o ano exato não for claro, use apenas um período explicitamente sustentado pelo texto. Liste os eventos em ordem cronológica estrita, do mais antigo ao mais recente.
- socialRules: leis, tabus, hierarquias, costumes, economia, religião, etiqueta e violência institucional.
- themesTone: temas recorrentes, atmosfera e tipo de conflito.
- continuityConstraints: fatos e limites que a IA nunca deve contradizer ao escrever.
- openQuestions: mistrios, pontas abertas e zonas ainda indefinidas.
- notes: deixe vazio, pois pertence ao autor.

Não use texto genérico. Cite nomes, lugares, datas, instituições, regras e consequências quando as observações trouxerem isso.
Sempre que possível, explique como esse elemento deve limitar ou orientar novas cenas.
Se uma obra não tiver magia/poder, explique "não identificado no material" em powerRules e registre as regras de poder social/político se forem relevantes.`,
      },
      {
        role: "user",
        content: [
          `Obra: "${input.title}"`,
          input.currentProfile
            ? `Universo já salvo pelo autor (preserve notas manuais e melhore o restante):\n${JSON.stringify(input.currentProfile)}`
            : "",
          `Dossiês por capítulo preservados para síntese global:\n${completeObservations.map((item, index) => `[BLOCO GLOBAL ${index + 1}]\n${item}`).join("\n\n")}`,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n"),
      },
    ],
    maxTokens: 16384,
    temperature: FACTUAL_EXTRACTION_TEMPERATURE,
    response_format: { type: "json_object" },
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  const parsed = typeof raw === "string" ? parseUniverseFromJson(raw) : null;
  return parsed ? limitUniverseFieldWords(parsed) : null;
}

async function analyzeUniverseIntegralFromReference(input: {
  title: string;
  content: string;
  currentProfile: UniverseProfileData;
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você vai ler o texto integral de uma obra em uma única passagem antes de preencher o perfil de UNIVERSO.
Leia tudo primeiro. Depois compacte o que leu em campos completos para orientar escrita futura.
Cada campo deve funcionar como regra operacional para Rascunho/Escrita, não como resumo bonito.
Retorne APENAS JSON puro, com strings longas e especficas em cada campo.

REGRAS DE FONTE:
- Use somente o texto integral recebido. Não use conhecimento histórico externo, datas famosas ou relações causais que não estejam no texto.
- Não aproveite universo salvo anteriormente como fonte factual. Preserve apenas notas manuais do autor.
- Não transforme contexto histórico real em evento da obra. Só registre evento se o texto disser que aconteceu dentro da narrativa ou do passado canônico da obra.
- Não transforme hipótese, crença, medo, boato ou fala manipuladora de personagem em verdade do universo.
- Se uma data antiga aparece dentro de uma fala/memória, registre essa data apenas se houver evento concreto associado a ela.
- Não misture vários anos em um único evento de timeline.

Campos:
- overview: o que  este universo/obra e sua lógica central.
- genre: gênero, subgêneros e promessa narrativa.
- timePeriod: ano, período histórico, tecnologia, calendário ou temporalidade.
- locations: lugares, territórios, cidades, ambientes e sua função dramática.
- narrativeStructure: estrutura narrativa observada, alternncia de tramas, molduras, saltos temporais.
- pov: POV/foco narrativo, narrador, distância emocional, alternncia de perspectivas se houver.
- chapterStructure: padro dos capítulos/cenas, ritmo, tamanho, cliffhangers, interldios, documentos internos se existirem.
- lore: mitologia, cosmologia, história do mundo, fatos canônicos.
- powerRules: regras de poder/magia/tecnologia/sobrenatural/política, custo, limite e exceções.
- factions: grupos, famílias, governos, ordens, religies, sociedades, empresas ou exércitos.
- timeline: cronologia do mundo e da trama. OBRIGATÓRIO: cada evento DEVE começar com o ano ou período entre colchetes, usando apenas datas existentes no material, no formato "[ANO] Evento específico da obra..." ou "[MÊS de ANO] Evento específico da obra...". Não use exemplos históricos externos. Sem exceção — se o ano exato não for claro, use apenas um período explicitamente sustentado pelo texto. Liste os eventos em ordem cronológica estrita, do mais antigo ao mais recente.
- socialRules: leis, tabus, hierarquias, costumes, economia, religião, etiqueta e violência institucional.
- themesTone: temas recorrentes, atmosfera e tipo de conflito.
- continuityConstraints: fatos e limites que a IA nunca deve contradizer ao escrever.
- openQuestions: mistrios, pontas abertas e zonas ainda indefinidas.
- notes: deixe vazio, pois pertence ao autor.

Não faca resumo genérico. Cite nomes, anos, lugares, instituições, regras, eventos e consequências quando existirem.
Sempre que possível, explique como esse elemento deve limitar ou orientar novas cenas.
Se uma categoria não existir no texto, diga explicitamente que não foi identificada no material em vez de inventar.
O resultado deve ser uma compactação posterior a leitura integral, não observações parciais.`,
      },
      {
        role: "user",
        content: [
          `Obra: "${input.title}"`,
          input.currentProfile
            ? `Universo já salvo pelo autor (preserve notas manuais e melhore o restante):\n${JSON.stringify(input.currentProfile)}`
            : "",
          `Texto integral da obra (${countWords(input.content).toLocaleString("pt-BR")} palavras):\n\n${input.content.trim()}`,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n"),
      },
    ],
    maxTokens: 16384,
    temperature: FACTUAL_EXTRACTION_TEMPERATURE,
    response_format: { type: "json_object" },
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  const parsed = typeof raw === "string" ? parseUniverseFromJson(raw) : null;
  return parsed ? limitUniverseFieldWords(parsed) : null;
}

async function analyzeUniverseFromReference(input: {
  title: string;
  content: string;
  currentProfile: UniverseProfileData;
  analysisBlocks?: ReferenceAnalysisBlock[];
}) {
  const analysisContent = buildAnalysisBlocksContent(input.analysisBlocks);
  const sourceContent = analysisContent || input.content;
  if (input.analysisBlocks?.length) {
    const analyzedFromDossiers = await consolidateUniverseObservations({
      title: input.title,
      observations: buildAnalysisObservationBlocks(input.analysisBlocks),
      currentProfile: input.currentProfile,
    });
    if (analyzedFromDossiers) return analyzedFromDossiers;
  }

  const blocks = analysisContent
    ? buildAnalysisTextBlocks(input.analysisBlocks)
    : splitImportedWorkIntoBlocks(sourceContent);

  if (!shouldAnalyzeReferenceByBlocks(sourceContent, blocks)) {
    return analyzeUniverseIntegralFromReference({
      ...input,
      content: sourceContent,
    });
  }

  const sourceBlocks = blocks.length
    ? blocks
    : splitTextIntoWordChunks(sourceContent, UNIVERSE_CHUNK_WORDS).map(
        (chunk, index) => ({
          index: index + 1,
          title: chunk.label,
          content: chunk.content,
          wordCount: countWords(chunk.content),
        })
      );

  const observations = (
    await mapWithConcurrency(
      sourceBlocks,
      CHAPTERED_SUMMARY_CONCURRENCY,
      async block =>
        extractUniverseObservationsFromChunk({
          title: input.title,
          chunkLabel: `Bloco ${block.index} de ${sourceBlocks.length}: ${block.title}`,
          chunkContent: block.content,
        })
    )
  ).filter(Boolean);

  if (!observations.length) return null;
  return consolidateUniverseObservations({
    title: input.title,
    observations,
    currentProfile: input.currentProfile,
  });
}

async function extractCharactersFromReference(input: {
  title: string;
  content: string;
  sourceContent?: string;
  summary: string;
  summarySections: ReferenceSummarySection[];
  analysisBlocks?: ReferenceAnalysisBlock[];
  targetCharacterNames?: string[];
}) {
  const originalContent = input.sourceContent?.trim() || input.content;
  const summaryFallback = fallbackCharactersFromSummary({
    ...input,
    content: originalContent,
  });
  const dossierFallback = input.analysisBlocks?.length
    ? fallbackCharactersFromDossiers({
        title: input.title,
        content: originalContent,
        analysisBlocks: input.analysisBlocks,
        targetCharacterNames: input.targetCharacterNames,
      })
    : [];
  const fallbackCharacters = mergeImportedCharacters(
    dossierFallback,
    summaryFallback
  );
  const analysisContent = buildAnalysisBlocksContent(input.analysisBlocks);
  const sourceContent = analysisContent || input.content;
  if (input.analysisBlocks?.length) {
    const groupedByCharacter = await consolidateCharactersByDossierGroups({
      title: input.title,
      analysisBlocks: input.analysisBlocks,
      sourceContent: originalContent,
      targetCharacterNames: input.targetCharacterNames,
    });
    return groupedByCharacter;
  }

  const blocks = analysisContent
    ? buildAnalysisTextBlocks(input.analysisBlocks)
    : splitImportedWorkIntoBlocks(sourceContent);
  if (shouldAnalyzeReferenceByBlocks(sourceContent, blocks)) {
    const sourceBlocks = blocks.length
      ? blocks
      : splitTextIntoWordChunks(sourceContent, CHARACTER_CHUNK_WORDS).map(
          (chunk, index) => ({
            index: index + 1,
            title: chunk.label,
            content: chunk.content,
            wordCount: countWords(chunk.content),
          })
        );

    const observations = (
      await mapWithConcurrency(
        sourceBlocks,
        CHAPTERED_SUMMARY_CONCURRENCY,
        async block =>
          extractCharacterObservationsFromChunk({
            title: input.title,
            chunkLabel: `Bloco ${block.index} de ${sourceBlocks.length}: ${block.title}`,
            chunkContent: block.content,
          })
      )
    ).filter(Boolean);

    if (!observations.length) return fallbackCharacters;
    const consolidated = await consolidateCharacterObservations({
      title: input.title,
      summary: input.summary,
      summarySections: input.summarySections,
      observations,
      sourceContent: originalContent,
    });
    return mergeImportedCharacters(
      normalizeImportedCharactersForWriting(consolidated),
      fallbackCharacters
    );
  }

  const source = buildCharacterExtractionSource({
    ...input,
    content: sourceContent,
  });
  if (!source) return fallbackCharacters;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Você é um analista literário especializado em resumos biográficos de personagens para continuidade de obra.
Você receberá o texto integral da obra em uma única passagem. Leia tudo primeiro. Depois compacte a leitura completa em RESUMOS DE PERSONAGENS ricos, concretos e não-genéricos.

REGRAS CRITICAS:
- Retorne APENAS JSON puro. Sem markdown, sem explicacao, sem texto antes ou depois.
- Não invente nada. Extraia somente o que está no texto.
- Junte aliases e nomes alternativos do mesmo personagem (ex: primeiro nome e sobrenome sustentados pelo texto = mesma pessoa).
- Priorize protagonistas, antagonistas, aliados, figuras recorrentes e secundários que tenham impacto narrativo claro.
- Extraia todos os personagens narrativamente relevantes encontrados no texto fornecido.
- O texto original e a fonte de verdade. O resumo/mapa serve apenas para orientao.
- A profundidade do resumo precisa ser proporcional ao peso narrativo: protagonistas/antagonistas centrais devem ter resumo muito maior; secundários recorrentes devem ser médios; personagem citado ou funcional deve ter resumo curto ou ser omitido. Não iguale todo mundo.
- Antes de preencher qualquer campo, pergunte: "qual passagem sustenta isto?". Se não houver resposta, omita.
- Não transforme hipótese, medo, boato ou crença de personagem em fato canônico.
- Não invente causa ou método de morte. "aparece morto" não autoriza "morto a tiros", "assassinado", "executado" ou "envenenado" sem passagem explícita.
- Use o nome canônico mais completo sustentado pelo texto. Não crie ficha por sobrenome isolado quando o nome completo existe.
- Não transforme história em etiqueta psicolgica. Preserve acontecimentos, escolhas, perdas, traições, mudanças de lado, relações de poder e estado final.
- Evite frases-clich como "personagem complexo", "determinado", "enfrenta desafios", "passa por uma jornada", "busca seu lugar". Se uma frase servir para qualquer personagem, ela e ruim.
- Não repita o mesmo parágrafo em campos diferentes. Cada campo deve acrescentar informa??o nova.

QUALIDADE DOS RESUMOS — isto é crucial:
- O campo "history" precisa ajudar diretamente o módulo Rascunho e a IA de Escrita. O autor deve conseguir escolher o personagem e saber como colocá-lo em cena sem reler a obra.
- "history" deve ser um resumo biográfico narrativo, em prosa e em ordem: origem/estado inicial, eventos vividos, decisões, revelações, perdas, relações que mudam, consequências e estado final conhecido.
- Não há limite artificial de palavras para protagonista/antagonista central/aliados centrais; preserve o arco inteiro sem transformar em lista. Secundários recorrentes ficam menores e personagens funcionais ficam curtos.
- Se o personagem atravessa muitos capítulos, "history" precisa acompanhar sua linha de vida inteira em ordem, com consequências, não virar uma frase curta.
- Nunca escreva "Presença verificada", "Resumo factual", "Personagens em cena", "Eventos e ações em ordem", "Referenciados" ou marcadores de bloco dentro de "history".
- "personality" deve capturar nuances observáveis em cena: contradições internas, como reage sob pressão, como se relaciona com poder, medo, culpa, afeto, obedincia ou ambio. Não use adjetivos soltos.
- "speechStyle" deve descrever voz e comportamento em diálogo: formalidade, cadência, vocabulário, frases curtas/longas, ironia, silêncio, agressividade, hesita??o, modo de esconder informa??o. Se for inferência, diga que e inferência.
- "backstory" deve incluir o passado ANTES dos eventos da narrativa, se mencionado.
- "relationships" deve listar relações concretas com outros personagens por nome e explicar a dinâmica: aliança, rivalidade, proteção, dependncia, medo, traição, dvida ou hierarquia.
- "motivations" deve indicar desejo visível, medo escondido, objetivo declarado, objetivo real e como isso muda ao longo da narrativa.
- "psychologicalProfile" deve explicar feridas internas, gatilhos emocionais, padrões de decisão, limite moral e autoengano.
- "notes" deve começar com "Uso em Rascunho:" e trazer função em cena, conflitos que ele puxa, pares que geram atrito, detalhes que a IA não pode contradizer e alertas contra escrita genérica.
- Se o texto não tiver informação suficiente para um campo, OMITA o campo. Não preencha com frases vagas.

FORMATO DO JSON:
{"characters":[{"name":"Nome Completo","role":"Protagonista|Antagonista|Secundário|Aliado|Mentor","history":"resumo biográfico narrativo completo do personagem, em ordem...","personality":"comportamento em cena e contradições...","physicalDescription":"aparência se mencionada...","speechStyle":"voz, fala, ritmo e postura em diálogo...","psychologicalProfile":"feridas, gatilhos e padrões de decisão...","backstory":"passado anterior à narrativa...","motivations":"o que move o personagem e como muda...","relationships":"relações com outros personagens por nome...","notes":"alertas de continuidade para Escrita..."}]}

Campos obrigatórios: name, role e history. Os demais são opcionais mas PREENCHA sempre que houver material.`,
        },
        {
          role: "user",
          content: `Obra de referência: "${input.title}"\nTexto integral com ${countWords(input.content).toLocaleString("pt-BR")} palavras.\n\nMaterial-base para extrao de personagens:\n\n${source}`,
        },
      ],
      maxTokens: 16384,
      temperature: FACTUAL_EXTRACTION_TEMPERATURE,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0].message.content;
    const parsed =
      typeof raw === "string" ? parseImportedCharactersFromJson(raw) : [];
    return mergeImportedCharacters(
      normalizeImportedCharactersForWriting(
        groundImportedCharacters(
          normalizeImportedCharactersForWriting(parsed),
          sourceContent
        )
      ),
      fallbackCharacters
    );
  } catch (error) {
    console.warn(
      "[Profile] Failed to extract characters from imported reference:",
      error
    );
    return fallbackCharacters;
  }
}

async function analyzeStyleSample(input: {
  title: string;
  content: string;
  notes: string;
}) {
  const words = input.content.split(/\s+/).filter(Boolean);
  const sample = words.slice(0, 18000).join(" ");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um editor literário especializado em absorver ESSÊNCIA DE ESCRITA a partir de um capítulo de referência.
Sua tarefa NÃO é resumir o enredo. Sua tarefa é extrair uma ficha técnica de estilo para que outra IA escreva capítulos novos com a mesma disciplina de voz, sem copiar conteúdo.

REGRAS:
- Retorne APENAS JSON puro.
- Não copie frases longas do texto de referência.
- Não descreva personagens, eventos ou premissa, exceto quando forem necessórios para explicar uma técnica de escrita.
- Escreva tudo em português.
- Seja específico e operacional: cada campo precisa dizer COMO escrever, não apenas qual adjetivo o estilo parece ter.
- Proibido usar frases vagas como "estilo envolvente", "linguagem rica", "tom profundo", "narrativa fluida" sem explicar a técnica.
- A ficha deve servir diretamente para a aba Escrita gerar um capítulo menos genérico.

Campos:
- essence: parágrafo curto com a lógica central da voz.
- pointOfView: pessoa narrativa, foco, distância do narrador e como a percepção entra na cena.
- narrativeDistance: proximidade emocional, quanto o texto explica ou deixa inferido.
- sentenceRhythm: tamanho de frases, cortes, pausas, repetições, alternância entre frase seca e frase longa.
- paragraphRhythm: tamanho dos parágrafos, quebras, respira??o da cena, como alterna ação, imagem e pensamento.
- diction: vocabulário, formalidade, aspereza, lirismo, palavras concretas/abstratas, nível de oralidade.
- imagery: tipo de imagem/metáfora permitida, campos sensoriais recorrentes, como criar atmosfera sem decorar demais.
- sensoryDetail: que sentidos prioriza, como escolhe detalhes materiais, como evita descrição vazia.
- dialogue: subtexto, pontuação, fala direta/indireta, interrupções, silêncio, tensão entre o que se fala e o que se esconde.
- introspection: como entra em pensamento, culpa, memória, desejo, medo e contradição interna.
- pacing: velocidade, como acelera/desacelera, como passa de observação para evento.
- tension: como sustenta ameaça, desconforto, conflito, mistério ou expectativa.
- transitions: como muda de cena, tempo, foco emocional ou ação.
- emotionalLogic: como o texto mostra emoção sem explicar demais.
- doRules: lista de regras práticas que a Escrita deve seguir.
- avoidRules: lista de coisas que deixariam o texto genérico ou fora do estilo.
- writingChecklist: lista curta para checar antes de finalizar cada capítulo.

Formato:
{"essence":"","pointOfView":"","narrativeDistance":"","sentenceRhythm":"","paragraphRhythm":"","diction":"","imagery":"","sensoryDetail":"","dialogue":"","introspection":"","pacing":"","tension":"","transitions":"","emotionalLogic":"","doRules":[""],"avoidRules":[""],"writingChecklist":[""]}`,
      },
      {
        role: "user",
        content: [
          `Título da amostra: "${input.title}"`,
          input.notes.trim()
            ? `Notas do autor sobre a amostra:\n${input.notes.trim()}`
            : "",
          `Capítulo/trecho de referência (${words.length.toLocaleString("pt-BR")} palavras; analisando at? 18.000):\n\n${sample}`,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n"),
      },
    ],
    maxTokens: 8192,
    timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
  });

  const raw = response.choices[0].message.content;
  return typeof raw === "string" ? parseStyleAnalysisFromJson(raw) : null;
}

async function extractLibraryEntriesFromUniverse(input: {
  title: string;
  content: string;
  summarySections: Array<{ id: string; label: string; content: string }>;
  summary: string;
}) {
  const original = input.content.trim();
  const sourceExcerpt =
    original.length > 12000
      ? [
          sliceAtWordBoundary(original, 7000),
          original.slice(Math.max(0, original.length - 5000)),
        ].join("\n\n---\n\n")
      : original;
  const source = sourceExcerpt;

  if (countWords(source) < 50) return [];

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Você é um analista literário. A partir do material da obra, extraia entradas para um arquivo canônico pesquisavel e útil para escrita.
Retorne APENAS JSON puro: {"entries":[...]}
Cada entrada tem: "type" (um de: "event", "location", "aura", "society"), "name" (nome curto), "description" (2-3 frases específicas), "details" (detalhes expandidos, 4-8 frases).

Tipos:
- event: acontecimentos históricos ou narrativos relevantes. Inclua ano/período no nome apenas quando o material trouxer isso, no formato "[ANO] Evento específico da obra". Não use exemplos externos. Detalhe causa, consequência, personagens/grupos afetados e impacto de continuidade.
- location: cidades, países, bases, edifícios, dimensões ou ambientes importantes. Detalhe atmosfera, função dramática, perigos, regras sociais e personagens associados.
- aura: regras de poder, magia, tecnologia, fenômenos sobrenaturais, habilidades especiais e suas restrições. Detalhe custo, limite, exceções, usuários, riscos e contradições que a IA não pode cometer.
- society: facções, governos, exércitos, famílias, ordens, igrejas, empresas e organizações. Detalhe ideologia, hierarquia, recursos, inimigos, aliados, métodos e consequências narrativas.

NÃO inclua personagens (já são tratados separadamente).
NÃO invente — extraia APENAS o que está explícito ou fortemente implícito no texto.
Não use definições de dicionário nem frases que serviriam para qualquer obra. Cada item precisa carregar nomes, eventos, regras ou efeitos específicos.
Extraia entre 8 e 60 entradas quando houver material, priorizando as mais relevantes para continuidade narrativa.
Se não houver entradas de um tipo, omita o tipo.`,
        },
        {
          role: "user",
          content: `Obra: "${input.title}"\n\nMaterial:\n\n${source}`,
        },
      ],
      maxTokens: 8192,
    });

    const raw = response.choices[0].message.content;
    if (typeof raw !== "string") return [];

    const cleaned = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const startIndex = cleaned.indexOf("{");
    const endIndex = cleaned.lastIndexOf("}");
    if (startIndex < 0 || endIndex < 0) return [];

    const parsed = JSON.parse(cleaned.slice(startIndex, endIndex + 1));
    const entries: Array<{
      type: "event" | "location" | "aura" | "society";
      name: string;
      description: string;
      details: string;
    }> = [];

    for (const entry of parsed.entries || []) {
      if (!entry.name || !entry.type) continue;
      if (!["event", "location", "aura", "society"].includes(entry.type))
        continue;
      entries.push({
        type: entry.type,
        name: String(entry.name).trim(),
        description: String(entry.description || "").trim(),
        details: String(entry.details || "").trim(),
      });
    }
    return entries;
  } catch (error) {
    console.warn("[Profile] Failed to extract library entries:", error);
    return [];
  }
}

function collectAnalysisBlockAnchors(blocks: ReferenceAnalysisBlock[]) {
  const seen = new Set<string>();
  const anchors: string[] = [];
  for (const block of blocks.sort((a, b) => a.index - b.index)) {
    for (const anchor of block.sourceAnchors || []) {
      const key = anchor.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push(anchor);
      if (anchors.length >= 240) return anchors;
    }
  }
  return anchors;
}

function buildChapteredReferenceSummary(input: {
  title: string;
  wordCount: number;
  analysisBlocks: ReferenceAnalysisBlock[];
}) {
  const anchors = collectAnalysisBlockAnchors(input.analysisBlocks);
  const blockLines = input.analysisBlocks
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(block =>
      `Bloco ${block.index}: ${block.title} (${block.wordCount.toLocaleString("pt-BR")} palavras originais)`
    );

  return [
    `Leitura por capítulos salva para "${input.title}".`,
    `${input.wordCount.toLocaleString("pt-BR")} palavras originais foram preservadas em ${input.analysisBlocks.length.toLocaleString("pt-BR")} dossiês factuais.`,
    "Este campo é apenas um índice técnico. A fonte de contexto para personagens, universo, timeline, análise e escrita são os dossiês por capítulo armazenados nesta referência.",
    anchors.length
      ? `Âncoras literais encontradas no texto original: ${formatSourceAnchors(anchors)}`
      : "",
    "Dossiês salvos:",
    blockLines.join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function summarizeReferenceByChapter(input: {
  title: string;
  content: string;
}) {
  const blocks = splitImportedWorkIntoBlocks(input.content);
  if (!blocks.length) {
    throw new UserVisibleError(
      "Não encontrei texto suficiente para leitura por capítulos."
    );
  }

  logger.info("Chaptered reference summary started", {
    title: input.title,
    blocks: blocks.length,
    concurrency: CHAPTERED_SUMMARY_CONCURRENCY,
  });
  const startedAt = Date.now();

  const analysisBlocks = (
    await mapWithConcurrency(
      blocks,
      CHAPTERED_SUMMARY_CONCURRENCY,
      async block => {
        const blockStartedAt = Date.now();
        const sourceAnchors = extractSourceAnchors(block.content);
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `Você está lendo uma obra literária capítulo por capítulo para criar uma MEMÓRIA FACTUAL DE CAPÍTULO.
Leia o bloco inteiro antes de resumir.
Este bloco pode ser um capítulo completo ou uma parte de capítulo maior.
Não faça crítica editorial. Não reescreva a obra. Não invente. Não pule detalhes narrativos importantes.

REGRA DE FONTE:
- Use somente o texto deste bloco.
- Não crie nomes, sobrenomes, empresas, lugares, datas, parentescos, facções ou motivações que não apareçam literalmente ou não sejam sustentados pelo bloco.
- Se um sobrenome/pai/organização não aparece no bloco, não complete.
- Não transfira parentesco entre personagens que aparecem próximos. "A conhece a mãe de B" não significa que A é pai de B; "A é filho de informante" não torna outro personagem filho de A.
- A lista de âncoras do usuário é apoio extraído automaticamente do texto; qualquer nome próprio importante precisa aparecer no bloco ou nessas âncoras.
- Se uma informação estiver incerta, escreva "não confirmado neste bloco" em vez de completar.

Preserve:
- eventos em ordem de acontecimento e ordem de revelação;
- personagens presentes, ações, medo, culpa, bloqueios, paralisia, desejo e mudança de estado;
- relações, ameaças, segredos, pistas, revelações, objetos, lugares, regras e consequências;
- diálogos ou frases importantes quando mudam a cena;
- qualquer fato que a IA não poderá contradizer depois.

Se a cena mostra que uma personagem não reage por pavor, trauma ou submissão, registre isso como fato narrativo, não como ausência de conflito.
Escreva em português, denso e específico, mas com disciplina editorial.
Limite rígido: no máximo ${CHAPTER_DOSSIER_MAX_WORDS} palavras por bloco; ideal ${CHAPTER_DOSSIER_TARGET_WORDS} palavras.
Não resuma parágrafo por parágrafo. Selecione só fatos, relações, pistas, viradas, consequências e estado final que seriam perigosos perder.

Formato obrigatório, sem markdown decorativo:
MEMÓRIA FACTUAL DO BLOCO
Personagens em cena:
Eventos e ações em ordem:
Relações e tensões:
Revelações, pistas e segredos:
Lugares, objetos, regras e instituições:
Estado emocional e psicológico:
Falas ou gestos que mudam a cena:
Estado final do bloco:
Alertas de continuidade:

Retorne apenas o dossiê deste bloco.`,
            },
            {
              role: "user",
              content: [
                `Obra: "${input.title}"`,
                `Bloco ${block.index} de ${blocks.length}: ${block.title}`,
                `${block.wordCount.toLocaleString("pt-BR")} palavras`,
                sourceAnchors.length
                  ? `Âncoras literais extraídas deste bloco: ${formatSourceAnchors(sourceAnchors)}`
                  : "",
                `Texto original do bloco:\n\n${block.content}`,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
          maxTokens: 3200,
          temperature: FACTUAL_EXTRACTION_TEMPERATURE,
          timeoutMs: LONG_ANALYSIS_TIMEOUT_MS,
        });

        const raw = response.choices[0].message.content;
        const summary =
          typeof raw === "string"
            ? limitWords(
                sanitizeReferenceSummary(raw.trim()),
                CHAPTER_DOSSIER_MAX_WORDS
              )
            : "";
        if (summary) {
          logger.debug("Chaptered reference block summarized", {
            title: input.title,
            block: block.index,
            blocks: blocks.length,
            ms: Date.now() - blockStartedAt,
            chars: summary.length,
          });
          return {
            index: block.index,
            title: block.title,
            wordCount: block.wordCount,
            dossier: summary,
            sourceAnchors,
            part: block.part,
            totalParts: block.totalParts,
          };
        }
        return null;
      }
    )
  ).filter(Boolean) as ReferenceAnalysisBlock[];

  if (!analysisBlocks.length) {
    throw new UserVisibleError(
      "A leitura por capítulos não retornou resumos válidos. Tente novamente."
    );
  }

  const finalSummary = buildChapteredReferenceSummary({
    title: input.title,
    wordCount: countWords(input.content),
    analysisBlocks,
  });

  logger.info("Chaptered reference summary finished", {
    title: input.title,
    blocks: blocks.length,
    ms: Date.now() - startedAt,
    summaryChars: finalSummary.length,
  });

  return {
    summary: finalSummary,
    blocks,
    analysisBlocks,
  };
}

export const profileRouter = router({
  get: protectedProcedure
    .input(z.object({ workId: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const targetWorkId = input?.workId ?? ctx.activeWorkId;
      if (!targetWorkId) return null;
      await ensureReadableWork(ctx.user!.id, targetWorkId);
      return getOrCreateAuthorProfile(ctx.user!.id, targetWorkId);
    }),

  /** Quick scan: reads the first ~2000 words of an uploaded document to extract subtitle, genre, and a short description. No credits charged — uses a small, fast prompt. */
  quickScan: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        textSample: z.string().min(10),
      })
    )
    .mutation(async ({ input }) => {
      const words = input.textSample.split(/\s+/).filter(Boolean);
      const sample = words.slice(0, 3000).join(" ");
      logger.debug("Quick scan started", {
        title: input.title,
        words: words.length,
      });

      if (words.length < 10) {
        throw new UserVisibleError(
          `Texto extraído muito curto (${words.length} palavras). O documento pode estar vazio ou protegido.`
        );
      }

      const prompt = `Você é um classificador literário. Leia o trecho e identifique o gênero pelo TOM NARRATIVO (como a história é contada), não pelo cenário ou título.

COMO CLASSIFICAR:
- Foque no tom: tenso e ameaçador = Suspense. Mistérios e segredos = Mistério. Emoções e relações = Drama. Medo e horror = Terror.
- Não invente elementos que não estão no texto. Se o texto não menciona magia, não é Fantasia. Se não menciona tecnologia futurista, não é Ficção Científica.
- Nomes próprios (de pessoas, projetos, operações) NÃO são evidência de gênero. "Aura", "Projeto X", "Operação Tempestade" são apenas nomes.
- Experimentos governamentais secretos em contexto histórico real = Suspense ou Thriller, NÃO ficção científica.
- Na dúvida entre gênero fantástico e realista, escolha o realista.
- Combine no máximo 2 gêneros se necessório (ex: "Suspense histórico", "Drama psicolgico").

Título: "${input.title}"

Trecho:
---
${sample}
---

REGRA DE SUBTITULO:
- Procure um subtítulo no título informado (parte após " - ", " : ", " — ") OU no corpo do texto (segunda linha de título, epígrafe).
- Se o título for "X - Y" ou "X: Y", o subtítulo e "Y" e o títítulo principal ? "X".
- Se não houver subtítulo identificável, retorne string vazia.

JSON puro, sem crases:
{"subtitle": "subtítulo encontrado ou vazio", "genre": "gênero pelo tom narrativo", "description": "1-2 frases sobre premissa e tom"}`;

      const response = await invokeLLM({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 1536,
      });

      const raw = response.choices[0].message.content;
      logger.debug("Quick scan LLM response received", {
        title: input.title,
        responseChars: typeof raw === "string" ? raw.length : 0,
      });

      if (typeof raw !== "string" || !raw.trim()) {
        throw new UserVisibleError(
          "A IA retornou resposta vazia. Verifique a configuração do Gemini."
        );
      }

      const result = parseQuickScanResponse(raw);
      logger.debug("Quick scan parsed", {
        title: input.title,
        hasSubtitle: Boolean(result.subtitle),
        hasGenre: Boolean(result.genre),
        hasDescription: Boolean(result.description),
      });

      if (!result.genre && !result.subtitle && !result.description) {
        throw new UserVisibleError(
          `A leitura rápida não encontrou campos úteis. Resposta: ${stripJsonCodeFence(raw).slice(0, 200)}`
        );
      }

      return result;
    }),

  update: protectedProcedure
    .input(
      z.object({
        workId: z.number().optional(),
        narrativeStyle: z.string().optional(),
        negativeRules: z
          .union([z.array(z.string()), universeProfilePayloadSchema])
          .optional(),
        keyChapters: z.array(keyChapterInput).optional(),
        storyFoundation: z.string().optional(),
        continuityMemories: z.array(continuityMemoryInput).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const targetWorkId = input.workId ?? ctx.activeWorkId;
      await ensureWritableWork(ctx.user!.id, targetWorkId);
      const updateData: Record<string, unknown> = {};
      if (input.narrativeStyle !== undefined)
        updateData.narrativeStyle = input.narrativeStyle;
      if (input.negativeRules !== undefined)
        updateData.negativeRules = JSON.stringify(input.negativeRules);
      if (input.keyChapters !== undefined)
        updateData.keyChapters = JSON.stringify(input.keyChapters);
      if (input.storyFoundation !== undefined)
        updateData.storyFoundation = input.storyFoundation;
      if (input.continuityMemories !== undefined)
        updateData.continuityMemories = JSON.stringify(
          input.continuityMemories
        );

      await updateAuthorProfile(ctx.user!.id, updateData, targetWorkId);
      await createNotification(ctx.user!.id, {
        type: "profile_updated",
        title: "Perfil atualizado",
        message: "As regras e memórias da obra foram salvas.",
        data: targetWorkId ? JSON.stringify({ workId: targetWorkId }) : null,
        isRead: "false",
      });

      return { success: true, message: "Profile updated successfully" };
    }),

  analyzeStyle: protectedProcedure
    .input(
      z.object({
        workId: z.number().optional(),
        title: z.string().min(1),
        content: z.string().min(100),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const targetWorkId = input.workId ?? ctx.activeWorkId;
      if (targetWorkId) await ensureReadableWork(ctx.user!.id, targetWorkId);

      const analysis = await analyzeStyleSample({
        title: input.title,
        content: input.content,
        notes: input.notes ?? "",
      });

      if (!analysis) {
        throw new UserVisibleError(
          "A IA não conseguiu absorver a essência desta amostra de estilo."
        );
      }

      return { success: true, data: analysis };
    }),

  analyzeUniverse: protectedProcedure
    .input(
      z.object({
        workId: z.number().optional(),
        title: z.string().min(1),
        content: z.string().min(1),
        analysisBlocks: z.array(referenceAnalysisBlockInput).optional(),
        currentUniverse: universeProfilePayloadSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const targetWorkId = input.workId ?? ctx.activeWorkId;
      await ensureWritableWork(ctx.user!.id, targetWorkId);
      const storedProfile = input.currentUniverse?.data
        ? input.currentUniverse.data
        : parseUniverseProfileJson(
            (await getOrCreateAuthorProfile(ctx.user!.id, targetWorkId))
              .negativeRules
          );
      const currentProfile = {
        ...emptyUniverseProfile(),
        notes: storedProfile.notes,
      };
      const analyzed = await analyzeUniverseFromReference({
        title: input.title,
        content: input.content,
        analysisBlocks: input.analysisBlocks,
        currentProfile,
      });

      if (!analyzed) {
        throw new UserVisibleError(
          "Falha ao analisar o universo da obra. Tente novamente."
        );
      }

      const merged = mergeUniverseProfiles(currentProfile, analyzed);
      await updateAuthorProfile(
        ctx.user!.id,
        {
          negativeRules: serializeUniverseProfile(merged),
        },
        targetWorkId
      );

      await createNotification(ctx.user!.id, {
        type: "profile_updated",
        title: "Universo atualizado",
        message: `Os dossiês de "${input.title}" atualizaram a aba Universo.`,
        data: targetWorkId ? JSON.stringify({ workId: targetWorkId }) : null,
        isRead: "false",
      });

      return { success: true, data: merged };
    }),

  summarizeReference: protectedProcedure
    .input(
      z.object({
        workId: z.number().optional(),
        referenceId: z.string().min(1).optional(),
        title: z.string().min(1),
        content: z.string().min(1),
        mode: z.enum(["chunks", "integral", "chaptered"]).default("chaptered"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const targetWorkId = input.workId ?? ctx.activeWorkId;
      await ensureWritableWork(ctx.user!.id, targetWorkId);
      const wordCount = countWords(input.content);
      const chapteredBlocks = splitImportedWorkIntoBlocks(input.content);
      const totalProcessingUnits = Math.max(chapteredBlocks.length, 1);

      // Upload de obra sempre usa a esteira por capítulos/blocos. O custo é
      // previsível e proporcional aos dossiês factuais salvos, não a caminhos
      // antigos de resumo integral em partes.
      const COST = 8 + Math.max(0, totalProcessingUnits - 1) * 2;

      // C8: charge atomically up-front, before the (potentially long) LLM
      // work. Refund happens in the `finally` block below if anything fails.
      const chargeDescription = `Resumo por capítulos (${totalProcessingUnits} bloco${totalProcessingUnits > 1 ? "s" : ""})`;
      await chargeCredits(ctx.user!.id, COST, chargeDescription, {
        workId: targetWorkId,
        reference: "profile:summarize-reference",
      });
      let charged = true;

      try {
        let finalSummary = "";
        let analysisBlocks: ReferenceAnalysisBlock[] = [];

        const chaptered = await summarizeReferenceByChapter({
          title: input.title,
          content: input.content,
        });
        finalSummary = chaptered.summary;
        analysisBlocks = chaptered.analysisBlocks;

        finalSummary = sanitizeReferenceSummary(finalSummary);

        if (!finalSummary) {
          throw new UserVisibleError(
            "Falha ao gerar resumo final. Tente novamente."
          );
        }

        const summarySections = extractSummarySections(finalSummary);

        charged = false;
        return {
          success: true,
          summary: finalSummary,
          summarySections,
          analysisBlocks,
          wordCount,
          chunks: totalProcessingUnits,
          blocks: totalProcessingUnits,
          cost: COST,
        };
      } finally {
        if (charged) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { grantCredits } = await import("../db");
            await grantCredits(
              ctx.user!.id,
              COST,
              `Estorno: ${chargeDescription}`,
              {
                workId: targetWorkId,
                reference: "refund:profile:summarize-reference",
                type: "refund",
              }
            );
          } catch (refundErr) {
            // eslint-disable-next-line no-console
            console.error(
              "[profile] failed to refund summarize credits",
              refundErr
            );
          }
        }
      }
    }),

  syncImportedReference: protectedProcedure
    .input(
      z.object({
        workId: z.number().optional(),
        referenceId: z.string().min(1),
        title: z.string().min(1),
        content: z.string().min(1),
        summary: z.string().optional(),
        summarySections: z
          .array(referenceSummarySectionInput)
          .optional(),
        analysisBlocks: z.array(referenceAnalysisBlockInput).optional(),
        alreadySyncedCharacterIds: z.array(z.number()).optional(),
        forceReplaceImportedCharacters: z.boolean().optional(),
        syncScope: z
          .enum(["all", "characters", "timeline", "continuity"])
          .default("all"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const targetWorkId = input.workId ?? ctx.activeWorkId;
      await ensureWritableWork(ctx.user!.id, targetWorkId);
      const syncScope = input.syncScope ?? "all";
      const shouldUpdateCharacters =
        syncScope === "all" || syncScope === "characters";
      const shouldUpdateTimeline =
        syncScope === "all" || syncScope === "timeline";
      const shouldUpdateLibrary = syncScope === "all";
      const shouldUpdateContinuity =
        syncScope === "all" || syncScope === "continuity";
      const forceReplaceImportedCharacters =
        input.forceReplaceImportedCharacters ?? syncScope === "characters";
      const summary = input.summary ?? input.content.slice(0, 4000);
      const summarySections = input.summarySections?.length
        ? input.summarySections
        : extractSummarySections(summary);
      const analysisContent = buildAnalysisBlocksContent(input.analysisBlocks);
      const extractionContent = analysisContent || input.content;
      const continuitySnippet = shouldUpdateContinuity
        ? buildSourceContinuitySnippet(input.title, input.content) ||
          buildContinuitySnippet(input.title, summarySections, summary)
        : "";

      const timelinePromise = shouldUpdateTimeline
        ? extractTimelineEventsFromReference({
            title: input.title,
            content: extractionContent,
            summary,
            summarySections,
            analysisBlocks: input.analysisBlocks,
          })
        : Promise.resolve([]);

      const existingCharacters = shouldUpdateCharacters
        ? await getCharactersByUserId(ctx.user!.id, targetWorkId)
        : [];
      const existingImportedCharacterIdsForReference = existingCharacters
        .filter(character =>
          Boolean(
            character.notes?.includes(`[Importado de "${input.title}"]`)
          )
        )
        .map(character => character.id);
      const linkedImportedIdsForReference = new Set([
        ...(input.alreadySyncedCharacterIds || []),
        ...existingImportedCharacterIdsForReference,
      ]);
      const targetCharacterNames = existingCharacters
        .filter(character => linkedImportedIdsForReference.has(character.id))
        .map(character => character.name)
        .filter(Boolean);

      const charactersPromise = shouldUpdateCharacters
        ? extractCharactersFromReference({
            ...input,
            content: extractionContent,
            sourceContent: input.content,
            summary,
            summarySections,
            analysisBlocks: input.analysisBlocks,
            targetCharacterNames,
          })
        : Promise.resolve([]);
      const libraryEntriesPromise = shouldUpdateLibrary
        ? extractLibraryEntriesFromUniverse({
            title: input.title,
            content: extractionContent,
            summarySections,
            summary,
          }).catch(error => {
      console.warn(
        "[syncImportedReference] Library extraction failed (non-fatal):",
        error
      );
            return [];
          })
        : Promise.resolve([]);
      const existingLibraryEntriesPromise = shouldUpdateLibrary
        ? getUserLibraryEntries(ctx.user!.id, undefined, targetWorkId)
        : Promise.resolve([]);

      const [
        importedTimelineEvents,
        extractedCharacters,
        extractedLibraryEntries,
        existingLibraryEntries,
      ] = await Promise.all([
        timelinePromise,
        charactersPromise,
        libraryEntriesPromise,
        existingLibraryEntriesPromise,
      ]);

      if (
        shouldUpdateCharacters &&
        syncScope === "characters" &&
        extractedCharacters.length === 0
      ) {
        throw new UserVisibleError(
          "A extração não encontrou personagens nos dossiês deste material. Recrie os dossiês por capítulo e tente atualizar personagens novamente."
        );
      }

      let createdCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;
      const linkedImportedIds = new Set(input.alreadySyncedCharacterIds || []);
      const consumedCharacterIds = new Set<number>();
      const importedCharacterIds: number[] = [];
      const addImportedCharacterId = (id: number) => {
        if (!importedCharacterIds.includes(id)) importedCharacterIds.push(id);
      };

      for (const extracted of extractedCharacters) {
        const normalizedName = extracted.name.trim().toLowerCase();
        if (!normalizedName) continue;

        const existing = findExistingCharacterForExtraction({
          extracted,
          existingCharacters,
          linkedImportedIds,
          consumedIds: consumedCharacterIds,
          forceReplaceImported: forceReplaceImportedCharacters,
          sourceTitle: input.title,
        });

        if (existing) {
          consumedCharacterIds.add(existing.id);
          const updates = buildCharacterUpdatePayload({
            existing,
            extracted,
            sourceTitle: input.title,
            forceReplaceImported: forceReplaceImportedCharacters,
          });

          if (Object.keys(updates).length > 0) {
            await updateCharacter(
              existing.id,
              ctx.user!.id,
              updates,
              targetWorkId
            );
            updatedCount += 1;
          }
          addImportedCharacterId(existing.id);
          continue;
        }

        const created = await createCharacter(
          ctx.user!.id,
          {
            name: extracted.name.trim(),
            role: extracted.role || undefined,
            history: extracted.history.trim(),
            personality: extracted.personality || undefined,
            physicalDescription: extracted.physicalDescription || undefined,
            speechStyle: extracted.speechStyle || undefined,
            psychologicalProfile: extracted.psychologicalProfile || undefined,
            backstory: extracted.backstory || undefined,
            motivations: extracted.motivations || undefined,
            relationships: extracted.relationships || undefined,
            notes: importedCharacterNote(input.title, extracted.notes),
          },
          targetWorkId
        );
        await incrementLibraryCount(ctx.user!.id, "character", targetWorkId);
        addImportedCharacterId(created.id);
        createdCount += 1;
      }

      if (shouldUpdateCharacters && forceReplaceImportedCharacters) {
        const keptImportedIds = new Set(importedCharacterIds);
        const staleImportedCharacters = existingCharacters.filter(character => {
          const id = Number(character.id);
          if (keptImportedIds.has(id)) return false;
          const notes = character.notes as string | null | undefined;
          return (
            isImportedAutomaticField(notes) &&
            Boolean(notes?.includes(`[Importado de "${input.title}"]`))
          );
        });

        for (const character of staleImportedCharacters) {
          await deleteCharacter(character.id, ctx.user!.id, targetWorkId);
          deletedCount += 1;
        }
      }

      // Extract library entries (events, locations, powers, factions) from the reference
      let libraryCreatedCount = 0;
      if (shouldUpdateLibrary && extractedLibraryEntries.length > 0) {
        const existingNames = new Set(
          existingLibraryEntries.map(e => e.name.trim().toLowerCase())
        );

        for (const entry of extractedLibraryEntries) {
          if (existingNames.has(entry.name.trim().toLowerCase())) continue;
          await createLibraryEntry(
            ctx.user!.id,
            {
              type: entry.type,
              name: entry.name,
              description: entry.description || null,
              details: entry.details || null,
              status: "canonical",
              workId: targetWorkId,
            },
            targetWorkId
          );
          existingNames.add(entry.name.trim().toLowerCase());
          if (["event", "location"].includes(entry.type)) {
            await incrementLibraryCount(
              ctx.user!.id,
              entry.type as "event" | "location",
              targetWorkId
            );
          }
          libraryCreatedCount += 1;
        }
        if (libraryCreatedCount > 0) {
          logger.info("Imported reference created library entries", {
            title: input.title,
            count: libraryCreatedCount,
          });
        }
      }

      return {
        success: true,
        continuitySnippet,
        importedCharacterIds,
        importedTimelineEvents,
        charactersUpdated: shouldUpdateCharacters,
        timelineUpdated: shouldUpdateTimeline,
        createdCount,
        updatedCount,
        deletedCount,
        libraryCreatedCount,
      };
    }),
});

export const __profileTestUtils = {
  parseUniverseFromJson,
  parseStyleAnalysisFromJson,
  parseImportedCharactersFromJson,
  fallbackCharactersFromSummary,
  fallbackCharactersFromDossiers,
  buildDossierBackedCharacter,
  buildDossierBackedCharacters,
  buildCharacterHistoryFromFacts,
  cleanCharacterNarrativeFact,
  stripBiographyEvidenceSyntax,
  collectDossierCharacterCandidates,
  inferDossierCharacterRole,
  extractSelfDescriptorsForCharacter,
  characterFocusedEvidenceStatements,
  characterHasIdentityDescriptor,
  characterHasSubjectAction,
  mergeImportedCharacters,
  normalizeImportedCharactersForWriting,
  isNonCharacterImportedOutput,
  isUnusableImportedCharacterSummary,
  extractSummarySections,
  buildImportedTimelineEvents,
  splitTimelineCandidates,
  parseTimelineEventsFromJson,
  splitImportedWorkIntoBlocks,
  limitWords,
  groundImportedCharacters,
  buildCharacterUpdatePayload,
  findExistingCharacterForExtraction,
  limitUniverseFieldWords,
  parseQuickScanResponse,
};
