function errorHandler(err, _req, res, _next) {
  console.error(err);

  if (err.name === 'ZodError') {
    return res.status(400).json({ ok: false, message: 'Dados inválidos.', errors: err.errors });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ ok: false, message: 'Token inválido ou expirado.' });
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
