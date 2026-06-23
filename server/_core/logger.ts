type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatLog(level: LogLevel, message: string, meta: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (meta && Object.keys(meta).length > 0) {
    Object.assign(entry, meta);
  }

  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify(entry);
  }

  // Dev-friendly format
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${entry.timestamp}] ${level.toUpperCase()} ${message}${metaStr}`;
}

export function createLogger(context = "") {
  const baseMeta = context ? { context } : {};

  return {
    debug(message: string, meta: Record<string, unknown> = {}) {
      if (shouldLog('debug')) console.debug(formatLog('debug', message, { ...baseMeta, ...meta }));
    },
    info(message: string, meta: Record<string, unknown> = {}) {
      if (shouldLog('info')) console.info(formatLog('info', message, { ...baseMeta, ...meta }));
    },
    warn(message: string, meta: Record<string, unknown> = {}) {
      if (shouldLog('warn')) console.warn(formatLog('warn', message, { ...baseMeta, ...meta }));
    },
    error(message: string, meta: Record<string, unknown> = {}) {
      if (shouldLog('error')) console.error(formatLog('error', message, { ...baseMeta, ...meta }));
    },
  };
}

export const logger = createLogger();
