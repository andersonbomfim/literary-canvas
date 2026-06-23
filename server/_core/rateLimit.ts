import type { Request, Response, NextFunction } from 'express';

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

// A6: previously the bucket Map grew unbounded for the lifetime of the
// process — every distinct IP+path combination leaked memory forever. We now
// purge expired entries on a fixed cadence. Capped at 50k entries to bound
// peak memory under abuse.
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_BUCKETS = 50_000;
let cleanupTimer: NodeJS.Timeout | null = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let removed = 0;
    buckets.forEach((bucket, key) => {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
        removed += 1;
      }
    });
    // If we're still way over budget, drop the oldest entries.
    if (buckets.size > MAX_BUCKETS) {
      const overflow = buckets.size - MAX_BUCKETS;
      const iter = buckets.keys();
      for (let i = 0; i < overflow; i += 1) {
        const next = iter.next();
        if (next.done) break;
        buckets.delete(next.value);
        removed += 1;
      }
    }
    if (removed > 0 && process.env.LOG_LEVEL === 'debug') {
      // eslint-disable-next-line no-console
      console.debug(`[rateLimit] purged ${removed} bucket(s); size=${buckets.size}`);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the event loop alive just for cleanup.
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

function getClientKey(req: Request) {
  // A6: only honour X-Forwarded-For if Express has been configured with
  // `app.set('trust proxy', ...)`. Without that flag, req.ip falls back to
  // the direct socket address, which cannot be spoofed by clients.
  // Express exposes the trust-proxy decision via req.app.get('trust proxy fn').
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimit(options: { windowMs: number; maxRequests: number; message: string }) {
  const { windowMs, maxRequests, message } = options;
  ensureCleanup();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}:${getClientKey(req)}`;
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ success: false, error: message || 'Muitas tentativas. Tente novamente em instantes.' });
    }

    current.count += 1;
    buckets.set(key, current);
    return next();
  };
}
