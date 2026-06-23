import {
  ChangeEvent,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileText,
  FileUp,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Upload,
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
import {
  DEFAULT_COVER_IMAGE,
  DefaultCoverArt,
  isDefaultCoverImage,
} from "@/components/DefaultCoverArt";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  getAcceptString,
  getSupportedExtensions,
  parseFile,
} from "@/lib/fileParser";
import {
  CustomReferenceChapter,
  emptyKeyChaptersState,
  KeyChaptersState,
  ReferenceSummarySection,
  serializeKeyChapters,
} from "@/lib/keyChapters";
import { detectLiteraryTaste, LiteraryTasteProfile } from "@/lib/literaryTaste";
import {
  ImportProgressPanel,
  type ImportProgressPhase,
} from "@/components/ImportProgressPanel";

type WorkStatus =
  | "planning"
  | "in_progress"
  | "paused"
  | "completed"
  | "archived";
type OnboardingMode = "upload" | "manual";

type UploadedReferenceDraft = {
  title: string;
  content: string;
  fileName: string;
};

type ManualFlowState = {
  started: boolean;
  hasIdea: boolean | null;
  hasStyleReference: boolean | null;
  seedType: string;
  selectedStyleOptionId: string;
  stylePreference: string;
  styleSample: UploadedReferenceDraft | null;
};

type WorkDraftForm = {
  title: string;
  subtitle: string;
  genre: string;
  description: string;
  tone: string;
  protagonist: string;
  conflict: string;
  setting: string;
  coverImage: string;
  status: WorkStatus;
};

const MANUAL_STEPS = [
  {
    eyebrow: "Ideia",
    title: "Sobre o que você quer escrever",
    description:
      "Uma premissa curta já basta. Depois a IA faz perguntas antes disso virar obra.",
  },
  {
    eyebrow: "Gênero",
    title: "Que tipo de livro é esse",
    description:
      "Selecione um ou mais gêneros. Se não encaixar, use Outro e escreva do seu jeito.",
  },
  {
    eyebrow: "Referências",
    title: "Algum desses autores conversa com sua ideia",
    description:
      "A seleção não serve para copiar estilo. Ela ajuda a IA a entender repertório, gosto e direção.",
  },
  {
    eyebrow: "Obras",
    title: "Você conhece alguma dessas obrasó",
    description:
      "Se marcar alguma, a IA entende melhor o tipo de promessa narrativa que você reconhece.",
  },
  {
    eyebrow: "Tom",
    title: "Como a história deve soar",
    description:
      "Isso ajuda a IA a entender atmosfera, promessa narrativa e expectativa de leitura.",
  },
  {
    eyebrow: "Núcleo",
    title: "Quem move a história",
    description:
      "Opcional, mas útil: protagonista, conflito principal e lugar/época.",
  },
  {
    eyebrow: "Capa",
    title: "Escolha uma imagem ou use a padrão",
    description: "A capa pode ser trocada depois nas configurações da obra.",
  },
] as const;

const GENRE_OPTIONS = [
  "Suspense",
  "Terror",
  "Fantasia",
  "Ficção científica",
  "Ficção política",
  "Drama",
  "Mistério",
  "Romance",
  "Histórico",
  "Distopia",
];

const TONE_OPTIONS = [
  "Sombrio",
  "Literário",
  "Épico",
  "Intimista",
  "Político",
  "Acelerado",
  "Melancólico",
  "Satírico",
];

const emptyWorkDraft: WorkDraftForm = {
  title: "",
  subtitle: "",
  genre: "",
  description: "",
  tone: "",
  protagonist: "",
  conflict: "",
  setting: "",
  coverImage: DEFAULT_COVER_IMAGE,
  status: "planning",
};

const emptyManualFlow: ManualFlowState = {
  started: false,
  hasIdea: null,
  hasStyleReference: null,
  seedType: "",
  selectedStyleOptionId: "",
  stylePreference: "",
  styleSample: null,
};

const MANUAL_SEED_OPTIONS = [
  {
    id: "premissa",
    label: "Tenho uma premissa",
    description: "Uma frase, conflito ou situação inicial.",
  },
  {
    id: "personagem",
    label: "Tenho um personagem",
    description: "Alguém interessante, mas a história ainda está aberta.",
  },
  {
    id: "mundo",
    label: "Tenho um mundo",
    description: "Um lugar, época, regra social ou universo.",
  },
  {
    id: "cena",
    label: "Tenho uma cena",
    description: "Uma imagem, diálogo, virada ou momento forte.",
  },
] as const;

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function createReferenceId(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return `ref-${hash.toString(36)}-${Date.now().toString(36)}`;
}

function normalizeSummarySections(
  value: unknown
): ReferenceSummarySection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sections = value
    .map(item => {
      if (!item || typeof item !== "object") return null;
      const id =
        typeof (item as any).id === "string" ? (item as any).id.trim() : "";
      const label =
        typeof (item as any).label === "string"
          ? (item as any).label.trim()
          : "";
      const content =
        typeof (item as any).content === "string"
          ? (item as any).content.trim()
          : "";
      return id && label && content ? { id, label, content } : null;
    })
    .filter(Boolean) as ReferenceSummarySection[];
  return sections.length ? sections : undefined;
}

function buildSuggestedTitle(
  form: WorkDraftForm,
  reference: UploadedReferenceDraft | null
) {
  const explicit = form.title.trim() || reference?.title.trim() || "";
  if (explicit) return explicit;
  const firstSentence = form.description.split(/[.!]/)[0].trim();
  if (firstSentence) return firstSentence.slice(0, 58);
  return "Obra sem título";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler a imagem."));
    reader.readAsDataURL(file);
  });
}

type CoverUploadTileProps = {
  coverImage: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  emptyLabel?: string;
  emptyDescription?: string;
};

function CoverUploadTile({
  coverImage,
  onClick,
  disabled,
  className,
  compact = false,
  emptyLabel = "Capa opcional",
  emptyDescription = "Se não subir, entra uma imagem padrão.",
}: CoverUploadTileProps) {
  const hasCustomCover = Boolean(
    coverImage && !isDefaultCoverImage(coverImage)
  );

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative flex w-full cursor-pointer overflow-hidden rounded-lg border border-dashed text-center shadow-sm transition-colors duration-150 disabled:pointer-events-none disabled:opacity-60",
        compact
          ? "min-h-24 items-center justify-center gap-3 p-4"
          : "min-h-44 flex-col items-center justify-center p-5",
        hasCustomCover
          ? "border-accent/70 bg-black text-white hover:border-accent"
          : "border-border bg-background/40 text-foreground hover:border-accent/50 hover:bg-secondary/50",
        className
      )}
    >
      {hasCustomCover ? (
        <>
          <img
            src={coverImage}
            alt="Capa importada"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
          <div
            className={cn(
              "relative z-10 flex items-center justify-center gap-3",
              compact ? "flex-row" : "flex-col"
            )}
          >
            <span className="rounded-full border border-white/25 bg-black/40 p-2 text-white backdrop-blur">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <span className="flex flex-col">
              <span className="font-medium text-white">Capa carregada</span>
              <span className="text-xs text-white/75">Trocar imagem</span>
            </span>
          </div>
        </>
      ) : (
        <>
          <ImagePlus
            className={cn("text-accent", compact ? "h-5 w-5" : "h-8 w-8")}
          />
          <span
            className={cn(
              "font-medium text-foreground",
              compact ? "text-sm" : "mt-3"
            )}
          >
            {emptyLabel}
          </span>
          {!compact ? (
            <span className="mt-1 text-xs text-muted-foreground">
              {emptyDescription}
            </span>
          ) : null}
        </>
      )}
    </button>
  );
}

function cleanTitleFromFileName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

export function WorkOnboarding() {
  const [location, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { setActiveWorkId, works } = useActiveWork();
  const hasExistingWorks = works.length > 0;
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const styleReferenceInputRef = useRef<HTMLInputElement>(null);

  const [showCreator, setShowCreator] = useState(false);
  const [mode, setMode] = useState<OnboardingMode>("upload");
  const [manualStep, setManualStep] = useState(0);
  const [manualFlow, setManualFlow] =
    useState<ManualFlowState>(emptyManualFlow);
  const [form, setForm] = useState<WorkDraftForm>(emptyWorkDraft);
  const [referenceDraft, setReferenceDraft] =
    useState<UploadedReferenceDraft | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedTone, setSelectedTone] = useState<string[]>([]);
  const [selectedAuthorIds, setSelectedAuthorIds] = useState<string[]>([]);
  const [selectedWorkIds, setSelectedWorkIds] = useState<string[]>([]);
  const [customGenre, setCustomGenre] = useState("");
  const [processingMessage, setProcessingMessage] = useState("");
  const [aiLiteraryTaste, setAiLiteraryTaste] =
    useState<LiteraryTasteProfile | null>(null);
  const [aiTasteSignature, setAiTasteSignature] = useState("");

  const openFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>) => {
      if (!ref.current) return;
      ref.current.value = "";
      ref.current.click();
    },
    []
  );

  useEffect(() => {
    const openCreator = (mode: OnboardingMode = "upload") => {
      setMode(mode);
      setShowCreator(true);
    };

    const handleExternalOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ mode: OnboardingMode }>).detail;
      openCreator(detail.mode === "manual" ? "manual" : "upload");
    };

    window.addEventListener(
      "literary-canvas:open-work-creator",
      handleExternalOpen
    );
    return () =>
      window.removeEventListener(
        "literary-canvas:open-work-creator",
        handleExternalOpen
      );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // wouter's location is path-only; read the query from window.location.search.
    const params = new URLSearchParams(window.location.search);
    if (params.get("createWork") !== "1") return;

    setMode(params.get("mode") === "manual" ? "manual" : "upload");
    setShowCreator(true);

    window.history.replaceState(window.history.state, "", location || "/home");
  }, [location]);

  const createWorkMutation = trpc.works.create.useMutation();
  const quickScanMutation = trpc.profile?.quickScan.useMutation();
  const updateProfileMutation = trpc.profile?.update.useMutation();
  const summarizeReferenceMutation =
    trpc.profile?.summarizeReference.useMutation();
  const analyzeRepertoireMutation = trpc.ideas.analyzeRepertoire.useMutation();

  const isProcessing =
    createWorkMutation.isPending ||
    quickScanMutation.isPending ||
    updateProfileMutation.isPending ||
    summarizeReferenceMutation.isPending ||
    analyzeRepertoireMutation.isPending;
  const importProgressPhase: ImportProgressPhase | null =
    summarizeReferenceMutation.isPending ? "summary" : null;

  const goToImportedMaterial = useCallback(() => {
    const target = "/works?tab=chapters&imported=1";
    setShowCreator(false);
    navigate(target);

    window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (
        window.location.pathname !== "/works" ||
        params.get("tab") !== "chapters"
      ) {
        window.location.assign(target);
      }
    }, 0);
  }, [navigate]);

  const visibleGenre = useMemo(
    () =>
      [form.genre, ...selectedGenres, customGenre]
        .map(item => item.trim())
        .filter(Boolean)
        .join(", "),
    [customGenre, form.genre, selectedGenres]
  );

  const tasteSignature = useMemo(
    () =>
      JSON.stringify({
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        genre: visibleGenre,
        description:
          form.description.trim() ||
          `O autor ainda não fechou a premissa. Ponto de partida declarado: ${manualFlow.seedType || "ideia em aberto"}.`,
        tone: [form.tone, ...selectedTone]
          .map(item => item.trim())
          .filter(Boolean)
          .join(", "),
        protagonist: form.protagonist.trim(),
        conflict: form.conflict.trim(),
        setting: form.setting.trim(),
      }),
    [
      form.conflict,
      form.description,
      form.protagonist,
      form.setting,
      form.subtitle,
      form.title,
      form.tone,
      selectedTone,
      visibleGenre,
    ]
  );

  const localLiteraryTaste = useMemo(
    () =>
      detectLiteraryTaste({
        genre: visibleGenre,
        description: form.description,
        tone: [form.tone, ...selectedTone].filter(Boolean).join(", "),
        setting: form.setting,
      }),
    [form.description, form.setting, form.tone, selectedTone, visibleGenre]
  );

  const literaryTaste =
    aiLiteraryTaste && aiTasteSignature === tasteSignature
      ? aiLiteraryTaste
      : localLiteraryTaste;

  const selectedAuthors = useMemo(
    () =>
      literaryTaste.authors.filter(author =>
        selectedAuthorIds.includes(author.id)
      ),
    [literaryTaste.authors, selectedAuthorIds]
  );

  const visibleWorks = useMemo(
    () =>
      selectedAuthorIds.length
        ? literaryTaste.works.filter(work =>
            selectedAuthorIds.includes(work.authorId)
          )
        : literaryTaste.works,
    [literaryTaste.works, selectedAuthorIds]
  );

  const selectedWorks = useMemo(
    () => literaryTaste.works.filter(work => selectedWorkIds.includes(work.id)),
    [literaryTaste.works, selectedWorkIds]
  );

  useEffect(() => {
    const availableWorkIds = new Set(visibleWorks.map(work => work.id));
    setSelectedWorkIds(current =>
      current.filter(id => availableWorkIds.has(id))
    );
  }, [visibleWorks]);

  const buildIdeaForRepertoire = () => ({
    title: form.title.trim(),
    subtitle: form.subtitle.trim(),
    genre: visibleGenre,
    description:
      form.description.trim() ||
      form.title.trim() ||
      manualFlow.seedType ||
      "Ideia ainda sem premissa detalhada.",
    tone: [form.tone, ...selectedTone]
      .map(item => item.trim())
      .filter(Boolean)
      .join(", "),
    protagonist: form.protagonist.trim(),
    conflict: form.conflict.trim(),
    setting: form.setting.trim(),
  });

  const styleOptionsQuery = trpc.ideas.styleOptions.useQuery(
    { idea: buildIdeaForRepertoire() },
    {
      enabled:
        showCreator &&
        mode === "manual" &&
        manualFlow.started &&
        manualFlow.hasStyleReference === false &&
        Boolean(
          form.description.trim() || form.title.trim() || manualFlow.seedType
        ),
    }
  );

  const styleCalibrationOptions = styleOptionsQuery.data?.options ?? [];
  const selectedStyleCalibration = styleCalibrationOptions.find(
    option => option.id === manualFlow.selectedStyleOptionId
  );

  const ensureIdeaRepertoire = async () => {
    if (!form.description.trim() && !form.title.trim() && !manualFlow.seedType)
      return localLiteraryTaste;
    if (aiLiteraryTaste && aiTasteSignature === tasteSignature)
      return aiLiteraryTaste;

    try {
      setProcessingMessage(
        "A IA está lendo sua ideia para sugerir repertório de verdade..."
      );
      const result = await analyzeRepertoireMutation.mutateAsync({
        idea: buildIdeaForRepertoire(),
      });
      setAiLiteraryTaste(result.profile);
      setAiTasteSignature(tasteSignature);
      setSelectedAuthorIds(current =>
        current.filter(id =>
          result.profile?.authors.some(author => author.id === id)
        )
      );
      setSelectedWorkIds(current =>
        current.filter(id => result.profile?.works.some(work => work.id === id))
      );
      return result.profile;
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
      setAiLiteraryTaste(null);
      setAiTasteSignature("");
      throw error;
    } finally {
      setProcessingMessage("");
    }
  };

  const handleReferenceUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setProcessingMessage("Lendo o arquivo...");
      const parsed = await parseFile(file);
      const content = parsed.text.trim();
      if (!content) {
        toast.error("O arquivo não tem texto legível.");
        return;
      }

      const title = cleanTitleFromFileName(parsed.fileName);
      setReferenceDraft({ title, content, fileName: parsed.fileName });
      setForm(current => ({
        ...current,
        title: current.title.trim() ? current.title : title,
        description: current.description.trim()
          ? current.description
          : `Documento importado: ${parsed.fileName}.`,
      }));

      if (content.length >= 50) {
        setProcessingMessage(
          "A IA está lendo o começo do documento para sugerir capa textual da obra..."
        );
        try {
          const scan = await quickScanMutation.mutateAsync({
            title,
            textSample: content.slice(0, 15000),
          });
          setForm(current => ({
            ...current,
            subtitle: current.subtitle.trim()
              ? current.subtitle
              : scan.subtitle || "",
            genre: current.genre.trim() ? current.genre : scan.genre || "",
            description:
              current.description.trim() &&
              !current.description.startsWith("Documento importado:")
                ? current.description
                : scan.description || current.description,
          }));
          toast.success(
            "Documento carregado. A IA já sugeriu os primeiros dados da obra."
          );
        } catch (error) {
          toast.info(
            "Documento carregado. A leitura rápida não preencheu os campos, mas a importação completa ainda pode continuar."
          );
        }
      } else {
        toast.success("Documento carregado.");
      }
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    } finally {
      setProcessingMessage("");
    }
  };

  const handleCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Escolha uma imagem válida para a capa.");
      return;
    }
    // 3MB no arquivo bruto = ~4MB depois do encode base64; fica dentro do
    // teto do servidor (5.5MB) e evita travar o navegador com imagens muito
    // grandes sendo seguradas no state como data URL.
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Imagem muito grande. Use uma de até 3 MB.");
      return;
    }
    try {
      const coverImage = await readFileAsDataUrl(file);
      setForm(current => ({ ...current, coverImage }));
      toast.success("Capa carregada.");
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    }
  };

  const handleStyleReferenceUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setProcessingMessage("Lendo a amostra de estilo...");
      const parsed = await parseFile(file);
      const content = parsed.text.trim();
      if (countWords(content) < 80) {
        toast.error(
          "A amostra precisa ter texto suficiente para ensinar ritmo, voz e cena."
        );
        return;
      }

      const sample = {
        title: cleanTitleFromFileName(parsed.fileName) || "Amostra de estilo",
        content,
        fileName: parsed.fileName,
      };
      setManualFlow(current => ({
        ...current,
        hasStyleReference: true,
        styleSample: sample,
        selectedStyleOptionId: "",
        stylePreference: `Amostra de estilo enviada pelo autor: ${sample.title}. Use como essência técnica de voz, ritmo, imagem, densidade, diálogo e subtexto.`,
      }));
      toast.success(
        "Amostra de estilo anexada. Ela será salva na aba Estilo quando a ideia for aprovada."
      );
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    } finally {
      setProcessingMessage("");
    }
  };

  const importReferenceIntoWork = async (
    workId: number,
    reference: CustomReferenceChapter
  ) => {
    let keyChaptersState: KeyChaptersState = {
      ...emptyKeyChaptersState,
      customReferences: [{ ...reference, summaryStatus: "pending" }],
    };

    setProcessingMessage(
      "Salvando o documento como referência bruta da obra..."
    );
    await updateProfileMutation.mutateAsync({
      workId,
      keyChapters: serializeKeyChapters(keyChaptersState),
    });

    const mode = "chaptered";
    setProcessingMessage(
      "A IA está lendo a obra capítulo por capítulo, dividindo capítulos grandes quando necessário..."
    );
    const summary = await summarizeReferenceMutation.mutateAsync({
      workId,
      referenceId: reference.id,
      title: reference.title,
      content: reference.content,
      mode,
    });

    const summarySections = normalizeSummarySections(summary.summarySections);
    const analysisBlocks = summary.analysisBlocks ?? [];
    keyChaptersState = {
      ...keyChaptersState,
      customReferences: keyChaptersState.customReferences.map(item =>
        item.id === reference.id
          ? {
              ...item,
              summary: summary.summary,
              summarySections,
              analysisBlocks,
              summaryStatus: "done" as const,
            }
          : item
      ),
    };
    await updateProfileMutation.mutateAsync({
      workId,
      keyChapters: serializeKeyChapters(keyChaptersState),
    });
  };

  const createWorkFromUpload = async () => {
    if (!referenceDraft) {
      toast.error(
        "Suba o documento completo da obra antes de criar por importação."
      );
      return;
    }

    const title = buildSuggestedTitle(form, referenceDraft);
    const reference: CustomReferenceChapter = {
      id: createReferenceId(
        `${referenceDraft.fileName}:${referenceDraft.content.length}`
      ),
      title: referenceDraft.title,
      content: referenceDraft.content,
      notes: "Documento importado na criação da obra pela Home.",
      fileName: referenceDraft.fileName,
      sourceType: "upload",
      isActive: true,
    };

    try {
      setProcessingMessage("Criando a obra...");
      const created = await createWorkMutation.mutateAsync({
        title,
        subtitle: form.subtitle.trim() || undefined,
        genre: form.genre.trim() || undefined,
        description: form.description.trim() || undefined,
        coverImage: form.coverImage || DEFAULT_COVER_IMAGE,
        coverPositionX: 50,
        coverPositionY: 50,
        coverScale: 100,
        status: "planning",
      });
      setActiveWorkId(created.data.id);
      await importReferenceIntoWork(created.data.id, reference);
      await utils.invalidate();
      toast.success(
        "Obra importada. Os dossiês por capítulo ficaram salvos para revisão."
      );
      goToImportedMaterial();
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    } finally {
      setProcessingMessage("");
    }
  };

  const goToManualStep = async (targetStep: number) => {
    const nextStep = Math.max(0, Math.min(MANUAL_STEPS.length - 1, targetStep));
    if (nextStep >= 2 && !form.description.trim() && !form.title.trim()) {
      toast.error("Escreva uma premissa breve antes de buscar referências.");
      return;
    }
    if (nextStep >= 2) {
      try {
        await ensureIdeaRepertoire();
      } catch {
        return;
      }
    }
    setManualStep(nextStep);
  };

  const continueManualIdea = async () => {
    const title = buildSuggestedTitle(form, null);
    const genre = visibleGenre;
    const stylePreference = manualFlow.styleSample
      ? manualFlow.stylePreference
      : selectedStyleCalibration
        ? [
            selectedStyleCalibration.title,
            "Notas técnicas:",
            selectedStyleCalibration.technicalNotes,
          ]
            .filter(Boolean)
            .join("\n\n")
        : manualFlow.stylePreference;

    if (
      !form.description.trim() &&
      !form.title.trim() &&
      !manualFlow.seedType
    ) {
      toast.error(
        "Escreva uma premissa breve ou informe um título provisório."
      );
      return;
    }

    let resolvedTaste: LiteraryTasteProfile = localLiteraryTaste;
    if (selectedAuthorIds.length || selectedWorkIds.length) {
      try {
        resolvedTaste = await ensureIdeaRepertoire();
      } catch {
        return;
      }
    }
    const validAuthorIds = selectedAuthorIds.filter(id =>
      resolvedTaste.authors.some(author => author.id === id)
    );
    const validWorkIds = selectedWorkIds.filter(id =>
      resolvedTaste.works.some(work => work.id === id)
    );
    const resolvedSelectedAuthors = resolvedTaste.authors.filter(author =>
      validAuthorIds.includes(author.id)
    );
    const resolvedSelectedWorks = resolvedTaste.works.filter(work =>
      validWorkIds.includes(work.id)
    );

    const pendingIdea = {
      title,
      subtitle: form.subtitle.trim(),
      genre,
      description: form.description.trim(),
      tone: [form.tone, ...selectedTone]
        .map(item => item.trim())
        .filter(Boolean)
        .join(", "),
      protagonist: form.protagonist.trim(),
      conflict: form.conflict.trim(),
      setting: form.setting.trim(),
      coverImage: form.coverImage || DEFAULT_COVER_IMAGE,
      stylePreference,
      styleSample: manualFlow.styleSample,
      literaryTaste: {
        detectedSignals: resolvedTaste.detectedSignals,
        selectedAuthors: resolvedSelectedAuthors.map(author => ({
          id: author.id,
          name: author.name,
          reason: author.reason,
          works: author.works,
          toneDirections: author.toneDirections,
        })),
        selectedWorks: resolvedSelectedWorks,
        toneDirections: resolvedTaste.toneDirections,
      },
    };

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        "literary-canvas-pending-idea",
        JSON.stringify(pendingIdea)
      );
    }

    toast.success(
      "Ideia inicial salva. Agora a IA vai aprofundar com perguntas."
    );
    navigate("/ideas");
  };

  const toggleValue = (
    value: string,
    setter: (updater: (current: string[]) => string[]) => void
  ) => {
    setter(current =>
      current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value]
    );
  };

  const step = MANUAL_STEPS[manualStep];

  const legacyCreationPanel = (
    <div className="grid max-w-6xl gap-6 xl:grid-cols-[0.86fr_1.14fr]">
      <section className="space-y-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-accent">
          <BookOpen className="h-3.5 w-3.5" />
          Começar
        </div>
        <div>
          <h2 className="font-display text-3xl text-foreground">
            {hasExistingWorks ? "Crie uma nova obra" : "Crie sua primeira obra"}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            {hasExistingWorks
              ? "Nenhuma obra está ativa agora. Crie uma nova por upload ou comece manualmente; obras pausadas ficam guardadas em Obras."
              : "A Home agora começa pelo que importa: um livro ativo. Você pode subir o documento inteiro para a IA montar o material da obra ou iniciar manualmente com um guia simples."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={cn(
              "group rounded-lg border p-4 text-left transition-colors duration-150 hover:border-accent/50 hover:bg-secondary/55",
              mode === "upload"
                ? "border-accent/60 bg-accent/10"
                : "border-border bg-card"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-accent/30 bg-accent/10 p-2 text-accent">
                <FileUp className="h-5 w-5" />
              </div>
              <div>
                <div className="font-display text-lg text-foreground">
                  Importar documento
                </div>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Suba o livro, capítulo base ou documento completo. A IA lê
                  tudo antes de organizar.
                </p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMode("manual")}
            className={cn(
              "group rounded-lg border p-4 text-left transition-colors duration-150 hover:border-accent/50 hover:bg-secondary/55",
              mode === "manual"
                ? "border-accent/60 bg-accent/10"
                : "border-border bg-card"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-accent/30 bg-accent/10 p-2 text-accent">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="font-display text-lg text-foreground">
                  Desenvolver ideia
                </div>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Responda um guia inicial. A obra só nasce depois que você
                  aprovar a proposta.
                </p>
              </div>
            </div>
          </button>
        </div>

        <Card className="overflow-hidden border border-border bg-card">
          <div className="relative h-44">
            {isDefaultCoverImage(form.coverImage) ? (
              <DefaultCoverArt className="h-full w-full" />
            ) : (
              <img
                src={form.coverImage}
                alt={`Capa de ${buildSuggestedTitle(form, referenceDraft)}`}
                className="h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/35 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-end p-5">
              <div className="text-xs uppercase tracking-[0.25em] text-white/60">
                Prévia
              </div>
              <div className="mt-1 font-display text-2xl text-white">
                {buildSuggestedTitle(form, referenceDraft)}
              </div>
              {form.subtitle.trim() ? (
                <div className="mt-1 text-lg text-white/80">
                  {form.subtitle.trim()}
                </div>
              ) : null}
              <div className="mt-2 text-sm text-white/75">
                {visibleGenre || form.genre || "Gênero a definir"}
              </div>
            </div>
          </div>
        </Card>
      </section>

      <Card className="border border-border bg-card p-5">
        {mode === "upload" ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-accent">
                  <Upload className="h-4 w-4" />
                  Importação completa
                </div>
                <h3 className="mt-2 font-display text-2xl text-foreground">
                  Subir arquivo e criar obra
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Esse caminho cria a obra, salva a referência bruta e gera
                  dossiês por capítulo. Universo, Personagens, Continuidade e
                  Biblioteca ficam para ações manuais depois da importação.
                </p>
              </div>
              <Badge variant="secondary">documento primeiro</Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_0.72fr]">
              <button
                type="button"
                onClick={() => openFileInput(referenceInputRef)}
                disabled={isProcessing}
                className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/40 p-5 text-center transition-colors duration-150 hover:border-accent/50 hover:bg-secondary/50 disabled:pointer-events-none disabled:opacity-60"
              >
                <FileText className="h-8 w-8 text-accent" />
                <span className="mt-3 font-medium text-foreground">
                  {referenceDraft
                    ? referenceDraft.fileName
                    : "Subir documento da obra"}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  Suporta {getSupportedExtensions()}
                </span>
                {referenceDraft ? (
                  <span className="mt-3 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
                    {countWords(referenceDraft.content).toLocaleString("pt-BR")}{" "}
                    palavras
                  </span>
                ) : null}
              </button>
              <input
                ref={referenceInputRef}
                className="hidden"
                type="file"
                accept={getAcceptString()}
                onChange={handleReferenceUpload}
                disabled={isProcessing}
              />

              <CoverUploadTile
                coverImage={form.coverImage}
                onClick={() => openFileInput(coverInputRef)}
                disabled={isProcessing}
              />
              <input
                ref={coverInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                onChange={handleCoverUpload}
                disabled={isProcessing}
              />
            </div>

            <div className="hidden">
              <Input
                value={form.title}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Título"
              />
              <Input
                value={form.subtitle}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    subtitle: event.target.value,
                  }))
                }
                placeholder="Subtítulo"
              />
              <Input
                value={form.genre}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    genre: event.target.value,
                  }))
                }
                placeholder="Gênero"
              />
              <Input
                value={form.tone}
                onChange={event =>
                  setForm(current => ({ ...current, tone: event.target.value }))
                }
                placeholder="Tom desejado"
              />
            </div>
            <Textarea
              className="hidden"
              rows={4}
              value={form.description}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Premissa, promessa narrativa ou observações iniciais. Se subir o documento, pode deixar a IA sugerir."
            />

            {importProgressPhase ? (
              <ImportProgressPanel phase={importProgressPhase} />
            ) : processingMessage ? (
              <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">
                <Loader2 className="h-4 w-4 animate-spin" />
                {processingMessage}
              </div>
            ) : null}

            <Button
              onClick={createWorkFromUpload}
              disabled={isProcessing || !referenceDraft}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Criar obra e importar documento
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-accent">
                    Guia orgânico
                  </div>
                  <h3 className="mt-2 font-display text-2xl text-foreground">
                    {manualFlow.started
                      ? "Vamos descobrir o caminho da obra"
                      : "Vamos começar sua obra?"}
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    O formulário não força título nem gênero. Primeiro a IA
                    entende o ponto de partida, depois pergunta o que falta e só
                    cria a obra quando você aprovar a proposta.
                  </p>
                </div>
                <Badge variant="secondary">manual inteligente</Badge>
              </div>

              {!manualFlow.started ? (
                <button
                  type="button"
                  onClick={() =>
                    setManualFlow(current => ({ ...current, started: true }))
                  }
                  className="group flex min-h-48 w-full flex-col items-center justify-center rounded-lg border border-accent/35 bg-accent/10 p-6 text-center transition-colors duration-150 hover:bg-accent/15"
                >
                  <div className="rounded-full border border-accent/40 bg-accent/15 p-4 text-accent transition-transform duration-200 ">
                    <Sparkles className="h-7 w-7" />
                  </div>
                  <div className="mt-4 font-display text-2xl text-foreground">
                    Vamos começar sua obra?
                  </div>
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    A próxima pergunta define se partimos de uma ideia pronta ou
                    se a IA ajuda a encontrar a faísca inicial.
                  </p>
                </button>
              ) : null}

              {manualFlow.started && manualFlow.hasIdea === null ? (
                <div className="rounded-lg border border-border bg-background/35 p-5">
                  <div className="font-display text-xl text-foreground">
                    Você já tem alguma ideia da sua obra?
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Pode ser só uma cena, um personagem, uma sensação ou um
                    conflito. Se não tiver, a IA começa por perguntas de
                    descoberta.
                  </p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      onClick={() =>
                        setManualFlow(current => ({
                          ...current,
                          hasIdea: true,
                          seedType: "premissa inicial do autor",
                        }))
                      }
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                      Sim, tenho uma ideia
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setManualFlow(current => ({
                          ...current,
                          hasIdea: false,
                        }))
                      }
                    >
                      Ainda não, quero descobrir
                    </Button>
                  </div>
                </div>
              ) : null}

              {manualFlow.started && manualFlow.hasIdea === true ? (
                <div className="space-y-3 rounded-lg border border-border bg-background/35 p-5">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-accent">
                      Ideia livre
                    </div>
                    <h4 className="mt-2 font-display text-xl text-foreground">
                      Me conte do jeito que ela está na sua cabeça
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Não precisa título. Escreva a promessa, o conflito, a
                      cena, o personagem ou só a atmosfera.
                    </p>
                  </div>
                  <Textarea
                    rows={8}
                    value={form.description}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Ex.: uma mulher comum descobre um submundo escondido na internet, e o segredo começa a invadir a vida real..."
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      value={form.genre}
                      onChange={event =>
                        setForm(current => ({
                          ...current,
                          genre: event.target.value,
                        }))
                      }
                      placeholder="Gênero, se já souber (opcional)"
                    />
                    <Input
                      value={form.tone}
                      onChange={event =>
                        setForm(current => ({
                          ...current,
                          tone: event.target.value,
                        }))
                      }
                      placeholder="Tom desejado (opcional)"
                    />
                  </div>
                </div>
              ) : null}

              {manualFlow.started && manualFlow.hasIdea === false ? (
                <div className="space-y-4 rounded-lg border border-border bg-background/35 p-5">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-accent">
                      Descoberta
                    </div>
                    <h4 className="mt-2 font-display text-xl text-foreground">
                      Então vamos achar a faísca
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Escolha o que existe primeiro. A IA muda as próximas
                      perguntas a partir dessa resposta.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {MANUAL_SEED_OPTIONS.map(option => {
                      const active = manualFlow.seedType === option.label;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            setManualFlow(current => ({
                              ...current,
                              seedType: option.label,
                            }))
                          }
                          className={cn(
                            "rounded-lg border p-4 text-left transition-colors duration-150 hover:border-accent/60",
                            active
                              ? "border-accent/70 bg-accent/15 text-foreground"
                              : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <div className="font-medium text-foreground">
                            {option.label}
                          </div>
                          <p className="mt-1 text-sm leading-5">
                            {option.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  <Textarea
                    rows={5}
                    value={form.description}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Escreva qualquer fragmento: uma imagem, um medo, uma pergunta, uma pessoa, um mundo, uma cena..."
                  />
                </div>
              ) : null}

              {manualFlow.started &&
              (form.description.trim() ||
                form.title.trim() ||
                manualFlow.seedType) ? (
                <div className="space-y-4 rounded-lg border border-border bg-background/35 p-5">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-accent">
                      Estilo
                    </div>
                    <h4 className="mt-2 font-display text-xl text-foreground">
                      Você já tem algum exemplo de como quer escrever?
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Se tiver um capítulo ou trecho seu, ele vai para a aba
                      Estilo. Se não tiver, a IA oferece caminhos técnicos
                      usando a mesma situação como teste.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant={
                        manualFlow.hasStyleReference === true
                          ? "default"
                          : "outline"
                      }
                      onClick={() =>
                        setManualFlow(current => ({
                          ...current,
                          hasStyleReference: true,
                          selectedStyleOptionId: "",
                        }))
                      }
                      className={
                        manualFlow.hasStyleReference === true
                          ? "bg-accent text-accent-foreground hover:bg-accent/90"
                          : ""
                      }
                    >
                      Sim, tenho uma amostra
                    </Button>
                    <Button
                      type="button"
                      variant={
                        manualFlow.hasStyleReference === false
                          ? "default"
                          : "outline"
                      }
                      onClick={() =>
                        setManualFlow(current => ({
                          ...current,
                          hasStyleReference: false,
                          styleSample: null,
                        }))
                      }
                      className={
                        manualFlow.hasStyleReference === false
                          ? "bg-accent text-accent-foreground hover:bg-accent/90"
                          : ""
                      }
                    >
                      Não, quero calibrar agora
                    </Button>
                  </div>

                  {manualFlow.hasStyleReference === true ? (
                    <div className="rounded-lg border border-dashed border-border bg-background/45 p-4">
                      <button
                        type="button"
                        onClick={() => openFileInput(styleReferenceInputRef)}
                        disabled={isProcessing}
                        className="flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-border bg-secondary/30 p-4 text-center transition-colors duration-150 hover:border-accent/60"
                      >
                        <FileText className="h-7 w-7 text-accent" />
                        <span className="mt-2 font-medium text-foreground">
                          {manualFlow.styleSample
                            ? manualFlow.styleSample.fileName
                            : "Subir amostra de estilo"}
                        </span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          Capítulo, cena ou trecho autoral. Suporta{" "}
                          {getSupportedExtensions()}
                        </span>
                      </button>
                      <input
                        ref={styleReferenceInputRef}
                        className="hidden"
                        type="file"
                        accept={getAcceptString()}
                        onChange={handleStyleReferenceUpload}
                        disabled={isProcessing}
                      />
                    </div>
                  ) : null}

                  {manualFlow.hasStyleReference === false ? (
                    <div className="space-y-3">
                      {styleOptionsQuery.isFetching ? (
                        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-3 text-sm text-accent">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Gerando quatro caminhos de escrita para a mesma
                          situação...
                        </div>
                      ) : null}
                      <div className="grid gap-3">
                        {styleCalibrationOptions.map(option => {
                          const active =
                            manualFlow.selectedStyleOptionId === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() =>
                                setManualFlow(current => ({
                                  ...current,
                                  selectedStyleOptionId: option.id,
                                  stylePreference: option.technicalNotes,
                                }))
                              }
                              className={cn(
                                "rounded-lg border p-4 text-left transition-colors duration-150 hover:border-accent/60",
                                active
                                  ? "border-accent/70 bg-accent/15"
                                  : "border-border bg-background/40"
                              )}
                            >
                              <div className="font-display text-lg text-foreground">
                                {option.title}
                              </div>
                              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                {option.description}
                              </p>
                              <p className="mt-3 rounded-lg border border-border/70 bg-secondary/35 p-3 text-sm leading-6 text-foreground">
                                {option.example}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-[1fr_0.72fr]">
                <CoverUploadTile
                  coverImage={form.coverImage}
                  onClick={() => openFileInput(coverInputRef)}
                  disabled={isProcessing}
                  compact
                />
                <input
                  ref={coverInputRef}
                  className="hidden"
                  type="file"
                  accept="image/*"
                  onChange={handleCoverUpload}
                  disabled={isProcessing}
                />
                <Button
                  type="button"
                  onClick={() => {
                    setManualFlow(emptyManualFlow);
                    setForm(current => ({
                      ...emptyWorkDraft,
                      coverImage: current.coverImage || DEFAULT_COVER_IMAGE,
                    }));
                    setSelectedGenres([]);
                    setSelectedAuthorIds([]);
                    setSelectedWorkIds([]);
                    setSelectedTone([]);
                    setCustomGenre("");
                  }}
                  variant="outline"
                  disabled={isProcessing}
                >
                  Recomeçar guia
                </Button>
              </div>

              {importProgressPhase ? (
                <ImportProgressPanel phase={importProgressPhase} />
              ) : processingMessage ? (
                <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {processingMessage}
                </div>
              ) : null}

              <Button
                type="button"
                disabled={
                  isProcessing ||
                  !manualFlow.started ||
                  (!form.description.trim() &&
                    !form.title.trim() &&
                    !manualFlow.seedType) ||
                  manualFlow.hasStyleReference === null ||
                  (manualFlow.hasStyleReference === true &&
                    !manualFlow.styleSample) ||
                  (manualFlow.hasStyleReference === false &&
                    !manualFlow.selectedStyleOptionId)
                }
                onClick={() => {
                  void continueManualIdea();
                }}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Desenvolver ideia com a IA
              </Button>
            </div>

            <div className="hidden">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-accent">
                    {step.eyebrow}
                  </div>
                  <h3 className="mt-2 font-display text-2xl text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                <Badge variant="secondary">
                  {manualStep + 1}/{MANUAL_STEPS.length}
                </Badge>
              </div>

              <div className="flex gap-2">
                {MANUAL_STEPS.map((item, index) => (
                  <button
                    key={item.eyebrow}
                    type="button"
                    onClick={() => {
                      void goToManualStep(index);
                    }}
                    className={cn(
                      "h-1.5 flex-1 rounded-full transition-colors",
                      index <= manualStep ? "bg-accent" : "bg-secondary"
                    )}
                    aria-label={`Ir para etapa ${index + 1}`}
                  />
                ))}
              </div>

              {manualStep === 0 ? (
                <div className="space-y-3">
                  <Input
                    value={form.title}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Título provisório (opcional)"
                  />
                  <Input
                    value={form.subtitle}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        subtitle: event.target.value,
                      }))
                    }
                    placeholder="Subtítulo (opcional)"
                  />
                  <Textarea
                    rows={7}
                    value={form.description}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Resumo breve: quem quer o quê, por que isso importa e que tipo de promessa essa história faz ao leitor."
                  />
                </div>
              ) : null}

              {manualStep === 1 ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {GENRE_OPTIONS.map(genre => {
                      const active = selectedGenres.includes(genre);
                      return (
                        <button
                          key={genre}
                          type="button"
                          onClick={() => toggleValue(genre, setSelectedGenres)}
                          className={cn(
                            "rounded-full border px-3 py-2 text-sm transition-colors duration-150",
                            active
                              ? "border-accent/60 bg-accent/15 text-accent"
                              : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {genre}
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    value={customGenre}
                    onChange={event => setCustomGenre(event.target.value)}
                    placeholder="Outro gênero ou mistura específica"
                  />
                </div>
              ) : null}

              {manualStep === 2 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-background/35 p-4 text-sm leading-6 text-muted-foreground">
                    Detectei sinais como{" "}
                    <span className="text-foreground">
                      {literaryTaste.detectedSignals.join(", ") ||
                        "gênero amplo"}
                    </span>
                    . Marque autores que você conhece ou que chegam perto do
                    tipo de experiência que imagina.
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {literaryTaste.authors.map(author => {
                      const active = selectedAuthorIds.includes(author.id);
                      return (
                        <button
                          key={author.id}
                          type="button"
                          onClick={() =>
                            toggleValue(author.id, setSelectedAuthorIds)
                          }
                          className={cn(
                            "rounded-lg border p-4 text-left transition-colors duration-150 hover:border-accent/60",
                            active
                              ? "border-accent/70 bg-accent/15 text-foreground"
                              : "border-border bg-background/35 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-display text-lg text-foreground">
                                {author.name}
                              </div>
                              <p className="mt-1 text-sm leading-5">
                                {author.reason}
                              </p>
                            </div>
                            {active ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Se nenhum fizer sentido, siga sem marcar. A IA continua
                    usando apenas a sua premissa.
                  </p>
                </div>
              ) : null}

              {manualStep === 3 ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-background/35 p-4 text-sm leading-6 text-muted-foreground">
                    Agora marque obras que você conhece. Isso não prende a
                    história nelas; só calibra referências de tom, estrutura e
                    expectativa.
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {visibleWorks.map(work => {
                      const active = selectedWorkIds.includes(work.id);
                      return (
                        <button
                          key={work.id}
                          type="button"
                          onClick={() =>
                            toggleValue(work.id, setSelectedWorkIds)
                          }
                          className={cn(
                            "rounded-lg border px-3 py-3 text-left text-sm transition-colors duration-150 hover:border-accent/60",
                            active
                              ? "border-accent/70 bg-accent/15 text-foreground"
                              : "border-border bg-background/35 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <div className="font-medium text-foreground">
                            {work.title}
                          </div>
                          <div className="mt-1 text-xs">{work.authorName}</div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {selectedAuthorIds.length
                      ? "A lista foi filtrada pelos autores marcados."
                      : "Marque autores na etapa anterior para filtrar esta lista."}
                  </p>
                </div>
              ) : null}

              {manualStep === 4 ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {TONE_OPTIONS.map(tone => {
                      const active = selectedTone.includes(tone);
                      return (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => toggleValue(tone, setSelectedTone)}
                          className={cn(
                            "rounded-full border px-3 py-2 text-sm transition-colors duration-150",
                            active
                              ? "border-accent/60 bg-accent/15 text-accent"
                              : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {tone}
                        </button>
                      );
                    })}
                  </div>
                  <Textarea
                    rows={4}
                    value={form.tone}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        tone: event.target.value,
                      }))
                    }
                    placeholder="Ex.: suspense frio, política paranoica, horror de vigilância, cenas introspectivas e tensão crescente."
                  />
                </div>
              ) : null}

              {manualStep === 5 ? (
                <div className="grid gap-3">
                  <Textarea
                    rows={3}
                    value={form.protagonist}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        protagonist: event.target.value,
                      }))
                    }
                    placeholder="Protagonista, grupo principal ou ponto de vista inicial."
                  />
                  <Textarea
                    rows={3}
                    value={form.conflict}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        conflict: event.target.value,
                      }))
                    }
                    placeholder="Conflito central: o que pressiona a história a acontecer"
                  />
                  <Textarea
                    rows={3}
                    value={form.setting}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        setting: event.target.value,
                      }))
                    }
                    placeholder="Lugar, época, mundo, cidade, instituição ou cenário principal."
                  />
                </div>
              ) : null}

              {manualStep === 6 ? (
                <div className="grid gap-4 md:grid-cols-[0.72fr_1fr]">
                  <CoverUploadTile
                    coverImage={form.coverImage}
                    onClick={() => openFileInput(coverInputRef)}
                    disabled={isProcessing}
                    className="min-h-36"
                    emptyLabel="Subir capa"
                    emptyDescription="Opcional"
                  />
                  <input
                    ref={coverInputRef}
                    className="hidden"
                    type="file"
                    accept="image/*"
                    onChange={handleCoverUpload}
                    disabled={isProcessing}
                  />
                  <div className="rounded-lg border border-border bg-background/40 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      Pronto para criar
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <div>
                        Título:{" "}
                        <span className="text-foreground">
                          {buildSuggestedTitle(form, null)}
                        </span>
                      </div>
                      <div>
                        Gênero:{" "}
                        <span className="text-foreground">
                          {visibleGenre || "a definir"}
                        </span>
                      </div>
                      <div>
                        Referências:{" "}
                        <span className="text-foreground">
                          {selectedAuthors
                            .map(author => author.name)
                            .join(", ") || "nenhuma"}
                        </span>
                      </div>
                      <div>
                        Obras conhecidas:{" "}
                        <span className="text-foreground">
                          {selectedWorks.length || "nenhuma"}
                        </span>
                      </div>
                      <div>
                        Tom:{" "}
                        <span className="text-foreground">
                          {[form.tone, ...selectedTone]
                            .filter(Boolean)
                            .join(", ") || "a definir"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {importProgressPhase ? (
                <ImportProgressPanel phase={importProgressPhase} />
              ) : processingMessage ? (
                <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {processingMessage}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={manualStep === 0 || isProcessing}
                  onClick={() =>
                    setManualStep(current => Math.max(0, current - 1))
                  }
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar
                </Button>
                {manualStep < MANUAL_STEPS.length - 1 ? (
                  <Button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      void goToManualStep(manualStep + 1);
                    }}
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    Próximo
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      void continueManualIdea();
                    }}
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Desenvolver ideia
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );

  void legacyCreationPanel;

  const manualStepCount = 5;
  const manualWizardStep = Math.min(manualStep, manualStepCount - 1);
  const manualHasSeed = Boolean(
    form.description.trim() || form.title.trim() || manualFlow.seedType
  );
  const manualStyleReady =
    manualFlow.hasStyleReference === true
      ? Boolean(manualFlow.styleSample)
      : manualFlow.hasStyleReference === false
        ? Boolean(manualFlow.selectedStyleOptionId)
        : false;
  const manualCanFinish =
    manualFlow.started && manualHasSeed && manualStyleReady;

  const resetManualGuide = () => {
    setManualStep(0);
    setManualFlow(emptyManualFlow);
    setForm(current => ({
      ...emptyWorkDraft,
      coverImage: current.coverImage || DEFAULT_COVER_IMAGE,
    }));
    setSelectedGenres([]);
    setSelectedAuthorIds([]);
    setSelectedWorkIds([]);
    setSelectedTone([]);
    setCustomGenre("");
  };

  const advanceManualGuide = async () => {
    if (manualWizardStep === 0) {
      setManualFlow(current => ({ ...current, started: true }));
      setManualStep(1);
      return;
    }

    if (manualWizardStep === 1) {
      if (manualFlow.hasIdea === null) {
        toast.error(
          "Escolha se você já tem uma ideia ou se quer descobrir uma."
        );
        return;
      }
      setManualStep(2);
      return;
    }

    if (manualWizardStep === 2) {
      if (!manualHasSeed) {
        toast.error(
          "Escreva pelo menos um fragmento ou escolha um ponto de partida."
        );
        return;
      }
      setManualStep(3);
      return;
    }

    if (manualWizardStep === 3) {
      if (manualFlow.hasStyleReference === null) {
        toast.error(
          "Diga se você tem uma amostra de estilo ou se quer calibrar agora."
        );
        return;
      }
      if (manualFlow.hasStyleReference === true && !manualFlow.styleSample) {
        toast.error("Suba a amostra de estilo antes de avançar.");
        return;
      }
      if (
        manualFlow.hasStyleReference === false &&
        !manualFlow.selectedStyleOptionId
      ) {
        toast.error("Escolha uma direção de escrita para calibrar a IA.");
        return;
      }
      setManualStep(4);
      return;
    }
  };

  const creationPanel =
    mode === "upload" ? (
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-accent">
            <Upload className="h-4 w-4" />
            Importação completa
          </div>
          <h3 className="mt-2 font-display text-2xl text-foreground">
            Subir arquivo e criar obra
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Suba o documento da obra e, se quiser, uma capa. A IA vai salvar
            dossiês por capítulo; as demais extrações serão acionadas depois,
            com controle do autor.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_0.72fr]">
          <button
            type="button"
            onClick={() => openFileInput(referenceInputRef)}
            disabled={isProcessing}
            className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/40 p-5 text-center transition-colors duration-150 hover:border-accent/50 hover:bg-secondary/50 disabled:pointer-events-none disabled:opacity-60"
          >
            <FileText className="h-8 w-8 text-accent" />
            <span className="mt-3 font-medium text-foreground">
              {referenceDraft
                ? referenceDraft.fileName
                : "Subir documento da obra"}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              Suporta {getSupportedExtensions()}
            </span>
            {referenceDraft ? (
              <span className="mt-3 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
                {countWords(referenceDraft.content).toLocaleString("pt-BR")}{" "}
                palavras
              </span>
            ) : null}
          </button>
          <input
            ref={referenceInputRef}
            className="hidden"
            type="file"
            accept={getAcceptString()}
            onChange={handleReferenceUpload}
            disabled={isProcessing}
          />

          <CoverUploadTile
            coverImage={form.coverImage}
            onClick={() => openFileInput(coverInputRef)}
            disabled={isProcessing}
          />
          <input
            ref={coverInputRef}
            className="hidden"
            type="file"
            accept="image/*"
            onChange={handleCoverUpload}
            disabled={isProcessing}
          />
        </div>

        {importProgressPhase ? (
          <ImportProgressPanel phase={importProgressPhase} />
        ) : processingMessage ? (
          <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">
            <Loader2 className="h-4 w-4 animate-spin" />
            {processingMessage}
          </div>
        ) : null}

        <Button
          onClick={createWorkFromUpload}
          disabled={isProcessing || !referenceDraft}
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        >
          {isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Criar obra e importar documento
        </Button>
      </div>
    ) : (
      <div className="mx-auto w-full max-w-2xl rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 rounded-lg border border-border/80 bg-secondary/25 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-accent/35 bg-accent/10 p-2.5 text-accent">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-accent">
                  Guia orgânico
                </div>
                <div className="mt-1 font-display text-xl text-foreground">
                  Criação manual assistida
                </div>
              </div>
            </div>
            <Badge
              variant="outline"
              className="border-accent/40 bg-background/60 text-accent"
            >
              Etapa {manualWizardStep + 1} de {manualStepCount}
            </Badge>
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-background/70">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{
                width: `${((manualWizardStep + 1) / manualStepCount) * 100}%`,
              }}
            />
          </div>
        </div>

        <Card className="relative min-h-[360px] overflow-hidden border border-border bg-card p-4 shadow-sm">
          <div className="absolute inset-0 bg-secondary/20" />

          <div className="relative z-10 min-h-[328px] rounded-lg border border-border/70 bg-background/90 p-5">
            {manualWizardStep === 0 ? (
              <div className="flex min-h-[286px] flex-col items-center justify-center rounded-lg border border-border/70 bg-secondary/25 px-6 text-center">
                <div className="rounded-lg border border-accent/35 bg-accent/10 p-3 text-accent">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h3 className="mt-5 font-display text-2xl text-foreground">
                  Vamos começar sua obra?
                </h3>
                <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                  Uma pergunta por vez. Nada de título obrigatório, nada de
                  formulário gigante: a IA acompanha o que você responder e
                  ajusta o caminho.
                </p>
              </div>
            ) : null}

            {manualWizardStep === 1 ? (
              <div className="space-y-5">
                <div>
                  <h3 className="font-display text-2xl text-foreground">
                    Você já tem alguma ideia da sua obra?
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Pode ser uma cena, uma pessoa, um medo, uma imagem ou só uma
                    sensação.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      setManualFlow(current => ({
                        ...current,
                        hasIdea: true,
                        seedType: "premissa inicial do autor",
                      }))
                    }
                    className={cn(
                      "rounded-lg border p-5 text-left transition-colors duration-150 hover:border-accent/60",
                      manualFlow.hasIdea === true
                        ? "border-accent bg-accent text-accent-foreground [&_*]:text-accent-foreground"
                        : "border-border/70 bg-background/85 shadow-sm"
                    )}
                  >
                    <div className="font-display text-lg text-foreground">
                      Sim
                    </div>
                    <p className="mt-2 text-sm leading-5 text-muted-foreground">
                      Quero contar o ponto de partida.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setManualFlow(current => ({ ...current, hasIdea: false }))
                    }
                    className={cn(
                      "rounded-lg border p-5 text-left transition-colors duration-150 hover:border-accent/60",
                      manualFlow.hasIdea === false
                        ? "border-accent bg-accent text-accent-foreground [&_*]:text-accent-foreground"
                        : "border-border/70 bg-background/85 shadow-sm"
                    )}
                  >
                    <div className="font-display text-lg text-foreground">
                      Não
                    </div>
                    <p className="mt-2 text-sm leading-5 text-muted-foreground">
                      Quero descobrir por perguntas.
                    </p>
                  </button>
                </div>
              </div>
            ) : null}

            {manualWizardStep === 2 ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-display text-2xl text-foreground">
                    {manualFlow.hasIdea === false
                      ? "O que existe primeiro?"
                      : "Me conte do jeito que está na sua cabeça"}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {manualFlow.hasIdea === false
                      ? "Escolha uma porta de entrada e escreva qualquer fragmento. A IA completa as perguntas depois."
                      : "Escreva livremente. Pode ser incompleto, bagunçado ou só uma atmosfera."}
                  </p>
                </div>
                {manualFlow.hasIdea === false ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {MANUAL_SEED_OPTIONS.map(option => {
                      const active = manualFlow.seedType === option.label;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            setManualFlow(current => ({
                              ...current,
                              seedType: option.label,
                            }))
                          }
                          className={cn(
                            "rounded-lg border p-4 text-left transition-colors duration-150 hover:border-accent/60",
                            active
                              ? "border-accent bg-accent text-accent-foreground [&_*]:text-accent-foreground"
                              : "border-border/70 bg-background/85 shadow-sm"
                          )}
                        >
                          <div className="font-medium text-foreground">
                            {option.label}
                          </div>
                          <p className="mt-1 text-sm leading-5 text-muted-foreground">
                            {option.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <Textarea
                  rows={manualFlow.hasIdea === false ? 5 : 8}
                  value={form.description}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Escreva qualquer fragmento: uma imagem, um medo, uma pergunta, uma pessoa, um mundo, uma cena..."
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    value={form.genre}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        genre: event.target.value,
                      }))
                    }
                    placeholder="Gênero, se já souber (opcional)"
                  />
                  <Input
                    value={form.tone}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        tone: event.target.value,
                      }))
                    }
                    placeholder="Tom desejado (opcional)"
                  />
                </div>
              </div>
            ) : null}

            {manualWizardStep === 3 ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-display text-2xl text-foreground">
                    Você tem um exemplo do estilo que quer?
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Se tiver uma amostra sua, ela vai para Estilo. Se não tiver,
                    a IA mostra quatro caminhos de escrita para a mesma
                    situação.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant={
                      manualFlow.hasStyleReference === true
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      setManualFlow(current => ({
                        ...current,
                        hasStyleReference: true,
                        selectedStyleOptionId: "",
                      }))
                    }
                    className={
                      manualFlow.hasStyleReference === true
                        ? "bg-accent text-accent-foreground hover:bg-accent/90"
                        : ""
                    }
                  >
                    Sim, tenho amostra
                  </Button>
                  <Button
                    type="button"
                    variant={
                      manualFlow.hasStyleReference === false
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      setManualFlow(current => ({
                        ...current,
                        hasStyleReference: false,
                        styleSample: null,
                      }))
                    }
                    className={
                      manualFlow.hasStyleReference === false
                        ? "bg-accent text-accent-foreground hover:bg-accent/90"
                        : ""
                    }
                  >
                    Não, calibrar agora
                  </Button>
                </div>

                {manualFlow.hasStyleReference === true ? (
                  <button
                    type="button"
                    onClick={() => openFileInput(styleReferenceInputRef)}
                    disabled={isProcessing}
                    className="flex min-h-32 w-full flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/85 p-4 text-center shadow-sm transition-colors duration-150 hover:border-accent/60"
                  >
                    <FileText className="h-7 w-7 text-accent" />
                    <span className="mt-2 font-medium text-foreground">
                      {manualFlow.styleSample
                        ? manualFlow.styleSample.fileName
                        : "Subir amostra de estilo"}
                    </span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      Capítulo, cena ou trecho autoral. Suporta{" "}
                      {getSupportedExtensions()}
                    </span>
                  </button>
                ) : null}
                <input
                  ref={styleReferenceInputRef}
                  className="hidden"
                  type="file"
                  accept={getAcceptString()}
                  onChange={handleStyleReferenceUpload}
                  disabled={isProcessing}
                />

                {manualFlow.hasStyleReference === false ? (
                  <div className="max-h-64 space-y-3 overflow-y-auto pr-1 scrollbar-hide">
                    {styleOptionsQuery.isFetching ? (
                      <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-3 text-sm text-accent">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Gerando quatro caminhos de escrita...
                      </div>
                    ) : null}
                    {styleCalibrationOptions.map(option => {
                      const active =
                        manualFlow.selectedStyleOptionId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            setManualFlow(current => ({
                              ...current,
                              selectedStyleOptionId: option.id,
                              stylePreference: option.technicalNotes,
                            }))
                          }
                          className={cn(
                            "w-full rounded-lg border p-4 text-left transition-colors duration-150 hover:border-accent/60",
                            active
                              ? "border-accent bg-accent text-accent-foreground [&_*]:text-accent-foreground"
                              : "border-border/70 bg-background/85 shadow-sm"
                          )}
                        >
                          <div className="font-display text-lg text-foreground">
                            {option.title}
                          </div>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            {option.description}
                          </p>
                          <p className="mt-3 rounded-lg border border-border/70 bg-background/75 p-3 text-sm leading-6 text-foreground">
                            {option.example}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {manualWizardStep === 4 ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-display text-2xl text-foreground">
                    Últimos detalhes antes da IA desenvolver
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    A ideia ainda não vira obra definitiva. Ela vai para Ideias,
                    onde você aprova ou pede ajustes.
                  </p>
                </div>
                <CoverUploadTile
                  coverImage={form.coverImage}
                  onClick={() => openFileInput(coverInputRef)}
                  disabled={isProcessing}
                  compact
                  className="min-h-28"
                />
                <input
                  ref={coverInputRef}
                  className="hidden"
                  type="file"
                  accept="image/*"
                  onChange={handleCoverUpload}
                  disabled={isProcessing}
                />
                <div className="rounded-lg border border-border/70 bg-background/85 p-4 text-sm leading-6 text-muted-foreground shadow-sm">
                  <div>
                    Título provisório:{" "}
                    <span className="text-foreground">
                      {buildSuggestedTitle(form, null)}
                    </span>
                  </div>
                  <div>
                    Gênero:{" "}
                    <span className="text-foreground">
                      {visibleGenre || "a definir"}
                    </span>
                  </div>
                  <div>
                    Tom:{" "}
                    <span className="text-foreground">
                      {[form.tone, ...selectedTone]
                        .filter(Boolean)
                        .join(", ") || "a definir"}
                    </span>
                  </div>
                  <div>
                    Estilo:{" "}
                    <span className="text-foreground">
                      {manualFlow.styleSample
                        ? manualFlow.styleSample.fileName
                        : selectedStyleCalibration?.title || "a definir"}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        {importProgressPhase ? (
          <ImportProgressPanel phase={importProgressPhase} />
        ) : processingMessage ? (
          <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">
            <Loader2 className="h-4 w-4 animate-spin" />
            {processingMessage}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={manualWizardStep === 0 || isProcessing}
            onClick={() => setManualStep(current => Math.max(0, current - 1))}
            className="border-accent/25 hover:bg-accent/10"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isProcessing}
            onClick={resetManualGuide}
            className="border-accent/25 bg-background/35 text-foreground hover:bg-accent/10"
          >
            Recomeçar
          </Button>
          {manualWizardStep < manualStepCount - 1 ? (
            <Button
              type="button"
              disabled={isProcessing}
              onClick={() => {
                void advanceManualGuide();
              }}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Próximo
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              disabled={isProcessing || !manualCanFinish}
              onClick={() => {
                void continueManualIdea();
              }}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Desenvolver ideia
            </Button>
          )}
        </div>
      </div>
    );

  return (
    <div className="mx-auto flex min-h-[calc(100vh-220px)] max-w-6xl items-center py-8">
      <div className="grid w-full gap-8 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="flex flex-col justify-center">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-accent">
            <BookOpen className="h-3.5 w-3.5" />
            Primeira obra
          </div>
          <h2 className="mt-5 font-display text-4xl text-foreground">
            Crie sua primeira obra
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Suba o arquivo completo para a IA montar o material da obra ou use o
            guia manual quando a história ainda estiver nascendo.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => {
                setMode("upload");
                setShowCreator(true);
              }}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova obra
            </Button>
            <Button
              type="button"
              onClick={() => {
                setMode("manual");
                setShowCreator(true);
              }}
              className="border border-accent/50 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Criar manualmente
            </Button>
          </div>
        </section>

        <button
          type="button"
          onClick={() => {
            setMode("upload");
            setShowCreator(true);
          }}
          className="group overflow-hidden rounded-lg border border-dashed border-border bg-card text-left shadow-sm transition-colors duration-150 hover:border-accent/60 hover:bg-secondary/35"
        >
          <div className="relative h-72">
            <DefaultCoverArt className="h-full w-full" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/35 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-between p-7">
              <div className="flex items-center justify-between">
                <div className="rounded-full border border-accent/40 bg-accent/15 p-3 text-accent">
                  <Plus className="h-7 w-7" />
                </div>
                <Badge
                  variant="secondary"
                  className="bg-background/60 backdrop-blur"
                >
                  comece aqui
                </Badge>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-white/60">
                  Nova obra
                </div>
                <div className="mt-2 font-display text-3xl text-white">
                  Subir arquivo ou começar manual
                </div>
                <p className="mt-3 max-w-md text-sm leading-6 text-white/70">
                  Documento completo, capa opcional e guia por etapas se a
                  história ainda estiver nascendo.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-xs text-white/75">
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 backdrop-blur">
                    upload
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 backdrop-blur">
                    gênero
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 backdrop-blur">
                    perguntas guiadas
                  </span>
                </div>
              </div>
            </div>
          </div>
        </button>
      </div>

      <Dialog
        open={showCreator}
        onOpenChange={open => {
          if (isProcessing) return;
          setShowCreator(open);
        }}
      >
        <DialogContent
          className={cn(
            "max-h-[92vh] overflow-y-auto border-border bg-background p-5",
            mode === "manual" ? "sm:max-w-[720px]" : "sm:max-w-[760px]"
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Nova obra</DialogTitle>
            <DialogDescription>
              Crie uma obra por upload ou por guia manual.
            </DialogDescription>
          </DialogHeader>
          {creationPanel}
        </DialogContent>
      </Dialog>
    </div>
  );
}
