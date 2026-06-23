import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Play,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

/**
 * Shell reutilizado por AuditTab e ImprovementsTab.
 *
 * Mostra o cabeçalho do módulo (título + descrição), o card de status
 * (badge + última execução + botão "Rodar análise") e o slot para renderizar
 * o relatório/lista de achados. As duas telas têm shapes diferentes (issues
 * com primaryLocation+conflictingLocations VS suggestions com anchors), mas
 * compartilham toda a moldura — header, gating, status, ações.
 */

export type AnalysisJobStatus =
  | "idle" // nunca rodou ou último job concluído sem job ativo
  | "queued"
  | "preparing"
  | "generating"
  | "finalizing"
  | "completed"
  | "failed"
  | "canceled";

type AnalysisShellProps = {
  /** Texto curto em destaque (ex.: "Auditoria de Consistência"). */
  title: string;
  /** Subtexto descritivo (1-2 frases). */
  description: string;
  /** Cor dominante do título — só para dar identidade visual entre os módulos. */
  accent?: "amber" | "indigo";
  /** Está rodando algo? (queued/preparing/generating/finalizing) */
  busy: boolean;
  /** Status do último job conhecido. */
  status: AnalysisJobStatus;
  /** Mensagem de progresso atual (do worker). */
  progressMessage?: string;
  /** Quando foi a última execução bem-sucedida. Pode ser null. */
  lastRunAt?: Date | null;
  /** Mensagem de erro do último job, se falhou. */
  errorMessage?: string | null;
  /** Quantos créditos de análise vão ser cobrados ao rodar (wordCount). */
  estimatedCost?: number | null;
  /** Plano do usuário tem acesso? */
  planAllowed: boolean;
  /** Mensagem amigável quando plano não permite. */
  planRequiredMessage: string;
  /** Handler do botão principal. */
  onRun: () => void;
  /** Quando true, esconde "Rodar análise" — usado quando obra não tem texto. */
  runDisabledReason?: string | null;
  /** Conteúdo do relatório (lista de achados). */
  children: ReactNode;
};

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

const STATUS_TONE: Record<AnalysisJobStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  queued: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  preparing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  generating: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  finalizing: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
  canceled: "bg-muted text-muted-foreground",
};

const ACCENT_RING: Record<NonNullable<AnalysisShellProps["accent"]>, string> = {
  amber: "from-amber-500/15 to-transparent",
  indigo: "from-indigo-500/15 to-transparent",
};

function formatDate(date: Date | null | undefined) {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });
}

export function AnalysisShell({
  title,
  description,
  accent = "amber",
  busy,
  status,
  progressMessage,
  lastRunAt,
  errorMessage,
  estimatedCost,
  planAllowed,
  planRequiredMessage,
  onRun,
  runDisabledReason,
  children,
}: AnalysisShellProps) {
  const showRunCta = !busy;
  const showProgress = busy && progressMessage;
  const showError = status === "failed" && errorMessage;

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border bg-gradient-to-br ${ACCENT_RING[accent]} p-4`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              {description}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[status]}`}
            >
              {status === "completed" && <CheckCircle2 className="h-3 w-3" />}
              {status === "failed" && <AlertCircle className="h-3 w-3" />}
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {STATUS_LABEL[status]}
            </span>
            {lastRunAt && (
              <span className="text-xs text-muted-foreground">
                Última execução: {formatDate(lastRunAt)}
              </span>
            )}
          </div>
        </div>

        {showProgress && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>{progressMessage}</span>
          </div>
        )}

        {showError && (
          <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            <strong className="mr-1">Falha:</strong>
            {errorMessage}
          </div>
        )}

        {!planAllowed && (
          <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm">
            {planRequiredMessage}
          </div>
        )}

        {showRunCta && planAllowed && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={onRun}
              disabled={Boolean(runDisabledReason)}
              title={runDisabledReason ?? undefined}
            >
              {status === "completed" ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Rodar nova análise
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Rodar análise
                </>
              )}
            </Button>
            {estimatedCost != null && estimatedCost > 0 && (
              <span className="text-xs text-muted-foreground">
                Cobra ~{estimatedCost.toLocaleString("pt-BR")} créditos de
                análise (1 por palavra do livro).
              </span>
            )}
            {runDisabledReason && (
              <span className="text-xs text-muted-foreground">
                {runDisabledReason}
              </span>
            )}
          </div>
        )}
      </div>

      <Card className="p-4">{children}</Card>
    </div>
  );
}

/**
 * Pill colorida por gravidade/prioridade. Usado em ambos os módulos com
 * mapeamento compatível: critical/high/medium/low.
 */
export function SeverityPill({
  value,
}: {
  value: "critical" | "high" | "medium" | "low";
}) {
  const tone =
    value === "critical"
      ? "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
      : value === "high"
        ? "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30"
        : value === "medium"
          ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30"
          : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30";
  const label =
    value === "critical"
      ? "Crítico"
      : value === "high"
        ? "Alta"
        : value === "medium"
          ? "Média"
          : "Baixa";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

/**
 * Resumo de contadores por gravidade — exibido acima da lista.
 */
export function SeverityCounters({
  critical,
  high,
  medium,
  low,
  total,
}: {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="font-medium">
        {total} {total === 1 ? "achado" : "achados"}
      </span>
      {critical > 0 && (
        <span className="text-red-600 dark:text-red-400">
          • {critical} crítico{critical === 1 ? "" : "s"}
        </span>
      )}
      {high > 0 && (
        <span className="text-orange-600 dark:text-orange-400">
          • {high} alta{high === 1 ? "" : "s"}
        </span>
      )}
      {medium > 0 && (
        <span className="text-yellow-600 dark:text-yellow-400">
          • {medium} média{medium === 1 ? "" : "s"}
        </span>
      )}
      {low > 0 && (
        <span className="text-zinc-600 dark:text-zinc-400">
          • {low} baixa{low === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

/**
 * Trecho literal citado do livro — fica em um bloco recuado/discreto para
 * deixar claro que é texto extraído, não comentário da IA.
 */
export function ExcerptBlock({
  excerpt,
  label,
}: {
  excerpt: string;
  label?: string;
}) {
  if (!excerpt) return null;
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      {label && (
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      )}
      <p className="text-sm leading-relaxed italic text-foreground/85">
        "{excerpt}"
      </p>
    </div>
  );
}
