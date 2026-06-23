-- A09 (OWASP) — Audit log para ações administrativas e privilegiadas.
CREATE TABLE auditLogs (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actorId INT NOT NULL,
  actorEmail VARCHAR(320) NULL,
  action VARCHAR(80) NOT NULL,
  targetType VARCHAR(64) NULL,
  targetId INT NULL,
  metadata TEXT NULL,
  ipAddress VARCHAR(64) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auditLogs_actor ON auditLogs (actorId);
CREATE INDEX idx_auditLogs_created ON auditLogs (createdAt);
CREATE INDEX idx_auditLogs_action ON auditLogs (action);
