import type { ReactNode } from "react";
import { ClipboardCheck, FileText, PenLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type EditorialFlowStep = "draft" | "writing" | "review";

type StatusItem = {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
};

const steps = [
  {
    key: "draft" as const,
    label: "Rascunho",
    detail: "matéria-prima",
    icon: FileText,
  },
  {
    key: "writing" as const,
    label: "Escrita",
    detail: "capítulo vivo",
    icon: PenLine,
  },
  {
    key: "review" as const,
    label: "Revisão",
    detail: "qualidade e cânone",
    icon: ClipboardCheck,
  },
];

const toneClasses: Record<NonNullable<StatusItem["tone"]>, string> = {
  neutral: "bg-foreground/8 text-foreground/85",
  accent: "bg-accent/15 text-accent",
  success: "bg-emerald-500/15 text-emerald-300",
  warning: "bg-amber-500/15 text-amber-300",
  danger: "bg-red-500/15 text-red-300",
};

export function EditorialFlowHeader({
  active,
  title,
  subtitle,
  statusItems = [],
  actions,
}: {
  active: EditorialFlowStep;
  title: string;
  subtitle?: string;
  statusItems?: StatusItem[];
  actions?: ReactNode;
}) {
  const activeIndex = steps.findIndex(step => step.key === active);

  return (
    <section className="rounded-md border border-border/70 bg-card/70 px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Fluxo editorial
            </span>
            {statusItems.map(item => (
              <Badge
                key={item.label}
                variant="secondary"
                className={cn(
                  "px-2.5 py-1",
                  toneClasses[item.tone ?? "neutral"]
                )}
              >
                <span className="text-muted-foreground">{item.label}</span>
                <span className="text-foreground">{item.value}</span>
              </Badge>
            ))}
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <h2 className="font-display text-xl text-foreground sm:text-2xl">
              {title}
            </h2>
            {subtitle ? (
              <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.key === active;
            const isPast = index < activeIndex;
            return (
              <div
                key={step.key}
                className={cn(
                  "flex min-h-9 min-w-[112px] items-center gap-2 rounded-md border px-3 py-1.5 transition-colors",
                  isActive
                    ? "border-accent bg-accent/12"
                    : isPast
                      ? "border-emerald-500/25 bg-emerald-500/8"
                      : "border-border bg-secondary/35"
                  )}
                >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md border",
                    isActive
                      ? "border-accent/50 bg-accent text-accent-foreground"
                      : isPast
                        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                        : "border-border bg-card text-muted-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {step.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      0{index + 1}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {actions ? (
            <div className="ml-auto flex flex-wrap gap-2">{actions}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
