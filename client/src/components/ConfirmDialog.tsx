import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";

type ConfirmDialogProps = {
  /** Texto do título (ex.: "Excluir rascunho?"). */
  title: string;
  /** Descrição opcional acima dos botões. Aceita string ou ReactNode. */
  description?: React.ReactNode;
  /** Texto do botão de confirmação. Default: "Confirmar". */
  confirmLabel?: string;
  /** Texto do botão de cancelar. Default: "Cancelar". */
  cancelLabel?: string;
  /** Quando true, o botão de confirmação fica vermelho (destrutivo). */
  destructive?: boolean;
  /** Estado controlado: open. */
  open: boolean;
  /** Estado controlado: setOpen (chamado com false ao cancelar/confirmar). */
  onOpenChange: (open: boolean) => void;
  /** Callback ao confirmar. Pode ser async — o botão mostra loader e desabilita até resolver. */
  onConfirm: () => Promise<void> | void;
};

/**
 * AlertDialog padronizado para ações destrutivas e confirmações.
 * Substitui `window.confirm` por um fluxo visual consistente e sem bloqueio
 * da thread principal.
 *
 * Uso básico:
 *
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Excluir rascunho?"
 *     description={`Esta ação não pode ser desfeita.`}
 *     destructive
 *     onConfirm={async () => { await deleteMutation.mutateAsync({...}); }}
 *   />
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  open,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    try {
      setBusy(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={event => {
              event.preventDefault();
              void handleConfirm();
            }}
            disabled={busy}
            className={
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
