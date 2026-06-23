export type StyleAnalysis = {
  essence: string;
  pointOfView: string;
  narrativeDistance: string;
  sentenceRhythm: string;
  paragraphRhythm: string;
  diction: string;
  imagery: string;
  sensoryDetail: string;
  dialogue: string;
  introspection: string;
  pacing: string;
  tension: string;
  transitions: string;
  emotionalLogic: string;
  doRules: string[];
  avoidRules: string[];
  writingChecklist: string[];
};

export type StyleReferenceSample = {
  id: string;
  title: string;
  content: string;
  notes: string;
  fileName: string;
  isActive: boolean;
  createdAt: string;
  analysis: StyleAnalysis | null;
};

export type StyleProfileState = {
  notes: string;
  samples: StyleReferenceSample[];
};

export const emptyStyleProfile: StyleProfileState = {
  notes: "",
  samples: [],
};

const STYLE_PROFILE_TYPE = "literary-canvas-style-profile";
const MAX_STYLE_SAMPLE_CHARS = 12000;
const MAX_STYLE_SAMPLES_IN_PROMPT = 6;

function createStableSampleId(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return `style-${hash.toString(36)}`;
}

export function createStyleSample(input: {
  title: string;
  content: string;
  notes?: string;
  fileName?: string;
  analysis?: StyleAnalysis | null;
}): StyleReferenceSample {
  const title = input.title.trim();
  const content = input.content.trim();
  const fileName = input.fileName?.trim() || "";
  const createdAt = new Date().toISOString();

  return {
    id: `${createStableSampleId(`${title}:${fileName}:${content.length}:${content.slice(0, 300)}`)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    content,
    notes: input.notes?.trim() || "",
    fileName,
    isActive: true,
    createdAt,
    analysis: input.analysis ?? null,
  };
}

function normalizeStringArray(value: any): string[] {
  return Array.isArray(value)
    ? value
        .map(item => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
}

function normalizeAnalysis(value: any): StyleAnalysis | null {
  if (!value || typeof value !== "object") return null;
  return {
    essence: typeof value.essence === "string" ? value.essence.trim() : "",
    pointOfView:
      typeof value.pointOfView === "string" ? value.pointOfView.trim() : "",
    narrativeDistance:
      typeof value.narrativeDistance === "string"
        ? value.narrativeDistance.trim()
        : "",
    sentenceRhythm:
      typeof value.sentenceRhythm === "string"
        ? value.sentenceRhythm.trim()
        : "",
    paragraphRhythm:
      typeof value.paragraphRhythm === "string"
        ? value.paragraphRhythm.trim()
        : "",
    diction: typeof value.diction === "string" ? value.diction.trim() : "",
    imagery: typeof value.imagery === "string" ? value.imagery.trim() : "",
    sensoryDetail:
      typeof value.sensoryDetail === "string" ? value.sensoryDetail.trim() : "",
    dialogue: typeof value.dialogue === "string" ? value.dialogue.trim() : "",
    introspection:
      typeof value.introspection === "string" ? value.introspection.trim() : "",
    pacing: typeof value.pacing === "string" ? value.pacing.trim() : "",
    tension: typeof value.tension === "string" ? value.tension.trim() : "",
    transitions:
      typeof value.transitions === "string" ? value.transitions.trim() : "",
    emotionalLogic:
      typeof value.emotionalLogic === "string"
        ? value.emotionalLogic.trim()
        : "",
    doRules: normalizeStringArray(value.doRules),
    avoidRules: normalizeStringArray(value.avoidRules),
    writingChecklist: normalizeStringArray(value.writingChecklist),
  };
}

function normalizeSample(item: any): StyleReferenceSample | null {
  if (!item || typeof item !== "object") return null;
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!title || !content) return null;

  const fileName =
    typeof item.fileName === "string" ? item.fileName.trim() : "";
  const id =
    typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : createStableSampleId(
          `${title}:${fileName}:${content.length}:${content.slice(0, 300)}`
        );

  return {
    id,
    title,
    content,
    notes: typeof item.notes === "string" ? item.notes.trim() : "",
    fileName,
    isActive: item.isActive !== false,
    createdAt:
      typeof item.createdAt === "string" && item.createdAt.trim()
        ? item.createdAt
        : new Date().toISOString(),
    analysis: normalizeAnalysis(item.analysis),
  };
}

export function parseStyleProfile(
  raw: string | null | undefined
): StyleProfileState {
  const rawText = raw?.trim() ?? "";
  if (!rawText) return emptyStyleProfile;

  try {
    const parsed = JSON.parse(rawText);

    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.type === STYLE_PROFILE_TYPE
    ) {
      return {
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
        samples: Array.isArray(parsed.samples)
          ? (parsed.samples
              .map((item: any) => normalizeSample(item))
              .filter(Boolean) as StyleReferenceSample[])
          : [],
      };
    }
  } catch {
    // Legacy plain text is handled below.
  }

  return {
    notes: rawText,
    samples: [],
  };
}

export function serializeStyleProfile(state: StyleProfileState) {
  return JSON.stringify({
    type: STYLE_PROFILE_TYPE,
    version: 1,
    notes: state.notes,
    samples: state.samples.map(sample => ({
      id: sample.id,
      title: sample.title,
      content: sample.content,
      notes: sample.notes || "",
      fileName: sample.fileName || "",
      isActive: sample.isActive,
      createdAt: sample.createdAt,
      analysis: sample.analysis || null,
    })),
  });
}

function sampleExcerpt(content: string) {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_STYLE_SAMPLE_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_STYLE_SAMPLE_CHARS).trim()}\n\n[amostra truncada para caber no contexto]`;
}

function formatStyleAnalysis(analysis: StyleAnalysis) {
  const lines = [
    analysis.essence ? `Essência: ${analysis.essence}` : "",
    analysis.pointOfView ? `POV e foco: ${analysis.pointOfView}` : "",
    analysis.narrativeDistance
      ? `Distancia narrativa: ${analysis.narrativeDistance}`
      : "",
    analysis.sentenceRhythm ? `Ritmo de frase: ${analysis.sentenceRhythm}` : "",
    analysis.paragraphRhythm
      ? `Ritmo de parágrafo: ${analysis.paragraphRhythm}`
      : "",
    analysis.diction ? `Dicção e vocabulário: ${analysis.diction}` : "",
    analysis.imagery ? `Imagem e atmosfera: ${analysis.imagery}` : "",
    analysis.sensoryDetail
      ? `Detalhe sensorial: ${analysis.sensoryDetail}`
      : "",
    analysis.dialogue ? `Diálogo: ${analysis.dialogue}` : "",
    analysis.introspection ? `Introspecção: ${analysis.introspection}` : "",
    analysis.pacing ? `Ritmo narrativo: ${analysis.pacing}` : "",
    analysis.tension ? `Tensão: ${analysis.tension}` : "",
    analysis.transitions ? `Transições: ${analysis.transitions}` : "",
    analysis.emotionalLogic
      ? `Lógica emocional: ${analysis.emotionalLogic}`
      : "",
    analysis.doRules.length
      ? `Regras a seguir:\n${analysis.doRules.map(item => `- ${item}`).join("\n")}`
      : "",
    analysis.avoidRules.length
      ? `Evitar:\n${analysis.avoidRules.map(item => `- ${item}`).join("\n")}`
      : "",
    analysis.writingChecklist.length
      ? `Checklist antes de finalizar:\n${analysis.writingChecklist.map(item => `- ${item}`).join("\n")}`
      : "",
  ].filter(Boolean);

  return lines.join("\n");
}

export function buildAuthorStyleFromProfile(state: StyleProfileState) {
  const activeSamples = state.samples.filter(
    sample => sample.isActive && sample.content.trim()
  );

  if (!state.notes.trim() && !activeSamples.length) return "";

  const analyzedBlocks = activeSamples
    .filter(sample => sample.analysis)
    .slice(0, MAX_STYLE_SAMPLES_IN_PROMPT)
    .map((sample, index) => {
      return [
        `Essência absorvida ${index + 1}: ${sample.title}`,
        sample.fileName ? `Arquivo: ${sample.fileName}` : "",
        sample.notes ? `Observação do autor: ${sample.notes}` : "",
        sample.analysis ? formatStyleAnalysis(sample.analysis) : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

  const unanalyzedBlocks = activeSamples
    .filter(sample => !sample.analysis)
    .slice(0, 2)
    .map((sample, index) => {
      return [
        `Amostra bruta sem essência absorvida ${index + 1}: ${sample.title}`,
        sample.fileName ? `Arquivo: ${sample.fileName}` : "",
        sample.notes ? `Observação do autor: ${sample.notes}` : "",
        "Use apenas como apoio técnico temporário; não copie conteúdo:",
        sampleExcerpt(sample.content),
      ]
        .filter(Boolean)
        .join("\n");
    });

  return [
    "CONTRATO DE ESTILO AUTORAL",
    "A aba Estilo foi usada para absorver essência de escrita. Use a ficha técnica abaixo como regra principal de escrita.",
    "Não trate as amostras como história nem como prompt livre. A Escrita deve aplicar técnica: foco, cadência, ritmo, densidade, subtexto, diálogo, imagem, tensão e lógica emocional.",
    "Não copie frases, cenas, personagens, eventos, imagens específicas ou viradas narrativas das amostras.",
    "Se houver conflito entre amostra e rascunho, preserve o rascunho e adapte apenas a técnica estilística.",
    "Evite prosa genérica: cada parágrafo precisa carregar uma escolha concreta de ritmo, percepção, detalhe sensorial, tensão, subtexto ou consequência emocional.",
    state.notes.trim() ? `Notas manuais do autor:\n${state.notes.trim()}` : "",
    analyzedBlocks.length
      ? `Essências absorvidas das amostras:\n\n${analyzedBlocks.join("\n\n----------------\n\n")}`
      : "",
    unanalyzedBlocks.length
      ? `Amostras ainda sem absorção automática:\n\n${unanalyzedBlocks.join("\n\n----------------\n\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
