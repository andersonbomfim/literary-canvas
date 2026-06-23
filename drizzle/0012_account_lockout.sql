-- A07.1 (OWASP) — Account lockout. Adiciona contador de falhas consecutivas
-- e janela de bloqueio temporário em users.
ALTER TABLE users ADD COLUMN failedLoginCount INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN lockedUntil TIMESTAMP NULL DEFAULT NULL;
