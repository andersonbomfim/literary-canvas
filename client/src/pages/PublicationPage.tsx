import { useMemo } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  Library,
  ListChecks,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { useActiveWork } from "@/_core/hooks/useActiveWork";
import { BookExport } from "@/components/BookExport";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { parseKeyChapters } from "@/lib/keyChapters";
import { parseStyleProfile } from "@/lib/styleProfile";
import { parseUniverseProfile } from "@/lib/universeProfile";
import { parseContinuityMemories } from "@shared/continuity";

function countWords(text: string | null) {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeFileName(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "dossie-da-obra"
  );
}

export default function PublicationPage() {
  const { activeWork } = useActiveWork();
  const profileQuery = trpc.profile?.get.useQuery();
  const chaptersQuery = trpc.writing.list.useQuery({});
  const draftsQuery = trpc.drafts.list.useQuery({});
  const charactersQuery = trpc.characters?.list.useQuery();
  const libraryQuery = trpc.library.list.useQuery({});

  const chapters = chaptersQuery.data?.data || [];
  const drafts = draftsQuery.data?.data || [];
  const characters = charactersQuery.data?.data || [];
  const libraryEntries = libraryQuery.data?.data || [];
  const profile = profileQuery.data;

  const styleProfile = useMemo(
    () => parseStyleProfile(profile?.narrativeStyle),
    [profile]
  );
  const universeProfile = useMemo(
    () => parseUniverseProfile(profile?.negativeRules),
    [profile]
  );
  const keyChapters = useMemo(
    () => parseKeyChapters(profile?.keyChapters),
    [profile]
  );
  const continuityMemories = useMemo(
    () => parseContinuityMemories(profile?.continuityMemories),
    [profile]
  );

  const canonicalChapters = useMemo(
    () => chapters.filter((chapter: any) => chapter.status === "canonical"),
    [chapters]
  );
  const inDevelopmentChapters = useMemo(
    () =>
      chapters.filter((chapter: any) => chapter.status === "in_development"),
    [chapters]
  );
  const pendingReferences = useMemo(
    () =>
      keyChapters.customReferences.filter(
        item =>
          item.summaryStatus === "pending" || item.summaryStatus === "error"
      ),
    [keyChapters]
  );
  const activeReferences = useMemo(
    () => keyChapters.customReferences.filter(item => item.isActive),
    [keyChapters]
  );

  const bibleReadiness = useMemo(() => {
    const universeFields = Object.values(universeProfile).filter(value =>
      value.trim()
    ).length;
    return [
      {
        label: "Obra ativa definida",
        done: Boolean(activeWork && !activeWork?.deletedAt),
        href: "/works",
      },
      {
        label: "Universo preenchido",
        done: universeFields >= 4,
        href: "/works",
      },
      {
        label: "Personagens cadastrados",
        done: characters?.length > 0,
        href: "/works",
      },
      {
        label: "Referências processadas",
        done: activeReferences.length > 0 && pendingReferences.length === 0,
        href: "/works",
      },
      {
        label: "Estilo autoral salvo",
        done: Boolean(
          styleProfile.notes.trim() ||
            styleProfile.samples.some(sample => sample.isActive)
        ),
        href: "/works",
      },
      {
        label: "Capítulos canônicos",
        done: canonicalChapters.length > 0,
        href: "/review",
      },
    ];
  }, [
    activeReferences.length,
    activeWork,
    canonicalChapters.length,
    characters?.length,
    pendingReferences.length,
    styleProfile,
    universeProfile,
  ]);

  const issues = useMemo(() => {
    const items: Array<{
      title: string;
      description: string;
      href: string;
      tone: "warning" | "danger" | "info";
    }> = [];
    if (!activeWork) {
      items.push({
        title: "Nenhuma obra ativa",
        description: "Escolha ou crie uma obra antes de exportar.",
        href: "/works",
        tone: "danger",
      });
    } else if (activeWork?.status === "paused") {
      items.push({
        title: "Obra pausada",
        description:
          "A IA não deve absorver nem gerar texto desta obra enquanto estiver pausada.",
        href: "/works",
        tone: "warning",
      });
    }
    if (drafts.length) {
      items.push({
        title: "Rascunhos ainda soltos",
        description: `${drafts.length} rascunho(s) ainda não viraram capítulo final.`,
        href: "/draft",
        tone: "info",
      });
    }
    if (inDevelopmentChapters.length) {
      items.push({
        title: "Capítulos em desenvolvimento",
        description: `${inDevelopmentChapters.length} capítulo(s) ainda precisam de revisão.`,
        href: "/review",
        tone: "warning",
      });
    }
    if (!universeProfile.timeline.trim()) {
      items.push({
        title: "Timeline incompleta",
        description:
          "A cronologia ainda não tem eventos organizados por ano ou período.",
        href: "/works",
        tone: "warning",
      });
    }
    if (pendingReferences.length) {
      items.push({
        title: "Referências pendentes",
        description: `${pendingReferences.length} referência(s) precisam ser revisadas ou reprocessadas.`,
        href: "/works",
        tone: "warning",
      });
    }
    if (!continuityMemories.length && canonicalChapters.length) {
      items.push({
        title: "Cânone sem memória",
        description:
          "Existem capítulos canônicos, mas nenhuma memória de continuidade salva.",
        href: "/review",
        tone: "warning",
      });
    }
    return items;
  }, [
    activeWork,
    canonicalChapters.length,
    continuityMemories.length,
    drafts.length,
    inDevelopmentChapters.length,
    pendingReferences.length,
    universeProfile.timeline,
  ]);

  const bibleText = useMemo(() => {
    const universeEntries = Object.entries(universeProfile)
      .filter(([, value]) => value.trim())
      .map(([key, value]) => `## ${key}\n${value.trim()}`)
      .join("\n\n");
    const characterEntries = characters
      .map(
        (character: any) =>
          `## ${character.name}\nPapel: ${character.role || "Não informado"}\n\nHistoria:\n${character.history || ""}\n\nPersonalidade:\n${character.personality || ""}\n\nNotas:\n${character.notes || ""}`
      )
      .join("\n\n");
    const libraryText = libraryEntries
      .filter((entry: any) => entry.type !== "character")
      .map(
        (entry: any) =>
          `## ${entry.name}\nTipo: ${entry.type}\nStatus: ${entry.status || "sem status"}\n\n${entry.description || ""}\n\n${entry.details || ""}`
      )
      .join("\n\n");
    const memoryText = continuityMemories
      .map(
        memory =>
          `## Capítulo ${memory.chapterId}: ${memory.chapterTitle}\n${memory.summary}\n\nFatos canônicos:\n${memory.canonicalFacts.join("\n")}\n\nMudancas:\n${memory.stateChanges.join("\n")}\n\nPontas abertas:\n${memory.openLoops.join("\n")}`
      )
      .join("\n\n");

    return [
      `# Dossiê da Obra: ${activeWork?.title || "Obra"}`,
      activeWork?.subtitle ? `Subtítulo: ${activeWork?.subtitle}` : "",
      activeWork?.genre ? `Gênero: ${activeWork?.genre}` : "",
      activeWork?.description
        ? `\nPremissa / descrição:\n${activeWork?.description}`
        : "",
      "\n# Universo",
      universeEntries || "Sem universo preenchido.",
      "\n# Personagens",
      characterEntries || "Sem personagens cadastrados.",
      "\n# Biblioteca Canônica",
      libraryText || "Sem entradas canônicas.",
      "\n# Estilo",
      styleProfile.notes || "Sem notas de estilo.",
      "\n# Memória de Continuidade",
      memoryText || "Sem memórias salvas.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [
    activeWork,
    characters,
    continuityMemories,
    libraryEntries,
    styleProfile.notes,
    universeProfile,
  ]);

  const handleExportBible = () => {
    downloadText(
      `${normalizeFileName(activeWork?.title || "dossie-da-obra")}.txt`,
      bibleText
    );
    toast.success("Dossiê da obra exportado.");
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-accent">
                <Send className="h-4 w-4" />
                Etapa final
              </div>
              <h2 className="mt-2 font-display text-2xl text-foreground">
                {activeWork?.title || "Sem obra ativa"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Aqui ficam exportação, ordem editorial, pendências de fechamento
                e o dossiê da obra em arquivo separado.
              </p>
            </div>
            <Button
              onClick={handleExportBible}
              variant="outline"
              disabled={!activeWork}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar dossiê
            </Button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Canônicos
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {canonicalChapters.length}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Palavras finais
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {canonicalChapters
                  .reduce(
                    (total: number, chapter: any) =>
                      total + countWords(chapter.content),
                    0
                  )
                  .toLocaleString("pt-BR")}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Pendências
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {issues.length}
              </div>
            </div>
          </div>
        </Card>

        <Card className="border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" />
            <h3 className="font-display text-lg text-foreground">
              Pronto para fechar
            </h3>
          </div>
          <div className="mt-4 space-y-2">
            {bibleReadiness.map(item => (
              <Link key={item.label} href={item.href}>
                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm transition-colors hover:border-accent/50">
                  <span className="text-foreground">{item.label}</span>
                  {item.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-accent" />
            <h3 className="font-display text-lg text-foreground">
              Detector de conflitos e pendências
            </h3>
          </div>
          <div className="mt-4 space-y-3">
            {issues.length ? (
              issues.map(issue => (
                <Link key={issue.title} href={issue.href}>
                  <div
                    className={`rounded-lg border p-4 transition-colors hover:border-accent/50 ${
                      issue.tone === "danger"
                        ? "border-red-500/30 bg-red-500/10"
                        : issue.tone === "warning"
                          ? "border-amber-500/30 bg-amber-500/10"
                          : "border-blue-500/30 bg-blue-500/10"
                    }`}
                  >
                    <div className="font-medium text-foreground">
                      {issue.title}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {issue.description}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                Nenhuma pendência estrutural encontrada para a obra ativa.
              </div>
            )}
          </div>
        </Card>

        <Card className="border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-accent" />
            <h3 className="font-display text-lg text-foreground">
              Ordem editorial
            </h3>
          </div>
          <div className="mt-4 space-y-3">
            {canonicalChapters.length ? (
              canonicalChapters.map((chapter: any, index: number) => (
                <Link
                  key={chapter.id}
                  href={`/writing?chapterId=${chapter.id}`}
                >
                  <div className="rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-accent/50">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="font-medium text-foreground">
                        {index + 1}. {chapter.title}
                      </div>
                      <Badge
                        variant="secondary"
                        className="bg-emerald-500/15 text-emerald-300"
                      >
                        {countWords(chapter.content).toLocaleString("pt-BR")}{" "}
                        palavras
                      </Badge>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                Aprove capítulos na Revisão para montar a ordem final.
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <BookExport />

        <Card className="border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Library className="h-5 w-5 text-accent" />
            <h3 className="font-display text-lg text-foreground">
              Arquivos exportáveis
            </h3>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Button
              onClick={handleExportBible}
              variant="outline"
              disabled={!activeWork}
            >
              <FileText className="mr-2 h-4 w-4" />
              Dossiê da obra
            </Button>
            <Link href="/works">
              <Button variant="outline" className="w-full">
                Revisar perfil canônico
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
