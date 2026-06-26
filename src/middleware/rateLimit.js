function positiveIntFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function defaultKey(req) {
  return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
}

function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 30;
  const message = options.message || 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  const keyGenerator = options.keyGenerator || defaultKey;
  const attempts = new Map();
  let lastCleanup = Date.now();

  return (req, res, next) => {
    const now = Date.now();

    if (now - lastCleanup > Math.min(windowMs, 60 * 1000)) {
      for (const [storedKey, storedValue] of attempts.entries()) {
        if (storedValue.resetAt <= now) attempts.delete(storedKey);
      }
      lastCleanup = now;
    }

    const key = String(keyGenerator(req) || 'unknown');
    const current = attempts.get(key);

    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;

    if (current.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ ok: false, message });
    }

    return next();
  };
}

const authIpRateLimit = createRateLimiter({
  windowMs: positiveIntFromEnv('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  max: positiveIntFromEnv('AUTH_RATE_LIMIT_MAX', 40),
  keyGenerator: req => `auth-ip:${defaultKey(req)}`,
});

const loginCredentialRateLimit = createRateLimiter({
  windowMs: positiveIntFromEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  max: positiveIntFromEnv('LOGIN_RATE_LIMIT_MAX', 8),
  keyGenerator: req => {
    const identifier = String(req.body?.identifier || '').trim().toLowerCase();
    return `login:${defaultKey(req)}:${identifier || 'empty'}`;
  },
});

const registerRateLimit = createRateLimiter({
  windowMs: positiveIntFromEnv('REGISTER_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000),
  max: positiveIntFromEnv('REGISTER_RATE_LIMIT_MAX', 5),
  keyGenerator: req => `register:${defaultKey(req)}`,
  message: 'Muitas tentativas de cadastro. Aguarde alguns minutos e tente novamente.',
});

module.exports = {
  createRateLimiter,
  authIpRateLimit,
  loginCredentialRateLimit,
  registerRateLimit,
};
