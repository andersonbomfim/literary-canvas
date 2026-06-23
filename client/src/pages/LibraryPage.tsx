import { FormEvent, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import { FilterChipGroup, FilterToolbar } from "@/components/FilterToolbar";
import { toggleSetValue } from "@/lib/filtering";

const types = [
  { value: "all", label: "Tudo" },
  { value: "event", label: "Eventos" },
  { value: "location", label: "Lugares" },
  { value: "aura", label: "Poderes/Regras" },
  { value: "society", label: "Facções/Instituições" },
] as const;

const typePlaceholders: Record<
  string,
  { description: string; details: string }
> = {
  event: {
    description: "O que aconteceu, em uma frase limpa.",
    details:
      "Consequências, personagens envolvidos, data, lugar, desdobramentos...",
  },
  location: {
    description: "O que é esse lugar e por que ele importa.",
    details:
      "Atmosfera, localização, regras internas, usos narrativos, detalhes concretos...",
  },
  aura: {
    description: "Regra de poder, fenômeno, tecnologia ou força do universo.",
    details:
      "Funcionamento, limitações, custo, exceções, riscos, exemplos práticos...",
  },
  society: {
    description: "Instituição, família, facção, governo ou estrutura social.",
    details:
      "Hierarquia, função, histórico, conflitos, alianças, inimigos e relações com outros núcleos...",
  },
};

export default function LibraryPage() {
  const [activeType, setActiveType] =
    useState<(typeof types)[number]["value"]>("all");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<Set<string>>(
    () => new Set()
  );
  const [formData, setFormData] = useState({
    type: "event" as "event" | "location" | "aura" | "society",
    name: "",
    description: "",
    details: "",
    status: "in_development" as
      | "canonical"
      | "in_development"
      | "hypothesis"
      | "discarded",
  });

  const listQuery = trpc.library.list.useQuery({
    type: activeType === "all" ? undefined : activeType,
  });
  const searchQuery = trpc.search.searchLibrary.useQuery(
    {
      query: submittedSearch || "xx",
      type: activeType === "all" ? undefined : (activeType as any),
      limit: 20,
    },
    { enabled: submittedSearch.trim().length >= 2 }
  );

  const createMutation = trpc.library.create.useMutation({
    onSuccess: async () => {
      toast.success("Entrada criada.");
      setFormData({
        type: "event",
        name: "",
        description: "",
        details: "",
        status: "in_development",
      });
      await listQuery.refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const visibleEntries = useMemo(() => {
    const source =
      submittedSearch.trim().length >= 2
        ? searchQuery.data?.results || []
        : listQuery.data?.data || [];
    return source.filter(
      (entry: any) =>
        entry.type !== "character" &&
        (statusFilters.size === 0 || statusFilters.has(entry.status))
    );
  }, [submittedSearch, searchQuery.data, listQuery.data, statusFilters]);

  const groupedCounts = useMemo(() => {
    const source = (listQuery.data?.data || []).filter(
      (entry: any) => entry.type !== "character"
    );
    return {
      total: source.length,
      event: source.filter((entry: any) => entry.type === "event").length,
      location: source.filter((entry: any) => entry.type === "location").length,
      aura: source.filter((entry: any) => entry.type === "aura").length,
      society: source.filter((entry: any) => entry.type === "society").length,
    };
  }, [listQuery.data]);

  const statusCounts = useMemo(() => {
    const source = (listQuery.data?.data || []).filter(
      (entry: any) => entry.type !== "character"
    );
    return {
      canonical: source.filter((entry: any) => entry.status === "canonical")
        .length,
      in_development: source.filter(
        (entry: any) => entry.status === "in_development"
      ).length,
      hypothesis: source.filter((entry: any) => entry.status === "hypothesis")
        .length,
      discarded: source.filter((entry: any) => entry.status === "discarded")
        .length,
    };
  }, [listQuery.data]);

  const typeFilterOptions = types.filter(type => type.value !== "all");
  const statusFilterOptions = [
    { value: "canonical", label: "Canônico", count: statusCounts.canonical },
    {
      value: "in_development",
      label: "Em desenvolvimento",
      count: statusCounts.in_development,
    },
    { value: "hypothesis", label: "Hipótese", count: statusCounts.hypothesis },
    { value: "discarded", label: "Descartado", count: statusCounts.discarded },
  ];

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório.");
      return;
    }
    await createMutation.mutateAsync({
      ...formData,
      name: formData.name.trim(),
    });
  };

  const activePlaceholder = typePlaceholders[formData.type];

  return (
    <div className="space-y-4">
      <Card className="border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-accent">
              Arquivo canônico
            </div>
            <h2 className="mt-2 font-display text-2xl text-foreground">
              Biblioteca da obra
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Guarde aqui informações que já podem ser consultadas pela escrita:
              eventos, lugares, regras de poder, facções, instituições e objetos
              narrativos. Documento bruto entra em Obras; aqui fica o
              que já virou registro organizado.
            </p>
          </div>
          <Badge
            variant="secondary"
            className="bg-emerald-500/15 px-3 py-1 text-emerald-300"
          >
            {groupedCounts.total} registro(s)
          </Badge>
        </div>
      </Card>

      <FilterToolbar
        searchValue={search}
        onSearchChange={value => {
          setSearch(value);
          setSubmittedSearch(value.trim());
        }}
        searchPlaceholder="Buscar nome, descrição, detalhe ou trecho"
        resultCount={visibleEntries.length}
        totalCount={groupedCounts.total}
        resultLabel={visibleEntries.length === 1 ? "registro" : "registros"}
        filterCount={(activeType !== "all" ? 1 : 0) + statusFilters.size}
        hasActiveFilters={Boolean(
          search.trim() || activeType !== "all" || statusFilters.size
        )}
        activeFiltersLabel={
          search.trim() || activeType !== "all" || statusFilters.size
            ? `Tipo: ${types.find(type => type.value === activeType)?.label ?? "Tudo"} · ${statusFilters.size} status selecionado(s)`
            : "Mostrando todo o arquivo canônico da obra."
        }
        onClear={() => {
          setSearch("");
          setSubmittedSearch("");
          setActiveType("all");
          setStatusFilters(new Set());
        }}
      >
        <FilterChipGroup
          label="Tipo"
          mode="single"
          allLabel="Tudo"
          allCount={groupedCounts.total}
          selectedValues={[activeType]}
          onToggle={value =>
            setActiveType(value as (typeof types)[number]["value"])
          }
          options={typeFilterOptions.map(type => ({
            ...type,
            count:
              type.value === "event"
                ? groupedCounts.event
                : type.value === "location"
                  ? groupedCounts.location
                  : type.value === "aura"
                    ? groupedCounts.aura
                    : groupedCounts.society,
          }))}
        />
        <FilterChipGroup
          label="Status"
          allLabel="Todos"
          allCount={groupedCounts.total}
          selectedValues={Array.from(statusFilters)}
          onToggle={value =>
            setStatusFilters(current => toggleSetValue(current, value))
          }
          onClear={() => setStatusFilters(new Set())}
          options={statusFilterOptions}
        />
      </FilterToolbar>

      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <Card className="space-y-3 border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-display text-lg text-foreground">
                Registros canônicos
              </h3>
              <div className="text-sm text-muted-foreground">
                {visibleEntries.length} item(ns)
              </div>
            </div>

            <div className="space-y-3">
              {listQuery.isLoading || searchQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando...
                </div>
              ) : visibleEntries.length ? (
                visibleEntries.map((entry: any) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border bg-secondary/50 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-foreground">
                        {entry.name}
                      </div>
                      <div className="flex gap-2 text-xs">
                        <span className="rounded-full border border-border/70 bg-foreground/8 px-2.5 py-1 text-foreground/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
                          {entry.type === "event"
                            ? "Evento"
                            : entry.type === "location"
                              ? "Lugar"
                              : entry.type === "aura"
                                ? "Poder/Regra"
                                : entry.type === "society"
                                  ? "Facção/Instituição"
                                  : entry.type}
                        </span>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            entry.status === "canonical"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : entry.status === "in_development"
                                ? "bg-amber-500/15 text-amber-400"
                                : entry.status === "hypothesis"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : entry.status === "discarded"
                                    ? "bg-red-500/15 text-red-400"
                                    : "border border-border/70 bg-foreground/8 text-foreground/85"
                          }`}
                        >
                          {entry.status === "canonical"
                            ? "Canônico"
                            : entry.status === "in_development"
                              ? "Em desenvolvimento"
                              : entry.status === "hypothesis"
                                ? "Hipótese"
                                : entry.status === "discarded"
                                  ? "Descartado"
                                  : entry.status || "sem status"}
                        </span>
                      </div>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {entry.description ||
                        entry.snippet ||
                        "Sem descrição ainda."}
                    </p>
                    {entry.details ? (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/85">
                        {entry.details}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-lg border-2 border-dashed border-border/50 p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Nenhuma entrada encontrada.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground/70">
                    Tente ajustar seus filtros ou criar uma nova entrada
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>

        <Card className="space-y-4 border border-border bg-card p-4">
          <h3 className="font-display text-lg text-foreground">
            Novo registro canônico
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Use esta ficha para fixar informação que já pode alimentar a
            escrita. Para arquivo bruto, suba o documento em Obras.
          </p>

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Tipo
              </label>
              <select
                value={formData.type}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    type: e.target.value as any,
                  }))
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground"
              >
                {types
                  .filter(type => type.value !== "all")
                  .map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Nome
              </label>
              <Input
                value={formData.name}
                onChange={e =>
                  setFormData(prev => ({ ...prev, name: e.target.value }))
                }
                className="bg-secondary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Descrição curta
              </label>
              <Textarea
                value={formData.description}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                rows={4}
                className="resize-none bg-secondary"
                placeholder={activePlaceholder.description}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Detalhes
              </label>
              <Textarea
                value={formData.details}
                onChange={e =>
                  setFormData(prev => ({ ...prev, details: e.target.value }))
                }
                rows={8}
                className="resize-none bg-secondary"
                placeholder={activePlaceholder.details}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Status
              </label>
              <select
                value={formData.status}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    status: e.target.value as any,
                  }))
                }
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground"
              >
                <option value="canonical">Canônico</option>
                <option value="in_development">Em desenvolvimento</option>
                <option value="hypothesis">Hipótese</option>
                <option value="discarded">Descartado</option>
              </select>
            </div>

            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Criar registro
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
