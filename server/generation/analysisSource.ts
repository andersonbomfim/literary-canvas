import { ENV } from "../_core/env";
import {
  getOrCreateAuthorProfile,
  getUserChapters,
} from "../db";

/**
 * Tamanho máximo (em palavras) de cada "capítulo sintético" derivado de
 * uma referência longa. Padrão: 5000 palavras por chunk — obras de 100k
 * palavras viram 20 chunks. Configurável via `ANALYSIS_CHUNK_WORDS`.
 *
 * Por que 5k: deixa cada extração com ~7.5k tokens de input + prompt
 * envolvente (~2k) + output JSON estruturado (~3k) = ~12.5k tokens, bem
 * abaixo do contexto 64k do DeepSeek-chat. Resultado: chamadas estáveis
 * e previsíveis, sem risco de cortar saída.
 */
function maxWordsPerSyntheticChapter(): number {
  return ENV.analysisChunkWords;
}

/**
 * Quebra um texto longo em pedaços de no máximo `maxWords`, preferindo
 * cortar em quebras de parágrafo pra preservar contexto narrativo.
 */
function splitTextByWords(text: string, maxWords: number): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buffer: string[] = [];
  let bufferWords = 0;
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const paraWords = trimmed.split(/\s+/).filter(Boolean).length;
    if (bufferWords + paraWords > maxWords && buffer.length) {
      chunks.push(buffer.join("\n\n"));
      buffer = [];
      bufferWords = 0;
    }
    // Se um único parágrafo já excede o limite, divide por palavras.
    if (paraWords > maxWords) {
      const words = trimmed.split(/\s+/);
      for (let i = 0; i < words.length; i += maxWords) {
        chunks.push(words.slice(i, i + maxWords).join(" "));
      }
      continue;
    }
    buffer.push(trimmed);
    bufferWords += paraWords;
  }
  if (buffer.length) chunks.push(buffer.join("\n\n"));
  return chunks.length ? chunks : [text.trim()];
}

/**
 * Fonte unificada de texto da obra para análises (Auditoria e Melhorias).
 *
 * Por que existe: uma obra pode ter conteúdo em DOIS lugares:
 *   - `chapters` (capítulos gerados via aba Escrita)
 *   - `authorProfile.keyChapters.customReferences` (uploads integrais
 *     feitos pelo onboarding — quando o autor sobe o livro inteiro como
 *     referência antes de fragmentar em capítulos)
 *
 * As análises só liam `chapters` e ignoravam o conteúdo de referências,
 * resultando em "Sua obra ainda não tem capítulos" mesmo com um livro de
 * 70k palavras importado. Este helper junta os dois para que o motor de
 * análise enxergue tudo que existe.
 */

export type AnalysisChapter = {
  /** Posição cronológica (1, 2, 3...). */
  index: number;
  /** Id interno se vier de `chapters`; sintetizado se vier de referência. */
  chapterId: number;
  title: string;
  content: string;
  /** "chapter" se veio da tabela chapters; "reference" se veio do upload integral. */
  source: "chapter" | "reference";
};

export type AnalysisCoverageDossier = {
  key: string;
  index: number;
  title: string;
  wordCount: number;
};

export type AnalysisCoverageItem = {
  index: number;
  chapterId: number;
  title: string;
  source: "chapter" | "reference";
  wordCount: number;
  dossierCount: number;
  dossiers: AnalysisCoverageDossier[];
};

export type AnalysisCoverage = {
  totalWords: number;
  totalItems: number;
  chapterCount: number;
  referencePartCount: number;
  dossierCount: number;
  items: AnalysisCoverageItem[];
  dossiers: AnalysisCoverageDossier[];
};

type Reference = {
  id: string;
  title: string;
  content: string;
  isActive?: boolean;
};

function analysisBlocksToContent(value: unknown) {
  if (!Array.isArray(value)) return "";
  const blocks = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      const title =
        typeof record.title === "string" && record.title.trim()
          ? record.title.trim()
          : `Bloco ${index + 1}`;
      const dossier =
        typeof record.dossier === "string" ? record.dossier.trim() : "";
      if (!dossier) return "";
      const anchors = Array.isArray(record.sourceAnchors)
        ? record.sourceAnchors
            .filter(item => typeof item === "string" && item.trim())
            .join(", ")
        : "";
      const blockIndex =
        typeof record.index === "number" && Number.isFinite(record.index)
          ? record.index
          : index + 1;
      return [
        `[Bloco ${blockIndex}] ${title}`,
        anchors ? `Âncoras literais: ${anchors}` : "",
        dossier,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean);

  return blocks.join("\n\n---\n\n");
}

function parseCustomReferences(raw: string | null | undefined): Reference[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    // Formato antigo: array bruto de itens. Formato novo: { customReferences, linkedChapters }.
    const candidates: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.customReferences)
      ? parsed.customReferences
      : [];
    const refs: Reference[] = [];
    let counter = 1;
    for (const item of candidates) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const analysisContent = analysisBlocksToContent(obj.analysisBlocks);
      const content =
        analysisContent ||
        (typeof obj.content === "string" ? obj.content.trim() : "");
      if (!content) continue;
      const isActive = obj.isActive === false ? false : true; // default true se omitido
      if (!isActive) continue;
      refs.push({
        id: typeof obj.id === "string" ? obj.id : `ref-${counter}`,
        title: typeof obj.title === "string" && obj.title.trim() ? obj.title : `Referência ${counter}`,
        content,
        isActive,
      });
      counter += 1;
    }
    return refs;
  } catch {
    return [];
  }
}

function syntheticChapterIdForReference(referenceId: string): number {
  // Hash determinístico do referenceId pra dar um número estável > 1_000_000
  // (sem colidir com IDs reais de capítulos no banco). 32-bit FNV-1a simples.
  let hash = 0x811c9dc5;
  for (let i = 0; i < referenceId.length; i += 1) {
    hash ^= referenceId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 1_000_000 + (Math.abs(hash) % 9_000_000);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractDossierCoverage(content: string): AnalysisCoverageDossier[] {
  const matches = Array.from(
    content.matchAll(/(?:^|\n)\[Bloco\s+(\d+)\]\s+([^\n]+)/g)
  );
  if (!matches.length) return [];

  return matches.map((match, idx) => {
    const parsedIndex = Number(match[1]);
    const index = Number.isFinite(parsedIndex) && parsedIndex > 0 ? parsedIndex : idx + 1;
    const title = (match[2] || `Dossie ${index}`).trim();
    const start = match.index ?? 0;
    const nextStart = matches[idx + 1]?.index ?? content.length;
    return {
      key: `${index}:${title}`,
      index,
      title,
      wordCount: countWords(content.slice(start, nextStart)),
    };
  });
}

export function buildAnalysisCoverage(items: AnalysisChapter[]): AnalysisCoverage {
  const uniqueDossiers = new Map<string, AnalysisCoverageDossier>();
  const coverageItems = items.map((item): AnalysisCoverageItem => {
    const dossiers = item.source === "reference" ? extractDossierCoverage(item.content) : [];
    for (const dossier of dossiers) {
      const existing = uniqueDossiers.get(dossier.key);
      if (existing) {
        existing.wordCount += dossier.wordCount;
      } else {
        uniqueDossiers.set(dossier.key, { ...dossier });
      }
    }

    return {
      index: item.index,
      chapterId: item.chapterId,
      title: item.title,
      source: item.source,
      wordCount: countWords(item.content),
      dossierCount: dossiers.length,
      dossiers,
    };
  });

  const dossiers = Array.from(uniqueDossiers.values()).sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return a.title.localeCompare(b.title, "pt-BR");
  });

  return {
    totalWords: coverageItems.reduce((sum, item) => sum + item.wordCount, 0),
    totalItems: coverageItems.length,
    chapterCount: coverageItems.filter((item) => item.source === "chapter").length,
    referencePartCount: coverageItems.filter((item) => item.source === "reference").length,
    dossierCount: dossiers.length || coverageItems.filter((item) => item.source === "reference").length,
    items: coverageItems,
    dossiers,
  };
}

/**
 * Carrega o material de análise pra uma obra.
 *
 * Estratégia:
 *  1. Carrega `chapters` reais preenchidos.
 *  2. Carrega também `authorProfile.keyChapters.customReferences` ativas
 *     como "AnalysisChapter" sintéticas.
 *  3. Se nem chapters nem references têm conteúdo, devolve [].
 */
export async function loadAnalysisChapters(args: {
  userId: number;
  workId: number;
}): Promise<AnalysisChapter[]> {
  const realChapters = await getUserChapters(args.userId, args.workId, { limit: 500 });
  const filled = realChapters.filter((c) => (c.content || "").trim().length > 0);
  const synthetic: AnalysisChapter[] = [];
  let nextIndex = 1;

  if (filled.length > 0) {
    const ordered = [...filled].sort((a, b) => {
      const an = a.chapterNumber ?? Number.MAX_SAFE_INTEGER;
      const bn = b.chapterNumber ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      const ad = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const bd = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return ad - bd;
    });
    for (let idx = 0; idx < ordered.length; idx += 1) {
      const chapter = ordered[idx];
      const index = chapter.chapterNumber ?? nextIndex + idx;
      synthetic.push({
        index,
        chapterId: chapter.id,
        title: chapter.title,
        content: chapter.content,
        source: "chapter",
      });
      nextIndex = Math.max(nextIndex, index + 1);
    }
  }

  // Também carrega referências importadas ativas; elas fazem parte da fonte
  // oficial da análise junto dos capítulos reais.
  const profile = await getOrCreateAuthorProfile(args.userId, args.workId);
  const references = parseCustomReferences(profile?.keyChapters);
  if (!references.length) return synthetic;

  // Refs longas precisam ser splitadas pra caber no contexto do modelo
  // (DeepSeek ~60k tokens, Gemini ~128k). Sem isso, uma obra de 72k palavras
  // em uma única referência manda 108k tokens ao modelo e falha silencioso.
  const maxWords = maxWordsPerSyntheticChapter();
  for (const ref of references) {
    const refWords = ref.content.trim().split(/\s+/).filter(Boolean).length;
    if (refWords <= maxWords) {
      synthetic.push({
        index: nextIndex++,
        chapterId: syntheticChapterIdForReference(ref.id),
        title: ref.title,
        content: ref.content,
        source: "reference",
      });
      continue;
    }
    // Split em parágrafos.
    const parts = splitTextByWords(ref.content, maxWords);
    parts.forEach((part, partIdx) => {
      synthetic.push({
        index: nextIndex++,
        chapterId: syntheticChapterIdForReference(`${ref.id}#${partIdx + 1}`),
        title: parts.length > 1
          ? `${ref.title} — parte ${partIdx + 1}/${parts.length}`
          : ref.title,
        content: part,
        source: "reference",
      });
    });
  }
  return synthetic;
}

/**
 * Calcula o total de palavras analisáveis da obra. Usado pra estimar a
 * cobrança ANTES de criar o job (createAuditJob/createImprovementsJob).
 */
export async function countAnalysisWords(args: {
  userId: number;
  workId: number;
}): Promise<number> {
  const items = await loadAnalysisChapters(args);
  return items.reduce((sum, item) => sum + countWords(item.content), 0);
}

export async function getAnalysisCoverage(args: {
  userId: number;
  workId: number;
}): Promise<AnalysisCoverage> {
  const items = await loadAnalysisChapters(args);
  return buildAnalysisCoverage(items);
}
