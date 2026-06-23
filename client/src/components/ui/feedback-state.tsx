import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type FeedbackStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

function EmptyState({
  title,
  description,
  action,
  className,
}: FeedbackStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-secondary/20 p-6 text-center",
        className
      )}
    >
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

function InlineError({
  title,
  description,
  action,
  className,
}: FeedbackStateProps) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border border-destructive/35 bg-destructive/10 p-4 text-sm",
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div>
        <div className="font-medium text-foreground">{title}</div>
        {description ? (
          <p className="mt-1 leading-6 text-muted-foreground">{description}</p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

function SavingIndicator({ label = "Salvando" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/55 px-2.5 py-1 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin text-accent" />
      {label}
    </span>
  );
}

function PageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6", className)}
      aria-label="Carregando"
    >
      <div className="h-7 w-56 rounded-md bg-secondary/70 animate-pulse" />
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="h-56 rounded-lg border border-border bg-secondary/35 animate-pulse" />
        <div className="h-56 rounded-lg border border-border bg-secondary/35 animate-pulse" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-28 rounded-lg border border-border bg-secondary/30 animate-pulse" />
        <div className="h-28 rounded-lg border border-border bg-secondary/30 animate-pulse" />
        <div className="h-28 rounded-lg border border-border bg-secondary/30 animate-pulse" />
      </div>
    </div>
  );
}

export { EmptyState, InlineError, PageSkeleton, SavingIndicator };
