import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import { isVisibleImprovementSuggestion } from "@/lib/analysisQuality";
import { trpc } from "@/lib/trpc";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AnalysisShell,
  ExcerptBlock,
  SeverityCounters,
  SeverityPill,
  type AnalysisJobStatus,
} from "./AnalysisShell";
import type {
  NarrativeImprovementPriority,
  NarrativeImprovementSuggestion,
} from "@shared/narrativeImprovements";

/**
 * Aba "Melhorias" da página da Obra.
 *
 * Melhorias aponta o que pode ficar mais FORTE — arcos, promessas, ritmo,
 * tensão, motivação, núcleo, regras de mundo, consequências, tom.
 * NÃO é o mesmo que Auditoria (que aponta o que está ERRADO).
 *
 * Compartilha bolsa de créditos de análise com Auditoria, mas o ledger
 * distingue. UI completamente paralela para não confundir os dois conceitos
 * no usuário.
 */

export const PRIORITY_ORDER: NarrativeImprovementPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

const CATEGORY_LABEL: Record<string, string> = {
  character_arc: "Arco de personagem",
  narrative_promise: "Promessa narrativa",
  political_core: "Núcleo político",
  character_function: "Função do personagem",
  motivation: "Motivação",
  pacing: "Ritmo",
  dramatic_tension: "Tensão dramática",
  abandoned_conflict: "Conflito abandonado",
  worldbuilding_rule: "Regra de mundo",
  scene_consequence: "Consequência de cena",
  tone: "Tom",
  other: "Outro",
};

type SuggestionsGrouped = Record<
  NarrativeImprovementPriority,
  NarrativeImprovementSuggestion[]
>;

export function groupSuggestions(
  suggestions: NarrativeImprovementSuggestion[]
): SuggestionsGrouped {
  const groups: SuggestionsGrouped = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };
  for (const s of suggestions) groups[s.priority].push(s);
  return groups;
}

export function countSuggestions(suggestions: NarrativeImprovementSuggestion[]) {
  return {
    total: suggestions.length,
    critical: suggestions.filter(s => s.priority === "critical").length,
    high: suggestions.filter(s => s.priority === "high").length,
    medium: suggestions.filter(s => s.priority === "medium").length,
    low: suggestions.filter(s => s.priority === "low").length,
  };
}

export function parseSuggestionsJson(
  raw: string | null | undefined
): NarrativeImprovementSuggestion[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isVisibleImprovementSuggestion)
      : [];
  } catch {
    return [];
  }
}

type ImprovementsTabProps = {
  noBookTextReason?: string | null;
};

export default function ImprovementsTab({
  noBookTextReason,
}: ImprovementsTabProps) {
  const utils = trpc.useUtils();
  const billing = trpc.billing.summary.useQuery();
  const latest = trpc.improvements.latest.useQuery();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const jobQuery = trpc.generationJobs.get.useQuery(
    { jobId: activeJobId ?? "" },
    {
      enabled: Boolean(activeJobId),
      refetchInterval: activeJobId ? 2500 : false,
    }
  );

  useEffect(() => {
    const status = jobQuery.data?.data?.status;
    if (!activeJobId || !status) return;
    if (
      status === "completed" ||
      status === "failed" ||
      status === "canceled"
    ) {
      void utils.improvements.latest.invalidate();
      void utils.improvements.listByWork.invalidate();
      setActiveJobId(null);
    }
  }, [activeJobId, jobQuery.data, utils]);

  const createMutation = trpc.improvements.create.useMutation({
    onSuccess: result => {
      setActiveJobId(result.data.jobId);
      toast.success(
        "Análise editorial iniciada — leitura integral em andamento."
      );
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const report = latest.data?.data ?? null;
  const suggestions = useMemo(
    () => parseSuggestionsJson(report?.suggestionsJson),
    [report]
  );
  const grouped = useMemo(() => groupSuggestions(suggestions), [suggestions]);
  const visibleCounts = useMemo(() => countSuggestions(suggestions), [suggestions]);

  const planTier = billing.data?.data?.subscription?.planTier ?? "free";
  const planAllowed = planTier === "essential" || planTier === "ultra";

  const jobStatus = (jobQuery.data?.data?.status ??
    null) as AnalysisJobStatus | null;
  const busy = Boolean(
    activeJobId &&
      jobStatus &&
      ["queued", "preparing", "generating", "finalizing"].includes(jobStatus)
  );
  const status: AnalysisJobStatus = busy
    ? (jobStatus ?? "queued")
    : jobStatus === "failed"
      ? "failed"
      : report
        ? "completed"
        : "idle";

  // Mesma lógica de fallback de erro do AuditTab.
  const failureMessage =
    jobStatus === "failed"
      ? jobQuery.data?.data?.errorMessage ||
        jobQuery.data?.data?.errorCode ||
        jobQuery.data?.data?.progressMessage ||
        "Falha sem causa conhecida."
      : null;

  return (
    <AnalysisShell
      title="Melhorias Narrativas"
      description="Sugere o que pode ficar mais forte na obra: arcos esmorecendo, promessas sem payoff, núcleo político desaparecendo, regras de mundo subutilizadas, consequências de cena sem eco. NÃO aponta contradições; para isso, veja a aba Auditoria."
      accent="indigo"
      busy={busy}
      status={status}
      progressMessage={
        busy
          ? (jobQuery.data?.data?.progressMessage ?? "Lendo a obra…")
          : undefined
      }
      lastRunAt={report?.createdAt ?? null}
      errorMessage={failureMessage}
      estimatedCost={report?.wordCount ?? null}
      planAllowed={planAllowed}
      planRequiredMessage="As Melhorias Narrativas estão disponíveis nos planos Essential e Ultra. Faça upgrade para receber sugestões editoriais sobre a sua obra."
      onRun={() => createMutation.mutate(undefined)}
      runDisabledReason={noBookTextReason ?? null}
    >
      {!report && !busy && (
        <div className="text-center text-sm text-muted-foreground py-8">
          Nenhuma análise de melhorias ainda. Quando rodar a primeira, as
          sugestões aparecem aqui agrupadas por prioridade.
        </div>
      )}

      {report && (
        <div className="space-y-4">
          <SeverityCounters
            total={visibleCounts.total}
            critical={visibleCounts.critical}
            high={visibleCounts.high}
            medium={visibleCounts.medium}
            low={visibleCounts.low}
          />

          {suggestions.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Relatório recebido sem sugestões listadas. Se isso parecer
              estranho, rode a análise novamente.
            </div>
          ) : (
            <div className="space-y-3">
              {PRIORITY_ORDER.map(priority =>
                grouped[priority].length === 0 ? null : (
                  <div key={priority} className="space-y-2">
                    {grouped[priority].map(suggestion => (
                      <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}
    </AnalysisShell>
  );
}

export function SuggestionCard({
  suggestion,
}: {
  suggestion: NarrativeImprovementSuggestion;
}) {
  const [open, setOpen] = useState(false);
  const primaryAnchor = suggestion.anchors[0];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-start gap-3 min-w-0">
              {open ? (
                <ChevronDown className="h-4 w-4 shrink-0 mt-1 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 mt-1 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityPill value={suggestion.priority} />
                  <span className="text-xs text-muted-foreground">
                    {CATEGORY_LABEL[suggestion.category] ?? suggestion.category}
                  </span>
                  {primaryAnchor?.chapter && (
                    <span className="text-xs text-muted-foreground">
                      • {primaryAnchor.chapter}
                    </span>
                  )}
                </div>
                <h3 className="mt-1 font-medium text-sm">{suggestion.title}</h3>
                {suggestion.summary && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {suggestion.summary}
                  </p>
                )}
              </div>
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t p-4 space-y-4">
            {suggestion.anchors.map((anchor, idx) => (
              <ExcerptBlock
                key={idx}
                excerpt={anchor.excerpt ?? ""}
                label={
                  anchor.chapter
                    ? `Em ${anchor.chapter}${anchor.scene ? ` • ${anchor.scene}` : ""}`
                    : "Trecho"
                }
              />
            ))}

            {suggestion.whyItWeakens && (
              <Field label="Por que isso enfraquece a obra">
                {suggestion.whyItWeakens}
              </Field>
            )}
            {suggestion.impactOnWork && (
              <Field label="Impacto na obra">{suggestion.impactOnWork}</Field>
            )}
            {suggestion.suggestedFix && (
              <Field label="Sugestão concreta" emphasize>
                {suggestion.suggestedFix}
              </Field>
            )}
            {suggestion.exampleAdjustment && (
              <Field label="Exemplo de ajuste">
                {suggestion.exampleAdjustment}
              </Field>
            )}
            {suggestion.alternativeFixes &&
              suggestion.alternativeFixes.length > 0 && (
                <Field label="Alternativas">
                  <ul className="list-disc pl-5 space-y-0.5">
                    {suggestion.alternativeFixes.map((alt, idx) => (
                      <li key={idx}>{alt}</li>
                    ))}
                  </ul>
                </Field>
              )}

            <AffectedRow elements={suggestion.affectedElements} />

            <div className="text-xs text-muted-foreground">
              Confiança:{" "}
              <strong className="capitalize">{suggestion.confidence}</strong>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function Field({
  label,
  children,
  emphasize,
}: {
  label: string;
  children: React.ReactNode;
  emphasize?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
        {label}
      </div>
      <div
        className={
          emphasize
            ? "text-sm font-medium leading-relaxed"
            : "text-sm leading-relaxed"
        }
      >
        {children}
      </div>
    </div>
  );
}

function AffectedRow({
  elements,
}: {
  elements: NarrativeImprovementSuggestion["affectedElements"];
}) {
  const pairs: Array<[string, string[] | undefined]> = [
    ["Personagens", elements.characters],
    ["Facções", elements.factions],
    ["Locais", elements.locations],
    ["Arcos", elements.arcs],
    ["Promessas/Payoffs", elements.promisesOrPayoffs],
    ["Poderes/Regras", elements.powersOrRules],
  ];
  const hasAny = pairs.some(([, arr]) => arr && arr.length > 0);
  if (!hasAny) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {pairs.map(([label, arr]) =>
        arr && arr.length > 0 ? (
          <span key={label}>
            <strong className="font-medium text-foreground/80">{label}:</strong>{" "}
            {arr.join(", ")}
          </span>
        ) : null
      )}
    </div>
  );
}
