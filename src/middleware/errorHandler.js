function safePath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

function logError(err, req) {
  const status = err.status || 500;
  const payload = {
    status,
    method: req.method,
    path: safePath(req),
    name: err.name,
    code: err.code,
    message: err.message,
  };

  if (process.env.NODE_ENV === 'production') {
    if (status >= 500) console.error('[api:error]', payload);
    else console.warn('[api:warn]', payload);
    return;
  }

  console.error(err);
}

function errorHandler(err, req, res, _next) {
  logError(err, req);

  if (err.name === 'ZodError') {
    return res.status(400).json({ ok: false, message: 'Dados invalidos.', errors: err.errors });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ ok: false, message: 'Token invalido ou expirado.' });
  }

  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    message: err.message || 'Erro interno do servidor.',
    ...(err.code && { code: err.code }),
    ...(err.data && { data: err.data }),
  });
}

module.exports = errorHandler;
