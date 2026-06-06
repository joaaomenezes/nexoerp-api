const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, message: 'Token não fornecido.' });
  }

  try {
    const token = header.slice(7);
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    next(err);
  }
}

function requirePermission(module) {
  return (req, res, next) => {
    const { isDono, permissions } = req.auth;
    if (isDono || permissions === null) return next();
    if (permissions && permissions[module]) return next();
    return res.status(403).json({ ok: false, message: 'Sem permissão para este módulo.' });
  };
}

module.exports = { requireAuth, requirePermission };
