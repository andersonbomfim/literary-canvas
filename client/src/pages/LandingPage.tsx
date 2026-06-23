import { DefaultCoverArt } from "@/components/DefaultCoverArt";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Feather,
  FileText,
  Library,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";

const workflow = [
  { label: "Ideia", value: "Premissa guiada" },
  { label: "Obras", value: "Contexto vivo" },
  { label: "Escrita", value: "Capítulo com memória" },
  { label: "Revisão", value: "Cânone aprovado" },
];

const context = [
  { label: "Universo", status: "carregado", icon: Library },
  { label: "Estilo", status: "ativo", icon: Feather },
  { label: "Rascunho", status: "pronto", icon: FileText },
];

export default function LandingPage() {
  return (
    <main className="literary-ambient min-h-screen overflow-hidden text-foreground">
      <section className="relative min-h-[calc(100svh-56px)] px-4 py-5 sm:px-6 lg:px-8">
        <DefaultCoverArt className="absolute inset-0 h-full w-full opacity-70" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,7,6,0.96)_0%,rgba(8,7,6,0.78)_44%,rgba(8,7,6,0.34)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,7,6,0.46)_0%,rgba(8,7,6,0.18)_48%,rgba(8,7,6,0.92)_100%)]" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-96px)] w-full max-w-7xl flex-col">
          <header className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className="flex items-center gap-3"
              data-microinteraction="off"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/35 bg-background/55 text-accent backdrop-blur">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <div className="font-display text-xl text-foreground">
                  Literary Canvas
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  mesa editorial com IA contextual
                </div>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button
                  variant="outline"
                  className="border-border bg-background/55"
                >
                  Entrar
                </Button>
              </Link>
              <Link href="/register">
                <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
                  Criar conta
                </Button>
              </Link>
            </div>
          </header>

          <div className="grid flex-1 content-center gap-8 py-12 lg:grid-cols-[minmax(0,0.86fr)_minmax(420px,0.64fr)] lg:py-16">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-background/50 px-3 py-1 text-xs uppercase tracking-[0.22em] text-accent backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                escrita com memória de obra
              </div>
              <h1 className="mt-6 max-w-5xl font-display text-5xl leading-[1.02] text-foreground sm:text-6xl lg:text-7xl">
                Literary Canvas
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
                Plataforma editorial para transformar ideias, rascunhos,
                referências e revisão em um cânone claro, contínuo e
                pronta para orientar cada capítulo.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login">
                  <Button
                    size="lg"
                    className="interactive-lift bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    Entrar na mesa
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/register">
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-border bg-background/55"
                  >
                    Criar espaço de escrita
                  </Button>
                </Link>
              </div>
            </div>

            <div className="self-center rounded-lg border border-border/80 bg-background/72 p-4 shadow-[0_28px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-accent">
                    Obra ativa
                  </div>
                  <div className="mt-1 font-display text-xl text-foreground">
                    A próxima cena
                  </div>
                </div>
                <div className="rounded-full border border-emerald-400/40 bg-emerald-500/12 px-3 py-1 text-xs font-medium text-emerald-300">
                  contexto carregado
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <div className="rounded-lg border border-border bg-secondary/45 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">
                      Próxima ação
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Transformar o rascunho bruto em capítulo usando estilo,
                    universo e continuidade ativos.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {context.map(item => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.label}
                        className="rounded-lg border border-border bg-secondary/35 p-3"
                      >
                        <Icon className="h-4 w-4 text-accent" />
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {item.label}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {item.status}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 pb-3 sm:grid-cols-4">
            {workflow.map(item => (
              <div
                key={item.label}
                className="rounded-lg border border-border/70 bg-background/58 px-4 py-3 backdrop-blur"
              >
                <div className="text-xs uppercase tracking-[0.18em] text-accent">
                  {item.label}
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-background px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg">Contexto sem dispersão</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A obra mantém universo, personagens, referências e estilo em um só
              lugar.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg">Fluxo guiado</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Cada etapa deixa claro o que veio antes, onde você está e qual é a
              próxima decisão.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg">Revisão canônica</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Capítulos aprovados alimentam memória e reduzem contradições ao
              longo do livro.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
