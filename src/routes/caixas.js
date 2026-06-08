const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');

const prisma = new PrismaClient();

router.use(requireAuth);

// GET /api/caixas/aberto — caixa aberto do operador atual
router.get('/aberto', async (req, res, next) => {
  try {
    const caixa = await prisma.caixa.findFirst({
      where: { empresaId: req.auth.empresaId, operadorId: req.auth.userId, aberto: true },
      orderBy: { abertura: 'desc' },
    });

    if (!caixa) {
      return res.status(404).json({ ok: false, message: 'Sem caixa aberto.' });
    }

    res.json({ ok: true, data: { ...caixa, movimentos: caixa.sangrias || [] } });
  } catch (err) {
    next(err);
  }
});

// GET /api/caixas — histórico de caixas
router.get('/', async (req, res, next) => {
  try {
    const result = await findManyPaginated(prisma.caixa, req.query, {
      where: { empresaId: req.auth.empresaId },
      orderBy: { abertura: 'desc' },
      take: 50,
    });

    sendList(res, result);
  } catch (err) {
    next(err);
  }
});

// POST /api/caixas — abre novo caixa
router.post('/', async (req, res, next) => {
  try {
    const { operador, fundo, obs, aberturaStr } = req.body;

    // Fecha caixa anterior do mesmo operador (re-abertura no mesmo terminal)
    await prisma.caixa.updateMany({
      where: { empresaId: req.auth.empresaId, operadorId: req.auth.userId, aberto: true },
      data:  { aberto: false, fechamento: new Date() },
    });

    const agora = new Date();
    const caixa = await prisma.caixa.create({
      data: {
        aberto:      true,
        operador:    operador    || 'Operador',
        operadorId:  req.auth.userId,
        fundo:       fundo       || 0,
        abertura:    agora,
        aberturaStr: aberturaStr || agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        sangrias:    [],
        empresaId:   req.auth.empresaId,
      },
    });

    res.status(201).json({ ok: true, data: { ...caixa, movimentos: [] } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/caixas/:id — adiciona movimento ou fecha caixa
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.caixa.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId, operadorId: req.auth.userId },
    });

    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Caixa não encontrado.' });
    }

    const { movimento, aberto, fechamento, totalVendas } = req.body;
    const data = {};

    if (movimento) {
      const movimentos = Array.isArray(existe.sangrias) ? existe.sangrias : [];
      movimentos.push(movimento);
      data.sangrias = movimentos;
    }

    if (aberto === false) {
      data.aberto     = false;
      data.fechamento = fechamento ? new Date(fechamento) : new Date();
      if (totalVendas !== undefined) data.totalVendas = totalVendas;
    }

    const caixa = await prisma.caixa.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ ok: true, data: { ...caixa, movimentos: caixa.sangrias || [] } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
