import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Layers,
  Library,
  Loader2,
  Pause,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useActiveWork } from "@/_core/hooks/useActiveWork";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type SeriesStatus = "active" | "paused" | "archived";
type WorkStatus =
  | "planning"
  | "in_progress"
  | "paused"
  | "completed"
  | "archived";

type SeriesForm = {
  title: string;
  description: string;
  genre: string;
  universeNotes: string;
  status: SeriesStatus;
};

type NewBookForm = {
  title: string;
  subtitle: string;
  genre: string;
  description: string;
  bookNumber: string;
};

const emptySeriesForm: SeriesForm = {
  title: "",
  description: "",
  genre: "",
  universeNotes: "",
  status: "active",
};

const emptyNewBookForm: NewBookForm = {
  title: "",
  subtitle: "",
  genre: "",
  description: "",
  bookNumber: "",
};

const statusLabel: Record<SeriesStatus, string> = {
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada",
};

const workStatusLabel: Record<WorkStatus, string> = {
  planning: "Planejamento",
  in_progress: "Em escrita",
  paused: "Pausada",
  completed: "Concluída",
  archived: "Arquivada",
};

const libraryStatusLabel: Record<string, string> = {
  canonical: "Canônico",
  needs_review: "Revisar",
  conflict: "Conflito",
};

const libraryStatusClass: Record<string, string> = {
  canonical: "bg-emerald-500/15 text-emerald-300",
  needs_review: "bg-blue-500/15 text-blue-300",
  conflict: "bg-red-500/15 text-red-300",
};

function asOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export default function SeriesPage() {
  const utils = trpc.useUtils();
  const {
    works,
    activeWorkId,
    setActiveWorkId,
    refetch: refetchWorks,
  } = useActiveWork();
  const seriesQuery = trpc.series.list.useQuery(undefined, { staleTime: 0 });
  const [seriesForm, setSeriesForm] = useState<SeriesForm>(emptySeriesForm);
  const [editingSeriesId, setEditingSeriesId] = useState<number | null>(null);
  const [linkWorkIdBySeries, setLinkWorkIdBySeries] = useState<
    Record<number, string>
  >({});
  const [linkNumberBySeries, setLinkNumberBySeries] = useState<
    Record<number, string>
  >({});
  const [newBookBySeries, setNewBookBySeries] = useState<
    Record<number, NewBookForm>
  >({});

  const refresh = async () => {
    await Promise.all([
      utils.series.list.invalidate(),
      utils.works.list.invalidate(),
      refetchWorks(),
    ]);
  };

  const createSeriesMutation = trpc.series.create.useMutation({
    onSuccess: async () => {
      toast.success("Série criada.");
      setSeriesForm(emptySeriesForm);
      await refresh();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const updateSeriesMutation = trpc.series.update.useMutation({
    onSuccess: async () => {
      toast.success("Série atualizada.");
      setSeriesForm(emptySeriesForm);
      setEditingSeriesId(null);
      await refresh();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const deleteSeriesMutation = trpc.series.delete.useMutation({
    onSuccess: async () => {
      toast.success("Série removida. Os livros foram mantidos.");
      await refresh();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const updateWorkMutation = trpc.works.update.useMutation({
    onSuccess: async () => {
      toast.success("Livro atualizado na série.");
      await refresh();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const createWorkMutation = trpc.works.create.useMutation({
    onSuccess: async result => {
      toast.success("Livro criado dentro da série.");
      setActiveWorkId(result.data.id);
      await refresh();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const generateLibraryMutation = trpc.series.generateLibrary.useMutation({
    onSuccess: async () => {
      toast.success("Biblioteca da serie atualizada.");
      await refresh();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const seriesList = seriesQuery.data?.data ?? [];

  const linkedWorkIds = useMemo(() => {
    return new Set(
      seriesList.flatMap((series: any) =>
        (series.works ?? []).map((work: any) => work.id)
      )
    );
  }, [seriesList]);

  const unlinkedWorks = works.filter(work => !linkedWorkIds.has(work.id));

  const submitSeries = () => {
    const payload = {
      title: seriesForm.title.trim(),
      description: asOptionalText(seriesForm.description),
      genre: asOptionalText(seriesForm.genre),
      universeNotes: asOptionalText(seriesForm.universeNotes),
      status: seriesForm.status,
    };

    if (!payload.title) {
      toast.error("Informe o nome da série.");
      return;
    }

    if (editingSeriesId) {
      updateSeriesMutation.mutate({ seriesId: editingSeriesId, ...payload });
      return;
    }

    createSeriesMutation.mutate(payload);
  };

  const startEditSeries = (series: any) => {
    setEditingSeriesId(series.id);
    setSeriesForm({
      title: series.title,
      description: series.description ?? "",
      genre: series.genre ?? "",
      universeNotes: series.universeNotes ?? "",
      status: series.status ?? "active",
    });
  };

  const linkWork = (seriesId: number) => {
    const workId = Number(linkWorkIdBySeries[seriesId] ?? "");
    if (!workId) {
      toast.error("Escolha uma obra para vincular.");
      return;
    }

    updateWorkMutation.mutate({
      workId,
      seriesId,
      bookNumber: asOptionalNumber(linkNumberBySeries[seriesId] ?? "") ?? null,
    });
    setLinkWorkIdBySeries(prev => ({ ...prev, [seriesId]: "" }));
    setLinkNumberBySeries(prev => ({ ...prev, [seriesId]: "" }));
  };

  const detachWork = (workId: number) => {
    updateWorkMutation.mutate({ workId, seriesId: null, bookNumber: null });
  };

  const createBookInSeries = (
    seriesId: number,
    fallbackGenre: string | null
  ) => {
    const form = newBookBySeries[seriesId] ?? emptyNewBookForm;
    const title = form.title.trim();
    if (!title) {
      toast.error("Informe o título do livro.");
      return;
    }

    createWorkMutation.mutate({
      title,
      subtitle: asOptionalText(form.subtitle),
      genre: asOptionalText(form.genre) ?? fallbackGenre ?? undefined,
      description: asOptionalText(form.description),
      status: "planning",
      seriesId,
      bookNumber: asOptionalNumber(form.bookNumber) ?? null,
    });
    setNewBookBySeries(prev => ({ ...prev, [seriesId]: emptyNewBookForm }));
  };

  if (seriesQuery.isLoading) {
    return (
      <div className="flex h-80 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-border/80 bg-card/88">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-accent">
                  <Layers className="h-4 w-4" />
                  Universo compartilhado
                </div>
                <CardTitle className="mt-2 font-display text-2xl">
                  {editingSeriesId ? "Editar série" : "Criar série"}
                </CardTitle>
              </div>
              {editingSeriesId ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingSeriesId(null);
                    setSeriesForm(emptySeriesForm);
                  }}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={seriesForm.title}
              onChange={event =>
                setSeriesForm(prev => ({ ...prev, title: event.target.value }))
              }
              placeholder="Nome da série ou universo"
            />
            <Input
              value={seriesForm.genre}
              onChange={event =>
                setSeriesForm(prev => ({ ...prev, genre: event.target.value }))
              }
              placeholder="Gênero macro"
            />
            <Textarea
              value={seriesForm.description}
              onChange={event =>
                setSeriesForm(prev => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              placeholder="Premissa geral: o que une estes livros?"
              className="min-h-24"
            />
            <Textarea
              value={seriesForm.universeNotes}
              onChange={event =>
                setSeriesForm(prev => ({
                  ...prev,
                  universeNotes: event.target.value,
                }))
              }
              placeholder="Regras do universo, cronologia geral, poderes, instituições, limites e consequências entre livros"
              className="min-h-28"
            />
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <select
                value={seriesForm.status}
                onChange={event =>
                  setSeriesForm(prev => ({
                    ...prev,
                    status: event.target.value as SeriesStatus,
                  }))
                }
                className="h-9 rounded-md border border-input bg-background/60 px-3 text-sm"
              >
                <option value="active">Ativa para contexto da IA</option>
                <option value="paused">Pausada</option>
                <option value="archived">Arquivada</option>
              </select>
              <Button
                onClick={submitSeries}
                disabled={
                  createSeriesMutation.isPending ||
                  updateSeriesMutation.isPending
                }
              >
                {createSeriesMutation.isPending ||
                updateSeriesMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Save />
                )}
                {editingSeriesId ? "Salvar série" : "Criar série"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/80">
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Como isso funciona na Escrita
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
            <p>
              A série vira uma camada de memória acima da obra atual. Quando
              você gera um capítulo, a IA recebe os livros conectados,
              personagens recorrentes, biblioteca canônica, eventos e regras do
              universo.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-background/45 p-3">
                <div className="font-semibold text-foreground">
                  Livro pausado
                </div>
                <div>Não entra no contexto.</div>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/45 p-3">
                <div className="font-semibold text-foreground">
                  Série pausada
                </div>
                <div>Desliga a memória compartilhada.</div>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/45 p-3">
                <div className="font-semibold text-foreground">Livro ativo</div>
                <div>Usa a série sem misturar lixeira.</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-accent">
              Séries cadastradas
            </div>
            <h2 className="font-display text-2xl text-foreground">
              Livros conectados
            </h2>
          </div>
          <Badge
            variant="secondary"
            className="bg-blue-500/15 px-3 py-1 text-blue-300"
          >
            {seriesList.length} série(s)
          </Badge>
        </div>

        {seriesList.length === 0 ? (
          <Card className="border-dashed border-border/80 bg-card/70">
            <CardContent className="py-12 text-center text-muted-foreground">
              Crie uma série para conectar livros do mesmo universo e alimentar
              a IA com continuidade entre volumes.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {seriesList.map((series: any) => {
              const newBookForm =
                newBookBySeries[series.id] ?? emptyNewBookForm;
              const worksInSeries = series.works ?? [];
              const seriesLibrary = series.library ?? [];
              const canUseSeriesLibrary = worksInSeries.length >= 2;

              return (
                <Card key={series.id} className="border-border/80 bg-card/88">
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="font-display text-2xl">
                            {series.title}
                          </CardTitle>
                          <Badge
                            className={
                              series.status === "active"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : series.status === "paused"
                                  ? "bg-amber-500/15 text-amber-300"
                                  : "bg-zinc-500/20 text-zinc-300"
                            }
                          >
                            {statusLabel[series.status as SeriesStatus] ??
                              series.status}
                          </Badge>
                          <Badge variant="secondary">
                            {worksInSeries.length} livro(s)
                          </Badge>
                        </div>
                        <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
                          {series.description || "Sem premissa geral ainda."}
                        </p>
                        {series.universeNotes ? (
                          <p className="max-w-4xl rounded-lg border border-border/70 bg-background/35 p-3 text-sm leading-6 text-muted-foreground">
                            {series.universeNotes}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => startEditSeries(series)}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            updateSeriesMutation.mutate({
                              seriesId: series.id,
                              status:
                                series.status === "active"
                                  ? "paused"
                                  : "active",
                            })
                          }
                        >
                          {series.status === "active" ? (
                            <Pause />
                          ) : (
                            <CheckCircle2 />
                          )}
                          {series.status === "active" ? "Pausar" : "Ativar"}
                        </Button>
                        <Button
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={() =>
                            deleteSeriesMutation.mutate({ seriesId: series.id })
                          }
                        >
                          <Trash2 />
                          Remover série
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3">
                      {worksInSeries.length ? (
                        worksInSeries.map((work: any) => (
                          <div
                            key={work.id}
                            className={`group grid gap-3 rounded-lg border border-border/70 bg-background/45 p-3 transition-all duration-150 hover:border-accent/35 hover:bg-background/65 md:grid-cols-[auto_1fr_auto] md:items-center ${activeWorkId === work.id ? "ring-1 ring-accent/45" : ""}`}
                          >
                            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border/70 bg-card/80 font-display text-lg">
                              {work.bookNumber ?? "??"}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate font-semibold text-foreground">
                                  {work.title}
                                </div>
                                {work.subtitle ? (
                                  <span className="text-muted-foreground">
                                    - {work.subtitle}
                                  </span>
                                ) : null}
                                <Badge
                                  variant="secondary"
                                  className="bg-secondary/80"
                                >
                                  {workStatusLabel[work.status as WorkStatus] ??
                                    work.status}
                                </Badge>
                              </div>
                              <p className="line-clamp-2 text-sm text-muted-foreground">
                                {work.description ||
                                  work.genre ||
                                  "Sem descrição cadastrada."}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setActiveWorkId(work.id)}
                              >
                                <BookOpen />
                                Ativar
                              </Button>
                              <Button variant="outline" size="sm" asChild>
                                <Link href="/works">Abrir obra</Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => detachWork(work.id)}
                              >
                                <Unlink />
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-lg border border-dashed border-border/80 p-5 text-sm text-muted-foreground">
                          Nenhum livro vinculado a esta série.
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-border/70 bg-background/35 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-accent">
                            <Library className="h-4 w-4" />
                            Biblioteca da Série
                          </div>
                          <div className="mt-1 text-sm leading-6 text-muted-foreground">
                            {canUseSeriesLibrary
                              ? "A IA consolida personagens, eventos, lugares, regras e conflitos dos livros conectados."
                              : "A biblioteca compartilhada aparece quando esta série tiver pelo menos dois livros conectados."}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">
                            {seriesLibrary.length} item(ns)
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              !canUseSeriesLibrary ||
                              generateLibraryMutation.isPending
                            }
                            onClick={() =>
                              generateLibraryMutation.mutate({
                                seriesId: series.id,
                              })
                            }
                          >
                            {generateLibraryMutation.isPending ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Sparkles />
                            )}
                            {seriesLibrary.length
                              ? "Atualizar"
                              : "Gerar biblioteca"}
                          </Button>
                        </div>
                      </div>

                      {!canUseSeriesLibrary ? (
                        <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground">
                          <AlertTriangle className="h-4 w-4 text-amber-300" />
                          Conecte outro livro deste universo para liberar a
                          consolidação.
                        </div>
                      ) : seriesLibrary.length ? (
                        <div className="scrollbar-hidden mt-4 grid max-h-96 gap-3 overflow-y-auto pr-1 lg:grid-cols-2">
                          {seriesLibrary.map((entry: any) => (
                            <div
                              key={entry.id}
                              className="rounded-lg border border-border/70 bg-card/70 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-foreground">
                                    {entry.name}
                                  </div>
                                  <div className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-accent">
                                    {entry.type}
                                  </div>
                                </div>
                                <Badge
                                  className={
                                    libraryStatusClass[entry.status] ??
                                    "bg-secondary text-muted-foreground"
                                  }
                                >
                                  {libraryStatusLabel[entry.status] ??
                                    entry.status}
                                </Badge>
                              </div>
                              <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                                {entry.description ||
                                  "Sem descrição consolidada."}
                              </p>
                              {entry.details ? (
                                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground/85">
                                  {entry.details}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
                          Nenhuma biblioteca consolidada ainda. Gere uma versão
                          quando os livros já estiverem conectados.
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="rounded-lg border border-border/70 bg-background/35 p-4">
                        <div className="mb-3 font-semibold text-foreground">
                          Vincular obra existente
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
                          <select
                            value={linkWorkIdBySeries[series.id] ?? ""}
                            onChange={event =>
                              setLinkWorkIdBySeries(prev => ({
                                ...prev,
                                [series.id]: event.target.value,
                              }))
                            }
                            className="h-9 rounded-md border border-input bg-background/60 px-3 text-sm"
                          >
                            <option value="">Escolha uma obra</option>
                            {unlinkedWorks.map(work => (
                              <option key={work.id} value={work.id}>
                                {work.title}
                              </option>
                            ))}
                          </select>
                          <Input
                            value={linkNumberBySeries[series.id] ?? ""}
                            onChange={event =>
                              setLinkNumberBySeries(prev => ({
                                ...prev,
                                [series.id]: event.target.value,
                              }))
                            }
                            placeholder="Livro nº"
                          />
                          <Button onClick={() => linkWork(series.id)}>
                            Vincular
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/70 bg-background/35 p-4">
                        <div className="mb-3 font-semibold text-foreground">
                          Novo livro nesta série
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                          <Input
                            value={newBookForm.title}
                            onChange={event =>
                              setNewBookBySeries(prev => ({
                                ...prev,
                                [series.id]: {
                                  ...newBookForm,
                                  title: event.target.value,
                                },
                              }))
                            }
                            placeholder="Título"
                          />
                          <Input
                            value={newBookForm.bookNumber}
                            onChange={event =>
                              setNewBookBySeries(prev => ({
                                ...prev,
                                [series.id]: {
                                  ...newBookForm,
                                  bookNumber: event.target.value,
                                },
                              }))
                            }
                            placeholder="Livro nº"
                          />
                          <Input
                            value={newBookForm.subtitle}
                            onChange={event =>
                              setNewBookBySeries(prev => ({
                                ...prev,
                                [series.id]: {
                                  ...newBookForm,
                                  subtitle: event.target.value,
                                },
                              }))
                            }
                            placeholder="Subtítulo"
                          />
                          <Input
                            value={newBookForm.genre}
                            onChange={event =>
                              setNewBookBySeries(prev => ({
                                ...prev,
                                [series.id]: {
                                  ...newBookForm,
                                  genre: event.target.value,
                                },
                              }))
                            }
                            placeholder="Gênero"
                          />
                          <Textarea
                            value={newBookForm.description}
                            onChange={event =>
                              setNewBookBySeries(prev => ({
                                ...prev,
                                [series.id]: {
                                  ...newBookForm,
                                  description: event.target.value,
                                },
                              }))
                            }
                            placeholder="Premissa deste volume"
                            className="min-h-20 sm:col-span-2"
                          />
                          <Button
                            className="sm:col-span-2"
                            onClick={() =>
                              createBookInSeries(series.id, series.genre)
                            }
                          >
                            <Plus />
                            Criar livro na série
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
