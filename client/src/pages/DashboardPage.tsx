import { useMemo } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Coins,
  FileText,
  Library,
  Loader2,
  PenTool,
  Target,
  Users,
} from "lucide-react";

import { useActiveWork } from "@/_core/hooks/useActiveWork";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { parseKeyChapters } from "@/lib/keyChapters";
import { parseStyleProfile } from "@/lib/styleProfile";
import {
  buildUniverseContext,
  parseUniverseProfile,
} from "@/lib/universeProfile";
import { parseContinuityMemories } from "@shared/continuity";

function countWords(text: string | null) {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

function issueTone(priority: "alta" | "media" | "baixa") {
  switch (priority) {
    case "alta":
      return "border-red-500/30 bg-red-500/10 text-red-200";
    case "media":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    default:
      return "border-blue-500/30 bg-blue-500/10 text-blue-200";
  }
}

export default function DashboardPage() {
  const { activeWork } = useActiveWork();
  const statsQuery = trpc.statistics.getDashboard.useQuery();
  const draftsQuery = trpc.drafts.list.useQuery({});
  const chaptersQuery = trpc.writing.list.useQuery({});
  const profileQuery = trpc.profile?.get.useQuery();
  const charactersQuery = trpc.characters?.list.useQuery();
  const libraryQuery = trpc.library.list.useQuery({});

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
  const universeContext = useMemo(
    () => buildUniverseContext(universeProfile),
    [universeProfile]
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
  const discardedChapters = useMemo(
    () => chapters.filter((chapter: any) => chapter.status === "discarded"),
    [chapters]
  );
  const summarizedReferences = useMemo(
    () =>
      keyChapters.customReferences.filter(
        item => item.summaryStatus === "done" && item.summary?.trim()
      ),
    [keyChapters]
  );
  const canonicalWorldEntries = useMemo(
    () =>
      libraryEntries.filter(
        (entry: any) =>
          entry.type !== "character" && entry.status !== "discarded"
      ),
    [libraryEntries]
  );
  const pendingReferences = useMemo(
    () =>
      keyChapters.customReferences.filter(
        item =>
          item.summaryStatus === "pending" || item.summaryStatus === "error"
      ),
    [keyChapters]
  );
  const bibleEvidenceScore = useMemo(() => {
    let score = 0;
    const universeWords = countWords(universeContext);
    const foundationWords = countWords(profile?.storyFoundation ?? "");
    if (universeWords >= 80) score += 3;
    else if (universeWords >= 25) score += 1;
    if (foundationWords >= 120) score += 3;
    else if (foundationWords >= 40) score += 1;
    if (characters.length >= 3) score += 2;
    else if (characters.length > 0) score += 1;
    if (canonicalWorldEntries.length >= 3) score += 2;
    else if (canonicalWorldEntries.length > 0) score += 1;
    if (summarizedReferences.length > 0) score += 2;
    return score;
  }, [
    canonicalWorldEntries.length,
    characters.length,
    profile?.storyFoundation,
    summarizedReferences.length,
    universeContext,
  ]);
  const hasImportedContext =
    characters.length > 0 ||
    canonicalWorldEntries.length > 0 ||
    summarizedReferences.length > 0 ||
    countWords(profile?.storyFoundation ?? "") >= 40;

  const issues = useMemo(() => {
    const list: Array<{
      title: string;
      description: string;
      href: string;
      priority: "alta" | "media" | "baixa";
    }> = [];
    if (!activeWork) {
      list.push({
        title: "Sem obra ativa",
        description: "Escolha ou crie uma obra para separar todo o escopo.",
        href: "/works",
        priority: "alta",
      });
    } else if (activeWork?.status === "paused") {
      list.push({
        title: "Obra pausada",
        description:
          "A IA fica bloqueada para escrita enquanto a obra estiver pausada.",
        href: "/works",
        priority: "alta",
      });
    }
    if (drafts.length > 0) {
      list.push({
        title: "Rascunhos aguardando Escrita",
        description: `${drafts.length} rascunho(s) ainda estão como texto bruto.`,
        href: "/draft",
        priority: "media",
      });
    }
    if (inDevelopmentChapters.length > 0) {
      list.push({
        title: "Capítulos sem aprovação",
        description: `${inDevelopmentChapters.length} capítulo(s) precisam passar por Revisão.`,
        href: "/review",
        priority: "alta",
      });
    }
    if (bibleEvidenceScore < 3 && !hasImportedContext) {
      list.push({
        title: "Material da obra vazio",
        description:
          "Ainda falta importar ou aprovar material para a IA usar como contexto.",
        href: "/works",
        priority: "alta",
      });
    } else if (
      countWords(universeContext) < 25 &&
      hasImportedContext &&
      canonicalWorldEntries.length < 3
    ) {
      list.push({
        title: "Universo não sincronizado",
        description:
          "Há material importado, mas a aba Universo ainda precisa ser consolidada a partir da obra.",
        href: "/works",
        priority: "media",
      });
    }
    if (
      !styleProfile.notes.trim() &&
      !styleProfile.samples.some(sample => sample.isActive)
    ) {
      list.push({
        title: "Estilo não treinado",
        description: "A IA ainda não recebeu voz autoral suficiente.",
        href: "/works",
        priority: "media",
      });
    }
    if (!characters?.length) {
      list.push({
        title: "Sem personagens canônicos",
        description:
          "Cadastre ou importe personagens antes de gerar capítulos complexos.",
        href: "/works",
        priority: "alta",
      });
    }
    if (pendingReferences.length) {
      list.push({
        title: "Referências pendentes",
        description: `${pendingReferences.length} referência(s) precisam de revisão ou reprocessamento.`,
        href: "/works",
        priority: "media",
      });
    }
    if (canonicalChapters.length && !continuityMemories.length) {
      list.push({
        title: "Capítulos canônicos sem memória",
        description:
          "A Revisão precisa salvar memória de continuidade para alimentar o livro.",
        href: "/review",
        priority: "media",
      });
    }
    return list;
  }, [
    activeWork,
    bibleEvidenceScore,
    canonicalChapters.length,
    canonicalWorldEntries.length,
    characters?.length,
    continuityMemories.length,
    drafts.length,
    hasImportedContext,
    inDevelopmentChapters.length,
    pendingReferences.length,
    styleProfile,
    universeContext,
  ]);

  const totalWords = chapters.reduce(
    (total: number, chapter: any) => total + countWords(chapter.content),
    0
  );
  const canonicalWords = canonicalChapters.reduce(
    (total: number, chapter: any) => total + countWords(chapter.content),
    0
  );
  const stats = statsQuery.data?.data;

  if (statsQuery.isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Obra ativa
          </div>
          <div className="mt-2 flex items-center gap-2 text-xl font-semibold text-foreground">
            <Target className="h-5 w-5 text-accent" />
            {activeWork?.title || "Sem obra ativa"}
          </div>
        </Card>
        <Card className="border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Gargalos abertos
          </div>
          <div className="mt-2 flex items-center gap-2 text-xl font-semibold text-foreground">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            {issues.length}
          </div>
        </Card>
        <Card className="border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Créditos flexíveis
          </div>
          <div className="mt-2 flex items-center gap-2 text-xl font-semibold text-foreground">
            <Coins className="h-5 w-5 text-accent" />
            {stats?.creditsBalance ?? "..."}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { icon: FileText, label: "Rascunhos", value: drafts.length },
          {
            icon: PenTool,
            label: "Em escrita",
            value: inDevelopmentChapters.length,
          },
          {
            icon: CheckCircle2,
            label: "Canônicos",
            value: canonicalChapters.length,
          },
          {
            icon: BookOpen,
            label: "Palavras totais",
            value: totalWords.toLocaleString("pt-BR"),
          },
          { icon: Users, label: "Personagens", value: characters?.length },
          {
            icon: Library,
            label: "Cânone",
            value: canonicalWorldEntries.length,
          },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <Card
              key={stat.label}
              className="border border-border bg-card p-4 transition-colors hover:border-accent/50"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-accent" />
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
              <p className="mt-1 text-xl font-bold text-foreground">
                {stat.value}
              </p>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-accent" />
            <h3 className="font-display text-lg text-foreground">
              Gargalos por prioridade
            </h3>
          </div>
          <div className="mt-4 space-y-3">
            {issues.length ? (
              issues.map(issue => (
                <Link key={issue.title} href={issue.href}>
                  <div
                    className={`rounded-lg border p-4 transition-colors hover:border-accent/50 ${issueTone(issue.priority)}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-foreground">
                        {issue.title}
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {issue.priority}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {issue.description}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                Nenhum gargalo estrutural encontrado para a obra ativa.
              </div>
            )}
          </div>
        </Card>

        <Card className="border border-border bg-card p-5">
          <h3 className="font-display text-lg text-foreground">
            Pipeline real da obra
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link href="/draft">
              <div className="rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-accent/50">
                <div className="text-sm font-medium text-foreground">
                  Rascunho bruto
                </div>
                <div className="mt-1 text-2xl font-semibold text-foreground">
                  {drafts.length}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Texto do autor antes da IA.
                </p>
              </div>
            </Link>
            <Link href="/writing">
              <div className="rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-accent/50">
                <div className="text-sm font-medium text-foreground">
                  Escrita IA
                </div>
                <div className="mt-1 text-2xl font-semibold text-foreground">
                  {inDevelopmentChapters.length}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Capítulos gerados ou em correção.
                </p>
              </div>
            </Link>
            <Link href="/review">
              <div className="rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-accent/50">
                <div className="text-sm font-medium text-foreground">
                  Revisão
                </div>
                <div className="mt-1 text-2xl font-semibold text-foreground">
                  {inDevelopmentChapters.length}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Leitura humana antes de virar cânone.
                </p>
              </div>
            </Link>
            <Link href="/export">
              <div className="rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-accent/50">
                <div className="text-sm font-medium text-foreground">
                  Exportação
                </div>
                <div className="mt-1 text-2xl font-semibold text-foreground">
                  {canonicalWords.toLocaleString("pt-BR")}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Palavras canônicas prontas para exportar.
                </p>
              </div>
            </Link>
          </div>
          {discardedChapters.length ? (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {discardedChapters.length} capítulo(s) descartado(s) permanecem
              fora da exportação.
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
