const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('relatorios'));

// Mapeia o registro do banco para o formato esperado pelo frontend
function toView(h) {
  const dados = h.dados || {};
  return {
    id:      h.id,
    titulo:  h.titulo,
    cat:     dados.cat || h.relatorioId,
    periodo: h.periodo || '—',
    data:    h.criadoEm,
    formato: dados.formato || 'CSV',
  };
}

// ── GET /api/relatorios/historico — histórico de relatórios gerados ──
router.get('/historico', async (req, res, next) => {
  try {
    const historico = await prisma.historicoRelatorio.findMany({
      where:   { empresaId: req.auth.empresaId },
      orderBy: { criadoEm: 'desc' },
      take:    50,
    });
    res.json({ ok: true, data: historico.map(toView) });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/relatorios/historico — registra um relatório gerado ──
router.post('/historico', async (req, res, next) => {
  try {
    const { relatorioId, titulo, cat, periodo, formato } = req.body;

    const novo = await prisma.historicoRelatorio.create({
      data: {
        relatorioId: relatorioId || 'desconhecido',
        titulo:      titulo      || 'Relatório',
        periodo:     periodo     || null,
        dados:       { cat: cat || null, formato: formato || 'CSV' },
        empresaId:   req.auth.empresaId,
      },
    });

    res.status(201).json({ ok: true, data: toView(novo) });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/relatorios/historico — limpa todo o histórico ──
router.delete('/historico', async (req, res, next) => {
  try {
    await prisma.historicoRelatorio.deleteMany({
      where: { empresaId: req.auth.empresaId },
    });
    res.json({ ok: true, message: 'Histórico limpo.' });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/relatorios/historico/:id — remove um item ──
router.delete('/historico/:id', async (req, res, next) => {
  try {
    await prisma.historicoRelatorio.deleteMany({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    res.json({ ok: true, message: 'Item removido.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
