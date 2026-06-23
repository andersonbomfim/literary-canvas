import { AlertTriangle, Lock, Pause } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useActiveWork } from "@/_core/hooks/useActiveWork";
import { Button } from "@/components/ui/button";

const INACTIVE_STATUSES = new Set(["paused", "completed", "archived"]);

const statusConfig = {
  paused: {
    icon: Pause,
    title: "Obra pausada",
    message:
      "Retome a obra em Obras antes de editar, gerar ou revisar conteúdo.",
    color: "border-amber-500/30 bg-amber-500/5 text-amber-300",
    iconColor: "text-amber-400",
  },
  completed: {
    icon: Lock,
    title: "Obra concluída",
    message:
      "Esta obra foi marcada como concluída. Para editar, altere o status em Obras.",
    color: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
    iconColor: "text-emerald-400",
  },
  archived: {
    icon: Lock,
    title: "Obra arquivada",
    message: "Esta obra está arquivada e disponível apenas para leitura.",
    color: "border-border/70 bg-foreground/8 text-foreground/80",
    iconColor: "text-foreground/70",
  },
} as const;

type Props = {
  /** If true, render children with a disabled overlay instead of blocking entirely */
  softBlock: boolean;
  children: ReactNode;
};

/**
 * Wraps page content and blocks interaction when the active work is in an inactive status.
 * Use on pages where editing/creating content should be gated (Draft, Writing, Review, etc).
 */
export function WorkStatusGate({ softBlock = false, children }: Props) {
  const { activeWork } = useActiveWork();

  if (!activeWork) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Nenhuma obra ativa
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie uma obra pela mesa ou selecione uma obra existente.
          </p>
        </div>
        <Link href="/works">
          <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
            Criar obra
          </Button>
        </Link>
      </div>
    );
  }

  const status = activeWork?.status as string;
  if (!INACTIVE_STATUSES.has(status)) {
    return <>{children}</>;
  }

  const config = statusConfig[status as keyof typeof statusConfig];
  if (!config) return <>{children}</>;

  const Icon = config.icon;

  if (softBlock) {
    return (
      <div>
        <div
          className={`mb-4 flex items-center gap-3 rounded-lg border p-4 ${config.color}`}
        >
          <Icon className={`h-5 w-5 shrink-0 ${config.iconColor}`} />
          <div className="flex-1">
            <div className="text-sm font-semibold">{config.title}</div>
            <div className="text-xs opacity-80">{config.message}</div>
          </div>
          <Link href="/works">
            <Button variant="outline" size="sm">
              Gerenciar
            </Button>
          </Link>
        </div>
        <div className="pointer-events-none opacity-50">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <Icon className={`h-10 w-10 ${config.iconColor}`} />
      <div>
        <h3 className="text-lg font-semibold text-foreground">
          {config.title}
        </h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {config.message}
        </p>
      </div>
      <Link href="/works">
        <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
          Gerenciar obra
        </Button>
      </Link>
    </div>
  );
}
