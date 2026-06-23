-- ─────────────────────────────────────────────────────────────────────────
-- Migration 0021 — Melhorias Narrativas (estrutural, paralelo à Auditoria).
-- ─────────────────────────────────────────────────────────────────────────
--
-- Auditoria aponta CONTRADIÇÕES ("isto está errado").
-- Melhorias aponta FRAQUEZAS EDITORIAIS ("isto pode ficar mais forte"):
-- arcos esmorecendo, promessas sem payoff, núcleo político desaparecendo,
-- regras de mundo subutilizadas, etc.
--
-- Compartilha a MESMA bolsa de créditos de análise (monthlyAnalysisCredit*)
-- — só diferenciamos via usageType no ledger pra rastreabilidade contábil.
--
-- Tudo idempotente (uso de IF/MODIFY) pra rodar em banco fresco ou em
-- banco que já passou pelas migrations anteriores.

-- ── Nova usageType para ledger ───────────────────────────────────────────
ALTER TABLE generationUsageLedger
  MODIFY COLUMN usageType
    ENUM('narrative_generation', 'book_consistency_audit', 'narrative_improvements')
    NOT NULL DEFAULT 'narrative_generation';

-- ── Nova action no job ───────────────────────────────────────────────────
ALTER TABLE generationJobs
  MODIFY COLUMN action
    ENUM('generate', 'regenerate', 'localized_edit', 'consistency_audit', 'narrative_improvements')
    NOT NULL DEFAULT 'generate';

-- ── Tabela improvementReports ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `improvementReports` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `jobId` INT NOT NULL,
  `publicJobId` VARCHAR(64) NOT NULL,
  `userId` INT NOT NULL,
  `workId` INT NOT NULL,
  `wordCount` INT NOT NULL,
  `analysisCreditsCharged` INT NOT NULL,
  `strategy` ENUM('integral', 'pipeline') NOT NULL,
  `engine` VARCHAR(64) NOT NULL,
  `totalSuggestions` INT NOT NULL DEFAULT 0,
  `criticalCount` INT NOT NULL DEFAULT 0,
  `highCount` INT NOT NULL DEFAULT 0,
  `mediumCount` INT NOT NULL DEFAULT 0,
  `lowCount` INT NOT NULL DEFAULT 0,
  `suggestionsJson` TEXT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_improvementReports_userId` (`userId`),
  INDEX `idx_improvementReports_workId` (`workId`),
  INDEX `idx_improvementReports_jobId` (`jobId`),
  INDEX `idx_improvementReports_created` (`createdAt`)
);
