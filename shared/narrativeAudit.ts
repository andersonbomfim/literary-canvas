/**
 * Auditoria de Consistência Narrativa — tipos compartilhados back/front.
 *
 * Um "issue" é uma inconsistência localizada na obra. O contrato vem da spec
 * do produto: cada issue precisa ser apontável (capítulo + trecho), conflitar
 * com OUTRO trecho conhecido, ter gravidade calibrada, justificativa baseada
 * no próprio livro e uma sugestão concreta de correção.
 */

export const NARRATIVE_AUDIT_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type NarrativeAuditSeverity = (typeof NARRATIVE_AUDIT_SEVERITIES)[number];

export const NARRATIVE_AUDIT_CATEGORIES = [
  "chronology",
  "character_motivation",
  "character_knowledge",
  "worldbuilding",
  "magic_or_power_rule",
  "politics",
  "relationship",
  "location",
  "continuity",
  "tone_or_pov",
  "cause_and_effect",
  "other",
] as const;
export type NarrativeAuditCategory = (typeof NARRATIVE_AUDIT_CATEGORIES)[number];

export const NARRATIVE_AUDIT_CONFIDENCE = ["high", "medium", "low"] as const;
export type NarrativeAuditConfidence = (typeof NARRATIVE_AUDIT_CONFIDENCE)[number];

export type NarrativeAuditLocation = {
  chapter?: string;
  scene?: string;
  approximatePosition?: string;
  excerpt?: string;
};

export type NarrativeAuditConflictingLocation = NarrativeAuditLocation & {
  explanation: string;
};

export type NarrativeAuditAffectedElements = {
  characters?: string[];
  factions?: string[];
  locations?: string[];
  timelineEvents?: string[];
  powersOrRules?: string[];
};

export type NarrativeConsistencyIssue = {
  /** Identificador estável dentro do relatório (NÃO globalmente único). */
  id: string;
  severity: NarrativeAuditSeverity;
  category: NarrativeAuditCategory;
  title: string;
  /** Resumo curto do conflito em uma frase. */
  problemSummary: string;
  primaryLocation: NarrativeAuditLocation;
  conflictingLocations: NarrativeAuditConflictingLocation[];
  /** Explicação concreta com base no próprio livro — nada genérico. */
  whyItIsAProblem: string;
  /** Impacto narrativo: o que se perde se ficar do jeito que está. */
  impactOnStory: string;
  /** Correção concreta sugerida. */
  suggestedFix: string;
  /** Outras correções alternativas, opcionais. */
  alternativeFixes?: string[];
  affectedElements: NarrativeAuditAffectedElements;
  confidence: NarrativeAuditConfidence;
};

/** Resumo agregado pra contadores na UI. */
export type NarrativeAuditCounts = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
};

export function aggregateCounts(issues: NarrativeConsistencyIssue[]): NarrativeAuditCounts {
  const counts: NarrativeAuditCounts = { total: issues.length, critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of issues) {
    if (issue.severity === "critical") counts.critical += 1;
    else if (issue.severity === "high") counts.high += 1;
    else if (issue.severity === "medium") counts.medium += 1;
    else counts.low += 1;
  }
  return counts;
}
