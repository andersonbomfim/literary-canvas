import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExportChapter } from "@/components/ExportChapter";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  RotateCcw,
  Save,
  Sparkles,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import {
  buildReferenceContextsFromState,
  parseKeyChapters,
} from "@/lib/keyChapters";
import { WorkStatusGate } from "@/components/WorkStatusGate";
import { EditorialFlowHeader } from "@/components/EditorialFlowHeader";

type CharacterSuggestion = {
  characterId: number;
  characterName: string;
  suggestions: Array<{
    field: string;
    currentValue: string;
    suggestedAppend: string;
    reason: string;
  }>;
};

type ReviewStatus = "pending" | "approved" | "rejected" | "revision_needed";

const fieldLabels: Record<string, string> = {
  history: "História",
  personality: "Personalidade",
  relationships: "Relacionamentos",
  backstory: "Passado",
  motivations: "Motivações",
  notes: "Notas",
  physicalDescription: "Descrição física",
  psychologicalProfile: "Perfil psicológico",
};

const reviewStatusLabels: Record<ReviewStatus | "unsubmitted", string> = {
  pending: "Para revisar",
  revision_needed: "Voltou para Escrita",
  approved: "Canônico",
  rejected: "Descartado",
  unsubmitted: "Em escrita",
};

const reviewStatusClasses: Record<ReviewStatus | "unsubmitted", string> = {
  pending: "bg-blue-500/15 text-blue-300",
  revision_needed: "bg-amber-500/15 text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-red-500/15 text-red-300",
  unsubmitted: "border-border/70 bg-foreground/8 text-foreground/80",
};

function normalizeReviewStatus(item: {
  status: string | null;
  reviewStatus: string | null;
}): ReviewStatus | "unsubmitted" {
  if (
    item.reviewStatus === "pending" ||
    item.reviewStatus === "approved" ||
    item.reviewStatus === "rejected" ||
    item.reviewStatus === "revision_needed"
  ) {
    return item.reviewStatus;
  }
  if (item.status === "canonical") return "approved";
  if (item.status === "discarded") return "rejected";
  return "unsubmitted";
}

function arrayToText(value: string[]) {
  return (value || []).join("\n");
}

function textToArray(value: string) {
  return value
    .split(/\n+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export default function ReviewPage() {
  const [location, navigate] = useLocation();
  // See ResetPasswordPage — wouter's location is path-only, query lives on window.location.search.
  const params = useMemo(
    () =>
      new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : ""
      ),
    [location]
  );
  const chapterId = params.get("chapterId")
    ? Number(params.get("chapterId"))
    : null;

  const chaptersQuery = trpc.review.listChapters.useQuery();
  const profileQuery = trpc.profile?.get.useQuery();
  const keyChaptersState = useMemo(
    () => parseKeyChapters(profileQuery.data?.keyChapters),
    [profileQuery.data]
  );
  const referenceContexts = useMemo(
    () =>
      buildReferenceContextsFromState(
        keyChaptersState,
        chaptersQuery.data as any
      ),
    [chaptersQuery.data, keyChaptersState]
  );
  const reviewQuery = trpc.review.getByChapter.useQuery(
    { chapterId: chapterId || 0 },
    { enabled: Boolean(chapterId) }
  );
  const analyzeMutation = trpc.review.analyze.useMutation({
    onSuccess: () => {
      toast.success("Revisão gerada.");
      chaptersQuery.refetch();
      reviewQuery.refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });
  const generateMemoryMutation =
    trpc.review.generateContinuityMemory.useMutation({
      onSuccess: () => {
        toast.success("Memória de continuidade gerada.");
        reviewQuery.refetch();
        profileQuery.refetch();
      },
      onError: error => toast.error(formatApiErrorMessage(error)),
    });
  const saveMemoryMutation = trpc.review.saveContinuityMemory.useMutation({
    onSuccess: () => {
      toast.success("Memória de continuidade salva.");
      reviewQuery.refetch();
      profileQuery.refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });
  const suggestCharactersMutation =
    trpc.review.suggestCharacterUpdates.useMutation({
      onSuccess: result => {
        const data = result.data as CharacterSuggestion[];
        if (data.length) {
          setCharacterSuggestions(data);
          setDismissedSuggestions(new Set());
          toast.success(
            `${data.reduce((acc, c) => acc + c.suggestions.length, 0)} sugestão(oes) de atualização de personagens.`
          );
        } else {
          toast.info(
            "Nenhuma atualização relevante de personagens neste capítulo."
          );
        }
      },
      onError: error => toast.error(formatApiErrorMessage(error)),
    });

  const applyCharacterSuggestionMutation =
    trpc.review.applyCharacterSuggestion.useMutation({
      onSuccess: () => {
        toast.success("Personagem atualizado.");
      },
      onError: error => toast.error(formatApiErrorMessage(error)),
    });

  const statusMutation = trpc.review.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Status da revisão atualizado.");
      chaptersQuery.refetch();
      reviewQuery.refetch();
      profileQuery.refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });
  const sendBackMutation = trpc.review.sendBackToWriting.useMutation({
    onSuccess: result => {
      toast.success("Correções enviadas para a Escrita.");
      chaptersQuery.refetch();
      reviewQuery.refetch();
      profileQuery.refetch();
      navigate(`/writing?chapterId=${result.data.chapterId}`);
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const [characterSuggestions, setCharacterSuggestions] = useState<
    CharacterSuggestion[]
  >([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(
    new Set()
  );

  /**
   * Seleção de fixes para devolver à Escrita. A escolha vai ao backend, que
   * monta um brief editorial e muda o capítulo para "revision_needed".
   * sessionStorage fica apenas como cache de navegação; a Escrita também
   * consegue reconstruir o contexto pelo servidor.
   */
  const [selectedFixes, setSelectedFixes] = useState<Set<string>>(new Set());
  const toggleFix = (key: string) => {
    setSelectedFixes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // Quando troca de capítulo, zera seleção.
  useEffect(() => {
    setSelectedFixes(new Set());
  }, [chapterId]);

  const handleAcceptSuggestion = async (
    charId: number,
    field: string,
    appendText: string
  ) => {
    const key = `${charId}-${field}`;
    try {
      await applyCharacterSuggestionMutation.mutateAsync({
        characterId: charId,
        field,
        appendText,
      });
      setDismissedSuggestions(prev => new Set(prev).add(key));
    } catch {
      // Error toast is handled by onError callback — don't dismiss
    }
  };

  const handleDismissSuggestion = (charId: number, field: string) => {
    const key = `${charId}-${field}`;
    setDismissedSuggestions(prev => new Set(prev).add(key));
  };

  const visibleSuggestions = useMemo(() => {
    return characterSuggestions
      .map(cs => ({
        ...cs,
        suggestions: cs.suggestions.filter(
          s => !dismissedSuggestions.has(`${cs.characterId}-${s.field}`)
        ),
      }))
      .filter(cs => cs.suggestions.length > 0);
  }, [characterSuggestions, dismissedSuggestions]);

  const reviewQueues = useMemo(() => {
    const chapters = chaptersQuery.data || [];

    return [
      {
        key: "pending" as const,
        title: "Para revisar",
        description:
          "Capítulos enviados pela Escrita e aguardando leitura final.",
        items: chapters.filter(
          (item: any) => normalizeReviewStatus(item) === "pending"
        ),
      },
      {
        key: "revision_needed" as const,
        title: "Devolvidos para Escrita",
        description:
          "Capítulos que precisam ser corrigidos antes de virar canon.",
        items: chapters.filter(
          (item: any) => normalizeReviewStatus(item) === "revision_needed"
        ),
      },
      {
        key: "approved" as const,
        title: "Canônicos",
        description: "Capítulos aprovados e disponíveis como memória da obra.",
        items: chapters.filter(
          (item: any) => normalizeReviewStatus(item) === "approved"
        ),
      },
      {
        key: "rejected" as const,
        title: "Descartados",
        description: "Capítulos recusados no fluxo de revisão.",
        items: chapters.filter(
          (item: any) => normalizeReviewStatus(item) === "rejected"
        ),
      },
    ].filter(group => group.items.length > 0);
  }, [chaptersQuery.data]);

  const totalChaptersInReview = useMemo(
    () => reviewQueues.reduce((total, group) => total + group.items.length, 0),
    [reviewQueues]
  );

  const chapter = reviewQuery.data?.chapter;
  const review = reviewQuery.data?.review;
  const comments = review?.comments || [];
  const alerts = review?.alerts || [];
  const continuityMemory = reviewQuery.data?.continuityMemory;
  const recommendedFixKeys = useMemo(() => {
    const keys: string[] = [];
    alerts.forEach((alert: any, idx: number) => {
      if (alert.type === "error" || alert.type === "warning")
        keys.push(`alert:${idx}`);
    });
    comments.forEach((comment: any) => {
      if (comment.severity === "high" || comment.severity === "medium")
        keys.push(`comment:${comment.id}`);
    });
    return keys;
  }, [alerts, comments]);

  const selectRecommendedFixes = () => {
    if (!recommendedFixKeys.length) return;
    setSelectedFixes(new Set(recommendedFixKeys));
  };

  const buildFixSelectionPayload = () => {
    const commentIds: number[] = [];
    const alertIndexes: number[] = [];
    selectedFixes.forEach(key => {
      if (key.startsWith("alert:")) {
        const idx = Number(key.slice(6));
        if (Number.isFinite(idx)) alertIndexes.push(idx);
      } else if (key.startsWith("comment:")) {
        const id = Number(key.slice(8));
        if (Number.isFinite(id)) commentIds.push(id);
      }
    });
    return { commentIds, alertIndexes };
  };

  const handleSendBackWithFixes = async () => {
    if (!chapter || selectedFixes.size === 0) return;
    const payload = buildFixSelectionPayload();
    if (!payload.commentIds.length && !payload.alertIndexes.length) {
      toast.error(
        "Marque pelo menos um alerta ou comentário antes de devolver."
      );
      return;
    }
    await sendBackMutation.mutateAsync({ chapterId: chapter.id, ...payload });
  };

  const [memorySummary, setMemorySummary] = useState("");
  const [memoryStateChanges, setMemoryStateChanges] = useState("");
  const [memoryCanonicalFacts, setMemoryCanonicalFacts] = useState("");
  const [memoryOpenLoops, setMemoryOpenLoops] = useState("");
  const [memoryImpactedCharacters, setMemoryImpactedCharacters] = useState("");

  useEffect(() => {
    setMemorySummary(continuityMemory?.summary || "");
    setMemoryStateChanges(arrayToText(continuityMemory?.stateChanges ?? []));
    setMemoryCanonicalFacts(
      arrayToText(continuityMemory?.canonicalFacts ?? [])
    );
    setMemoryOpenLoops(arrayToText(continuityMemory?.openLoops ?? []));
    setMemoryImpactedCharacters(
      arrayToText(continuityMemory?.impactedCharacters ?? [])
    );
  }, [continuityMemory?.id, continuityMemory?.updatedAt]);

  const memoryDirty = useMemo(() => {
    return (
      memorySummary !== (continuityMemory?.summary || "") ||
      memoryStateChanges !==
        arrayToText(continuityMemory?.stateChanges ?? []) ||
      memoryCanonicalFacts !==
        arrayToText(continuityMemory?.canonicalFacts ?? []) ||
      memoryOpenLoops !== arrayToText(continuityMemory?.openLoops ?? []) ||
      memoryImpactedCharacters !==
        arrayToText(continuityMemory?.impactedCharacters ?? [])
    );
  }, [
    continuityMemory,
    memorySummary,
    memoryStateChanges,
    memoryCanonicalFacts,
    memoryOpenLoops,
    memoryImpactedCharacters,
  ]);

  const canonicalPackageStats = useMemo(
    () => ({
      facts: textToArray(memoryCanonicalFacts).length,
      changes: textToArray(memoryStateChanges).length,
      loops: textToArray(memoryOpenLoops).length,
      characters: textToArray(memoryImpactedCharacters).length,
    }),
    [
      memoryCanonicalFacts,
      memoryStateChanges,
      memoryOpenLoops,
      memoryImpactedCharacters,
    ]
  );

  const handleSaveMemory = async () => {
    if (!chapterId) return;
    if (!memorySummary.trim()) {
      toast.error("Resumo da memória é obrigatório.");
      return;
    }
    await saveMemoryMutation.mutateAsync({
      chapterId,
      summary: memorySummary.trim(),
      stateChanges: textToArray(memoryStateChanges),
      canonicalFacts: textToArray(memoryCanonicalFacts),
      openLoops: textToArray(memoryOpenLoops),
      impactedCharacters: textToArray(memoryImpactedCharacters),
      isActive: true,
    });
  };

  const handleApproveChapter = async () => {
    if (!chapter) return;
    if (memoryDirty && memorySummary.trim()) {
      await saveMemoryMutation.mutateAsync({
        chapterId: chapter.id,
        summary: memorySummary.trim(),
        stateChanges: textToArray(memoryStateChanges),
        canonicalFacts: textToArray(memoryCanonicalFacts),
        openLoops: textToArray(memoryOpenLoops),
        impactedCharacters: textToArray(memoryImpactedCharacters),
        isActive: true,
      });
    }
    await statusMutation.mutateAsync({
      chapterId: chapter.id,
      status: "approved",
    });
  };

  const selectedReviewStatus = chapter
    ? normalizeReviewStatus({
        status: chapter.status,
        reviewStatus: review?.status ?? null,
      })
    : null;

  return (
    <WorkStatusGate softBlock>
      <div className="space-y-4">
        <EditorialFlowHeader
          active="review"
          title="Revisão editorial"
          subtitle="Aqui o capítulo deixa de ser rascunho trabalhado e passa por qualidade, continuidade e pacote canônico antes de virar parte oficial da obra."
          statusItems={[
            {
              label: "fila",
              value: totalChaptersInReview,
              tone: totalChaptersInReview ? "accent" : "neutral",
            },
            {
              label: "selecionadas",
              value: selectedFixes.size,
              tone: selectedFixes.size ? "warning" : "neutral",
            },
            {
              label: "capítulo",
              value: chapter ? `#${chapter.id}` : "nenhum",
              tone: chapter ? "success" : "neutral",
            },
          ]}
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.35fr]">
          <Card className="space-y-3 border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg text-foreground">
                  Fila de revisão
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Só entra aqui de verdade quando a Escrita envia o capítulo.
                </p>
              </div>
              <Badge variant="secondary" className="px-2 py-0.5">
                {totalChaptersInReview}
              </Badge>
            </div>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto">
              {chaptersQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando...
                </div>
              ) : totalChaptersInReview ? (
                reviewQueues.map(group => (
                  <div
                    key={group.key}
                    className="space-y-2 rounded-lg border border-border/70 bg-secondary/20 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          {group.title}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {group.description}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={`${reviewStatusClasses[group.key]} px-2 py-0.5 text-xs`}
                      >
                        {group.items.length}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {group.items.map((item: any) => {
                        const itemStatus = normalizeReviewStatus(item);
                        return (
                          <button
                            key={item.id}
                            onClick={() =>
                              navigate(`/review?chapterId=${item.id}`)
                            }
                            className={`w-full rounded-lg border p-3 text-left transition-colors cursor-pointer ${chapterId === item.id ? "border-accent bg-accent/10" : "border-border bg-card/70 hover:border-accent hover:bg-secondary/70"}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-medium text-foreground">
                                {item.title}
                              </div>
                              <Badge
                                variant="secondary"
                                className={`${reviewStatusClasses[itemStatus]} shrink-0 px-2 py-0.5 text-xs`}
                              >
                                {reviewStatusLabels[itemStatus]}
                              </Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Capítulo #{item.id}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border-2 border-dashed border-border bg-secondary/20 p-4 text-center text-sm text-muted-foreground">
                  <div className="text-foreground font-medium">
                    Nenhum capítulo em revisão
                  </div>
                  <p className="mt-1">
                    Gere um capítulo na Escrita e envie para cá.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <div className="space-y-4">
            {chapter ? (
              selectedReviewStatus === "revision_needed" ? (
                <Card className="border border-amber-500/35 bg-amber-500/5 p-8 text-center">
                  <div className="text-foreground font-medium text-lg">
                    Capítulo devolvido para a Escrita
                  </div>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    As correções selecionadas já estão vinculadas ao capítulo.
                    Aplique-as na Escrita e envie novamente quando estiver
                    pronto para uma nova decisão editorial.
                  </p>
                  <div className="mt-5 flex justify-center">
                    <Button
                      onClick={() =>
                        navigate(`/writing?chapterId=${chapter.id}`)
                      }
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                      Retomar correções na Escrita
                    </Button>
                  </div>
                </Card>
              ) : selectedReviewStatus === "unsubmitted" ? (
                <Card className="border border-border bg-card p-8 text-center">
                  <div className="text-foreground font-medium text-lg">
                    Capítulo ainda está na Escrita
                  </div>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    A Revisão só aprova capítulos enviados pela etapa de
                    Escrita. Abra o capítulo na Escrita e use o botão de envio
                    para revisão quando ele estiver pronto.
                  </p>
                  <div className="mt-5 flex justify-center">
                    <Button
                      onClick={() =>
                        navigate(`/writing?chapterId=${chapter.id}`)
                      }
                      className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                      Abrir na Escrita
                    </Button>
                  </div>
                </Card>
              ) : (
                <>
                  <Card className="space-y-3 border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h2 className="font-display text-xl text-foreground">
                          {chapter.title}
                        </h2>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {(() => {
                            const statusKey = normalizeReviewStatus({
                              status: chapter.status,
                              reviewStatus: review?.status ?? null,
                            });
                            return (
                              <Badge
                                variant="secondary"
                                className={`${reviewStatusClasses[statusKey]} px-2 py-0.5 text-xs`}
                              >
                                {reviewStatusLabels[statusKey]}
                              </Badge>
                            );
                          })()}
                          <Badge
                            variant="secondary"
                            className="px-2 py-0.5 text-xs"
                          >
                            Capítulo: {chapter.status}
                          </Badge>
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                          Leia o capítulo como leitor final. Ao aprovar, ele
                          vira canônico e a Revisão salva memória de
                          continuidade para alimentar o livro.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() =>
                            analyzeMutation.mutate({
                              chapterId: chapter.id,
                              referenceContexts,
                            })
                          }
                          className="bg-accent text-accent-foreground hover:bg-accent/90"
                        >
                          {analyzeMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="mr-2 h-4 w-4" />
                          )}
                          Rodar revisão
                        </Button>
                        <Button
                          variant="outline"
                          onClick={selectRecommendedFixes}
                          disabled={!recommendedFixKeys.length}
                        >
                          Selecionar críticos
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            navigate(`/writing?chapterId=${chapter.id}`)
                          }
                        >
                          Abrir na escrita
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                      <Button
                        variant="outline"
                        onClick={handleSendBackWithFixes}
                        disabled={
                          statusMutation.isPending ||
                          sendBackMutation.isPending ||
                          selectedFixes.size === 0
                        }
                        title={
                          selectedFixes.size === 0
                            ? "Marque ao menos um alerta ou comentário abaixo para devolver."
                            : `Devolver com ${selectedFixes.size} correção(ões) selecionada(s).`
                        }
                      >
                        {sendBackMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <AlertTriangle className="mr-2 h-4 w-4" />
                        )}
                        {selectedFixes.size > 0
                          ? `Devolver com ${selectedFixes.size} correção${selectedFixes.size > 1 ? "ões" : ""}`
                          : "Devolver para Escrita"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          statusMutation.mutate({
                            chapterId: chapter.id,
                            status: "rejected",
                          })
                        }
                        disabled={statusMutation.isPending}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Descartar
                      </Button>
                      <Button
                        onClick={handleApproveChapter}
                        disabled={
                          statusMutation.isPending ||
                          saveMemoryMutation.isPending
                        }
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                      >
                        {statusMutation.isPending ||
                        saveMemoryMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        {memorySummary.trim()
                          ? "Aprovar com pacote canônico"
                          : "Aprovar e gerar pacote canônico"}
                      </Button>
                    </div>

                    <div className="rounded-lg border border-border/80 bg-secondary/35 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-display text-lg text-foreground">
                            Pacote canônico
                          </div>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            Revise o que este capítulo vai entregar para a
                            cânone do livro antes da aprovação.
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`${memorySummary.trim() ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"} px-2 py-0.5 text-xs`}
                        >
                          {memorySummary.trim()
                            ? "memória pronta"
                            : "memória pendente"}
                        </Badge>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                        {[
                          {
                            label: "Fatos",
                            value: canonicalPackageStats.facts,
                          },
                          {
                            label: "Mudanças",
                            value: canonicalPackageStats.changes,
                          },
                          {
                            label: "Pontas",
                            value: canonicalPackageStats.loops,
                          },
                          {
                            label: "Personagens",
                            value: canonicalPackageStats.characters,
                          },
                        ].map(item => (
                          <div
                            key={item.label}
                            className="rounded-lg border border-border/70 bg-card/70 p-3"
                          >
                            <div className="text-lg font-semibold text-foreground">
                              {item.value}
                            </div>
                            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                              {item.label}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() =>
                            generateMemoryMutation.mutate({
                              chapterId: chapter.id,
                            })
                          }
                          disabled={generateMemoryMutation.isPending}
                        >
                          {generateMemoryMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="mr-2 h-4 w-4" />
                          )}
                          {continuityMemory
                            ? "Regenerar pacote"
                            : "Gerar pacote"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleSaveMemory}
                          disabled={
                            saveMemoryMutation.isPending ||
                            !memoryDirty ||
                            !memorySummary.trim()
                          }
                        >
                          {saveMemoryMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Salvar pacote
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            suggestCharactersMutation.mutate({
                              chapterId: chapter.id,
                            })
                          }
                          disabled={suggestCharactersMutation.isPending}
                        >
                          {suggestCharactersMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                          )}
                          Sugerir personagens
                        </Button>
                      </div>
                    </div>
                  </Card>

                  {(visibleSuggestions.length > 0 ||
                    suggestCharactersMutation.isPending) && (
                    <Card className="space-y-3 border border-accent/30 bg-accent/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-accent" />
                          <span className="font-display text-lg text-foreground">
                            Sugestões para personagens
                          </span>
                        </div>
                        {visibleSuggestions.length > 0 && (
                          <Badge
                            variant="secondary"
                            className="bg-accent/15 px-2 py-0.5 text-accent text-xs"
                          >
                            {visibleSuggestions.reduce(
                              (acc, c) => acc + c.suggestions.length,
                              0
                            )}{" "}
                            pendente(s)
                          </Badge>
                        )}
                      </div>

                      {suggestCharactersMutation.isPending ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Analisando personagens do capítulo...
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {visibleSuggestions.map(cs => (
                            <div
                              key={cs.characterId}
                              className="rounded-lg border border-border bg-card p-3"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <UserRound className="h-3.5 w-3.5 text-purple-400" />
                                <span className="font-medium text-foreground">
                                  {cs.characterName}
                                </span>
                              </div>
                              <div className="space-y-2">
                                {cs.suggestions.map(s => (
                                  <div
                                    key={`${cs.characterId}-${s.field}`}
                                    className="rounded-lg bg-secondary/50 p-3"
                                  >
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <Badge
                                        variant="secondary"
                                        className="bg-purple-500/10 px-2 py-0.5 text-purple-300 text-xs"
                                      >
                                        {fieldLabels[s.field] || s.field}
                                      </Badge>
                                      <div className="flex gap-1">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 w-7 p-0 text-emerald-400 hover:bg-emerald-500/10"
                                          onClick={() =>
                                            handleAcceptSuggestion(
                                              cs.characterId,
                                              s.field,
                                              s.suggestedAppend
                                            )
                                          }
                                          disabled={
                                            applyCharacterSuggestionMutation.isPending
                                          }
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                          onClick={() =>
                                            handleDismissSuggestion(
                                              cs.characterId,
                                              s.field
                                            )
                                          }
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                    {s.currentValue && (
                                      <p className="text-xs text-muted-foreground mb-1 line-clamp-2">
                                        <span className="font-medium">
                                          Atual:
                                        </span>{" "}
                                        {s.currentValue}
                                      </p>
                                    )}
                                    <p className="text-sm text-foreground">
                                      {s.suggestedAppend}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground italic">
                                      {s.reason}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  )}

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                    <div className="space-y-4">
                      <Card className="space-y-3 border border-border bg-card p-4">
                        <div className="font-medium text-foreground">
                          Alertas
                        </div>
                        <div className="space-y-3">
                          {alerts.length ? (
                            alerts.map((alert: any, idx: number) => {
                              const key = `alert:${idx}`;
                              const checked = selectedFixes.has(key);
                              return (
                                <label
                                  key={`${alert.title}-${idx}`}
                                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${alert.type === "error" ? "border-red-700 bg-red-950/20" : alert.type === "warning" ? "border-yellow-700 bg-yellow-950/20" : "border-green-700 bg-green-950/20"} ${checked ? "ring-2 ring-accent" : "hover:bg-foreground/5"}`}
                                >
                                  <input
                                    type="checkbox"
                                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                                    checked={checked}
                                    onChange={() => toggleFix(key)}
                                    aria-label={`Selecionar alerta: ${alert.title}`}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-foreground">
                                      {alert.title}
                                    </div>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      {alert.description}
                                    </p>
                                  </div>
                                </label>
                              );
                            })
                          ) : (
                            <div className="rounded-lg border-2 border-dashed border-border bg-secondary/20 p-4 text-center text-sm text-muted-foreground">
                              <div className="text-foreground font-medium">
                                Nenhum alerta salvo ainda
                              </div>
                              <p className="mt-1">
                                Rode a revisão automática para gerar alertas.
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg border border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
                          <div className="font-medium text-foreground">
                            Resumo
                          </div>
                          <p className="mt-2">
                            {
                              chapter.content.split(/\s+/).filter(Boolean)
                                .length
                            }{" "}
                            palavras
                          </p>
                          <p>{comments.length} comentário(s)</p>
                        </div>
                      </Card>

                      {referenceContexts.length ? (
                        <Card className="border border-border bg-card p-5">
                          <div className="font-medium text-foreground">
                            Capítulos-chave ativos
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

                      <Card className="space-y-3 border border-border bg-card p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="font-display text-lg text-foreground">
                            Memória de continuidade
                          </div>
                          <Badge
                            variant="secondary"
                            className={`${memoryDirty ? "bg-amber-500/15 text-amber-300" : ""} px-2 py-0.5 text-xs`}
                          >
                            {memoryDirty ? "alterações pendentes" : "salvo"}
                          </Badge>
                        </div>

                        <div className="space-y-2">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">
                              Resumo canônico
                            </label>
                            <Textarea
                              value={memorySummary}
                              onChange={e => setMemorySummary(e.target.value)}
                              className="min-h-[100px] resize-none bg-secondary"
                            />
                          </div>
                          {[
                            {
                              label: "Mudanças de estado",
                              hint: "uma por linha",
                              value: memoryStateChanges,
                              setter: setMemoryStateChanges,
                            },
                            {
                              label: "Fatos canônicos",
                              hint: "um por linha",
                              value: memoryCanonicalFacts,
                              setter: setMemoryCanonicalFacts,
                            },
                            {
                              label: "Pontas em aberto",
                              hint: "uma por linha",
                              value: memoryOpenLoops,
                              setter: setMemoryOpenLoops,
                            },
                            {
                              label: "Personagens impactados",
                              hint: "um por linha",
                              value: memoryImpactedCharacters,
                              setter: setMemoryImpactedCharacters,
                            },
                          ].map(({ label, hint, value, setter }) => (
                            <Collapsible
                              key={label}
                              defaultOpen={Boolean(value.trim())}
                            >
                              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors">
                                <span>
                                  {label}{" "}
                                  <span className="font-normal">({hint})</span>
                                  {value.trim()
                                    ? ` — ${value.trim().split("\n").filter(Boolean).length} item(ns)`
                                    : ""}
                                </span>
                                <ChevronDown className="h-3.5 w-3.5 transition-transform [[data-state=open]>&]:rotate-180" />
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <Textarea
                                  value={value}
                                  onChange={e => setter(e.target.value)}
                                  className="mt-1 min-h-[80px] resize-none bg-secondary"
                                />
                              </CollapsibleContent>
                            </Collapsible>
                          ))}
                        </div>

                        <div className="flex justify-end">
                          <Button
                            onClick={handleSaveMemory}
                            disabled={
                              saveMemoryMutation.isPending || !memoryDirty
                            }
                            variant="outline"
                          >
                            {saveMemoryMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="mr-2 h-4 w-4" />
                            )}
                            Salvar memória
                          </Button>
                        </div>
                      </Card>

                      <ExportChapter
                        chapterId={chapter.id}
                        chapterTitle={chapter.title}
                      />
                    </div>

                    <Card className="space-y-3 border border-border bg-card p-4">
                      <div className="font-medium text-foreground">
                        Comentários
                      </div>
                      <div className="space-y-3">
                        {comments.length ? (
                          comments.map((comment: any) => {
                            const key = `comment:${comment.id}`;
                            const checked = selectedFixes.has(key);
                            return (
                              <label
                                key={comment.id}
                                className={`flex gap-3 rounded-lg border-l-4 border p-4 cursor-pointer transition-colors ${comment.severity === "high" ? "border-l-red-500 bg-red-950/10" : comment.severity === "medium" ? "border-l-yellow-500 bg-yellow-950/10" : "border-l-green-500 bg-green-950/10"} ${checked ? "ring-2 ring-accent" : "hover:bg-foreground/5"}`}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                                  checked={checked}
                                  onChange={() => toggleFix(key)}
                                  aria-label={`Selecionar comentário linha ${comment.line}`}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <span>Linha {comment.line}</span>
                                    <span className="rounded-full border border-border/70 bg-foreground/8 px-2 py-0.5 text-foreground/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
                                      {comment.type}
                                    </span>
                                    <span className="rounded-full border border-border/70 bg-foreground/8 px-2 py-0.5 text-foreground/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
                                      {comment.severity}
                                    </span>
                                  </div>
                                  <p className="mt-3 text-sm text-foreground">
                                    {comment.text}
                                  </p>
                                  {comment.excerpt ? (
                                    <blockquote className="mt-3 rounded-md border border-border/70 bg-secondary/45 px-3 py-2 text-sm leading-6 text-foreground/80">
                                      {comment.excerpt}
                                    </blockquote>
                                  ) : null}
                                  {Array.isArray(comment.sequenceEvidence) &&
                                  comment.sequenceEvidence.length ? (
                                    <div className="mt-2 space-y-2">
                                      {comment.sequenceEvidence.map(
                                        (excerpt: string, idx: number) => (
                                          <blockquote
                                            key={idx}
                                            className="rounded-md border border-border/60 bg-secondary/25 px-3 py-2 text-xs leading-5 text-muted-foreground"
                                          >
                                            {excerpt}
                                          </blockquote>
                                        )
                                      )}
                                    </div>
                                  ) : null}
                                  <p className="mt-2 text-sm text-muted-foreground">
                                    <span className="font-medium text-foreground">
                                      Sugestão:
                                    </span>{" "}
                                    {comment.suggestion}
                                  </p>
                                </div>
                              </label>
                            );
                          })
                        ) : (
                          <div className="rounded-lg border-2 border-dashed border-border bg-secondary/20 p-4 text-center text-sm text-muted-foreground">
                            <div className="text-foreground font-medium">
                              Ainda não há comentários
                            </div>
                            <p className="mt-1">
                              Rode a revisão automática para gerar análise de
                              qualidade.
                            </p>
                          </div>
                        )}
                      </div>
                    </Card>
                  </div>

                  <Card className="border border-border bg-card p-4">
                    <div className="font-medium text-foreground">
                      Texto do capítulo
                    </div>
                    <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto rounded-lg border border-border bg-secondary/50 p-4">
                      {chapter.content
                        .split(/\n+/)
                        .filter(Boolean)
                        .map((paragraph: string, idx: number) => (
                          <p key={idx} className="leading-7 text-foreground">
                            {paragraph}
                          </p>
                        ))}
                    </div>
                  </Card>
                </>
              )
            ) : (
              <Card className="border-2 border-dashed border-border bg-secondary/20 p-8 text-center">
                <div className="text-foreground font-medium text-lg">
                  Nenhum capítulo selecionado
                </div>
                <p className="mt-2 text-muted-foreground">
                  Escolha um capítulo na coluna da esquerda para começar a
                  revisar.
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </WorkStatusGate>
  );
}
