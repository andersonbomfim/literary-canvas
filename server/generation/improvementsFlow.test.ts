/**
 * Testes da Fase 2-bis — Melhorias Narrativas.
 *
 * Cobre o caminho ponta-a-ponta do worker + cobrança + decisão integral vs
 * pipeline. Estrutura espelha o auditFlow.test.ts (Fase 2).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NarrativeImprovementSuggestion } from "../../shared/narrativeImprovements";

// ── State controlado ───────────────────────────────────────────────────
let subscription: any;
let activeJob: any;
const jobsById = new Map<number, any>();
const ledgerEntries: any[] = [];
const improvementReports: any[] = [];
const notifications: any[] = [];
const costLogs: any[] = [];
let chapters: any[] = [];
let authorProfile: any = null;
let work: any = {
  id: 9,
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
    return { content: '{"suggestions":[]}' };
  }
  if (next instanceof Error) throw next;
  return next;
}

function makeSuggestion(over: Partial<NarrativeImprovementSuggestion> = {}): NarrativeImprovementSuggestion {
  return {
    id: "s1",
    priority: "critical",
    category: "character_arc",
    title: "Arco da Olga estagnado no terço final",
    summary: "Olga perde agência depois do cap.12.",
    anchors: [
      {
        chapter: "Capítulo 14",
        excerpt: "Olga assentiu em silêncio e seguiu Anton até a estação.",
      },
      {
        chapter: "Capítulo 7",
        excerpt: "Olga decidiu enfrentar Anton sozinha antes que a noite terminasse.",
      },
    ],
    whyItWeakens: "A personagem central começa decidindo sozinha e depois aparece apenas seguindo Anton, sem ponte dramática.",
    impactOnWork: "Quebra a expectativa de arco construído nos caps 1-7 e reduz a agência dela.",
    suggestedFix: "No cap. 13, dar a Olga uma decisão que contradiga Anton com consequência permanente.",
    affectedElements: { characters: ["Olga"] },
    confidence: "high",
    ...over,
  };
}

function defaultSuggestionsJson() {
  return JSON.stringify({ suggestions: [makeSuggestion()] });
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
  getOrCreateAuthorProfile: vi.fn(async () => authorProfile),
  createImprovementReport: vi.fn(async (entry: Record<string, unknown>) => {
    const row = { id: improvementReports.length + 1, createdAt: new Date(), ...entry };
    improvementReports.push(row);
    return row;
  }),
  createNotification: vi.fn(async (_userId: number, entry: Record<string, unknown>) => {
    notifications.push(entry);
  }),
  createGenerationCostLog: vi.fn(async (entry: Record<string, unknown>) => {
    costLogs.push(entry);
  }),
  // Outras funções importadas pelo worker.ts mas não exercidas por estes testes:
  createAuditReport: vi.fn(),
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

function makeSubscription(over: Record<string, unknown> = {}) {
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
    billingCycleStart: new Date(2026, 4, 1),
    billingCycleEnd: new Date(2026, 5, 1),
    monthlyInspirationUsed: 0,
    monthlyTextReviewUsed: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeImprovementJob(over: Record<string, unknown> = {}) {
  return {
    id: 601,
    publicId: "imp_test",
    userId: 42,
    workId: 9,
    draftId: null,
    chapterId: null,
    outputChapterId: null,
    action: "narrative_improvements",
    generationMode: "standard",
    planTier: "essential",
    engine: "current",
    fallbackEngine: null,
    status: "queued",
    progressMessage: "...",
    inputSnapshot: JSON.stringify({
      action: "narrative_improvements",
      workId: 9,
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
    workId: 9,
    draftId: null,
    title: "Capítulo 1",
    content: "Olga assentiu em silêncio e seguiu Anton até a estação. Olga decidiu enfrentar Anton sozinha antes que a noite terminasse. x ".repeat(35).trim(),
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
  activeJob = makeImprovementJob();
  jobsById.clear();
  jobsById.set(activeJob.id, activeJob);
  chapters = [makeChapter({ id: 1, chapterNumber: 1 }), makeChapter({ id: 2, chapterNumber: 2 })];
  authorProfile = null;
  ledgerEntries.length = 0;
  improvementReports.length = 0;
  notifications.length = 0;
  costLogs.length = 0;
  llmInvocations.length = 0;
  llmResponses = [];
  process.env.AUDIT_MODEL_CONTEXT_TOKENS = "128000";
});

// ── Plan gating ────────────────────────────────────────────────────────

describe("planConfig — gating de Melhorias", () => {
  it("free não pode rodar melhorias", async () => {
    const { canRunNarrativeImprovements } = await import("./planConfig");
    expect(canRunNarrativeImprovements("free")).toBe(false);
  });

  it("essential e ultra podem rodar melhorias", async () => {
    const { canRunNarrativeImprovements } = await import("./planConfig");
    expect(canRunNarrativeImprovements("essential")).toBe(true);
    expect(canRunNarrativeImprovements("ultra")).toBe(true);
  });
});

// ── Estratégia integral vs pipeline ────────────────────────────────────

describe("analysisSource - cobertura de dossies", () => {
  it("contabiliza todos os dossies dentro das partes de leitura", async () => {
    const { buildAnalysisCoverage } = await import("./analysisSource");

    const coverage = buildAnalysisCoverage([
      {
        index: 1,
        chapterId: 1_000_001,
        title: "Livro importado - parte 1/2",
        source: "reference",
        content: [
          "[Bloco 1] PROLOGO",
          "Nadia chega ao hospital secreto.",
          "",
          "[Bloco 2] CAPITULO 1",
          "Pavel encontra a mae morta.",
        ].join("\n"),
      },
      {
        index: 2,
        chapterId: 1_000_002,
        title: "Livro importado - parte 2/2",
        source: "reference",
        content: [
          "[Bloco 3] A SUPREMACIA DA AURA",
          "Crowley explica a Aura e suas variedades.",
        ].join("\n"),
      },
    ]);

    expect(coverage.referencePartCount).toBe(2);
    expect(coverage.dossierCount).toBe(3);
    expect(coverage.dossiers.map((dossier) => dossier.title)).toEqual([
      "PROLOGO",
      "CAPITULO 1",
      "A SUPREMACIA DA AURA",
    ]);
  });
});

describe("improvementsEngine — decisão integral vs pipeline", () => {
  it("livro pequeno cabe e usa leitura integral", async () => {
    process.env.AUDIT_MODEL_CONTEXT_TOKENS = "128000";
    vi.resetModules();
    const { decideImprovementStrategy } = await import("./improvementsEngine");
    const small = [{ index: 1, chapterId: 1, title: "C1", content: "palavra ".repeat(500) }];
    expect(decideImprovementStrategy(small)).toBe("integral");
  });

  it("livro grande não cabe e usa pipeline", async () => {
    process.env.AUDIT_MODEL_CONTEXT_TOKENS = "8000";
    vi.resetModules();
    const { decideImprovementStrategy } = await import("./improvementsEngine");
    const big = [{ index: 1, chapterId: 1, title: "C1", content: "palavra ".repeat(50_000) }];
    expect(decideImprovementStrategy(big)).toBe("pipeline");
  });
});

// ── Wrappers de bolsa de análise ───────────────────────────────────────

describe("usageLimiter — créditos de Melhorias", () => {
  it("reserveImprovementCredits cobra a MESMA bolsa de análise da Auditoria", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = makeImprovementJob({ id: 88, reservedCredits: 0 });
    const reserved = await reserveImprovementCredits(activeJob, 50_000);
    expect(reserved.reservedCredits).toBe(50_000);
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(50_000);
    // Ledger entry com usageType narrative_improvements (não book_consistency_audit).
    const reserveRows = ledgerEntries.filter((e) => e.type === "reserve" && e.usageType === "narrative_improvements");
    expect(reserveRows).toHaveLength(1);
    expect(reserveRows[0].amount).toBe(50_000);
  });

  it("cobrança não multiplica por etapas internas (uma única reserva)", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = makeImprovementJob({ id: 88 });
    await reserveImprovementCredits(activeJob, 10_000);
    const reserveRows = ledgerEntries.filter((e) => e.type === "reserve");
    expect(reserveRows).toHaveLength(1);
  });

  it("essential com 120k bloqueia análise de 121k", async () => {
    subscription = makeSubscription({ planTier: "essential", monthlyAnalysisCreditLimit: 120_000 });
    const { reserveImprovementCredits } = await import("./usageLimiter");
    await expect(reserveImprovementCredits(activeJob, 121_000)).rejects.toThrow(/análise/i);
  });

  it("falha técnica libera reserva integralmente", async () => {
    const { reserveImprovementCredits, releaseImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 2000);
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(2000);
    await releaseImprovementCredits(activeJob, "Falha técnica simulada");
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
    expect(subscription.monthlyAnalysisCreditsUsed).toBe(0);
  });

  it("sucesso confirma e zera reserva", async () => {
    const { reserveImprovementCredits, confirmImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 1000);
    await confirmImprovementCredits(activeJob, 1000);
    expect(subscription.monthlyAnalysisCreditsUsed).toBe(1000);
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
    const confirmRows = ledgerEntries.filter((e) => e.type === "confirm" && e.usageType === "narrative_improvements");
    expect(confirmRows[0].amount).toBe(1000);
  });
});

// ── Worker — fluxo completo ────────────────────────────────────────────

describe("worker — narrative_improvements handler", () => {
  it("sucesso: persiste relatório com contadores corretos e confirma créditos", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);

    llmResponses = [{ content: defaultSuggestionsJson() }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(improvementReports).toHaveLength(1);
    expect(improvementReports[0]).toMatchObject({
      jobId: activeJob.id,
      userId: 42,
      workId: 9,
      totalSuggestions: 1,
      criticalCount: 1,
      strategy: "integral",
    });
    const persisted: NarrativeImprovementSuggestion[] = JSON.parse(improvementReports[0].suggestionsJson);
    expect(persisted[0].anchors[0].excerpt).toBeTruthy();
    expect(persisted[0].suggestedFix).toBeTruthy();
    expect(persisted[0].priority).toBe("critical");
    expect(subscription.monthlyAnalysisCreditsUsed).toBeGreaterThan(0);
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
    expect(activeJob.status).toBe("completed");
    expect(notifications).toHaveLength(1);
  });

  it("le capitulos reais e dossies importados na mesma analise", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);

    chapters = [
      makeChapter({
        id: 1,
        chapterNumber: 1,
        content: "Olga decidiu enfrentar Anton sozinha antes que a noite terminasse. x ".repeat(50),
      }),
    ];
    authorProfile = {
      keyChapters: JSON.stringify({
        customReferences: [
          {
            id: "ref-aura",
            title: "Dossie importado",
            content: "Serov explica que Mengele descobriu a Aura, uma energia vital em todos os seres humanos. A Aura possui variedades e regras aplicadas.",
            isActive: true,
          },
        ],
      }),
    };

    llmResponses = [{
      content: JSON.stringify({
        suggestions: [
          makeSuggestion({
            priority: "high",
            category: "worldbuilding_rule",
            title: "Regra da Aura precisa ser retomada apos a decisao de Olga",
            summary: "A decisao de Olga e a explicacao da Aura ficam em blocos separados sem ponte dramatica imediata.",
            anchors: [
              { chapter: "Capitulo 1", excerpt: "Olga decidiu enfrentar Anton sozinha antes que a noite terminasse." },
              { chapter: "Dossie importado", excerpt: "Serov explica que Mengele descobriu a Aura, uma energia vital em todos os seres humanos." },
            ],
            whyItWeakens: "A leitura mostra uma acao de Olga e uma regra central de Aura, mas ainda pede uma ponte dramatica especifica entre decisao e regra.",
            impactOnWork: "A obra perde a chance de conectar a escolha de Olga ao sistema de poder que move o conflito.",
            suggestedFix: "Inserir uma lembranca de Olga sobre a Aura imediatamente depois da decisao contra Anton.",
            affectedElements: { characters: ["Olga"], powersOrRules: ["Aura"] },
          }),
        ],
      }),
    }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(activeJob.status).toBe("completed");
    expect(llmInvocations[0].user).toContain("Dossie importado");
    expect(llmInvocations[0].user).toContain("Mengele descobriu a Aura");
  });

  it("rejeita falsa ausencia quando os dossies explicam a Aura", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 1 }) };
    jobsById.set(activeJob.id, activeJob);

    chapters = [];
    authorProfile = {
      keyChapters: JSON.stringify({
        customReferences: [
          {
            id: "ref-aura",
            title: "EUTANASIA - A Supremacia da Aura",
            content: [
              "EUTANASIA - A Supremacia da Aura",
              "Serov explica que Mengele descobriu a Aura, uma energia vital em todos os seres humanos.",
              "A Aura se divide em cinco variedades principais: Intensificacao, Manipulacao, Localizacao, Transformacao e Versatilizacao.",
              "Crowley usa a tecnica A Supremacia da Aura como teste de espelho para revelar a variedade de cada um.",
              "A Aura volta a ser aplicada em treinamento, manipulacao, localizacao e foco.",
            ].join(" "),
            isActive: true,
          },
        ],
      }),
    };

    llmResponses = [{
      content: JSON.stringify({
        suggestions: [
          makeSuggestion({
            id: "false_aura_absence",
            priority: "critical",
            category: "narrative_promise",
            title: "Promessa central da Supremacia da Aura nao e cumprida",
            summary: "O titulo promete que a Aura sera central, mas o texto nao desenvolve o conceito.",
            anchors: [
              { chapter: "EUTANASIA", excerpt: "EUTANASIA - A Supremacia da Aura" },
              { chapter: "EUTANASIA", excerpt: "Serov explica que Mengele descobriu a Aura, uma energia vital em todos os seres humanos." },
            ],
            whyItWeakens: "A sugestao afirma ausencia de desenvolvimento apesar de citar apenas o titulo e ignorar a explicacao posterior.",
            impactOnWork: "Isso faria o relatorio acusar a obra de nao cumprir uma promessa que os dossies mostram como explicada e aplicada.",
            suggestedFix: "Remover este apontamento e analisar apenas promessas que nao aparecem nos dossies completos.",
            affectedElements: { promisesOrPayoffs: ["Supremacia da Aura"], powersOrRules: ["Aura"] },
          }),
        ],
      }),
    }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("improvements_empty_report");
    expect(improvementReports).toHaveLength(0);
  });

  it("relatório vazio falha como improvements_empty_report e libera reserva", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);

    llmResponses = [{ content: '{"suggestions":[]}' }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("improvements_empty_report");
    expect(improvementReports).toHaveLength(0);
    expect(subscription.monthlyAnalysisCreditsReserved).toBe(0);
    expect(subscription.monthlyAnalysisCreditsUsed).toBe(0);
  });

  it("rejeita quebra de ritmo sem sequência local comprovada", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);

    llmResponses = [{
      content: JSON.stringify({
        suggestions: [
          makeSuggestion({
            id: "pacing_false_positive",
            priority: "medium",
            category: "pacing",
            title: "Exposição quebra uma tensão que ainda não começou",
            summary: "A sugestão tenta ligar preparação inicial a tensão posterior.",
            anchors: [
              { chapter: "Capítulo 1", excerpt: "Olga decidiu enfrentar Anton sozinha antes que a noite terminasse." },
              { chapter: "Capítulo 2", excerpt: "Olga assentiu em silêncio e seguiu Anton até a estação." },
            ],
            whyItWeakens: "Sem antes, quebra e depois, a leitura inventa uma causalidade que o texto não sustenta.",
            impactOnWork: "O relatório passaria a punir preparação de cena como se fosse interrupção dramática.",
            suggestedFix: "Remover este apontamento e revisar apenas sequências com antes, quebra e retomada locais.",
          }),
        ],
      }),
    }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("improvements_empty_report");
    expect(improvementReports).toHaveLength(0);
  });

  it("rejeita ausência de motivação baseada em tempo não citado e poucos anchors", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);

    llmResponses = [{
      content: JSON.stringify({
        suggestions: [
          makeSuggestion({
            id: "motivation_false_missing_trigger",
            priority: "high",
            category: "motivation",
            title: "Motivação de Olga após 28 anos é frágil e não justificada",
            summary: "A obra não explica por que Olga decide agir agora e carece de gatilho narrativo.",
            anchors: [
              { chapter: "Capítulo 1", excerpt: "Olga decidiu enfrentar Anton sozinha antes que a noite terminasse." },
              { chapter: "Capítulo 2", excerpt: "Olga assentiu em silêncio e seguiu Anton até a estação." },
            ],
            whyItWeakens: "O apontamento usa 28 anos sem citar esse tempo e ignora que dois trechos não provam falta de motivação.",
            impactOnWork: "Isso faria a análise inventar ausência de gatilho mesmo quando o texto pode ter pistas explícitas.",
            suggestedFix: "Remover este apontamento e só registrar falta de motivação com fala, causa emocional e gatilho atual citados.",
          }),
        ],
      }),
    }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("improvements_empty_report");
    expect(improvementReports).toHaveLength(0);
  });

  it("rejeita conflito abandonado quando o texto mostra pavor incapacitante", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 1 }) };
    jobsById.set(activeJob.id, activeJob);

    chapters = [
      makeChapter({
        id: 1,
        title: "MARGAERY",
        chapterNumber: 1,
        content: [
          "— Você... você matou o papai? Perseus sorriu. — Foi necessário.",
          "Margaery tentou reagir, mas o pavor fechou sua garganta e deixou o corpo imóvel.",
          "A urina molhou sua roupa antes que ela conseguisse respirar.",
          "Ela fugiu aos soluços pelo corredor sem conseguir encarar o irmão.",
          "x ".repeat(60),
        ].join(" "),
      }),
    ];

    llmResponses = [{
      content: JSON.stringify({
        suggestions: [
          makeSuggestion({
            id: "father_murder_abandoned",
            priority: "high",
            category: "abandoned_conflict",
            title: "Confissão do assassinato do pai é introduzida e imediatamente abandonada",
            summary: "Perseus admite ter matado Lombardo, mas Margaery não reage de forma significativa.",
            anchors: [
              { chapter: "Capítulo 1: MARGAERY", excerpt: "— Você... você matou o papai? Perseus sorriu. — Foi necessário." },
            ],
            whyItWeakens: "Margaery tenta reagir, mas não consegue; depois, o foco se desloca para sua micção e fuga.",
            impactOnWork: "O apontamento descartaria medo, paralisia e fuga como se não fossem consequência narrativa.",
            suggestedFix: "Remover este apontamento e só cobrar retomada posterior se houver prova depois do trauma imediato.",
            affectedElements: { characters: ["Margaery", "Perseus"], arcs: ["Confronto entre irmãos"] },
          }),
        ],
      }),
    }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("improvements_empty_report");
    expect(improvementReports).toHaveLength(0);
  });

  it("aceita ritmo quando há antes, quebra e retomada locais", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 1 }) };
    jobsById.set(activeJob.id, activeJob);

    chapters = [
      makeChapter({
        id: 1,
        content: [
          "Olga abriu o envelope e o quarto ficou em silencio.",
          "Anton recitou por varios minutos a genealogia da Sociedade.",
          "Quando o alarme tocou, Olga correu para a porta.",
          "x ".repeat(60),
        ].join(" "),
      }),
    ];

    llmResponses = [{
      content: JSON.stringify({
        suggestions: [
          makeSuggestion({
            id: "pacing_supported",
            priority: "medium",
            category: "pacing",
            title: "Genealogia interrompe a urgência do envelope",
            summary: "A genealogia entra entre o envelope e o alarme que retoma a urgência.",
            anchors: [
              { chapter: "Capítulo 1", excerpt: "Olga abriu o envelope e o quarto ficou em silencio." },
              { chapter: "Capítulo 1", excerpt: "Anton recitou por varios minutos a genealogia da Sociedade." },
              { chapter: "Capítulo 1", excerpt: "Quando o alarme tocou, Olga correu para a porta." },
            ],
            whyItWeakens: "A sequência mostra urgência, pausa expositiva e retomada imediata, então a observação tem base local.",
            impactOnWork: "O trecho reduz a pressão do envelope e atrasa a reação de Olga no momento de risco.",
            suggestedFix: "Mover a genealogia para depois do alarme e manter Olga reagindo ao envelope primeiro.",
            affectedElements: { characters: ["Olga", "Anton"], arcs: ["envelope"] },
          }),
        ],
      }),
    }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(activeJob.status).toBe("completed");
    expect(improvementReports[0]).toMatchObject({
      totalSuggestions: 1,
      mediumCount: 1,
    });
  });

  it("obra sem capítulos falha como improvements_missing_book_text", async () => {
    chapters = [];
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(activeJob.status).toBe("failed");
    expect(activeJob.errorCode).toBe("improvements_missing_book_text");
    expect(subscription.monthlyAnalysisCreditsUsed).toBe(0);
  });

  it("histórico preserva relatórios anteriores", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    const { runNarrativeImprovementsJob } = await import("./worker");

    activeJob = makeImprovementJob({ id: 601, publicId: "imp_1" });
    jobsById.set(activeJob.id, activeJob);
    activeJob = await reserveImprovementCredits(activeJob, 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);
    llmResponses = [{ content: defaultSuggestionsJson() }];
    await runNarrativeImprovementsJob(activeJob);

    activeJob = makeImprovementJob({ id: 602, publicId: "imp_2" });
    jobsById.set(activeJob.id, activeJob);
    activeJob = await reserveImprovementCredits(activeJob, 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);
    llmResponses = [{ content: JSON.stringify({ suggestions: [makeSuggestion({ id: "s2", priority: "high" })] }) }];
    await runNarrativeImprovementsJob(activeJob);

    expect(improvementReports).toHaveLength(2);
    expect(improvementReports[0].jobId).toBe(601);
    expect(improvementReports[1].jobId).toBe(602);
    expect(improvementReports[0].criticalCount).toBe(1);
    expect(improvementReports[1].highCount).toBe(1);
  });

  it("contadores agregam corretamente por prioridade", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);

    llmResponses = [{
      content: JSON.stringify({
        suggestions: [
          makeSuggestion({ id: "s1", priority: "critical" }),
          makeSuggestion({ id: "s2", priority: "high" }),
          makeSuggestion({ id: "s3", priority: "medium" }),
          makeSuggestion({ id: "s4", priority: "low" }),
          makeSuggestion({ id: "s5", priority: "low" }),
        ],
      }),
    }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    expect(improvementReports[0]).toMatchObject({
      totalSuggestions: 5,
      criticalCount: 1,
      highCount: 1,
      mediumCount: 1,
      lowCount: 2,
    });
  });

  it("logs operacionais não contêm texto bruto da obra", async () => {
    const { reserveImprovementCredits } = await import("./usageLimiter");
    activeJob = await reserveImprovementCredits(makeImprovementJob(), 200);
    activeJob = { ...activeJob, inputSnapshot: JSON.stringify({ action: "narrative_improvements", workId: 9, wordCount: 200, chapterCount: 2 }) };
    jobsById.set(activeJob.id, activeJob);
    chapters = [makeChapter({ id: 1, content: "FRASE_SECRETA_QUE_NAO_VAZA Olga assentiu em silêncio e seguiu Anton até a estação. Olga decidiu enfrentar Anton sozinha antes que a noite terminasse. " + "x ".repeat(50) })];

    llmResponses = [{ content: defaultSuggestionsJson() }];

    const { runNarrativeImprovementsJob } = await import("./worker");
    await runNarrativeImprovementsJob(activeJob);

    const allLogs = JSON.stringify({ costLogs, notifications, ledgerEntries });
    expect(allLogs).not.toContain("FRASE_SECRETA_QUE_NAO_VAZA");
  });
});
