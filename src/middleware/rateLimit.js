/**
 * Minimal per-IP fixed-window rate limiter for the auth endpoints —
 * dependency-free on purpose (matches the hand-rolled token bucket in
 * RecallBotManager). Not distributed: state is per-process, which is
 * fine on a single Railway replica; revisit if we ever scale out.
 *
 * Requires `app.set('trust proxy', 1)` so req.ip is the real client IP
 * behind Railway's proxy, not the proxy itself.
 */
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, name = 'default' } = {}) {
  const hits = new Map(); // ip -> { count, windowStart }

  // Evict stale windows so the map can't grow unbounded under a
  // spray of distinct IPs. Unref'd so it never holds the process open.
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, entry] of hits) {
      if (entry.windowStart < cutoff) hits.delete(ip);
    }
  }, windowMs);
  sweeper.unref?.();

  function middleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: now };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      console.warn(`[rateLimit:${name}] ${ip} exceeded ${max}/${windowMs}ms`);
      return res.status(429).json({
        error: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }
    return next();
  }

  // Exposed for tests + graceful shutdown.
  middleware.stop = () => clearInterval(sweeper);
  middleware.hits = hits;
  return middleware;
}
