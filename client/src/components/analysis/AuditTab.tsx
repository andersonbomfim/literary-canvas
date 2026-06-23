import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import { isVisibleAuditIssue } from "@/lib/analysisQuality";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
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
  NarrativeConsistencyIssue,
  NarrativeAuditSeverity,
} from "@shared/narrativeAudit";

/**
 * Aba "Auditoria" da página da Obra.
 *
 * Auditoria aponta o que está ERRADO — contradições, cronologia, conhecimento
 * indevido. Compartilha bolsa de créditos de análise com Melhorias mas tem
 * UI completamente separada para o usuário não confundir os dois conceitos.
 *
 * Estados:
 *   - sem relatório, idle               → mostra "Rode a primeira auditoria"
 *   - com job ativo                     → mostra status + progressMessage
 *   - com último job concluído          → mostra contadores + lista por gravidade
 *   - último job falhou                 → mostra erro + permite retry
 *
 * Polling: enquanto houver job ativo, faz refetch do generationJobs.get a cada
 * 2.5s. Quando o status vira completed/failed/canceled, dispara invalidate
 * de audit.latest para puxar o relatório novo.
 */

export const SEVERITY_ORDER: NarrativeAuditSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
];

type IssuesGrouped = Record<
  NarrativeAuditSeverity,
  NarrativeConsistencyIssue[]
>;

export function groupIssues(issues: NarrativeConsistencyIssue[]): IssuesGrouped {
  const groups: IssuesGrouped = { critical: [], high: [], medium: [], low: [] };
  for (const issue of issues) {
    groups[issue.severity].push(issue);
  }
  return groups;
}

export function countIssues(issues: NarrativeConsistencyIssue[]) {
  return {
    total: issues.length,
    critical: issues.filter(issue => issue.severity === "critical").length,
    high: issues.filter(issue => issue.severity === "high").length,
    medium: issues.filter(issue => issue.severity === "medium").length,
    low: issues.filter(issue => issue.severity === "low").length,
  };
}

export function parseIssuesJson(
  raw: string | null | undefined
): NarrativeConsistencyIssue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isVisibleAuditIssue) : [];
  } catch {
    return [];
  }
}

type AuditTabProps = {
  /** Mensagem amigável quando a obra ainda não tem capítulos suficientes. */
  noBookTextReason?: string | null;
};

export default function AuditTab({ noBookTextReason }: AuditTabProps) {
  const utils = trpc.useUtils();
  const billing = trpc.billing.summary.useQuery();
  const latest = trpc.audit.latest.useQuery();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Polling do job ativo. Refetch a cada 2.5s; quando o status finaliza,
  // limpa o jobId e invalida latest para puxar o relatório recém-criado.
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
      void utils.audit.latest.invalidate();
      void utils.audit.listByWork.invalidate();
      setActiveJobId(null);
    }
  }, [activeJobId, jobQuery.data, utils]);

  const createMutation = trpc.audit.create.useMutation({
    onSuccess: result => {
      setActiveJobId(result.data.jobId);
      toast.success("Auditoria iniciada — análise integral em andamento.");
    },
    onError: error => toast.error(formatApiErrorMessage(error)),
  });

  const report = latest.data?.data ?? null;
  const issues = useMemo(() => parseIssuesJson(report?.issuesJson), [report]);
  const grouped = useMemo(() => groupIssues(issues), [issues]);
  const visibleCounts = useMemo(() => countIssues(issues), [issues]);

  const planTier = billing.data?.data?.subscription?.planTier ?? "free";
  const planAllowed = planTier === "essential" || planTier === "ultra";

  // Status derivado: se temos jobId ativo, usa o status do job; senão
  // mostra o estado do último relatório.
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

  // Mensagem de erro real: prioriza errorMessage (vem do worker com a causa
  // concreta), cai para errorCode (audit_invalid_json, audit_provider_timeout
  // etc) e por último pro progressMessage genérico. Antes só mostrávamos
  // progressMessage, que sempre era "Não foi possível concluir" e o usuário
  // não sabia se foi timeout, JSON inválido, créditos, ou outra coisa.
  const failureMessage =
    jobStatus === "failed"
      ? jobQuery.data?.data?.errorMessage ||
        jobQuery.data?.data?.errorCode ||
        jobQuery.data?.data?.progressMessage ||
        "Falha sem causa conhecida."
      : null;

  return (
    <AnalysisShell
      title="Auditoria de Consistência"
      description="Encontra o que está errado: contradições internas, cronologia quebrada, regras de mundo contraditas, personagem sabendo o que não deveria. Não sugere fortalecimento editorial — para isso, veja a aba Melhorias."
      accent="amber"
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
      planRequiredMessage="A Auditoria de Consistência está disponível nos planos Essential e Ultra. Faça upgrade para auditar a continuidade da sua obra."
      onRun={() => createMutation.mutate(undefined)}
      runDisabledReason={noBookTextReason ?? null}
    >
      {!report && !busy && (
        <div className="text-center text-sm text-muted-foreground py-8">
          Nenhuma auditoria ainda. Quando rodar a primeira, os achados aparecem
          aqui agrupados por gravidade.
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

          {issues.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Relatório recebido sem inconsistências listadas. Se isso parecer
              estranho, rode a auditoria novamente.
            </div>
          ) : (
            <div className="space-y-3">
              {SEVERITY_ORDER.map(severity =>
                grouped[severity].length === 0 ? null : (
                  <div key={severity} className="space-y-2">
                    {grouped[severity].map(issue => (
                      <IssueCard key={issue.id} issue={issue} />
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

export function IssueCard({ issue }: { issue: NarrativeConsistencyIssue }) {
  const [open, setOpen] = useState(false);
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
                  <SeverityPill value={issue.severity} />
                  <span className="text-xs text-muted-foreground capitalize">
                    {issue.category.replace(/_/g, " ")}
                  </span>
                  {issue.primaryLocation.chapter && (
                    <span className="text-xs text-muted-foreground">
                      • {issue.primaryLocation.chapter}
                    </span>
                  )}
                </div>
                <h3 className="mt-1 font-medium text-sm">{issue.title}</h3>
                {issue.problemSummary && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {issue.problemSummary}
                  </p>
                )}
              </div>
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t p-4 space-y-4">
            <ExcerptBlock
              excerpt={issue.primaryLocation.excerpt ?? ""}
              label="Trecho onde aparece"
            />

            {issue.conflictingLocations.map((conflict, idx) => (
              <div key={idx} className="space-y-1">
                <ExcerptBlock
                  excerpt={conflict.excerpt ?? ""}
                  label={`Em conflito com ${conflict.chapter ?? "outro trecho"}`}
                />
                {conflict.explanation && (
                  <p className="text-xs text-muted-foreground pl-3">
                    ↳ {conflict.explanation}
                  </p>
                )}
              </div>
            ))}

            {issue.whyItIsAProblem && (
              <Field label="Por que isso é um problema">
                {issue.whyItIsAProblem}
              </Field>
            )}
            {issue.impactOnStory && (
              <Field label="Impacto na obra">{issue.impactOnStory}</Field>
            )}
            {issue.suggestedFix && (
              <Field label="Solução sugerida" emphasize>
                {issue.suggestedFix}
              </Field>
            )}
            {issue.alternativeFixes && issue.alternativeFixes.length > 0 && (
              <Field label="Alternativas">
                <ul className="list-disc pl-5 space-y-0.5">
                  {issue.alternativeFixes.map((alt, idx) => (
                    <li key={idx}>{alt}</li>
                  ))}
                </ul>
              </Field>
            )}

            <AffectedRow elements={issue.affectedElements} />

            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span>
                Confiança:{" "}
                <strong className="capitalize">{issue.confidence}</strong>
              </span>
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
  elements: NarrativeConsistencyIssue["affectedElements"];
}) {
  const pairs: Array<[string, string[] | undefined]> = [
    ["Personagens", elements.characters],
    ["Facções", elements.factions],
    ["Locais", elements.locations],
    ["Eventos", elements.timelineEvents],
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
