export type UniverseProfileState = {
  overview: string;
  genre: string;
  timePeriod: string;
  locations: string;
  narrativeStructure: string;
  pov: string;
  chapterStructure: string;
  lore: string;
  powerRules: string;
  factions: string;
  timeline: string;
  socialRules: string;
  themesTone: string;
  continuityConstraints: string;
  openQuestions: string;
  notes: string;
};

export const emptyUniverseProfile: UniverseProfileState = {
  overview: "",
  genre: "",
  timePeriod: "",
  locations: "",
  narrativeStructure: "",
  pov: "",
  chapterStructure: "",
  lore: "",
  powerRules: "",
  factions: "",
  timeline: "",
  socialRules: "",
  themesTone: "",
  continuityConstraints: "",
  openQuestions: "",
  notes: "",
};

const labels: Record<keyof UniverseProfileState, string> = {
  overview: "Visão geral",
  genre: "Gênero",
  timePeriod: "Período e ano",
  locations: "Lugares",
  narrativeStructure: "Estrutura narrativa",
  pov: "POV e foco narrativo",
  chapterStructure: "Estrutura de capítulos",
  lore: "Lore do universo",
  powerRules: "Regras de poder",
  factions: "Facções e instituições",
  timeline: "Cronologia",
  socialRules: "Regras sociais",
  themesTone: "Temas e tom",
  continuityConstraints: "Restrições de continuidade",
  openQuestions: "Pontas em aberto",
  notes: "Notas manuais",
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseUniverseProfile(
  raw: string | null | undefined
): UniverseProfileState {
  if (!raw) return emptyUniverseProfile;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        ...emptyUniverseProfile,
        continuityConstraints: parsed
          .filter(item => typeof item === "string" && item.trim())
          .join("\n"),
      };
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.type === "universe-profile"
    ) {
      const data =
        parsed.data && typeof parsed.data === "object" ? parsed.data : {};
      return {
        overview: normalizeText(data.overview),
        genre: normalizeText(data.genre),
        timePeriod: normalizeText(data.timePeriod),
        locations: normalizeText(data.locations),
        narrativeStructure: normalizeText(data.narrativeStructure),
        pov: normalizeText(data.pov),
        chapterStructure: normalizeText(data.chapterStructure),
        lore: normalizeText(data.lore),
        powerRules: normalizeText(data.powerRules),
        factions: normalizeText(data.factions),
        timeline: normalizeText(data.timeline),
        socialRules: normalizeText(data.socialRules),
        themesTone: normalizeText(data.themesTone),
        continuityConstraints: normalizeText(data.continuityConstraints),
        openQuestions: normalizeText(data.openQuestions),
        notes: normalizeText(data.notes),
      };
    }
  } catch {
    return emptyUniverseProfile;
  }

  return emptyUniverseProfile;
}

export function serializeUniverseProfile(profile: UniverseProfileState) {
  return {
    type: "universe-profile" as const,
    data: profile,
  };
}

export function buildUniverseContext(profile: UniverseProfileState) {
  return (
    Object.entries(profile) as Array<[keyof UniverseProfileState, string]>
  )
    .map(([key, value]) => {
      const text = value.trim();
      return text ? `${labels[key]}\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}
