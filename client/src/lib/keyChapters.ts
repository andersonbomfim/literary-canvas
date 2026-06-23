export type ExistingKeyChapterItem = {
  chapterId: number;
  title: string;
  notes?: string;
  sourceType: "existing";
};

export type StoredCustomKeyChapterItem = {
  id: string;
  title: string;
  content: string;
  summary?: string;
  summarySections?: ReferenceSummarySection[];
  analysisBlocks?: ReferenceAnalysisBlock[];
  continuitySnippet?: string;
  importedCharacterIds?: number[];
  importedTimelineEvents?: ImportedTimelineEvent[];
  summaryStatus?: "pending" | "done" | "error";
  notes?: string;
  fileName?: string;
  sourceType: "manual" | "upload";
  isActive: boolean;
};

export type StoredKeyChapterItem =
  | ExistingKeyChapterItem
  | StoredCustomKeyChapterItem;

export type LinkedChapterReference = {
  chapterId: number;
  title: string;
};

export type ReferenceSummarySection = {
  id: string;
  label: string;
  content: string;
};

export type ReferenceAnalysisBlock = {
  index: number;
  title: string;
  wordCount: number;
  dossier: string;
  sourceAnchors?: string[];
  part?: number;
  totalParts?: number;
};

export type ImportedTimelineEvent = {
  order: number;
  period: string;
  title: string;
  description: string;
  source?: string;
  confidence?: "high" | "medium" | "low";
};

export type CustomReferenceChapter = {
  id: string;
  title: string;
  content: string;
  summary?: string;
  summarySections?: ReferenceSummarySection[];
  analysisBlocks?: ReferenceAnalysisBlock[];
  continuitySnippet?: string;
  importedCharacterIds?: number[];
  importedTimelineEvents?: ImportedTimelineEvent[];
  summaryStatus?: "pending" | "done" | "error";
  notes?: string;
  fileName?: string;
  sourceType: "manual" | "upload";
  isActive: boolean;
};

export type KeyChaptersState = {
  linkedChapters: LinkedChapterReference[];
  customReferences: CustomReferenceChapter[];
};

export const emptyKeyChaptersState: KeyChaptersState = {
  linkedChapters: [],
  customReferences: [],
};

function createReferenceId(seed = "") {
  if (seed) {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }
    return `ref-${hash.toString(36)}`;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSummarySections(
  value: unknown
): ReferenceSummarySection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sections = value
    .map(item => {
      if (!item || typeof item !== "object") return null;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const content =
        typeof item.content === "string" ? item.content.trim() : "";
      if (!id || !label || !content) return null;
      return { id, label, content };
    })
    .filter(Boolean) as ReferenceSummarySection[];

  return sections.length ? sections : undefined;
}

function normalizeAnalysisBlocks(value: unknown): ReferenceAnalysisBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      const dossier =
        typeof raw.dossier === "string" ? raw.dossier.trim() : "";
      if (!title || !dossier) return null;
      const blockIndex =
        typeof raw.index === "number" && Number.isFinite(raw.index)
          ? raw.index
          : index + 1;
      const wordCount =
        typeof raw.wordCount === "number" && Number.isFinite(raw.wordCount)
          ? raw.wordCount
          : dossier.split(/\s+/).filter(Boolean).length;
      const part =
        typeof raw.part === "number" && Number.isFinite(raw.part)
          ? raw.part
          : undefined;
      const totalParts =
        typeof raw.totalParts === "number" && Number.isFinite(raw.totalParts)
          ? raw.totalParts
          : undefined;
      const sourceAnchors = Array.isArray(raw.sourceAnchors)
        ? raw.sourceAnchors
            .filter(item => typeof item === "string" && item.trim())
            .map(item => item.trim())
        : undefined;
      return {
        index: blockIndex,
        title,
        wordCount,
        dossier,
        sourceAnchors,
        part,
        totalParts,
      };
    })
    .filter(Boolean) as ReferenceAnalysisBlock[];

  return blocks.sort((a, b) => a.index - b.index);
}

function normalizeCharacterIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter(
    item => typeof item === "number" && Number.isFinite(item)
  );
  return ids.length ? ids : undefined;
}

function normalizeTimelineEvents(value: unknown): ImportedTimelineEvent[] {
  if (!Array.isArray(value)) return [];
  const events = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      const description =
        typeof raw.description === "string" ? raw.description.trim() : "";
      if (!title || !description) return null;
      const order =
        typeof raw.order === "number" && Number.isFinite(raw.order)
          ? raw.order
          : index + 1;
      const period =
        typeof raw.period === "string" && raw.period.trim()
          ? raw.period.trim()
          : "Ordem narrativa";
      const confidence =
        raw.confidence === "high" ||
        raw.confidence === "medium" ||
        raw.confidence === "low"
          ? raw.confidence
          : undefined;
      return {
        order,
        period,
        title,
        description,
        source: typeof raw.source === "string" ? raw.source.trim() : undefined,
        confidence,
      };
    })
    .filter(Boolean) as ImportedTimelineEvent[];

  return events.sort((a, b) => a.order - b.order);
}

function normalizeCustomReference(item: any): CustomReferenceChapter | null {
  if (!item || typeof item !== "object") return null;
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!title || !content) return null;
  const sourceType = item.sourceType === "upload" ? "upload" : "manual";
  const fileName = typeof item.fileName === "string" ? item.fileName : "";
  const fallbackIdSeed = `${sourceType}:${title}:${fileName}:${content.length}:${content.slice(0, 300)}`;
  return {
    id:
      typeof item.id === "string" && item.id.trim()
        ? item.id
        : createReferenceId(fallbackIdSeed),
    title,
    content,
    summary: typeof item.summary === "string" ? item.summary : "",
    summarySections: normalizeSummarySections(item.summarySections) ?? [],
    analysisBlocks: normalizeAnalysisBlocks(item.analysisBlocks),
    continuitySnippet:
      typeof item.continuitySnippet === "string" ? item.continuitySnippet : "",
    importedCharacterIds:
      normalizeCharacterIds(item.importedCharacterIds) ?? [],
    importedTimelineEvents: normalizeTimelineEvents(item.importedTimelineEvents),
    summaryStatus:
      item.summaryStatus === "done" ||
      item.summaryStatus === "pending" ||
      item.summaryStatus === "error"
        ? item.summaryStatus
        : undefined,
    notes: typeof item.notes === "string" ? item.notes : "",
    fileName,
    sourceType,
    isActive: item.isActive !== false,
  };
}

function normalizeLinkedChapter(item: any): LinkedChapterReference | null {
  if (!item || typeof item !== "object") return null;
  const chapterId =
    typeof item.chapterId === "number" && Number.isFinite(item.chapterId)
      ? item.chapterId
      : null;
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (chapterId == null || !title) return null;
  return { chapterId, title };
}

export function parseKeyChapters(
  raw: string | null | undefined
): KeyChaptersState {
  if (!raw) return emptyKeyChaptersState;

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      if (parsed.every(item => typeof item === "number")) {
        return {
          linkedChapters: parsed
            .filter(item => Number.isFinite(item))
            .map(chapterId => ({ chapterId, title: `Capítulo #${chapterId}` })),
          customReferences: [],
        };
      }

      const linkedChapters = parsed
        .filter(item => {
          if (!item || typeof item !== "object") return false;
          if (item.sourceType === "existing") return true;
          return (
            typeof item.chapterId === "number" &&
            typeof item.content !== "string"
          );
        })
        .map(item => normalizeLinkedChapter(item))
        .filter(Boolean) as LinkedChapterReference[];

      const customReferences = parsed
        .filter(item => item.sourceType !== "existing")
        .map(item => normalizeCustomReference(item))
        .filter(Boolean) as CustomReferenceChapter[];

      return { linkedChapters, customReferences };
    }

    if (parsed && typeof parsed === "object") {
      const linkedChapters = Array.isArray(parsed.linkedChapters)
        ? parsed.linkedChapters
            .map((item: any) => normalizeLinkedChapter(item))
            .filter(Boolean)
        : Array.isArray(parsed.linkedChapterIds)
          ? parsed.linkedChapterIds
              .filter((item: any) => typeof item === "number")
              .map((chapterId: number) => ({
                chapterId,
                title: `Capítulo #${chapterId}`,
              }))
          : [];
      const customReferences = Array.isArray(parsed.customReferences)
        ? parsed.customReferences
            .map((item: any) => normalizeCustomReference(item))
            .filter(Boolean)
        : [];
      return {
        linkedChapters: linkedChapters as LinkedChapterReference[],
        customReferences: customReferences as CustomReferenceChapter[],
      };
    }
  } catch {
    return emptyKeyChaptersState;
  }

  return emptyKeyChaptersState;
}

export function serializeKeyChapters(
  state: KeyChaptersState
): StoredKeyChapterItem[] {
  const linked = state.linkedChapters.map(item => ({
    chapterId: item.chapterId,
    title: item.title,
    sourceType: "existing" as const,
  }));

  const custom = state.customReferences.map(item => ({
    id: item.id,
    title: item.title,
    content: item.content,
    summary: item.summary || undefined,
    summarySections: item.summarySections?.length
      ? item.summarySections
      : undefined,
    analysisBlocks: item.analysisBlocks?.length ? item.analysisBlocks : undefined,
    continuitySnippet: item.continuitySnippet || undefined,
    importedCharacterIds: item.importedCharacterIds?.length
      ? item.importedCharacterIds
      : undefined,
    importedTimelineEvents: item.importedTimelineEvents?.length
      ? item.importedTimelineEvents
      : undefined,
    summaryStatus: item.summaryStatus || undefined,
    notes: item.notes || "",
    fileName: item.fileName || "",
    sourceType: item.sourceType,
    isActive: item.isActive,
  }));

  return [...linked, ...custom];
}

function clipReferenceText(value: string, maxChars: number) {
  const text = value.trim();
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(" ", maxChars);
  return text.slice(0, cut > maxChars * 0.8 ? cut : maxChars).trim();
}

function buildCustomReferenceContextContent(item: CustomReferenceChapter) {
  const blocks = item.analysisBlocks ?? [];
  if (!blocks.length) return item.summary || item.content;

  const blockMemory = blocks
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(block =>
      [
        `[Bloco ${block.index}] ${block.title}`,
        block.sourceAnchors?.length
          ? `Âncoras literais: ${block.sourceAnchors.join(", ")}`
          : "",
        block.dossier,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n---\n\n");
  const summary = item.summary?.trim()
    ? `Resumo estrutural da obra importada:\n${clipReferenceText(item.summary, 6000)}`
    : "";

  return [
    `Dossiês preservados por capítulo/bloco da importação:\n${clipReferenceText(blockMemory, 18000)}`,
    summary,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildReferenceContextsFromState(
  state: KeyChaptersState,
  chapters:
    | Array<{ id: number; title: string; content: string }>
    | undefined
    | null
) {
  const linked = (chapters || [])
    .filter(chapter =>
      state.linkedChapters.some(item => item.chapterId === chapter.id)
    )
    .map(chapter => ({
      title: chapter.title,
      content: chapter.content,
      notes: "Capítulo-chave existente selecionado no perfil.",
      sourceType: "existing" as const,
    }));

  const custom = state.customReferences
    .filter(
      item =>
        item.isActive &&
        item.title.trim() &&
        (item.content.trim() || (item.summary ?? "").trim())
    )
    .map(item => ({
      title: item.title,
      content: buildCustomReferenceContextContent(item),
      notes: item.notes,
      sourceType: item.sourceType,
      fileName: item.fileName,
    }));

  return [...linked, ...custom];
}

export function buildContinuityFoundationFromState(
  state: KeyChaptersState,
  manualFoundation: string | null
) {
  const autoFoundationBlocks = state.customReferences
    .filter(item => item.isActive && (item.continuitySnippet ?? "").trim())
    .map(item => item.continuitySnippet!.trim());

  return [(manualFoundation ?? "").trim(), ...autoFoundationBlocks]
    .filter(Boolean)
    .join("\n\n----------------\n\n");
}
