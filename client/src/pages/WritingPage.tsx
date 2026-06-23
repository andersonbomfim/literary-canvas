import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
  Coins,
  FileSearch,
  Loader2,
  Moon,
  RefreshCw,
  Save,
  Sun,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import { VersionHistory } from "@/components/VersionHistory";
import { ExportChapter } from "@/components/ExportChapter";
import { resolveCharacterIds } from "@/lib/characterLinks";
import {
  buildContinuityFoundationFromState,
  buildReferenceContextsFromState,
  parseKeyChapters,
} from "@/lib/keyChapters";
import {
  buildAuthorStyleFromProfile,
  parseStyleProfile,
} from "@/lib/styleProfile";
import {
  buildUniverseContext,
  parseUniverseProfile,
} from "@/lib/universeProfile";
import {
  parseContinuityMemories,
  selectRelevantContinuityMemories,
} from "@shared/continuity";
import { WorkStatusGate } from "@/components/WorkStatusGate";
import { GenerationStatusModal } from "@/components/GenerationStatusModal";
import { EditorialFlowHeader } from "@/components/EditorialFlowHeader";
import { useReadingTheme } from "@/hooks/useReadingTheme";
import { normalizePortugueseProseLayout } from "@/lib/literaryTextLayout";

type CharacterRecord = {
  id: number;
  name: string;
  history: string;
  personality: string | null;
  role: string | null;
  physicalDescription: string | null;
  speechStyle: string | null;
  psychologicalProfile: string | null;
  backstory: string | null;
  motivations: string | null;
  relationships: string | null;
  notes: string | null;
};

function stripAutomaticCharacterContext(raw: string) {
  const marker = "\n\nContexto automático de personagens selecionados:\n";
  if (!raw.includes(marker)) return raw;
  return raw.split(marker)[0];
}

function buildWritingSnapshot(
  title: string,
  content: string,
  sceneContext: string,
  adjustments: string
) {
  return JSON.stringify({ title, content, sceneContext, adjustments });
}

function buildDraftSceneContext(draft: {
  content: string | null;
  summary: string | null;
  canonicalFacts: string | null;
  untouchableDialogue: string | null;
  untouchableScenes: string | null;
  notes: string | null;
  sceneLocation: string | null;
  chapterNumber: string | null;
}) {
  return [
    draft.content?.trim()
      ? `Rascunho bruto integral do autor:\n${draft.content.trim()}`
      : "",
    draft.summary?.trim()
      ? `Resumo opcional do autor:\n${draft.summary.trim()}`
      : "",
    draft.sceneLocation?.trim()
      ? `Local da cena:\n${draft.sceneLocation.trim()}`
      : "",
    draft.chapterNumber?.trim()
      ? `Capítulo indicado:\n${draft.chapterNumber.trim()}`
      : "",
    draft.canonicalFacts?.trim()
      ? `Fatos canônicos:\n${stripAutomaticCharacterContext(draft.canonicalFacts.trim())}`
      : "",
    draft.untouchableDialogue?.trim()
      ? `Falas-chave a preservar:\n${draft.untouchableDialogue.trim()}`
      : "",
    draft.untouchableScenes?.trim()
      ? `Trechos intocáveis:\n${draft.untouchableScenes.trim()}`
      : "",
    draft.notes?.trim() ? `Observações do autor:\n${draft.notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeOptionalDraftTitle(value: string | null) {
  const title = value?.trim() || "";
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized === "rascunho sem título" ? "" : title;
}

export default function WritingPage() {
  const { readingTheme, toggleReadingTheme } = useReadingTheme();
  const [location, navigate] = useLocation();
  // wouter's useLocation returns only the path; query string lives in
  // window.location.search.
  const params = useMemo(
    () =>
      new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : ""
      ),
    [location]
  );
  const chapterIdParam = params.get("chapterId");
  const draftIdParam = params.get("draftId");
  const autoGenerateFromDraft = params.get("autoGenerate") === "1";
  const jobIdParam = params.get("jobId");
  const chapterId = chapterIdParam ? Number(chapterIdParam) : null;
  const draftId = draftIdParam ? Number(draftIdParam) : null;

  const chapterQuery = trpc.writing.getById.useQuery(
    { chapterId: chapterId || 0 },
    { enabled: Boolean(chapterId) }
  );
  const revisionContextQuery = trpc.writing.getRevisionContext.useQuery(
    { chapterId: chapterId || 0 },
    // O status no servidor é a fonte de verdade. Assim, voltar depois para
    // este capítulo ou atualizar a página não perde as correções selecionadas.
    { enabled: Boolean(chapterId) }
  );
  // Histórico de versões — usado para mostrar "Versão N" no header e para
  // saber qual número anexar ao banner verde pós-regenerate.
  const versionsQuery = trpc.versions.list.useQuery(
    { chapterId: chapterId || 0 },
    { enabled: Boolean(chapterId) }
  );
  const draftContextQuery = trpc.writing.getDraftContext.useQuery(
    { draftId: draftId || 0 },
    { enabled: Boolean(draftId) && !chapterId }
  );
  const profileQuery = trpc.profile?.get.useQuery();
  const charactersQuery = trpc.characters?.list.useQuery();
  const libraryQuery = trpc.library.list.useQuery({});
  const allChaptersQuery = trpc.writing.list.useQuery();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sceneContext, setSceneContext] = useState("");
  const [adjustments, setAdjustments] = useState("");
  const [activeWritingTab, setActiveWritingTab] = useState("editor");
  /**
   * Quantas correções vieram da Revisão. > 0 mostra banner destacando que
   * esses ajustes precisam ser revisados e regenerados.
   */
  const [pendingReviewFixCount, setPendingReviewFixCount] = useState(0);
  /**
   * Sinaliza visualmente que o capítulo foi acabado de ser regenerado e
   * salvo como uma nova versão. Antes só aparecia um toast efêmero e o
   * usuário não sabia se o texto na tela era o antigo ou o novo. Agora o
   * banner amarelo "tem correções pendentes" vira verde "Versão N gerada
   * com X correções aplicadas" e fica até o autor dispensar.
   */
  const [lastRegenInfo, setLastRegenInfo] = useState<{
    versionNumber: number;
    fixCount: number;
    at: number;
  } | null>(null);
  const [currentChapterId, setCurrentChapterId] = useState<number | null>(
    chapterId
  );
  const [currentDraftId, setCurrentDraftId] = useState<number | null>(draftId);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(
    buildWritingSnapshot("", "", "", "")
  );
  const [autoGeneratePending, setAutoGeneratePending] = useState(false);
  const [activeGenerationJobId, setActiveGenerationJobId] = useState<
    string | null
  >(jobIdParam);
  const autoGenerateKeyRef = useRef<string | null>(null);
  const loadedReviewBriefRef = useRef<string | null>(null);
  const loadedChapterIdRef = useRef<number | null>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contentUserEditingRef = useRef(false);
  const [costDialog, setCostDialog] = useState<{
    open: boolean;
    action: string;
    cost: number;
    balance: number;
    onConfirm: () => void;
  }>({
    open: false,
    action: "",
    cost: 0,
    balance: 0,
    onConfirm: () => {},
  });

  const linkedDraftQuery = trpc.drafts.getById.useQuery(
    { draftId: currentDraftId || 0 },
    { enabled: Boolean(currentDraftId) }
  );
  const generationJobQuery = trpc.generationJobs.get.useQuery(
    { jobId: activeGenerationJobId || "" },
    {
      enabled: Boolean(activeGenerationJobId),
      refetchInterval: activeGenerationJobId ? 1500 : false,
    }
  );
  const generationResultQuery = trpc.generationJobs.result.useQuery(
    { jobId: activeGenerationJobId || "" },
    {
      enabled: Boolean(
        activeGenerationJobId &&
          generationJobQuery.data?.data.status === "completed"
      ),
      refetchInterval: false,
    }
  );
  const cancelGenerationMutation = trpc.generationJobs.cancel.useMutation({
    onSuccess: result => {
      if (result.data.status === "canceled") {
        toast.info("Geração cancelada.");
        setActiveGenerationJobId(null);
        navigate(
          currentDraftId ? `/writing?draftId=${currentDraftId}` : "/writing"
        );
      }
      generationJobQuery.refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  useEffect(() => {
    setActiveGenerationJobId(jobIdParam);
  }, [jobIdParam]);

  useEffect(() => {
    if (!chapterQuery.data) return;
    const nextTitle = chapterQuery.data?.title || "";
    const nextContent = normalizePortugueseProseLayout(
      chapterQuery.data?.content || ""
    );
    const nextContext =
      chapterQuery.data?.generationPrompt || chapterQuery.data?.content || "";

    const chapterChanged = loadedChapterIdRef.current !== chapterQuery.data.id;
    loadedChapterIdRef.current = chapterQuery.data.id;
    contentUserEditingRef.current = false;
    setCurrentChapterId(chapterQuery.data?.id);
    setCurrentDraftId(chapterQuery.data?.draftId || null);
    setTitle(nextTitle);
    setContent(nextContent);
    setSceneContext(nextContext);
    if (chapterChanged) {
      // A página é reutilizada ao trocar de capítulo. Não deixe instruções de
      // revisão, banners ou estado de uma cena vazarem para a próxima.
      setAdjustments("");
      setPendingReviewFixCount(0);
      setLastRegenInfo(null);
      loadedReviewBriefRef.current = null;
    }
    setLastSavedSnapshot(
      buildWritingSnapshot(nextTitle, nextContent, nextContext, "")
    );
  }, [chapterQuery.data]);

  /**
   * Carrega apenas o brief persistido quando a Revisão devolveu o capítulo.
   * Isso mantém exatamente a seleção do revisor mesmo após refresh, nova aba
   * ou navegação direta pela fila.
   */
  useEffect(() => {
    if (!chapterId || revisionContextQuery.isLoading) return;
    const context = revisionContextQuery.data;
    if (
      context?.status !== "revision_needed" ||
      !context.revisionBrief.trim()
    )
      return;

    const payload = {
      count: context.fixCount,
      text: context.revisionBrief,
    };
    const signature = `${chapterId}:${payload.text}`;
    if (loadedReviewBriefRef.current === signature) return;
    loadedReviewBriefRef.current = signature;

    setAdjustments(prev => {
      const header = `Correções pedidas na Revisão (${payload.count} item${payload.count === 1 ? "" : "s"}):\n\n${payload.text}`;
      if (!prev.trim()) return header;
      if (prev.includes(payload.text)) return prev;
      return `${header}\n\n----------\n\nNotas adicionais do autor:\n${prev}`;
    });
    setPendingReviewFixCount(payload.count);
    setActiveWritingTab("adjustments");
    toast.success(
      `${payload.count} correção(ões) carregada(s) da Revisão. Revise e clique em "Corrigir capítulo e efeitos".`
    );
  }, [
    chapterId,
    revisionContextQuery.data,
    revisionContextQuery.isLoading,
  ]);

  useEffect(() => {
    const chapter = generationResultQuery.data?.data.chapter;
    if (!chapter) return;

    setCurrentChapterId(chapter.id);
    setCurrentDraftId(chapter.draftId || null);
    setTitle(chapter.title || "");
    const nextContent = normalizePortugueseProseLayout(chapter.content || "");
    contentUserEditingRef.current = false;
    setContent(nextContent);
    setSceneContext(chapter.generationPrompt || "");
    setLastSavedSnapshot(
      buildWritingSnapshot(
        chapter.title || "",
        nextContent,
        chapter.generationPrompt || "",
        ""
      )
    );
    setActiveGenerationJobId(null);
    setAutoGeneratePending(false);
    toast.success("Capítulo gerado.");
    navigate(`/writing?chapterId=${chapter.id}`);
    chapterQuery.refetch();
    allChaptersQuery.refetch();
  }, [allChaptersQuery, chapterQuery, generationResultQuery.data, navigate]);

  useEffect(() => {
    if (!content.trim()) return;
    if (
      typeof document !== "undefined" &&
      document.activeElement === contentTextareaRef.current &&
      contentUserEditingRef.current
    ) {
      return;
    }

    const normalizedContent = normalizePortugueseProseLayout(content);
    if (normalizedContent === content) return;

    setContent(prev => (prev === content ? normalizedContent : prev));
  }, [content]);

  useEffect(() => {
    const status = generationJobQuery.data?.data.status;
    if (!status) return;
    if (status === "failed") {
      toast.error(
        generationJobQuery.data?.data.progressMessage || "A geração falhou."
      );
    }
    if (status === "canceled") {
      toast.info("Geração cancelada.");
    }
  }, [generationJobQuery.data?.data.status]);

  useEffect(() => {
    if (draftContextQuery.data?.chapter) {
      navigate(`/writing?chapterId=${draftContextQuery.data?.chapter.id}`);
      return;
    }
    if (draftContextQuery.data?.draft) {
      const draft = draftContextQuery.data?.draft;
      const nextTitle = normalizeOptionalDraftTitle(draft.title);
      const nextContext = buildDraftSceneContext(draft);
      const nextContent = "";

      contentUserEditingRef.current = false;
      setCurrentDraftId(draft.id);
      setTitle(nextTitle);
      setSceneContext(nextContext);
      setContent(nextContent);
      setLastSavedSnapshot(
        buildWritingSnapshot(nextTitle, nextContent, nextContext, "")
      );
      if (autoGenerateFromDraft) {
        const autoKey = `draft:${draft.id}:${draft.updatedAt ?? ""}`;
        if (autoGenerateKeyRef.current !== autoKey) {
          autoGenerateKeyRef.current = autoKey;
          setAutoGeneratePending(true);
        }
      }
    }
  }, [autoGenerateFromDraft, draftContextQuery.data, navigate]);

  const saveMutation = trpc.writing.save.useMutation({
    onSuccess: result => {
      toast.success("Capítulo salvo.");
      setCurrentChapterId(result.data.id);
      setTitle(result.data.title);
      navigate(`/writing?chapterId=${result.data.id}`);
      setLastSavedSnapshot(
        buildWritingSnapshot(
          result.data.title,
          content,
          sceneContext,
          adjustments
        )
      );
      chapterQuery.refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const generateMutation = trpc.writing.generateChapter.useMutation({
    onSuccess: result => {
      toast.success(
        result.data.reused
          ? "Geração já estava na fila."
          : "Capítulo entrou na fila de geração."
      );
      setActiveGenerationJobId(result.data.jobId);
      navigate(`/writing?draftId=${currentDraftId}&jobId=${result.data.jobId}`);
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const regenerateMutation = trpc.writing.regenerate.useMutation({
    onSuccess: result => {
      toast.success("Capítulo regenerado.");
      const nextContent = normalizePortugueseProseLayout(result.data.content);
      contentUserEditingRef.current = false;
      setContent(nextContent);
      setActiveWritingTab("editor");
      setLastSavedSnapshot(
        buildWritingSnapshot(title, nextContent, sceneContext, adjustments)
      );
      // Substitui o banner âmbar de "correções pendentes" pelo banner verde
      // de "versão N gerada". Captura o count ATUAL antes de zerar, para
      // mostrar "X correções aplicadas". A query de versões precisa ser
      // refazida para o versionNumber novo aparecer.
      const fixCount = pendingReviewFixCount;
      setPendingReviewFixCount(0);
      void versionsQuery.refetch().then(res => {
        const latest = (res.data?.data ?? []).reduce<number>(
          (max, v) => Math.max(max, v.versionNumber),
          0
        );
        // versionNumber salvo é o do BACKUP (antes do regen); o número
        // "lógico" do capítulo atual é latest + 1.
        setLastRegenInfo({
          versionNumber: latest + 1,
          fixCount,
          at: Date.now(),
        });
      });
      chapterQuery.refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const submitForReviewMutation = trpc.writing.submitForReview.useMutation({
    onSuccess: (_, variables) => {
      toast.success("Capítulo enviado para Revisão.");
      navigate(`/review?chapterId=${variables.chapterId}`);
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const loading =
    chapterQuery.isLoading ||
    draftContextQuery.isLoading ||
    linkedDraftQuery.isLoading;
  const activeGenerationJob = generationJobQuery.data?.data;
  const activeGenerationStatus = activeGenerationJob?.status;
  const generationInProgress = Boolean(
    activeGenerationJobId &&
      activeGenerationStatus &&
      !["completed", "failed", "canceled"].includes(activeGenerationStatus)
  );
  const busy =
    saveMutation.isPending ||
    generateMutation.isPending ||
    regenerateMutation.isPending ||
    submitForReviewMutation.isPending ||
    cancelGenerationMutation.isPending ||
    generationInProgress;
  const currentSnapshot = useMemo(
    () => buildWritingSnapshot(title, content, sceneContext, adjustments),
    [title, content, sceneContext, adjustments]
  );
  const isDirty = currentSnapshot !== lastSavedSnapshot;

  const [saveStatus, setSaveStatus] = useState<
    "saved" | "saving" | "unsaved" | "error"
  >("saved");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AUTO_SAVE_DELAY_MS = 30_000; // 30 seconds

  const performAutoSave = useCallback(async () => {
    if (!currentChapterId || !content.trim() || busy) return;
    setSaveStatus("saving");
    try {
      await saveMutation.mutateAsync({
        chapterId: currentChapterId,
        draftId: currentDraftId || undefined,
        title: title.trim() || "Capítulo sem título",
        content,
        changeDescription: "Auto-save",
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [currentChapterId, currentDraftId, title, content, busy]);

  // Auto-save: trigger after AUTO_SAVE_DELAY_MS of no edits when dirty
  useEffect(() => {
    if (!isDirty || !currentChapterId) {
      if (!isDirty) setSaveStatus("saved");
      return;
    }
    setSaveStatus("unsaved");
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      performAutoSave();
    }, AUTO_SAVE_DELAY_MS);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [isDirty, currentChapterId, performAutoSave]);

  const handleContentChange = (value: string) => {
    contentUserEditingRef.current = true;
    setContent(value);
  };

  const handleContentBlur = () => {
    contentUserEditingRef.current = false;
    const normalizedContent = normalizePortugueseProseLayout(content);
    if (normalizedContent !== content) {
      setContent(normalizedContent);
    }
  };

  const universeProfile = useMemo(
    () => parseUniverseProfile(profileQuery.data?.negativeRules),
    [profileQuery.data]
  );
  const universeContext = useMemo(
    () => buildUniverseContext(universeProfile),
    [universeProfile]
  );
  const negativeRules = useMemo(
    () => (universeContext ? [universeContext] : []),
    [universeContext]
  );

  const styleProfile = useMemo(
    () => parseStyleProfile(profileQuery.data?.narrativeStyle),
    [profileQuery.data]
  );
  const effectiveAuthorStyle = useMemo(
    () => buildAuthorStyleFromProfile(styleProfile),
    [styleProfile]
  );
  const keyChaptersState = useMemo(
    () => parseKeyChapters(profileQuery.data?.keyChapters),
    [profileQuery.data]
  );
  const storyFoundation = profileQuery.data?.storyFoundation || "";
  const effectiveStoryFoundation = useMemo(
    () => buildContinuityFoundationFromState(keyChaptersState, storyFoundation),
    [keyChaptersState, storyFoundation]
  );
  const continuityMemories = useMemo(
    () => parseContinuityMemories(profileQuery.data?.continuityMemories),
    [profileQuery.data]
  );

  const selectedCharacterIds = useMemo(() => {
    return resolveCharacterIds(
      linkedDraftQuery.data?.mainCharacters,
      charactersQuery.data?.data || []
    );
  }, [charactersQuery.data, linkedDraftQuery.data]);

  const selectedCharacters = useMemo(() => {
    const allCharacters = charactersQuery.data?.data || [];
    if (!selectedCharacterIds.length) return [];
    return selectedCharacterIds
      .map((id: number) =>
        allCharacters.find((char: CharacterRecord) => char.id === id)
      )
      .filter(Boolean) as CharacterRecord[];
  }, [charactersQuery.data, selectedCharacterIds]);

  const draftSourceContext = useMemo(() => {
    return linkedDraftQuery.data
      ? buildDraftSceneContext(linkedDraftQuery.data)
      : "";
  }, [linkedDraftQuery.data]);

  const generationSourceContext = draftSourceContext || sceneContext;

  const characterContexts = useMemo(() => {
    return selectedCharacters.map(char => {
      const sections = [
        char.role ? `Papel: ${char.role}` : "",
        `História: ${char.history}`,
        char.personality ? `Personalidade: ${char.personality}` : "",
        char.physicalDescription
          ? `Descrição física: ${char.physicalDescription}`
          : "",
        char.speechStyle ? `Jeito de falar: ${char.speechStyle}` : "",
        char.psychologicalProfile
          ? `Psicológico: ${char.psychologicalProfile}`
          : "",
        char.backstory ? `Passado: ${char.backstory}` : "",
        char.motivations ? `Motivações: ${char.motivations}` : "",
        char.relationships ? `Relações: ${char.relationships}` : "",
        char.notes ? `Notas: ${char.notes}` : "",
      ].filter(Boolean);

      return {
        name: char.name,
        history: sections.join("\n"),
        role: char.role || undefined,
      };
    });
  }, [selectedCharacters]);

  const referenceContexts = useMemo(
    () =>
      buildReferenceContextsFromState(
        keyChaptersState,
        allChaptersQuery.data?.data as any
      ),
    [allChaptersQuery.data, keyChaptersState]
  );
  const selectedContinuityMemories = useMemo(
    () =>
      selectRelevantContinuityMemories(continuityMemories, {
        characterNames: selectedCharacters.map(item => item.name),
        excludeChapterId: currentChapterId,
        limit: 8,
      }),
    [continuityMemories, selectedCharacters, currentChapterId]
  );

  const libraryContext = useMemo(() => {
    const entries = (libraryQuery.data?.data || []).filter(
      (entry: any) => entry.type !== "character"
    );
    if (!entries.length) return "";

    // Extract keywords from current context for relevance scoring
    const contextText = `${title} ${generationSourceContext}`.toLowerCase();
    const keywords = contextText.split(/\s+/).filter(w => w.length >= 3);

    if (!keywords.length) {
      // No context yet — fall back to first 12
      return entries
        .slice(0, 12)
        .map(
          (entry: any) =>
            `${entry.type}: ${entry.name}${entry.description ? ` — ${entry.description}` : ""}`
        )
        .join("\n");
    }

    // Score entries by keyword relevance
    const scored = entries.map((entry: any) => {
      const text =
        `${entry.name || ""} ${entry.description || ""}`.toLowerCase();
      const score = keywords.reduce(
        (acc: number, kw: string) => acc + (text.includes(kw) ? 1 : 0),
        0
      );
      return { entry, score };
    });

    // Sort by relevance, take top 12
    scored.sort((a: any, b: any) => b.score - a.score);

    return scored
      .slice(0, 12)
      .map(
        ({ entry }: any) =>
          `${entry.type}: ${entry.name}${entry.description ? ` — ${entry.description}` : ""}`
      )
      .join("\n");
  }, [libraryQuery.data, title, generationSourceContext]);

  const wordCount = useMemo(
    () => content.trim().split(/\s+/).filter(Boolean).length,
    [content]
  );
  const paragraphCount = useMemo(
    () => content.split(/\n+/).filter(Boolean).length,
    [content]
  );
  const sceneContextWords = useMemo(
    () => generationSourceContext.trim().split(/\s+/).filter(Boolean).length,
    [generationSourceContext]
  );

  const handleSave = async () => {
    if (!content.trim()) {
      toast.error("Escreva ou gere o capítulo antes de salvar.");
      return;
    }

    await saveMutation.mutateAsync({
      chapterId: currentChapterId || undefined,
      draftId: currentDraftId || undefined,
      title: title.trim() || "Capítulo sem título",
      content,
      changeDescription: "Salvamento manual",
    });
  };

  const executeGenerate = useCallback(async () => {
    if (!currentDraftId) {
      toast.error(
        "Abra um rascunho pela aba Rascunho antes de gerar na Escrita."
      );
      return;
    }
    await generateMutation.mutateAsync({
      draftId: currentDraftId || undefined,
      idempotencyKey: `writing:draft:${currentDraftId}:${linkedDraftQuery.data?.updatedAt ?? ""}:${Date.now()}`,
      title: title.trim(),
      sceneContext: generationSourceContext,
      authorStyle: effectiveAuthorStyle || undefined,
      libraryContext,
      universeContext: universeContext || undefined,
      characterContexts,
      referenceContexts,
      storyFoundation: effectiveStoryFoundation || undefined,
      continuityMemories: selectedContinuityMemories,
    });
  }, [
    generateMutation,
    currentDraftId,
    linkedDraftQuery.data?.updatedAt,
    title,
    generationSourceContext,
    effectiveAuthorStyle,
    libraryContext,
    universeContext,
    characterContexts,
    referenceContexts,
    effectiveStoryFoundation,
    selectedContinuityMemories,
  ]);

  useEffect(() => {
    if (
      !autoGeneratePending ||
      busy ||
      currentChapterId ||
      !currentDraftId ||
      !generationSourceContext.trim()
    )
      return;
    if (
      profileQuery.isLoading ||
      charactersQuery.isLoading ||
      libraryQuery.isLoading ||
      allChaptersQuery.isLoading
    )
      return;

    setAutoGeneratePending(false);
    toast.info("Gerando capítulo a partir do rascunho e do estilo da obra...");
    void executeGenerate();
  }, [
    allChaptersQuery.isLoading,
    autoGeneratePending,
    busy,
    charactersQuery.isLoading,
    currentChapterId,
    executeGenerate,
    libraryQuery.isLoading,
    profileQuery.isLoading,
    currentDraftId,
    generationSourceContext,
  ]);

  const handleGenerate = async () => {
    if (!currentDraftId) {
      toast.error("Crie ou abra um rascunho na aba Rascunho antes de gerar.");
      return;
    }
    if (!generationSourceContext.trim()) {
      toast.error("O rascunho vinculado está vazio.");
      return;
    }

    await executeGenerate();
  };

  const regenerateCostQuery = trpc.writing.costEstimate.useQuery(
    { action: "regenerate" },
    { enabled: false }
  );

  const executeRegenerate = useCallback(async () => {
    if (!currentChapterId) return;
    await regenerateMutation.mutateAsync({
      chapterId: currentChapterId,
      adjustments,
      authorStyle: effectiveAuthorStyle || undefined,
      libraryContext,
      universeContext: universeContext || undefined,
      characterContexts,
      referenceContexts,
      storyFoundation: effectiveStoryFoundation || undefined,
      continuityMemories: selectedContinuityMemories,
    });
  }, [
    regenerateMutation,
    currentChapterId,
    adjustments,
    effectiveAuthorStyle,
    libraryContext,
    universeContext,
    characterContexts,
    referenceContexts,
    effectiveStoryFoundation,
    selectedContinuityMemories,
  ]);

  const handleRegenerate = async () => {
    if (!currentChapterId) {
      toast.error("Gere ou salve um capítulo antes de regenerar.");
      return;
    }
    if (!adjustments.trim()) {
      toast.error("Descreva o ajuste que você quer.");
      return;
    }

    try {
      const estimate = await regenerateCostQuery.refetch();
      if (estimate.data && !estimate.data.canAfford) {
        toast.error(
          `Créditos flexíveis insuficientes. Custo: ${estimate.data.cost}, saldo: ${estimate.data.balance}.`
        );
        return;
      }
      if (estimate.data) {
        setCostDialog({
          open: true,
          action: "Corrigir capítulo e efeitos",
          cost: estimate.data.cost,
          balance: estimate.data.balance,
          onConfirm: executeRegenerate,
        });
        return;
      }
    } catch {
      // proceed anyway
    }

    await executeRegenerate();
  };

  const handleSubmitForReview = async () => {
    if (!currentChapterId) {
      toast.error("Salve ou gere um capítulo antes.");
      return;
    }
    if (!content.trim()) {
      toast.error("O capítulo está vazio.");
      return;
    }

    if (isDirty) {
      await saveMutation.mutateAsync({
        chapterId: currentChapterId,
        draftId: currentDraftId || undefined,
        title: title.trim() || "Capítulo sem título",
        content,
        changeDescription: "Salvamento antes da revisão",
      });
    }

    await submitForReviewMutation.mutateAsync({ chapterId: currentChapterId });
  };

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <WorkStatusGate softBlock>
      <div className="book-page-shell space-y-4">
        <EditorialFlowHeader
          active="writing"
          title="Escrita do capítulo"
          subtitle="Transforme o rascunho em texto final, aplique correções de revisão e devolva o capítulo para validação quando estiver pronto."
          statusItems={[
            {
              label: currentChapterId
                ? "capítulo"
                : currentDraftId
                  ? "rascunho"
                  : "vínculo",
              value: currentChapterId
                ? `#${currentChapterId}`
                : currentDraftId
                  ? `#${currentDraftId}`
                  : "nenhum",
              tone: currentChapterId
                ? "success"
                : currentDraftId
                  ? "accent"
                  : "neutral",
            },
            {
              label: "status",
              value: (
                <>
                  {saveStatus === "saving" ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : null}
                  {saveStatus === "saved"
                    ? "Tudo salvo"
                    : saveStatus === "saving"
                      ? "Salvando..."
                      : saveStatus === "error"
                        ? "Erro ao salvar"
                        : "Alterações não salvas"}
                </>
              ),
              tone:
                saveStatus === "saved"
                  ? "success"
                  : saveStatus === "error"
                    ? "danger"
                    : saveStatus === "saving"
                      ? "accent"
                      : "warning",
            },
            {
              label: "texto",
              value: `${wordCount.toLocaleString("pt-BR")} palavras`,
              tone: "accent",
            },
            ...(currentChapterId && versionsQuery.data?.data?.length
              ? [
                  {
                    label: "versão",
                    value: `v${versionsQuery.data.data.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1}`,
                    tone: "neutral" as const,
                  },
                ]
              : []),
            ...(pendingReviewFixCount > 0
              ? [
                  {
                    label: "revisão",
                    value: `${pendingReviewFixCount} correção(ões)`,
                    tone: "warning" as const,
                  },
                ]
              : []),
          ]}
        />

        <div className="writing-workspace">
          <div className="space-y-4">
            <Card className="book-editor-card space-y-3 border border-border bg-card p-4">
              {!currentDraftId && !currentChapterId ? (
                <div className="flex min-h-[540px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-secondary/30 p-8 text-center">
                  <div className="text-xs uppercase tracking-[0.24em] text-accent">
                    Etapa anterior necessária
                  </div>
                  <h2 className="mt-3 font-display text-2xl text-foreground">
                    A Escrita começa no Rascunho
                  </h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                    Escreva o texto bruto na aba Rascunho e envie para cá. Esta
                    tela transforma aquele material em capítulo, sem criar um
                    segundo rascunho paralelo.
                  </p>
                  <Button
                    type="button"
                    className="mt-6 bg-accent text-accent-foreground hover:bg-accent/90"
                    onClick={() => navigate("/draft")}
                  >
                    Abrir Rascunho
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Título do capítulo opcional
                      </label>
                      <Input
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        className="bg-secondary"
                        placeholder="A IA cria um título provisório se ficar vazio"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-muted-foreground">
                      <div className="rounded-lg bg-secondary/60 px-3 py-2 text-center">
                        <div className="text-xs uppercase tracking-wide">
                          Fonte
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {sceneContextWords}
                        </div>
                      </div>
                      <div className="rounded-lg bg-secondary/60 px-3 py-2 text-center">
                        <div className="text-xs uppercase tracking-wide">
                          Parágrafos
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {paragraphCount}
                        </div>
                      </div>
                      <div className="rounded-lg bg-secondary/60 px-3 py-2 text-center">
                        <div className="text-xs uppercase tracking-wide">
                          Personagens
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {selectedCharacters.length}
                        </div>
                      </div>
                    </div>
                  </div>

                  {pendingReviewFixCount > 0 && (
                    // Banner de correções vindas da Revisão e ainda não aplicadas.
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <strong className="text-amber-200">
                            {pendingReviewFixCount} correção(ões) vieram da
                            Revisão.
                          </strong>
                          <p className="mt-1 text-amber-100/85">
                            Os itens marcados na aba Revisão estão
                            pré-preenchidos em "Correções". Edite se quiser e
                            clique em "Regenerar capítulo" para aplicar.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded border border-amber-500/40 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/15"
                          onClick={() => setPendingReviewFixCount(0)}
                        >
                          Dispensar
                        </button>
                      </div>
                    </div>
                  )}

                  {lastRegenInfo && pendingReviewFixCount === 0 && (
                    // Banner de confirmação após regenerar o capítulo.
                    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <strong className="text-emerald-200">
                            Versão {lastRegenInfo.versionNumber} gerada
                            {lastRegenInfo.fixCount > 0
                              ? ` com ${lastRegenInfo.fixCount} correção${lastRegenInfo.fixCount === 1 ? "" : "ões"} aplicada${lastRegenInfo.fixCount === 1 ? "" : "s"}`
                              : ""}
                            .
                          </strong>
                          <p className="mt-1 text-emerald-100/85">
                            O texto no editor é o capítulo atualizado. A versão
                            anterior está salva no histórico — clique no badge
                            "v{lastRegenInfo.versionNumber}" no topo para abrir.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/15"
                          onClick={() => setLastRegenInfo(null)}
                        >
                          Dispensar
                        </button>
                      </div>
                    </div>
                  )}

                  <Tabs
                    value={activeWritingTab}
                    onValueChange={setActiveWritingTab}
                    className="space-y-4"
                  >
                    <TabsList className="bg-secondary">
                      <TabsTrigger value="editor">Editor</TabsTrigger>
                      <TabsTrigger value="adjustments">
                        Correções
                        {pendingReviewFixCount > 0
                          ? ` (${pendingReviewFixCount})`
                          : ""}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="editor" className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-display text-lg text-foreground">
                          Capítulo em escrita
                        </h3>
                        <button
                          type="button"
                          className="book-reading-toggle"
                          data-reading-theme={readingTheme}
                          onClick={toggleReadingTheme}
                          title={
                            readingTheme === "light"
                              ? "Ler no modo escuro"
                              : "Ler no modo claro"
                          }
                          aria-label={
                            readingTheme === "light"
                              ? "Ler no modo escuro"
                              : "Ler no modo claro"
                          }
                        >
                          <Sun className="h-3.5 w-3.5" />
                          <span>/</span>
                          <Moon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div
                        className="book-editor-shell"
                        data-reading-theme={readingTheme}
                      >
                        <Textarea
                          ref={contentTextareaRef}
                          value={content}
                          onChange={e => handleContentChange(e.target.value)}
                          onBlur={handleContentBlur}
                          className="book-editor-textarea"
                          lang="pt-BR"
                          spellCheck
                          placeholder={
                            currentChapterId
                              ? "Edite o capítulo aqui..."
                              : "O capítulo gerado a partir do rascunho aparece aqui..."
                          }
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="adjustments" className="space-y-3">
                      <Textarea
                        value={adjustments}
                        onChange={e => setAdjustments(e.target.value)}
                        className="min-h-[260px] resize-none bg-secondary"
                        placeholder="Diga exatamente o que corrigir. Ex: mudar o tom deste diálogo, tornar a cena mais tensa, corrigir a reação de Pavel. A IA reescreve o trecho e também tudo o que for afetado por ele."
                      />
                      <Button
                        onClick={handleRegenerate}
                        disabled={busy || !currentChapterId}
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                      >
                        {regenerateMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        Corrigir capítulo e efeitos
                      </Button>
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </Card>
          </div>

          <div className="writing-sidebar space-y-4">
            <Card className="space-y-3 border border-border bg-card p-4">
              <div className="font-display text-lg text-foreground">Ações</div>
              {!currentDraftId && !currentChapterId ? (
                <Button
                  type="button"
                  onClick={() => navigate("/draft")}
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <WandSparkles className="mr-2 h-4 w-4" />
                  Ir para Rascunho
                </Button>
              ) : !currentChapterId ? (
                <Button
                  onClick={handleGenerate}
                  disabled={busy || !currentDraftId}
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  {generateMutation.isPending || generationInProgress ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <WandSparkles className="mr-2 h-4 w-4" />
                  )}
                  Gerar capítulo do rascunho
                </Button>
              ) : null}
              <Button
                onClick={handleSave}
                disabled={busy}
                variant="outline"
                className="w-full"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Salvar capítulo
              </Button>
              <Button
                onClick={handleSubmitForReview}
                disabled={busy || !currentChapterId}
                variant="outline"
                className="w-full"
              >
                {submitForReviewMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileSearch className="mr-2 h-4 w-4" />
                )}
                Enviar para Revisão
              </Button>
            </Card>

            {currentDraftId ? (
              <Card className="space-y-3 border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-display text-lg text-foreground">
                      Fonte do Rascunho
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Leitura apenas. Para mudar a matéria-prima, volte ao
                      Rascunho.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/draft?draftId=${currentDraftId}`)}
                  >
                    Editar no Rascunho
                  </Button>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-secondary/50 p-3 text-sm leading-6 text-muted-foreground">
                  <pre className="whitespace-pre-wrap font-sans">
                    {generationSourceContext ||
                      "Rascunho vinculado sem conteúdo."}
                  </pre>
                </div>
              </Card>
            ) : null}

            <Card className="space-y-3 border border-border bg-card p-4">
              <div className="font-display text-lg text-foreground">
                Personagens desta cena
              </div>
              {selectedCharacters.length ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {selectedCharacters.map(char => (
                      <Badge
                        key={char.id}
                        variant="secondary"
                        className="bg-purple-500/10 px-3 py-1 text-purple-300"
                      >
                        {char.name}
                      </Badge>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {selectedCharacters.map(char => (
                      <div
                        key={char.id}
                        className="rounded-lg border border-border bg-secondary/50 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-foreground">
                            {char.name}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {char.role || "Sem papel definido"}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                          {char.personality || char.history}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum personagem vinculado a este rascunho. Volte no rascunho
                  e use / para puxar os personagens certos.
                </p>
              )}
            </Card>

            <Card className="border border-border bg-card p-4">
              <div className="font-display text-lg text-foreground mb-3">
                Contexto carregado
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="rounded-lg bg-secondary/50 px-3 py-2">
                  <span className="text-foreground">
                    {libraryQuery.data?.data.length || 0}
                  </span>{" "}
                  biblioteca
                </div>
                <div className="rounded-lg bg-secondary/50 px-3 py-2">
                  <span className="text-foreground">
                    {universeContext ? 1 : 0}
                  </span>{" "}
                  universo
                </div>
                <div className="rounded-lg bg-secondary/50 px-3 py-2">
                  <span className="text-foreground">
                    {
                      styleProfile.samples.filter(sample => sample.isActive)
                        .length
                    }
                  </span>{" "}
                  amostra(s) de estilo
                </div>
                <div className="rounded-lg bg-secondary/50 px-3 py-2">
                  <span className="text-foreground">
                    {referenceContexts.length}
                  </span>{" "}
                  referência(s)
                </div>
                <div className="rounded-lg bg-secondary/50 px-3 py-2">
                  <span className="text-foreground">
                    {selectedContinuityMemories.length}
                  </span>{" "}
                  memória(s)
                </div>
                <div className="sm:col-span-2 rounded-lg bg-secondary/50 px-3 py-2">
                  {currentDraftId
                    ? `Vinculado ao rascunho #${currentDraftId}`
                    : currentChapterId
                      ? "Capítulo legado sem rascunho vinculado"
                      : "Aguardando rascunho"}
                  {effectiveStoryFoundation.trim()
                    ? " · Base anterior carregada"
                    : ""}
                  {effectiveAuthorStyle.trim() ? " · Estilo carregado" : ""}
                </div>
              </div>
            </Card>

            {referenceContexts.length ? (
              <Card className="border border-border bg-card p-4">
                <div className="font-display text-lg text-foreground">
                  Referências ativas
                </div>
                <div className="mt-3 space-y-3">
                  {referenceContexts.map((item, idx) => (
                    <div
                      key={`${item.title}-${idx}`}
                      className="rounded-lg border border-border bg-secondary/50 p-3"
                    >
                      <div className="font-medium text-foreground">
                        {item.title}
                      </div>
                      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">
                        {item.notes || item.content}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {effectiveStoryFoundation.trim() ? (
              <Card className="border border-border bg-card p-4">
                <div className="font-display text-lg text-foreground">
                  Base da obra anterior
                </div>
                <p className="mt-3 line-clamp-6 whitespace-pre-wrap text-sm text-muted-foreground">
                  {effectiveStoryFoundation}
                </p>
              </Card>
            ) : null}

            {selectedContinuityMemories.length ? (
              <Card className="border border-border bg-card p-4">
                <div className="font-display text-lg text-foreground">
                  Memórias carregadas
                </div>
                <div className="mt-3 space-y-3">
                  {selectedContinuityMemories.map(memory => (
                    <div
                      key={memory.id}
                      className="rounded-lg border border-border bg-secondary/50 p-3"
                    >
                      <div className="font-medium text-foreground">
                        #{memory.chapterId} — {memory.chapterTitle}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                        {memory.summary}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {currentChapterId ? (
              <>
                <ExportChapter
                  chapterId={currentChapterId}
                  chapterTitle={title || "Capítulo"}
                />
                <Card className="border border-border bg-card p-4">
                  <VersionHistory chapterId={currentChapterId} />
                </Card>
              </>
            ) : (
              <Card className="border border-border bg-card p-5 text-sm text-muted-foreground">
                Salve ou gere um capítulo para liberar exportação e histórico de
                versões.
              </Card>
            )}
          </div>
        </div>

        <AlertDialog
          open={costDialog.open}
          onOpenChange={open => setCostDialog(prev => ({ ...prev, open }))}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{costDialog.action}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-foreground/8 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <span className="text-sm text-muted-foreground">
                      Custo em créditos flexíveis
                    </span>
                    <span className="font-medium text-foreground flex items-center gap-1">
                      <Coins className="h-4 w-4 text-accent" />
                      {costDialog.cost} créditos
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-foreground/8 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <span className="text-sm text-muted-foreground">
                      Saldo flexível atual
                    </span>
                    <span className="font-medium text-foreground">
                      {costDialog.balance} créditos
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-foreground/8 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <span className="text-sm text-muted-foreground">
                      Saldo flexível após
                    </span>
                    <span className="font-medium text-foreground">
                      {costDialog.balance - costDialog.cost} créditos
                    </span>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setCostDialog(prev => ({ ...prev, open: false }));
                  costDialog.onConfirm();
                }}
              >
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <GenerationStatusModal
          open={Boolean(activeGenerationJobId)}
          status={activeGenerationJob?.status}
          engine={activeGenerationJob?.engine}
          message={activeGenerationJob?.progressMessage}
          reservedCredits={activeGenerationJob?.reservedCredits}
          generatedWordCount={activeGenerationJob?.generatedWordCount}
          canCancel={
            activeGenerationJob?.status === "queued" ||
            activeGenerationJob?.status === "preparing"
          }
          onCancel={() =>
            activeGenerationJobId &&
            cancelGenerationMutation.mutate({ jobId: activeGenerationJobId })
          }
          onClose={() => {
            setActiveGenerationJobId(null);
            navigate(
              currentDraftId ? `/writing?draftId=${currentDraftId}` : "/writing"
            );
          }}
        />
      </div>
    </WorkStatusGate>
  );
}
