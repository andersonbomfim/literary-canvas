import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { CSSProperties } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  ClipboardCheck,
  Copy,
  Lightbulb,
  Loader2,
  MapPin,
  Moon,
  Save,
  Sun,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildCharacterLinkPayload,
  resolveCharacterIds,
} from "@/lib/characterLinks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  buildReferenceContextsFromState,
  parseKeyChapters,
} from "@/lib/keyChapters";
import { WorkStatusGate } from "@/components/WorkStatusGate";
import { EditorialFlowHeader } from "@/components/EditorialFlowHeader";
import { useReadingTheme } from "@/hooks/useReadingTheme";
import { normalizePortugueseProseLayout } from "@/lib/literaryTextLayout";
import { formatApiErrorMessage } from "@/lib/errorMessage";

const emptyForm = {
  title: "",
  book: "",
  chapter: "",
  summary: "",
  draft: "",
  keyDialogues: "",
  untouchable: "",
  observations: "",
  facts: "",
  sceneLocation: "",
};

const MIN_DRAFT_WORDS_TO_GENERATE = 1000;
const MIN_DRAFT_WORDS_TO_REVIEW = 50;
const MIN_DRAFT_GENERATION_MESSAGE =
  "Para gerar um capítulo com IA, escreva pelo menos 1.000 palavras no rascunho. Isso ajuda a IA a entender melhor sua intenção, o ritmo da cena e o caminho narrativo.";
const fixedTextareaSizing = { fieldSizing: "fixed" } as CSSProperties;

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

type ReviewResult = {
  reviewedText: string;
  changesSummary?: string[];
};

function unwrapReviewedText(raw: string) {
  const value = raw.trim();
  if (!value.startsWith("{") || !value.includes("reviewedText")) return raw;

  try {
    const parsed = JSON.parse(value) as { reviewedText?: unknown };
    if (typeof parsed.reviewedText === "string" && parsed.reviewedText.trim()) {
      return parsed.reviewedText.trim();
    }
  } catch {
    // A IA às vezes devolve JSON inválido com quebras de linha literais.
  }

  const match = value.match(/"reviewedText"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"changesSummary"|}\s*$)/);
  if (!match?.[1]) return raw;
  return match[1]
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
}

function normalizeReviewResult(result: ReviewResult): ReviewResult {
  return {
    ...result,
    reviewedText: normalizePortugueseProseLayout(
      unwrapReviewedText(result.reviewedText)
    ),
  };
}

type InspirationSuggestion = {
  title: string;
  description: string;
  whyItFits: string;
  affectedCharacters: string[];
  narrativeRisk?: string;
  continuationHint: string;
  evidence?: string[];
};

function buildCharacterContext(character: CharacterRecord) {
  const parts = [
    `Nome: ${character.name}`,
    character.role ? `Papel: ${character.role}` : "",
    character.history ? `História: ${character.history}` : "",
    character.personality ? `Personalidade: ${character.personality}` : "",
    character.physicalDescription
      ? `Descrição física: ${character.physicalDescription}`
      : "",
    character.speechStyle ? `Jeito de falar: ${character.speechStyle}` : "",
    character.psychologicalProfile
      ? `Psicológico: ${character.psychologicalProfile}`
      : "",
    character.backstory ? `Passado: ${character.backstory}` : "",
    character.motivations ? `Motivações: ${character.motivations}` : "",
    character.relationships ? `Relações: ${character.relationships}` : "",
    character.notes ? `Notas: ${character.notes}` : "",
  ].filter(Boolean);

  return parts.join("\n");
}

function stripAutomaticCharacterContext(raw: string) {
  const marker = "\n\nContexto automático de personagens selecionados:\n";
  if (!raw.includes(marker)) return raw;
  return raw.split(marker)[0];
}

function normalizeCharacterSearch(value: string) {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

function sameDraftForm(a: typeof emptyForm, b: typeof emptyForm) {
  return (Object.keys(emptyForm) as Array<keyof typeof emptyForm>).every(
    key => a[key] === b[key]
  );
}

function sameNumberArray(a: number[], b: number[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function buildSnapshot(
  formData: typeof emptyForm,
  selectedCharacterIds: number[]
) {
  return JSON.stringify({
    ...formData,
    selectedCharacterIds: buildCharacterLinkPayload(selectedCharacterIds),
  });
}

function readDraftIdFromUrl(location: string) {
  const search =
    typeof window !== "undefined"
      ? window.location.search
      : location.includes("?")
        ? location.slice(location.indexOf("?"))
        : "";
  const raw = new URLSearchParams(search).get("draftId");
  const parsed = raw ? Number(raw) : null;
  return parsed && Number.isFinite(parsed) ? parsed : null;
}

export default function DraftPage() {
  const { readingTheme, toggleReadingTheme } = useReadingTheme();
  const [location, navigate] = useLocation();
  const [activeDraftId, setActiveDraftId] = useState<number | null>(() =>
    readDraftIdFromUrl(location)
  );
  const draftId = activeDraftId;

  const [formData, setFormData] = useState(emptyForm);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>(
    []
  );
  const [slashQuery, setSlashQuery] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashAnchorIndex, setSlashAnchorIndex] = useState<number | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [quickCharacterQuery, setQuickCharacterQuery] = useState("/");
  const [quickSuggestionsOpen, setQuickSuggestionsOpen] = useState(false);
  const [activeQuickSuggestionIndex, setActiveQuickSuggestionIndex] =
    useState(0);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(
    buildSnapshot(emptyForm, [])
  );
  const [draftMode, setDraftMode] = useState<"draft" | "inspiration">("draft");
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [inspirationSuggestions, setInspirationSuggestions] = useState<
    InspirationSuggestion[]
  >([]);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftUserEditingRef = useRef(false);

  const listQuery = trpc.drafts.list.useQuery();
  const draftQuery = trpc.drafts.getById.useQuery(
    { draftId: draftId || 0 },
    { enabled: Boolean(draftId) }
  );
  const charactersQuery = trpc.characters?.list.useQuery();
  const profileQuery = trpc.profile?.get.useQuery();
  const chapterListQuery = trpc.writing.list.useQuery();

  const characters = useMemo<CharacterRecord[]>(
    () => charactersQuery.data?.data || [],
    [charactersQuery.data?.data]
  );

  useEffect(() => {
    const nextDraftId = readDraftIdFromUrl(location);
    setActiveDraftId(prev => (prev === nextDraftId ? prev : nextDraftId));
  }, [location]);

  useEffect(() => {
    if (!draftQuery.data) {
      if (!draftId) {
        const emptySnapshot = buildSnapshot(emptyForm, []);
        setFormData(prev =>
          sameDraftForm(prev, emptyForm) ? prev : emptyForm
        );
        setSelectedCharacterIds(prev => (prev.length ? [] : prev));
        setLastSavedSnapshot(prev =>
          prev === emptySnapshot ? prev : emptySnapshot
        );
      }
      return;
    }

    const draft = draftQuery.data;
    const parsedIds = resolveCharacterIds(draft.mainCharacters, characters);
    const nextForm = {
      title: draft.title || "",
      book: draft.bookReference || "",
      chapter: draft.chapterNumber || "",
      summary: draft.summary || "",
      draft: normalizePortugueseProseLayout(
        unwrapReviewedText(draft.content || "")
      ),
      keyDialogues: draft.untouchableDialogue || "",
      untouchable: draft.untouchableScenes || "",
      observations: draft.notes || "",
      facts: stripAutomaticCharacterContext(draft.canonicalFacts || ""),
      sceneLocation: draft.sceneLocation || "",
    };

    const nextSnapshot = buildSnapshot(nextForm, parsedIds);
    draftUserEditingRef.current = false;
    setFormData(prev => (sameDraftForm(prev, nextForm) ? prev : nextForm));
    setSelectedCharacterIds(prev =>
      sameNumberArray(prev, parsedIds) ? prev : parsedIds
    );
    setLastSavedSnapshot(prev => (prev === nextSnapshot ? prev : nextSnapshot));
  }, [draftId, draftQuery.data, characters]);

  useEffect(() => {
    if (!formData.draft.trim()) return;
    if (
      typeof document !== "undefined" &&
      document.activeElement === draftTextareaRef.current &&
      draftUserEditingRef.current
    ) {
      return;
    }

    const normalizedDraft = normalizePortugueseProseLayout(formData.draft);
    if (normalizedDraft === formData.draft) return;

    setFormData(prev =>
      prev.draft === formData.draft
        ? { ...prev, draft: normalizedDraft }
        : prev
    );
  }, [draftId, formData.draft]);

  const keyChaptersState = useMemo(
    () => parseKeyChapters(profileQuery.data?.keyChapters),
    [profileQuery.data]
  );
  const referenceContexts = useMemo(
    () =>
      buildReferenceContextsFromState(
        keyChaptersState,
        chapterListQuery.data?.data as any
      ),
    [chapterListQuery.data, keyChaptersState]
  );

  const selectedCharacters = useMemo(
    () =>
      selectedCharacterIds
        .map(id => characters?.find((char: CharacterRecord) => char.id === id))
        .filter(Boolean) as CharacterRecord[],
    [characters, selectedCharacterIds]
  );

  const automaticCharacterContext = useMemo(() => {
    if (!selectedCharacters.length) return "";
    return selectedCharacters
      .map(character => buildCharacterContext(character))
      .join("\n\n----------------\n\n");
  }, [selectedCharacters]);

  const filteredSuggestions = useMemo(() => {
    const normalized = normalizeCharacterSearch(slashQuery);
    const base = characters?.filter(
      (char: CharacterRecord) => !selectedCharacterIds.includes(char.id)
    );
    if (!normalized) return base;
    return base.filter((char: CharacterRecord) => {
      const haystack = [char.name, char.role, char.personality, char.history]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [characters, selectedCharacterIds, slashQuery]);

  const quickSuggestions = useMemo(() => {
    const normalized = normalizeCharacterSearch(quickCharacterQuery);
    const base = characters?.filter(
      (char: CharacterRecord) => !selectedCharacterIds.includes(char.id)
    );
    if (!normalized) return base;
    return base.filter((char: CharacterRecord) => {
      const haystack = [char.name, char.role, char.personality, char.history]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [characters, quickCharacterQuery, selectedCharacterIds]);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [slashQuery, slashOpen]);

  useEffect(() => {
    setActiveQuickSuggestionIndex(0);
  }, [quickCharacterQuery, quickSuggestionsOpen]);

  const saveMutation = trpc.drafts.create.useMutation();
  const updateMutation = trpc.drafts.update.useMutation();
  const sendMutation = trpc.drafts.sendToWriting.useMutation();
  const reviewMutation = trpc.drafts.reviewText.useMutation();
  const inspirationMutation = trpc.drafts.generateInspiration.useMutation();
  const generationMutation = trpc.generationJobs.create.useMutation();
  const deleteMutation = trpc.drafts.delete.useMutation();
  const [pendingDelete, setPendingDelete] = useState<{
    id: number;
    label: string;
  } | null>(null);
  const [generationStarting, setGenerationStarting] = useState(false);

  const requestDeleteDraft = (targetDraftId: number, targetTitle: string) => {
    const label = targetTitle.trim() || `rascunho #${targetDraftId}`;
    setPendingDelete({ id: targetDraftId, label });
  };

  const openSavedDraft = (targetDraftId: number) => {
    setActiveDraftId(targetDraftId);
    navigate(`/draft?draftId=${targetDraftId}`);
  };

  const performDeleteDraft = async () => {
    if (!pendingDelete) return;
    const targetDraftId = pendingDelete.id;
    try {
      await deleteMutation.mutateAsync({ draftId: targetDraftId });
      toast.success("Rascunho excluído.");
      await listQuery.refetch();
      // Se o rascunho atual foi excluído, limpa a navegação para a base.
      if (draftId === targetDraftId) {
        setActiveDraftId(null);
        navigate("/draft");
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possível excluir o rascunho."
      );
    }
  };

  const saving =
    saveMutation.isPending ||
    updateMutation.isPending ||
    sendMutation.isPending ||
    generationMutation.isPending ||
    generationStarting ||
    reviewMutation.isPending ||
    inspirationMutation.isPending;
  const currentSnapshot = useMemo(
    () => buildSnapshot(formData, selectedCharacterIds),
    [formData, selectedCharacterIds]
  );
  const isDirty = currentSnapshot !== lastSavedSnapshot;

  const draftWords = useMemo(
    () => formData.draft.trim().split(/\s+/).filter(Boolean).length,
    [formData.draft]
  );

  const handleChange = (name: keyof typeof emptyForm, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const buildCanonicalFacts = () => {
    // Personagens são enviados separadamente via characterContexts na WritingPage
    // Não embutir aqui para evitar duplicação na prompt do LLM
    return formData.facts.trim();
  };

  const buildPayload = () => ({
    title: formData.title.trim(),
    content: formData.draft,
    sceneLocation: formData.sceneLocation,
    bookReference: formData.book,
    chapterNumber: formData.chapter,
    mainCharacters: buildCharacterLinkPayload(selectedCharacterIds),
    summary: formData.summary,
    untouchableDialogue: formData.keyDialogues,
    untouchableScenes: formData.untouchable,
    canonicalFacts: buildCanonicalFacts(),
    notes: formData.observations,
  });

  const addCharacterToDraft = (
    character: CharacterRecord,
    options: { replaceSlashInDraft: boolean }
  ) => {
    setSelectedCharacterIds(prev =>
      prev.includes(character.id) ? prev : [...prev, character.id]
    );

    if (
      options.replaceSlashInDraft &&
      draftTextareaRef.current &&
      slashAnchorIndex !== null
    ) {
      const textarea = draftTextareaRef.current;
      const end = textarea.selectionStart ?? formData.draft.length;
      const before = formData.draft.slice(0, slashAnchorIndex);
      const after = formData.draft.slice(end);
      const insertion = character.name;
      const nextDraft = `${before}${insertion}${after}`;
      handleChange("draft", nextDraft);
      requestAnimationFrame(() => {
        const cursor = before.length + insertion.length;
        textarea.focus();
        textarea.setSelectionRange(cursor, cursor);
      });
    }

    setSlashOpen(false);
    setSlashQuery("");
    setSlashAnchorIndex(null);
    setQuickCharacterQuery("/");
    setQuickSuggestionsOpen(false);
    toast.success(`${character.name} vinculado ao rascunho.`);
  };

  const removeCharacterFromDraft = (id: number) => {
    setSelectedCharacterIds(prev => prev.filter(item => item !== id));
  };

  const saveCurrentDraft = async (options: { silent?: boolean } = {}) => {
    if (!formData.title.trim() && !formData.draft.trim()) {
      toast.error("Preencha ao menos título ou conteúdo.");
      return null;
    }

    if (draftId) {
      const result = await updateMutation.mutateAsync({
        draftId,
        ...buildPayload(),
      });
      if (!options.silent) toast.success("Rascunho atualizado.");
      await listQuery.refetch();
      setLastSavedSnapshot(buildSnapshot(formData, selectedCharacterIds));
      return result.data.id;
    }

    const result = await saveMutation.mutateAsync(buildPayload());
    if (!options.silent) toast.success("Rascunho salvo.");
    await listQuery.refetch();
    const createdId = result.data.id;
    setLastSavedSnapshot(buildSnapshot(formData, selectedCharacterIds));
    setActiveDraftId(createdId);
    navigate(`/draft?draftId=${createdId}`);
    return createdId;
  };

  const handleSendToWriting = async () => {
    if (!formData.draft.trim()) {
      toast.error("Escreva o rascunho antes de enviar para a Escrita.");
      return;
    }

    if (draftWords < MIN_DRAFT_WORDS_TO_GENERATE) {
      toast.error(MIN_DRAFT_GENERATION_MESSAGE);
      return;
    }

    setGenerationStarting(true);
    try {
      toast.loading("Preparando geração com IA...", {
        id: "draft-generation-start",
      });
      const currentId = await saveCurrentDraft({ silent: true });
      if (!currentId) return;

      await sendMutation.mutateAsync({ draftId: currentId });

      const job = await generationMutation.mutateAsync({
        draftId: currentId,
        action: "generate",
        generationMode: "standard",
        idempotencyKey: `draft:${currentId}:${draftWords}:${formData.draft.length}:${Date.now()}`,
      });

      toast.success("Geração iniciada. Abrindo Escrita...", {
        id: "draft-generation-start",
      });
      navigate(`/writing?draftId=${currentId}&jobId=${job.data.jobId}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Não foi possível iniciar a geração com IA.",
        {
          id: "draft-generation-start",
        }
      );
    } finally {
      setGenerationStarting(false);
    }
  };

  const handleReviewText = async () => {
    if (draftWords < MIN_DRAFT_WORDS_TO_REVIEW) {
      toast.error("Escreva um pouco mais antes de revisar o texto.");
      return;
    }

    const currentId = await saveCurrentDraft();
    if (!currentId) return;

    const result = await reviewMutation.mutateAsync({
      draftId: currentId,
      text: formData.draft,
      mode: "grammar",
    });

    setReviewResult(normalizeReviewResult(result));
    toast.success("Revisão pronta para conferir.");
  };

  const handleApplyReview = () => {
    if (!reviewResult?.reviewedText) return;
    handleChange(
      "draft",
      normalizePortugueseProseLayout(unwrapReviewedText(reviewResult.reviewedText))
    );
    setReviewResult(null);
    toast.success("Revisão aplicada ao rascunho.");
  };

  const handleCopyReview = async () => {
    if (!reviewResult?.reviewedText) return;
    await navigator.clipboard.writeText(unwrapReviewedText(reviewResult.reviewedText));
    toast.success("Texto revisado copiado.");
  };

  const handleGenerateInspiration = async () => {
    try {
      let currentId = draftId || undefined;
      if (formData.title.trim() || formData.draft.trim()) {
        currentId = (await saveCurrentDraft()) || undefined;
      }

      const result = await inspirationMutation.mutateAsync({
        draftId: currentId,
        currentDraftText: formData.draft,
      });

      setInspirationSuggestions(result.suggestions || []);
      setDraftMode("inspiration");
      toast.success("Inspiração gerada como hipótese, sem alterar o cânone.");
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    }
  };

  const handleDraftTextareaChange = (value: string, selectionStart: number) => {
    draftUserEditingRef.current = true;
    handleChange("draft", value);
    const textBeforeCursor = value.slice(0, selectionStart);
    const slashMatch = textBeforeCursor.match(/(^|\s)\/([^\s\/]*)$/);
    if (slashMatch) {
      const query = slashMatch[2] || "";
      setSlashQuery(query);
      setSlashOpen(true);
      setSlashAnchorIndex(selectionStart - query.length - 1);
    } else {
      setSlashOpen(false);
      setSlashQuery("");
      setSlashAnchorIndex(null);
    }
  };

  const handleDraftTextareaBlur = () => {
    draftUserEditingRef.current = false;
    const normalizedDraft = normalizePortugueseProseLayout(formData.draft);
    if (normalizedDraft !== formData.draft) {
      handleChange("draft", normalizedDraft);
    }
  };

  const handleDraftTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (!slashOpen || !filteredSuggestions.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestionIndex(prev =>
        Math.min(prev + 1, filteredSuggestions.length - 1)
      );
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestionIndex(prev => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const selected = filteredSuggestions[activeSuggestionIndex];
      if (selected)
        addCharacterToDraft(selected, { replaceSlashInDraft: true });
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setSlashOpen(false);
    }
  };

  const handleQuickCharacterAdd = () => {
    const hasSearch = Boolean(normalizeCharacterSearch(quickCharacterQuery));
    if (!hasSearch && !quickSuggestionsOpen) {
      setQuickSuggestionsOpen(true);
      return;
    }

    const found =
      quickSuggestions[activeQuickSuggestionIndex] || quickSuggestions[0];

    if (!found) {
      toast.error("Nenhum personagem encontrado.");
      return;
    }

    addCharacterToDraft(found, { replaceSlashInDraft: false });
  };

  return (
    <WorkStatusGate softBlock>
      <div className="draft-page-shell space-y-4">
        <EditorialFlowHeader
          active="draft"
          title="Rascunho do autor"
          statusItems={[
            {
              label: "rascunho",
              value: draftId ? `#${draftId}` : "novo",
              tone: draftId ? "success" : "accent",
            },
            {
              label: "status",
              value: isDirty ? "Alterações não salvas" : "Tudo salvo",
              tone: isDirty ? "warning" : "success",
            },
            {
              label: "texto",
              value: `${draftWords.toLocaleString("pt-BR")} palavras`,
              tone: "accent",
            },
          ]}
        />

        <div className="draft-workspace">
          <>
            <div className="draft-mode-tabs grid grid-cols-2 rounded-lg border border-border bg-secondary/40 p-1">
              <button
                type="button"
                onClick={() => setDraftMode("draft")}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${draftMode === "draft" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Rascunho
              </button>
              <button
                type="button"
                onClick={() => setDraftMode("inspiration")}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${draftMode === "inspiration" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Inspiração
              </button>
            </div>

            {draftMode === "inspiration" ? (
              <Card className="draft-editor-card space-y-4 border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-accent">
                      Hipóteses narrativas
                    </div>
                    <h3 className="mt-1 font-display text-lg text-foreground">
                      Inspiração para continuar
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      A IA sugere caminhos possíveis usando o rascunho, a obra
                      ativa e o cânone disponível. Nada daqui vira cânone
                      automaticamente.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={handleGenerateInspiration}
                    disabled={saving}
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    {inspirationMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Lightbulb className="mr-2 h-4 w-4" />
                    )}
                    Buscar inspiração
                  </Button>
                </div>

                {inspirationSuggestions.length ? (
                  <div className="space-y-3">
                    {inspirationSuggestions.map((item, index) => (
                      <div
                        key={`${item.title}-${index}`}
                        className="rounded-lg border border-border bg-secondary/45 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="font-display text-base text-foreground">
                            {item.title || `Caminho ${index + 1}`}
                          </h4>
                          <Badge
                            variant="secondary"
                            className="bg-accent/15 text-accent"
                          >
                            sugestão
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-foreground/85">
                          {item.description}
                        </p>
                        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Por que faz sentido
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              {item.whyItFits}
                            </p>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Como continuar
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              {item.continuationHint}
                            </p>
                          </div>
                        </div>
                        {item.affectedCharacters?.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.affectedCharacters.map(name => (
                              <Badge
                                key={name}
                                variant="secondary"
                                className="bg-secondary text-foreground"
                              >
                                {name}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        {item.evidence?.length ? (
                          <div className="mt-3 rounded-md border border-border/70 bg-background/35 px-3 py-2">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              Base usada
                            </div>
                            <div className="mt-2 space-y-2">
                              {item.evidence.map((excerpt, evidenceIndex) => (
                                <p
                                  key={`${excerpt}-${evidenceIndex}`}
                                  className="text-sm leading-6 text-foreground/75"
                                >
                                  {excerpt}
                                </p>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {item.narrativeRisk ? (
                          <p className="mt-3 text-xs text-amber-300">
                            Risco narrativo: {item.narrativeRisk}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border-2 border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
                    Clique em Buscar inspiração para receber caminhos possíveis
                    sem alterar seu rascunho.
                  </div>
                )}
              </Card>
            ) : null}

            {draftMode === "draft" ? (
            <Card className="book-editor-card overflow-hidden border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg text-foreground">
                  Texto bruto
                </h3>
                <div className="flex items-center gap-3">
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    use{" "}
                    <kbd className="rounded border border-border/70 bg-foreground/8 px-1 py-0.5 font-mono text-[10px] text-foreground/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      /nome
                    </kbd>{" "}
                    para vincular personagem
                  </span>
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
              </div>

              <div className="book-editor-shell" data-reading-theme={readingTheme}>
                <Textarea
                  ref={draftTextareaRef}
                  value={formData.draft}
                  onChange={e =>
                    handleDraftTextareaChange(
                      e.target.value,
                      e.currentTarget.selectionStart ?? e.target.value.length
                    )
                  }
                  onBlur={handleDraftTextareaBlur}
                  onKeyDown={handleDraftTextareaKeyDown}
                  className="book-editor-textarea"
                  lang="pt-BR"
                  spellCheck
                  style={fixedTextareaSizing}
                  placeholder="Despeje o rascunho aqui. Pode estar incompleto, torto ou em pedaços. Use / para puxar personagem cadastrado."
                />
                {slashOpen && filteredSuggestions.length > 0 && (
                  <div className="absolute inset-x-2 bottom-4 z-20 max-h-[min(420px,70vh)] rounded-lg border border-border bg-card/95 p-2 shadow-xl backdrop-blur sm:inset-x-4">
                    <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
                      Selecionar personagem para esta cena
                    </div>
                    <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
                      {filteredSuggestions.map(
                        (character: CharacterRecord, index) => (
                          <button
                            key={character.id}
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() =>
                              addCharacterToDraft(character, {
                                replaceSlashInDraft: true,
                              })
                            }
                            className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${index === activeSuggestionIndex ? "bg-accent text-accent-foreground" : "bg-secondary/60 text-foreground hover:bg-secondary"}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium">
                                {character.name}
                              </span>
                              <span className="text-xs opacity-80">
                                {character.role || "personagem"}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs opacity-80">
                              {character.personality || character.history}
                            </div>
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>
            ) : null}

          </>

          <div className="draft-sidebar space-y-4">
            <Card className="space-y-3 border border-border bg-card p-4">
              <h3 className="font-display text-lg text-foreground">
                Dados do capítulo
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Título
                  </label>
                  <Input
                    value={formData.title}
                    onChange={e => handleChange("title", e.target.value)}
                    className="bg-secondary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Livro
                  </label>
                  <Input
                    value={formData.book}
                    onChange={e => handleChange("book", e.target.value)}
                    className="bg-secondary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Capítulo
                  </label>
                  <Input
                    value={formData.chapter}
                    onChange={e => handleChange("chapter", e.target.value)}
                    className="bg-secondary"
                  />
                </div>
              </div>
            </Card>

            <Card className="space-y-3 border border-border bg-card p-4">
              <h3 className="font-display text-lg text-foreground">
                Personagens desta cena
              </h3>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Adicionar personagem com /
                </label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      value={quickCharacterQuery}
                      onFocus={() => setQuickSuggestionsOpen(true)}
                      onBlur={() =>
                        window.setTimeout(
                          () => setQuickSuggestionsOpen(false),
                          120
                        )
                      }
                      onChange={e => {
                        setQuickCharacterQuery(
                          e.target.value.startsWith("/")
                            ? e.target.value
                            : `/${e.target.value}`
                        );
                        setQuickSuggestionsOpen(true);
                      }}
                      className="bg-secondary"
                      placeholder="/pavel"
                      onKeyDown={e => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setQuickSuggestionsOpen(true);
                          if (!quickSuggestions.length) return;
                          setActiveQuickSuggestionIndex(prev =>
                            Math.min(prev + 1, quickSuggestions.length - 1)
                          );
                          return;
                        }

                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setQuickSuggestionsOpen(true);
                          if (!quickSuggestions.length) return;
                          setActiveQuickSuggestionIndex(prev =>
                            Math.max(prev - 1, 0)
                          );
                          return;
                        }

                        if (e.key === "Enter" || e.key === "Tab") {
                          e.preventDefault();
                          handleQuickCharacterAdd();
                          return;
                        }

                        if (e.key === "Escape") {
                          e.preventDefault();
                          setQuickSuggestionsOpen(false);
                        }
                      }}
                    />
                    {quickSuggestionsOpen && quickSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-30 rounded-lg border border-border bg-card/95 p-2 shadow-xl backdrop-blur">
                        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                          {quickSuggestions.map(
                            (character: CharacterRecord, index) => (
                              <button
                                key={character.id}
                                type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() =>
                                  addCharacterToDraft(character, {
                                    replaceSlashInDraft: false,
                                  })
                                }
                                className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${index === activeQuickSuggestionIndex ? "bg-accent text-accent-foreground" : "bg-secondary/60 text-foreground hover:bg-secondary"}`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-medium">
                                    {character.name}
                                  </span>
                                  <span className="text-xs opacity-80">
                                    {character.role || "personagem"}
                                  </span>
                                </div>
                                <div className="mt-1 line-clamp-2 text-xs opacity-80">
                                  {character.personality || character.history}
                                </div>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleQuickCharacterAdd}
                  >
                    <UserRound className="mr-2 h-4 w-4" />
                    Vincular
                  </Button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground">
                  Vinculados
                </label>
                {selectedCharacters.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedCharacters.map(character => (
                      <Badge
                        key={character.id}
                        variant="secondary"
                        className="flex items-center gap-2 bg-purple-500/10 px-3 py-1 text-purple-300"
                      >
                        <span>{character.name}</span>
                        <button
                          type="button"
                          onClick={() => removeCharacterFromDraft(character.id)}
                          className="rounded-full text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border-2 border-dashed border-border/50 p-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Nenhum personagem vinculado ainda.
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground/70">
                      Use o campo acima para vincular personagens à cena
                    </p>
                  </div>
                )}
              </div>

              <details className="rounded-lg border border-border/70 bg-secondary/35">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
                  Contexto enviado à IA
                </summary>
                <div className="border-t border-border/70 p-3">
                  <Textarea
                    value={automaticCharacterContext}
                    readOnly
                    rows={8}
                    className="max-h-72 resize-none bg-background/60 text-foreground/90"
                    placeholder="Ao vincular personagens, o histórico deles entra aqui automaticamente para a IA não errar."
                  />
                </div>
              </details>

              <div className="grid gap-2">
                <Button
                  type="button"
                  onClick={() => saveCurrentDraft()}
                  disabled={saving}
                  variant="outline"
                  className="w-full"
                >
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Salvar rascunho
                </Button>
                <Button
                  type="button"
                  onClick={handleReviewText}
                  disabled={saving}
                  variant="outline"
                  className="w-full"
                >
                  {reviewMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                  )}
                  Revisar texto
                </Button>
                <Button
                  type="button"
                  onClick={handleGenerateInspiration}
                  disabled={saving}
                  variant="outline"
                  className="w-full"
                >
                  {inspirationMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Lightbulb className="mr-2 h-4 w-4" />
                  )}
                  Buscar inspiração
                </Button>
                <Button
                  type="button"
                  onClick={handleSendToWriting}
                  disabled={saving || generationStarting}
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  {generationStarting ||
                  sendMutation.isPending ||
                  generationMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  {generationStarting ||
                  sendMutation.isPending ||
                  generationMutation.isPending
                    ? "Preparando geração..."
                    : "Gerar capítulo com IA"}
                </Button>
                {draftWords > 0 && draftWords < MIN_DRAFT_WORDS_TO_GENERATE ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Faltam{" "}
                    {(MIN_DRAFT_WORDS_TO_GENERATE - draftWords).toLocaleString(
                      "pt-BR"
                    )}{" "}
                    palavras para gerar capítulo com IA.
                  </p>
                ) : null}
              </div>

              {reviewResult ? (
                <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-display text-sm text-foreground">
                        Revisão do rascunho pronta
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Confira só se quiser comparar antes de aplicar.
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-accent/15 text-accent"
                    >
                      temporário
                    </Badge>
                  </div>
                  {reviewResult.changesSummary?.length ? (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {reviewResult.changesSummary.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                  <details className="rounded-lg border border-border/70 bg-secondary/45">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
                      Ver texto revisado
                    </summary>
                    <div className="border-t border-border/70 p-3">
                      <Textarea
                        value={reviewResult.reviewedText}
                        readOnly
                        rows={8}
                        className="max-h-72 resize-none bg-background/60 text-foreground/90"
                      />
                    </div>
                  </details>
                  <div className="grid gap-2">
                    <Button
                      type="button"
                      onClick={handleApplyReview}
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                      Aplicar revisão
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setReviewResult(null)}
                    >
                      Descartar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCopyReview}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copiar
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>

            {referenceContexts.length ? (
              <Card className="space-y-3 border border-border bg-card p-4">
                <div className="font-display text-lg text-foreground">
                  Capítulos-chave ativos
                </div>
                <div className="max-h-64 space-y-3 overflow-y-auto">
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
            <Card className="space-y-3 border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">
                  Rascunhos salvos
                </div>
                <Badge
                  variant="secondary"
                  className="bg-secondary px-2 py-1 text-foreground"
                >
                  {listQuery.data?.data.length || 0}
                </Badge>
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {listQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando...
                  </div>
                ) : listQuery.data?.data.length ? (
                  listQuery.data?.data.map(item => (
                    <div
                      key={item.id}
                      className={`group flex w-full items-stretch rounded-lg border transition-colors ${draftId === item.id ? "border-accent bg-accent/10" : "border-border bg-secondary/50 hover:border-accent"}`}
                    >
                      <button
                        type="button"
                        onClick={() => openSavedDraft(item.id)}
                        className="flex-1 rounded-l-lg p-3 text-left"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-foreground">
                            {item.title || "Rascunho sem título"}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            #{item.id}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{item.bookReference || "Sem livro"}</span>
                          <span>•</span>
                          <span>{item.chapterNumber || "Sem capítulo"}</span>
                          {item.sceneLocation ? (
                            <>
                              <span>•</span>
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {item.sceneLocation}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Excluir rascunho"
                        aria-label="Excluir rascunho"
                        onClick={event => {
                          event.stopPropagation();
                          requestDeleteDraft(item.id, item.title || "");
                        }}
                        disabled={deleteMutation.isPending}
                        className="flex items-center justify-center rounded-r-lg border-l border-border/60 px-3 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        {deleteMutation.isPending &&
                        deleteMutation.variables?.draftId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border-2 border-dashed border-border/50 p-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Ainda não há rascunhos salvos.
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground/70">
                      Crie seu primeiro rascunho usando o formulário acima
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title={
          pendingDelete
            ? `Excluir "${pendingDelete.label}"?`
            : "Excluir rascunho?"
        }
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        destructive
        onConfirm={performDeleteDraft}
      />
    </WorkStatusGate>
  );
}
