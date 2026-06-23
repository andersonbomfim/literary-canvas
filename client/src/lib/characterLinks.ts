export type CharacterLinkValue = string | number;

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

export function parseCharacterLinks(
  raw: string | null | undefined
): CharacterLinkValue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      item => typeof item === "string" || typeof item === "number"
    );
  } catch {
    return [];
  }
}

export function resolveCharacterIds<T extends { id: number; name: string }>(
  raw: string | null | undefined,
  characters: T[]
): number[] {
  const links = parseCharacterLinks(raw);
  const ids = links
    .map(item => {
      if (typeof item === "number") return item;
      const found = characters?.find(
        character => normalizeName(character.name) === normalizeName(item)
      );
      return found?.id ?? null;
    })
    .filter(
      (item): item is number =>
        typeof item === "number" && Number.isFinite(item)
    );

  return Array.from(new Set(ids));
}

export function buildCharacterLinkPayload(characterIds: number[]) {
  return Array.from(new Set(characterIds.filter(id => Number.isFinite(id))));
}
