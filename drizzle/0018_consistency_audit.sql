-- Auditoria de Consistência Narrativa
-- F1: bolsa separada de créditos de análise + estender ledger pra distinguir
-- "narrative_generation" vs "book_consistency_audit".
-- F2: nova action no generationJobs + tabela auditReports.

-- ── Bolsa de análise em userSubscriptions ──────────────────────────────
ALTER TABLE userSubscriptions
  ADD COLUMN monthlyAnalysisCreditLimit INT NOT NULL DEFAULT 0;
ALTER TABLE userSubscriptions
  ADD COLUMN monthlyAnalysisCreditsUsed INT NOT NULL DEFAULT 0;
ALTER TABLE userSubscriptions
  ADD COLUMN monthlyAnalysisCreditsReserved INT NOT NULL DEFAULT 0;
ALTER TABLE userSubscriptions
  ADD COLUMN extraAnalysisCredits INT NOT NULL DEFAULT 0;
ALTER TABLE userSubscriptions
  ADD COLUMN extraAnalysisCreditsReserved INT NOT NULL DEFAULT 0;

-- ── Distinguir narrativa vs análise no ledger ────────────────────────────
-- Default 'narrative_generation' garante retrocompat com toda linha
-- pré-Auditoria (rotuladas como geração narrativa).
ALTER TABLE generationUsageLedger
  ADD COLUMN usageType ENUM('narrative_generation', 'book_consistency_audit')
    NOT NULL DEFAULT 'narrative_generation';
CREATE INDEX idx_generationUsageLedger_usageType ON generationUsageLedger (usageType);

-- ── Nova action no job ────────────────────────────────────────────────
ALTER TABLE generationJobs
  MODIFY COLUMN action ENUM('generate', 'regenerate', 'localized_edit', 'consistency_audit') NOT NULL DEFAULT 'generate';

-- ── Tabela auditReports ───────────────────────────────────────────────
CREATE TABLE auditReports (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  jobId INT NOT NULL,
  publicJobId VARCHAR(64) NOT NULL,
  userId INT NOT NULL,
  workId INT NOT NULL,
  wordCount INT NOT NULL,
  analysisCreditsCharged INT NOT NULL,
  strategy ENUM('integral', 'pipeline') NOT NULL,
  engine VARCHAR(64) NOT NULL,
  totalIssues INT NOT NULL DEFAULT 0,
  criticalCount INT NOT NULL DEFAULT 0,
  highCount INT NOT NULL DEFAULT 0,
  mediumCount INT NOT NULL DEFAULT 0,
  lowCount INT NOT NULL DEFAULT 0,
  issuesJson TEXT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auditReports_userId ON auditReports (userId);
CREATE INDEX idx_auditReports_workId ON auditReports (workId);
CREATE INDEX idx_auditReports_jobId ON auditReports (jobId);
CREATE INDEX idx_auditReports_created ON auditReports (createdAt);
