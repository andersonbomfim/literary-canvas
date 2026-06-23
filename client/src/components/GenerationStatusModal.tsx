import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, XCircle } from "lucide-react";

type GenerationStatus =
  | "queued"
  | "preparing"
  | "generating"
  | "finalizing"
  | "completed"
  | "failed"
  | "canceled";

type GenerationStatusModalProps = {
  open: boolean;
  status?: GenerationStatus;
  engine?: string | null;
  message?: string | null;
  reservedCredits?: number | null;
  generatedWordCount?: number | null;
  canCancel?: boolean;
  onCancel?: () => void;
  onClose?: () => void;
};

const statusLabels: Record<GenerationStatus, string> = {
  queued: "Na fila",
  preparing: "Preparando contexto",
  generating: "Escrevendo capítulo",
  finalizing: "Finalizando",
  completed: "Concluído",
  failed: "Falhou",
  canceled: "Cancelado",
};

const statusProgress: Record<GenerationStatus, number> = {
  queued: 18,
  preparing: 36,
  generating: 68,
  finalizing: 88,
  completed: 100,
  failed: 100,
  canceled: 100,
};

function getEngineLabel(engine?: string | null) {
  if (engine?.startsWith("deepseek")) return "DeepSeek";
  if (engine === "runpod_4090") return "RunPod 4090";
  return "IA";
}

export function GenerationStatusModal({
  open,
  status = "queued",
  engine,
  message,
  reservedCredits,
  generatedWordCount,
  canCancel,
  onCancel,
  onClose,
}: GenerationStatusModalProps) {
  const terminal = status === "failed" || status === "canceled";
  const progress = statusProgress[status] ?? 12;
  const engineLabel = getEngineLabel(engine);

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && terminal) onClose?.();
      }}
    >
      <DialogContent
        className="border-border bg-card/95 sm:max-w-xl"
        showCloseButton={terminal}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {terminal
              ? statusLabels[status]
              : `Gerando capítulo com ${engineLabel}`}
          </DialogTitle>
          <DialogDescription>
            {message ||
              `${engineLabel} está trabalhando com o rascunho, estilo e contexto da obra.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 rounded-lg border border-border bg-secondary/40 p-5">
          <div className="flex items-center gap-3">
            {terminal ? (
              <XCircle className="h-5 w-5 text-red-300" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            )}
            <div>
              <div className="font-medium text-foreground">
                {statusLabels[status]}
              </div>
              <div className="text-xs text-muted-foreground">
                A tela pode ficar aberta enquanto o job termina.
              </div>
            </div>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-background/70">
            <div
              className={`h-full rounded-full transition-all duration-500 ${terminal ? "bg-red-400" : "bg-accent"}`}
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border/70 bg-background/55 p-3">
              <div className="text-xs text-muted-foreground">Reserva</div>
              <div className="mt-1 font-medium text-foreground">
                {reservedCredits ?? 0} créditos narrativos
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/55 p-3">
              <div className="text-xs text-muted-foreground">Geradas</div>
              <div className="mt-1 font-medium text-foreground">
                {generatedWordCount ?? 0} palavras
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          {terminal ? (
            <Button type="button" variant="outline" onClick={onClose}>
              Fechar
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={!canCancel}
              onClick={onCancel}
            >
              Cancelar geração
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
