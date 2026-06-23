/**
 * Melhorias Narrativas — tipos compartilhados back/front.
 *
 * Diferente de `narrativeAudit.ts` (que aponta CONTRADIÇÕES), Melhorias aponta
 * FRAQUEZAS ESTRUTURAIS. Cada sugestão precisa apontar para um problema
 * editorial concreto baseado em leitura global da obra: arco que esmorece,
 * promessa narrativa sem payoff, regra de mundo subutilizada, tom mudando
 * sem propósito, etc.
 *
 * Separação conceitual (não misturar):
 *   Auditoria  → "isto está ERRADO" (contradições, cronologia, conhecimento)
 *   Melhorias  → "isto pode ficar mais FORTE" (arco, ritmo, payoff, tensão)
 *
 * Tudo aqui é provider-agnostic. O engine vive em
 * server/generation/improvementsEngine.ts e roteia pelo ENV.auditProvider
 * (reusa o mesmo provider/modelo da auditoria por padrão).
 */

export const NARRATIVE_IMPROVEMENT_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type NarrativeImprovementPriority = (typeof NARRATIVE_IMPROVEMENT_PRIORITIES)[number];

// Categorias canônicas vindas do brief de produto. Mantemos a lista fechada
// para que a UI possa agrupar/filtrar de forma estável. "other" cobre a
// borda em que a IA identifica uma fraqueza fora dos eixos catalogados.
export const NARRATIVE_IMPROVEMENT_CATEGORIES = [
  "character_arc",          // arco de personagem fraco / sem evolução clara
  "narrative_promise",      // promessa narrativa apresentada e sem payoff
  "political_core",         // núcleo político/social desaparecendo
  "character_function",     // personagem importante perdendo função/relevância
  "motivation",             // motivação mal desenvolvida ou substituída sem ponte
  "pacing",                 // ritmo quebrado entre capítulos
  "dramatic_tension",       // tensão dramática caindo / sem escalada
  "abandoned_conflict",     // conflito apresentado e nunca retomado
  "worldbuilding_rule",     // regra de mundo/magia pouco explorada ou subutilizada
  "scene_consequence",      // cena importante sem consequência posterior
  "tone",                   // mudança de tom sem intenção clara
  "other",
] as const;
export type NarrativeImprovementCategory = (typeof NARRATIVE_IMPROVEMENT_CATEGORIES)[number];

export const NARRATIVE_IMPROVEMENT_CONFIDENCE = ["high", "medium", "low"] as const;
export type NarrativeImprovementConfidence = (typeof NARRATIVE_IMPROVEMENT_CONFIDENCE)[number];

/**
 * Localização da fraqueza. Diferente de uma issue de auditoria (que aponta
 * UM trecho + um trecho conflitante), uma melhoria geralmente aponta para
 * um arco/sequência. Por isso o tipo aceita várias âncoras textuais.
 */
export type NarrativeImprovementAnchor = {
  chapter?: string;
  scene?: string;
  approximatePosition?: string;
  /** Trecho citado do livro que sustenta a observação. */
  excerpt?: string;
};

export type NarrativeImprovementAffectedElements = {
  characters?: string[];
  factions?: string[];
  locations?: string[];
  arcs?: string[];
  promisesOrPayoffs?: string[];
  powersOrRules?: string[];
};

export type NarrativeImprovementSuggestion = {
  /** Identificador estável dentro do relatório (não globalmente único). */
  id: string;
  priority: NarrativeImprovementPriority;
  category: NarrativeImprovementCategory;
  title: string;
  /** Resumo curto, factual, sem clichê editorial. */
  summary: string;
  /** Lugares no texto onde a fraqueza aparece. Sempre com excerpt. */
  anchors: NarrativeImprovementAnchor[];
  /** Por que isso enfraquece a obra — referencial ao próprio livro. */
  whyItWeakens: string;
  /** O que se perde para a obra inteira se não for ajustado. */
  impactOnWork: string;
  /** Sugestão concreta — não pode ser "desenvolver mais o personagem". */
  suggestedFix: string;
  /** Exemplo opcional de ajuste editorial específico. */
  exampleAdjustment?: string;
  /** Alternativas equivalentes pra dar repertório ao autor. */
  alternativeFixes?: string[];
  affectedElements: NarrativeImprovementAffectedElements;
  confidence: NarrativeImprovementConfidence;
};

export type NarrativeImprovementCounts = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
};

export function aggregateImprovementCounts(
  suggestions: NarrativeImprovementSuggestion[],
): NarrativeImprovementCounts {
  const counts: NarrativeImprovementCounts = {
    total: suggestions.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const suggestion of suggestions) {
    if (suggestion.priority === "critical") counts.critical += 1;
    else if (suggestion.priority === "high") counts.high += 1;
    else if (suggestion.priority === "medium") counts.medium += 1;
    else counts.low += 1;
  }
  return counts;
}
