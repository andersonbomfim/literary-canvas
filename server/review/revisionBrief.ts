export type StoredReviewComment = {
  id?: number;
  type?: string;
  severity?: string;
  line?: number;
  text?: string;
  suggestion?: string;
};

export type StoredReviewAlert = {
  type?: string;
  title?: string;
  description?: string;
};

export type RevisionBriefSelection = {
  commentIds?: number[];
  alertIndexes?: number[];
  note?: string;
};

export type StoredReviewPayload = {
  comments?: string | null;
  alerts?: string | null;
};

export function parseStoredReviewArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function cleanText(value: unknown, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  return text || fallback;
}

function formatAlert(alert: StoredReviewAlert, index: number) {
  const type = cleanText(alert.type, 'geral');
  const title = cleanText(alert.title, `Alerta ${index + 1}`);
  const description = cleanText(alert.description, 'A revisão marcou este ponto para ajuste.');
  return `${index + 1}. [Alerta ${type}] ${title}\n   Ação: ${description}`;
}

function formatComment(comment: StoredReviewComment, index: number) {
  const type = cleanText(comment.type, 'geral');
  const severity = cleanText(comment.severity, 'média');
  const where = Number.isFinite(Number(comment.line)) ? `linha ${comment.line}` : 'trecho indicado';
  const text = cleanText(comment.text, `Comentário ${index + 1}`);
  const suggestion = cleanText(comment.suggestion);
  return `${index + 1}. [Comentário ${type}, ${severity}, ${where}] ${text}${suggestion ? `\n   Ação: ${suggestion}` : ''}`;
}

export function buildRevisionBriefFromItems(
  comments: StoredReviewComment[],
  alerts: StoredReviewAlert[],
  selection?: RevisionBriefSelection,
) {
  const commentIds = new Set(selection?.commentIds ?? []);
  const alertIndexes = new Set(selection?.alertIndexes ?? []);
  const hasExplicitSelection = commentIds.size > 0 || alertIndexes.size > 0;

  const selectedComments = commentIds.size
    ? comments.filter((comment) => comment.id !== undefined && commentIds.has(Number(comment.id)))
    : hasExplicitSelection
      ? []
      : comments.filter((comment) => comment.severity === 'high' || comment.severity === 'medium');

  const selectedAlerts = alertIndexes.size
    ? alerts.filter((_, index) => alertIndexes.has(index))
    : hasExplicitSelection
      ? []
      : alerts.filter((alert) => alert.type === 'error' || alert.type === 'warning');

  const finalComments = hasExplicitSelection ? selectedComments : selectedComments.length ? selectedComments : comments;
  const finalAlerts = hasExplicitSelection ? selectedAlerts : selectedAlerts.length ? selectedAlerts : alerts;
  const fixCount = finalComments.length + finalAlerts.length;

  const lines = [
    'Correções recebidas da Revisão',
    '',
    'Aplique os pontos abaixo de forma integrada. Se uma correção afetar ritmo, causa, consequência, continuidade ou voz de personagem, ajuste também os trechos dependentes.',
  ];

  const note = cleanText(selection?.note);
  if (note) lines.push('', `Nota do revisor: ${note}`);

  if (finalAlerts.length) {
    lines.push('', 'Alertas selecionados:');
    finalAlerts.forEach((alert, index) => lines.push(formatAlert(alert, index)));
  }

  if (finalComments.length) {
    lines.push('', 'Comentários selecionados:');
    finalComments.forEach((comment, index) => lines.push(formatComment(comment, index)));
  }

  if (!fixCount) {
    lines.push(
      '',
      'A revisão marcou o capítulo para ajustes, mas não há itens estruturados salvos. Releia o capítulo e corrija continuidade, clareza, ritmo e voz antes de devolver para Revisão.',
    );
  }

  return {
    comments,
    alerts,
    selectedComments: finalComments,
    selectedAlerts: finalAlerts,
    revisionBrief: lines.join('\n'),
    fixCount,
  };
}

export function buildRevisionBriefFromStoredReview(
  review: StoredReviewPayload,
  selection?: RevisionBriefSelection,
) {
  const comments = parseStoredReviewArray<StoredReviewComment>(review.comments);
  const alerts = parseStoredReviewArray<StoredReviewAlert>(review.alerts);
  return buildRevisionBriefFromItems(comments, alerts, selection);
}
