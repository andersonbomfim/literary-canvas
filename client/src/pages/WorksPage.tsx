import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useActiveWork } from "@/_core/hooks/useActiveWork";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageSkeleton } from "@/components/ui/feedback-state";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  PencilLine,
  Plus,
  Target,
  Trash2,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterChipGroup, FilterToolbar } from "@/components/FilterToolbar";
import { matchesFilterQuery, toggleSetValue } from "@/lib/filtering";

type WorkStatus =
  | "planning"
  | "in_progress"
  | "paused"
  | "completed"
  | "archived";

type WorkFormState = {
  title: string;
  description: string;
  genre: string;
  status: WorkStatus;
};

const initialForm: WorkFormState = {
  title: "",
  description: "",
  genre: "",
  status: "planning",
};

const statusLabels: Record<WorkStatus, string> = {
  planning: "Planejamento",
  in_progress: "Em andamento",
  paused: "Pausada",
  completed: "Concluída",
  archived: "Arquivada",
};

const statusTone: Record<WorkStatus, string> = {
  planning: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  in_progress: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  paused: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  completed: "bg-violet-500/10 text-violet-500 border-violet-500/20",
  archived: "bg-foreground/8 text-foreground/75 border-border/70",
};
const productionStatuses = new Set<WorkStatus>(["planning", "in_progress"]);

export default function WorksPage() {
  const utils = trpc.useUtils();
  const {
    activeWorkId,
    activeWork,
    works,
    setActiveWorkId,
    refetch: refetchWorks,
    isLoading,
  } = useActiveWork();
  const listQuery = trpc.works.list.useQuery(undefined, { staleTime: 0 });
  const trashQuery = trpc.works.listTrash.useQuery();
  const billingQuery = trpc.billing.summary.useQuery();
  const [editingWorkId, setEditingWorkId] = useState<number | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [pendingSoftDelete, setPendingSoftDelete] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [workSearch, setWorkSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<Set<WorkStatus>>(
    () => new Set()
  );
  const [form, setForm] = useState<WorkFormState>(initialForm);
  const walletCredits =
    billingQuery.data?.data.credits?.wallet.balance ??
    billingQuery.data?.data.wallet.balance ??
    "...";

  const invalidateAll = () =>
    Promise.all([
      utils.works.list.invalidate(),
      utils.works.listTrash.invalidate(),
      refetchWorks(),
    ]);

  const createMutation = trpc.works.create.useMutation({
    onSuccess: async result => {
      toast.success("Obra criada com sucesso.");
      await invalidateAll();
      await billingQuery.refetch();
      setActiveWorkId(result.data.id);
      setEditingWorkId(null);
      setForm(initialForm);
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const updateMutation = trpc.works.update.useMutation({
    onSuccess: async (_, variables) => {
      toast.success("Obra atualizada.");
      await invalidateAll();
      if (
        variables.status &&
        productionStatuses.has(variables.status as WorkStatus)
      ) {
        setActiveWorkId(variables.workId);
      } else if (variables.status && activeWorkId === variables.workId) {
        setActiveWorkId(null);
      }
      setEditingWorkId(null);
      setForm(initialForm);
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const setDefaultMutation = trpc.works.setDefault.useMutation({
    onSuccess: async result => {
      toast.success("Obra padrão atualizada.");
      await invalidateAll();
      setActiveWorkId(result.data.id);
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const softDeleteMutation = trpc.works.softDelete.useMutation({
    onSuccess: async () => {
      toast.success("Obra movida para a lixeira.");
      await invalidateAll();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const restoreMutation = trpc.works.restore.useMutation({
    onSuccess: async () => {
      toast.success("Obra restaurada.");
      await invalidateAll();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const permanentDeleteMutation = trpc.works.permanentDelete.useMutation({
    onSuccess: async () => {
      toast.success("Obra excluída permanentemente.");
      setConfirmDeleteId(null);
      await invalidateAll();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const defaultWorkId = listQuery.data?.defaultWorkId ?? null;
  const totalWorks = works.length;
  const trashedWorks = trashQuery.data?.data || [];
  const statusFilterOptions = useMemo(
    () =>
      Object.entries(statusLabels).map(([value, label]) => ({
        value,
        label,
        count: works.filter(work => work.status === value).length,
      })),
    [works]
  );
  const filteredWorks = useMemo(() => {
    return works.filter(work => {
      const matchesStatus =
        statusFilters.size === 0 || statusFilters.has(work.status);
      const matchesSearch = matchesFilterQuery(workSearch, [
        work.title,
        work.genre,
        work.description,
        statusLabels[work.status],
      ]);
      return matchesStatus && matchesSearch;
    });
  }, [statusFilters, workSearch, works]);
  const toggleStatusFilter = (status: string) => {
    setStatusFilters(current =>
      toggleSetValue(current, status as WorkStatus)
    );
  };

  useEffect(() => {
    if (!editingWorkId) return;
    const work = works.find(item => item.id === editingWorkId);
    if (!work) return;
    setForm({
      title: work.title,
      description: work.description || "",
      genre: work.genre || "",
      status: work.status,
    });
  }, [editingWorkId, works]);

  const handleSubmit = () => {
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      genre: form.genre.trim() || undefined,
      status: form.status,
    };

    if (!payload.title) {
      toast.error("Informe um título para a obra.");
      return;
    }

    if (editingWorkId) {
      updateMutation.mutate({ workId: editingWorkId, ...payload });
      return;
    }

    createMutation.mutate(payload);
  };

  const startEditing = (workId: number) => {
    setEditingWorkId(workId);
  };

  const resetForm = () => {
    setEditingWorkId(null);
    setForm(initialForm);
  };

  const performSoftDelete = async () => {
    if (!pendingSoftDelete) return;
    await softDeleteMutation.mutateAsync({ workId: pendingSoftDelete.id });
    setPendingSoftDelete(null);
  };

  if (isLoading) {
    return <PageSkeleton className="p-0" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge
          variant="secondary"
          className="bg-blue-500/15 px-3 py-1 text-blue-400"
        >
          {totalWorks} obra(s)
        </Badge>
        <Badge
          variant="secondary"
          className="bg-emerald-500/15 px-3 py-1 text-emerald-400"
        >
          {activeWork?.title || "Nenhuma ativa"}
        </Badge>
        <Badge
          variant="secondary"
          className="bg-accent/10 px-3 py-1 text-accent"
        >
          {typeof walletCredits === "number"
            ? walletCredits.toLocaleString("pt-BR")
            : walletCredits}{" "}
          créditos flexíveis
        </Badge>
      </div>

      <FilterToolbar
        searchValue={workSearch}
        onSearchChange={setWorkSearch}
        searchPlaceholder="Buscar obra por título, gênero, descrição ou status"
        resultCount={filteredWorks.length}
        totalCount={works.length}
        resultLabel={filteredWorks.length === 1 ? "obra" : "obras"}
        filterCount={statusFilters.size}
        hasActiveFilters={Boolean(workSearch.trim() || statusFilters.size)}
        activeFiltersLabel={
          statusFilters.size || workSearch.trim()
            ? `${statusFilters.size} status selecionado(s)${
                workSearch.trim() ? ` · busca "${workSearch.trim()}"` : ""
              }`
            : "Mostrando todas as obras fora da lixeira."
        }
        onClear={() => {
          setWorkSearch("");
          setStatusFilters(new Set());
        }}
      >
        <FilterChipGroup
          label="Status"
          allLabel="Todos"
          allCount={works.length}
          selectedValues={Array.from(statusFilters)}
          onToggle={toggleStatusFilter}
          onClear={() => setStatusFilters(new Set<WorkStatus>())}
          options={statusFilterOptions}
        />
      </FilterToolbar>

      <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border border-border bg-card">
          <CardHeader>
            <CardTitle className="font-display text-xl text-foreground">
              Suas obras
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {filteredWorks.length ? (
              filteredWorks.map(work => {
                const isProduction = productionStatuses.has(work.status);
                const isActive = isProduction && work.id === activeWorkId;
                const isDefault = work.id === defaultWorkId;
                return (
                  <div
                    key={work.id}
                    className={`rounded-lg border p-4 transition-colors ${isActive ? "border-accent bg-accent/5" : "border-border bg-secondary/30"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-lg font-semibold text-foreground">
                            {work.title}
                          </div>
                          <Badge className={statusTone[work.status]}>
                            {statusLabels[work.status]}
                          </Badge>
                          {isDefault ? (
                            <Badge variant="outline">Padrão</Badge>
                          ) : null}
                          {isActive ? (
                            <Badge variant="secondary">Ativa</Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span>{work.genre || "Gênero não informado"}</span>
                          <span>
                            Atualizada{" "}
                            {formatDistanceToNow(new Date(work.updatedAt), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </span>
                        </div>
                        <p className="max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">
                          {work.description ||
                            "Sem descrição ainda. Use este campo para fixar a proposta da obra, tom, premissa e limites canônicos."}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {isProduction ? (
                          <Button
                            variant={isActive ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => setActiveWorkId(work.id)}
                          >
                            <Target className="mr-2 h-4 w-4" />
                            {isActive ? "Ativa" : "Ativar"}
                          </Button>
                        ) : work.status === "paused" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              updateMutation.mutate({
                                workId: work.id,
                                status: "in_progress",
                              })
                            }
                            disabled={updateMutation.isPending}
                          >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Retomar
                          </Button>
                        ) : null}
                        {!isDefault ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setDefaultMutation.mutate({ workId: work.id })
                            }
                            disabled={setDefaultMutation.isPending}
                          >
                            Tornar padrão
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEditing(work.id)}
                        >
                          <PencilLine className="mr-2 h-4 w-4" />
                          Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={() =>
                            setPendingSoftDelete({
                              id: work.id,
                              title: work.title,
                            })
                          }
                          disabled={softDeleteMutation.isPending}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Excluir
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : workSearch.trim() || statusFilters.size ? (
              <div className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm text-muted-foreground">
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
            ) : null}
          </CardContent>
        </Card>

        <Card className="border border-border bg-card">
          <CardHeader>
            <CardTitle className="font-display text-xl text-foreground">
              {editingWorkId ? "Editar obra" : "Nova obra"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Título
              </label>
              <Input
                value={form.title}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Ex: A Supremacia da Aura"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Gênero
              </label>
              <Input
                value={form.genre}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    genre: event.target.value,
                  }))
                }
                placeholder="Ex: fantasia sombria, romance histórico, suspense"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Status
              </label>
              <select
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none"
                value={form.status}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    status: event.target.value as WorkStatus,
                  }))
                }
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Descrição da obra
              </label>
              <Textarea
                rows={8}
                value={form.description}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Fixe a proposta da obra, conflitos, tom, premissa, promessas narrativas e limites canônicos."
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleSubmit}
                disabled={
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  !form.title.trim()
                }
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {editingWorkId ? "Salvar ajustes" : "Criar obra"}
              </Button>
              {editingWorkId ? (
                <Button variant="outline" onClick={resetForm}>
                  Cancelar edição
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lixeira */}
      <Card className="border border-border bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-display text-xl text-foreground flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-muted-foreground" />
              Lixeira
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTrash(prev => !prev)}
            >
              {showTrash ? "Esconder" : `Ver (${trashedWorks.length})`}
            </Button>
          </div>
        </CardHeader>
        {showTrash ? (
          <CardContent className="space-y-3">
            {trashedWorks.length ? (
              trashedWorks.map((work: any) => (
                <div
                  key={work.id}
                  className="rounded-lg border border-border bg-secondary/20 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-foreground/70">
                        {work.title}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {work.genre || "Sem gênero"} · Excluída{" "}
                        {formatDistanceToNow(new Date(work.deletedAt), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          restoreMutation.mutate({ workId: work.id })
                        }
                        disabled={restoreMutation.isPending}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Restaurar
                      </Button>
                      {confirmDeleteId === work.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-400 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Confirmar
                          </span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                              permanentDeleteMutation.mutate({
                                workId: work.id,
                              })
                            }
                            disabled={permanentDeleteMutation.isPending}
                          >
                            Excluir definitivo
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Não
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-400 hover:bg-red-500/10"
                          onClick={() => setConfirmDeleteId(work.id)}
                        >
                          Excluir permanente
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="Nenhuma obra na lixeira"
                description="Obras removidas aparecem aqui antes da exclusão definitiva."
              />
            )}
          </CardContent>
        ) : null}
      </Card>

      <ConfirmDialog
        open={pendingSoftDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingSoftDelete(null);
        }}
        title={
          pendingSoftDelete
            ? `Mover "${pendingSoftDelete.title}" para a lixeira?`
            : "Mover obra para a lixeira?"
        }
        description="A obra ficará na lixeira com rascunhos, capítulos, personagens, perfil, timeline, auditorias e melhorias isolados. Nada dela alimenta a IA até ser restaurada."
        confirmLabel="Mover para a lixeira"
        destructive
        onConfirm={performSoftDelete}
      />
    </div>
  );
}
