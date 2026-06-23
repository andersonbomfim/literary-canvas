export type EvidenceChapter = {
  index?: number;
  title?: string;
  content: string;
};

const NAME_RE =
  /\b[A-ZÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ][a-záàâãäéèêëíìîïóòôõöúùûüç]+(?:\s+(?:de|da|do|dos|das|e|[A-ZÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ][a-záàâãäéèêëíìîïóòôõöúùûüç]+))*\b/g;

const GENERIC_GUIDANCE_RE = [
  /\b(desenvolver|desenvolva|aprofundar|aprofunde|trabalhar|trabalhe|melhorar|melhore|fortalecer|fortaleca)\b.{0,80}\b(personagem|arco|ritmo|tensao|conflito|motivacao|emocao|cena|narrativa|texto)\b/,
  /\b(adicionar|adicione|colocar|coloque|incluir|inclua)\s+(mais|um pouco de)\b.{0,60}\b(detalhe|profundidade|camada|tensao|emocao|contexto)\b/,
  /\b(falta|faltou|precisa de|carece de)\b.{0,60}\b(profundidade|desenvolvimento|clareza|tensao|emocao|ritmo)\b/,
  /\b(nao fica claro|fica confuso|pode ser melhor|poderia ser mais forte)\b/,
];

const SEQUENCE_CLAIM_RE =
  /\b(ritmo|tensao|tom|progressao|escalada|climax|exposicao|historico|documental|quebra|quebrar|interrompe|interromper|retoma|retomar|antes|depois|consequencia|causa|efeito)\b/;

export function normalizeEvidenceText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–−]/g, "-")
    .replace(/&nbsp;/gi, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildEvidenceCorpus(chapters: EvidenceChapter[]) {
  return normalizeEvidenceText(chapters.map((chapter) => chapter.content).join("\n\n"));
}

function excerptFragments(excerpt: string) {
  const split = excerpt
    .replace(/\[[^\]]*]/g, " ... ")
    .split(/(?:\.\.\.|…|<[^>]+>)/g)
    .map((part) => normalizeEvidenceText(part))
    .filter(Boolean);
  const whole = normalizeEvidenceText(excerpt);
  return [whole, ...split].filter((part, index, all) => {
    if (!part) return false;
    if (all.indexOf(part) !== index) return false;
    const words = part.split(/\s+/).filter(Boolean);
    return part.length >= 16 && words.length >= 3;
  });
}

export function excerptPositionInCorpus(excerpt: string | null | undefined, corpus: string) {
  if (!excerpt?.trim()) return -1;
  const fragments = excerptFragments(excerpt);
  if (!fragments.length) return -1;

  let best = -1;
  for (const fragment of fragments) {
    const position = corpus.indexOf(fragment);
    if (position >= 0 && (best < 0 || position < best)) best = position;
  }
  return best;
}

export function excerptPositionsInCorpus(excerpts: Array<string | null | undefined>, corpus: string) {
  return excerpts
    .map((excerpt) => excerptPositionInCorpus(excerpt, corpus))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b);
}

export function hasLocalEvidenceSequence(
  excerpts: Array<string | null | undefined>,
  corpus: string,
  options: { minAnchors?: number; maxSpan?: number } = {},
) {
  const minAnchors = options.minAnchors ?? 3;
  const maxSpan = options.maxSpan ?? 14_000;
  const positions = excerptPositionsInCorpus(excerpts, corpus);
  if (positions.length < minAnchors) return false;
  return positions[positions.length - 1] - positions[0] <= maxSpan;
}

export function hasSequenceSensitiveClaim(...values: Array<string | null | undefined>) {
  const normalized = normalizeEvidenceText(values.filter(Boolean).join(" "));
  return SEQUENCE_CLAIM_RE.test(normalized);
}

export function excerptAppearsInCorpus(excerpt: string | null | undefined, corpus: string) {
  if (!excerpt?.trim()) return false;
  const fragments = excerptFragments(excerpt);
  if (!fragments.length) return false;
  return fragments.some((fragment) => corpus.includes(fragment));
}

export function excerptsAreDistinct(first: string | null | undefined, second: string | null | undefined) {
  const a = normalizeEvidenceText(first ?? "");
  const b = normalizeEvidenceText(second ?? "");
  if (!a || !b) return false;
  if (a === b) return false;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return !(shorter.length > 40 && longer.includes(shorter));
}

export function extractSpecificTerms(...values: Array<string | string[] | null | undefined>) {
  const terms = new Set<string>();
  for (const value of values.flatMap((item) => Array.isArray(item) ? item : item ? [item] : [])) {
    for (const match of value.match(NAME_RE) ?? []) {
      const cleaned = match.trim();
      if (cleaned.length >= 3 && !/^(Capitulo|Capítulo|Inicio|Meio|Fim)$/i.test(cleaned)) {
        terms.add(cleaned);
      }
    }
  }
  return Array.from(terms).slice(0, 24);
}

export function hasSpecificTerm(text: string, terms: string[]) {
  const normalized = normalizeEvidenceText(text);
  if (/\bcapitulo\s+\d+\b/.test(normalized)) return true;
  return terms.some((term) => {
    const normalizedTerm = normalizeEvidenceText(term);
    return normalizedTerm.length >= 3 && normalized.includes(normalizedTerm);
  });
}

export function hasConcreteEditVerb(text: string) {
  const normalized = normalizeEvidenceText(text);
  return /\b(trocar|substituir|cortar|remover|inserir|incluir|mover|antecipar|retomar|revelar|mostrar|registrar|dividir|fundir|reescrever|transformar|dar|amarrar|plantar|pagar|resolver|nomear|explicitar)\b/.test(normalized);
}

export function isGenericGuidance(text: string, terms: string[] = []) {
  const normalized = normalizeEvidenceText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 10) return true;
  const generic = GENERIC_GUIDANCE_RE.some((pattern) => pattern.test(normalized));
  if (!generic) return false;
  return !hasSpecificTerm(text, terms) || !hasConcreteEditVerb(text);
}

export function hasEnoughExplanation(text: string, minWords = 9) {
  const normalized = normalizeEvidenceText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < minWords) return false;
  if (/^(isso|isto|esse|essa)\s+(enfraquece|prejudica|quebra)\b/.test(normalized) && words.length < minWords + 5) {
    return false;
  }
  return true;
}
