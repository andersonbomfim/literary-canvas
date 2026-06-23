/**
 * Testes da Fase 2 — Auditoria de Consistência Narrativa.
 *
 * Cobre o caminho ponta-a-ponta do worker + helpers de cobrança +
 * decisão integral vs pipeline. Mocka `../db` (subscription, jobs, audit
 * reports, chapters) e o `_core/llm` (resposta do modelo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NarrativeConsistencyIssue } from "../../shared/narrativeAudit";

// ── State controlado ───────────────────────────────────────────────────
let subscription: any;
let activeJob: any;
// Tracking de jobs por id — o mock `updateGenerationJob` precisa diferenciar
// patches feitos em jobs distintos pra que o teste de histórico (que cria
// dois jobs em sequência) não acabe colapsando ambos no mesmo registro.
const jobsById = new Map<number, any>();
const ledgerEntries: any[] = [];
const auditReports: any[] = [];
const notifications: any[] = [];
const costLogs: any[] = [];
let chapters: any[] = [];
let work: any = {
  id: 7,
  userId: 42,
  title: "Sob os Sinos de Praga",
  description: "Romance histórico",
  genre: "histórico",
};

const llmInvocations: Array<{ system?: string; user?: string; maxTokens?: number; timeoutMs?: number }> = [];
let llmResponses: Array<{ content: string } | Error> = [];

function nextLlmResponse() {
  const next = llmResponses.shift();
  if (next === undefined) {
    return { content: '{"issues":[]}' };
  }
  if (next instanceof Error) throw next;
  return next;
}

function makeIssue(over: Partial<NarrativeConsistencyIssue> = {}): NarrativeConsistencyIssue {
  return {
    id: "i1",
    severity: "critical",
    category: "chronology",
    title: "Olga nega ter estado em Praga",
    problemSummary: "Cap.18 contradiz cap.7.",
    primaryLocation: {
      chapter: "Capítulo 18",
      excerpt: "Eu nunca estive em Praga.",
    },
    conflictingLocations: [
      {
        chapter: "Capítulo 7",
        excerpt: "Olga atravessou a praça sob os sinos de Praga.",
        explanation: "Cena anterior contradiz a fala do cap.18.",
      },
    ],
    whyItIsAProblem: "A fala transforma em mentira uma cena que antes foi narrada como vivida por Olga.",
    impactOnStory: "Anula a cena fundadora do cap.7 e confunde a memória da personagem.",
    suggestedFix: "Trocar por 'Eu nunca voltei a Praga depois daquela noite.'",
    affectedElements: { characters: ["Olga"] },
    confidence: "high",
    ...over,
  };
}

function defaultIssuesJson() {
  return JSON.stringify({ issues: [makeIssue()] });
}

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  getUserSubscription: vi.fn(async () => subscription),
  updateUserSubscriptionGenerationUsage: vi.fn(async (_userId: number, patch: Record<string, unknown>) => {
    subscription = { ...subscription, ...patch, updatedAt: new Date() };
    return subscription;
  }),
  createGenerationUsageLedgerEntry: vi.fn(async (entry: Record<string, unknown>) => {
    const row = { id: ledgerEntries.length + 1, createdAt: new Date(), ...entry };
    ledgerEntries.push(row);
    return row;
  }),
  updateGenerationJob: vi.fn(async (jobId: number, patch: Record<string, unknown>) => {
    // Honra o jobId: cada job tem seu próprio registro. Se for o id atual
    // do activeJob também atualizamos a referência ativa pra os testes que
    // inspecionam status/errorCode finais.
    const base = jobsById.get(jobId) ?? activeJob ?? { id: jobId };
    const updated = { ...base, ...patch, id: jobId, updatedAt: new Date() };
    jobsById.set(jobId, updated);
    if (activeJob?.id === jobId) activeJob = updated;
    return updated;
  }),
  acquireNextGenerationJob: vi.fn(async () => activeJob),
  getUserChapters: vi.fn(async () => chapters),
  getWorkById: vi.fn(async () => work),
  // loadAnalysisChapters faz fallback para referências importadas em
  // authorProfile.keyChapters. Nestes testes não usamos esse caminho —
  // retornamos null pra forçar o caminho "sem capítulos nem referências".
  getOrCreateAuthorProfile: vi.fn(async () => null),
  createAuditReport: vi.fn(async (entry: Record<string, unknown>) => {
    const row = { id: auditReports.length + 1, createdAt: new Date(), ...entry };
    auditReports.push(row);
    return row;
  }),
  createNotification: vi.fn(async (_userId: number, entry: Record<string, unknown>) => {
    notifications.push(entry);
  }),
  createGenerationCostLog: vi.fn(async (entry: Record<string, unknown>) => {
    costLogs.push(entry);
  }),
  // Funções narrativas/jobs não-audit usadas pelo worker.ts mas não exercidas
  // pelos testes desta suite — declaramos como no-op pra import não quebrar.
  createChapter: vi.fn(),
  createChapterVersion: vi.fn(),
  incrementChapterCount: vi.fn(),
  setDraftStatus: vi.fn(),
}));

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(async (params: { messages: any[]; maxTokens?: number; timeoutMs?: number }) => {
    llmInvocations.push({
      system: params.messages?.[0]?.content,
      user: params.messages?.[1]?.content,
      maxTokens: params.maxTokens,
      timeoutMs: params.timeoutMs,
    });
    const response = nextLlmResponse();
    return {
      id: "",
      created: Date.now(),
      model: "test-model",
      choices: [{ index: 0, message: { role: "assistant", content: response.content }, finish_reason: "stop" }],
    };
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────

function currentBillingCycle() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

function makeSubscription(over: Record<string, unknown> = {}) {
  const cycle = currentBillingCycle();
  return {
    id: 1,
    userId: 42,
    planCode: "monthly",
    planTier: "essential",
    status: "active",
    renewsAt: null,
    creditAllowance: 0,
    monthlyNarrativeCreditLimit: 30000,
    monthlyNarrativeCreditsUsed: 0,
    monthlyNarrativeCreditsReserved: 0,
    extraNarrativeCredits: 0,
    extraNarrativeCreditsReserved: 0,
    monthlyAnalysisCreditLimit: 120_000,
    monthlyAnalysisCreditsUsed: 0,
    monthlyAnalysisCreditsReserved: 0,
    extraAnalysisCredits: 0,
    extraAnalysisCreditsReserved: 0,
    billingCycleStart: cycle.start,
    billingCycleEnd: cycle.end,
    monthlyInspirationUsed: 0,
    monthlyTextReviewUsed: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeAuditJob(over: Record<string, unknown> = {}) {
  return {
    id: 501,
    publicId: "aud_test",
    userId: 42,
    workId: 7,
    draftId: null,
    chapterId: null,
    outputChapterId: null,
    action: "consistency_audit",
    generationMode: "standard",
    planTier: "essential",
    engine: "current",
    fallbackEngine: null,
    status: "queued",
    progressMessage: "...",
    inputSnapshot: JSON.stringify({
      action: "consistency_audit",
      workId: 7,
      wordCount: 0,
      chapterCount: 0,
    }),
    outputText: null,
    requestedMaxOutputWords: 0,
    generatedWordCount: 0,
    reservedCredits: 0,
    reservedMonthlyCredits: 0,
    reservedExtraCredits: 0,
    confirmedCredits: 0,
    confirmedMonthlyCredits: 0,
    confirmedExtraCredits: 0,
    releasedCredits: 0,
    attempts: 0,
    maxAttempts: 2,
    lockedAt: null,
    lockedBy: null,
    lockExpiresAt: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeChapter(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 42,
    workId: 7,
    draftId: null,
    title: "Capítulo 1",
    content: "Olga atravessou a praça sob os sinos de Praga. x ".repeat(45).trim() + " Eu nunca estive em Praga.",
    bookNumber: 1,
    chapterNumber: 1,
    status: "canonical",
    generationPrompt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  subscription = makeSubscription();
  activeJob = makeAuditJob();
  jobsById.clear();
  jobsById.set(activeJob.id, activeJob);
  chapters = [makeChapter({ id: 1, chapterNumber: 1 }), makeChapter({ id: 2, chapterNumber: 2 })];
  ledgerEntries.length = 0;
  auditReports.length = 0;
  notifications.length = 0;
  costLogs.length = 0;
  llmInvocations.length = 0;
  llmResponses = [];
  process.env.AUDIT_MODEL_CONTEXT_TOKENS = "128000";
});

// ── Plan gating ────────────────────────────────────────────────────────

describe("planConfig — gating por plano", () => {
  it("free não pode rodar auditoria", async () => {
    const { canRunConsistencyAudit } = await import("./planConfig");
    expect(canRunConsistencyAudit("free")).toBe(false);
  });

  it("essential e ultra podem rodar auditoria", async () => {
    const { canRunConsistencyAudit, monthlyAnalysisCreditsByPlan } = await import("./planConfig");
    expect(canRunConsistencyAudit("essential")).toBe(true);
    expect(canRunConsistencyAudit("ultra")).toBe(true);
    expect(monthlyAnalysisCreditsByPlan.free).toBe(0);
    expect(monthlyAnalysisCreditsByPlan.essential).toBe(120_000);
    expect(monthlyAnalysisCreditsByPlan.ultra).toBe(600_000);
  });
});

// ── Estratégia integral vs pipeline ────────────────────────────────────

describe("auditEngine — decisão integral vs pipeline", () => {
  it("livro pequeno cabe no contexto e usa leitura integral", async () => {
    process.env.AUDIT_MODEL_CONTEXT_TOKENS = "128000";
    vi.resetModules();
    const { decideAuditStrategy } = await import("./auditEngine");
    const small = [{ index: 1, chapterId: 1, title: "C1", content: "palavra ".repeat(500) }];
    expect(decideAuditStrategy(small)).toBe("integral");
  });

  it("livro grande não cabe e usa pipeline", async () => {
    process.env.AUDIT_MODEL_CONTEXT_TOKENS = "8000";
    vi.resetModules();
    const { decideAuditStrategy } = await import("./auditEngine");
    const big = [{ index: 1, chapterId: 1, title: "C1", content: "palavra ".repeat(50_000) }];
    expect(decideAuditStrategy(big)).toBe("pipeline");
  });
});

// ── reserveAnalysisCredits — cobrança ──────────────────────────────────

describe("usageLimiter — créditos de análise", () => {
  it("reserva exatamente wordCount em uma única chamada (não multiplica por etapas)", async () => {
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = makeAuditJob({ id: 99, reservedCredits: 0 });

    const reserved = await reserveAnalysisCredits(activeJob, 50_000);

    expect(reserved.reservedCredits).toBe(50_000);
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(50_000);
    // Apenas 1 entrada de reserve no ledger — etapas internas do pipeline
    // NÃO devem gerar reservas adicionais.
    const reserveRows = ledgerEntries.filter((e) => e.type === "reserve" && e.usageType === "book_consistency_audit");
    expect(reserveRows).toHaveLength(1);
    expect(reserveRows[0].amount).toBe(50_000);
  });

  it("plano essential com limite 120k bloqueia auditoria de 121k", async () => {
    subscription = makeSubscription({ planTier: "essential", monthlyAnalysisCreditLimit: 120_000 });
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = makeAuditJob();
    await expect(reserveAnalysisCredits(activeJob, 121_000)).rejects.toThrow(/análise/i);
  });

  it("plano ultra com 600k aceita 500k", async () => {
    subscription = makeSubscription({
      planTier: "ultra",
      monthlyAnalysisCreditLimit: 600_000,
      monthlyAnalysisCreditsUsed: 0,
      monthlyAnalysisCreditsReserved: 0,
    });
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = makeAuditJob();
    const reserved = await reserveAnalysisCredits(activeJob, 500_000);
    expect(reserved.reservedCredits).toBe(500_000);
  });

  it("saldo insuficiente bloqueia antes de cobrar nada", async () => {
    subscription = makeSubscription({
      monthlyAnalysisCreditLimit: 120_000,
      monthlyAnalysisCreditsUsed: 119_000,
      monthlyAnalysisCreditsReserved: 0,
    });
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    await expect(reserveAnalysisCredits(activeJob, 50_000)).rejects.toThrow();
    // Reserva NÃO foi feita.
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
  });

  it("confirma exatamente o usado e libera o resto", async () => {
    const { reserveAnalysisCredits, confirmAnalysisCredits } = await import("./usageLimiter");
    activeJob = await reserveAnalysisCredits(makeAuditJob(), 1000);
    await confirmAnalysisCredits(activeJob, 1000);
    expect(subscription.monthlyAnalysisCreditsUsed).toBe(1000);
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
    const confirmRows = ledgerEntries.filter((e) => e.type === "confirm" && e.usageType === "book_consistency_audit");
    expect(confirmRows[0].amount).toBe(1000);
  });

  it("falha técnica libera a reserva integralmente", async () => {
    const { reserveAnalysisCredits, releaseAnalysisCredits } = await import("./usageLimiter");
    activeJob = await reserveAnalysisCredits(makeAuditJob(), 2000);
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(2000);
    await releaseAnalysisCredits(activeJob, "Falha técnica simulada");
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
    expect(subscription.monthlyAnalysisCreditsUsed).toBe(0);
  });
});

// ── Worker — fluxo completo ────────────────────────────────────────────

describe("worker — consistency_audit handler", () => {
  it("sucesso: persiste relatório com contadores corretos e confirma créditos", async () => {
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = await reserveAnalysisCredits(makeAuditJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "consistency_audit", workId: 7, wordCount: 200, chapterCount: 2 }) };

    // 1ª chamada: integral audit retorna 1 issue (critical).
    llmResponses = [{ content: defaultIssuesJson() }];

    const { runConsistencyAuditJob } = await import("./worker");
    await runConsistencyAuditJob(activeJob);

    expect(auditReports).toHaveLength(1);
    expect(auditReports[0]).toMatchObject({
      jobId: activeJob.id,
      userId: 42,
      workId: 7,
      totalIssues: 1,
      criticalCount: 1,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      strategy: "integral",
    });
    // Issue tem trecho, conflito e gravidade conforme schema.
    const persisted: NarrativeConsistencyIssue[] = JSON.parse(auditReports[0].issuesJson);
    expect(persisted[0].primaryLocation.excerpt).toBeTruthy();
    expect(persisted[0].conflictingLocations).toHaveLength(1);
    expect(persisted[0].severity).toBe("critical");
    expect(persisted[0].suggestedFix).toBeTruthy();
    // Créditos: usados, não reservados.
    expect(subscription.monthlyAnalysisCreditsUsed).toBeGreaterThan(0);
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
    // Job está completed.
    expect(activeJob.status).toBe("completed");
    // Notificação foi criada.
    expect(notifications).toHaveLength(1);
  });

  it("relatório vazio falha como audit_empty_report e libera reserva", async () => {
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = await reserveAnalysisCredits(makeAuditJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "consistency_audit", workId: 7, wordCount: 200, chapterCount: 2 }) };

    // Modelo devolve estrutura válida mas vazia → audit_empty_report.
    llmResponses = [{ content: '{"issues":[]}' }];

    const { runConsistencyAuditJob } = await import("./worker");
    await runConsistencyAuditJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("audit_empty_report");
    // Não persistiu relatório.
    expect(auditReports).toHaveLength(0);
    // Reserva foi liberada → used continua 0.
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
    expect(subscription.monthlyAnalysisCreditsUsed).toBe(0);
  });

  it("rejeita auditoria de tom quando não há problema concreto de POV ou voz narrativa", async () => {
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = await reserveAnalysisCredits(makeAuditJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "consistency_audit", workId: 7, wordCount: 200, chapterCount: 2 }) };

    llmResponses = [{
      content: JSON.stringify({
        issues: [
          makeIssue({
            id: "tone_false_positive",
            severity: "medium",
            category: "tone_or_pov",
            title: "Tom oscila entre tensão e histórico",
            problemSummary: "A análise trata exposição como falha de tom.",
            whyItIsAProblem: "O apontamento confunde preparação narrativa com quebra factual de continuidade.",
            impactOnStory: "Isso faria o relatório punir progressão normal de cena sem contradição real.",
            suggestedFix: "Remover o apontamento e auditar apenas contradições rastreáveis entre trechos.",
          }),
        ],
      }),
    }];

    const { runConsistencyAuditJob } = await import("./worker");
    await runConsistencyAuditJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("audit_empty_report");
    expect(auditReports).toHaveLength(0);
  });

  it("JSON inválido tenta reparar; se ainda inválido falha como audit_invalid_json", async () => {
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = await reserveAnalysisCredits(makeAuditJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "consistency_audit", workId: 7, wordCount: 200, chapterCount: 2 }) };

    // 1ª: prosa pura sem JSON. 2ª (reparo): também não tem campo "issues".
    llmResponses = [
      { content: "Olá, vou te contar sobre a obra..." },
      { content: "Não posso ajudar com isso." },
    ];

    const { runConsistencyAuditJob } = await import("./worker");
    await runConsistencyAuditJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("audit_invalid_json");
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
    expect(subscription.monthlyAnalysisCreditsUsed).toBe(0);
  });

  it("obra sem capítulos falha como audit_missing_book_text", async () => {
    chapters = [];
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = await reserveAnalysisCredits(makeAuditJob(), 200);

    const { runConsistencyAuditJob } = await import("./worker");
    await runConsistencyAuditJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("audit_missing_book_text");
    expect(subscription.monthlyAnalysisCreditsUsed).toBe(0);
  });

  it("logs operacionais não contêm texto bruto da obra", async () => {
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = await reserveAnalysisCredits(makeAuditJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "consistency_audit", workId: 7, wordCount: 200, chapterCount: 2 }) };
    chapters = [makeChapter({ id: 1, content: "PALAVRA_SECRETA_QUE_NAO_DEVE_VAZAR Olga atravessou a praça sob os sinos de Praga. " + "x ".repeat(50) + " Eu nunca estive em Praga." })];

    llmResponses = [{ content: defaultIssuesJson() }];

    const { runConsistencyAuditJob } = await import("./worker");
    await runConsistencyAuditJob(activeJob);

    // Custos/logs: nada de texto bruto ou prompt.
    const allLogs = JSON.stringify({ costLogs, notifications, ledgerEntries });
    expect(allLogs).not.toContain("PALAVRA_SECRETA_QUE_NAO_DEVE_VAZAR");
    // O relatório PODE conter trechos citados (faz parte do produto).
    // — não validamos negativamente isso aqui.
  });

  it("histórico preserva relatórios anteriores (não sobrescreve)", async () => {
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    const { runConsistencyAuditJob } = await import("./worker");

    // 1º job → 1 relatório. Seta activeJob ANTES de reservar para que o mock
    // updateGenerationJob saiba que está patcheando o job 501.
    activeJob = makeAuditJob({ id: 501, publicId: "aud_1" });
    jobsById.set(activeJob.id, activeJob);
    activeJob = await reserveAnalysisCredits(activeJob, 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "consistency_audit", workId: 7, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);
    llmResponses = [{ content: defaultIssuesJson() }];
    await runConsistencyAuditJob(activeJob);

    // 2º job → outro relatório (snapshot independente).
    activeJob = makeAuditJob({ id: 502, publicId: "aud_2" });
    jobsById.set(activeJob.id, activeJob);
    activeJob = await reserveAnalysisCredits(activeJob, 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "consistency_audit", workId: 7, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);
    llmResponses = [{ content: JSON.stringify({ issues: [makeIssue({ id: "i2", severity: "high" })] }) }];
    await runConsistencyAuditJob(activeJob);

    expect(auditReports).toHaveLength(2);
    expect(auditReports[0].jobId).toBe(501);
    expect(auditReports[1].jobId).toBe(502);
    expect(auditReports[0].criticalCount).toBe(1);
    expect(auditReports[1].highCount).toBe(1);
  });

  it("contadores agregam corretamente por gravidade", async () => {
    const { reserveAnalysisCredits } = await import("./usageLimiter");
    activeJob = await reserveAnalysisCredits(makeAuditJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "consistency_audit", workId: 7, wordCount: 200, chapterCount: 2 }) };

    llmResponses = [{
      content: JSON.stringify({
        issues: [
          makeIssue({ id: "i1", severity: "critical" }),
          makeIssue({ id: "i2", severity: "high" }),
          makeIssue({ id: "i3", severity: "medium" }),
          makeIssue({ id: "i4", severity: "low" }),
          makeIssue({ id: "i5", severity: "low" }),
        ],
      }),
    }];

    const { runConsistencyAuditJob } = await import("./worker");
    await runConsistencyAuditJob(activeJob);

    expect(auditReports[0]).toMatchObject({
      totalIssues: 5,
      criticalCount: 1,
      highCount: 1,
      mediumCount: 1,
      lowCount: 2,
    });
  });
});
