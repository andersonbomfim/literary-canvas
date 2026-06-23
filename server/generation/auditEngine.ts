import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import {
  buildEvidenceCorpus,
  excerptAppearsInCorpus,
  excerptsAreDistinct,
  extractSpecificTerms,
  hasConcreteEditVerb,
  hasEnoughExplanation,
  hasLocalEvidenceSequence,
  isGenericGuidance,
  normalizeEvidenceText,
} from "../_core/evidenceQuality";
import { escapePromptInjection, PROMPT_HARDENING_CLAUSE } from "../_core/promptSanitize";
import {
  aggregateCounts,
  NARRATIVE_AUDIT_CATEGORIES,
  NARRATIVE_AUDIT_CONFIDENCE,
  NARRATIVE_AUDIT_SEVERITIES,
  type NarrativeAuditCategory,
  type NarrativeAuditConfidence,
  type NarrativeAuditSeverity,
  type NarrativeConsistencyIssue,
} from "@shared/narrativeAudit";

export type AuditChapterInput = {
  /** Posição cronológica (1, 2, 3...). */
  index: number;
  /** Identificador interno do capítulo, usado pra reporting. */
  chapterId: number;
  /** Título visível ao usuário. */
  title: string;
  /** Texto integral do capítulo. */
  content: string;
};

export type AuditWorkMeta = {
  workId: number;
  title: string;
  genre?: string | null;
  description?: string | null;
};

export type AuditEngineResult = {
  issues: NarrativeConsistencyIssue[];
  strategy: "integral" | "pipeline";
  engineLabel: string;
  /** Soma das chamadas ao LLM feitas internamente (debug/observability). */
  internalLlmCalls: number;
  /** Total de palavras lidas (= wordCount do livro, mesmo no pipeline). */
  wordsRead: number;
};

/**
 * Códigos de erro que o worker mapeia 1-1 para erros amigáveis na UI.
 * Cada caminho de falha tem código próprio para que o worker decida
 * se libera reserva, registra empty report, etc.
 */
export type AuditErrorCode =
  | "audit_missing_book_text"
  | "audit_invalid_json"
  | "audit_empty_report"
  | "audit_provider_timeout"
  | "audit_provider_error"
  | "audit_unknown_error";

export class AuditEngineError extends Error {
  readonly code: AuditErrorCode;
  constructor(code: AuditErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "AuditEngineError";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Estimativa de tokens
// ─────────────────────────────────────────────────────────────────────────
// Heurística simples: 1 palavra ≈ 1.5 tokens (variável conforme tokenizer,
// mas suficiente pra decidir integral vs pipeline com margem de segurança).
// Reserva 25% do contexto pra system prompt + saída JSON.
const WORDS_TO_TOKENS = 1.5;
const CONTEXT_USABLE_RATIO = 0.75;

function approximateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * WORDS_TO_TOKENS);
}

function chaptersToBookText(chapters: AuditChapterInput[]): string {
  return chapters
    .map((chapter) => `## Capítulo ${chapter.index}: ${chapter.title}\n\n${chapter.content}`)
    .join("\n\n────────────────────────────\n\n");
}

function bookWordCount(chapters: AuditChapterInput[]): number {
  return chapters.reduce((total, chapter) => total + chapter.content.trim().split(/\s+/).filter(Boolean).length, 0);
}

export function decideAuditStrategy(chapters: AuditChapterInput[]): "integral" | "pipeline" {
  const bookText = chaptersToBookText(chapters);
  const estimatedTokens = approximateTokens(bookText);
  const contextBudget = Math.floor(ENV.auditModelContextTokens * CONTEXT_USABLE_RATIO);
  return estimatedTokens <= contextBudget ? "integral" : "pipeline";
}

// ─────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────

const OUTPUT_SCHEMA_DESCRIPTION = `
Cada item da lista deve ter EXATAMENTE este formato JSON:

{
  "id": "string curta única dentro do relatório",
  "severity": "critical" | "high" | "medium" | "low",
  "category": "chronology" | "character_motivation" | "character_knowledge" | "worldbuilding" | "magic_or_power_rule" | "politics" | "relationship" | "location" | "continuity" | "tone_or_pov" | "cause_and_effect" | "other",
  "title": "Frase curta (até 80 caracteres) descrevendo o conflito.",
  "problemSummary": "Resumo de 1 frase do conflito.",
  "primaryLocation": {
    "chapter": "Capítulo X: <título>",
    "scene": "descrição curta da cena onde a inconsistência aparece (opcional)",
    "approximatePosition": "início|meio|fim do capítulo (opcional)",
    "excerpt": "trecho LITERAL curto (até 280 caracteres) do livro onde o problema aparece"
  },
  "conflictingLocations": [
    {
      "chapter": "Capítulo Y: <título>",
      "scene": "descrição curta (opcional)",
      "approximatePosition": "início|meio|fim (opcional)",
      "excerpt": "trecho LITERAL curto do livro que conflita",
      "explanation": "Frase explicando exatamente o que conflita."
    }
  ],
  "whyItIsAProblem": "Explicação concreta amarrada nos trechos citados. NUNCA frase genérica.",
  "impactOnStory": "O que se perde/quebra se ficar do jeito que está.",
  "suggestedFix": "Correção específica que resolve o conflito preservando o resto do livro.",
  "alternativeFixes": ["opcional, 1-3 alternativas distintas"],
  "affectedElements": {
    "characters": ["nomes"],
    "factions": [],
    "locations": [],
    "timelineEvents": [],
    "powersOrRules": []
  },
  "confidence": "high" | "medium" | "low"
}
`.trim();

const SEVERITY_GUIDELINES = `
Gravidade — calibre rigorosamente:
- critical: quebra a lógica central da obra. Personagem morto reaparece sem explicação; regra central de magia contradita; revelação anula cena anterior importante; personagem não poderia saber uma informação essencial.
- high: motivação importante muda sem transição; aliança política contradiz acontecimentos; consequência grave ignorada; personagem age contra o próprio arco sem justificativa.
- medium: mudança de tom brusca; detalhe de localização confuso; relação entre personagens avança rápido demais; pequena contradição de informação.
- low: repetição, pequena imprecisão, continuidade visual menor, detalhe ajustável com uma frase.
`.trim();

const HARD_RULES = `
Regras obrigatórias:
1. CITE TRECHO LITERAL do livro em primaryLocation.excerpt e em cada conflictingLocations.excerpt. Sem trecho, não é issue válida.
2. Cada issue precisa conflitar com OUTRO trecho do livro. Sem conflito explícito, não reporte.
3. NÃO invente problemas. Se o livro não tem inconsistência, devolva lista vazia.
4. NÃO faça opinião editorial ("o personagem poderia ser mais desenvolvido"). Auditoria é factual, não estética.
5. NÃO sugira melhorias gerais. Foco é CONTRADIÇÃO entre partes da obra.
6. NÃO reporte "tom", "ritmo", "tensão" ou "exposição" como inconsistência se não houver contradição factual. Mudança de tom só é auditoria quando há problema concreto de POV, narrador, voz narrativa ou tempo verbal.
7. Para causa/efeito local, prove a sequência com trechos próximos. Não trate preparação anterior como erro só porque a tensão cresce depois.
8. Devolva APENAS JSON válido no formato {"issues": [...]} — nada antes, nada depois.
`.trim();

function buildIntegralSystemPrompt(workMeta: AuditWorkMeta): string {
  return [
    `Você é um auditor de continuidade narrativa. Sua tarefa é ler a obra "${workMeta.title}" INTEIRA e listar as inconsistências internas — contradições entre partes do mesmo livro.`,
    "",
    "O autor já sabe que a obra existe. Não resuma. Não opine. Só aponte conflitos concretos rastreáveis a dois trechos diferentes da própria obra.",
    "",
    SEVERITY_GUIDELINES,
    "",
    HARD_RULES,
    "",
    `Formato de saída:\n${OUTPUT_SCHEMA_DESCRIPTION}`,
    "",
    PROMPT_HARDENING_CLAUSE,
  ].join("\n");
}

function buildIntegralUserPrompt(workMeta: AuditWorkMeta, bookText: string): string {
  const meta = [
    `Obra: ${workMeta.title}`,
    workMeta.genre ? `Gênero: ${workMeta.genre}` : "",
    workMeta.description ? `Descrição: ${escapePromptInjection(workMeta.description, 1_000)}` : "",
  ].filter(Boolean).join("\n");

  return `${meta}

Conteúdo completo da obra (separado por capítulo):

${escapePromptInjection(bookText)}

Devolva apenas: {"issues": [...]}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline (4 etapas) — usado quando o livro não cabe no contexto
// ─────────────────────────────────────────────────────────────────────────

type ChapterExtraction = {
  chapterId: number;
  chapterIndex: number;
  chapterTitle: string;
  /** JSON bruto retornado pela etapa 1 — passado adiante pras etapas seguintes. */
  rawExtraction: string;
};

const EXTRACTION_SYSTEM = `Você é um indexador narrativo. Recebe UM capítulo da obra e extrai fatos estruturados.
NÃO opine. NÃO resuma a "essência" do capítulo. Extraia fatos rastreáveis com trechos literais.

Devolva APENAS JSON válido neste formato:
{
  "timelineEvents": [{"label": "evento", "when": "ano/dia/sem data", "excerpt": "trecho literal"}],
  "characterStates": [{"name": "X", "state": "estado emocional/físico no fim do capítulo", "excerpt": "trecho"}],
  "characterKnowledge": [{"name": "X", "knows": "fato que X agora sabe", "learnedHow": "como X aprendeu", "excerpt": "trecho"}],
  "relationships": [{"between": ["A", "B"], "state": "aliança/conflito/romance", "excerpt": "trecho"}],
  "locations": [{"name": "lugar", "fact": "fato sobre o lugar", "excerpt": "trecho"}],
  "politicalState": [{"faction": "F", "fact": "estado político atual", "excerpt": "trecho"}],
  "magicRulesUsed": [{"rule": "regra aplicada", "excerpt": "trecho"}],
  "promisesAndForeshadowing": [{"promise": "promessa narrativa", "excerpt": "trecho"}],
  "unresolvedConsequences": [{"event": "evento", "consequenceMissing": "consequência ainda não mostrada", "excerpt": "trecho"}],
  "importantClaims": [{"claim": "afirmação", "byCharacter": "X (opcional)", "excerpt": "trecho"}]
}`;

const CROSSCHECK_SYSTEM = `Você é um auditor de continuidade. Recebe extrações estruturadas de TODOS os capítulos de uma obra e procura conflitos ENTRE capítulos distintos.

Cruze:
- evento X (capítulo A) contra fala/conhecimento em capítulo B
- conhecimento do personagem em capítulo C contra cena onde personagem aprendeu (ou não)
- uso de poder em capítulo D contra regra estabelecida em capítulo E
- aliança em capítulo F contra conflito anterior em capítulo G
- motivação atual contra arco anterior

${HARD_RULES}

${SEVERITY_GUIDELINES}

Formato:
${OUTPUT_SCHEMA_DESCRIPTION}

Devolva APENAS {"issues": [...]}`;

// ─────────────────────────────────────────────────────────────────────────
// Provider-agnostic LLM caller
// ─────────────────────────────────────────────────────────────────────────
// Hoje delegamos pra `invokeLLM` (que fala com Gemini). Quando adicionarmos
// DeepSeek/OpenAI/Anthropic, switch baseado em ENV.auditProvider e troca o
// transport. Mantém a forma `{ messages, maxTokens }` igual.
async function callAuditLLM(args: { systemPrompt: string; userPrompt: string; maxTokens: number }): Promise<string> {
  // Hoje qualquer provider cai no invokeLLM (Gemini). No futuro, se
  // ENV.auditProvider === "deepseek" use deepseekClient, etc.
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
      maxTokens: args.maxTokens,
      model: ENV.auditModel || undefined,
      timeoutMs: ENV.auditTimeoutSeconds * 1000,
    });
    const raw = response.choices[0]?.message?.content;
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw)) {
      return raw.map((part) => (typeof part === "string" ? part : "text" in part && part.type === "text" ? part.text : "")).join("");
    }
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("aborterror")) {
      throw new AuditEngineError("audit_provider_timeout", message);
    }
    throw new AuditEngineError("audit_provider_error", message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Parsing seguro
// ─────────────────────────────────────────────────────────────────────────

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:json|text)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseIssuesJson(raw: string): NarrativeConsistencyIssue[] {
  if (!raw) return [];
  const cleaned = stripCodeFence(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const issuesRaw = (parsed as { issues?: unknown }).issues;
  if (!Array.isArray(issuesRaw)) return [];
  const issues: NarrativeConsistencyIssue[] = [];
  for (const candidate of issuesRaw) {
    const validated = validateIssue(candidate);
    if (validated) issues.push(validated);
  }
  return issues;
}

function validateIssue(value: unknown): NarrativeConsistencyIssue | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const severity = v.severity as string | undefined;
  const category = v.category as string | undefined;
  const confidence = v.confidence as string | undefined;
  if (!NARRATIVE_AUDIT_SEVERITIES.includes(severity as NarrativeAuditSeverity)) return null;
  if (!NARRATIVE_AUDIT_CATEGORIES.includes(category as NarrativeAuditCategory)) return null;
  if (!NARRATIVE_AUDIT_CONFIDENCE.includes(confidence as NarrativeAuditConfidence)) return null;

  const primaryLocation = v.primaryLocation as Record<string, unknown> | undefined;
  if (!primaryLocation || typeof primaryLocation !== "object") return null;
  const excerpt = typeof primaryLocation.excerpt === "string" ? primaryLocation.excerpt.trim() : "";
  if (!excerpt) return null; // hard rule: trecho literal obrigatório

  const conflictingRaw = Array.isArray(v.conflictingLocations) ? v.conflictingLocations : [];
  const conflictingLocations = conflictingRaw
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const cr = c as Record<string, unknown>;
      const cExcerpt = typeof cr.excerpt === "string" ? cr.excerpt.trim() : "";
      const cExplanation = typeof cr.explanation === "string" ? cr.explanation.trim() : "";
      if (!cExcerpt || !cExplanation) return null;
      return {
        chapter: typeof cr.chapter === "string" ? cr.chapter : undefined,
        scene: typeof cr.scene === "string" ? cr.scene : undefined,
        approximatePosition: typeof cr.approximatePosition === "string" ? cr.approximatePosition : undefined,
        excerpt: cExcerpt,
        explanation: cExplanation,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (!conflictingLocations.length) return null; // hard rule: pelo menos 1 conflito

  const affected = (v.affectedElements as Record<string, unknown> | undefined) ?? {};
  const stringArr = (key: string): string[] | undefined => {
    const raw = affected[key];
    if (!Array.isArray(raw)) return undefined;
    const filtered = raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    return filtered.length ? filtered : undefined;
  };

  return {
    id: typeof v.id === "string" && v.id.trim() ? v.id.trim().slice(0, 64) : `issue_${Math.random().toString(36).slice(2, 10)}`,
    severity: severity as NarrativeAuditSeverity,
    category: category as NarrativeAuditCategory,
    title: typeof v.title === "string" ? v.title.trim().slice(0, 200) : "Inconsistência",
    problemSummary: typeof v.problemSummary === "string" ? v.problemSummary.trim() : "",
    primaryLocation: {
      chapter: typeof primaryLocation.chapter === "string" ? primaryLocation.chapter : undefined,
      scene: typeof primaryLocation.scene === "string" ? primaryLocation.scene : undefined,
      approximatePosition: typeof primaryLocation.approximatePosition === "string" ? primaryLocation.approximatePosition : undefined,
      excerpt,
    },
    conflictingLocations,
    whyItIsAProblem: typeof v.whyItIsAProblem === "string" ? v.whyItIsAProblem.trim() : "",
    impactOnStory: typeof v.impactOnStory === "string" ? v.impactOnStory.trim() : "",
    suggestedFix: typeof v.suggestedFix === "string" ? v.suggestedFix.trim() : "",
    alternativeFixes: Array.isArray(v.alternativeFixes)
      ? v.alternativeFixes.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5)
      : undefined,
    affectedElements: {
      characters: stringArr("characters"),
      factions: stringArr("factions"),
      locations: stringArr("locations"),
      timelineEvents: stringArr("timelineEvents"),
      powersOrRules: stringArr("powersOrRules"),
    },
    confidence: confidence as NarrativeAuditConfidence,
  };
}

function auditIssueTerms(issue: NarrativeConsistencyIssue) {
  return extractSpecificTerms(
    issue.title,
    issue.problemSummary,
    issue.whyItIsAProblem,
    issue.impactOnStory,
    issue.suggestedFix,
    issue.primaryLocation.excerpt,
    issue.conflictingLocations.map((location) => `${location.excerpt} ${location.explanation}`),
    issue.affectedElements.characters,
    issue.affectedElements.factions,
    issue.affectedElements.locations,
    issue.affectedElements.timelineEvents,
    issue.affectedElements.powersOrRules,
  );
}

function isUnsupportedToneAudit(issue: NarrativeConsistencyIssue) {
  if (issue.category !== "tone_or_pov") return false;
  const text = normalizeEvidenceText([
    issue.title,
    issue.problemSummary,
    issue.whyItIsAProblem,
    issue.impactOnStory,
    issue.suggestedFix,
  ].join(" "));
  return !/\b(pov|ponto de vista|foco narrativo|narrador|narracao|primeira pessoa|terceira pessoa|tempo verbal|voz narrativa|distancia narrativa)\b/.test(text);
}

function hasEditorialSequenceClaim(issue: NarrativeConsistencyIssue) {
  const text = normalizeEvidenceText([
    issue.title,
    issue.problemSummary,
    issue.whyItIsAProblem,
    issue.impactOnStory,
    issue.suggestedFix,
  ].join(" "));
  return /\b(ritmo|tensao|tom|progressao|escalada|climax|exposicao|historico|documental|quebra|interrompe|retoma)\b/.test(text);
}

function filterAuditIssuesByEvidence(
  issues: NarrativeConsistencyIssue[],
  chapters: AuditChapterInput[],
): NarrativeConsistencyIssue[] {
  const corpus = buildEvidenceCorpus(chapters);
  return issues
    .map((issue) => {
      const primaryExcerpt = issue.primaryLocation.excerpt ?? "";
      if (!excerptAppearsInCorpus(primaryExcerpt, corpus)) return null;

      const conflictingLocations = issue.conflictingLocations.filter((location) => (
        excerptAppearsInCorpus(location.excerpt, corpus) &&
        excerptsAreDistinct(primaryExcerpt, location.excerpt) &&
        hasEnoughExplanation(location.explanation, 6)
      ));
      if (!conflictingLocations.length) return null;

      const terms = auditIssueTerms({ ...issue, conflictingLocations });
      const checkedIssue = { ...issue, conflictingLocations };
      if (isUnsupportedToneAudit(checkedIssue)) return null;
      if (
        hasEditorialSequenceClaim(checkedIssue) &&
        !hasLocalEvidenceSequence(
          [primaryExcerpt, ...conflictingLocations.map((location) => location.excerpt)],
          corpus,
          { minAnchors: 2, maxSpan: 14_000 },
        )
      ) return null;
      if (!hasEnoughExplanation(issue.whyItIsAProblem, 8)) return null;
      if (!hasEnoughExplanation(issue.impactOnStory, 6)) return null;
      if (!hasEnoughExplanation(issue.suggestedFix, 5)) return null;
      if (isGenericGuidance(issue.suggestedFix, terms) && !hasConcreteEditVerb(issue.suggestedFix)) return null;

      return { ...issue, conflictingLocations };
    })
    .filter((issue): issue is NarrativeConsistencyIssue => issue !== null);
}

// ─────────────────────────────────────────────────────────────────────────
// Estratégia 1: leitura integral
// ─────────────────────────────────────────────────────────────────────────
/**
 * Chama o LLM esperando JSON; se vier inválido, faz UMA tentativa de reparo
 * antes de jogar `audit_invalid_json`. O modelo recebe a saída anterior e
 * pede só pra devolver JSON limpo, sem reanalisar a obra inteira.
 */
async function callAuditWithJsonRepair(args: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  llmCallCounter: { value: number };
}): Promise<{ issues: NarrativeConsistencyIssue[]; raw: string }> {
  const raw = await callAuditLLM({
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    maxTokens: args.maxTokens,
  });
  args.llmCallCounter.value += 1;
  let issues = parseIssuesJson(raw);
  if (issues.length === 0 && raw.trim()) {
    // Pode ter sido só JSON malformado — pede reparo uma vez.
    const repairSystem = "Você é um corretor de JSON. Receba o texto abaixo e devolva APENAS um JSON válido no formato {\"issues\":[...]}. Não invente issues novas. Se nada for recuperável, devolva {\"issues\":[]}.";
    const repairUser = `Texto bruto (possivelmente JSON malformado):\n${raw}`;
    let repairRaw = "";
    try {
      repairRaw = await callAuditLLM({
        systemPrompt: repairSystem,
        userPrompt: repairUser,
        maxTokens: 8_000,
      });
      args.llmCallCounter.value += 1;
    } catch {
      // Se o reparo falhar (timeout/erro de provider), seguimos com o original.
    }
    if (repairRaw) {
      issues = parseIssuesJson(repairRaw);
    }
    // Se o texto original era pura prosa (sem nenhuma estrutura JSON detectável)
    // depois do reparo, é invalid_json. Lista vazia genuína (modelo achou que
    // não há inconsistências) cai numa heurística: a saída ORIGINAL precisa
    // pelo menos conter "issues" como token; senão classificamos como inválido.
    if (issues.length === 0 && !/"issues"\s*:/.test(raw) && !/"issues"\s*:/.test(repairRaw)) {
      throw new AuditEngineError("audit_invalid_json", "Modelo não devolveu JSON no formato esperado.");
    }
  }
  return { issues, raw };
}

async function runIntegralAudit(workMeta: AuditWorkMeta, chapters: AuditChapterInput[]): Promise<AuditEngineResult> {
  const bookText = chaptersToBookText(chapters);
  const systemPrompt = buildIntegralSystemPrompt(workMeta);
  const userPrompt = buildIntegralUserPrompt(workMeta, bookText);
  // Saída em JSON: pedimos teto generoso pra não cortar lista grande de issues.
  const calls = { value: 0 };
  const { issues } = await callAuditWithJsonRepair({
    systemPrompt,
    userPrompt,
    maxTokens: 16_000,
    llmCallCounter: calls,
  });
  const evidenceCheckedIssues = filterAuditIssuesByEvidence(issues, chapters);
  return {
    issues: evidenceCheckedIssues,
    strategy: "integral",
    engineLabel: `${ENV.auditProvider}:${ENV.auditModel || "default"}`,
    internalLlmCalls: calls.value,
    wordsRead: bookWordCount(chapters),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Estratégia 2: pipeline (extração → cruzamento)
// ─────────────────────────────────────────────────────────────────────────
async function extractChapter(workMeta: AuditWorkMeta, chapter: AuditChapterInput): Promise<ChapterExtraction> {
  const userPrompt = [
    `Obra: ${workMeta.title}`,
    `Capítulo ${chapter.index}: ${chapter.title}`,
    "",
    "Conteúdo:",
    escapePromptInjection(chapter.content),
    "",
    "Devolva apenas o JSON estruturado conforme instruído.",
  ].join("\n");
  const raw = await callAuditLLM({ systemPrompt: EXTRACTION_SYSTEM, userPrompt, maxTokens: 6_000 });
  return {
    chapterId: chapter.chapterId,
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    rawExtraction: stripCodeFence(raw),
  };
}

async function crossCheckExtractions(workMeta: AuditWorkMeta, extractions: ChapterExtraction[]): Promise<NarrativeConsistencyIssue[]> {
  const compactExtractions = extractions
    .map((extraction) => `### Capítulo ${extraction.chapterIndex}: ${extraction.chapterTitle}\n${extraction.rawExtraction}`)
    .join("\n\n────────\n\n");

  const userPrompt = [
    `Obra: ${workMeta.title}`,
    workMeta.genre ? `Gênero: ${workMeta.genre}` : "",
    "",
    "Extrações por capítulo (estruturadas):",
    escapePromptInjection(compactExtractions, 200_000),
    "",
    "Cruze tudo e devolva apenas {\"issues\": [...]}.",
  ].filter(Boolean).join("\n");

  const raw = await callAuditLLM({ systemPrompt: CROSSCHECK_SYSTEM, userPrompt, maxTokens: 16_000 });
  return parseIssuesJson(raw);
}

const CONSOLIDATE_SYSTEM = `Você está em um passo intermediário de consolidação de extrações estruturadas.
Receba abaixo extrações de vários capítulos e produza UM bloco consolidado que preserve TODOS os fatos rastreáveis:
- eventos com sua ordem cronológica
- estados/conhecimento de cada personagem ao longo destes capítulos
- relações, alianças, traições, mudanças de poder
- regras de mundo aplicadas
- consequências em aberto

Mantenha estilo estruturado (pode usar JSON ou texto denso por seções).
NÃO invente. NÃO compacte demais — este bloco será cruzado com outros depois.
Não use aberturas. Devolva apenas o conteúdo consolidado.`;

async function consolidateExtractionsLayer(
  workMeta: AuditWorkMeta,
  extractions: ChapterExtraction[],
  calls: { value: number },
): Promise<ChapterExtraction[]> {
  const GROUP_SIZE = 4;
  const consolidated: ChapterExtraction[] = [];
  for (let i = 0; i < extractions.length; i += GROUP_SIZE) {
    const group = extractions.slice(i, i + GROUP_SIZE);
    const blob = group
      .map((e) => `### Capítulo ${e.chapterIndex}: ${e.chapterTitle}\n${e.rawExtraction}`)
      .join("\n\n────────\n\n");
    const userPrompt = [
      `Obra: ${workMeta.title}`,
      workMeta.genre ? `Gênero: ${workMeta.genre}` : "",
      "",
      "Extrações deste grupo:",
      escapePromptInjection(blob, 200_000),
    ].filter(Boolean).join("\n");
    const raw = await callAuditLLM({
      systemPrompt: CONSOLIDATE_SYSTEM,
      userPrompt,
      maxTokens: 12_000,
    });
    calls.value += 1;
    consolidated.push({
      chapterId: group[0].chapterId,
      chapterIndex: group[0].chapterIndex,
      chapterTitle: `Consolidado caps ${group[0].chapterIndex}–${group[group.length - 1].chapterIndex}`,
      rawExtraction: stripCodeFence(raw),
    });
  }
  return consolidated;
}

async function crossCheckExtractionsWithRepair(
  workMeta: AuditWorkMeta,
  extractions: ChapterExtraction[],
  calls: { value: number },
): Promise<NarrativeConsistencyIssue[]> {
  // Pra obras grandes (>8 chunks), faz consolidação hierárquica antes do
  // cross-check final pra não estourar o contexto do modelo. Sem isso, 20+
  // extrações × 1-3k palavras cada = 60k+ tokens só de entrada.
  let layer = extractions;
  let level = 0;
  while (layer.length > 8 && level < 4) {
    layer = await consolidateExtractionsLayer(workMeta, layer, calls);
    level += 1;
  }

  const compactExtractions = layer
    .map((extraction) => `### ${extraction.chapterTitle}\n${extraction.rawExtraction}`)
    .join("\n\n────────\n\n");

  const userPrompt = [
    `Obra: ${workMeta.title}`,
    workMeta.genre ? `Gênero: ${workMeta.genre}` : "",
    level > 0 ? `Extrações foram consolidadas em ${level} nível(is) por causa do tamanho da obra.` : "",
    "",
    "Extrações por capítulo (estruturadas):",
    escapePromptInjection(compactExtractions, 200_000),
    "",
    "Cruze tudo e devolva apenas {\"issues\": [...]}.",
  ].filter(Boolean).join("\n");

  const { issues } = await callAuditWithJsonRepair({
    systemPrompt: CROSSCHECK_SYSTEM,
    userPrompt,
    maxTokens: 16_000,
    llmCallCounter: calls,
  });
  return issues;
}

async function runPipelineAudit(workMeta: AuditWorkMeta, chapters: AuditChapterInput[]): Promise<AuditEngineResult> {
  const calls = { value: 0 };

  // Etapa 1: extrair fatos estruturados por capítulo (em paralelo limitado).
  const PARALLEL = 4;
  const extractions: ChapterExtraction[] = [];
  for (let i = 0; i < chapters.length; i += PARALLEL) {
    const slice = chapters.slice(i, i + PARALLEL);
    const batch = await Promise.all(slice.map((chapter) => extractChapter(workMeta, chapter)));
    extractions.push(...batch);
  }
  calls.value += extractions.length;

  // Etapa 2 + 3 + 4: cruzar e gerar relatório num único call (a consolidação
  // global vive no contexto enviado, evita gasto extra de chamadas).
  const issues = filterAuditIssuesByEvidence(
    await crossCheckExtractionsWithRepair(workMeta, extractions, calls),
    chapters,
  );

  return {
    issues,
    strategy: "pipeline",
    engineLabel: `${ENV.auditProvider}:${ENV.auditModel || "default"}`,
    internalLlmCalls: calls.value,
    wordsRead: bookWordCount(chapters),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────

/**
 * Roda a Auditoria de Consistência sobre uma obra (lista de capítulos).
 *
 * O caller (worker) é responsável por:
 *   - reservar `wordCount` créditos de análise ANTES de chamar
 *   - chamar isso de dentro de try/catch e liberar reserva em falha
 *   - chamar confirmAnalysisCredits(wordCount) no sucesso
 *   - persistir o `AuditEngineResult.issues` em `auditReports`
 *
 * Estratégia (integral vs pipeline) é decidida internamente conforme
 * ENV.auditModelContextTokens.
 */
export async function runConsistencyAudit(args: {
  workMeta: AuditWorkMeta;
  chapters: AuditChapterInput[];
}): Promise<AuditEngineResult> {
  // Filtra capítulos vazios ANTES de decidir estratégia. Antes só checava
  // se a lista inteira estava vazia ou totalmente vazia; com 1 capítulo
  // de 100k palavras e 5 capítulos vazios, a estratégia ainda contava 6
  // entradas e o pipeline mandava prompts vazios para extração.
  const validChapters = args.chapters.filter((c) => c.content.trim().length > 0);
  if (!validChapters.length) {
    throw new AuditEngineError("audit_missing_book_text", "Obra sem texto suficiente pra auditoria.");
  }
  const strategy = decideAuditStrategy(validChapters);
  try {
    return strategy === "integral"
      ? await runIntegralAudit(args.workMeta, validChapters)
      : await runPipelineAudit(args.workMeta, validChapters);
  } catch (error) {
    if (error instanceof AuditEngineError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AuditEngineError("audit_unknown_error", message);
  }
}

export { aggregateCounts };
