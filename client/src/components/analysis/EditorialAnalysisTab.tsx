import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, Play, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatApiErrorMessage } from "@/lib/errorMessage";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AnalysisJobStatus,
  SeverityCounters,
} from "./AnalysisShell";
import {
  IssueCard,
  countIssues,
  groupIssues,
  parseIssuesJson,
  SEVERITY_ORDER,
} from "./AuditTab";
import {
  SuggestionCard,
  countSuggestions,
  groupSuggestions,
  parseSuggestionsJson,
  PRIORITY_ORDER,
} from "./ImprovementsTab";

type EditorialAnalysisTabProps = {
  noBookTextReason?: string | null;
};

type AnalysisCoverageDossier = {
  key: string;
  index: number;
  title: string;
  wordCount: number;
};

type AnalysisCoverageItem = {
  index: number;
  title: string;
  source: "chapter" | "reference";
  wordCount: number;
  dossierCount: number;
  dossiers: AnalysisCoverageDossier[];
};

type AnalysisCoverage = {
  totalWords: number;
  totalItems: number;
  chapterCount: number;
  referencePartCount: number;
  dossierCount: number;
  items: AnalysisCoverageItem[];
  dossiers: AnalysisCoverageDossier[];
};

const RUNNING_STATUSES = ["queued", "preparing", "generating", "finalizing"];

const STATUS_LABEL: Record<AnalysisJobStatus, string> = {
  idle: "Pronto",
  queued: "Na fila",
  preparing: "Preparando",
  generating: "Analisando",
  finalizing: "Compilando",
  completed: "Concluído",
  failed: "Falhou",
  canceled: "Cancelado",
};

function statusTone(status: AnalysisJobStatus) {
  if (status === "completed") return "bg-emerald-500/10 text-emerald-400";
  if (status === "failed") return "bg-red-500/10 text-red-400";
  if (RUNNING_STATUSES.includes(status)) return "bg-amber-500/10 text-amber-400";
  return "bg-muted text-muted-foreground";
}

function statusIcon(status: AnalysisJobStatus, busy: boolean) {
  if (busy) return <Loader2 className="h-3 w-3 animate-spin" />;
  if (status === "completed") return <CheckCircle2 className="h-3 w-3" />;
  if (status === "failed") return <AlertCircle className="h-3 w-3" />;
  return null;
}

function deriveStatus(jobStatus: AnalysisJobStatus | null, hasReport: boolean): AnalysisJobStatus {
  if (jobStatus && RUNNING_STATUSES.includes(jobStatus)) return jobStatus;
  if (jobStatus === "failed") return "failed";
  if (jobStatus === "canceled") return "canceled";
  return hasReport ? "completed" : "idle";
}

export default function EditorialAnalysisTab({
  noBookTextReason,
}: EditorialAnalysisTabProps) {
  const utils = trpc.useUtils();
  const billing = trpc.billing.summary.useQuery();
  const auditLatest = trpc.audit.latest.useQuery();
  const improvementsLatest = trpc.improvements.latest.useQuery();
  const sourceCoverage = trpc.improvements.sourceCoverage.useQuery();
  const [auditJobId, setAuditJobId] = useState<string | null>(null);
  const [improvementJobId, setImprovementJobId] = useState<string | null>(null);

  const auditJobQuery = trpc.generationJobs.get.useQuery(
    { jobId: auditJobId ?? "" },
    { enabled: Boolean(auditJobId), refetchInterval: auditJobId ? 2500 : false }
  );
  const improvementJobQuery = trpc.generationJobs.get.useQuery(
    { jobId: improvementJobId ?? "" },
    { enabled: Boolean(improvementJobId), refetchInterval: improvementJobId ? 2500 : false }
  );

  useEffect(() => {
    const status = auditJobQuery.data?.data?.status;
    if (!auditJobId || !status) return;
    if (["completed", "failed", "canceled"].includes(status)) {
      void utils.audit.latest.invalidate();
      void utils.audit.listByWork.invalidate();
      setAuditJobId(null);
    }
  }, [auditJobId, auditJobQuery.data, utils]);

  useEffect(() => {
    const status = improvementJobQuery.data?.data?.status;
    if (!improvementJobId || !status) return;
    if (["completed", "failed", "canceled"].includes(status)) {
      void utils.improvements.latest.invalidate();
      void utils.improvements.listByWork.invalidate();
      setImprovementJobId(null);
    }
  }, [improvementJobId, improvementJobQuery.data, utils]);

  const auditMutation = trpc.audit.create.useMutation({
    onSuccess: result => setAuditJobId(result.data.jobId),
  });
  const improvementsMutation = trpc.improvements.create.useMutation({
    onSuccess: result => setImprovementJobId(result.data.jobId),
  });

  const auditReport = auditLatest.data?.data ?? null;
  const improvementReport = improvementsLatest.data?.data ?? null;
  const issues = useMemo(() => parseIssuesJson(auditReport?.issuesJson), [auditReport]);
  const suggestions = useMemo(
    () => parseSuggestionsJson(improvementReport?.suggestionsJson),
    [improvementReport]
  );
  const issueGroups = useMemo(() => groupIssues(issues), [issues]);
  const suggestionGroups = useMemo(() => groupSuggestions(suggestions), [suggestions]);
  const issueCounts = useMemo(() => countIssues(issues), [issues]);
  const suggestionCounts = useMemo(() => countSuggestions(suggestions), [suggestions]);

  const planTier = billing.data?.data?.subscription?.planTier ?? "free";
  const planAllowed = planTier === "essential" || planTier === "ultra";

  const auditJobStatus = (auditJobQuery.data?.data?.status ?? null) as AnalysisJobStatus | null;
  const improvementJobStatus = (improvementJobQuery.data?.data?.status ?? null) as AnalysisJobStatus | null;
  const auditStatus = deriveStatus(auditJobStatus, Boolean(auditReport));
  const improvementStatus = deriveStatus(improvementJobStatus, Boolean(improvementReport));
  const auditBusy = RUNNING_STATUSES.includes(auditStatus);
  const improvementBusy = RUNNING_STATUSES.includes(improvementStatus);
  const busy = auditBusy || improvementBusy || auditMutation.isPending || improvementsMutation.isPending;
  const disabledReason = noBookTextReason || (!planAllowed ? "Plano atual sem acesso à análise editorial." : null);

  const runAudit = () => auditMutation.mutate(undefined, {
    onError: error => toast.error(formatApiErrorMessage(error)),
  });
  const runImprovements = () => improvementsMutation.mutate(undefined, {
    onError: error => toast.error(formatApiErrorMessage(error)),
  });
  const runAll = async () => {
    const key = Date.now();
    try {
      const [auditResult, improvementResult] = await Promise.all([
        auditMutation.mutateAsync({ idempotencyKey: `editorial:${key}:consistency` }),
        improvementsMutation.mutateAsync({ idempotencyKey: `editorial:${key}:strength` }),
      ]);
      setAuditJobId(auditResult.data.jobId);
      setImprovementJobId(improvementResult.data.jobId);
      toast.success("Análise editorial iniciada.");
    } catch (error) {
      toast.error(formatApiErrorMessage(error));
    }
  };

  const auditFailure =
    auditStatus === "failed"
      ? auditJobQuery.data?.data?.errorMessage ||
        auditJobQuery.data?.data?.errorCode ||
        auditJobQuery.data?.data?.progressMessage
      : null;
  const improvementFailure =
    improvementStatus === "failed"
      ? improvementJobQuery.data?.data?.errorMessage ||
        improvementJobQuery.data?.data?.errorCode ||
        improvementJobQuery.data?.data?.progressMessage
      : null;
  const coverage = (sourceCoverage.data?.data ?? null) as AnalysisCoverage | null;

  return (
    <div className="space-y-4">
      <Card className="border border-border bg-gradient-to-br from-accent/10 to-transparent p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-accent">
              <Sparkles className="h-4 w-4" />
              Análise editorial
            </div>
            <h2 className="mt-2 font-display text-2xl text-foreground">
              Um painel para qualidade da obra
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Consistência e fortalecimento ficam juntos. O sistema separa o que
              é erro factual do que é oportunidade narrativa, mas a decisão fica
              na mesma tela.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={runAll}
              disabled={busy || Boolean(disabledReason)}
              title={disabledReason ?? undefined}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Rodar análise editorial
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runAudit}
              disabled={busy || Boolean(disabledReason)}
              title={disabledReason ?? undefined}
            >
              Consistência
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runImprovements}
              disabled={busy || Boolean(disabledReason)}
              title={disabledReason ?? undefined}
            >
              Fortalecimento
            </Button>
          </div>
        </div>

        {disabledReason ? (
          <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
            {disabledReason}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <StatusCard
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Consistência"
            status={auditStatus}
            busy={auditBusy}
            message={auditJobQuery.data?.data?.progressMessage}
            error={auditFailure}
          />
          <StatusCard
            icon={<Sparkles className="h-4 w-4" />}
            label="Fortalecimento"
            status={improvementStatus}
            busy={improvementBusy}
            message={improvementJobQuery.data?.data?.progressMessage}
            error={improvementFailure}
          />
        </div>

        {coverage ? <AnalysisCoveragePanel coverage={coverage} /> : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-4 border border-border bg-card p-4">
          <SectionTitle
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Consistência"
            description="Contradições, cronologia, conhecimento indevido e regra quebrada."
          />
          <SeverityCounters
            total={issueCounts.total}
            critical={issueCounts.critical}
            high={issueCounts.high}
            medium={issueCounts.medium}
            low={issueCounts.low}
          />
          {issues.length ? (
            <div className="space-y-3">
              {SEVERITY_ORDER.map(severity =>
                issueGroups[severity].length ? (
                  <div key={severity} className="space-y-2">
                    {issueGroups[severity].map(issue => (
                      <IssueCard key={issue.id} issue={issue} />
                    ))}
                  </div>
                ) : null
              )}
            </div>
          ) : (
            <EmptyReport message="Nenhum achado de consistência válido no relatório atual." />
          )}
        </Card>

        <Card className="space-y-4 border border-border bg-card p-4">
          <SectionTitle
            icon={<RefreshCw className="h-4 w-4" />}
            title="Fortalecimento"
            description="Arcos, payoff, consequência de cena e oportunidades estruturais."
          />
          <SeverityCounters
            total={suggestionCounts.total}
            critical={suggestionCounts.critical}
            high={suggestionCounts.high}
            medium={suggestionCounts.medium}
            low={suggestionCounts.low}
          />
          {suggestions.length ? (
            <div className="space-y-3">
              {PRIORITY_ORDER.map(priority =>
                suggestionGroups[priority].length ? (
                  <div key={priority} className="space-y-2">
                    {suggestionGroups[priority].map(suggestion => (
                      <SuggestionCard key={suggestion.id} suggestion={suggestion} />
                    ))}
                  </div>
                ) : null
              )}
            </div>
          ) : (
            <EmptyReport message="Nenhuma melhoria estrutural válida no relatório atual." />
          )}
        </Card>
      </div>
    </div>
  );
}

function formatCount(value: number) {
  return value.toLocaleString("pt-BR");
}

function AnalysisCoveragePanel({ coverage }: { coverage: AnalysisCoverage }) {
  const dossierList = coverage.dossiers.length
    ? coverage.dossiers
    : coverage.items
        .filter(item => item.source === "reference")
        .map(item => ({
          key: String(item.index),
          index: item.index,
          title: item.title,
          wordCount: item.wordCount,
        }));
  const visibleDossiers = dossierList.slice(0, 120);

  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-background/35 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="h-4 w-4 text-accent" />
            Fonte analisada
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Auditoria e Fortalecimento recebem a mesma base:{" "}
            <strong className="font-medium text-foreground">
              {formatCount(coverage.totalWords)} palavras
            </strong>
            , {formatCount(coverage.chapterCount)} capítulo(s) escrito(s),{" "}
            {formatCount(coverage.dossierCount)} dossiê(s) importado(s) em{" "}
            {formatCount(coverage.referencePartCount)} parte(s) de leitura.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
          <CheckCircle2 className="h-3.5 w-3.5" />
          base completa
        </span>
      </div>

      <details className="mt-3 group">
        <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          Ver dossiês e partes usadas como fonte
        </summary>
        <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-border/60 bg-background/45">
          {visibleDossiers.length ? (
            <div className="divide-y divide-border/50">
              {visibleDossiers.map(dossier => (
                <div key={dossier.key} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="mr-2 text-muted-foreground">
                      {String(dossier.index).padStart(2, "0")}
                    </span>
                    <span className="text-foreground/90">{dossier.title}</span>
                  </div>
                  <span className="shrink-0 text-muted-foreground">
                    {formatCount(dossier.wordCount)} palavras
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              Nenhum dossiê importado detectado; a análise usa apenas capítulos escritos.
            </div>
          )}
          {dossierList.length > visibleDossiers.length ? (
            <div className="border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
              Mais {formatCount(dossierList.length - visibleDossiers.length)} dossiê(s) oculto(s) para manter a tela leve.
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  status,
  busy,
  message,
  error,
}: {
  icon: ReactNode;
  label: string;
  status: AnalysisJobStatus;
  busy: boolean;
  message?: string | null;
  error?: string | null;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${statusTone(status)}`}>
          {statusIcon(status, busy)}
          {STATUS_LABEL[status]}
        </span>
      </div>
      {busy && message ? (
        <p className="mt-2 text-xs text-muted-foreground">{message}</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      ) : null}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 font-display text-xl text-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function EmptyReport({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-5 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
