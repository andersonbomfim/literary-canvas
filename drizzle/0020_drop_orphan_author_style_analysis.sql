-- ─────────────────────────────────────────────────────────────────────────
-- Migration 0020 — drop tabela órfã `authorStyleAnalysis`.
-- ─────────────────────────────────────────────────────────────────────────
--
-- `authorStyleAnalysis` foi criada em 0005 (`0005_wise_bastion.sql`) mas
-- nunca chegou a ser usada por router/DB/cliente. O schema atual em
-- `drizzle/schema.ts` já tem o comentário "table was removed — re-add when
-- the feature is built", mas a tabela continuava existindo em MySQL e
-- ocupando inode + permissões à toa.
--
-- Drop idempotente.

DROP TABLE IF EXISTS `authorStyleAnalysis`;
