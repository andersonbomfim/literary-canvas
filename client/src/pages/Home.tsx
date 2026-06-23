import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileText,
  Library,
  PenLine,
  Send,
  Sparkles,
} from "lucide-react";

import { useActiveWork } from "@/_core/hooks/useActiveWork";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WorkOnboarding } from "@/components/WorkOnboarding";
import { trpc } from "@/lib/trpc";
import { parseKeyChapters } from "@/lib/keyChapters";
import { parseStyleProfile } from "@/lib/styleProfile";
import { parseUniverseProfile } from "@/lib/universeProfile";
import { parseContinuityMemories } from "@shared/continuity";

function wordCount(text: string | null) {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

function chapterStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "canonical":
      return "Canônico";
    case "in_development":
      return "Em escrita";
    case "discarded":
      return "Descartado";
    case "hypothesis":
      return "Hipótese";
    default:
      return status || "Sem status";
  }
}

export default function Home() {
  const [location] = useLocation();
  const { activeWork, works, isLoading } = useActiveWork();
  const forceWorkCreator =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("createWork") === "1"
      : location.includes("createWork=1");
  const hasActiveWork = Boolean(activeWork?.id);
  const draftsQuery = trpc.drafts.list.useQuery(undefined, {
    enabled: hasActiveWork,
  });
  const chaptersQuery = trpc.writing.list.useQuery(undefined, {
    enabled: hasActiveWork,
  });
  const profileQuery = trpc.profile?.get.useQuery(undefined, {
    enabled: hasActiveWork,
  });
  const charactersQuery = trpc.characters?.list.useQuery(undefined, {
    enabled: hasActiveWork,
  });
  const libraryQuery = trpc.library.list.useQuery(
    {},
    { enabled: hasActiveWork }
  );

  const drafts = draftsQuery.data?.data || [];
  const chapters = chaptersQuery.data?.data || [];
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
  const importedReferences = useMemo(
    () =>
      keyChapters.customReferences.filter(
        item => item.sourceType === "upload"
      ),
    [keyChapters]
  );

  const recentDrafts = useMemo(() => drafts.slice(0, 4), [drafts]);
  const inDevelopmentChapters = useMemo(
    () =>
      chapters.filter((chapter: any) => chapter.status === "in_development"),
    [chapters]
  );
  const canonicalChapters = useMemo(
    () => chapters.filter((chapter: any) => chapter.status === "canonical"),
    [chapters]
  );
  const nextChapter = inDevelopmentChapters[0] || chapters[0] || null;
  const hasStartedText = recentDrafts.length > 0 || chapters.length > 0;
  const hasImportedMaterial = importedReferences.length > 0;

  const contextItems = useMemo(() => {
    const activeStyleSamples = styleProfile.samples.filter(
      sample => sample.isActive
    ).length;
    const universeFields = Object.values(universeProfile).filter(value =>
      value.trim()
    ).length;
    const activeReferences =
      keyChapters.customReferences.filter(item => item.isActive).length +
      keyChapters.linkedChapters.length;
    const pendingReferences = keyChapters.customReferences.filter(
      item => item.summaryStatus === "pending" || item.summaryStatus === "error"
    ).length;
    return [
      {
        label: "Universo",
        value: universeFields,
        ok: universeFields >= 4,
        href: "/works?tab=universe",
      },
      {
        label: "Personagens",
        value: characters?.length,
        ok: characters?.length > 0,
        href: "/works?tab=characters",
      },
      {
        label: "Referências",
        value: activeReferences,
        ok: activeReferences > 0 && pendingReferences === 0,
        href: "/works?tab=chapters",
      },
      {
        label: "Estilo",
        value: activeStyleSamples + (styleProfile.notes.trim() ? 1 : 0),
        ok: Boolean(activeStyleSamples || styleProfile.notes.trim()),
        href: "/works?tab=style",
      },
      {
        label: "Memórias",
        value: continuityMemories.length,
        ok: continuityMemories.length > 0 || canonicalChapters.length === 0,
        href: "/works?tab=continuity",
      },
      {
        label: "Biblioteca",
        value: libraryEntries.filter((entry: any) => entry.type !== "character")
          .length,
        ok: libraryEntries.length > 0,
        href: "/library",
      },
    ];
  }, [
    canonicalChapters.length,
    characters?.length,
    continuityMemories.length,
    keyChapters,
    libraryEntries,
    styleProfile,
    universeProfile,
  ]);

  const nextAction = useMemo(() => {
    if (!activeWork) {
      return {
        title: "Criar ou escolher uma obra",
        description:
          "Escolha a obra antes de alimentar o contexto, escrever ou revisar.",
        href: "/works",
        label: "Gerenciar obras",
      };
    }
    if (activeWork?.status === "paused") {
      return {
        title: "Obra pausada",
        description:
          "Retome a obra antes de escrever, revisar ou acionar a IA.",
        href: "/works",
        label: "Retomar obra",
      };
    }
    if (activeWork?.status === "completed") {
      return {
        title: "Obra concluída",
        description:
          "A produção está em stand by. Gerencie a obra antes de reabrir escrita ou IA.",
        href: "/works",
        label: "Gerenciar obra",
      };
    }
    if (activeWork?.status === "archived") {
      return {
        title: "Obra arquivada",
        description:
          "A produção está em stand by. Desarquive a obra antes de qualquer ação editorial.",
        href: "/works",
        label: "Gerenciar obra",
      };
    }
    if (recentDrafts.length) {
      return {
        title: "Transformar rascunho em capítulo",
        description:
          "Você tem texto bruto pronto para virar capítulo na Escrita.",
        href: `/draft?draftId=${recentDrafts[0].id}`,
        label: "Abrir rascunho",
      };
    }
    if (inDevelopmentChapters.length) {
      return {
        title: "Enviar capítulo para revisão",
        description: "Existe capítulo em escrita que ainda não virou cânone.",
        href: `/writing?chapterId=${inDevelopmentChapters[0].id}`,
        label: "Continuar escrita",
      };
    }
    if (hasImportedMaterial && !hasStartedText) {
      return {
        title: "Revisar material importado",
        description:
          "A obra já entrou no sistema. Abra a leitura importada, confira referências, personagens e cânone antes do primeiro rascunho.",
        href: "/works?tab=chapters",
        label: "Abrir material importado",
      };
    }
    return {
      title: "Criar novo rascunho",
      description:
        "Comece jogando o texto bruto. A IA entra depois, na Escrita.",
      href: "/draft",
      label: "Novo rascunho",
    };
  }, [
    activeWork,
    hasImportedMaterial,
    hasStartedText,
    inDevelopmentChapters,
    recentDrafts,
  ]);

  if (isLoading) {
    return null;
  }

  if (forceWorkCreator || !activeWork) {
    return <WorkOnboarding />;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-accent">
                <BookOpen className="h-4 w-4" />
                Obra ativa
              </div>
              <h2 className="mt-2 font-display text-2xl text-foreground">
                {activeWork?.title || "Sem obra ativa"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {activeWork?.description ||
                  "A mesa de trabalho mostra onde você parou, se o perfil da obra está forte e o que precisa acontecer agora."}
              </p>
            </div>
            <Badge
              variant="secondary"
              className={
                activeWork?.status === "paused"
                  ? "bg-amber-500/15 text-amber-300"
                  : activeWork?.status === "completed"
                    ? "bg-violet-500/15 text-violet-300"
                    : activeWork?.status === "archived"
                      ? "bg-zinc-500/15 text-zinc-300"
                      : "bg-emerald-500/15 text-emerald-300"
              }
            >
              {activeWork?.status === "paused"
                ? "Pausada"
                : activeWork?.status === "completed"
                  ? "Concluída"
                  : activeWork?.status === "archived"
                    ? "Arquivada"
                    : activeWork
                      ? "Ativa"
                      : "Sem obra"}
            </Badge>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Rascunhos
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {drafts.length}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Em escrita
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {inDevelopmentChapters.length}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Canônicos
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {canonicalChapters.length}
              </div>
            </div>
          </div>
        </Card>

        <Card className="border border-accent/30 bg-accent/5 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            <h3 className="font-display text-lg text-foreground">
              Próxima ação
            </h3>
          </div>
          <h4 className="mt-4 text-xl font-semibold text-foreground">
            {nextAction.title}
          </h4>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {nextAction.description}
          </p>
          <Link href={nextAction.href}>
            <Button className="mt-5 bg-accent text-accent-foreground hover:bg-accent/90">
              {nextAction.label}
            </Button>
          </Link>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg text-foreground">
              Contexto que a IA vai usar
            </h3>
            <Link href="/works?tab=chapters">
              <Button variant="outline" size="sm">
                Abrir material
              </Button>
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {contextItems.map(item => (
              <Link key={item.label} href={item.href}>
                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-accent/50">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {item.label}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.value} registro(s)
                    </div>
                  </div>
                  {item.ok ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-400" />
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg text-foreground">Onde parei</h3>
            {nextChapter ? (
              <Badge variant="secondary">
                {chapterStatusLabel(nextChapter.status)}
              </Badge>
            ) : null}
          </div>
          {nextChapter ? (
            <Link href={`/writing?chapterId=${nextChapter.id}`}>
              <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-accent/50">
                <div className="font-medium text-foreground">
                  {nextChapter.title}
                </div>
                <p className="mt-2 line-clamp-4 text-sm leading-6 text-muted-foreground">
                  {nextChapter.content}
                </p>
                <div className="mt-3 text-xs text-muted-foreground">
                  {wordCount(nextChapter.content).toLocaleString("pt-BR")}{" "}
                  palavras
                </div>
              </div>
            </Link>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
              {hasImportedMaterial
                ? "Material importado aguardando revisão antes do primeiro rascunho."
                : "Nenhum capítulo iniciado ainda. Comece por um rascunho bruto."}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-accent" />
              <h3 className="font-display text-lg text-foreground">
                Rascunhos recentes
              </h3>
            </div>
            <Link href="/draft">
              <Button variant="outline" size="sm">
                Novo
              </Button>
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {recentDrafts.length ? (
              recentDrafts.map((draft: any) => (
                <Link key={draft.id} href={`/draft?draftId=${draft.id}`}>
                  <div className="rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-accent/50">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-foreground">
                        {draft.title}
                      </div>
                      <Badge variant="secondary">bruto</Badge>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {draft.content || draft.summary || "Sem texto ainda."}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                Nenhum rascunho salvo.
              </div>
            )}
          </div>
        </Card>

        <Card className="border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Library className="h-5 w-5 text-accent" />
            <h3 className="font-display text-lg text-foreground">
              Ações rápidas
            </h3>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link href="/draft">
              <Button variant="outline" className="w-full">
                <FileText className="mr-2 h-4 w-4" />
                Rascunhar
              </Button>
            </Link>
            <Link href="/writing">
              <Button variant="outline" className="w-full">
                <PenLine className="mr-2 h-4 w-4" />
                Escrita IA
              </Button>
            </Link>
            <Link href="/review">
              <Button variant="outline" className="w-full">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Revisar
              </Button>
            </Link>
            <Link href="/export">
              <Button variant="outline" className="w-full">
                <BookOpen className="mr-2 h-4 w-4" />
                Exportar
              </Button>
            </Link>
          </div>
        </Card>
      </div>

      {canonicalChapters.length > 0 ? (
        <Card className="border border-accent/20 bg-accent/5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-accent" />
              <h3 className="font-display text-lg text-foreground">
                Progresso para exportação
              </h3>
            </div>
            <Link href="/export">
              <Button variant="outline" size="sm">
                Ver detalhes
              </Button>
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
                Em revisão
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {inDevelopmentChapters.length}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Rascunhos pendentes
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">
                {drafts.length}
              </div>
            </div>
          </div>
          {inDevelopmentChapters.length > 0 || drafts.length > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {inDevelopmentChapters.length > 0
                ? `${inDevelopmentChapters.length} capítulo(s) precisam de revisão antes de exportar. `
                : ""}
              {drafts.length > 0
                ? `${drafts.length} rascunho(s) aguardam transformação em capítulo.`
                : ""}
            </p>
          ) : (
            <p className="mt-3 text-sm text-emerald-400">
              Todos os capítulos estão canônicos. A obra pode estar pronta para
              exportação.
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
