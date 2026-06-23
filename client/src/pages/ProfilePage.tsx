import {
  ChangeEvent,
  CSSProperties,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useActiveWork } from "@/_core/hooks/useActiveWork";
import {
  parseFile,
  getAcceptString,
  getSupportedExtensions,
} from "@/lib/fileParser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DefaultCoverArt,
  isDefaultCoverImage,
} from "@/components/DefaultCoverArt";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ClipboardCheck,
  Compass,
  FileText,
  FileUp,
  Globe2,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Route,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import { CharacterManager } from "@/components/CharacterManager";
import { CharacterTimeline } from "@/components/CharacterTimeline";
import {
  ImportProgressPanel,
  type ImportProgressPhase,
} from "@/components/ImportProgressPanel";
import { FilterChipGroup, FilterToolbar } from "@/components/FilterToolbar";
import {
  CustomReferenceChapter,
  emptyKeyChaptersState,
  KeyChaptersState,
  parseKeyChapters,
  ReferenceSummarySection,
  serializeKeyChapters,
} from "@/lib/keyChapters";
import {
  createStyleSample,
  emptyStyleProfile,
  parseStyleProfile,
  serializeStyleProfile,
  StyleAnalysis,
  StyleProfileState,
} from "@/lib/styleProfile";
import {
  buildUniverseContext,
  emptyUniverseProfile,
  parseUniverseProfile,
  serializeUniverseProfile,
  UniverseProfileState,
} from "@/lib/universeProfile";
import { parseContinuityMemories } from "@shared/continuity";
import EditorialAnalysisTab from "@/components/analysis/EditorialAnalysisTab";
import { matchesFilterQuery, toggleSetValue } from "@/lib/filtering";

const emptyReferenceForm = {
  title: "",
  content: "",
  notes: "",
};

const universeFieldGroups: Array<{
  key: keyof UniverseProfileState;
  label: string;
  placeholder: string;
  rows: number;
}> = [
  {
    key: "overview",
    label: "Visão geral",
    placeholder:
      "O que é este universo, qual é sua promessa narrativa e quais regras gerais sustentam a obra.",
    rows: 5,
  },
  {
    key: "genre",
    label: "Gênero",
    placeholder:
      "Gênero, subgêneros, tom de mercado, mistura de romance histórico, fantasia, thriller político etc.",
    rows: 3,
  },
  {
    key: "timePeriod",
    label: "Período e ano",
    placeholder:
      "Ano, época, calendário, nível tecnológico, passagem de tempo e marcadores históricos.",
    rows: 4,
  },
  {
    key: "locations",
    label: "Lugares",
    placeholder:
      "Países, cidades, cortes, casas, campos de batalha, instituições, dimensões ou ambientes recorrentes.",
    rows: 5,
  },
  {
    key: "narrativeStructure",
    label: "Estrutura narrativa",
    placeholder:
      "Se alterna linhas temporais, núcleos, cartas, documentos, narradores, arcos paralelos ou tramas espelhadas.",
    rows: 4,
  },
  {
    key: "pov",
    label: "POV e foco",
    placeholder:
      "POV único ou múltiplo, distância do narrador, primeira/terceira pessoa, foco por capítulo ou por cena.",
    rows: 4,
  },
  {
    key: "chapterStructure",
    label: "Capítulos",
    placeholder:
      "Padrão de capítulos, interlúdios, cliffhangers, cenas longas/curtas, abertura e fechamento.",
    rows: 4,
  },
  {
    key: "lore",
    label: "Lore",
    placeholder:
      "Mitologia, história do mundo, religião, cosmologia, eventos fundadores e verdades canônicas.",
    rows: 6,
  },
  {
    key: "powerRules",
    label: "Regras de poder",
    placeholder:
      "Magia, tecnologia, política, hierarquias, custo, limite, exceções e consequências do poder.",
    rows: 5,
  },
  {
    key: "factions",
    label: "Facções e instituições",
    placeholder:
      "Famílias, ordens, governos, sociedades, exércitos, empresas, religiões e suas tensões.",
    rows: 5,
  },
  {
    key: "timeline",
    label: "Cronologia",
    placeholder:
      "Eventos históricos e acontecimentos principais em ordem útil para continuidade.",
    rows: 6,
  },
  {
    key: "socialRules",
    label: "Regras sociais",
    placeholder:
      "Leis, tabus, classe, etiqueta, economia, gênero, violência institucional e costumes.",
    rows: 5,
  },
  {
    key: "themesTone",
    label: "Temas e tom",
    placeholder:
      "Temas recorrentes, atmosfera, tipo de conflito, nível de brutalidade, humor, erotismo ou tragédia.",
    rows: 4,
  },
  {
    key: "continuityConstraints",
    label: "Limites canônicos",
    placeholder:
      "Coisas que a IA não pode contradizer ao escrever cenas novas.",
    rows: 5,
  },
  {
    key: "openQuestions",
    label: "Pontas em aberto",
    placeholder:
      "Mistérios, lacunas, perguntas sem resposta e zonas ainda indefinidas.",
    rows: 4,
  },
  {
    key: "notes",
    label: "Notas manuais",
    placeholder: "Observações suas que devem prevalecer sobre a automação.",
    rows: 5,
  },
];

type UploadedReferenceDraft = {
  title: string;
  content: string;
  fileName: string;
  format?: string;
  wordCount?: number;
};

type ReferenceDraftMode = "manual" | "upload";
type WorkStatus =
  | "planning"
  | "in_progress"
  | "paused"
  | "completed"
  | "archived";

type WorkFormState = {
  title: string;
  subtitle: string;
  genre: string;
  description: string;
  coverImage: string;
  status: WorkStatus;
};

type CoverDraft = {
  coverPositionX: number;
  coverPositionY: number;
  coverScale: number;
};

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

type CoverTintCache = Record<number, { source: string; color: RgbColor }>;

const fallbackCoverTint: RgbColor = { r: 86, g: 86, b: 86 };

const emptyWorkForm: WorkFormState = {
  title: "",
  subtitle: "",
  genre: "",
  description: "",
  coverImage: "",
  status: "planning",
};

const defaultCoverDraft: CoverDraft = {
  coverPositionX: 50,
  coverPositionY: 50,
  coverScale: 100,
};

const coverRevealMaskStyle = {
  WebkitMaskImage:
    "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.10) 14%, rgba(0,0,0,0.55) 42%, #000 74%, #000 100%)",
  maskImage:
    "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.10) 14%, rgba(0,0,0,0.55) 42%, #000 74%, #000 100%)",
};

type CoverSettingsSource =
  | {
      coverPositionX: number | null;
      coverPositionY: number | null;
      coverScale: number | null;
    }
  | null
  | undefined;

function getCoverDraft(source: CoverSettingsSource): CoverDraft {
  return {
    coverPositionX: source?.coverPositionX ?? defaultCoverDraft.coverPositionX,
    coverPositionY: source?.coverPositionY ?? defaultCoverDraft.coverPositionY,
    coverScale: source?.coverScale ?? defaultCoverDraft.coverScale,
  };
}

function getCoverImageStyle(source: CoverSettingsSource) {
  const draft = getCoverDraft(source);
  return {
    objectPosition: `${draft.coverPositionX}% ${draft.coverPositionY}%`,
    transform: `scale(${draft.coverScale / 100})`,
    transformOrigin: `${draft.coverPositionX}% ${draft.coverPositionY}%`,
  };
}

function clampColor(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function prepareGlassTint(color: RgbColor) {
  const strongestChannel = Math.max(color.r, color.g, color.b, 1);
  const boost = strongestChannel < 118 ? 118 / strongestChannel : 1;
  return {
    r: clampColor(color.r * boost),
    g: clampColor(color.g * boost),
    b: clampColor(color.b * boost),
  };
}

function getCoverGlassLayerStyle(
  color: RgbColor = fallbackCoverTint
): CSSProperties {
  const tint = prepareGlassTint(color);
  return {
    background: [
      "linear-gradient(90deg, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.42) 16%, rgba(0,0,0,0.22) 34%, rgba(0,0,0,0) 50%)",
      `linear-gradient(90deg, rgba(${tint.r}, ${tint.g}, ${tint.b}, 0.48) 0%, rgba(${tint.r}, ${tint.g}, ${tint.b}, 0.34) 45%, rgba(${tint.r}, ${tint.g}, ${tint.b}, 0.16) 100%)`,
      "linear-gradient(90deg, rgba(12,12,12,0.34) 0%, rgba(8,8,8,0.22) 52%, rgba(0,0,0,0.06) 100%)",
    ].join(", "),
    backdropFilter: "blur(18px) saturate(1.35)",
    WebkitBackdropFilter: "blur(18px) saturate(1.35)",
  };
}

function getCachedCoverTint(
  cache: CoverTintCache,
  workId: number,
  source: string | null
) {
  if (!source) return fallbackCoverTint;
  const cached = cache[workId];
  return cached?.source === source ? cached.color : fallbackCoverTint;
}

function extractDominantCoverColor(source: string): Promise<RgbColor | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const size = 56;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(null);
          return;
        }

        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        const buckets = new Map<
          string,
          { weight: number; r: number; g: number; b: number; count: number }
        >();
        let fallback = { r: 0, g: 0, b: 0, count: 0 };

        for (let i = 0; i < pixels.length; i += 16) {
          const alpha = pixels[i + 3];
          if (alpha < 128) continue;

          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const brightness = (r + g + b) / 3;
          const saturation = max - min;

          fallback.r += r;
          fallback.g += g;
          fallback.b += b;
          fallback.count += 1;

          if (brightness < 24 || brightness > 238 || saturation < 14) continue;

          const key = `${Math.round(r / 24) * 24}-${Math.round(g / 24) * 24}-${Math.round(b / 24) * 24}`;
          const weight = Math.max(
            1,
            saturation * 1.2 + Math.min(brightness, 190) * 0.08
          );
          const bucket = buckets.get(key) ?? {
            weight: 0,
            r: 0,
            g: 0,
            b: 0,
            count: 0,
          };
          bucket.weight += weight;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          bucket.count += 1;
          buckets.set(key, bucket);
        }

        const dominant = Array.from(buckets.values()).sort(
          (a, b) => b.weight - a.weight
        )[0];
        // `dominant` pode ser undefined se TODOS os pixels foram filtrados pela
        // heurística (imagem completamente monocromática/clara/escura). Antes
        // crashava silenciosamente em `dominant.count` e o tint caía no
        // fallback genérico — agora cai no fallback explícito do filtro.
        const sourceColor = dominant?.count
          ? dominant
          : fallback.count
            ? fallback
            : null;
        resolve(
          sourceColor
            ? {
                r: clampColor(sourceColor.r / sourceColor.count),
                g: clampColor(sourceColor.g / sourceColor.count),
                b: clampColor(sourceColor.b / sourceColor.count),
              }
            : null
        );
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function createReferenceId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanSummaryPreview(summary: string) {
  return summary
    .replace(/^Com certeza\.\s*/i, "")
    .replace(/^Claro\.\s*/i, "")
    .replace(/^Aqui est[áa].*\.\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\d+\.\s+\*\*(.*)\*\*/gm, "$1")
    .replace(/^\d+\.\s+/gm, "")
    .trim();
}

function parseSummarySections(summary: string): ReferenceSummarySection[] {
  const cleaned = cleanSummaryPreview(summary);
  const normalized = cleaned.replace(/\r\n/g, "\n");
  const sectionDefs = [
    {
      id: "premissa",
      label: "Premissa",
      match: /Premissa e Conflito Central/i,
    },
    {
      id: "personagens",
      label: "Personagens",
      match: /Personagens Principais/i,
    },
    {
      id: "secundários",
      label: "Secundários",
      match: /Personagens Secund[aá]rios/i,
    },
    {
      id: "eventos",
      label: "Eventos",
      match: /Eventos(:-Chave)|Cronologia de Eventos(:-Chave)/i,
    },
    {
      id: "universo",
      label: "Universo",
      match: /Elementos Estabelecidos do Universo|Worldbuilding/i,
    },
    {
      id: "conflitos",
      label: "Conflitos",
      match: /Arcos de Conflito|Conflitos e Pontas Abertas/i,
    },
    {
      id: "tom",
      label: "Tom e Temas",
      match: /Tom, Estilo Narrativo e Voz|Temas Recorrentes/i,
    },
    {
      id: "estado",
      label: "Estado Final",
      match: /Estado Final da Narrativa/i,
    },
  ];

  const found = sectionDefs
    .map(section => {
      const match = normalized.match(section.match);
      return match?.index != null
        ? { ...section, index: match.index, text: match[0] }
        : null;
    })
    .filter(Boolean) as Array<{
    id: string;
    label: string;
    match: RegExp;
    index: number;
    text: string;
  }>;

  if (!found.length) {
    return [{ id: "resumo", label: "Resumo", content: normalized.trim() }];
  }

  found.sort((a, b) => a.index - b.index);

  return found
    .map((section, idx) => {
      const start = section.index;
      const end =
        idx < found.length - 1 ? found[idx + 1].index : normalized.length;
      const block = normalized.slice(start, end).trim();
      const content = block
        .replace(new RegExp(`^${section.text}\\s*`, "i"), "")
        .trim();
      return {
        id: section.id,
        label: section.label,
        content,
      };
    })
    .filter(section => section.content);
}

function normalizeSummarySections(
  sections: unknown
): ReferenceSummarySection[] | undefined {
  if (!Array.isArray(sections)) return undefined;
  const normalized = sections.filter(
    (section): section is ReferenceSummarySection =>
      Boolean(section.id && section.label && section.content)
  );
  return normalized.length ? normalized : undefined;
}

function countReferenceWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const PROFILE_TAB_IDS = new Set([
  "overview",
  "guide",
  "chapters",
  "style",
  "continuity",
  "universe",
  "characters",
  "timeline",
  "analysis",
  "settings",
]);

const workspaceNavGroups = [
  {
    label: "Comece aqui",
    items: [
      {
        value: "overview",
        label: "Visão geral",
        description: "Status, próxima ação e atalhos do livro",
        icon: Compass,
      },
      {
        value: "guide",
        label: "Guia do livro",
        description: "Sequência clara para preparar a obra",
        icon: ClipboardCheck,
      },
      {
        value: "chapters",
        label: "Material importado",
        description: "Documentos, referências e leitura IA",
        icon: FileUp,
      },
    ],
  },
  {
    label: "Construção",
    items: [
      {
        value: "universe",
        label: "Cânone",
        description: "Universo, regras e limites narrativos",
        icon: Globe2,
      },
      {
        value: "characters",
        label: "Personagens",
        description: "Resumo, papel e história",
        icon: Users,
      },
      {
        value: "style",
        label: "Estilo",
        description: "Voz, tom e amostras de escrita",
        icon: Pencil,
      },
      {
        value: "continuity",
        label: "Continuidade",
        description: "Memórias, estado anterior e pendências",
        icon: RotateCcw,
      },
      {
        value: "timeline",
        label: "Timeline",
        description: "Eventos e ordem narrativa",
        icon: Route,
      },
    ],
  },
  {
    label: "Qualidade",
    items: [
      {
        value: "analysis",
        label: "Análise editorial",
        description: "Consistência, riscos e fortalecimento",
        icon: Sparkles,
      },
    ],
  },
  {
    label: "Livro",
    items: [
      {
        value: "settings",
        label: "Configurações",
        description: "Capa, metadados e status",
        icon: Settings,
      },
    ],
  },
];

function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Falha ao ler a imagem."));
    reader.readAsDataURL(file);
  });
}

export default function ProfilePage() {
  const utils = trpc.useUtils();
  const [location, navigate] = useLocation();
  const {
    activeWorkId,
    activeWork,
    works,
    setActiveWorkId,
    refetch: refetchWorks,
    isLoading: worksLoading,
  } = useActiveWork();
  const profileQuery = trpc.profile?.get.useQuery(
    { workId: activeWorkId ?? undefined },
    { enabled: Boolean(activeWorkId) }
  );
  const chaptersQuery = trpc.writing.list.useQuery();
  const charactersQuery = trpc.characters?.list.useQuery(undefined, {
    enabled: Boolean(activeWorkId),
  });
  const trashQuery = trpc.works.listTrash.useQuery();

  const [showNewWorkPanel, setShowNewWorkPanel] = useState(false);
  const [showTrashDialog, setShowTrashDialog] = useState(false);
  const [workSearch, setWorkSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<Set<string>>(
    () => new Set()
  );
  const [locallyTrashedWorkIds, setLocallyTrashedWorkIds] = useState<
    Set<number>
  >(() => new Set());
  const [coverTintCache, setCoverTintCache] = useState<CoverTintCache>({});
  const [deleteConfirmWork, setDeleteConfirmWork] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [permanentDeleteConfirmWork, setPermanentDeleteConfirmWork] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const newWorkReferenceInputRef = useRef<HTMLInputElement>(null);
  const newWorkCoverInputRef = useRef<HTMLInputElement>(null);
  const activeWorkCoverInputRef = useRef<HTMLInputElement>(null);
  const styleSampleInputRef = useRef<HTMLInputElement>(null);
  const referenceUploadInputRef = useRef<HTMLInputElement>(null);
  const foundationUploadInputRef = useRef<HTMLInputElement>(null);
  const [profileWorkspaceOpen, setProfileWorkspaceOpen] = useState(false);
  const [newWorkForm, setNewWorkForm] = useState<WorkFormState>(emptyWorkForm);
  const [newWorkReferenceDraft, setNewWorkReferenceDraft] =
    useState<UploadedReferenceDraft | null>(null);
  const [coverDraft, setCoverDraft] = useState<CoverDraft>(defaultCoverDraft);
  const [workInfoEditorOpen, setWorkInfoEditorOpen] = useState(false);
  const [workInfoForm, setWorkInfoForm] = useState({
    title: "",
    subtitle: "",
    genre: "",
    description: "",
  });
  const [styleNotes, setStyleNotes] = useState("");
  const [styleSamples, setStyleSamples] = useState<
    StyleProfileState["samples"]
  >([]);
  const [uploadingStyleSamples, setUploadingStyleSamples] = useState(false);
  const [analyzingStyleSampleId, setAnalyzingStyleSampleId] = useState<
    string | null
  >(null);
  const styleProfileRef = useRef<StyleProfileState>(emptyStyleProfile);
  const [universeProfile, setUniverseProfile] =
    useState<UniverseProfileState>(emptyUniverseProfile);
  const [storyFoundation, setStoryFoundation] = useState("");
  const [keyChaptersState, setKeyChaptersState] = useState<KeyChaptersState>(
    emptyKeyChaptersState
  );
  const keyChaptersStateRef = useRef<KeyChaptersState>(emptyKeyChaptersState);
  const [referenceForm, setReferenceForm] = useState(emptyReferenceForm);
  const [uploadedReferenceDraft, setUploadedReferenceDraft] =
    useState<UploadedReferenceDraft | null>(null);
  const [parsingReferenceUpload, setParsingReferenceUpload] = useState(false);
  const [editingReferenceId, setEditingReferenceId] = useState<string | null>(
    null
  );
  const [editingReferenceType, setEditingReferenceType] = useState<
    "manual" | "upload" | null
  >(null);
  const [referenceDraftMode, setReferenceDraftMode] =
    useState<ReferenceDraftMode>("manual");
  const [charactersTabDirty, setCharactersTabDirty] = useState(false);
  const [activeSummarySectionByReference, setActiveSummarySectionByReference] =
    useState<Record<string, string>>({});
  const summarySectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const summaryScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const processingModeConfirmedRef = useRef(false);
  const lastLoadedProfileRef = useRef<{
    narrativeStyle: string;
    universeProfile: string;
    storyFoundation: string;
    keyChapters: string;
  } | null>(null);
  const [processingModeDialog, setProcessingModeDialog] = useState<{
    open: boolean;
    reference: CustomReferenceChapter | null;
    wordCount: number;
    chunks: number;
  }>({ open: false, reference: null, wordCount: 0, chunks: 0 });
  const [processingModeByRef, setProcessingModeByRef] = useState<
    Record<string, "chunks" | "integral" | "chaptered">
  >({});
  const profileLoaded = Boolean(profileQuery.data);
  const loadedNarrativeStyle = profileQuery.data?.narrativeStyle || "";
  const loadedNegativeRules = profileQuery.data?.negativeRules || "";
  const loadedStoryFoundation = profileQuery.data?.storyFoundation || "";
  const loadedKeyChapters = profileQuery.data?.keyChapters;
  const loadedKeyChaptersSignature =
    typeof loadedKeyChapters === "string"
      ? loadedKeyChapters
      : JSON.stringify(loadedKeyChapters ?? null);

  const updateStyleProfileState = useCallback(
    (updater: (current: StyleProfileState) => StyleProfileState) => {
      const nextState = updater(styleProfileRef.current);
      styleProfileRef.current = nextState;
      setStyleNotes(nextState.notes);
      setStyleSamples(nextState.samples);
      return nextState;
    },
    []
  );

  const updateKeyChaptersState = useCallback(
    (updater: (current: KeyChaptersState) => KeyChaptersState) => {
      const nextState = updater(keyChaptersStateRef.current);
      keyChaptersStateRef.current = nextState;
      setKeyChaptersState(nextState);
      return nextState;
    },
    []
  );

  const openFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>) => {
      if (!ref.current) return;
      ref.current.value = "";
      ref.current.click();
    },
    []
  );

  useEffect(() => {
    lastLoadedProfileRef.current = null;
    setCharactersTabDirty(false);
    if (!activeWorkId) return;
    void Promise.all([
      profileQuery.refetch(),
      chaptersQuery.refetch(),
      utils.characters?.list.invalidate(),
    ]);
    // `profileQuery/chaptersQuery/utils` mudam pouco e sua identidade é estável
    // para `trpc.useUtils()`/`useQuery()`; intencionalmente fora das deps para
    // evitar refetch a cada render. Se virar problema futuro (HMR, hot swap
    // de cache provider), usar useRef e estabilizar os handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkId]);

  useEffect(() => {
    setCoverDraft(getCoverDraft(activeWork));
  }, [
    activeWork?.id,
    activeWork?.coverPositionX,
    activeWork?.coverPositionY,
    activeWork?.coverScale,
  ]);

  useEffect(() => {
    if (!activeWork || workInfoEditorOpen) return;
    setWorkInfoForm({
      title: activeWork?.title || "",
      subtitle: activeWork?.subtitle || "",
      genre: activeWork?.genre || "",
      description: activeWork?.description || "",
    });
  }, [
    activeWork?.id,
    activeWork?.title,
    activeWork?.subtitle,
    activeWork?.genre,
    activeWork?.description,
    workInfoEditorOpen,
  ]);

  useEffect(() => {
    if (!profileLoaded) return;
    const nextStyleProfile = parseStyleProfile(loadedNarrativeStyle);
    const nextUniverseProfile = parseUniverseProfile(loadedNegativeRules);
    const nextKeyChaptersState = parseKeyChapters(loadedKeyChapters);
    const nextSnapshot = {
      narrativeStyle: serializeStyleProfile(nextStyleProfile),
      universeProfile: JSON.stringify(
        serializeUniverseProfile(nextUniverseProfile)
      ),
      storyFoundation: loadedStoryFoundation,
      keyChapters: JSON.stringify(serializeKeyChapters(nextKeyChaptersState)),
    };
    const previousSnapshot = lastLoadedProfileRef.current;

    if (
      !previousSnapshot ||
      serializeStyleProfile(styleProfileRef.current) ===
        previousSnapshot.narrativeStyle
    ) {
      styleProfileRef.current = nextStyleProfile;
      setStyleNotes(nextStyleProfile.notes);
      setStyleSamples(nextStyleProfile.samples);
    }

    setUniverseProfile(current =>
      !previousSnapshot ||
      JSON.stringify(serializeUniverseProfile(current)) ===
        previousSnapshot.universeProfile
        ? nextUniverseProfile
        : current
    );

    setStoryFoundation(current =>
      !previousSnapshot || current === previousSnapshot.storyFoundation
        ? nextSnapshot.storyFoundation
        : current
    );

    setKeyChaptersState(current => {
      const nextState =
        !previousSnapshot ||
        JSON.stringify(serializeKeyChapters(current)) ===
          previousSnapshot.keyChapters
          ? nextKeyChaptersState
          : current;
      keyChaptersStateRef.current = nextState;
      return nextState;
    });

    lastLoadedProfileRef.current = nextSnapshot;
  }, [
    loadedKeyChaptersSignature,
    loadedNarrativeStyle,
    loadedNegativeRules,
    loadedStoryFoundation,
    profileLoaded,
  ]);

  const visibleWorks = useMemo(
    () =>
      works.filter(
        work => !work.deletedAt && !locallyTrashedWorkIds.has(work.id)
      ),
    [works, locallyTrashedWorkIds]
  );

  const workStatusCounts = useMemo(() => {
    return visibleWorks.reduce<Record<string, number>>((acc, work) => {
      acc[work.status] = (acc[work.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [visibleWorks]);

  useEffect(() => {
    const trashWorks = trashQuery.data?.data ?? [];
    const candidates = [...visibleWorks, ...trashWorks].filter(work => {
      if (!work.coverImage || isDefaultCoverImage(work.coverImage))
        return false;
      return coverTintCache[work.id]?.source !== work.coverImage;
    });

    if (candidates.length === 0) return;

    let cancelled = false;
    void Promise.all(
      candidates.map(async work => ({
        id: work.id,
        source: work.coverImage as string,
        color: await extractDominantCoverColor(work.coverImage as string),
      }))
    ).then(results => {
      if (cancelled) return;
      setCoverTintCache(current => {
        let changed = false;
        const next = { ...current };
        for (const result of results) {
          if (!result.color) continue;
          if (next[result.id]?.source === result.source) continue;
          next[result.id] = { source: result.source, color: result.color };
          changed = true;
        }
        return changed ? next : current;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [coverTintCache, trashQuery.data?.data, visibleWorks]);

  const filteredWorks = useMemo(() => {
    return visibleWorks.filter(work => {
      const matchesStatus =
        statusFilters.size === 0 || statusFilters.has(work.status);
      const matchesSearch = matchesFilterQuery(workSearch, [
        work.title,
        work.subtitle,
        work.genre,
        work.description,
        work.status,
      ]);
      return matchesStatus && matchesSearch;
    });
  }, [visibleWorks, statusFilters, workSearch]);

  const toggleStatusFilter = useCallback((status: string) => {
    setStatusFilters(prev => toggleSetValue(prev, status));
  }, []);

  const statusFilterOptions: Array<{ value: string; label: string }> = [
    { value: "planning", label: "Planejando" },
    { value: "in_progress", label: "Em progresso" },
    { value: "paused", label: "Pausada" },
    { value: "completed", label: "Completa" },
    { value: "archived", label: "Arquivada" },
  ];

  const updateMutation = trpc.profile?.update.useMutation({
    onSuccess: async () => {
      toast.success("Livro salvo.");
      await profileQuery.refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const silentStyleMutation = trpc.profile?.update.useMutation({
    onSuccess: async () => {
      await profileQuery.refetch();
    },
    onError: error => toast.error(`Falha ao salvar estilo: ${error.message}`),
  });

  const analyzeStyleMutation = trpc.profile?.analyzeStyle.useMutation({
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const createWorkMutation = trpc.works.create.useMutation({
    onSuccess: async result => {
      toast.success(
        `Obra "${result.data.title}" criada. Agora é a obra ativa.`
      );
      setNewWorkForm(emptyWorkForm);
      setNewWorkReferenceDraft(null);
      setShowNewWorkPanel(false);
      setProfileWorkspaceOpen(true);
      setActiveWorkId(result.data.id);
      await Promise.all([
        refetchWorks(),
        utils.works.list.invalidate(),
        utils.profile?.get.invalidate(),
        utils.writing.list.invalidate(),
        utils.characters?.list.invalidate(),
      ]);
      setActiveTab("overview");
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const updateWorkMutation = trpc.works.update.useMutation({
    onSuccess: async (result, variables) => {
      toast.success("Obra atualizada.");
      if (variables.status === "paused" && activeWorkId === variables.workId) {
        const nextActive = visibleWorks.find(
          work => work.id !== variables.workId && work.status !== "paused"
        );
        setActiveWorkId(nextActive?.id ?? null);
      } else if (
        variables.status &&
        variables.status !== "paused" &&
        !activeWorkId
      ) {
        setActiveWorkId(result.data.id);
      }
      await Promise.all(
        [
          refetchWorks(),
          utils.works.list.invalidate(),
          // Outras telas (Perfil/Estatísticas/Biblioteca) também derivam dados
          // da obra; sem invalidar aqui, ficavam com cache obsoleto após
          // mudança de capa/título/descrição.
          utils.profile?.get.invalidate(),
          utils.statistics?.getDashboard.invalidate?.(),
        ].filter(Boolean)
      );
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const softDeleteMutation = trpc.works.softDelete.useMutation({
    onSuccess: async (_, variables) => {
      toast.success("Obra movida para a lixeira.");
      setLocallyTrashedWorkIds(current =>
        new Set(current).add(variables.workId)
      );
      if (activeWorkId === variables.workId) {
        const remaining = visibleWorks.filter(
          w => w.id !== variables.workId && w.status !== "paused"
        );
        setActiveWorkId(remaining[0]?.id ?? null);
      }
      setDeleteConfirmWork(null);
      await Promise.all([
        refetchWorks(),
        utils.works.list.invalidate(),
        utils.works.listTrash.invalidate(),
      ]);
      await utils.invalidate();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const restoreMutation = trpc.works.restore.useMutation({
    onSuccess: async (_, variables) => {
      toast.success("Obra restaurada com sucesso.");
      setShowTrashDialog(true);
      setActiveWorkId(variables.workId);
      setLocallyTrashedWorkIds(current => {
        const next = new Set(current);
        next.delete(variables.workId);
        return next;
      });
      await Promise.all([
        refetchWorks(),
        utils.works.list.invalidate(),
        utils.works.listTrash.invalidate(),
      ]);
      await utils.invalidate();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const permanentDeleteMutation = trpc.works.permanentDelete.useMutation({
    onSuccess: async (_, variables) => {
      toast.success("Obra excluída permanentemente.");
      setShowTrashDialog(true);
      if (activeWorkId === variables.workId) {
        setActiveWorkId(null);
      }
      setLocallyTrashedWorkIds(current => {
        const next = new Set(current);
        next.delete(variables.workId);
        return next;
      });
      setPermanentDeleteConfirmWork(null);
      await Promise.all([
        refetchWorks(),
        utils.works.list.invalidate(),
        utils.works.listTrash.invalidate(),
      ]);
      await utils.invalidate();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const silentKeyChaptersMutation = trpc.profile?.update.useMutation({
    onSuccess: async () => {
      await profileQuery.refetch();
    },
    onError: error =>
      toast.error(`Falha ao salvar material importado: ${error.message}`),
  });

  const summarizeMutation = trpc.profile?.summarizeReference.useMutation({
    onSuccess: async (data, variables) => {
      const nextState = updateKeyChaptersState(prev => ({
        ...prev,
        customReferences: prev.customReferences.map(item => {
          const isTarget = variables.referenceId
            ? item.id === variables.referenceId
            : item.title === variables.title;
          if (isTarget) {
            return {
              ...item,
              summary: data.summary,
              summarySections: normalizeSummarySections(data.summarySections),
              analysisBlocks: data.analysisBlocks ?? [],
              summaryStatus: "done" as const,
            };
          }
          return item;
        }),
      }));
      await silentKeyChaptersMutation.mutateAsync({
        workId: variables.workId,
        keyChapters: serializeKeyChapters(nextState),
      });
      const blocksInfo = ` em ${data.blocks ?? data.chunks} dossiê(s) por capítulo`;
      toast.success(
        `Dossiês por capítulo salvos para "${variables.title}" (${data.wordCount.toLocaleString("pt-BR")} palavras${blocksInfo}, ${data.cost} créditos flexíveis).`
      );
    },
    onError: (error, variables) => {
      toast.error(`Erro ao gerar resumo: ${error.message}`);
      updateKeyChaptersState(prev => ({
        ...prev,
        customReferences: prev.customReferences.map(item =>
          variables.referenceId
            ? item.id === variables.referenceId
              ? { ...item, summaryStatus: "error" as const }
              : item
            : item.summaryStatus === "pending"
              ? { ...item, summaryStatus: "error" as const }
              : item
        ),
      }));
    },
  });

  const analyzeUniverseMutation = trpc.profile?.analyzeUniverse.useMutation({
    onSuccess: async data => {
      setUniverseProfile(data.data);
      await profileQuery.refetch();
      toast.success("Universo atualizado a partir dos dossiês da obra.");
    },
    onError: error =>
      toast.error(`Falha ao analisar universo: ${error.message}`),
  });

  const syncImportedReferenceMutation =
    trpc.profile?.syncImportedReference.useMutation({
      onSuccess: async (data, variables) => {
        const nextState = updateKeyChaptersState(prev => ({
          ...prev,
          customReferences: prev.customReferences.map(item =>
            item.id === variables.referenceId
              ? {
                  ...item,
                  continuitySnippet: data.continuitySnippet || undefined,
                  ...(data.charactersUpdated
                    ? {
                        importedCharacterIds: data.importedCharacterIds.length
                          ? data.importedCharacterIds
                          : undefined,
                      }
                    : {}),
                  ...(data.timelineUpdated
                    ? {
                        importedTimelineEvents: data.importedTimelineEvents
                          .length
                          ? data.importedTimelineEvents
                          : undefined,
                      }
                    : {}),
                }
              : item
          ),
        }));
        await silentKeyChaptersMutation.mutateAsync({
          workId: variables.workId,
          keyChapters: serializeKeyChapters(nextState),
        });
        await Promise.all([
          utils.characters?.list.invalidate(),
          utils.profile?.get.invalidate(),
          charactersQuery.refetch(),
        ]);

        const parts: string[] = [];
        if (data.continuitySnippet) parts.push("continuidade atualizada");
        if (data.createdCount) parts.push(`${data.createdCount} personagem(ns)`);
        if (data.updatedCount) parts.push(`${data.updatedCount} atualizado(s)`);
        if (data.deletedCount) parts.push(`${data.deletedCount} removido(s)`);
        if (data.libraryCreatedCount)
          parts.push(`${data.libraryCreatedCount} entrada(s) na Biblioteca`);
        if (data.timelineUpdated && data.importedTimelineEvents.length)
          parts.push(`${data.importedTimelineEvents.length} evento(s) na Timeline`);

        if (parts.length) {
          toast.success(`Importação conectada ao perfil: ${parts.join(", ")}.`);
        } else if (data.charactersUpdated) {
          toast.info(
            "Extração de personagens concluída, mas nenhum resumo mudou."
          );
        } else if (data.timelineUpdated) {
          toast.info("Timeline atualizada, mas nenhum evento novo foi encontrado.");
        }

        if (data.libraryCreatedCount) {
          utils.library.list.invalidate();
        }
      },
      onError: error => {
        toast.error(
          `Falha ao conectar a referência ao perfil: ${error.message}`
        );
      },
    });

  const chapters = chaptersQuery.data?.data || [];
  const characters = charactersQuery.data?.data || [];
  const importProgressPhase: ImportProgressPhase | null =
    summarizeMutation.isPending
      ? "summary"
      : syncImportedReferenceMutation.isPending
        ? "sync"
        : analyzeUniverseMutation.isPending
          ? "universe"
          : null;

  // Razão amigável para desabilitar "Rodar análise" na aba de Análise editorial.
  // O servidor aceita tanto capítulos quanto referências importadas (upload
  // integral). Aqui replicamos a mesma lógica do server (loadAnalysisChapters):
  // se há chapters com texto → ok; senão se há referências com texto → ok;
  // senão devolve mensagem amigável.
  const analysisNoTextReason = useMemo<string | null>(() => {
    if (chaptersQuery.isPending || profileQuery.isPending) return null;
    const chapterWords = chapters.reduce(
      (sum: number, chapter: { content: string }) => {
        return (
          sum +
          (chapter.content || "").trim().split(/\s+/).filter(Boolean).length
        );
      },
      0
    );
    if (chapterWords >= 100) return null;

    // Fallback: olha referências em authorProfile.keyChapters.
    let referenceWords = 0;
    const raw = profileQuery.data?.keyChapters;
    if (typeof raw === "string" && raw) {
      try {
        const parsed = JSON.parse(raw);
        const refs = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.customReferences)
            ? parsed.customReferences
            : [];
        for (const r of refs) {
          if (
            r &&
            typeof r === "object" &&
            r.isActive !== false &&
            typeof r.content === "string"
          ) {
            referenceWords += r.content
              .trim()
              .split(/\s+/)
              .filter(Boolean).length;
          }
        }
      } catch {
        // ignora — fallback silencioso
      }
    }
    if (referenceWords >= 100) return null;

    if (chapters.length === 0 && referenceWords === 0) {
      return "Sua obra ainda não tem capítulos nem referências para analisar. Suba o livro integral ou gere capítulos primeiro.";
    }
    return "Texto insuficiente para análise (mínimo ~100 palavras).";
  }, [
    chapters,
    chaptersQuery.isPending,
    profileQuery.data?.keyChapters,
    profileQuery.isPending,
  ]);

  const continuityMemories = useMemo(
    () => parseContinuityMemories(profileQuery.data?.continuityMemories),
    [profileQuery.data]
  );

  const styleProfileState = useMemo<StyleProfileState>(
    () => ({ notes: styleNotes, samples: styleSamples }),
    [styleNotes, styleSamples]
  );
  const activeStyleSamples = styleSamples.filter(sample => sample.isActive);
  const styleWordCount = activeStyleSamples.reduce(
    (total, sample) =>
      total + sample.content.split(/\s+/).filter(Boolean).length,
    0
  );
  const unsavedStyle =
    serializeStyleProfile(styleProfileState) !==
    serializeStyleProfile(parseStyleProfile(profileQuery.data?.narrativeStyle));
  const unsavedUniverse = useMemo(() => {
    const saved = parseUniverseProfile(profileQuery.data?.negativeRules);
    return (
      JSON.stringify(serializeUniverseProfile(saved)) !==
      JSON.stringify(serializeUniverseProfile(universeProfile))
    );
  }, [universeProfile, profileQuery.data]);
  const unsavedKeyChapters = useMemo(() => {
    const saved = parseKeyChapters(profileQuery.data?.keyChapters);
    return (
      JSON.stringify(serializeKeyChapters(saved)) !==
      JSON.stringify(serializeKeyChapters(keyChaptersState))
    );
  }, [keyChaptersState, profileQuery.data]);
  const unsavedFoundation =
    storyFoundation !== (profileQuery.data?.storyFoundation || "");
  const hasUnsavedProfileChanges =
    unsavedStyle || unsavedUniverse || unsavedKeyChapters || unsavedFoundation;

  const [activeTab, setActiveTab] = useState("overview");
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const requestedProfileTab = useMemo(() => {
    // wouter's location is path-only — read query from window.location.search.
    const query = typeof window !== "undefined" ? window.location.search : "";
    const tab = new URLSearchParams(query).get("tab");
    if (tab === "audit" || tab === "improvements") return "analysis";
    return tab && PROFILE_TAB_IDS.has(tab) ? tab : null;
  }, [location]);
  const requestedCreateWork = useMemo(() => {
    const query = typeof window !== "undefined" ? window.location.search : "";
    return new URLSearchParams(query).get("createWork") === "1";
  }, [location]);

  useEffect(() => {
    if (!requestedProfileTab || !activeWorkId) return;
    setProfileWorkspaceOpen(true);
    setActiveTab(requestedProfileTab);
  }, [activeWorkId, requestedProfileTab]);

  useEffect(() => {
    if (!requestedCreateWork) return;
    setProfileWorkspaceOpen(false);
    setShowNewWorkPanel(true);
  }, [requestedCreateWork]);

  const dirtyMap: Record<string, boolean> = useMemo(
    () => ({
      style: unsavedStyle,
      chapters: unsavedKeyChapters,
      continuity: unsavedFoundation,
      universe: unsavedUniverse,
      characters: charactersTabDirty,
    }),
    [
      unsavedStyle,
      unsavedKeyChapters,
      unsavedFoundation,
      unsavedUniverse,
      charactersTabDirty,
    ]
  );

  const handleCharactersDirtyChange = useCallback((dirty: boolean) => {
    setCharactersTabDirty(current => (current === dirty ? current : dirty));
  }, []);

  const handleTabChange = useCallback(
    (newTab: string) => {
      if (dirtyMap[activeTab]) {
        setPendingTab(newTab);
      } else {
        setActiveTab(newTab);
      }
    },
    [activeTab, dirtyMap]
  );

  const confirmTabSwitch = useCallback(() => {
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  }, [pendingTab]);

  const goToImportedMaterial = useCallback(() => {
    setProfileWorkspaceOpen(true);
    setShowNewWorkPanel(false);
    setActiveTab("chapters");
    setPendingTab(null);
    navigate("/works?tab=chapters&imported=1");
  }, [navigate]);

  const handleSelectWork = useCallback(
    (workId: number) => {
      if (workId === activeWorkId && profileWorkspaceOpen) return;
      if (
        profileWorkspaceOpen &&
        (hasUnsavedProfileChanges || charactersTabDirty)
      ) {
        toast.error("Salve o perfil atual antes de trocar de obra.");
        return;
      }
      setActiveWorkId(workId);
      setProfileWorkspaceOpen(true);
      setShowNewWorkPanel(false);
      setActiveTab("overview");
      setPendingTab(null);
    },
    [
      activeWorkId,
      charactersTabDirty,
      hasUnsavedProfileChanges,
      profileWorkspaceOpen,
      setActiveWorkId,
    ]
  );

  const handleReturnToWorks = useCallback(
    (openNewWork = false) => {
      if (hasUnsavedProfileChanges || charactersTabDirty) {
        toast.error("Salve o perfil atual antes de voltar para as obras.");
        return;
      }
      setProfileWorkspaceOpen(false);
      setShowNewWorkPanel(openNewWork);
      setPendingTab(null);
    },
    [charactersTabDirty, hasUnsavedProfileChanges]
  );

  const linkedExistingCount = keyChaptersState.linkedChapters.length;
  const activeContinuityMemories = continuityMemories.filter(
    item => item.isActive
  ).length;
  const savedReferences = keyChaptersState.customReferences;
  const uploadedReferences = useMemo(
    () => savedReferences.filter(item => item.sourceType === "upload"),
    [savedReferences]
  );
  const dossierReferences = useMemo(
    () => savedReferences.filter(item => (item.analysisBlocks ?? []).length),
    [savedReferences]
  );
  const importedCharacterLinks = useMemo(
    () =>
      Array.from(
        new Set(
          savedReferences.flatMap(item => item.importedCharacterIds ?? [])
        )
      ),
    [savedReferences]
  );
  const characterSyncReference = useMemo(
    () =>
      savedReferences.find(
        item =>
          (item.analysisBlocks ?? []).length &&
          !(item.importedCharacterIds ?? []).length
      ) ??
      savedReferences.find(item => (item.analysisBlocks ?? []).length) ??
      null,
    [savedReferences]
  );
  const importedContinuityReferences = useMemo(
    () => savedReferences.filter(item => (item.continuitySnippet ?? "").trim()),
    [savedReferences]
  );

  const handleSaveStyle = async () => {
    await updateMutation.mutateAsync({
      narrativeStyle: serializeStyleProfile(styleProfileRef.current),
    });
  };

  const persistStyleProfile = async (state: StyleProfileState) => {
    try {
      await silentStyleMutation.mutateAsync({
        narrativeStyle: serializeStyleProfile(state),
      });
      return true;
    } catch {
      return false;
    }
  };

  const handleSaveFullProfile = async () => {
    await updateMutation.mutateAsync({
      narrativeStyle: serializeStyleProfile(styleProfileRef.current),
      negativeRules: serializeUniverseProfile(universeProfile),
      keyChapters: serializeKeyChapters(keyChaptersState),
      storyFoundation,
    });
  };

  const importReferenceIntoWork = async (
    reference: CustomReferenceChapter,
    workId: number
  ) => {
    const nextState: KeyChaptersState = {
      ...emptyKeyChaptersState,
      customReferences: [reference],
    };
    keyChaptersStateRef.current = nextState;
    setKeyChaptersState(nextState);
    await silentKeyChaptersMutation.mutateAsync({
      workId,
      keyChapters: serializeKeyChapters(nextState),
    });

    const wordCount = countReferenceWords(reference.content);
    if (wordCount > LARGE_TEXT_THRESHOLD && !reference.summary) {
      const chunks = Math.ceil(wordCount / 4000);
      setProcessingModeDialog({ open: true, reference, wordCount, chunks });
      return;
    }

    triggerReferenceSummary(reference, "chaptered", workId);
  };

  const handleCreateWorkFromProfile = async () => {
    const title =
      newWorkForm.title.trim() || newWorkReferenceDraft?.title.trim() || "";
    if (!title) {
      toast.error("Informe o nome da nova obra ou suba um documento.");
      return;
    }

    const referenceToImport: CustomReferenceChapter | null =
      newWorkReferenceDraft
        ? {
            id: createReferenceId(),
            title: newWorkReferenceDraft.title.trim(),
            content: newWorkReferenceDraft.content,
            notes: "Documento importado na criação da obra.",
            fileName: newWorkReferenceDraft.fileName,
            sourceType: "upload",
            isActive: true,
          }
        : null;

    try {
      const result = await createWorkMutation.mutateAsync({
        title,
        subtitle: newWorkForm.subtitle.trim() || undefined,
        genre: newWorkForm.genre.trim() || undefined,
        description: newWorkForm.description.trim() || undefined,
        coverImage: newWorkForm.coverImage || undefined,
        coverPositionX: defaultCoverDraft.coverPositionX,
        coverPositionY: defaultCoverDraft.coverPositionY,
        coverScale: defaultCoverDraft.coverScale,
        status: newWorkForm.status,
      });

      if (referenceToImport) {
        toast.info(
          `Importando documento "${referenceToImport.title}" para a nova obra...`
        );
        await importReferenceIntoWork(referenceToImport, result.data.id);
        goToImportedMaterial();
        toast.success(
          "Material importado. Revise a leitura antes de escrever."
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      // Scroll to top so user sees the newly active work
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      // mutateAsync onError already shows toast, but catch any importReference errors too
      if (error instanceof Error && !error.message.includes("mutateAsync")) {
        toast.error(`Falha ao importar documento: ${error.message}`);
      }
    }
  };

  const quickScanMutation = trpc.profile?.quickScan.useMutation();

  const handleNewWorkReferenceUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const parsed = await parseFile(file);
      const normalizedText = parsed.text.trim();
      const wordCount = countReferenceWords(normalizedText);
      if (!normalizedText || wordCount === 0) {
        setNewWorkReferenceDraft(null);
        toast.error(
          "Não encontrei texto legível nesse arquivo. Se for PDF escaneado, converta com OCR antes de subir."
        );
        return;
      }
      const title = file.name.replace(/\.[^.]+$/, "");
      setNewWorkReferenceDraft({
        title,
        content: normalizedText,
        fileName: parsed.fileName,
        format: parsed.format,
        wordCount,
      });
      setNewWorkForm(current => ({
        ...current,
        title: current.title.trim() ? current.title : title,
        description: current.description.trim()
          ? current.description
          : `Documento importado: ${parsed.fileName}.`,
      }));
      // Quick scan: IA lê as primeiras páginas para detectar gênero, subtítulo e tom
      const textSample = normalizedText;
      if (textSample.length < 50) {
        toast.success(`Documento ${file.name} carregado.`);
      } else {
        toast.success(
          `Documento ${file.name} carregado. A IA está lendo as primeiras páginas...`
        );
        try {
          const scan = await quickScanMutation.mutateAsync({
            title,
            textSample: textSample.slice(0, 15000),
          });
          const updated: string[] = [];
          if (scan.subtitle) updated.push(`subtítulo: "${scan.subtitle}"`);
          if (scan.genre) updated.push(`gênero: ${scan.genre}`);
          if (scan.description) updated.push("descrição");

          if (updated.length) {
            setNewWorkForm(current => {
              let cleanedTitle = current.title;
              // If subtitle was detected and the title contains it, strip it from the title
              if (scan.subtitle && !current.subtitle.trim()) {
                const subtitleNorm = scan.subtitle.trim();
                // Remove patterns like "Title - Subtitle", "Title: Subtitle", "Title — Subtitle"
                const separators = [" - ", " – ", " — ", ": ", " : "];
                for (const sep of separators) {
                  const idx = cleanedTitle.indexOf(sep);
                  if (idx >= 0) {
                    const afterSep = cleanedTitle
                      .slice(idx + sep.length)
                      .trim();
                    if (afterSep.toLowerCase() === subtitleNorm.toLowerCase()) {
                      cleanedTitle = cleanedTitle.slice(0, idx).trim();
                      break;
                    }
                  }
                }
              }
              return {
                ...current,
                title: cleanedTitle,
                subtitle: current.subtitle.trim()
                  ? current.subtitle
                  : scan.subtitle,
                genre: current.genre.trim() ? current.genre : scan.genre,
                description:
                  current.description.trim() &&
                  !current.description.startsWith("Documento importado:")
                    ? current.description
                    : scan.description || current.description,
              };
            });
            toast.success(`Leitura rápida concluída: ${updated.join(", ")}.`);
          } else {
            toast.info(
              "A IA leu o documento mas não conseguiu identificar gênero ou subtítulo. Preencha manualmente."
            );
          }
        } catch (scanError: any) {
          // `scanError.data` é undefined em erros de rede; `scanError.message`
          // pode vir vazio. Optional chain evita TypeError "Cannot read
          // properties of undefined (reading 'message')".
          const msg =
            scanError?.message || scanError?.data?.message || String(scanError);
          if (import.meta.env.DEV) {
            console.error("[quickScan] erro:", msg, scanError);
          }
          toast.error(`Leitura rápida falhou: ${msg.slice(0, 120)}`);
        }
      }
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    }
  };

  const handleNewWorkCoverUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Escolha uma imagem para a capa.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Use uma imagem de até 3 MB.");
      return;
    }

    try {
      const coverImage = await readImageAsDataUrl(file);
      setNewWorkForm(current => ({ ...current, coverImage }));
      toast.success("Capa adicionada a nova obra.");
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    }
  };

  const handleActiveWorkCoverUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeWorkId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Escolha uma imagem para a capa.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Use uma imagem de até 3 MB.");
      return;
    }

    try {
      const coverImage = await readImageAsDataUrl(file);
      // Envia APENAS coverImage. Antes spread ...coverDraft junto sobrescrevia
      // coverPositionX/Y/Scale com valores do estado local (que podiam estar
      // desatualizados em relação à capa antiga). Posição/escala continuam
      // editáveis via "Salvar posição" em handleSaveCoverDraft.
      await updateWorkMutation.mutateAsync({
        workId: activeWorkId,
        coverImage,
      });
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    }
  };

  const handleRemoveActiveWorkCover = async () => {
    if (!activeWorkId) return;
    // null em vez de "" para que o backend grave NULL e o frontend caia no
    // DefaultCoverArt limpo, sem ambiguidade entre "sem capa" e "capa vazia".
    await updateWorkMutation.mutateAsync({
      workId: activeWorkId,
      coverImage: "",
    });
  };

  const handleSaveCoverDraft = async () => {
    if (!activeWorkId) return;
    await updateWorkMutation.mutateAsync({
      workId: activeWorkId,
      ...coverDraft,
    });
  };

  const openWorkInfoEditor = () => {
    if (!activeWork) return;
    setWorkInfoForm({
      title: activeWork?.title || "",
      subtitle: activeWork?.subtitle || "",
      genre: activeWork?.genre || "",
      description: activeWork?.description || "",
    });
    setWorkInfoEditorOpen(true);
  };

  const handleSaveWorkInfo = async () => {
    if (!activeWorkId) return;
    const title = workInfoForm.title.trim();
    if (!title) {
      toast.error("Informe o nome da obra.");
      return;
    }

    await updateWorkMutation.mutateAsync({
      workId: activeWorkId,
      title,
      subtitle: workInfoForm.subtitle.trim(),
      genre: workInfoForm.genre.trim(),
      description: workInfoForm.description.trim(),
    });
    setWorkInfoEditorOpen(false);
  };

  const handleStyleNotesChange = (value: string) => {
    updateStyleProfileState(prev => ({ ...prev, notes: value }));
  };

  const absorbStyleEssence = async (input: {
    id: string;
    title: string;
    content: string;
    notes: string;
  }): Promise<StyleAnalysis | null> => {
    setAnalyzingStyleSampleId(input.id);
    try {
      const result = await analyzeStyleMutation.mutateAsync({
        workId: activeWorkId ?? undefined,
        title: input.title,
        content: input.content,
        notes: input.notes,
      });
      return result.data;
    } catch (error) {
      // Antes: catch silencioso. Usuário clicava "absorver essência" e nada
      // acontecia visualmente — sem motivo aparente. Agora informamos.
      const message =
        error instanceof Error ? error.message : "Falha ao absorver essência.";
      toast.error(message.slice(0, 200));
      return null;
    } finally {
      setAnalyzingStyleSampleId(null);
    }
  };

  const handleStyleSampleUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

    setUploadingStyleSamples(true);
    const parsedSamples: StyleProfileState["samples"] = [];
    for (const file of files) {
      try {
        const parsed = await parseFile(file);
        const title = file.name.replace(/\.[^.]+$/, "");
        if (!parsed.text.trim()) {
          toast.error(
            `${file.name} não tem texto legível para usar como estilo.`
          );
          continue;
        }
        const sample = createStyleSample({
          title,
          content: parsed.text,
          fileName: parsed.fileName,
        });
        parsedSamples.push(sample);
      } catch (error) {
        toast.error(formatApiErrorMessage(error));
      }
    }

    if (!parsedSamples.length) {
      setUploadingStyleSamples(false);
      return;
    }

    let nextStyleState = updateStyleProfileState(prev => ({
      ...prev,
      samples: [...parsedSamples, ...prev.samples],
    }));
    setUploadingStyleSamples(false);
    await persistStyleProfile(nextStyleState);
    toast.success(
      `${parsedSamples.length} amostra(s) adicionada(s). Absorvendo essência em seguida...`
    );

    let analyzedCount = 0;
    for (const sample of parsedSamples) {
      const analysis = await absorbStyleEssence({
        id: sample.id,
        title: sample.title,
        content: sample.content,
        notes: sample.notes,
      });

      if (!analysis) continue;
      analyzedCount += 1;
      nextStyleState = updateStyleProfileState(prev => ({
        ...prev,
        samples: prev.samples.map(item =>
          item.id === sample.id ? { ...item, analysis } : item
        ),
      }));
    }

    setUploadingStyleSamples(false);
    if (analyzedCount > 0) {
      await persistStyleProfile(nextStyleState);
    }
    if (analyzedCount === parsedSamples.length) {
      toast.success(
        `${parsedSamples.length} amostra(s) adicionada(s). ${analyzedCount} com essência absorvida e salva.`
      );
    } else if (analyzedCount > 0) {
      toast.warning(
        `${parsedSamples.length} amostra(s) adicionada(s). ${analyzedCount} com essência absorvida e salva. Reabsorva as restantes pelo botão de brilho.`
      );
    } else {
      toast.warning(
        `${parsedSamples.length} amostra(s) salva(s), mas a essência ainda não foi absorvida. Use o botão de brilho para tentar novamente.`
      );
    }
  };

  const handleAnalyzeStyleSample = async (sampleId: string) => {
    const sample = styleProfileRef.current.samples.find(
      item => item.id === sampleId
    );
    if (!sample) return;
    const analysis = await absorbStyleEssence({
      id: sample.id,
      title: sample.title,
      content: sample.content,
      notes: sample.notes,
    });
    if (!analysis) return;
    const nextStyleState = updateStyleProfileState(prev => ({
      ...prev,
      samples: prev.samples.map(item =>
        item.id === sampleId ? { ...item, analysis } : item
      ),
    }));
    await persistStyleProfile(nextStyleState);
    toast.success(`Essência de "${sample.title}" absorvida e salva.`);
  };

  const handleToggleStyleSample = async (sampleId: string) => {
    const nextStyleState = updateStyleProfileState(prev => {
      const updated = prev.samples.map(sample =>
        sample.id === sampleId
          ? { ...sample, isActive: !sample.isActive }
          : sample
      );
      const anyActive = updated.some(s => s.isActive);
      const toggled = updated.find(s => s.id === sampleId);

      if (activeWork && activeWorkId) {
        if (!anyActive && activeWork?.status !== "paused") {
          updateWorkMutation.mutate({ workId: activeWorkId, status: "paused" });
        } else if (toggled?.isActive && activeWork?.status === "paused") {
          updateWorkMutation.mutate({
            workId: activeWorkId,
            status: "in_progress",
          });
        }
      }

      return { ...prev, samples: updated };
    });
    await persistStyleProfile(nextStyleState);
  };

  const handleRemoveStyleSample = async (sampleId: string) => {
    const nextStyleState = updateStyleProfileState(prev => ({
      ...prev,
      samples: prev.samples.filter(sample => sample.id !== sampleId),
    }));
    await persistStyleProfile(nextStyleState);
  };

  const handleSaveUniverse = async () => {
    await updateMutation.mutateAsync({
      negativeRules: serializeUniverseProfile(universeProfile),
    });
  };

  const handleSaveChapters = async () => {
    await updateMutation.mutateAsync({
      keyChapters: serializeKeyChapters(keyChaptersState),
    });
  };

  const handleSaveFoundation = async () => {
    await updateMutation.mutateAsync({ storyFoundation });
  };

  const updateUniverseField = <K extends keyof UniverseProfileState>(
    key: K,
    value: UniverseProfileState[K]
  ) => {
    setUniverseProfile(prev => ({ ...prev, [key]: value }));
  };

  const handleAnalyzeUniverseFromReference = (
    reference: CustomReferenceChapter
  ) => {
    if (!(reference.analysisBlocks ?? []).length) {
      toast.error(
        "Crie os dossiês por capítulo antes de atualizar o universo."
      );
      handleTabChange("chapters");
      return;
    }
    analyzeUniverseMutation.mutate({
      workId: activeWorkId ?? undefined,
      title: reference.title,
      content: reference.content,
      analysisBlocks: reference.analysisBlocks ?? [],
      currentUniverse: serializeUniverseProfile(universeProfile),
    });
  };

  const toggleExistingChapter = (chapter: any) => {
    updateKeyChaptersState(prev => ({
      ...prev,
      linkedChapters: prev.linkedChapters.some(
        item => item.chapterId === chapter.id
      )
        ? prev.linkedChapters.filter(item => item.chapterId !== chapter.id)
        : [
            ...prev.linkedChapters,
            { chapterId: chapter.id, title: chapter.title },
          ],
    }));
  };

  const resetReferenceForm = () => {
    setReferenceForm(emptyReferenceForm);
    setUploadedReferenceDraft(null);
    setEditingReferenceId(null);
    setEditingReferenceType(null);
    setReferenceDraftMode("manual");
  };

  const upsertCustomReference = (payload: CustomReferenceChapter) => {
    return updateKeyChaptersState(prev => {
      const customReferences = editingReferenceId
        ? prev.customReferences.map(item =>
            item.id === editingReferenceId ? payload : item
          )
        : [payload, ...prev.customReferences];

      return {
        ...prev,
        customReferences,
      };
    });
  };

  const LARGE_TEXT_THRESHOLD = 5000; // words
  const triggerReferenceProfileSync = (
    reference: CustomReferenceChapter,
    workId = activeWorkId ?? 0,
    syncScope: "all" | "characters" | "timeline" | "continuity" = "all"
  ) => {
    if (!(reference.analysisBlocks ?? []).length) {
      toast.error(
        "Crie os dossiês por capítulo antes de conectar este material ao perfil."
      );
      handleTabChange("chapters");
      return;
    }

    syncImportedReferenceMutation.mutate({
      workId,
      referenceId: reference.id,
      title: reference.title,
      content: reference.content,
      summary: reference.summary ?? "",
      summarySections: reference.summarySections ?? [],
      analysisBlocks: reference.analysisBlocks ?? [],
      alreadySyncedCharacterIds: reference.importedCharacterIds ?? [],
      forceReplaceImportedCharacters: syncScope === "characters",
      syncScope,
    });
  };

  const handleRefreshImportedReferenceSync = (
    reference: CustomReferenceChapter | null | undefined,
    label = "Atualizando leitura importada",
    syncScope: "all" | "characters" | "timeline" | "continuity" = "all"
  ) => {
    if (!reference) {
      toast.error("Nenhum material importado disponível para atualizar.");
      return;
    }

    if (!(reference.analysisBlocks ?? []).length) {
      toast.error(
        "Crie os dossiês por capítulo antes de conectar este material ao perfil."
      );
      handleTabChange("chapters");
      return;
    }

    toast.info(`${label}: "${reference.title}"...`);
    triggerReferenceProfileSync(reference, activeWorkId ?? 0, syncScope);
  };

  const handleCharacterPreparationAction = () => {
    if (characters.length > 0) {
      handleTabChange("characters");
      return;
    }

    if (characterSyncReference) {
      toast.info(
        `Extraindo personagens de "${characterSyncReference.title}"...`
      );
      triggerReferenceProfileSync(
        characterSyncReference,
        activeWorkId ?? 0,
        "characters"
      );
      return;
    }

    handleTabChange("chapters");
  };

  const triggerReferenceSummary = (
    reference: CustomReferenceChapter,
    mode: "chunks" | "integral" | "chaptered" = "chaptered",
    workId = activeWorkId ?? 0
  ) => {
    setProcessingModeByRef(prev => ({ ...prev, [reference.id]: mode }));
    updateKeyChaptersState(prev => ({
      ...prev,
      customReferences: prev.customReferences.map(item =>
        item.id === reference.id
          ? { ...item, summaryStatus: "pending" as const }
          : item
      ),
    }));
    summarizeMutation.mutate({
      workId,
      referenceId: reference.id,
      title: reference.title,
      content: reference.content,
      mode,
    });
  };

  const commitReferenceToLocalState = async (
    payload: CustomReferenceChapter,
    successMessage: string
  ) => {
    const nextState = upsertCustomReference(payload);
    await silentKeyChaptersMutation.mutateAsync({
      workId: activeWorkId ?? undefined,
      keyChapters: serializeKeyChapters(nextState),
    });
    toast.success(successMessage);
    resetReferenceForm();

    const shouldReadUploadedWork =
      payload.sourceType === "upload" && !payload.summary;
    if (!shouldReadUploadedWork) {
      return;
    }

    const wordCount = countReferenceWords(payload.content);
    if (wordCount > LARGE_TEXT_THRESHOLD && !payload.summary) {
      const chunks = Math.ceil(wordCount / 4000);
      setProcessingModeDialog({
        open: true,
        reference: payload,
        wordCount,
        chunks,
      });
      return;
    }

    const currentPayload =
      nextState.customReferences.find(item => item.id === payload.id) ||
      payload;
    triggerReferenceSummary(currentPayload, "chaptered");
  };

  const handleProcessingModeChoice = () => {
    processingModeConfirmedRef.current = true;
    const { reference, wordCount, chunks } = processingModeDialog;
    setProcessingModeDialog({
      open: false,
      reference: null,
      wordCount: 0,
      chunks: 0,
    });
    if (!reference) return;

    const cost = chunks > 1 ? 8 + (chunks - 1) * 2 : 8;
    toast.info(
      `Leitura por capítulos iniciada para "${reference.title}" (${wordCount.toLocaleString("pt-BR")} palavras, ${chunks} dossiê${chunks > 1 ? "s" : ""} estimado${chunks > 1 ? "s" : ""}, ~${cost} créditos flexíveis).`
    );

    triggerReferenceSummary(reference, "chaptered");
  };

  const saveReferenceDraft = async () => {
    if (referenceDraftMode === "upload") {
      if (!uploadedReferenceDraft) {
        toast.error(
          "Carregue um arquivo antes de salvar a referência por upload."
        );
        return;
      }

      const title = (
        referenceForm.title || uploadedReferenceDraft.title
      ).trim();
      if (!title || !uploadedReferenceDraft.content.trim()) {
        toast.error(
          "O arquivo carregado precisa ter título e conteúdo válidos."
        );
        return;
      }

      const payload: CustomReferenceChapter = {
        id: editingReferenceId || createReferenceId(),
        title,
        content: uploadedReferenceDraft.content,
        notes: referenceForm.notes.trim(),
        fileName: uploadedReferenceDraft.fileName,
        sourceType: "upload",
        isActive: true,
      };

      await commitReferenceToLocalState(
        preserveReferenceMetadataWhenSafe(payload),
        editingReferenceId
          ? "Referência por arquivo atualizada e salva."
          : "Arquivo adicionado e salvo como referência."
      );
      return;
    }

    const title = referenceForm.title.trim();
    const content = referenceForm.content.trim();
    if (!title || !content) {
      toast.error("Título e conteúdo manual são obrigatórios na referência.");
      return;
    }

    const payload: CustomReferenceChapter = {
      id: editingReferenceId || createReferenceId(),
      title,
      content,
      notes: referenceForm.notes.trim(),
      fileName: "",
      sourceType: "manual",
      isActive: true,
    };

    await commitReferenceToLocalState(
      preserveReferenceMetadataWhenSafe(payload),
      editingReferenceId
        ? "Referência manual atualizada e salva."
        : "Referência manual adicionada e salva."
    );
  };

  const startManualReference = () => {
    setReferenceDraftMode("manual");
    setUploadedReferenceDraft(null);
    if (editingReferenceType === "upload") {
      setEditingReferenceId(null);
      setEditingReferenceType(null);
      setReferenceForm(prev => ({ ...prev, content: "" }));
    }
  };

  const startUploadReference = () => {
    setReferenceDraftMode("upload");
    if (editingReferenceType === "manual") {
      setEditingReferenceId(null);
      setEditingReferenceType(null);
      setReferenceForm(prev => ({ ...prev, content: "" }));
    }
  };

  const preserveReferenceMetadataWhenSafe = (
    payload: CustomReferenceChapter
  ): CustomReferenceChapter => {
    if (!editingReferenceId) return payload;
    const existingReference = keyChaptersStateRef.current.customReferences.find(
      item => item.id === editingReferenceId
    );
    if (!existingReference) return payload;

    const canReuseDerivedData =
      existingReference.sourceType === payload.sourceType &&
      existingReference.content.trim() === payload.content.trim();

    if (!canReuseDerivedData) return payload;

    return {
      ...payload,
      summary: existingReference.summary,
      summarySections: existingReference.summarySections,
      analysisBlocks: existingReference.analysisBlocks,
      continuitySnippet: existingReference.continuitySnippet,
      importedCharacterIds: existingReference.importedCharacterIds,
      importedTimelineEvents: existingReference.importedTimelineEvents,
      summaryStatus: existingReference.summaryStatus,
    };
  };

  const handleEditReference = (item: CustomReferenceChapter) => {
    setEditingReferenceId(item.id);
    setEditingReferenceType(item.sourceType);
    setReferenceDraftMode(item.sourceType);
    setReferenceForm({
      title: item.title,
      content: item.sourceType === "manual" ? item.content : "",
      notes: item.notes || "",
    });
    setUploadedReferenceDraft(
      item.sourceType === "upload"
        ? {
            title: item.title,
            content: item.content,
            fileName: item.fileName || "",
          }
        : null
    );
  };

  const handleRemoveReference = (referenceId: string) => {
    const removedReference = keyChaptersStateRef.current.customReferences.find(
      item => item.id === referenceId
    );
    updateKeyChaptersState(prev => ({
      ...prev,
      customReferences: prev.customReferences.filter(
        item => item.id !== referenceId
      ),
    }));
    if (editingReferenceId === referenceId) {
      resetReferenceForm();
    }
    if (
      (removedReference?.importedCharacterIds ?? []).length ||
      removedReference?.continuitySnippet
    ) {
      toast.info(
        "A referência saiu da lista local, mas personagens já importados continuam disponíveis na aba Personagens."
      );
    }
  };

  const handleToggleReference = (referenceId: string) => {
    updateKeyChaptersState(prev => {
      const updated = prev.customReferences.map(item =>
        item.id === referenceId ? { ...item, isActive: !item.isActive } : item
      );
      const anyActive = updated.some(item => item.isActive);
      const toggled = updated.find(item => item.id === referenceId);

      // Sync work status: last reference paused → pause work; reference activated → resume work
      if (activeWork && activeWorkId) {
        if (!anyActive && activeWork?.status !== "paused") {
          updateWorkMutation.mutate({ workId: activeWorkId, status: "paused" });
        } else if (toggled?.isActive && activeWork?.status === "paused") {
          updateWorkMutation.mutate({
            workId: activeWorkId,
            status: "in_progress",
          });
        }
      }

      return { ...prev, customReferences: updated };
    });
  };

  const handleCopyImportedContinuity = (snippet: string) => {
    const normalizedSnippet = snippet.trim();
    if (!normalizedSnippet) return;

    let wasAlreadyPresent = false;
    setStoryFoundation(prev => {
      const current = prev.trim();
      if (current.includes(normalizedSnippet)) {
        wasAlreadyPresent = true;
        return prev;
      }
      return [current, normalizedSnippet]
        .filter(Boolean)
        .join("\n\n----------------\n\n");
    });

    toast[wasAlreadyPresent ? "info" : "success"](
      wasAlreadyPresent
        ? "Essa base já está no campo manual da continuidade."
        : "Base importada copiada para o campo manual da continuidade."
    );
  };

  const handleRemoveImportedContinuity = (referenceId: string) => {
    const nextState = updateKeyChaptersState(prev => ({
      ...prev,
      customReferences: prev.customReferences.map(item =>
        item.id === referenceId
          ? { ...item, continuitySnippet: undefined }
          : item
      ),
    }));
    silentKeyChaptersMutation.mutate({
      keyChapters: serializeKeyChapters(nextState),
    });
    toast.success(
      "Esta referência foi desconectada apenas da aba Continuidade. Os personagens importados continuam na aba Personagens."
    );
  };

  const handleReferenceUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setParsingReferenceUpload(true);
    try {
      const parsed = await parseFile(file);
      const normalizedText = parsed.text.trim();
      const wordCount = countReferenceWords(normalizedText);
      if (!normalizedText || wordCount === 0) {
        setUploadedReferenceDraft(null);
        toast.error(
          "Não encontrei texto legível nesse arquivo. Se for PDF escaneado, converta com OCR antes de subir."
        );
        return;
      }
      setReferenceForm(prev => ({
        ...prev,
        title: prev.title || file.name.replace(/\.[^.]+$/, ""),
      }));
      setReferenceDraftMode("upload");
      setUploadedReferenceDraft({
        title: file.name.replace(/\.[^.]+$/, ""),
        content: normalizedText,
        fileName: parsed.fileName,
        format: parsed.format,
        wordCount,
      });
      toast.success(
        `Arquivo ${file.name} carregado (${wordCount.toLocaleString("pt-BR")} palavras).`
      );
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    } finally {
      setParsingReferenceUpload(false);
    }
  };

  const handleFoundationUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = await parseFile(file);
      setStoryFoundation(parsed.text);
      toast.success(`Base carregada de ${file.name}.`);
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    }
  };

  const getSummarySectionRefKey = (referenceId: string, sectionId: string) =>
    `${referenceId}:${sectionId}`;

  const getActiveSummarySection = (
    referenceId: string,
    sections: ReferenceSummarySection[]
  ) => {
    const activeId = activeSummarySectionByReference[referenceId];
    return sections.some(section => section.id === activeId)
      ? activeId
      : sections[0].id;
  };

  const selectSummarySection = (referenceId: string, sectionId: string) => {
    setActiveSummarySectionByReference(prev => ({
      ...prev,
      [referenceId]: sectionId,
    }));
    const container = summaryScrollRefs.current[referenceId];
    const target =
      summarySectionRefs.current[
        getSummarySectionRefKey(referenceId, sectionId)
      ];
    if (container && target) {
      const nav = container.querySelector(
        `[data-summary-nav="${referenceId}"]`
      );
      const stickyOffset =
        nav instanceof HTMLElement ? nav.offsetHeight + 8 : 0;
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const nextTop = Math.max(
        container.scrollTop + targetRect.top - containerRect.top - stickyOffset,
        0
      );
      container.scrollTo({ top: nextTop, behavior: "smooth" });
    }
  };

  if (!profileWorkspaceOpen) {
    const trashCount = trashQuery.data?.data.length ?? 0;
    return (
      <div className="relative space-y-7 pb-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-accent">
              <BookOpen className="h-4 w-4" />
              Obras
            </div>
            <h1 className="mt-2 font-display text-3xl text-foreground">
              Obras
            </h1>
          </div>
          <Badge
            variant="outline"
            className="border-border/80 px-3 py-1 text-muted-foreground"
          >
            {visibleWorks.length} {visibleWorks.length === 1 ? "obra" : "obras"}
          </Badge>
        </div>

        <FilterToolbar
          searchValue={workSearch}
          onSearchChange={setWorkSearch}
          searchPlaceholder="Buscar por título, gênero, status ou premissa"
          resultCount={filteredWorks.length}
          totalCount={visibleWorks.length}
          resultLabel={filteredWorks.length === 1 ? "obra" : "obras"}
          filterCount={statusFilters.size}
          hasActiveFilters={Boolean(workSearch.trim() || statusFilters.size)}
          activeFiltersLabel={
            statusFilters.size || workSearch.trim()
              ? `${statusFilters.size} status selecionado(s)${
                  workSearch.trim() ? ` · busca "${workSearch.trim()}"` : ""
                }`
              : "Mostrando todas as obras disponíveis para produção."
          }
          onClear={() => {
            setWorkSearch("");
            setStatusFilters(new Set());
          }}
          className="max-w-[1180px]"
        >
          <FilterChipGroup
            label="Status"
            allLabel="Todos"
            allCount={visibleWorks.length}
            selectedValues={Array.from(statusFilters)}
            onToggle={toggleStatusFilter}
            onClear={() => setStatusFilters(new Set<WorkStatus>())}
            options={statusFilterOptions.map(opt => ({
              ...opt,
              count: workStatusCounts[opt.value] ?? 0,
            }))}
          />
        </FilterToolbar>

        <div className="grid max-w-[1180px] gap-4 xl:grid-cols-2">
          <button
            type="button"
            onClick={() => setShowNewWorkPanel(true)}
            className="group relative flex h-[118px] items-center gap-5 overflow-hidden rounded-lg border border-dashed border-border bg-card/45 px-7 text-left transition duration-150 ease-out hover:border-accent/60 hover:bg-card"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-accent/5 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent">
              <Plus className="h-5 w-5" />
            </span>
            <div className="relative">
              <span className="font-display text-xl text-foreground">
                Nova obra
              </span>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Suba o livro inteiro ou inicie pelo guia assistido.
              </p>
            </div>
          </button>
        </div>

        {/* Works grid */}
        <div className="grid max-w-[1180px] gap-4 xl:grid-cols-2">
          {worksLoading ? (
            <Card className="flex h-[220px] items-center justify-center border-border bg-card">
              <Loader2 className="h-7 w-7 animate-spin text-accent" />
            </Card>
          ) : filteredWorks.length === 0 &&
            (workSearch.trim() || statusFilters.size) ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-muted-foreground xl:col-span-2">
              <span>Nenhum resultado com os filtros atuais.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setWorkSearch("");
                  setStatusFilters(new Set());
                }}
              >
                Limpar filtros
              </Button>
            </div>
          ) : (
            filteredWorks.map(work => {
              const isActive = work.id === activeWorkId;
              const coverStyle = getCoverImageStyle(
                isActive ? coverDraft : work
              );
              const coverTint = getCachedCoverTint(
                coverTintCache,
                work.id,
                work.coverImage
              );
              const hasCoverImage = !isDefaultCoverImage(work.coverImage);
              const isPaused = work.status === "paused";
              const statusOptionLabel =
                statusFilterOptions
                  .find(item => item.value === work.status)
                  ?.label.toLowerCase() ?? "obra";
              const statusColor = isPaused
                ? "rgb(234 179 8)"
                : isActive
                  ? "rgb(34 197 94)"
                  : "rgb(148 163 184)";
              const statusBorderColor = isPaused
                ? "rgba(234,179,8,0.45)"
                : isActive
                  ? "rgba(34,197,94,0.45)"
                  : "rgba(148,163,184,0.28)";
              const statusLabel = isPaused
                ? "pausada"
                : isActive
                  ? "ativa"
                  : statusOptionLabel;
              return (
                <div
                  key={work.id}
                  className="group relative isolate h-[220px] overflow-hidden rounded-lg border border-white/15 bg-transparent px-7 py-5 text-left shadow-sm transition duration-150 ease-out hover:border-accent/60"
                >
                  <div
                    className="absolute inset-0 z-0 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                    style={getCoverGlassLayerStyle(coverTint)}
                  />
                  <button
                    type="button"
                    onClick={() => handleSelectWork(work.id)}
                    className="absolute inset-0 z-10 rounded-lg"
                    aria-label={`Abrir ${work.title}`}
                  />
                  {hasCoverImage ? (
                    <div className="absolute inset-y-0 right-0 z-[1] w-1/2 overflow-hidden">
                      <img
                        src={work.coverImage || undefined}
                        alt={`Capa de ${work.title}`}
                        className="absolute inset-0 h-full w-full object-cover opacity-90 transition duration-300 group-hover:opacity-100"
                        style={{ ...coverStyle, ...coverRevealMaskStyle }}
                      />
                    </div>
                  ) : (
                    <div className="absolute inset-y-0 right-0 z-[1] w-1/2 overflow-hidden">
                      <DefaultCoverArt className="absolute inset-0 h-full w-full opacity-90 transition duration-300 group-hover:opacity-100" />
                    </div>
                  )}
                  <div className="pointer-events-none relative z-20 flex h-full max-w-[62%] flex-col justify-center">
                    <div className="text-xs uppercase leading-4 tracking-[0.22em] text-muted-foreground">
                      Obra
                    </div>
                    <h2 className="mt-2 font-serif text-[28px] leading-[1.12] text-foreground">
                      {work.title}
                    </h2>
                    {work.subtitle ? (
                      <div className="mt-1 font-serif text-lg leading-7 text-foreground">
                        {work.subtitle}
                      </div>
                    ) : null}
                    <div className="mt-3 text-sm font-medium leading-5 text-muted-foreground">
                      Gênero: {work.genre || "Sem gênero"}
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-5 text-muted-foreground">
                      {work.description || "Sem descrição cadastrada."}
                    </p>
                  </div>
                  <div className="absolute right-5 top-5 z-30 flex items-center gap-2">
                    <span
                      className="rounded-full px-3 py-1 text-xs font-medium capitalize shadow-sm"
                      style={{
                        border: `1px solid ${statusBorderColor}`,
                        backgroundColor: "rgba(0,0,0,0.55)",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                        color: statusColor,
                      }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="absolute bottom-5 right-5 z-30 flex gap-2">
                    <button
                      type="button"
                      title={isPaused ? "Retomar obra" : "Pausar obra"}
                      onClick={e => {
                        e.stopPropagation();
                        updateWorkMutation.mutate({
                          workId: work.id,
                          status: isPaused ? "in_progress" : "paused",
                        });
                      }}
                      disabled={updateWorkMutation.isPending}
                      className="flex h-8 w-8 items-center justify-center rounded-full border transition duration-150 ease-out "
                      style={{
                        borderColor: "rgba(234,179,8,0.5)",
                        backgroundColor: "rgba(0,0,0,0.6)",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                        color: "rgb(234 179 8)",
                      }}
                    >
                      {isPaused ? (
                        <Play className="h-3.5 w-3.5" />
                      ) : (
                        <Pause className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Excluir obra"
                      onClick={e => {
                        e.stopPropagation();
                        setDeleteConfirmWork({
                          id: work.id,
                          title: work.title,
                        });
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full border transition duration-150 ease-out"
                      style={{
                        borderColor: "rgba(239,68,68,0.5)",
                        backgroundColor: "rgba(0,0,0,0.6)",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                        color: "rgb(239 68 68)",
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* New work modal */}
        {showNewWorkPanel ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
            onMouseDown={event => {
              if (event.target === event.currentTarget)
                setShowNewWorkPanel(false);
            }}
          >
            <div className="w-full max-w-[720px] rounded-lg border border-border bg-card p-5 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-xl text-foreground">
                  Nova obra
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowNewWorkPanel(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                O caminho principal é subir o livro inteiro: a IA lê a obra
                completa, separa fontes brutas de conteúdo canônico e preenche
                Universo, Personagens, Timeline, Continuidade e Estilo para
                revisão.
              </p>
              <div className="mt-5 space-y-3">
                <div className="grid gap-3 md:grid-cols-[1fr_0.72fr]">
                  <button
                    type="button"
                    onClick={() => openFileInput(newWorkReferenceInputRef)}
                    className="group relative flex min-h-40 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-accent/40 bg-accent/5 p-5 text-sm text-muted-foreground transition duration-150 ease-out hover:border-accent/70"
                  >
                    <span className="flex flex-col items-center gap-1 text-center">
                      <span className="flex items-center gap-2 text-foreground">
                        <FileUp className="h-4 w-4" />
                        Subir documento da obra
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Usa o mesmo fluxo da nova referência externa. Suporta{" "}
                        {getSupportedExtensions()}.
                      </span>
                      {newWorkReferenceDraft ? (
                        <span className="mt-1 rounded-full bg-accent/15 px-3 py-1 text-xs text-accent">
                          {newWorkReferenceDraft.fileName}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <input
                    ref={newWorkReferenceInputRef}
                    type="file"
                    accept={getAcceptString()}
                    className="hidden"
                    onChange={handleNewWorkReferenceUpload}
                  />
                  <button
                    type="button"
                    onClick={() => openFileInput(newWorkCoverInputRef)}
                    className="group relative flex min-h-40 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-background/60 p-5 text-sm text-muted-foreground transition duration-150 ease-out hover:border-accent/60"
                  >
                    {!isDefaultCoverImage(newWorkForm.coverImage) ? (
                      <>
                        <img
                          src={newWorkForm.coverImage}
                          alt={`Capa de ${newWorkForm.title || "nova obra"}`}
                          className="absolute inset-0 h-full w-full object-cover opacity-90"
                        />
                        <div className="absolute inset-0 bg-black/35" />
                        <span className="relative z-10 rounded-full bg-black/65 px-3 py-1 text-foreground">
                          Trocar capa
                        </span>
                      </>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        Capa opcional
                      </span>
                    )}
                  </button>
                  <input
                    ref={newWorkCoverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleNewWorkCoverUpload}
                  />
                </div>
                <div className="hidden">
                  <Input
                    value={newWorkForm.title}
                    onChange={event =>
                      setNewWorkForm(current => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Nome do livro"
                  />
                  <div className="relative">
                    <Input
                      value={newWorkForm.subtitle}
                      onChange={event =>
                        setNewWorkForm(current => ({
                          ...current,
                          subtitle: event.target.value,
                        }))
                      }
                      placeholder={
                        quickScanMutation.isPending
                          ? "Detectando subtítulo..."
                          : "Subtítulo"
                      }
                    />
                    {quickScanMutation.isPending ? (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>
                  <div className="relative">
                    <Input
                      value={newWorkForm.genre}
                      onChange={event =>
                        setNewWorkForm(current => ({
                          ...current,
                          genre: event.target.value,
                        }))
                      }
                      placeholder={
                        quickScanMutation.isPending
                          ? "Identificando gênero..."
                          : "Gênero"
                      }
                    />
                    {quickScanMutation.isPending ? (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>
                  <Textarea
                    rows={4}
                    value={newWorkForm.description}
                    onChange={event =>
                      setNewWorkForm(current => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder={
                      quickScanMutation.isPending
                        ? "Gerando descrição..."
                        : "Premissa, tom e promessa narrativa. Se subir um documento, isso pode ficar vazio."
                    }
                  />
                </div>
                {quickScanMutation.isPending ? (
                  <div className="flex items-center gap-2 text-xs text-accent">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analisando documento para preencher campos
                    automaticamente...
                  </div>
                ) : null}
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_0.78fr]">
                <Button
                  type="button"
                  onClick={handleCreateWorkFromProfile}
                  disabled={
                    createWorkMutation.isPending ||
                    quickScanMutation.isPending ||
                    !newWorkReferenceDraft
                  }
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  {createWorkMutation.isPending ||
                  quickScanMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {quickScanMutation.isPending
                    ? "Analisando documento..."
                    : "Criar e importar documento"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    createWorkMutation.isPending || quickScanMutation.isPending
                  }
                  onClick={() => {
                    setShowNewWorkPanel(false);
                    navigate("/home?createWork=1&mode=manual");
                  }}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Criar por guia
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Delete confirmation dialog */}
        <AlertDialog
          open={!!deleteConfirmWork}
          onOpenChange={open => !open && setDeleteConfirmWork(null)}
        >
          <AlertDialogContent className="border-border bg-card">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">
                Excluir obra
              </AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                Tem certeza que deseja excluir{" "}
                <strong className="text-foreground">
                  {deleteConfirmWork?.title}
                </strong>
                ? Ela será movida para a lixeira com rascunhos, capítulos,
                personagens, perfil, timeline, auditorias e melhorias isolados.
                Nada dela alimenta a IA até ser restaurada.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border bg-secondary text-foreground hover:bg-secondary/80">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={() =>
                  deleteConfirmWork &&
                  softDeleteMutation.mutate({ workId: deleteConfirmWork.id })
                }
              >
                {softDeleteMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Permanent delete confirmation dialog */}
        <AlertDialog
          open={!!permanentDeleteConfirmWork}
          onOpenChange={open => !open && setPermanentDeleteConfirmWork(null)}
        >
          <AlertDialogContent className="border-border bg-card">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">
                Excluir permanentemente
              </AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                Esta ação é irreversível. A obra{" "}
                <strong className="text-foreground">
                  {permanentDeleteConfirmWork?.title}
                </strong>{" "}
                será removida permanentemente, incluindo todos os dados
                associados.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border bg-secondary text-foreground hover:bg-secondary/80">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={() =>
                  permanentDeleteConfirmWork &&
                  permanentDeleteMutation.mutate({
                    workId: permanentDeleteConfirmWork.id,
                  })
                }
              >
                {permanentDeleteMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Excluir permanentemente
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Trash dialog */}
        <AlertDialog open={showTrashDialog} onOpenChange={setShowTrashDialog}>
          <AlertDialogContent className="w-[calc(100vw-2rem)] overflow-x-hidden border-border bg-card sm:max-w-[720px]">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-foreground">
                <Trash2 className="h-5 w-5 text-red-400" />
                Lixeira
              </AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                Obras excluídas ficam aqui por 7 dias. Depois são removidas
                automaticamente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="scrollbar-hidden max-h-[62vh] space-y-4 overflow-y-auto overflow-x-hidden pr-1">
              {trashCount === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  A lixeira está vazia.
                </p>
              ) : (
                trashQuery.data?.data.map(work => {
                  const deletedDate = work.deletedAt
                    ? new Date(work.deletedAt)
                    : null;
                  const daysLeft = deletedDate
                    ? Math.max(
                        0,
                        7 -
                          Math.floor(
                            (Date.now() - deletedDate.getTime()) / 86400000
                          )
                      )
                    : 0;
                  const coverStyle = getCoverImageStyle(work);
                  const coverTint = getCachedCoverTint(
                    coverTintCache,
                    work.id,
                    work.coverImage
                  );
                  const hasCoverImage = !isDefaultCoverImage(work.coverImage);
                  return (
                    <div
                      key={work.id}
                      className="group relative isolate h-[220px] w-full min-w-0 overflow-hidden rounded-lg border border-red-500/25 bg-transparent px-7 py-5 text-left shadow-sm transition duration-150 ease-out hover:border-red-400/45"
                    >
                      <div
                        className="absolute inset-0 z-0 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                        style={getCoverGlassLayerStyle(coverTint)}
                      />
                      {hasCoverImage ? (
                        <div className="absolute inset-y-0 right-0 z-[1] w-1/2 overflow-hidden">
                          <img
                            src={work.coverImage || undefined}
                            alt={`Capa de ${work.title}`}
                            className="absolute inset-0 h-full w-full object-cover opacity-80 transition duration-300 group-hover:opacity-95"
                            style={{ ...coverStyle, ...coverRevealMaskStyle }}
                          />
                        </div>
                      ) : (
                        <div className="absolute inset-y-0 right-0 z-[1] w-1/2 overflow-hidden">
                          <DefaultCoverArt className="absolute inset-0 h-full w-full opacity-80 transition duration-300 group-hover:opacity-95" />
                        </div>
                      )}
                      <div className="pointer-events-none relative z-20 flex h-full max-w-[52%] min-w-0 flex-col justify-center">
                        <div className="text-xs uppercase leading-4 tracking-[0.22em] text-red-300/80">
                          Na lixeira
                        </div>
                        <h2 className="mt-2 truncate font-serif text-[28px] leading-[1.12] text-foreground">
                          {work.title}
                        </h2>
                        {work.subtitle ? (
                          <div className="mt-1 font-serif text-lg leading-7 text-foreground">
                            {work.subtitle}
                          </div>
                        ) : null}
                        <div className="mt-3 text-sm font-medium leading-5 text-muted-foreground">
                          Gênero: {work.genre || "Sem gênero"}
                        </div>
                        <p className="mt-3 line-clamp-2 text-sm leading-5 text-muted-foreground">
                          {work.description || "Sem descrição cadastrada."}
                        </p>
                      </div>
                      <div className="absolute right-5 top-5 z-30">
                        <span
                          className="rounded-full px-3 py-1 text-xs font-medium text-red-300 shadow-sm"
                          style={{
                            border: "1px solid rgba(248,113,113,0.42)",
                            backgroundColor: "rgba(0,0,0,0.55)",
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                          }}
                        >
                          {daysLeft > 0 ? `${daysLeft} dia(s)` : "Expira hoje"}
                        </span>
                      </div>
                      <div className="absolute bottom-5 right-5 z-30 flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 gap-1.5 rounded-full border-green-500/45 bg-black/60 px-3 text-green-400 transition duration-150 ease-out hover:bg-green-500/10 hover:text-green-300"
                          onClick={() =>
                            restoreMutation.mutate({ workId: work.id })
                          }
                          disabled={restoreMutation.isPending}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Restaurar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 gap-1.5 rounded-full border-red-500/45 bg-black/60 px-3 text-red-400 transition duration-150 ease-out hover:bg-red-500/10 hover:text-red-300"
                          onClick={() =>
                            setPermanentDeleteConfirmWork({
                              id: work.id,
                              title: work.title,
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Apagar
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border bg-secondary text-foreground hover:bg-secondary/80">
                Fechar
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Trash floating button — bottom right */}
        <button
          type="button"
          onClick={() => setShowTrashDialog(true)}
          className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium shadow-lg transition duration-150 ease-out hover:border-red-400/70 hover:bg-red-500/10 hover:text-red-300 ${
            trashCount > 0
              ? "border-red-500/40 bg-black/75 text-red-400"
              : "border-border bg-black/75 text-muted-foreground"
          }`}
          style={{
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <Trash2 className="h-4 w-4" />
          Lixeira{trashCount > 0 ? ` (${trashCount})` : ""}
        </button>
      </div>
    );
  }

  const activeCoverTint = activeWork
    ? getCachedCoverTint(coverTintCache, activeWork?.id, activeWork?.coverImage)
    : fallbackCoverTint;
  const activeWorkIsPaused = activeWork?.status === "paused";
  const activeStatusOptionLabel =
    statusFilterOptions
      .find(item => item.value === activeWork?.status)
      ?.label.toLowerCase() ?? "obra";
  const activeStatusColor = activeWorkIsPaused
    ? "rgb(234 179 8)"
    : "rgb(34 197 94)";
  const activeStatusBorderColor = activeWorkIsPaused
    ? "rgba(234,179,8,0.45)"
    : "rgba(34,197,94,0.45)";
  const activeStatusLabel = activeWorkIsPaused
    ? "pausada"
    : activeWork?.id === activeWorkId
      ? "ativa"
      : activeStatusOptionLabel;
  const activeHasCoverImage = !isDefaultCoverImage(activeWork?.coverImage);
  const materialReady = savedReferences.length + linkedExistingCount > 0;
  const hasUniverseProfile =
    buildUniverseContext(universeProfile).trim().length > 0;
  const guideSteps = [
    {
      step: "1",
      title: "Importar ou vincular material",
      description: materialReady
        ? `${savedReferences.length + linkedExistingCount} material(is) conectado(s) à obra.`
        : "Livro, notas, capítulos e referências entram aqui primeiro.",
      onClick: () => handleTabChange("chapters"),
      status: materialReady ? "feito" : "importar",
      tone: materialReady ? "done" : "action",
      disabled: false,
    },
    {
      step: "2",
      title: characters.length ? "Revisar personagens" : "Extrair personagens",
      description: characters.length
        ? `${characters.length} resumo(s) no acervo. Revise história, papel e relações antes de escrever.`
        : characterSyncReference
          ? "O material foi importado, mas ainda não virou resumos de personagem. Extraia os personagens agora."
          : materialReady
            ? "Crie os dossiês por capítulo antes de extrair personagens."
            : "Importe material antes de preparar personagens.",
      onClick: handleCharacterPreparationAction,
      status: syncImportedReferenceMutation.isPending
        ? "extraindo"
        : characters.length
          ? "revisar"
          : characterSyncReference
            ? "extrair"
            : materialReady
              ? "dossiês"
              : "importar",
      tone: characters.length
        ? "review"
        : characterSyncReference
          ? "action"
          : "blocked",
      disabled: syncImportedReferenceMutation.isPending,
    },
    {
      step: "3",
      title: "Definir estilo",
      description: activeStyleSamples.length
        ? `${activeStyleSamples.length} amostra(s) ativa(s) orientando voz e cadência.`
        : "Amostras e notas ensinam como a obra deve soar.",
      onClick: () => handleTabChange("style"),
      status: activeStyleSamples.length ? "feito" : "definir",
      tone: activeStyleSamples.length ? "done" : "action",
      disabled: false,
    },
    {
      step: "4",
      title: "Fixar cânone",
      description: hasUniverseProfile
        ? "Universo, regras e limites já têm material salvo para orientar a escrita."
        : "Universo, regras e limites evitam contradições.",
      onClick: () => handleTabChange("universe"),
      status: hasUniverseProfile ? "feito" : "fixar",
      tone: hasUniverseProfile ? "done" : "action",
      disabled: false,
    },
    {
      step: "5",
      title: "Escrever e revisar",
      description: materialReady
        ? "Com a base organizada, volte para Rascunho, Escrita e Revisão."
        : "Prepare a obra antes de abrir produção.",
      onClick: () =>
        materialReady ? navigate("/draft") : handleTabChange("chapters"),
      status: materialReady ? "começar" : "aguarde",
      tone: materialReady ? "action" : "blocked",
      disabled: false,
    },
  ];

  return (
    <>
      {/* Modal de processamento — renderizado via portal direto no body */}
      {processingModeDialog.open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onMouseDown={e => {
              if (e.target === e.currentTarget) {
                setProcessingModeDialog({
                  open: false,
                  reference: null,
                  wordCount: 0,
                  chunks: 0,
                });
              }
            }}
          >
            <div className="relative w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl mx-4">
              <button
                type="button"
                onClick={() =>
                  setProcessingModeDialog({
                    open: false,
                    reference: null,
                    wordCount: 0,
                    chunks: 0,
                  })
                }
                className="absolute right-4 top-4 rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
              <h3 className="text-lg font-semibold text-foreground">
                Leitura por capítulos
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Texto detectado com{" "}
                <strong>
                  {processingModeDialog.wordCount.toLocaleString("pt-BR")}
                </strong>{" "}
                palavras. A importação vai criar dossiês salvos por capítulo:
                cada capítulo entra inteiro até 4 mil palavras; capítulos
                maiores são divididos em partes. Personagens, universo,
                timeline e análise usarão esses dossiês depois, apenas quando
                você acionar.
              </p>
              <div className="mt-4 grid gap-3">
                <button
                  onClick={handleProcessingModeChoice}
                  className="flex flex-col gap-1 rounded-lg border border-accent/60 bg-accent/10 p-4 text-left transition-colors hover:border-accent hover:bg-accent/15"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      Criar dossiês por capítulo
                    </span>
                    <Badge
                      variant="secondary"
                      className="bg-accent/20 text-accent text-[10px] px-2 py-0"
                    >
                      Recomendado
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    A IA lê cada capítulo ou parte em sequência e salva uma
                    memória factual detalhada. O sistema não vai extrair
                    personagens nem universo automaticamente nesta etapa.
                  </span>
                  <span className="mt-1 text-xs font-medium text-accent">
                    ~
                    {processingModeDialog.chunks > 1
                      ? 8 + (processingModeDialog.chunks - 1) * 2
                      : 8}{" "}
                    créditos flexíveis · {processingModeDialog.chunks} bloco
                    {processingModeDialog.chunks > 1 ? "s" : ""} estimado
                    {processingModeDialog.chunks > 1 ? "s" : ""}
                  </span>
                </button>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setProcessingModeDialog({
                      open: false,
                      reference: null,
                      wordCount: 0,
                      chunks: 0,
                    });
                  }}
                >
                  Salvar sem ler agora
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <div className="space-y-4">
        {workInfoEditorOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
            onMouseDown={event => {
              if (event.target === event.currentTarget)
                setWorkInfoEditorOpen(false);
            }}
          >
            <div className="w-full max-w-[560px] rounded-lg border border-border bg-card p-5 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-xl text-foreground">
                  Editar card da obra
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setWorkInfoEditorOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-5 space-y-3">
                <Input
                  value={workInfoForm.title}
                  onChange={event =>
                    setWorkInfoForm(current => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Nome do livro"
                />
                <Input
                  value={workInfoForm.subtitle}
                  onChange={event =>
                    setWorkInfoForm(current => ({
                      ...current,
                      subtitle: event.target.value,
                    }))
                  }
                  placeholder="Subtítulo"
                />
                <Input
                  value={workInfoForm.genre}
                  onChange={event =>
                    setWorkInfoForm(current => ({
                      ...current,
                      genre: event.target.value,
                    }))
                  }
                  placeholder="Gênero"
                />
                <Textarea
                  rows={5}
                  value={workInfoForm.description}
                  onChange={event =>
                    setWorkInfoForm(current => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Descrição curta que aparece no card."
                />
              </div>
              <Button
                type="button"
                onClick={handleSaveWorkInfo}
                disabled={updateWorkMutation.isPending}
                className="mt-5 w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {updateWorkMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Salvar card
              </Button>
            </div>
          </div>
        ) : null}

        <AlertDialog
          open={Boolean(pendingTab)}
          onOpenChange={open => !open && setPendingTab(null)}
        >
          <AlertDialogContent className="border border-border bg-card">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">
                Alterações não salvas
              </AlertDialogTitle>
              <AlertDialogDescription>
                Você tem mudanças pendentes nesta aba. Se trocar agora, vai
                perder o que não salvou. Deseja continuar
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Ficar aqui</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmTabSwitch}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                Trocar mesmo assim
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-accent">
                <BookOpen className="h-3.5 w-3.5" />
                Obras / Livro
              </div>
              <h2 className="mt-1 truncate font-display text-2xl text-foreground">
                {activeWork?.title || "Nenhuma obra ativa"}
              </h2>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleReturnToWorks(false)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar às obras
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleReturnToWorks(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nova obra
              </Button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            <div className="relative isolate min-h-[286px] overflow-hidden rounded-lg border border-white/15 bg-card/45 p-6 shadow-sm">
              <div
                className="absolute inset-0 z-0 rounded-lg"
                style={getCoverGlassLayerStyle(activeCoverTint)}
              />
              <div className="absolute inset-y-0 right-0 z-[1] hidden w-[42%] overflow-hidden md:block">
                {activeHasCoverImage ? (
                  <img
                    src={activeWork?.coverImage || undefined}
                    alt={`Capa de ${activeWork?.title || "obra ativa"}`}
                    className="absolute inset-0 h-full w-full object-cover opacity-95"
                    style={{
                      ...getCoverImageStyle(coverDraft),
                      ...coverRevealMaskStyle,
                    }}
                  />
                ) : (
                  <DefaultCoverArt className="absolute inset-0 h-full w-full opacity-90" />
                )}
              </div>
              <div className="relative z-20 flex max-w-3xl flex-col justify-center">
                <div className="flex flex-wrap gap-2">
                  <span
                    className="rounded-full px-3 py-1 text-xs font-medium capitalize"
                    style={{
                      border: `1px solid ${activeStatusBorderColor}`,
                      backgroundColor: "rgba(0,0,0,0.42)",
                      color: activeStatusColor,
                    }}
                  >
                    {activeStatusLabel}
                  </span>
                  <span className="rounded-full border border-border/70 bg-background/45 px-3 py-1 text-xs text-muted-foreground">
                    {activeWork?.genre || "Gênero não definido"}
                  </span>
                </div>
                <h1 className="mt-5 max-w-2xl font-serif text-[clamp(2rem,4vw,3.6rem)] leading-[1.02] text-foreground">
                  {activeWork?.title || "Obra"}
                </h1>
                {activeWork?.subtitle ? (
                  <p className="mt-2 max-w-xl font-serif text-xl leading-8 text-foreground/82">
                    {activeWork.subtitle}
                  </p>
                ) : null}
                <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {activeWork?.description ||
                    "Complete a identidade do livro para orientar rascunho, escrita, revisão e publicação."}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Link href="/draft">
                    <Button
                      type="button"
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      Continuar rascunho
                    </Button>
                  </Link>
                  <Link href="/writing">
                    <Button type="button" variant="outline">
                      Ir para escrita
                    </Button>
                  </Link>
                  <Link href="/review">
                    <Button type="button" variant="outline">
                      Revisar capítulos
                    </Button>
                  </Link>
                </div>
              </div>
            </div>

            <Card className="border border-border bg-card/72 p-5">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-accent">
                <Compass className="h-4 w-4" />
                Próxima ação
              </div>
              <h3 className="mt-3 font-display text-xl text-foreground">
                Prepare o livro antes de gerar texto.
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                O caminho recomendado é importar ou revisar o material base,
                confirmar personagens e ajustar estilo. A Escrita usa essas
                informações como fonte.
              </p>
              <div className="mt-5 grid gap-2">
                <button
                  type="button"
                  onClick={() => handleTabChange("guide")}
                  className="rounded-md border border-border bg-background/45 px-3 py-2 text-left text-sm text-foreground transition hover:border-accent/50"
                >
                  Ver guia do livro
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange("chapters")}
                  className="rounded-md border border-border bg-background/45 px-3 py-2 text-left text-sm text-foreground transition hover:border-accent/50"
                >
                  Importar material
                </button>
              </div>
            </Card>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="grid gap-5 xl:grid-cols-[286px_minmax(0,1fr)] xl:items-start"
        >
          <aside className="space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
            <Card className="border border-border bg-card/78 p-3">
              <TabsList className="flex h-auto w-full flex-col items-stretch justify-start gap-3 border-0 bg-transparent p-0 shadow-none">
                {workspaceNavGroups.map(group => (
                  <div key={group.label} className="space-y-1">
                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {group.label}
                    </div>
                    {group.items.map(item => {
                      const Icon = item.icon;
                      return (
                        <TabsTrigger
                          key={item.value}
                          value={item.value}
                          className="h-auto w-full justify-start rounded-md px-2.5 py-2.5 text-left data-[state=active]:border-accent/40 data-[state=active]:bg-accent/10 data-[state=active]:text-foreground"
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold leading-5">
                              {item.label}
                            </span>
                            <span className="block whitespace-normal text-xs font-normal leading-4 text-muted-foreground">
                              {item.description}
                            </span>
                          </span>
                        </TabsTrigger>
                      );
                    })}
                  </div>
                ))}
              </TabsList>
            </Card>
            <Card className="border border-border bg-card/72 p-3">
              <Button
                type="button"
                onClick={handleSaveFullProfile}
                disabled={!activeWorkId || updateMutation.isPending}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Salvar livro
              </Button>
              <Link href="/draft">
                <Button type="button" variant="outline" className="mt-2 w-full">
                  <FileText className="mr-2 h-4 w-4" />
                  Ir para rascunho
                </Button>
              </Link>
            </Card>
          </aside>

          <div className="min-w-0 space-y-4">
            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
                <Card className="border border-border bg-card p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Material
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">
                    {savedReferences.length + linkedExistingCount}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    referências e capítulos conectados.
                  </p>
                </Card>
                <Card className="border border-border bg-card p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Estilo
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">
                    {activeStyleSamples.length}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    amostras ativas para orientar a escrita.
                  </p>
                </Card>
                <Card className="border border-border bg-card p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Continuidade
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">
                    {activeContinuityMemories}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    memórias narrativas ativas.
                  </p>
                </Card>
                <Card className="border border-border bg-card p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Status
                  </div>
                  <div className="mt-2 text-2xl font-semibold capitalize text-foreground">
                    {activeStatusLabel}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    estado atual do livro.
                  </p>
                </Card>
              </div>

              <Card className="border border-border bg-card p-5">
                <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                  <div>
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-accent">
                      <ClipboardCheck className="h-4 w-4" />
                      Comece por aqui
                    </div>
                    <h3 className="mt-3 font-display text-2xl text-foreground">
                      Organize o livro antes de pedir produção.
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      O workspace agora separa o que é material bruto, cânone,
                      personagens, estilo e qualidade. Use o guia para saber o
                      próximo passo sem precisar entender toda a arquitetura.
                    </p>
                  </div>
                  <div className="grid gap-3">
                    {[
                      [
                        "Material importado",
                        materialReady
                          ? "Revise documentos e referências conectadas."
                          : "Suba livro, notas ou referências.",
                        "chapters",
                      ],
                      [
                        "Personagens",
                        characters.length
                          ? "Revise resumos, papéis e vínculos extraídos."
                          : characterSyncReference
                            ? "Extraia resumos a partir do material importado."
                            : "Importe material antes de criar resumos.",
                        "characters",
                      ],
                      [
                        "Estilo",
                        activeStyleSamples.length
                          ? "Revise a voz ativa da obra."
                          : "Ensine a voz e a cadência da obra.",
                        "style",
                      ],
                      [
                        "Cânone",
                        hasUniverseProfile
                          ? "Revise regras, universo e limites."
                          : "Fixe regras, universo e limites.",
                        "universe",
                      ],
                    ].map(([title, description, tab]) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => handleTabChange(tab)}
                        className="rounded-lg border border-border bg-background/45 p-4 text-left transition hover:border-accent/45 hover:bg-background/70"
                      >
                        <div className="font-semibold text-foreground">
                          {title}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="guide" className="space-y-4">
              <Card className="border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-accent">
                      <ClipboardCheck className="h-4 w-4" />
                      Guia do livro
                    </div>
                    <h3 className="mt-3 font-display text-2xl text-foreground">
                      Um caminho simples para preparar a obra.
                    </h3>
                  </div>
                  <Badge
                    variant="secondary"
                    className="bg-accent/15 px-3 py-1 text-accent"
                  >
                    fluxo recomendado
                  </Badge>
                </div>
                <div className="mt-6 space-y-3">
                  {guideSteps.map(item => (
                    <button
                      key={item.step}
                      type="button"
                      onClick={item.onClick}
                      disabled={item.disabled}
                      className="grid w-full gap-3 rounded-lg border border-border bg-background/40 p-4 text-left transition hover:border-accent/45 disabled:cursor-wait disabled:opacity-70 md:grid-cols-[3rem_1fr_auto] md:items-center"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/35 bg-accent/10 text-sm font-semibold text-accent">
                        {item.step}
                      </span>
                      <span>
                        <span className="block font-semibold text-foreground">
                          {item.title}
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                      <span
                        className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${
                          item.tone === "done"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : item.tone === "review"
                              ? "bg-blue-500/15 text-blue-300"
                              : item.tone === "action"
                                ? "bg-accent/15 text-accent"
                                : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {item.status}
                      </span>
                    </button>
                  ))}
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <Card className="border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-xl text-foreground">
                        Identidade do livro
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Edite capa, título, subtítulo, gênero e status sem
                        misturar isso com o material canônico.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={openWorkInfoEditor}
                      disabled={!activeWork || updateWorkMutation.isPending}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar dados
                    </Button>
                  </div>

                  <div className="mt-5 rounded-lg border border-white/15 bg-background/35 p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Livro
                    </div>
                    <h4 className="mt-2 font-serif text-3xl leading-tight text-foreground">
                      {activeWork?.title || "Obra"}
                    </h4>
                    {activeWork?.subtitle ? (
                      <p className="mt-1 font-serif text-lg text-foreground/80">
                        {activeWork.subtitle}
                      </p>
                    ) : null}
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {activeWork?.description || "Sem descrição cadastrada."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        title={
                          activeWorkIsPaused ? "Retomar obra" : "Pausar obra"
                        }
                        onClick={() => {
                          if (!activeWork?.id) return;
                          updateWorkMutation.mutate({
                            workId: activeWork.id,
                            status: activeWorkIsPaused
                              ? "in_progress"
                              : "paused",
                          });
                        }}
                        disabled={!activeWork || updateWorkMutation.isPending}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground transition hover:border-accent/50 disabled:opacity-50"
                      >
                        {activeWorkIsPaused ? (
                          <Play className="h-4 w-4 text-emerald-300" />
                        ) : (
                          <Pause className="h-4 w-4 text-amber-300" />
                        )}
                        {activeWorkIsPaused ? "Retomar obra" : "Pausar obra"}
                      </button>
                    </div>
                  </div>
                </Card>

                <Card className="border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <SlidersHorizontal className="h-4 w-4 text-accent" />
                      Capa
                    </div>
                    {activeHasCoverImage ? (
                      <button
                        type="button"
                        onClick={handleRemoveActiveWorkCover}
                        disabled={updateWorkMutation.isPending}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        title="Remover capa"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => openFileInput(activeWorkCoverInputRef)}
                    disabled={updateWorkMutation.isPending}
                    className="mt-3 flex h-9 w-full cursor-pointer items-center justify-center rounded-md border border-border bg-background/60 px-3 text-sm text-foreground transition-colors hover:border-accent/60 disabled:pointer-events-none disabled:opacity-60"
                  >
                    {updateWorkMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {activeHasCoverImage ? "Trocar imagem" : "Subir imagem"}
                  </button>
                  <input
                    ref={activeWorkCoverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleActiveWorkCoverUpload}
                  />
                  <div
                    className={`mt-4 grid gap-3 ${!activeHasCoverImage ? "pointer-events-none opacity-40" : ""}`}
                  >
                    <div className="grid grid-cols-[70px_1fr_38px] items-center gap-2 text-xs text-muted-foreground">
                      <span>Horizontal</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={coverDraft.coverPositionX}
                        onChange={event =>
                          setCoverDraft(current => ({
                            ...current,
                            coverPositionX: Number(event.target.value),
                          }))
                        }
                        className="w-full accent-accent"
                      />
                      <span className="text-right">
                        {coverDraft.coverPositionX}%
                      </span>
                    </div>
                    <div className="grid grid-cols-[70px_1fr_38px] items-center gap-2 text-xs text-muted-foreground">
                      <span>Vertical</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={coverDraft.coverPositionY}
                        onChange={event =>
                          setCoverDraft(current => ({
                            ...current,
                            coverPositionY: Number(event.target.value),
                          }))
                        }
                        className="w-full accent-accent"
                      />
                      <span className="text-right">
                        {coverDraft.coverPositionY}%
                      </span>
                    </div>
                    <div className="grid grid-cols-[70px_1fr_38px] items-center gap-2 text-xs text-muted-foreground">
                      <span>Zoom</span>
                      <input
                        type="range"
                        min={100}
                        max={180}
                        value={coverDraft.coverScale}
                        onChange={event =>
                          setCoverDraft(current => ({
                            ...current,
                            coverScale: Number(event.target.value),
                          }))
                        }
                        className="w-full accent-accent"
                      />
                      <span className="text-right">
                        {coverDraft.coverScale}%
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveCoverDraft}
                    disabled={
                      updateWorkMutation.isPending || !activeHasCoverImage
                    }
                    className="mt-5 h-9 w-full bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Salvar posição
                  </Button>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="style" className="space-y-4">
              <Card className="space-y-5 border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg text-foreground">
                      Estilo de escrita
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                      Suba capítulos ou trechos que representem a voz desejada.
                      A IA usa essas amostras para inferir cadência, tom, ritmo
                      de frase, densidade descritiva, diálogos e subtexto na aba
                      Escrita.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge
                      variant="secondary"
                      className={
                        activeWorkIsPaused
                          ? "bg-amber-500/15 px-3 py-1 text-amber-300"
                          : "bg-accent/15 px-3 py-1 text-accent"
                      }
                    >
                      {activeWorkIsPaused
                        ? "obra pausada"
                        : `${activeStyleSamples.length} ativa(s)`}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="bg-secondary px-3 py-1 text-foreground"
                    >
                      {styleWordCount.toLocaleString("pt-BR")} palavras
                    </Badge>
                  </div>
                </div>

                <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 text-xs leading-5 text-muted-foreground">
                  Esta aba não é para continuidade de enredo. Use-a para ensinar
                  como escrever: voz narrativa, musicalidade, nível de detalhe,
                  cortes de cena, tratamento emocional, humor, tensão, silêncio
                  e forma dos diálogos.
                </div>

                <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Notas manuais de estilo
                      </label>
                      <Textarea
                        value={styleNotes}
                        onChange={e => handleStyleNotesChange(e.target.value)}
                        onBlur={() => {
                          if (unsavedStyle)
                            void persistStyleProfile(styleProfileRef.current);
                        }}
                        rows={12}
                        className="resize-none bg-secondary"
                        placeholder="Ex: narrador seco e íntimo; frases curtas em ação; descrições sensoriais sem explicar emoção; diálogo com subtexto; evitar tom didático..."
                      />
                    </div>

                    <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-foreground">
                            Subir capítulo como amostra de estilo
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Aceita múltiplos arquivos. Suporta{" "}
                            {getSupportedExtensions()}.
                          </p>
                        </div>
                        <label
                          htmlFor="style-sample-upload"
                          className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-accent ${uploadingStyleSamples ? "pointer-events-none opacity-60" : ""}`}
                        >
                          {uploadingStyleSamples ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                          {uploadingStyleSamples
                            ? "Lendo arquivo..."
                            : "Enviar amostra"}
                        </label>
                        <input
                          id="style-sample-upload"
                          ref={styleSampleInputRef}
                          type="file"
                          multiple
                          accept={getAcceptString()}
                          className="sr-only"
                          onChange={handleStyleSampleUpload}
                          disabled={uploadingStyleSamples}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-border/70 bg-secondary/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-foreground">
                          Amostras salvas para escrita
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Uploads, análises e seleção ativa são salvos
                          automaticamente no perfil.
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className="bg-blue-500/15 px-2.5 py-1 text-blue-300"
                      >
                        {styleSamples.length}
                      </Badge>
                    </div>

                    <div className="max-h-[440px] space-y-3 overflow-y-auto pr-1">
                      {styleSamples.length ? (
                        styleSamples.map(sample => {
                          const wc = sample.content
                            .split(/\s+/)
                            .filter(Boolean).length;
                          return (
                            <div
                              key={sample.id}
                              className="rounded-lg border border-border/70 bg-background/45 p-3"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-foreground">
                                    {sample.title}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                    {sample.fileName ? (
                                      <span className="rounded-full bg-secondary px-2 py-0.5">
                                        {sample.fileName}
                                      </span>
                                    ) : null}
                                    <span className="rounded-full bg-secondary px-2 py-0.5">
                                      {wc.toLocaleString("pt-BR")} palavras
                                    </span>
                                    {activeWorkIsPaused || !sample.isActive ? (
                                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                                        pausada
                                      </span>
                                    ) : (
                                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                                        ativa
                                      </span>
                                    )}
                                    {sample.analysis ? (
                                      <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-blue-300">
                                        essência absorvida
                                      </span>
                                    ) : (
                                      <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                                        sem essência
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    onClick={() =>
                                      handleAnalyzeStyleSample(sample.id)
                                    }
                                    disabled={
                                      analyzingStyleSampleId === sample.id ||
                                      analyzeStyleMutation.isPending
                                    }
                                    title={
                                      sample.analysis
                                        ? "Reabsorver essência"
                                        : "Absorver essência"
                                    }
                                  >
                                    {analyzingStyleSampleId === sample.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Sparkles className="h-3.5 w-3.5 text-blue-300" />
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    onClick={() =>
                                      handleToggleStyleSample(sample.id)
                                    }
                                    title={
                                      sample.isActive
                                        ? "Pausar amostra"
                                        : "Ativar amostra"
                                    }
                                  >
                                    {!sample.isActive ? (
                                      <ToggleLeft className="h-3.5 w-3.5 text-amber-400" />
                                    ) : (
                                      <ToggleRight className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                    onClick={() =>
                                      handleRemoveStyleSample(sample.id)
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                              <div className="mt-3 max-h-[160px] overflow-y-auto rounded-lg bg-secondary/45 p-3 text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
                                {sample.content}
                              </div>
                              {sample.analysis ? (
                                <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs leading-5 text-muted-foreground">
                                  <div className="mb-1 font-medium text-blue-200">
                                    Essência absorvida
                                  </div>
                                  <p>{sample.analysis.essence}</p>
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    {sample.analysis.sentenceRhythm ? (
                                      <span>
                                        <strong className="text-foreground">
                                          Frase:
                                        </strong>{" "}
                                        {sample.analysis.sentenceRhythm}
                                      </span>
                                    ) : null}
                                    {sample.analysis.dialogue ? (
                                      <span>
                                        <strong className="text-foreground">
                                          Diálogo:
                                        </strong>{" "}
                                        {sample.analysis.dialogue}
                                      </span>
                                    ) : null}
                                    {sample.analysis.introspection ? (
                                      <span>
                                        <strong className="text-foreground">
                                          Introspecção:
                                        </strong>{" "}
                                        {sample.analysis.introspection}
                                      </span>
                                    ) : null}
                                    {sample.analysis.tension ? (
                                      <span>
                                        <strong className="text-foreground">
                                          Tensão:
                                        </strong>{" "}
                                        {sample.analysis.tension}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-lg border-2 border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                          Nenhuma amostra de estilo ainda. Suba um capítulo para
                          a IA aprender a voz de escrita.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveStyle}
                    disabled={updateMutation.isPending}
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar estilo
                  </Button>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="chapters" className="space-y-4">
              <Card className="border border-accent/25 bg-accent/5 p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="rounded-full border border-accent/30 bg-background/70 p-2 text-accent">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-lg text-foreground">
                      Fontes brutas e cânone
                    </h3>
                    <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">
                      Esta aba guarda documentos, capítulos e livros base. A IA
                      pode ler a obra inteira aqui, mas o material só passa a
                      orientar a Escrita quando estiver ativo, resumido,
                      conectado e salvo nas configurações do livro.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      <div className="rounded-lg border border-border bg-background/45 p-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-accent">
                          1. Fonte bruta
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Arquivo ou texto original, sem perder detalhes.
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-background/45 p-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-accent">
                          2. Leitura IA
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Resumo seccionado, personagens, continuidade e
                          universo sugeridos.
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-background/45 p-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-accent">
                          3. Cânone aprovado
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          O que foi salvo alimenta Universo, Personagens,
                          Timeline, Biblioteca e Escrita.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Seção 1: Capítulos vinculados */}
              <Card className="space-y-4 border border-border bg-card p-4">
                <div>
                  <h3 className="font-display text-lg text-foreground">
                    Capítulos vinculados
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Selecione capítulos já escritos para a IA usar como fonte
                    bruta de estilo, tom e continuidade ao gerar novos
                    capítulos.
                  </p>
                </div>
                {linkedExistingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-accent/15 px-3 py-1 text-accent"
                  >
                    {linkedExistingCount} selecionado(s)
                  </Badge>
                )}
                <div className="max-h-[360px] space-y-2 overflow-y-auto">
                  {chaptersQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando...
                    </div>
                  ) : chapters.length ? (
                    chapters.map((chapter: any) => {
                      const active = keyChaptersState.linkedChapters.some(
                        item => item.chapterId === chapter.id
                      );
                      return (
                        <button
                          key={chapter.id}
                          onClick={() => toggleExistingChapter(chapter)}
                          className={`w-full rounded-lg border p-3 text-left transition-colors ${active ? "border-accent bg-accent/10" : "border-border bg-secondary/50 hover:border-accent/50"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium text-foreground">
                              {chapter.title}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-background/50 px-2 py-0.5 text-xs text-muted-foreground">
                                {chapter.status === "canonical"
                                  ? "canônico"
                                  : chapter.status === "in_development"
                                    ? "em desenvolvimento"
                                    : chapter.status}
                              </span>
                              {active && (
                                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                                  vinculado
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-lg border-2 border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                      Nenhum capítulo criado ainda. Gere capítulos na aba
                      Escrita para vincular aqui.
                    </div>
                  )}
                </div>
              </Card>

              {/* Seção 2: Referências externas */}
              <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1fr_1fr]">
                <Card className="space-y-4 border border-border bg-card p-4">
                  <div>
                    <h3 className="font-display text-lg text-foreground">
                      {editingReferenceId
                        ? "Editar referência"
                        : "Nova referência externa"}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Suba o documento inteiro, trechos de livro ou notas. A IA
                      lê primeiro como fonte bruta e só depois separa o que deve
                      ir para continuidade, universo, personagens e biblioteca.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          referenceDraftMode === "manual"
                            ? "default"
                            : "outline"
                        }
                        onClick={startManualReference}
                      >
                        Texto manual
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          referenceDraftMode === "upload"
                            ? "default"
                            : "outline"
                        }
                        onClick={startUploadReference}
                      >
                        Subir arquivo
                      </Button>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Título
                      </label>
                      <Input
                        value={referenceForm.title}
                        onChange={e =>
                          setReferenceForm(prev => ({
                            ...prev,
                            title: e.target.value,
                          }))
                        }
                        className="bg-secondary"
                        placeholder="Ex: Cap. 3 - jántar no Kremlin; Livro X - cena de tribunal"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Observação (opcional)
                      </label>
                      <Input
                        value={referenceForm.notes}
                        onChange={e =>
                          setReferenceForm(prev => ({
                            ...prev,
                            notes: e.target.value,
                          }))
                        }
                        className="bg-secondary"
                        placeholder="Ex: referência de ritmo e subtexto"
                      />
                    </div>

                    {referenceDraftMode === "manual" ? (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Conteúdo
                        </label>
                        <Textarea
                          value={referenceForm.content}
                          onChange={e => {
                            setReferenceForm(prev => ({
                              ...prev,
                              content: e.target.value,
                            }));
                          }}
                          rows={8}
                          className="resize-none bg-secondary"
                          placeholder="Cole ou escreva o texto de referência aqui."
                        />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              Subir arquivo
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Suporta {getSupportedExtensions()}.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              openFileInput(referenceUploadInputRef)
                            }
                            disabled={parsingReferenceUpload}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-accent"
                          >
                            {parsingReferenceUpload ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                            {parsingReferenceUpload ? "Lendo..." : "Escolher"}
                          </button>
                          <input
                            ref={referenceUploadInputRef}
                            type="file"
                            accept={getAcceptString()}
                            className="hidden"
                            onChange={handleReferenceUpload}
                          />
                        </div>
                        {uploadedReferenceDraft ? (
                          <div className="mt-3 rounded-lg border border-accent/25 bg-accent/5 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <FileUp className="h-4 w-4 shrink-0 text-accent" />
                                <span className="truncate text-sm font-medium text-foreground">
                                  {uploadedReferenceDraft.fileName}
                                </span>
                              </div>
                              <span className="rounded-full bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
                                {(
                                  uploadedReferenceDraft.format || "arquivo"
                                ).toUpperCase()}{" "}
                                ·{" "}
                                {(
                                  uploadedReferenceDraft.wordCount ??
                                  countReferenceWords(
                                    uploadedReferenceDraft.content
                                  )
                                ).toLocaleString("pt-BR")}{" "}
                                palavras
                              </span>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                              Arquivo carregado localmente. Clique em{" "}
                              <strong>Adicionar</strong> para salvar no livro e
                              iniciar a leitura por capítulos.
                            </p>
                            <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-2 text-xs leading-5 text-muted-foreground line-clamp-3">
                              {uploadedReferenceDraft.content}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    {editingReferenceId ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={resetReferenceForm}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Cancelar
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      onClick={saveReferenceDraft}
                      disabled={
                        (referenceDraftMode === "upload" &&
                          !uploadedReferenceDraft) ||
                        parsingReferenceUpload ||
                        silentKeyChaptersMutation.isPending ||
                        summarizeMutation.isPending ||
                        syncImportedReferenceMutation.isPending
                      }
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                      {parsingReferenceUpload ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Lendo arquivo...
                        </>
                      ) : silentKeyChaptersMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvando...
                        </>
                      ) : summarizeMutation.isPending ||
                        syncImportedReferenceMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Processando...
                        </>
                      ) : editingReferenceId ? (
                        <>
                          <Pencil className="mr-2 h-4 w-4" />
                          Atualizar
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Adicionar
                        </>
                      )}
                    </Button>
                  </div>
                </Card>

                {importProgressPhase && (
                  <ImportProgressPanel phase={importProgressPhase} />
                )}

                <Card className="space-y-4 border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
                    <h3 className="font-display text-lg text-foreground">
                      Referências salvas
                    </h3>
                    <Badge
                      variant="secondary"
                      className="bg-blue-500/15 px-3 py-1 text-blue-400"
                    >
                      {savedReferences.length}
                    </Badge>
                  </div>
                  <p className="-mt-1 text-xs text-muted-foreground">
                    Cada referência mantém o original e os dossiês por capítulo.
                    Personagens, universo e timeline só são conectados quando
                    você aciona.
                  </p>
                  <div className="max-h-[480px] space-y-3 overflow-y-auto">
                    {savedReferences.length ? (
                      savedReferences.map(item => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-border/80 bg-secondary/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-foreground truncate">
                                {item.title}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                <span className="rounded-full bg-background/60 px-2 py-0.5">
                                  {item.sourceType === "upload"
                                    ? "arquivo"
                                    : "manual"}
                                </span>
                                {item.fileName ? (
                                  <span className="rounded-full bg-background/60 px-2 py-0.5 truncate max-w-[140px]">
                                    {item.fileName}
                                  </span>
                                ) : null}
                                {activeWorkIsPaused || !item.isActive ? (
                                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                                    pausada
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                                    ativa
                                  </span>
                                )}
                                {item.summaryStatus === "done" && (
                                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-blue-300">
                                    {(item.analysisBlocks ?? []).length
                                      ? "dossiês"
                                      : "índice"}
                                  </span>
                                )}
                                {item.continuitySnippet ? (
                                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                                    continuidade
                                  </span>
                                ) : null}
                                {(item.importedCharacterIds ?? []).length ? (
                                  <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-cyan-300">
                                    {(item.importedCharacterIds ?? []).length}{" "}
                                    personagem(ns)
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                onClick={() => handleToggleReference(item.id)}
                                title={
                                  item.isActive
                                    ? "Pausar referência"
                                    : "Ativar referência"
                                }
                              >
                                {!item.isActive ? (
                                  <ToggleLeft className="h-3.5 w-3.5 text-amber-400" />
                                ) : (
                                  <ToggleRight className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                onClick={() => handleEditReference(item)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => handleRemoveReference(item.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          {item.notes ? (
                            <p className="mt-1.5 text-sm text-muted-foreground">
                              {item.notes}
                            </p>
                          ) : null}
                          {!item.summary ? (
                            <div className="mt-2 rounded-lg border border-border/50 bg-background/35 p-3 text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                              {item.content}
                            </div>
                          ) : (
                            <Collapsible className="mt-2">
                              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground">
                                <span>Ver documento original</span>
                                <ChevronDown className="h-4 w-4 transition-transform [[data-state=open]>&]:rotate-180" />
                              </CollapsibleTrigger>
                              <CollapsibleContent className="pt-2">
                                <div className="rounded-lg bg-background/40 p-2.5 text-sm text-muted-foreground line-clamp-5 whitespace-pre-wrap">
                                  {item.content}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                          {(() => {
                            const wc = countReferenceWords(item.content);
                            const hasChapterDossiers = Boolean(
                              (item.analysisBlocks ?? []).length
                            );
                            const canSyncProfile = hasChapterDossiers;
                            const chunks = Math.ceil(wc / 4000);
                            const chunksCost =
                              chunks > 1 ? 8 + (chunks - 1) * 2 : 8;
                            const isPending = item.summaryStatus === "pending";
                            const activeMode = processingModeByRef[item.id];
                            const isChaptered = activeMode === "chaptered";
                            const hasAutomaticLinks = Boolean(
                              item.continuitySnippet ||
                                (item.importedCharacterIds ?? []).length ||
                                (item.importedTimelineEvents ?? []).length
                            );
                            return (
                              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                                {canSyncProfile ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      triggerReferenceProfileSync(item)
                                    }
                                    disabled={
                                      syncImportedReferenceMutation.isPending
                                    }
                                  >
                                    {hasAutomaticLinks
                                      ? "Atualizar cânone importado"
                                      : "Revisar e conectar ao cânone"}
                                  </Button>
                                ) : null}
                                {(item.importedCharacterIds ?? []).length ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      handleTabChange("characters")
                                    }
                                  >
                                    Revisar personagens
                                  </Button>
                                ) : null}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isPending}
                                  onClick={() => {
                                    if (wc > LARGE_TEXT_THRESHOLD) {
                                      setProcessingModeDialog({
                                        open: true,
                                        reference: item,
                                        wordCount: wc,
                                        chunks,
                                      });
                                    } else {
                                      triggerReferenceSummary(item, "chaptered");
                                    }
                                  }}
                                >
                                  {isPending ? (
                                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="mr-2 h-3.5 w-3.5" />
                                  )}
                                  {isPending
                                    ? `Lendo por capítulos${chunks > 1 ? ` (${chunks} blocos)` : ""}...`
                                    : hasChapterDossiers
                                      ? "Atualizar dossiês"
                                      : "Criar dossiês por capítulo"}
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  {wc.toLocaleString("pt-BR")} palavras
                                  {isPending && isChaptered
                                      ? ` · ${chunks} blocos estimados`
                                      : chunks > 1
                                        ? ` · ${chunks} blocos estimados`
                                        : ""}{" "}
                                  · ~{chunksCost} créditos flexíveis
                                </span>
                                {item.summaryStatus === "error" ? (
                                  <span className="text-xs text-destructive">
                                    Falha na última geração.
                                  </span>
                                ) : null}
                              </div>
                            );
                          })()}
                          {(item.analysisBlocks ?? []).length ? (
                            <div className="mt-3 space-y-3 rounded-lg border border-accent/25 bg-accent/5 p-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="text-sm font-medium text-foreground">
                                    Dossiês por capítulo
                                  </div>
                                  <div className="text-xs leading-5 text-muted-foreground">
                                    {(item.analysisBlocks ?? [])
                                      .length.toLocaleString("pt-BR")}{" "}
                                    bloco(s) salvos ·{" "}
                                    {(item.analysisBlocks ?? [])
                                      .reduce(
                                        (total, block) =>
                                          total +
                                          countReferenceWords(block.dossier),
                                        0
                                      )
                                      .toLocaleString("pt-BR")}{" "}
                                    palavras de memória factual · teto atual:
                                    1.000 por bloco
                                  </div>
                                </div>
                                <div className="rounded-full bg-background/50 px-2.5 py-1 text-xs text-accent">
                                  fonte oficial da IA
                                </div>
                              </div>
                              <div className="max-h-[560px] space-y-3 overflow-y-auto overscroll-contain pr-2">
                                {(item.analysisBlocks ?? [])
                                  .slice()
                                  .sort((a, b) => a.index - b.index)
                                  .map(block => (
                                    <article
                                      key={`${item.id}-${block.index}`}
                                      className="rounded-lg border border-border/70 bg-background/55 p-3"
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="text-xs font-medium uppercase tracking-[0.12em] text-accent/85">
                                            Bloco {block.index}
                                            {block.part && block.totalParts
                                              ? ` · parte ${block.part}/${block.totalParts}`
                                              : ""}
                                          </div>
                                          <h4 className="mt-1 truncate text-sm font-semibold text-foreground">
                                            {block.title}
                                          </h4>
                                        </div>
                                        <span className="rounded-full border border-border bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground">
                                          {block.wordCount.toLocaleString(
                                            "pt-BR"
                                          )}{" "}
                                          palavras originais
                                        </span>
                                      </div>
                                      {block.sourceAnchors?.length ? (
                                        <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                          Âncoras:{" "}
                                          {block.sourceAnchors
                                            .slice(0, 18)
                                            .join(", ")}
                                        </div>
                                      ) : null}
                                      <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                                        {block.dossier}
                                      </div>
                                    </article>
                                  ))}
                              </div>
                            </div>
                          ) : item.summary ? (
                            <div className="mt-3 space-y-3 rounded-lg border border-accent/20 bg-accent/5 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-sm font-medium text-foreground">
                                    Índice técnico da leitura
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {item.summary
                                      .split(/\s+/)
                                      .filter(Boolean)
                                      .length.toLocaleString("pt-BR")}{" "}
                                    palavras resumidas
                                  </div>
                                </div>
                                <div className="rounded-full bg-background/50 px-2.5 py-1 text-xs text-accent">
                                  {(item.importedCharacterIds ?? []).length
                                    ? "Cânone conectado"
                                    : "Resumo seccionado"}
                                </div>
                              </div>
                              {(() => {
                                const sections = (item.summarySections ?? [])
                                  .length
                                  ? (item.summarySections ?? [])
                                  : parseSummarySections(item.summary ?? "");
                                const activeSectionId = getActiveSummarySection(
                                  item.id,
                                  sections
                                );
                                return (
                                  <div
                                    ref={node => {
                                      summaryScrollRefs.current[item.id] = node;
                                    }}
                                    className="relative max-h-[440px] overflow-y-auto scroll-smooth pr-1"
                                  >
                                    <div
                                      data-summary-nav={item.id}
                                      className="sticky top-0 z-30 -mx-1 mb-3 border-b border-border/60 bg-card/95 px-1 py-2 shadow-[0_12px_20px_rgba(0,0,0,0.32)] backdrop-blur supports-[backdrop-filter]:bg-card/80"
                                    >
                                      <div className="flex flex-wrap gap-1.5">
                                        {sections.map(section => (
                                          <button
                                            type="button"
                                            key={section.id}
                                            onClick={() =>
                                              selectSummarySection(
                                                item.id,
                                                section.id
                                              )
                                            }
                                            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                                              activeSectionId === section.id
                                                ? "border border-accent/60 bg-accent/20 text-accent"
                                                : "border border-border bg-background/40 text-muted-foreground hover:border-accent/30 hover:text-foreground"
                                            }`}
                                          >
                                            {section.label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="space-y-3 pb-2">
                                      {sections.map(section => (
                                        <div
                                          key={section.id}
                                          className={`rounded-lg p-3 ${
                                            activeSectionId === section.id
                                              ? "border border-accent/45 bg-background/60 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.12)]"
                                              : "border border-border/60 bg-background/50"
                                          }`}
                                        >
                                          <div
                                            ref={node => {
                                              summarySectionRefs.current[
                                                getSummarySectionRefKey(
                                                  item.id,
                                                  section.id
                                                )
                                              ] = node;
                                            }}
                                            className={`mb-2 text-xs font-medium uppercase tracking-[0.12em] ${
                                              activeSectionId === section.id
                                                ? "text-accent"
                                                : "text-accent/80"
                                            }`}
                                          >
                                            {section.label}
                                          </div>
                                          <div className="text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
                                            {section.content}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border-2 border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                        Nenhuma referência externa ainda.
                      </div>
                    )}
                  </div>
                </Card>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSaveChapters}
                  disabled={updateMutation.isPending}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Salvar referências
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="continuity" className="space-y-4">
              <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1.05fr_0.95fr]">
                <Card className="space-y-4 border border-border bg-card p-4">
                  <h3 className="font-display text-lg text-foreground">
                    Base canônica da obra anterior
                  </h3>
                  <Textarea
                    value={storyFoundation}
                    onChange={e => setStoryFoundation(e.target.value)}
                    rows={18}
                    className="resize-none bg-secondary"
                    placeholder="Ex: estado final do livro 1, revelações, mortes, relações quebradas, situação política, pontas trazidas para o livro atual..."
                  />
                  {importedContinuityReferences.length ? (
                    <div className="space-y-3 rounded-lg border border-accent/20 bg-accent/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-foreground">
                            Bases importadas automaticamente
                          </div>
                          <p className="text-xs text-muted-foreground">
                            O que entrou por Referências já aparece aqui.
                            Desconectar desta aba não apaga personagens já
                            importados.
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="bg-accent/15 px-2.5 py-1 text-accent"
                        >
                          {importedContinuityReferences.length}
                        </Badge>
                      </div>
                      <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                        {importedContinuityReferences.map(reference => (
                          <div
                            key={reference.id}
                            className="rounded-lg border border-border/60 bg-background/40 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="font-medium text-foreground">
                                  {reference.title}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {(reference.importedCharacterIds ?? [])
                                    .length || 0}{" "}
                                  personagem(ns) conectado(s)
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    syncImportedReferenceMutation.isPending
                                  }
                                  onClick={() =>
                                    handleRefreshImportedReferenceSync(
                                      reference,
                                      "Atualizando continuidade",
                                      "continuity"
                                    )
                                  }
                                >
                                  {syncImportedReferenceMutation.isPending ? (
                                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="mr-2 h-3.5 w-3.5" />
                                  )}
                                  Atualizar base
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    handleCopyImportedContinuity(
                                      reference.continuitySnippet || ""
                                    )
                                  }
                                >
                                  Copiar para base manual
                                </Button>
                                {(reference.importedCharacterIds ?? [])
                                  .length ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      handleTabChange("characters")
                                    }
                                  >
                                    Abrir personagens
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    handleRemoveImportedContinuity(reference.id)
                                  }
                                >
                                  Desconectar desta aba
                                </Button>
                              </div>
                            </div>
                            <div className="mt-3 max-h-[260px] overflow-y-auto overscroll-contain rounded-lg border border-border/60 bg-secondary/35 p-3 pr-4 text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
                              {reference.continuitySnippet}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-foreground">
                          Subir base da saga por arquivo
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Suporta {getSupportedExtensions()}.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openFileInput(foundationUploadInputRef)}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-accent"
                      >
                        <Upload className="h-4 w-4" />
                        Enviar arquivo
                      </button>
                      <input
                        ref={foundationUploadInputRef}
                        type="file"
                        accept={getAcceptString()}
                        className="hidden"
                        onChange={handleFoundationUpload}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setStoryFoundation("")}
                      >
                        Limpar base manual
                      </Button>
                      <Button
                        onClick={handleSaveFoundation}
                        disabled={updateMutation.isPending}
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                      >
                        {updateMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        Salvar base da continuidade
                      </Button>
                    </div>
                  </div>
                </Card>

                <Card className="space-y-4 border border-border bg-card p-4">
                  <h3 className="font-display text-lg text-foreground">
                    Memórias dos capítulos finalizados
                  </h3>
                  <div className="max-h-[560px] space-y-3 overflow-y-auto">
                    {continuityMemories.length ? (
                      continuityMemories.map(memory => (
                        <div
                          key={memory.id}
                          className="rounded-lg border border-border bg-secondary/40 p-4"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-foreground">
                              #{memory.chapterId} — {memory.chapterTitle}
                            </div>
                            <Badge
                              variant="secondary"
                              className={
                                activeWorkIsPaused || !memory.isActive
                                  ? "bg-amber-500/15 px-2 py-1 text-amber-300"
                                  : "bg-emerald-500/15 px-2 py-1 text-emerald-300"
                              }
                            >
                              {activeWorkIsPaused || !memory.isActive
                                ? "pausada"
                                : "ativa"}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                            {memory.summary}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span className="rounded-full bg-background/60 px-2 py-1">
                              {memory.stateChanges.length} mudança(s)
                            </span>
                            <span className="rounded-full bg-background/60 px-2 py-1">
                              {memory.canonicalFacts.length} fato(s)
                            </span>
                            <span className="rounded-full bg-background/60 px-2 py-1">
                              {memory.openLoops.length} ponta(s)
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Nenhuma memória ainda. Ao aprovar um capítulo na
                        revisão, o sistema gera esse contexto automaticamente.
                      </p>
                    )}
                  </div>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="universe" className="space-y-4">
              <Card className="space-y-4 border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg text-foreground">
                      Universo da obra
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                      Esta aba guarda a leitura estrutural da obra completa:
                      lore, período, gênero, POV, capítulos, regras de poder,
                      facções e limites canônicos.
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className="bg-accent/15 px-3 py-1 text-accent"
                  >
                    {buildUniverseContext(universeProfile)
                      .split(/\s+/)
                      .filter(Boolean)
                      .length.toLocaleString("pt-BR")}{" "}
                    palavras
                  </Badge>
                </div>

                <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 text-xs leading-5 text-muted-foreground">
                  Referências importadas geram dossiês por capítulo. Universo,
                  personagens e timeline só são atualizados quando você aciona,
                  usando esses dossiês como fonte.
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {universeFieldGroups.map(field => (
                    <div
                      key={field.key}
                      className={
                        field.rows && field.rows >= 5 ? "md:col-span-2" : ""
                      }
                    >
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        {field.label}
                      </label>
                      <Textarea
                        value={universeProfile[field.key]}
                        onChange={e =>
                          updateUniverseField(field.key, e.target.value)
                        }
                        rows={field.rows ?? 4}
                        className="resize-none bg-secondary"
                        placeholder={field.placeholder}
                      />
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-border bg-secondary/35 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">
                        Analisar Universo a partir de uma referência
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Use quando quiser regenerar esta aba a partir dos
                        dossiês salvos, sem reenviar o arquivo.
                      </p>
                    </div>
                    {analyzeUniverseMutation.isPending ? (
                      <Badge
                        variant="secondary"
                        className="bg-blue-500/15 px-3 py-1 text-blue-300"
                      >
                        usando dossiês...
                      </Badge>
                    ) : null}
                  </div>
                  <div className="max-h-[260px] space-y-2 overflow-y-auto">
                    {dossierReferences.length ? (
                      dossierReferences.map(reference => (
                          <div
                            key={reference.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/45 p-3"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">
                                {reference.title}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(reference.analysisBlocks ?? [])
                                  .length.toLocaleString("pt-BR")}{" "}
                                dossiê(s) por capítulo
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={analyzeUniverseMutation.isPending}
                              onClick={() =>
                                handleAnalyzeUniverseFromReference(reference)
                              }
                            >
                              {analyzeUniverseMutation.isPending ? (
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="mr-2 h-3.5 w-3.5" />
                              )}
                              Analisar
                            </Button>
                          </div>
                        ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                        Crie os dossiês por capítulo em Material importado
                        antes de mapear o universo.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveUniverse}
                    disabled={updateMutation.isPending}
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar universo
                  </Button>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="characters" className="space-y-4">
              {!charactersQuery.isPending && !characters.length ? (
                <Card className="border border-accent/25 bg-accent/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-3xl">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-accent">
                        <Users className="h-4 w-4" />
                        Personagens
                      </div>
                      <h3 className="mt-2 font-display text-xl text-foreground">
                        Nenhum resumo importado ainda
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {characterSyncReference
                          ? "Existe material importado, mas ele ainda não foi transformado em resumos de personagem. Extraia agora para revisar história, papéis, relações e uso em cena."
                          : materialReady
                            ? "Crie os dossiês por capítulo em Material importado antes de preparar os resumos de personagem."
                            : "Importe ou vincule material da obra antes de preparar os resumos de personagem."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleTabChange("chapters")}
                      >
                        <FileUp className="mr-2 h-4 w-4" />
                        Abrir material
                      </Button>
                      {characterSyncReference ? (
                        <Button
                          type="button"
                          onClick={handleCharacterPreparationAction}
                          disabled={syncImportedReferenceMutation.isPending}
                          className="bg-accent text-accent-foreground hover:bg-accent/90"
                        >
                          {syncImportedReferenceMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                          )}
                          Extrair personagens
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              ) : characters.length ? (
                <Card className="border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-accent">
                        <Users className="h-4 w-4" />
                        Revisão de personagens
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {characters.length} resumo(s) no acervo
                        {importedCharacterLinks.length
                          ? `, ${importedCharacterLinks.length} vinculada(s) ao material importado`
                          : ""}
                        . Abra cada resumo para ajustar a história que a Escrita vai usar.
                      </p>
                    </div>
                    {characterSyncReference ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          handleRefreshImportedReferenceSync(
                            characterSyncReference,
                            "Atualizando personagens",
                            "characters"
                          )
                        }
                        disabled={syncImportedReferenceMutation.isPending}
                      >
                        {syncImportedReferenceMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        Atualizar extração
                      </Button>
                    ) : null}
                  </div>
                </Card>
              ) : null}
              <CharacterManager onDirtyChange={handleCharactersDirtyChange} />
            </TabsContent>

            <TabsContent value="timeline" className="space-y-4">
              {dossierReferences.length ? (
                <Card className="border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-display text-lg text-foreground">
                        Atualizar Timeline
                      </div>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                        Recalcula a sequência a partir dos dossiês por
                        capítulo, sem reenviar o arquivo. Use quando a ordem de
                        fatos, datas ou revelações parecer errada.
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-accent/15 px-3 py-1 text-accent"
                    >
                      {dossierReferences.length} material(is)
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {dossierReferences.map(reference => (
                      <div
                        key={reference.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/35 p-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {reference.title}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {(reference.importedTimelineEvents ?? []).length}{" "}
                            evento(s) estruturado(s)
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={syncImportedReferenceMutation.isPending}
                          onClick={() =>
                            handleRefreshImportedReferenceSync(
                              reference,
                              "Atualizando Timeline",
                              "timeline"
                            )
                          }
                        >
                          {syncImportedReferenceMutation.isPending ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="mr-2 h-3.5 w-3.5" />
                          )}
                          Atualizar timeline
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}
              <CharacterTimeline
                profile={profileQuery.data ?? null}
                profileLoading={profileQuery.isPending}
              />
            </TabsContent>

            <TabsContent value="analysis" className="space-y-4">
              <EditorialAnalysisTab noBookTextReason={analysisNoTextReason} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </>
  );
}
