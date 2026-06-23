import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";

import { useActiveWork } from "@/_core/hooks/useActiveWork";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_COVER_IMAGE,
  DefaultCoverArt,
  isDefaultCoverImage,
} from "@/components/DefaultCoverArt";
import {
  buildToneDirectionOptions,
  LiteraryTasteSelection,
} from "@/lib/literaryTaste";
import { trpc } from "@/lib/trpc";
import {
  CustomReferenceChapter,
  emptyKeyChaptersState,
  ReferenceSummarySection,
  serializeKeyChapters,
} from "@/lib/keyChapters";
import {
  createStyleSample,
  emptyStyleProfile,
  serializeStyleProfile,
} from "@/lib/styleProfile";
import {
  emptyUniverseProfile,
  serializeUniverseProfile,
  UniverseProfileState,
} from "@/lib/universeProfile";

const PENDING_IDEA_KEY = "literary-canvas-pending-idea";

type IdeaSeed = {
  title: string;
  subtitle: string;
  genre: string;
  description: string;
  tone: string;
  protagonist: string;
  conflict: string;
  setting: string;
  coverImage: string;
  stylePreference: string;
  styleSample: {
    title: string;
    content: string;
    fileName: string;
  } | null;
  literaryTaste: LiteraryTasteSelection;
};

type IdeaQuestion = {
  id: string;
  label: string;
  question: string;
  reason: string;
};

type IdeaAnswer = {
  id: string;
  question: string;
  answer: string;
};

type IdeaProposal = {
  title: string;
  subtitle: string;
  genre: string;
  logline: string;
  summary: string;
  tone: string;
  protagonist: string;
  centralConflict: string;
  setting: string;
  universe: {
    overview: string;
    timePeriod: string;
    locations: string;
    lore: string;
    powerRules: string;
    factions: string;
    timeline: string;
    themesTone: string;
    continuityConstraints: string;
    openQuestions: string;
  };
  characters: Array<{ name: string; role: string; description: string }>;
  timeline: Array<{ period: string; event: string; impact: string }>;
  styleBrief: string;
};

const emptyLiteraryTaste: LiteraryTasteSelection = {
  detectedSignals: [],
  selectedAuthors: [],
  selectedWorks: [],
  toneDirections: [],
  selectedToneDirections: [],
  customTone: "",
};

const emptyIdeaSeed: IdeaSeed = {
  title: "",
  subtitle: "",
  genre: "",
  description: "",
  tone: "",
  protagonist: "",
  conflict: "",
  setting: "",
  coverImage: DEFAULT_COVER_IMAGE,
  stylePreference: "",
  styleSample: null,
  literaryTaste: emptyLiteraryTaste,
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readLiteraryTaste(value: unknown): LiteraryTasteSelection {
  if (!value || typeof value !== "object") return emptyLiteraryTaste;
  const raw = value as any;
  const selectedAuthors = Array.isArray(raw.selectedAuthors)
    ? raw.selectedAuthors
        .map((author: any) => ({
          id: typeof author.id === "string" ? author.id : "",
          name: typeof author.name === "string" ? author.name : "",
          reason: typeof author.reason === "string" ? author.reason : "",
          works: stringArray(author.works),
          toneDirections: stringArray(author.toneDirections),
        }))
        .filter((author: any) => author.id && author.name)
    : [];
  const selectedWorks = Array.isArray(raw.selectedWorks)
    ? raw.selectedWorks
        .map((work: any) => ({
          id: typeof work.id === "string" ? work.id : "",
          authorId: typeof work.authorId === "string" ? work.authorId : "",
          authorName:
            typeof work.authorName === "string" ? work.authorName : "",
          title: typeof work.title === "string" ? work.title : "",
        }))
        .filter((work: any) => work.id && work.title)
    : [];

  return {
    detectedSignals: stringArray(raw.detectedSignals),
    selectedAuthors,
    selectedWorks,
    toneDirections: stringArray(raw.toneDirections),
    selectedToneDirections: stringArray(raw.selectedToneDirections),
    customTone: typeof raw.customTone === "string" ? raw.customTone : "",
  };
}

function readPendingIdea(): IdeaSeed {
  if (typeof window === "undefined") return emptyIdeaSeed;
  const raw = window.sessionStorage.getItem(PENDING_IDEA_KEY);
  if (!raw) return emptyIdeaSeed;
  try {
    const parsed = JSON.parse(raw);
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : "",
      genre: typeof parsed.genre === "string" ? parsed.genre : "",
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      tone: typeof parsed.tone === "string" ? parsed.tone : "",
      protagonist:
        typeof parsed.protagonist === "string" ? parsed.protagonist : "",
      conflict: typeof parsed.conflict === "string" ? parsed.conflict : "",
      setting: typeof parsed.setting === "string" ? parsed.setting : "",
      coverImage:
        typeof parsed.coverImage === "string" && parsed.coverImage
          ? parsed.coverImage
          : DEFAULT_COVER_IMAGE,
      stylePreference:
        typeof parsed.stylePreference === "string"
          ? parsed.stylePreference
          : "",
      styleSample:
        parsed.styleSample && typeof parsed.styleSample === "object"
          ? {
              title:
                typeof parsed.styleSample.title === "string"
                  ? parsed.styleSample.title
                  : "Amostra de estilo",
              content:
                typeof parsed.styleSample.content === "string"
                  ? parsed.styleSample.content
                  : "",
              fileName:
                typeof parsed.styleSample.fileName === "string"
                  ? parsed.styleSample.fileName
                  : "",
            }
          : null,
      literaryTaste: readLiteraryTaste(parsed.literaryTaste),
    };
  } catch {
    return emptyIdeaSeed;
  }
}

function sanitizeStylePreferenceForIdeaFlow(value: string) {
  const text = value.trim();
  if (!text) return "";
  return text
    .replace(
      /Mini-cena escolhida como referência de condução:[\s\S]*?(?=Notas técnicas:|$)/i,
      ""
    )
    .replace(
      /Exemplo técnico da mesma situação:[\s\S]*?(?=Notas técnicas:|$)/i,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isGeneratedCalibrationQuestion(question: string) {
  const source = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return [
    "mini cena",
    "minicena",
    "sua cena sugere",
    "a sua cena",
    "na sua cena",
    "voce descreve",
    "voce escreveu",
    "voce criou",
    "voce apresentou",
    "cena escolhida",
    "exemplo escolhido",
  ].some(pattern => source.includes(pattern));
}

function normalizeSeedForApi(seed: IdeaSeed) {
  const stylePreference = sanitizeStylePreferenceForIdeaFlow(
    seed.stylePreference
  );
  return {
    title: seed.title.trim(),
    subtitle: seed.subtitle.trim(),
    genre: seed.genre.trim(),
    description:
      seed.description.trim() ||
      seed.title.trim() ||
      "Ideia ainda sem premissa detalhada.",
    tone: [
      seed.tone.trim(),
      stylePreference
        ? `Calibração técnica de escrita escolhida no guia inicial:\n${stylePreference}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    protagonist: seed.protagonist.trim(),
    conflict: seed.conflict.trim(),
    setting: seed.setting.trim(),
    literaryTaste: seed.literaryTaste,
  };
}

function createReferenceId(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return `idea-${hash.toString(36)}-${Date.now().toString(36)}`;
}

function joinBlocks(blocks: Array<string | undefined | null>) {
  return blocks
    .map(item => item?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function buildSummarySections(
  proposal: IdeaProposal
): ReferenceSummarySection[] {
  const characterText = proposal.characters
    .map(character =>
      [character.name, character.role, character.description]
        .filter(Boolean)
        .join(" - ")
    )
    .join("\n");
  const timelineText = proposal.timeline
    .map(item =>
      [item.period || "Sem data", item.event, item.impact]
        .filter(Boolean)
        .join(" - ")
    )
    .join("\n");

  return [
    {
      id: "premissa",
      label: "Premissa",
      content: joinBlocks([proposal.logline, proposal.summary]),
    },
    {
      id: "personagens",
      label: "Personagens",
      content:
        characterText || proposal.protagonist || "Personagens a definir.",
    },
    {
      id: "eventos",
      label: "Eventos",
      content:
        timelineText || proposal.universe.timeline || "Eventos a definir.",
    },
    {
      id: "universo",
      label: "Universo",
      content:
        joinBlocks([
          proposal.universe.overview,
          proposal.universe.timePeriod,
          proposal.universe.locations,
          proposal.universe.lore,
          proposal.universe.powerRules,
          proposal.universe.factions,
        ]) ||
        proposal.setting ||
        "Universo a definir.",
    },
    {
      id: "conflitos",
      label: "Conflitos",
      content:
        joinBlocks([
          proposal.centralConflict,
          proposal.universe.continuityConstraints,
          proposal.universe.openQuestions,
        ]) || "Conflitos a definir.",
    },
    {
      id: "tom",
      label: "Tom e Estilo",
      content:
        joinBlocks([proposal.tone, proposal.styleBrief]) || "Estilo a definir.",
    },
  ];
}

function buildApprovedIdeaContent(
  seed: IdeaSeed,
  proposal: IdeaProposal,
  answers: IdeaAnswer[]
) {
  const answersText = answers
    .map(item => `Pergunta: ${item.question}\nResposta: ${item.answer}`)
    .join("\n\n");
  const tasteText = joinBlocks([
    seed.literaryTaste.selectedAuthors.length
      ? `Repertório literário selecionado ou sugerido: ${seed.literaryTaste.selectedAuthors.map(author => author.name).join(", ")}`
      : "",
    seed.literaryTaste.selectedWorks.length
      ? `Obras de referência selecionadas ou sugeridas: ${seed.literaryTaste.selectedWorks.map(work => `${work.title} (${work.authorName})`).join(", ")}`
      : "",
    seed.literaryTaste.selectedToneDirections.length
      ? `Direções de tom escolhidas: ${seed.literaryTaste.selectedToneDirections.join(", ")}`
      : "",
    seed.literaryTaste.customTone
      ? `Tom personalizado: ${seed.literaryTaste.customTone}`
      : "",
    seed.stylePreference
      ? `Calibração técnica de escrita escolhida no guia inicial:\n${seed.stylePreference}`
      : "",
    seed.styleSample
      ? `Amostra de estilo enviada no guia inicial: ${seed.styleSample.title} (${seed.styleSample.fileName})`
      : "",
  ]);
  const characterText = proposal.characters
    .map(
      character =>
        `- ${character.name}${character.role ? ` (${character.role})` : ""}: ${character.description}`
    )
    .join("\n");
  const timelineText = proposal.timeline
    .map(
      item =>
        `- ${item.period || "Sem data"}: ${item.event}${item.impact ? ` Impacto: ${item.impact}` : ""}`
    )
    .join("\n");

  return joinBlocks([
    `IDEIA APROVADA\nTítulo: ${proposal.title || seed.title || "Obra sem título"}${proposal.subtitle ? `\nSubtítulo: ${proposal.subtitle}` : ""}\nGênero: ${proposal.genre || seed.genre || "A definir"}`,
    tasteText ? `Preferências literárias do autor\n${tasteText}` : "",
    proposal.logline ? `Premissa\n${proposal.logline}` : "",
    proposal.summary ? `Resumo desenvolvido\n${proposal.summary}` : "",
    proposal.protagonist || proposal.centralConflict || proposal.setting
      ? `Núcleo narrativo\nProtagonista/núcleo: ${proposal.protagonist || seed.protagonist || "A definir"}\nConflito central: ${proposal.centralConflict || seed.conflict || "A definir"}\nCenário/período: ${proposal.setting || seed.setting || "A definir"}`
      : "",
    characterText ? `Personagens iniciais\n${characterText}` : "",
    timelineText ? `Timeline inicial\n${timelineText}` : "",
    `Universo\nVisão geral: ${proposal.universe.overview || proposal.summary}\nPeríodo: ${proposal.universe.timePeriod || proposal.setting || seed.setting}\nLugares: ${proposal.universe.locations || proposal.setting || seed.setting}\nLore: ${proposal.universe.lore}\nRegras de poder/sistema: ${proposal.universe.powerRules}\nFacções/instituições: ${proposal.universe.factions}\nCronologia: ${proposal.universe.timeline}\nTemas e tom: ${proposal.universe.themesTone || proposal.tone}\nLimites canônicos: ${proposal.universe.continuityConstraints}\nPontas em aberto: ${proposal.universe.openQuestions}`,
    proposal.styleBrief ? `Estilo inicial\n${proposal.styleBrief}` : "",
    answersText ? `Respostas do autor\n${answersText}` : "",
  ]);
}

function buildUniverseProfile(proposal: IdeaProposal): UniverseProfileState {
  return {
    ...emptyUniverseProfile,
    overview: proposal.universe.overview || proposal.summary,
    genre: proposal.genre,
    timePeriod: proposal.universe.timePeriod || proposal.setting,
    locations: proposal.universe.locations || proposal.setting,
    narrativeStructure: proposal.universe.openQuestions,
    pov: "",
    chapterStructure: "",
    lore: proposal.universe.lore,
    powerRules: proposal.universe.powerRules,
    factions: proposal.universe.factions,
    timeline:
      proposal.universe.timeline ||
      proposal.timeline
        .map(item => `${item.period || "Sem data"} - ${item.event}`)
        .join("\n"),
    socialRules: "",
    themesTone: proposal.universe.themesTone || proposal.tone,
    continuityConstraints:
      proposal.universe.continuityConstraints || proposal.centralConflict,
    openQuestions: proposal.universe.openQuestions,
    notes:
      "Universo iniciado no módulo Ideias e aprovado pelo autor antes de virar cânone do livro.",
  };
}

export default function IdeasPage() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { setActiveWorkId } = useActiveWork();
  const bootstrappedRef = useRef(false);
  const initialPendingIdeaRef = useRef<IdeaSeed | null>(null);

  const [seed, setSeed] = useState<IdeaSeed>(() => {
    const pending = readPendingIdea();
    if (pending.title.trim() || pending.description.trim()) {
      initialPendingIdeaRef.current = pending;
    }
    return pending;
  });
  const [questions, setQuestions] = useState<IdeaQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState<IdeaProposal | null>(null);
  const [revisionRequest, setRevisionRequest] = useState("");
  const [processingLabel, setProcessingLabel] = useState("");
  const [toneDialogOpen, setToneDialogOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [selectedToneDirections, setSelectedToneDirections] = useState<
    string[]
  >([]);
  const [customToneDirection, setCustomToneDirection] = useState("");

  const analyzeRepertoireMutation = trpc.ideas.analyzeRepertoire.useMutation();
  const askQuestionsMutation = trpc.ideas.askQuestions.useMutation();
  const generateProposalMutation = trpc.ideas.generateProposal.useMutation();
  const createWorkMutation = trpc.works.create.useMutation();
  const updateProfileMutation = trpc.profile?.update.useMutation();
  const syncImportedReferenceMutation =
    trpc.profile?.syncImportedReference.useMutation();
  const analyzeStyleMutation = trpc.profile?.analyzeStyle.useMutation();

  const hasSeed = Boolean(seed.description.trim() || seed.title.trim());
  const visibleQuestions = useMemo(
    () =>
      questions.filter(
        question => !isGeneratedCalibrationQuestion(question.question)
      ),
    [questions]
  );
  const answerList = useMemo<IdeaAnswer[]>(
    () =>
      visibleQuestions
        .map(question => ({
          id: question.id,
          question: question.question,
          answer: (answers[question.id] || "").trim(),
        }))
        .filter(item => item.answer),
    [answers, visibleQuestions]
  );

  const toneDirectionOptions = useMemo(
    () => buildToneDirectionOptions(seed.literaryTaste),
    [seed.literaryTaste]
  );

  const isProcessing =
    analyzeRepertoireMutation.isPending ||
    askQuestionsMutation.isPending ||
    generateProposalMutation.isPending ||
    createWorkMutation.isPending ||
    updateProfileMutation.isPending ||
    syncImportedReferenceMutation.isPending ||
    analyzeStyleMutation.isPending;

  const discardIdea = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(PENDING_IDEA_KEY);
    }

    initialPendingIdeaRef.current = null;
    bootstrappedRef.current = true;
    setSeed(emptyIdeaSeed);
    setQuestions([]);
    setAnswers({});
    setProposal(null);
    setRevisionRequest("");
    setProcessingLabel("");
    setSelectedToneDirections([]);
    setCustomToneDirection("");
    setToneDialogOpen(false);
    setDiscardDialogOpen(false);
    toast.success("Ideia descartada.");
    navigate("/home");
  };

  const toggleToneDirection = (direction: string) => {
    setSelectedToneDirections(current =>
      current.includes(direction)
        ? current.filter(item => item !== direction)
        : [...current, direction]
    );
  };

  const enrichSeedWithAiRepertoire = async (
    targetSeed: IdeaSeed
  ): Promise<IdeaSeed> => {
    const normalized = normalizeSeedForApi(targetSeed);
    const result = await analyzeRepertoireMutation.mutateAsync({
      idea: normalized,
    });
    const currentTaste = targetSeed.literaryTaste;
    const suggestedAuthors = result.profile?.authors
      .slice(0, 4)
      .map(author => ({
        id: author.id,
        name: author.name,
        reason: author.reason,
        works: author.works,
        toneDirections: author.toneDirections,
      }));
    const suggestedAuthorIds = new Set(
      suggestedAuthors.map(author => author.id)
    );
    return {
      ...targetSeed,
      literaryTaste: {
        detectedSignals: result.profile?.detectedSignals ?? [],
        selectedAuthors: currentTaste.selectedAuthors.length
          ? currentTaste.selectedAuthors
          : suggestedAuthors,
        selectedWorks: currentTaste.selectedWorks.length
          ? currentTaste.selectedWorks
          : (result.profile?.works ?? [])
              .filter(work => suggestedAuthorIds.has(work.authorId))
              .slice(0, 8),
        toneDirections: result.profile?.toneDirections ?? [],
        selectedToneDirections: currentTaste.selectedToneDirections || [],
        customTone: currentTaste.customTone || "",
      },
    };
  };

  const buildSeedWithTonePreference = (useTonePreference = true): IdeaSeed => {
    if (!useTonePreference) {
      return {
        ...seed,
        literaryTaste: {
          ...seed.literaryTaste,
          selectedToneDirections: [],
          customTone: "",
        },
      };
    }

    const selectedToneText = selectedToneDirections.join(", ");
    const customToneText = customToneDirection.trim();
    return {
      ...seed,
      tone: [seed.tone.trim(), selectedToneText, customToneText]
        .filter(Boolean)
        .join("\n"),
      literaryTaste: {
        ...seed.literaryTaste,
        toneDirections: seed.literaryTaste.toneDirections.length
          ? seed.literaryTaste.toneDirections
          : toneDirectionOptions,
        selectedToneDirections,
        customTone: customToneText,
      },
    };
  };

  const requestQuestions = async (targetSeed = seed) => {
    if (!targetSeed.description.trim() && !targetSeed.title.trim()) {
      toast.error(
        "Escreva pelo menos uma ideia breve antes de pedir perguntas."
      );
      return;
    }

    try {
      setProcessingLabel(
        "A IA está lendo a premissa inteira antes das perguntas..."
      );
      const enrichedSeed = await enrichSeedWithAiRepertoire(targetSeed);
      setSeed(enrichedSeed);
      setProcessingLabel(
        "A IA está formulando perguntas específicas para essa ideia..."
      );
      const result = await askQuestionsMutation.mutateAsync({
        idea: normalizeSeedForApi(enrichedSeed),
        answers: answerList,
      });
      setQuestions(result.questions);
      setProposal(null);
      toast.success(
        "Perguntas criadas. Responda o que souber; isso ainda não vira obra."
      );
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    } finally {
      setProcessingLabel("");
    }
  };

  useEffect(() => {
    if (bootstrappedRef.current || !initialPendingIdeaRef.current) return;
    bootstrappedRef.current = true;
    void requestQuestions(initialPendingIdeaRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateProposal = async (changeRequest = "", targetSeed = seed) => {
    if (!hasSeed) {
      toast.error("Escreva uma ideia breve antes de gerar a proposta.");
      return;
    }

    try {
      setProcessingLabel(
        "A IA está relendo a premissa para evitar uma proposta genérica..."
      );
      const enrichedSeed = await enrichSeedWithAiRepertoire(targetSeed);
      setProcessingLabel(
        changeRequest
          ? "A IA está reescrevendo a proposta com suas mudanças..."
          : "A IA está montando uma proposta de história..."
      );
      const result = await generateProposalMutation.mutateAsync({
        idea: normalizeSeedForApi(enrichedSeed),
        answers: answerList,
        previousProposal: proposal || undefined,
        revisionRequest: changeRequest || undefined,
      });
      setSeed(enrichedSeed);
      setProposal(result.proposal);
      setRevisionRequest("");
      toast.success("Proposta criada. Aprove ou peça ajustes.");
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    } finally {
      setProcessingLabel("");
    }
  };

  const approveProposal = async () => {
    if (!proposal) return;

    const title =
      proposal.title.trim() || seed.title.trim() || "Obra sem título";
    const approvedContent = buildApprovedIdeaContent(
      seed,
      proposal,
      answerList
    );
    const summarySections = buildSummarySections(proposal);
    const referenceId = createReferenceId(`${title}:${approvedContent.length}`);
    const reference: CustomReferenceChapter = {
      id: referenceId,
      title: `Ideia aprovada - ${title}`,
      content: approvedContent,
      summary: proposal.summary,
      summarySections,
      continuitySnippet: proposal.summary,
      notes: "Gerado no módulo Ideias e aprovado pelo autor.",
      fileName: "",
      sourceType: "manual",
      isActive: true,
      summaryStatus: "done",
    };

    try {
      setProcessingLabel("Criando a obra a partir da ideia aprovada...");
      const created = await createWorkMutation.mutateAsync({
        title,
        subtitle: proposal.subtitle.trim() || seed.subtitle.trim() || undefined,
        genre: proposal.genre.trim() || seed.genre.trim() || undefined,
        description:
          proposal.logline.trim() ||
          proposal.summary.slice(0, 450) ||
          undefined,
        coverImage: seed.coverImage || DEFAULT_COVER_IMAGE,
        coverPositionX: 50,
        coverPositionY: 50,
        coverScale: 100,
        status: "planning",
      });

      const workId = created.data.id;
      setActiveWorkId(workId);

      const styleSamples: ReturnType<typeof createStyleSample>[] = [];
      if (seed.styleSample?.content.trim()) {
        setProcessingLabel("Salvando a amostra inicial na aba Estilo...");
        const sample = createStyleSample({
          title: seed.styleSample.title || "Amostra de estilo",
          content: seed.styleSample.content,
          fileName: seed.styleSample.fileName,
          notes:
            "Amostra enviada no guia de Nova obra. Use como essência técnica de escrita, não como conteúdo de enredo.",
        });
        try {
          const analyzed = await analyzeStyleMutation.mutateAsync({
            workId,
            title: sample.title,
            content: sample.content,
            notes: sample.notes,
          });
          styleSamples.push({ ...sample, analysis: analyzed.data });
        } catch {
          styleSamples.push(sample);
          toast.warning(
            "A amostra foi salva em Estilo, mas a essência ainda não foi absorvida. Você pode tentar de novo em Obras."
          );
        }
      }

      setProcessingLabel(
        "Preenchendo o material da obra com a ideia aprovada..."
      );
      await updateProfileMutation.mutateAsync({
        workId,
        storyFoundation: approvedContent,
        narrativeStyle: serializeStyleProfile({
          ...emptyStyleProfile,
          samples: styleSamples,
          notes:
            [proposal.styleBrief, seed.stylePreference, proposal.tone]
              .filter(Boolean)
              .join("\n\n") ||
            "Definir estilo autoral antes de escrever o primeiro capítulo.",
        }),
        negativeRules: serializeUniverseProfile(buildUniverseProfile(proposal)),
        keyChapters: serializeKeyChapters({
          ...emptyKeyChaptersState,
          customReferences: [reference],
        }),
      });

      setProcessingLabel("Conectando personagens, universo e biblioteca...");
      let enrichedReference = reference;
      try {
        const synced = await syncImportedReferenceMutation.mutateAsync({
          workId,
          referenceId,
          title: reference.title,
          content: reference.content,
          summary: proposal.summary,
          summarySections,
        });
        enrichedReference = {
          ...reference,
          continuitySnippet:
            synced.continuitySnippet || reference.continuitySnippet,
          importedCharacterIds: synced.importedCharacterIds.length
            ? synced.importedCharacterIds
            : undefined,
          importedTimelineEvents: synced.importedTimelineEvents.length
            ? synced.importedTimelineEvents
            : undefined,
        };
        await updateProfileMutation.mutateAsync({
          workId,
          keyChapters: serializeKeyChapters({
            ...emptyKeyChaptersState,
            customReferences: [enrichedReference],
          }),
        });
      } catch (error) {
        toast.warning(
          "A ideia foi salva em Obras, mas a extração automática de personagens e biblioteca falhou. Você pode revisar em Obras."
        );
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(PENDING_IDEA_KEY);
      }
      await utils.invalidate();
      toast.success(
        "Ideia aprovada. Agora ajuste o Estilo antes de rascunhar."
      );
      navigate("/works?tab=style");
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    } finally {
      setProcessingLabel("");
    }
  };

  return (
    <div className="space-y-6">
      {processingLabel ? (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-accent/30 bg-background/90 px-4 py-2 text-sm text-foreground shadow-lg backdrop-blur">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          {processingLabel}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[0.82fr_1.18fr]">
        <Card className="overflow-hidden border border-border bg-card">
          <div className="relative h-full min-h-[320px]">
            {isDefaultCoverImage(seed.coverImage) ? (
              <DefaultCoverArt className="absolute inset-0 h-full w-full opacity-80" />
            ) : (
              <img
                src={seed.coverImage || DEFAULT_COVER_IMAGE}
                alt={`Capa de ${seed.title.trim() || "ideia em desenvolvimento"}`}
                className="absolute inset-0 h-full w-full object-cover opacity-80"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/10" />
            <div className="relative z-10 flex min-h-[320px] flex-col justify-end p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-accent">
                <Sparkles className="h-4 w-4" />
                Módulo de ideias
              </div>
              <h2 className="mt-4 max-w-xl font-display text-3xl text-white">
                {seed.title.trim() ||
                  "Antes de virar obra, a ideia precisa respirar."}
              </h2>
              {seed.subtitle.trim() ? (
                <p className="mt-2 max-w-lg text-lg text-white/80">
                  {seed.subtitle}
                </p>
              ) : null}
              <p className="mt-4 max-w-lg text-sm leading-6 text-white/70">
                Aqui a IA pergunta, propõe, reescreve e só depois da sua
                aprovação cria o material da obra.
              </p>
            </div>
          </div>
        </Card>

        <Card className="border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-accent">
                <BookOpen className="h-4 w-4" />
                Ideia inicial
              </div>
              <h3 className="mt-2 font-display text-xl text-foreground">
                Ainda não é obra estruturada
              </h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Use este espaço para desenvolver a premissa. A obra só nasce
                quando você aprovar a proposta final.
              </p>
            </div>
            <Badge variant="secondary" className="bg-accent/15 text-accent">
              etapa anterior à obra
            </Badge>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Input
              value={seed.title}
              onChange={event =>
                setSeed(current => ({ ...current, title: event.target.value }))
              }
              placeholder="Título provisório"
              className="bg-secondary"
            />
            <Input
              value={seed.genre}
              onChange={event =>
                setSeed(current => ({ ...current, genre: event.target.value }))
              }
              placeholder="Gênero ou mistura de gêneros"
              className="bg-secondary"
            />
          </div>
          <Textarea
            value={seed.description}
            onChange={event =>
              setSeed(current => ({
                ...current,
                description: event.target.value,
              }))
            }
            rows={7}
            placeholder="Resumo breve da ideia, mesmo que esteja cru. Ex: uma frase, um conflito, uma imagem, um personagem ou um mundo."
            className="mt-3 resize-none bg-secondary"
          />
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Input
              value={seed.tone}
              onChange={event =>
                setSeed(current => ({ ...current, tone: event.target.value }))
              }
              placeholder="Tom desejado"
              className="bg-secondary"
            />
            <Input
              value={seed.protagonist}
              onChange={event =>
                setSeed(current => ({
                  ...current,
                  protagonist: event.target.value,
                }))
              }
              placeholder="Protagonista/núcleo"
              className="bg-secondary"
            />
            <Input
              value={seed.setting}
              onChange={event =>
                setSeed(current => ({
                  ...current,
                  setting: event.target.value,
                }))
              }
              placeholder="Lugar, época ou ambiente"
              className="bg-secondary"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => requestQuestions(seed)}
              disabled={isProcessing || !hasSeed}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {askQuestionsMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <MessageSquareText className="mr-2 h-4 w-4" />
              )}
              Fazer perguntas
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardDialogOpen(true)}
              disabled={isProcessing || !hasSeed}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Descartar ideia
            </Button>
            <Link href="/home">
              <Button type="button" variant="outline">
                Voltar para Home
              </Button>
            </Link>
          </div>

          {seed.literaryTaste.selectedAuthors.length ||
          seed.literaryTaste.selectedWorks.length ? (
            <div className="mt-5 rounded-lg border border-border bg-background/35 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-accent">
                Direção técnica usada pela IA
              </div>
              {seed.literaryTaste.selectedAuthors.length ? (
                <div className="mt-3 space-y-2">
                  {seed.literaryTaste.selectedAuthors.map(author => (
                    <div
                      key={author.id}
                      className="rounded-lg border border-border/70 bg-secondary/25 px-3 py-2"
                    >
                      <Badge variant="secondary">{author.name}</Badge>
                      {author.reason ? (
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {author.reason}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {seed.literaryTaste.selectedWorks.length ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Referências reconhecidas como direção de gosto:{" "}
                  {seed.literaryTaste.selectedWorks
                    .map(work => `${work.title} (${work.authorName})`)
                    .join(", ")}
                  .
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg text-foreground">
                Perguntas da IA
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Responda o que souber. Essas respostas servem para aproximar a
                proposta daquilo que você tinha em mente.
              </p>
            </div>
            <Badge variant="secondary">{visibleQuestions.length}</Badge>
          </div>

          <div className="mt-4 space-y-4">
            {visibleQuestions.length ? (
              visibleQuestions.map(question => (
                <div
                  key={question.id}
                  className="rounded-lg border border-border bg-secondary/35 p-4"
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-accent">
                    {question.label || "Pergunta"}
                  </div>
                  <div className="mt-2 text-sm font-medium leading-6 text-foreground">
                    {question.question}
                  </div>
                  {question.reason ? (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {question.reason}
                    </p>
                  ) : null}
                  <Textarea
                    value={answers[question.id] || ""}
                    onChange={event =>
                      setAnswers(current => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                    rows={4}
                    placeholder="Sua resposta..."
                    className="mt-3 resize-none bg-background/70"
                  />
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border p-5 text-sm leading-6 text-muted-foreground">
                As perguntas aparecem aqui depois que a IA ler a ideia inicial.
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => setToneDialogOpen(true)}
              disabled={isProcessing || !hasSeed || !visibleQuestions.length}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {generateProposalMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <WandSparkles className="mr-2 h-4 w-4" />
              )}
              Gerar proposta
            </Button>
          </div>
        </Card>

        <Card className="border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg text-foreground">
                Proposta da história
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Aprove apenas quando estiver parecido com a ideia que você quer
                escrever. Antes disso, peça ajustes.
              </p>
            </div>
            {proposal ? (
              <Badge
                variant="secondary"
                className="bg-emerald-500/15 text-emerald-300"
              >
                pronta para avaliar
              </Badge>
            ) : null}
          </div>

          {proposal ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-lg border border-accent/25 bg-accent/5 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-accent">
                  {proposal.genre || "Gênero a definir"}
                </div>
                <h4 className="mt-2 font-display text-2xl text-foreground">
                  {proposal.title}
                </h4>
                {proposal.subtitle ? (
                  <p className="mt-1 text-lg text-muted-foreground">
                    {proposal.subtitle}
                  </p>
                ) : null}
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  {proposal.logline}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-secondary/30 p-4">
                <div className="font-medium text-foreground">
                  Resumo proposto
                </div>
                <p className="mt-2 whitespace-pre-line text-sm leading-7 text-muted-foreground">
                  {proposal.summary}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-secondary/30 p-4">
                  <div className="font-medium text-foreground">
                    Personagens iniciais
                  </div>
                  <div className="mt-3 space-y-3">
                    {proposal.characters?.length ? (
                      proposal.characters?.slice(0, 5).map(character => (
                        <div
                          key={`${character.name}-${character.role}`}
                          className="text-sm leading-6"
                        >
                          <div className="font-medium text-foreground">
                            {character.name || "Sem nome"}{" "}
                            <span className="text-xs text-muted-foreground">
                              {character.role}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            {character.description}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        A IA ainda não encontrou personagens claros.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-secondary/30 p-4">
                  <div className="font-medium text-foreground">
                    Universo e timeline
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {proposal.universe.overview || proposal.setting}
                  </p>
                  <div className="mt-3 space-y-2">
                    {proposal.timeline.slice(0, 4).map(item => (
                      <div
                        key={`${item.period}-${item.event}`}
                        className="rounded-lg border border-border/70 bg-background/40 p-2 text-xs leading-5 text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">
                          {item.period || "Sem data"}:
                        </span>{" "}
                        {item.event}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/30 p-4">
                <div className="font-medium text-foreground">
                  Não ficou como você imaginou
                </div>
                <Textarea
                  value={revisionRequest}
                  onChange={event => setRevisionRequest(event.target.value)}
                  rows={4}
                  placeholder="Diga o que precisa mudar: mais político, menos fantasia, protagonista diferente, final mais trágico, outro cenário..."
                  className="mt-3 resize-none bg-background/70"
                />
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => generateProposal(revisionRequest.trim())}
                    disabled={isProcessing || !revisionRequest.trim()}
                  >
                    {generateProposalMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Gerar novamente
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDiscardDialogOpen(true)}
                    disabled={isProcessing}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Descartar
                  </Button>
                  <Button
                    type="button"
                    onClick={approveProposal}
                    disabled={isProcessing}
                    className="bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    {createWorkMutation.isPending ||
                    updateProfileMutation.isPending ||
                    syncImportedReferenceMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Aprovar ideia
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-secondary/20 p-6 text-center">
              <Sparkles className="h-8 w-8 text-accent" />
              <h4 className="mt-3 font-display text-xl text-foreground">
                A proposta ainda não foi gerada
              </h4>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Depois das perguntas, a IA monta um resumo desenvolvido. Você
                pode pedir mudanças quantas vezes precisar antes de aprovar.
              </p>
            </div>
          )}
        </Card>
      </section>

      <Card className="border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-accent/30 bg-accent/10 p-2 text-accent">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <div className="font-medium text-foreground">
                Fluxo depois da aprovação
              </div>
              <p className="text-sm text-muted-foreground">
                Material preenchido, estilo calibrado, rascunho, escrita e
                revisão.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Ideia</Badge>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <Badge variant="secondary">Obras</Badge>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <Badge variant="secondary">Rascunho</Badge>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <Badge variant="secondary">Escrita</Badge>
          </div>
        </div>
      </Card>

      <Dialog open={toneDialogOpen} onOpenChange={setToneDialogOpen}>
        <DialogContent className="border-border bg-card sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-foreground">
              Antes de gerar, escolha o tom
            </DialogTitle>
            <DialogDescription>
              Essas opções vêm do que você marcou no começo. Marque uma ou mais,
              escreva outra direção ou siga sem escolher.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {toneDirectionOptions.map(direction => {
                const active = selectedToneDirections.includes(direction);
                return (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => toggleToneDirection(direction)}
                    className={`rounded-lg border p-3 text-left text-sm leading-5 transition-all duration-150 hover:border-accent/60 ${
                      active
                        ? "border-accent/70 bg-accent/15 text-foreground"
                        : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span>{direction}</span>
                      {active ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>

            <Textarea
              value={customToneDirection}
              onChange={event => setCustomToneDirection(event.target.value)}
              rows={3}
              className="resize-none bg-background/70"
              placeholder="Outra direção de tom, se quiser. Ex.: suspense medieval com violência contida, política suja e sensação de lenda proibida."
            />

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={isProcessing}
                onClick={() => {
                  setSelectedToneDirections([]);
                  setCustomToneDirection("");
                  setToneDialogOpen(false);
                  void generateProposal(
                    undefined,
                    buildSeedWithTonePreference(false)
                  );
                }}
              >
                Nenhuma, seguir assim
              </Button>
              <Button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setToneDialogOpen(false);
                  void generateProposal(
                    undefined,
                    buildSeedWithTonePreference(true)
                  );
                }}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {generateProposalMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <WandSparkles className="mr-2 h-4 w-4" />
                )}
                Gerar ideia
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent className="border-border bg-card sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-foreground">
              Descartar ideia
            </DialogTitle>
            <DialogDescription>
              Isso limpa a ideia atual, as perguntas, respostas e proposta
              gerada. Nenhuma obra será criada.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="button" variant="destructive" onClick={discardIdea}>
              <Trash2 className="mr-2 h-4 w-4" />
              Descartar ideia
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
