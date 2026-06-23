-- C6: enforce unique e-mail to close the register-race window where two
-- concurrent /api/auth/register calls with the same address could both pass
-- the existence check and insert duplicates.
--
-- This migration is idempotent: it drops the old non-unique index if present
-- before creating the unique one. Run with: pnpm db:push
DROP INDEX IF EXISTS idx_users_email ON users;
CREATE UNIQUE INDEX uniq_users_email ON users (email);
