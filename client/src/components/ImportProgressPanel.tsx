import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

export type ImportProgressPhase = "summary" | "sync" | "universe";

const phaseConfig: Record<
  ImportProgressPhase,
  {
    title: string;
    description: string;
    detail: string;
  }
> = {
  summary: {
    title: "Lendo a obra capitulo por capitulo...",
    description:
      "O servidor divide capitulos grandes, le cada bloco inteiro e salva uma memoria factual de ate 1.000 palavras por parte.",
    detail: "Nao extrai personagens nem universo automaticamente.",
  },
  sync: {
    title: "Conectando dossies ao perfil da obra...",
    description:
      "Personagens, timeline, lugares, eventos e regras sao extraidos a partir das memorias por capitulo, nao de um resumo generico.",
    detail: "Acionado manualmente pelo usuario.",
  },
  universe: {
    title: "Atualizando universo e premissa...",
    description:
      "A obra recebe a premissa consolidada, regras de continuidade e contexto para Escrita, Revisao e Analise.",
    detail: "Acionado manualmente pelo usuario.",
  },
};

export function ImportProgressPanel({
  phase,
}: {
  phase: ImportProgressPhase;
}) {
  const config = phaseConfig[phase];
  const [phaseSeconds, setPhaseSeconds] = useState(0);

  useEffect(() => {
    setPhaseSeconds(0);
    const timer = window.setInterval(() => {
      setPhaseSeconds(seconds => seconds + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase]);

  const elapsedLabel = useMemo(() => {
    if (phaseSeconds < 60) return `${phaseSeconds}s`;
    const minutes = Math.floor(phaseSeconds / 60);
    const seconds = String(phaseSeconds % 60).padStart(2, "0");
    return `${minutes}m ${seconds}s`;
  }, [phaseSeconds]);

  return (
    <div
      className="rounded-xl border border-accent/30 bg-card/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 rounded-full border border-accent/30 bg-accent/10 p-2 text-accent">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
          <div className="min-w-0">
            <p className="font-medium leading-tight text-foreground">
              {config.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {config.description}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-bold tabular-nums text-foreground">
            {elapsedLabel}
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            tempo decorrido
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-border bg-secondary/25 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
        {config.detail}
      </div>
    </div>
  );
}
