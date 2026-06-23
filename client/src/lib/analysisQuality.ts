import type { NarrativeConsistencyIssue } from "@shared/narrativeAudit";
import type { NarrativeImprovementSuggestion } from "@shared/narrativeImprovements";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function wordCount(value: string) {
  return normalize(value).split(/\s+/).filter(Boolean).length;
}

function hasConcreteAction(value: string) {
  return /\b(trocar|substituir|cortar|remover|inserir|incluir|mover|antecipar|retomar|revelar|mostrar|registrar|dividir|fundir|reescrever|transformar|dar|amarrar|plantar|pagar|resolver|nomear|explicitar)\b/.test(normalize(value));
}

function looksGeneric(value: string) {
  const text = normalize(value);
  return [
    /\b(desenvolver|desenvolva|aprofundar|aprofunde|trabalhar|trabalhe|melhorar|melhore|fortalecer|fortaleca)\b.{0,80}\b(personagem|arco|ritmo|tensao|conflito|motivacao|emocao|cena|narrativa|texto)\b/,
    /\b(adicionar|adicione|colocar|coloque|incluir|inclua)\s+(mais|um pouco de)\b.{0,60}\b(detalhe|profundidade|camada|tensao|emocao|contexto)\b/,
    /\b(falta|faltou|precisa de|carece de)\b.{0,60}\b(profundidade|desenvolvimento|clareza|tensao|emocao|ritmo)\b/,
    /\b(nao fica claro|fica confuso|pode ser melhor|poderia ser mais forte)\b/,
  ].some(pattern => pattern.test(text));
}

const SEQUENCE_SENSITIVE_CATEGORIES = new Set(["pacing", "tone", "dramatic_tension"]);
const ABANDONMENT_CATEGORIES = new Set(["abandoned_conflict", "scene_consequence"]);
const MOTIVATION_ABSENCE_RE =
  /\b(nao explica|nao oferece|sem gatilho|carece de gatilho|falta gatilho|falta motivo|sem motivo|sem justificativa|nao justificada|arbitraria|por que agora|o que mudou)\b/;
const DURATION_CLAIM_RE =
  /\b\d{1,4}\s+(?:ano|anos|mes|meses|semana|semanas|dia|dias|decada|decadas)\b/g;
const ABANDONMENT_CLAIM_RE =
  /\b(abandonad|abandona|sem desdobramento|sem consequencia|sem consequencias|nao gera consequencia|nao gera consequencias|nao reage|sem reacao|descartad|sem peso narrativo|nao gera mudanca|nao gera mudancas|sem mudanca|sem mudancas|sem eco)\b/;
const INCAPACITATION_RE =
  /\b(medo|pavor|terror|apavorad|paralisad|imovel|incapaz|nao conseguiu|nao consegue|nao conseguia|nao pode agir|sem voz|sem ar|garganta fech|choro|chorou|chorar|soluc|tremia|tremor|urina|urinou|urinar|miccao|molhou se|fuga|fugiu|fugir|escapou|vergonha|humilh|colapso|desabou)\b/;

function improvementClaimText(suggestion: NarrativeImprovementSuggestion) {
  return normalize([
    suggestion.title,
    suggestion.summary,
    suggestion.whyItWeakens,
    suggestion.impactOnWork,
    suggestion.suggestedFix,
    suggestion.exampleAdjustment,
    ...(suggestion.alternativeFixes ?? []),
  ].filter(Boolean).join(" "));
}

function improvementEvidenceText(suggestion: NarrativeImprovementSuggestion) {
  return normalize((suggestion.anchors ?? []).map(anchor => anchor.excerpt ?? "").join(" "));
}

function hasUnsupportedDurationClaim(suggestion: NarrativeImprovementSuggestion) {
  const claims = improvementClaimText(suggestion).match(DURATION_CLAIM_RE) ?? [];
  if (!claims.length) return false;
  const evidence = improvementEvidenceText(suggestion);
  return claims.some(claim => !evidence.includes(claim));
}

function hasUnsupportedMotivationAbsenceClaim(suggestion: NarrativeImprovementSuggestion) {
  if (suggestion.category !== "motivation") return false;
  if (!MOTIVATION_ABSENCE_RE.test(improvementClaimText(suggestion))) return false;
  return (suggestion.anchors ?? []).length < 3;
}

function hasUnsupportedAbandonmentClaim(suggestion: NarrativeImprovementSuggestion) {
  const claimText = improvementClaimText(suggestion);
  const hasAbandonmentClaim = ABANDONMENT_CLAIM_RE.test(claimText);
  if (!ABANDONMENT_CATEGORIES.has(suggestion.category) && !hasAbandonmentClaim) return false;
  if ((suggestion.anchors ?? []).length < 3) return true;
  return hasAbandonmentClaim && INCAPACITATION_RE.test(claimText);
}

function isUnsupportedToneAudit(issue: NarrativeConsistencyIssue) {
  if (issue.category !== "tone_or_pov") return false;
  const text = normalize([
    issue.title,
    issue.problemSummary,
    issue.whyItIsAProblem,
    issue.impactOnStory,
    issue.suggestedFix,
  ].filter(Boolean).join(" "));
  return !/\b(pov|ponto de vista|foco narrativo|narrador|narracao|primeira pessoa|terceira pessoa|tempo verbal|voz narrativa|distancia narrativa)\b/.test(text);
}

export function isVisibleImprovementSuggestion(suggestion: NarrativeImprovementSuggestion) {
  if (!suggestion.anchors?.some(anchor => anchor.excerpt?.trim())) return false;
  if (SEQUENCE_SENSITIVE_CATEGORIES.has(suggestion.category) && suggestion.anchors.length < 3) return false;
  if (hasUnsupportedDurationClaim(suggestion)) return false;
  if (hasUnsupportedMotivationAbsenceClaim(suggestion)) return false;
  if (hasUnsupportedAbandonmentClaim(suggestion)) return false;
  if (wordCount(suggestion.summary ?? "") < 6) return false;
  if (wordCount(suggestion.whyItWeakens ?? "") < 8) return false;
  if (wordCount(suggestion.impactOnWork ?? "") < 6) return false;
  if (wordCount(suggestion.suggestedFix ?? "") < 7) return false;
  if (!hasConcreteAction(suggestion.suggestedFix ?? "")) return false;
  if (looksGeneric(suggestion.suggestedFix ?? "")) return false;
  return true;
}

export function isVisibleAuditIssue(issue: NarrativeConsistencyIssue) {
  if (!issue.primaryLocation?.excerpt?.trim()) return false;
  if (!issue.conflictingLocations?.some(location => location.excerpt?.trim() && location.explanation?.trim())) return false;
  if (isUnsupportedToneAudit(issue)) return false;
  if (wordCount(issue.whyItIsAProblem ?? "") < 7) return false;
  if (wordCount(issue.impactOnStory ?? "") < 5) return false;
  if (wordCount(issue.suggestedFix ?? "") < 5) return false;
  if (looksGeneric(issue.suggestedFix ?? "") && !hasConcreteAction(issue.suggestedFix ?? "")) return false;
  return true;
}
