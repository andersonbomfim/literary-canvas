import type { ReactNode } from "react";
import {
  BookOpen,
  CheckCircle2,
  Feather,
  Library,
  Sparkles,
} from "lucide-react";
import { DefaultCoverArt } from "@/components/DefaultCoverArt";

type AuthShellProps = {
  title: string;
  subtitle: string;
  eyebrow: string;
  children: ReactNode;
  footer: ReactNode;
};

export function AuthShell({
  title,
  subtitle,
  eyebrow = "Literary Canvas",
  children,
  footer,
}: AuthShellProps) {
  return (
    <main className="literary-ambient min-h-screen overflow-hidden px-4 py-6 text-foreground">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-7xl items-center gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden min-h-[680px] overflow-hidden rounded-lg border border-border/80 shadow-[0_28px_90px_rgba(0,0,0,0.34)] lg:block">
          <DefaultCoverArt className="absolute inset-0 h-full w-full" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/78 via-black/34 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
          <div className="relative z-10 flex min-h-[680px] flex-col justify-between p-8 xl:p-10">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/35 bg-accent/12 text-accent backdrop-blur">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <div className="font-display text-xl text-white">
                  Literary Canvas
                </div>
                <div className="text-xs text-white/55">
                  mesa editorial com IA contextual
                </div>
              </div>
            </div>

            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/70 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                mesa de escrita
              </div>
              <h1 className="mt-5 font-display text-5xl leading-tight text-white xl:text-6xl">
                Da ideia crua à obra canônica
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-white/68">
                Um espaço para organizar premissas, rascunhos, estilo, universo
                e revisão em um fluxo único.
              </p>
            </div>

            <div className="grid max-w-3xl grid-cols-4 gap-3">
              {[
                { label: "Ideias", icon: Sparkles },
                { label: "Rascunho", icon: Feather },
                { label: "Obras", icon: Library },
                { label: "Revisão", icon: CheckCircle2 },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-lg border border-white/12 bg-background/55 px-3 py-3 backdrop-blur"
                  >
                    <Icon className="h-4 w-4 text-accent" />
                    <div className="mt-2 text-sm font-medium text-white">
                      {item.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[470px]">
          <div className="mb-6 flex items-center justify-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/35 bg-accent/12 text-accent">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-xl text-foreground">
                Literary Canvas
              </div>
              <div className="text-xs text-muted-foreground">
                mesa editorial com IA contextual
              </div>
            </div>
          </div>

          <div className="panel-card rounded-lg border p-6 sm:p-7">
            <div className="mb-6 space-y-2">
              <div className="text-xs uppercase tracking-[0.22em] text-accent">
                {eyebrow}
              </div>
              <h1 className="font-display text-3xl leading-tight text-foreground">
                {title}
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                {subtitle}
              </p>
            </div>
            {children}
          </div>

          {footer ? (
            <div className="mt-4 text-center text-sm text-muted-foreground">
              {footer}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
