import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ChevronDown,
  Edit2,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterToolbar } from "@/components/FilterToolbar";
import { matchesFilterQuery } from "@/lib/filtering";

type DetailKey =
  | "personality"
  | "physicalDescription"
  | "speechStyle"
  | "psychologicalProfile"
  | "backstory"
  | "relationships"
  | "notes";

const DETAIL_LABELS: Record<DetailKey, string> = {
  personality: "Personalidade",
  physicalDescription: "Aparência",
  speechStyle: "Jeito de falar",
  psychologicalProfile: "Psicológico",
  backstory: "Passado",
  relationships: "Relações",
  notes: "Notas",
};

const emptyForm = {
  name: "",
  history: "",
  personality: "",
  physicalDescription: "",
  role: "",
  family: "",
  birthDate: "",
  speechStyle: "",
  psychologicalProfile: "",
  backstory: "",
  motivations: "",
  relationships: "",
  notes: "",
};

type CharacterManagerProps = {
  onDirtyChange: (dirty: boolean) => void;
};

type CharacterTier = "principal" | "recorrente" | "apoio";

const TIER_LABELS: Record<CharacterTier, string> = {
  principal: "Núcleo principal",
  recorrente: "Recorrentes",
  apoio: "Apoio",
};

function normalizeCharacterText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getCharacterTier(character: any): CharacterTier {
  const role = normalizeCharacterText(character.role || "");
  const history = normalizeCharacterText(character.history || "");
  const notes = normalizeCharacterText(character.notes || "");
  const supportingText = `${history} ${notes}`;

  if (
    /\b(protagonista|antagonista principal|personagem central|nucleo central)\b/.test(
      role
    )
  )
    return "principal";

  if (
    /\b(antagonista|mentor|aliad[oa]|recorrente|investigador|jornalista|agente|kgb|cia|amig[oa] de)\b/.test(
      `${role} ${supportingText}`
    ) ||
    String(character.history || "").length > 520
  )
    return "recorrente";

  return "apoio";
}

function getCharacterTierScore(character: any) {
  const tier = getCharacterTier(character);
  return tier === "principal" ? 3 : tier === "recorrente" ? 2 : 1;
}

function CharacterCard({
  character,
  wasImported,
  tier,
  detailKeys,
  onEdit,
  onDelete,
  deleteDisabled,
}: {
  character: any;
  wasImported: boolean;
  tier: CharacterTier;
  detailKeys: DetailKey[];
  onEdit: () => void;
  onDelete: () => void;
  deleteDisabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeDetail, setActiveDetail] = useState<DetailKey | null>(null);

  const handleBadgeClick = (key: DetailKey) => {
    if (activeDetail === key) {
      setActiveDetail(null);
    } else {
      setActiveDetail(key);
      if (!expanded) setExpanded(true);
    }
  };

  const isPrincipal = tier === "principal";

  return (
    <div
      className={`rounded-lg border bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-colors duration-150 ${
        isPrincipal
          ? "border-accent/70 bg-accent/5"
          : "border-border/80"
      }`}
    >
      {/* Header — always visible */}
      <div className="flex items-start justify-between gap-3 p-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left transition-colors hover:opacity-80"
          onClick={() => {
            setExpanded(!expanded);
            if (expanded) setActiveDetail(null);
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              {character.name}
            </span>
            {character.role ? (
              <span className="text-xs text-muted-foreground">
                {character.role}
              </span>
            ) : null}
            {character.family ? (
              <Badge
                variant="secondary"
                className="bg-secondary px-2 py-0.5 text-xs text-foreground"
              >
                {character.family}
              </Badge>
            ) : null}
            {wasImported ? (
              <Badge
                variant="secondary"
                className="bg-accent/15 px-2 py-0.5 text-xs text-accent"
              >
                importado
              </Badge>
            ) : null}
            {isPrincipal ? (
              <Badge
                variant="secondary"
                className="bg-primary/15 px-2 py-0.5 text-xs text-primary"
              >
                principal
              </Badge>
            ) : null}
          </div>
          <p
            className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground transition-colors duration-150"
          >
            {character.history}
          </p>
        </button>
        <div className="flex gap-1.5 shrink-0">
          <IconButton
            label={`Editar ${character.name}`}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={onEdit}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label={`Excluir ${character.name}`}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={deleteDisabled}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {/* Detail badges — clickable */}
      {detailKeys.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3 text-[11px]">
          {detailKeys.map(key => (
            <button
              key={key}
              type="button"
              onClick={() => handleBadgeClick(key)}
              className={`rounded-full px-2.5 py-1 transition-all duration-150 ${
                activeDetail === key
                  ? "bg-accent/20 text-accent ring-1 ring-accent/40"
                  : "bg-secondary/80 text-muted-foreground hover:bg-accent/10 hover:text-accent"
              }`}
            >
              {DETAIL_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      {/* Expanded detail panel */}
      <div
        className="overflow-hidden transition-colors duration-150 ease-out"
        style={{
          maxHeight: activeDetail ? "400px" : "0px",
          opacity: activeDetail ? 1 : 0,
        }}
      >
        {activeDetail && (
          <div className="border-t border-border/60 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-accent mb-1.5">
              {DETAIL_LABELS[activeDetail]}
            </div>
            <p className="text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
              {(character as any)[activeDetail]}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function CharacterManager({ onDirtyChange }: CharacterManagerProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [formData, setFormData] = useState(emptyForm);
  const [baselineForm, setBaselineForm] = useState(emptyForm);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("add");
  const didAutoOpenExistingCharacters = useRef(false);

  const {
    data: characters,
    isLoading,
    refetch,
  } = trpc.characters?.list.useQuery();

  const createMutation = trpc.characters?.create.useMutation({
    onSuccess: () => {
      toast.success("Personagem criado.");
      setFormData(emptyForm);
      setBaselineForm(emptyForm);
      setDetailsOpen(false);
      setActiveTab("list");
      refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const updateMutation = trpc.characters?.update.useMutation({
    onSuccess: () => {
      toast.success("Personagem atualizado.");
      setFormData(emptyForm);
      setBaselineForm(emptyForm);
      setEditingId(null);
      setDetailsOpen(false);
      setActiveTab("list");
      refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const deleteMutation = trpc.characters?.delete.useMutation({
    onSuccess: () => {
      toast.success("Personagem removido.");
      refetch();
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const characterList = characters?.data || [];

  const filteredCharacters = useMemo(() => {
    return characterList
      .filter(character => {
        const matchesSearch = matchesFilterQuery(search, [
          character.name,
          character.role,
          character.family,
          character.personality,
          character.history,
          character.speechStyle,
          character.psychologicalProfile,
        ]);
        return matchesSearch;
      })
      .sort((left, right) => {
        const tierDifference =
          getCharacterTierScore(right) - getCharacterTierScore(left);
        if (tierDifference) return tierDifference;
        return String(left.name || "").localeCompare(String(right.name || ""));
      });
  }, [characterList, search]);

  const groupedCharacters = useMemo(() => {
    return filteredCharacters.reduce<Record<CharacterTier, typeof filteredCharacters>>(
      (groups, character) => {
        groups[getCharacterTier(character)].push(character);
        return groups;
      },
      { principal: [], recorrente: [], apoio: [] }
    );
  }, [filteredCharacters]);

  const filledDetailCount = useMemo(() => {
    let count = 0;
    if (formData.personality.trim()) count++;
    if (formData.physicalDescription.trim()) count++;
    if (formData.family.trim()) count++;
    if (formData.birthDate.trim()) count++;
    if (formData.speechStyle.trim()) count++;
    if (formData.psychologicalProfile.trim()) count++;
    if (formData.backstory.trim()) count++;
    if (formData.motivations.trim()) count++;
    if (formData.relationships.trim()) count++;
    if (formData.notes.trim()) count++;
    return count;
  }, [formData]);

  const formIsDirty = useMemo(
    () => JSON.stringify(formData) !== JSON.stringify(baselineForm),
    [formData, baselineForm]
  );

  useEffect(() => {
    onDirtyChange?.(formIsDirty);
  }, [formIsDirty, onDirtyChange]);

  useEffect(() => {
    if (!characterList.length) {
      didAutoOpenExistingCharacters.current = false;
      return;
    }

    if (
      !didAutoOpenExistingCharacters.current &&
      activeTab === "add" &&
      !editingId &&
      !formIsDirty
    ) {
      didAutoOpenExistingCharacters.current = true;
      setActiveTab("list");
    }
  }, [activeTab, characterList.length, editingId, formIsDirty]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedName = formData.name.trim();
    if (!normalizedName || !formData.history.trim()) {
      toast.error("Nome e história são obrigatórios.");
      return;
    }

    const duplicate = characterList.find(
      character =>
        character.name.trim().toLowerCase() === normalizedName.toLowerCase() &&
        character.id !== editingId
    );

    if (duplicate) {
      toast.error("Já existe um personagem com esse nome.");
      return;
    }

    if (editingId) {
      updateMutation.mutate({
        characterId: editingId,
        ...formData,
        name: normalizedName,
      });
    } else {
      createMutation.mutate({ ...formData, name: normalizedName });
    }
  };

  const handleEdit = (character: any) => {
    const nextForm = {
      name: character.name,
      history: character.history,
      personality: character.personality || "",
      physicalDescription: character.physicalDescription || "",
      role: character.role || "",
      family: character.family || "",
      birthDate: character.birthDate || "",
      speechStyle: character.speechStyle || "",
      psychologicalProfile: character.psychologicalProfile || "",
      backstory: character.backstory || "",
      motivations: character.motivations || "",
      relationships: character.relationships || "",
      notes: character.notes || "",
    };
    setFormData(nextForm);
    setBaselineForm(nextForm);
    setEditingId(character.id);
    setActiveTab("add");
    // Auto-open details if the character has any filled
    const hasDetails = [
      character.personality,
      character.physicalDescription,
      character.family,
      character.birthDate,
      character.speechStyle,
      character.psychologicalProfile,
      character.backstory,
      character.motivations,
      character.relationships,
      character.notes,
    ].some(v => v.trim());
    setDetailsOpen(hasDetails);
  };

  const [pendingCharacterDelete, setPendingCharacterDelete] = useState<{
    id: number;
    name: string;
  } | null>(null);

  const handleDelete = (characterId: number) => {
    const target = characterList.find(
      character => character.id === characterId
    );
    setPendingCharacterDelete({
      id: characterId,
      name: target?.name ?? `personagem #${characterId}`,
    });
  };

  const performCharacterDelete = async () => {
    if (!pendingCharacterDelete) return;
    await deleteMutation.mutateAsync({
      characterId: pendingCharacterDelete.id,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setBaselineForm(emptyForm);
    setDetailsOpen(false);
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList className="border border-border bg-secondary">
        <TabsTrigger value="add">Resumo</TabsTrigger>
        <TabsTrigger value="list">Acervo ({characterList.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="add" className="space-y-4">
        <Card className="border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-foreground">
              {editingId ? "Editar personagem" : "Criar personagem"}
            </h3>
            {editingId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  resetForm();
                  setActiveTab("list");
                }}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar ao acervo
              </Button>
            ) : null}
          </div>
          <div className="mb-4 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
            Personagens importados automaticamente podem ser refinados aqui sem
            perder o vínculo canônico já salvo no perfil.
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid gap-3 grid-cols-1 md:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Nome *
                </label>
                <Input
                  value={formData.name}
                  onChange={e =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="Ex: Pavel, Olga, Crowley..."
                  className="bg-secondary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Papel
                </label>
                <Input
                  value={formData.role}
                  onChange={e =>
                    setFormData({ ...formData, role: e.target.value })
                  }
                  placeholder="Ex: protagonista, pivô político..."
                  className="bg-secondary"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                História fixa *
              </label>
              <Textarea
                value={formData.history}
                onChange={e =>
                  setFormData({ ...formData, history: e.target.value })
                }
                placeholder="Resumo biográfico em ordem: origem, viradas, relações, perdas, decisões e estado final."
                rows={8}
                className="bg-secondary resize-none"
              />
            </div>

            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors">
                <span className="flex items-center gap-2">
                  Detalhes do personagem
                  {filledDetailCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-accent/15 px-2 py-0.5 text-accent text-xs"
                    >
                      {filledDetailCount} preenchido(s)
                    </Badge>
                  )}
                </span>
                <ChevronDown className="h-4 w-4 transition-transform [[data-state=open]>&]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3">
                <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Personalidade
                    </label>
                    <Textarea
                      value={formData.personality}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          personality: e.target.value,
                        })
                      }
                      placeholder="Traços, manias, postura e temperatura emocional."
                      rows={3}
                      className="bg-secondary resize-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Descrição física
                    </label>
                    <Textarea
                      value={formData.physicalDescription}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          physicalDescription: e.target.value,
                        })
                      }
                      placeholder="Marcas, presença, roupas, idade aparente."
                      rows={3}
                      className="bg-secondary resize-none"
                    />
                  </div>
                </div>

                <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Família / vínculos
                    </label>
                    <Input
                      value={formData.family}
                      onChange={e =>
                        setFormData({ ...formData, family: e.target.value })
                      }
                      placeholder="Família, clã, núcleo"
                      className="bg-secondary"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Nascimento / idade
                    </label>
                    <Input
                      value={formData.birthDate}
                      onChange={e =>
                        setFormData({ ...formData, birthDate: e.target.value })
                      }
                      placeholder="Ex: 14/07/1970"
                      className="bg-secondary"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Motivações
                    </label>
                    <Input
                      value={formData.motivations}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          motivations: e.target.value,
                        })
                      }
                      placeholder="O que move esse personagem"
                      className="bg-secondary"
                    />
                  </div>
                </div>

                <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Jeito de falar
                    </label>
                    <Textarea
                      value={formData.speechStyle}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          speechStyle: e.target.value,
                        })
                      }
                      placeholder="Cadência, vocabulário, formalidade, como reage sob pressão."
                      rows={3}
                      className="bg-secondary resize-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Perfil psicológico
                    </label>
                    <Textarea
                      value={formData.psychologicalProfile}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          psychologicalProfile: e.target.value,
                        })
                      }
                      placeholder="Medos, fissuras, impulsos, contradições."
                      rows={3}
                      className="bg-secondary resize-none"
                    />
                  </div>
                </div>

                <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Passado
                    </label>
                    <Textarea
                      value={formData.backstory}
                      onChange={e =>
                        setFormData({ ...formData, backstory: e.target.value })
                      }
                      placeholder="Infância, eventos fundadores, danos antigos."
                      rows={3}
                      className="bg-secondary resize-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Relacionamentos
                    </label>
                    <Textarea
                      value={formData.relationships}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          relationships: e.target.value,
                        })
                      }
                      placeholder="Alianças, rivalidades, dívidas, afetos."
                      rows={3}
                      className="bg-secondary resize-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Notas adicionais
                  </label>
                  <Textarea
                    value={formData.notes}
                    onChange={e =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    placeholder="Segredos, limites, observações soltas."
                    rows={3}
                    className="bg-secondary resize-none"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {editingId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  <X className="mr-2 h-4 w-4" />
                  Cancelar
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : editingId ? (
                  <>
                    <Edit2 className="mr-2 h-4 w-4" />
                    Atualizar
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Criar personagem
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
      </TabsContent>

      <TabsContent value="list" className="space-y-3">
        <FilterToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar nome, papel, família, voz ou histórico"
          resultCount={filteredCharacters.length}
          totalCount={characterList.length}
          resultLabel={
            filteredCharacters.length === 1 ? "personagem" : "personagens"
          }
          hasActiveFilters={Boolean(search.trim())}
          activeFiltersLabel={
            search.trim()
              ? `Busca "${search.trim()}"`
              : "Mostrando todos os resumos do acervo."
          }
          onClear={() => {
            setSearch("");
          }}
          actions={
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                setActiveTab("add");
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo resumo
            </Button>
          }
        />

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        ) : !characterList.length ? (
          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nenhum personagem criado ainda.
          </div>
        ) : !filteredCharacters.length ? (
          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nada encontrado para essa busca.
          </div>
        ) : (
          <div className="space-y-5">
            {(["principal", "recorrente", "apoio"] as CharacterTier[]).map(
              tier => {
                const group = groupedCharacters[tier];
                if (!group.length) return null;

                return (
                  <section key={tier} className="space-y-2">
                    <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      <span>{TIER_LABELS[tier]}</span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] tracking-normal">
                        {group.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {group.map(character => {
                        const wasImportedAutomatically = Boolean(
                          character.notes?.includes("[Importado")
                        );
                        const detailKeys: DetailKey[] = (
                          [
                            "personality",
                            "physicalDescription",
                            "speechStyle",
                            "psychologicalProfile",
                            "backstory",
                            "relationships",
                            "notes",
                          ] as DetailKey[]
                        ).filter(key =>
                          String((character as any)[key] ?? "").trim()
                        );

                        return (
                          <CharacterCard
                            key={character.id}
                            character={character}
                            wasImported={wasImportedAutomatically}
                            tier={tier}
                            detailKeys={detailKeys}
                            onEdit={() => handleEdit(character)}
                            onDelete={() => handleDelete(character.id)}
                            deleteDisabled={deleteMutation.isPending}
                          />
                        );
                      })}
                    </div>
                  </section>
                );
              }
            )}
          </div>
        )}
      </TabsContent>

      <ConfirmDialog
        open={pendingCharacterDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingCharacterDelete(null);
        }}
        title={
          pendingCharacterDelete
            ? `Excluir "${pendingCharacterDelete.name}"?`
            : "Excluir personagem?"
        }
        description="Isso também remove vínculos deste personagem em rascunhos. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        destructive
        onConfirm={performCharacterDelete}
      />
    </Tabs>
  );
}
