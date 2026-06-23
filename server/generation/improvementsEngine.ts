import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import {
  buildEvidenceCorpus,
  excerptAppearsInCorpus,
  excerptPositionInCorpus,
  excerptsAreDistinct,
  extractSpecificTerms,
  hasConcreteEditVerb,
  hasEnoughExplanation,
  hasSpecificTerm,
  isGenericGuidance,
  normalizeEvidenceText,
} from "../_core/evidenceQuality";
import { escapePromptInjection, PROMPT_HARDENING_CLAUSE } from "../_core/promptSanitize";
import {
  aggregateImprovementCounts,
  NARRATIVE_IMPROVEMENT_CATEGORIES,
  NARRATIVE_IMPROVEMENT_CONFIDENCE,
  NARRATIVE_IMPROVEMENT_PRIORITIES,
  type NarrativeImprovementCategory,
  type NarrativeImprovementConfidence,
  type NarrativeImprovementPriority,
  type NarrativeImprovementSuggestion,
} from "@shared/narrativeImprovements";

export type ImprovementChapterInput = {
  /** Posição cronológica (1, 2, 3...). */
  index: number;
  /** Identificador interno do capítulo. */
  chapterId: number;
  title: string;
  content: string;
};

export type ImprovementWorkMeta = {
  workId: number;
  title: string;
  genre?: string | null;
  description?: string | null;
};

export type ImprovementEngineResult = {
  suggestions: NarrativeImprovementSuggestion[];
  strategy: "integral" | "pipeline";
  engineLabel: string;
  internalLlmCalls: number;
  wordsRead: number;
};

export type ImprovementErrorCode =
  | "improvements_missing_book_text"
  | "improvements_invalid_json"
  | "improvements_empty_report"
  | "improvements_provider_timeout"
  | "improvements_provider_error"
  | "improvements_unknown_error";

export class ImprovementEngineError extends Error {
  readonly code: ImprovementErrorCode;
  constructor(code: ImprovementErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "ImprovementEngineError";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Estimativa de tokens — mesma heurística do auditEngine.
// ─────────────────────────────────────────────────────────────────────────

const WORDS_TO_TOKENS = 1.5;
const CONTEXT_USABLE_RATIO = 0.75;

function approximateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * WORDS_TO_TOKENS);
}

function chaptersToBookText(chapters: ImprovementChapterInput[]): string {
  return chapters
    .map((chapter) => `## Capítulo ${chapter.index}: ${chapter.title}\n\n${chapter.content}`)
    .join("\n\n────────────────────────────\n\n");
}

function bookWordCount(chapters: ImprovementChapterInput[]): number {
  return chapters.reduce((total, chapter) => total + chapter.content.trim().split(/\s+/).filter(Boolean).length, 0);
}

export function decideImprovementStrategy(chapters: ImprovementChapterInput[]): "integral" | "pipeline" {
  const bookText = chaptersToBookText(chapters);
  const estimatedTokens = approximateTokens(bookText);
  const contextBudget = Math.floor(ENV.auditModelContextTokens * CONTEXT_USABLE_RATIO);
  return estimatedTokens <= contextBudget ? "integral" : "pipeline";
}

// ─────────────────────────────────────────────────────────────────────────
// Prompts — focados em FRAQUEZAS estruturais, não contradições.
// ─────────────────────────────────────────────────────────────────────────

const OUTPUT_SCHEMA_DESCRIPTION = `
Cada item da lista deve ter EXATAMENTE este formato JSON:

{
  "id": "string curta única dentro do relatório",
  "priority": "critical" | "high" | "medium" | "low",
  "category": "character_arc" | "narrative_promise" | "political_core" | "character_function" | "motivation" | "pacing" | "dramatic_tension" | "abandoned_conflict" | "worldbuilding_rule" | "scene_consequence" | "tone" | "other",
  "title": "Frase curta (até 100 caracteres) nomeando a fraqueza editorial",
  "summary": "Resumo em 1 frase do que está fraco — factual, sem clichê.",
  "anchors": [
    {
      "chapter": "Capítulo X: <título>",
      "scene": "descrição curta da cena (opcional)",
      "approximatePosition": "início|meio|fim (opcional)",
      "excerpt": "trecho LITERAL do livro (até 320 caracteres) que sustenta a observação"
    }
  ],
  "whyItWeakens": "Explicação ancorada nos trechos citados. Por que isso enfraquece a obra. Sem frases genéricas.",
  "impactOnWork": "O que se perde para a obra inteira se ficar como está.",
  "suggestedFix": "Sugestão concreta de melhoria editorial — específica para esta obra.",
  "exampleAdjustment": "(opcional) Um exemplo de ajuste textual ou estrutural específico.",
  "alternativeFixes": ["(opcional) 1-3 alternativas equivalentes"],
  "affectedElements": {
    "characters": ["nomes"],
    "factions": [],
    "locations": [],
    "arcs": [],
    "promisesOrPayoffs": [],
    "powersOrRules": []
  },
  "confidence": "high" | "medium" | "low"
}
`.trim();

const PRIORITY_GUIDELINES = `
Prioridade — calibre rigorosamente:
- critical: fraqueza que enfraquece a obra inteira; arco central sem evolução, promessa raiz sem payoff, núcleo dramático ausente. Resolver muda o livro como um todo.
- high: fraqueza importante em uma camada central; motivação importante sem desenvolvimento, conflito apresentado e abandonado, personagem-chave perdendo função.
- medium: fraqueza perceptível mas localizada; ritmo quebrado em uma sequência, tensão caindo em um trecho, regra de mundo subutilizada.
- low: refinamento editorial; pequenas oportunidades de fortalecer cena, parágrafo ou imagem específica.
`.trim();

const HARD_RULES = `
Regras obrigatórias:
1. CITE TRECHO LITERAL do livro em cada anchor.excerpt. Sem trecho, não é sugestão válida.
2. Não opine sobre erros (contradição, cronologia, conhecimento) — isso é trabalho da Auditoria, não das Melhorias.
3. Foco é FORTALECER a obra como um todo, não apontar contradições.
4. NÃO use frases genéricas ("desenvolver mais o personagem", "trabalhar melhor o arco", "melhorar o ritmo"). Cada suggestedFix precisa ser específica para ESTA obra, com nomes, cenas e ações concretas.
5. NÃO sugira ajustes cosméticos de prosa (estilo, escolha de palavra, ritmo de frase). Foco é estrutural.
6. Se o livro for sólido na categoria, NÃO invente fraqueza. Devolva lista vazia se não houver achados de qualidade.
7. Para categorias "pacing", "tone" e "dramatic_tension", não basta citar uma exposição e chamar de quebra. Prove a sequência local com pelo menos 3 anchors próximos: antes da suposta quebra, o trecho que quebra, e a retomada/depois. Se a informação aparece como preparação antes do confronto principal, não marque como quebra.
8. Para categoria "motivation", nunca diga "sem gatilho", "não explica" ou "por que agora" sem citar: a fala/ação motivadora, a causa emocional anterior e o gatilho atual. Se o texto já deu uma pista explícita, como alguém descobrindo uma verdade, culpa, suspeita ou responsabilidade, não chame de ausência de motivação.
9. Qualquer afirmação temporal concreta ("28 anos", "três semanas", "dez anos") precisa aparecer literalmente em pelo menos um anchor. Não deduza duração de casamento, idade ou passado como se fosse duração do conflito atual.
10. Para categorias "abandoned_conflict" e "scene_consequence", não chame uma cena de "sem reação", "sem consequência" ou "abandonada" quando o texto já mostra consequência emocional, física ou traumática: pavor, paralisia, choro, fuga, vergonha, micção involuntária, incapacidade de falar/agir ou colapso. Trauma também é reação narrativa.
11. Para afirmar que um conflito foi abandonado, cite pelo menos 3 anchors: o evento/revelação, a reação imediata no texto e um ponto posterior em que a obra realmente teve espaço para retomar e não retomou. Não prescreva vingança, confronto ou ação ativa quando a cena estabelece medo incapacitante.
12. Para "narrative_promise", "worldbuilding_rule" e "political_core": antes de afirmar que uma promessa, conceito, regra ou tema nomeado nao foi desenvolvido, nao foi explicado, nao foi cumprido ou ficou sem payoff, verifique TODAS as extracoes/dossies recebidos. Se o termo aparecer desenvolvido, explicado, aplicado ou retomado em qualquer bloco posterior, nao reporte ausencia.
13. Devolva APENAS JSON válido no formato {"suggestions": [...]} — nada antes, nada depois.
`.trim();

function buildIntegralSystemPrompt(workMeta: ImprovementWorkMeta): string {
  return [
    `Você é um editor literário sênior. Sua tarefa é ler a obra "${workMeta.title}" INTEIRA e listar as fraquezas ESTRUTURAIS — arcos, promessas, tensão, conflitos, motivações, núcleos, regras de mundo e consequências de cena.`,
    "",
    "Não é seu trabalho apontar contradições ou erros de continuidade (existe outro módulo pra isso). Seu trabalho é fortalecer a obra como um todo apontando o que pode ficar mais forte.",
    "",
    PRIORITY_GUIDELINES,
    "",
    HARD_RULES,
    "",
    `Formato de saída:\n${OUTPUT_SCHEMA_DESCRIPTION}`,
    "",
    PROMPT_HARDENING_CLAUSE,
  ].join("\n");
}

function buildIntegralUserPrompt(workMeta: ImprovementWorkMeta, bookText: string): string {
  const meta = [
    `Obra: ${workMeta.title}`,
    workMeta.genre ? `Gênero: ${workMeta.genre}` : "",
    workMeta.description ? `Descrição: ${escapePromptInjection(workMeta.description, 1_000)}` : "",
  ].filter(Boolean).join("\n");

  return `${meta}

Conteúdo completo da obra (separado por capítulo):

${escapePromptInjection(bookText)}

Devolva apenas: {"suggestions": [...]}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline (extração por capítulo + cruzamento global) — usado quando o
// livro não cabe no contexto.
// ─────────────────────────────────────────────────────────────────────────

type ChapterExtraction = {
  chapterId: number;
  chapterIndex: number;
  chapterTitle: string;
  rawExtraction: string;
};

const EXTRACTION_SYSTEM = `Você está fazendo a leitura editorial de UM capítulo dentro de uma obra maior.
Não escreva sugestão final ainda. Extraia evidências estruturais que serão usadas depois numa análise GLOBAL da obra inteira.
Foco em camadas que importam pra fortalecimento da história: arcos, promessas narrativas, tensão dramática, motivações, ritmo, conflitos, regras de mundo aplicadas, núcleo político/social, consequências de cenas e mudanças de tom.

Devolva APENAS JSON válido neste formato:
{
  "arcs": [{"character": "nome", "movement": "o que muda no arco deste personagem aqui", "evidenceExcerpt": "trecho literal curto"}],
  "promisesIntroduced": [{"promise": "promessa narrativa aberta neste capítulo", "stakes": "o que está em jogo", "evidenceExcerpt": "trecho"}],
  "promisesAdvanced": [{"promise": "promessa retomada/aprofundada", "movement": "como avança", "evidenceExcerpt": "trecho"}],
  "promisesDropped": [{"promise": "promessa que parecia importante mas o capítulo abandonou", "evidenceExcerpt": "trecho"}],
  "tensionState": "subindo|caindo|estável|inexistente — com 1 frase de justificativa",
  "conflictsRaised": [{"conflict": "novo conflito apresentado", "stakes": "o que está em jogo", "evidenceExcerpt": "trecho"}],
  "motivationsSeenOrChanged": [{"character": "X", "motivation": "o que move X aqui", "transition": "se mudou em relação ao capítulo anterior, como mudou", "evidenceExcerpt": "trecho"}],
  "pacingNote": "ritmo deste capítulo em relação ao anterior — 1 frase específica",
  "toneNote": "tom deste capítulo e se mudou em relação ao anterior — 1 frase específica",
  "worldRulesUsed": [{"rule": "regra de mundo/magia aplicada", "depth": "rasa|média|profunda", "evidenceExcerpt": "trecho"}],
  "sceneConsequences": [{"event": "evento importante", "expectedConsequence": "consequência que precisa aparecer depois", "evidenceExcerpt": "trecho"}],
  "characterRelevance": [{"character": "nome", "function": "função do personagem nesta unidade", "notes": "se está perdendo função, observar aqui"}]
}`;

const CROSSCHECK_SYSTEM = `Você é um editor literário sênior. Recebe extrações estruturadas de TODOS os capítulos de uma obra e gera SUGESTÕES EDITORIAIS para fortalecer a obra como um todo.

Cruze:
- arcos: alguém com arco apresentado e nunca evoluído? motivação que muda sem ponte?
- promessas: o que foi prometido e não pagou? o que pagou tarde demais? o que ficou subexplorado?
- tensão: trechos onde a tensão caiu e nunca subiu de novo?
- conflitos: conflitos apresentados e abandonados?
- núcleo político/social: começou forte e desapareceu?
- personagem-chave: alguém importante perdendo função no terço final?
- regras de mundo: regra apresentada e nunca usada estruturalmente?
- consequências: evento importante sem eco depois?
- tom: mudanças de tom sem propósito claro?
- ritmo: capítulos onde o ritmo quebra de forma involuntária?

${HARD_RULES}

${PRIORITY_GUIDELINES}

Formato:
${OUTPUT_SCHEMA_DESCRIPTION}

Devolva APENAS {"suggestions": [...]}`;

// ─────────────────────────────────────────────────────────────────────────
// Provider-agnostic LLM caller (reusa invokeLLM via ENV.auditProvider).
// ─────────────────────────────────────────────────────────────────────────

async function callImprovementLLM(args: { systemPrompt: string; userPrompt: string; maxTokens: number }): Promise<string> {
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
      throw new ImprovementEngineError("improvements_provider_timeout", message);
    }
    throw new ImprovementEngineError("improvements_provider_error", message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Parsing seguro
// ─────────────────────────────────────────────────────────────────────────

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:json|JSON)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseSuggestionsJson(raw: string): NarrativeImprovementSuggestion[] {
  if (!raw) return [];
  const cleaned = stripCodeFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) {
    return parsed
      .map((candidate) => validateSuggestion(candidate))
      .filter((suggestion): suggestion is NarrativeImprovementSuggestion => suggestion !== null);
  }
  if (!parsed || typeof parsed !== "object") return [];
  const suggestionsRaw = (parsed as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestionsRaw)) return [];
  const suggestions: NarrativeImprovementSuggestion[] = [];
  for (const candidate of suggestionsRaw) {
    const validated = validateSuggestion(candidate);
    if (validated) suggestions.push(validated);
  }
  return suggestions;
}

function validateSuggestion(value: unknown): NarrativeImprovementSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const priority = v.priority as string | undefined;
  const category = v.category as string | undefined;
  const confidence = v.confidence as string | undefined;
  if (!NARRATIVE_IMPROVEMENT_PRIORITIES.includes(priority as NarrativeImprovementPriority)) return null;
  if (!NARRATIVE_IMPROVEMENT_CATEGORIES.includes(category as NarrativeImprovementCategory)) return null;
  if (!NARRATIVE_IMPROVEMENT_CONFIDENCE.includes(confidence as NarrativeImprovementConfidence)) return null;

  const anchorsRaw = Array.isArray(v.anchors) ? v.anchors : [];
  const anchors = anchorsRaw
    .map((a) => {
      if (!a || typeof a !== "object") return null;
      const ar = a as Record<string, unknown>;
      const excerpt = typeof ar.excerpt === "string" ? ar.excerpt.trim() : "";
      if (!excerpt) return null;
      return {
        chapter: typeof ar.chapter === "string" ? ar.chapter : undefined,
        scene: typeof ar.scene === "string" ? ar.scene : undefined,
        approximatePosition: typeof ar.approximatePosition === "string" ? ar.approximatePosition : undefined,
        excerpt,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  if (!anchors.length) return null;

  const suggestedFix = typeof v.suggestedFix === "string" ? v.suggestedFix.trim() : "";
  if (!suggestedFix) return null;

  const affected = (v.affectedElements as Record<string, unknown> | undefined) ?? {};
  const stringArr = (key: string): string[] | undefined => {
    const raw = affected[key];
    if (!Array.isArray(raw)) return undefined;
    const filtered = raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    return filtered.length ? filtered : undefined;
  };

  return {
    id: typeof v.id === "string" && v.id.trim() ? v.id.trim().slice(0, 64) : `imp_${Math.random().toString(36).slice(2, 10)}`,
    priority: priority as NarrativeImprovementPriority,
    category: category as NarrativeImprovementCategory,
    title: typeof v.title === "string" ? v.title.trim().slice(0, 240) : "Fortalecimento sugerido",
    summary: typeof v.summary === "string" ? v.summary.trim() : "",
    anchors,
    whyItWeakens: typeof v.whyItWeakens === "string" ? v.whyItWeakens.trim() : "",
    impactOnWork: typeof v.impactOnWork === "string" ? v.impactOnWork.trim() : "",
    suggestedFix,
    exampleAdjustment: typeof v.exampleAdjustment === "string" ? v.exampleAdjustment.trim() || undefined : undefined,
    alternativeFixes: Array.isArray(v.alternativeFixes)
      ? v.alternativeFixes.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5)
      : undefined,
    affectedElements: {
      characters: stringArr("characters"),
      factions: stringArr("factions"),
      locations: stringArr("locations"),
      arcs: stringArr("arcs"),
      promisesOrPayoffs: stringArr("promisesOrPayoffs"),
      powersOrRules: stringArr("powersOrRules"),
    },
    confidence: confidence as NarrativeImprovementConfidence,
  };
}

function improvementTerms(suggestion: NarrativeImprovementSuggestion) {
  return extractSpecificTerms(
    suggestion.title,
    suggestion.summary,
    suggestion.whyItWeakens,
    suggestion.impactOnWork,
    suggestion.suggestedFix,
    suggestion.exampleAdjustment,
    suggestion.anchors.map((anchor) => `${anchor.chapter ?? ""} ${anchor.scene ?? ""} ${anchor.excerpt ?? ""}`),
    suggestion.affectedElements.characters,
    suggestion.affectedElements.factions,
    suggestion.affectedElements.locations,
    suggestion.affectedElements.arcs,
    suggestion.affectedElements.promisesOrPayoffs,
    suggestion.affectedElements.powersOrRules,
  );
}

const SEQUENCE_SENSITIVE_CATEGORIES = new Set<NarrativeImprovementCategory>([
  "pacing",
  "tone",
  "dramatic_tension",
]);

const MAX_LOCAL_SEQUENCE_SPAN = 14_000;

function hasLocalSequenceEvidence(suggestion: NarrativeImprovementSuggestion, corpus: string) {
  if (!SEQUENCE_SENSITIVE_CATEGORIES.has(suggestion.category)) return true;
  if (suggestion.anchors.length < 3) return false;

  const positions = suggestion.anchors
    .map((anchor) => excerptPositionInCorpus(anchor.excerpt, corpus))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b);

  if (positions.length < 3) return false;
  return positions[positions.length - 1] - positions[0] <= MAX_LOCAL_SEQUENCE_SPAN;
}

const MOTIVATION_ABSENCE_RE =
  /\b(nao explica|nao oferece|sem gatilho|carece de gatilho|falta gatilho|falta motivo|sem motivo|sem justificativa|nao justificada|arbitraria|por que agora|o que mudou)\b/;

const DURATION_CLAIM_RE =
  /\b\d{1,4}\s+(?:ano|anos|mes|meses|semana|semanas|dia|dias|decada|decadas)\b/g;

const ABANDONMENT_CATEGORIES = new Set<NarrativeImprovementCategory>([
  "abandoned_conflict",
  "scene_consequence",
]);

const ABANDONMENT_CLAIM_RE =
  /\b(abandonad|abandona|sem desdobramento|sem consequencia|sem consequencias|nao gera consequencia|nao gera consequencias|nao reage|sem reacao|descartad|sem peso narrativo|nao gera mudanca|nao gera mudancas|sem mudanca|sem mudancas|sem eco)\b/;

const INCAPACITATION_RE =
  /\b(medo|pavor|terror|apavorad|paralisad|imovel|incapaz|nao conseguiu|nao consegue|nao conseguia|nao pode agir|sem voz|sem ar|garganta fech|choro|chorou|chorar|soluc|tremia|tremor|urina|urinou|urinar|miccao|molhou se|fuga|fugiu|fugir|escapou|vergonha|humilh|colapso|desabou)\b/;

const ABSENCE_SENSITIVE_CATEGORIES = new Set<NarrativeImprovementCategory>([
  "narrative_promise",
  "worldbuilding_rule",
  "political_core",
]);

const ABSENCE_OR_UNFULFILLED_CLAIM_RE =
  /\b(nao (?:desenvolv|explica|explora|aprofunda|cumpre|paga|retoma|materializa|aparece|integra|usa|concretiza)|sem (?:payoff|desenvolvimento|explicacao|aprofundamento|funcao|relevancia|eco)|promessa\b.{0,80}\b(?:sem payoff|nao cumprida|nao e cumprida)|subutilizad|ausente|desaparec|mencionad[ao] de passagem|apenas mencionad[ao]|fica apenas citad[ao])\b/;

const DEVELOPMENT_CONTEXT_RE =
  /\b(explica|explicad|define|definid|revela|revelad|descobre|descobert|divide|dividid|variedade|energia|poder|habilidade|regra|tecnica|teste|aplica|aplicad|usa|usada|utiliza|utilizad|controla|controlar|manipulacao|intensificacao|localizacao|transformacao|versatilizacao|aprimorado|foco|fonte|vital|padrao|origem|funciona|funcionam|funcionamento|treina|treinamento)\b/;

const GENERIC_TERM_STOPWORDS = new Set([
  "a",
  "o",
  "as",
  "os",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "obra",
  "livro",
  "texto",
  "capitulo",
  "capitulos",
  "bloco",
  "cena",
  "personagem",
  "personagens",
  "historia",
  "narrativa",
  "promessa",
  "central",
  "titulo",
  "subtitulo",
  "tema",
  "conceito",
  "regra",
  "eutanasia",
]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedTermVariants(term: string): string[] {
  const normalized = normalizeEvidenceText(term);
  if (!normalized) return [];
  const variants = new Set<string>();
  if (!GENERIC_TERM_STOPWORDS.has(normalized) && normalized.length >= 3) {
    variants.add(normalized);
  }
  for (const word of normalized.split(/\s+/)) {
    if (word.length >= 4 && !GENERIC_TERM_STOPWORDS.has(word)) {
      variants.add(word);
    }
  }
  return Array.from(variants);
}

function absenceSensitiveTerms(suggestion: NarrativeImprovementSuggestion) {
  const rawTerms = [
    ...improvementTerms(suggestion),
    ...(suggestion.affectedElements.promisesOrPayoffs ?? []),
    ...(suggestion.affectedElements.powersOrRules ?? []),
    ...(suggestion.affectedElements.factions ?? []),
    ...(suggestion.affectedElements.locations ?? []),
  ];

  const variants = new Set<string>();
  for (const term of rawTerms) {
    for (const variant of normalizedTermVariants(term)) {
      variants.add(variant);
    }
  }
  return Array.from(variants).slice(0, 20);
}

function termHasDevelopmentAcrossCorpus(
  normalizedTerm: string,
  chapters: ImprovementChapterInput[],
) {
  if (!normalizedTerm || normalizedTerm.length < 3) return false;
  const pattern = new RegExp(`\\b${escapeRegExp(normalizedTerm)}\\b`, "g");
  let totalOccurrences = 0;
  let chaptersWithTerm = 0;
  let developmentHits = 0;

  for (const chapter of chapters) {
    const text = normalizeEvidenceText(`${chapter.title}\n${chapter.content}`);
    const matches = Array.from(text.matchAll(pattern));
    if (!matches.length) continue;

    chaptersWithTerm += 1;
    totalOccurrences += matches.length;

    for (const match of matches) {
      const index = match.index ?? 0;
      const context = text.slice(Math.max(0, index - 800), index + normalizedTerm.length + 800);
      if (DEVELOPMENT_CONTEXT_RE.test(context)) {
        developmentHits += 1;
        break;
      }
    }
  }

  return developmentHits > 0 && (totalOccurrences >= 4 || chaptersWithTerm >= 2);
}

function suggestionClaimText(suggestion: NarrativeImprovementSuggestion) {
  return normalizeEvidenceText([
    suggestion.title,
    suggestion.summary,
    suggestion.whyItWeakens,
    suggestion.impactOnWork,
    suggestion.suggestedFix,
    suggestion.exampleAdjustment,
    ...(suggestion.alternativeFixes ?? []),
  ].filter(Boolean).join(" "));
}

function suggestionEvidenceText(suggestion: NarrativeImprovementSuggestion) {
  return normalizeEvidenceText(suggestion.anchors.map((anchor) => anchor.excerpt ?? "").join(" "));
}

function hasUnsupportedDurationClaim(suggestion: NarrativeImprovementSuggestion) {
  const claims = suggestionClaimText(suggestion).match(DURATION_CLAIM_RE) ?? [];
  if (!claims.length) return false;
  const evidence = suggestionEvidenceText(suggestion);
  return claims.some((claim) => !evidence.includes(claim));
}

function hasUnsupportedMotivationAbsenceClaim(suggestion: NarrativeImprovementSuggestion, corpus: string) {
  if (suggestion.category !== "motivation") return false;
  const claimText = suggestionClaimText(suggestion);
  if (!MOTIVATION_ABSENCE_RE.test(claimText)) return false;
  if (suggestion.anchors.length < 3) return true;
  return !hasLocalSequenceEvidence({ ...suggestion, category: "dramatic_tension" }, corpus);
}

function hasUnsupportedAbandonmentClaim(suggestion: NarrativeImprovementSuggestion, corpus: string) {
  const claimText = suggestionClaimText(suggestion);
  const isAbandonmentCategory = ABANDONMENT_CATEGORIES.has(suggestion.category);
  const hasAbandonmentClaim = ABANDONMENT_CLAIM_RE.test(claimText);

  if (!isAbandonmentCategory && !hasAbandonmentClaim) return false;
  if (suggestion.anchors.length < 3) return true;
  if (hasAbandonmentClaim && INCAPACITATION_RE.test(claimText)) return true;

  const positions = suggestion.anchors
    .map((anchor) => excerptPositionInCorpus(anchor.excerpt, corpus))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b);

  if (positions.length < 3) return true;

  const localContext = positions
    .map((position) => corpus.slice(Math.max(0, position - 2_500), position + 5_000))
    .join(" ");
  const span = positions[positions.length - 1] - positions[0];

  return hasAbandonmentClaim && span <= MAX_LOCAL_SEQUENCE_SPAN && INCAPACITATION_RE.test(localContext);
}

function hasUnsupportedAbsenceClaim(
  suggestion: NarrativeImprovementSuggestion,
  chapters: ImprovementChapterInput[],
) {
  if (!ABSENCE_SENSITIVE_CATEGORIES.has(suggestion.category)) return false;
  const claimText = suggestionClaimText(suggestion);
  if (!ABSENCE_OR_UNFULFILLED_CLAIM_RE.test(claimText)) return false;

  const terms = absenceSensitiveTerms(suggestion);
  if (!terms.length) return false;

  return terms.some((term) => termHasDevelopmentAcrossCorpus(term, chapters));
}

function filterImprovementSuggestionsByEvidence(
  suggestions: NarrativeImprovementSuggestion[],
  chapters: ImprovementChapterInput[],
): NarrativeImprovementSuggestion[] {
  const corpus = buildEvidenceCorpus(chapters);
  const multiChapter = chapters.length > 1;

  return suggestions
    .map((suggestion) => {
      const anchors = suggestion.anchors.filter((anchor, index, array) => {
        const excerpt = anchor.excerpt ?? "";
        if (!excerptAppearsInCorpus(excerpt, corpus)) return false;
        return array.findIndex((other) => !excerptsAreDistinct(other.excerpt, excerpt)) === index;
      });

      const needsTwoAnchors = multiChapter && (suggestion.priority === "critical" || suggestion.priority === "high");
      if (anchors.length < (needsTwoAnchors ? 2 : 1)) return null;

      const checkedSuggestion = { ...suggestion, anchors };
      if (!hasLocalSequenceEvidence(checkedSuggestion, corpus)) return null;
      if (hasUnsupportedDurationClaim(checkedSuggestion)) return null;
      if (hasUnsupportedMotivationAbsenceClaim(checkedSuggestion, corpus)) return null;
      if (hasUnsupportedAbandonmentClaim(checkedSuggestion, corpus)) return null;
      if (hasUnsupportedAbsenceClaim(checkedSuggestion, chapters)) return null;

      const terms = improvementTerms(checkedSuggestion);
      if (!hasEnoughExplanation(suggestion.summary, 7)) return null;
      if (!hasEnoughExplanation(suggestion.whyItWeakens, 9)) return null;
      if (!hasEnoughExplanation(suggestion.impactOnWork, 7)) return null;
      if (!hasEnoughExplanation(suggestion.suggestedFix, 8)) return null;
      if (isGenericGuidance(suggestion.suggestedFix, terms)) return null;
      if (!hasConcreteEditVerb(suggestion.suggestedFix)) return null;
      if (terms.length && needsTwoAnchors && !hasSpecificTerm(suggestion.suggestedFix, terms)) return null;

      return checkedSuggestion;
    })
    .filter((suggestion): suggestion is NarrativeImprovementSuggestion => suggestion !== null);
}

// ─────────────────────────────────────────────────────────────────────────
// Estratégias
// ─────────────────────────────────────────────────────────────────────────

async function callImprovementWithJsonRepair(args: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  llmCallCounter: { value: number };
}): Promise<{ suggestions: NarrativeImprovementSuggestion[]; raw: string }> {
  const raw = await callImprovementLLM({
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    maxTokens: args.maxTokens,
  });
  args.llmCallCounter.value += 1;
  let suggestions = parseSuggestionsJson(raw);
  if (suggestions.length === 0 && raw.trim()) {
    // Tenta reparo único antes de jogar improvements_invalid_json.
    const repairSystem = "Você é um corretor de JSON. Receba o texto abaixo e devolva APENAS um JSON válido no formato {\"suggestions\":[...]}. Não invente sugestões novas. Se nada for recuperável, devolva {\"suggestions\":[]}.";
    const repairUser = `Texto bruto (possivelmente JSON malformado):\n${raw}`;
    let repairRaw = "";
    try {
      repairRaw = await callImprovementLLM({
        systemPrompt: repairSystem,
        userPrompt: repairUser,
        maxTokens: 8_000,
      });
      args.llmCallCounter.value += 1;
    } catch {
      // Se o reparo falhar (timeout/erro de provider), seguimos com o original.
    }
    if (repairRaw) {
      suggestions = parseSuggestionsJson(repairRaw);
    }
    if (suggestions.length === 0 && !/"suggestions"\s*:/.test(raw) && !/"suggestions"\s*:/.test(repairRaw)) {
      throw new ImprovementEngineError("improvements_invalid_json", "Modelo não devolveu JSON no formato esperado.");
    }
  }
  return { suggestions, raw };
}

async function runIntegralImprovements(workMeta: ImprovementWorkMeta, chapters: ImprovementChapterInput[]): Promise<ImprovementEngineResult> {
  const bookText = chaptersToBookText(chapters);
  const systemPrompt = buildIntegralSystemPrompt(workMeta);
  const userPrompt = buildIntegralUserPrompt(workMeta, bookText);
  const calls = { value: 0 };
  const { suggestions } = await callImprovementWithJsonRepair({
    systemPrompt,
    userPrompt,
    maxTokens: 16_000,
    llmCallCounter: calls,
  });
  const evidenceCheckedSuggestions = filterImprovementSuggestionsByEvidence(suggestions, chapters);
  return {
    suggestions: evidenceCheckedSuggestions,
    strategy: "integral",
    engineLabel: `${ENV.auditProvider}:${ENV.auditModel || "default"}`,
    internalLlmCalls: calls.value,
    wordsRead: bookWordCount(chapters),
  };
}

async function extractChapter(workMeta: ImprovementWorkMeta, chapter: ImprovementChapterInput): Promise<ChapterExtraction> {
  const userPrompt = [
    `Obra: ${workMeta.title}`,
    `Capítulo ${chapter.index}: ${chapter.title}`,
    "",
    "Conteúdo:",
    escapePromptInjection(chapter.content),
    "",
    "Devolva apenas o JSON estruturado conforme instruído.",
  ].join("\n");
  const raw = await callImprovementLLM({ systemPrompt: EXTRACTION_SYSTEM, userPrompt, maxTokens: 6_000 });
  return {
    chapterId: chapter.chapterId,
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    rawExtraction: stripCodeFence(raw),
  };
}

const CONSOLIDATE_SYSTEM = `Você está em um passo intermediário de consolidação editorial.
Receba extrações de vários capítulos e produza UM bloco consolidado que preserve:
- arcos em desenvolvimento ou estagnados
- promessas abertas e payoffs ainda pendentes
- tensão e ritmo agregados nestes capítulos
- conflitos apresentados, retomados ou abandonados
- regras de mundo aplicadas e suas profundidades
- consequências de cena ainda em aberto
- mudanças de tom

Mantenha estilo estruturado (texto denso por seções). NÃO invente sugestões finais ainda — apenas consolide as evidências.
Não use aberturas. Devolva apenas o conteúdo consolidado.`;

async function consolidateExtractionsLayer(
  workMeta: ImprovementWorkMeta,
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
    const raw = await callImprovementLLM({
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

async function crossCheckExtractions(
  workMeta: ImprovementWorkMeta,
  extractions: ChapterExtraction[],
  calls: { value: number },
): Promise<NarrativeImprovementSuggestion[]> {
  // Pra obras grandes (>8 chunks), consolida em níveis antes do cross-check
  // final. Sem isso, 20+ extrações estouravam o contexto.
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
    "Cruze tudo e devolva apenas {\"suggestions\": [...]}.",
  ].filter(Boolean).join("\n");

  const { suggestions } = await callImprovementWithJsonRepair({
    systemPrompt: CROSSCHECK_SYSTEM,
    userPrompt,
    maxTokens: 16_000,
    llmCallCounter: calls,
  });
  return suggestions;
}

async function runPipelineImprovements(workMeta: ImprovementWorkMeta, chapters: ImprovementChapterInput[]): Promise<ImprovementEngineResult> {
  const calls = { value: 0 };

  const PARALLEL = 4;
  const extractions: ChapterExtraction[] = [];
  for (let i = 0; i < chapters.length; i += PARALLEL) {
    const slice = chapters.slice(i, i + PARALLEL);
    const batch = await Promise.all(slice.map((chapter) => extractChapter(workMeta, chapter)));
    extractions.push(...batch);
  }
  calls.value += extractions.length;

  const suggestions = filterImprovementSuggestionsByEvidence(
    await crossCheckExtractions(workMeta, extractions, calls),
    chapters,
  );

  return {
    suggestions,
    strategy: "pipeline",
    engineLabel: `${ENV.auditProvider}:${ENV.auditModel || "default"}`,
    internalLlmCalls: calls.value,
    wordsRead: bookWordCount(chapters),
  };
}

/**
 * Roda Melhorias Narrativas sobre uma obra (lista de capítulos).
 *
 * O caller (worker) é responsável por:
 *   - reservar `wordCount` créditos de análise ANTES de chamar
 *   - chamar isso de dentro de try/catch e liberar reserva em falha
 *   - chamar confirmImprovementCredits(wordCount) no sucesso
 *   - persistir o `ImprovementEngineResult.suggestions` em `improvementReports`
 *
 * Estratégia (integral vs pipeline) é decidida internamente conforme
 * ENV.auditModelContextTokens (compartilha config com Auditoria).
 */
export async function runNarrativeImprovements(args: {
  workMeta: ImprovementWorkMeta;
  chapters: ImprovementChapterInput[];
}): Promise<ImprovementEngineResult> {
  // Filtra capítulos vazios antes de decidir estratégia (mesma defesa que
  // aplicamos no auditEngine após o pente-fino).
  const validChapters = args.chapters.filter((c) => c.content.trim().length > 0);
  if (!validChapters.length) {
    throw new ImprovementEngineError("improvements_missing_book_text", "Obra sem texto suficiente pra análise editorial.");
  }
  const strategy = decideImprovementStrategy(validChapters);
  try {
    return strategy === "integral"
      ? await runIntegralImprovements(args.workMeta, validChapters)
      : await runPipelineImprovements(args.workMeta, validChapters);
  } catch (error) {
    if (error instanceof ImprovementEngineError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ImprovementEngineError("improvements_unknown_error", message);
  }
}

export function parseNarrativeImprovementSuggestionsJson(raw: string | null | undefined): NarrativeImprovementSuggestion[] {
  if (!raw) return [];
  return parseSuggestionsJson(raw);
}

export function sanitizeNarrativeImprovementSuggestions(
  suggestions: NarrativeImprovementSuggestion[],
  chapters: ImprovementChapterInput[],
): NarrativeImprovementSuggestion[] {
  return filterImprovementSuggestionsByEvidence(suggestions, chapters);
}

export function sanitizeNarrativeImprovementReportJson(
  raw: string | null | undefined,
  chapters: ImprovementChapterInput[],
) {
  const parsed = parseNarrativeImprovementSuggestionsJson(raw);
  const suggestions = sanitizeNarrativeImprovementSuggestions(parsed, chapters);
  const counts = aggregateImprovementCounts(suggestions);
  return {
    suggestions,
    suggestionsJson: JSON.stringify(suggestions),
    counts,
    removed: parsed.length - suggestions.length,
  };
}

export { aggregateImprovementCounts };
