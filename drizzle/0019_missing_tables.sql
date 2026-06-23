-- ─────────────────────────────────────────────────────────────────────────
-- Migration 0019 — tabelas que escaparam das migrations originais.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Histórico: a estrutura inicial do projeto foi gerada por `drizzle-kit
-- generate` mas algumas tabelas só passaram a viver em `drizzle/schema.ts`
-- depois, sem que a migration correspondente fosse criada. Em modo MySQL
-- fresco, isso quebrava ALTER TABLE works (0008/0009) e o app inteiro:
--   - works (com coverImage/coverPositionX/Y/Scale)
--   - userSubscriptions (a 0014 só fazia ALTER assumindo tabela existente)
--   - creditWallets
--   - creditLedgerEntries
--
-- Esta migration cria as 4 tabelas com `IF NOT EXISTS` para ser idempotente
-- em bancos onde drizzle-kit push já reconstruiu (ou onde uma migration
-- caseira preencheu o gap).

-- ── works ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `works` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `seriesId` INT NULL,
  `bookNumber` INT NULL,
  `title` VARCHAR(255) NOT NULL,
  `subtitle` VARCHAR(255) NULL,
  `description` TEXT NULL,
  `genre` VARCHAR(120) NULL,
  `coverImage` TEXT NULL,
  `coverPositionX` INT DEFAULT 50,
  `coverPositionY` INT DEFAULT 50,
  `coverScale` INT DEFAULT 100,
  `status` ENUM('planning','in_progress','paused','completed','archived') NOT NULL DEFAULT 'planning',
  `isDefault` ENUM('true','false') NOT NULL DEFAULT 'false',
  `deletedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_works_userId` (`userId`)
);

-- ── userSubscriptions ────────────────────────────────────────────────────
-- Versão "base" da tabela. Colunas adicionadas em 0014/0015/0018 ficam por
-- conta das suas migrations (ALTER TABLE) — esta migration só garante a
-- existência mínima para que as ALTERs subsequentes não falhem em banco
-- fresco. Em bancos que rodaram drizzle-kit push antes, IF NOT EXISTS pula.
CREATE TABLE IF NOT EXISTS `userSubscriptions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `planCode` ENUM('weekly','monthly','yearly','none') NOT NULL DEFAULT 'none',
  `status` ENUM('active','paused','canceled','trial','none') NOT NULL DEFAULT 'none',
  `renewsAt` TIMESTAMP NULL,
  `creditAllowance` INT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_userSubscriptions_userId` (`userId`)
);

-- ── creditWallets ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `creditWallets` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `balance` INT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_creditWallets_userId` (`userId`)
);

-- ── creditLedgerEntries ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `creditLedgerEntries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `workId` INT NULL,
  `type` ENUM('grant','usage','refund','adjustment') NOT NULL,
  `amount` INT NOT NULL,
  `balanceAfter` INT NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `reference` VARCHAR(255) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_creditLedgerEntries_userId` (`userId`)
);
