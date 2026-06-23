export type ContinuityMemory = {
  id: string;
  chapterId: number;
  chapterTitle: string;
  summary: string;
  stateChanges: string[];
  canonicalFacts: string[];
  openLoops: string[];
  impactedCharacters: string[];
  isActive: boolean;
  updatedAt: string;
};

export function createContinuityMemoryId(chapterId: number) {
  return `chapter-${chapterId}`;
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeMemory(item: any): ContinuityMemory | null {
  if (!item || typeof item !== "object") return null;
  const chapterId = typeof item.chapterId === "number" ? item.chapterId : Number(item.chapterId);
  const chapterTitle = typeof item.chapterTitle === "string" ? item.chapterTitle.trim() : "";
  const summary = typeof item.summary === "string" ? item.summary.trim() : "";
  if (!Number.isFinite(chapterId) || !chapterTitle || !summary) return null;

  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id : createContinuityMemoryId(chapterId),
    chapterId,
    chapterTitle,
    summary,
    stateChanges: cleanStringArray(item.stateChanges),
    canonicalFacts: cleanStringArray(item.canonicalFacts),
    openLoops: cleanStringArray(item.openLoops),
    impactedCharacters: cleanStringArray(item.impactedCharacters),
    isActive: item.isActive !== false,
    updatedAt: typeof item.updatedAt === "string" && item.updatedAt.trim() ? item.updatedAt : new Date().toISOString(),
  };
}

export function parseContinuityMemories(raw: string | null | undefined): ContinuityMemory[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeMemory(item)).filter(Boolean) as ContinuityMemory[];
  } catch {
    return [];
  }
}

export function serializeContinuityMemories(memories: ContinuityMemory[]) {
  return memories;
}

export function upsertContinuityMemory(memories: ContinuityMemory[], nextItem: ContinuityMemory) {
  const filtered = memories.filter((item) => item.chapterId !== nextItem.chapterId);
  return [...filtered, nextItem].sort((a, b) => a.chapterId - b.chapterId);
}

export function getContinuityMemoryByChapter(memories: ContinuityMemory[], chapterId: number | null | undefined) {
  if (!chapterId) return null;
  return memories.find((item) => item.chapterId === chapterId) || null;
}

export function selectRelevantContinuityMemories(
  memories: ContinuityMemory[],
  options?: {
    characterNames?: string[];
    excludeChapterId?: number | null;
    limit?: number;
  },
) {
  const { characterNames = [], excludeChapterId = null, limit = 8 } = options || {};
  const active = memories
    .filter((item) => item.isActive && item.chapterId !== excludeChapterId)
    .sort((a, b) => a.chapterId - b.chapterId);

  const normalizedNames = characterNames.map((name) => name.trim().toLowerCase()).filter(Boolean);

  const relevantByCharacter = normalizedNames.length
    ? active.filter((item) =>
        item.impactedCharacters.some((name) => normalizedNames.includes(name.trim().toLowerCase())),
      )
    : [];

  const recent = active.slice(-Math.min(limit, 5));
  const combined = [...relevantByCharacter, ...recent];
  const seen = new Set<string>();

  return combined.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(-limit);
}

export function formatContinuityMemory(memory: ContinuityMemory) {
  return [
    `Capítulo ${memory.chapterId}: ${memory.chapterTitle}`,
    `Resumo: ${memory.summary}`,
    memory.stateChanges.length ? `Mudanças de estado:\n- ${memory.stateChanges.join("\n- ")}` : "",
    memory.canonicalFacts.length ? `Fatos canônicos:\n- ${memory.canonicalFacts.join("\n- ")}` : "",
    memory.openLoops.length ? `Pontas em aberto:\n- ${memory.openLoops.join("\n- ")}` : "",
    memory.impactedCharacters.length ? `Personagens impactados: ${memory.impactedCharacters.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
