const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('financeiro'));

// ── Validação ─────────────────────────────────────────────
const lancamentoSchema = z.object({
  tipo:           z.enum(['receita', 'despesa']),
  descricao:      z.string().min(1),
  valor:          z.number().min(0),
  vencimento:     z.string().optional(),
  categoria:      z.string().optional(),
  parte:          z.string().optional(), // cliente ou fornecedor envolvido
  status:         z.enum(['avencer', 'pago', 'vencida']).optional(),
  obs:            z.string().optional(),
  pagoEm:         z.string().optional(),
  formaPagamento: z.string().optional(),
});

// ── GET /api/financeiro ───────────────────────────────────
// Aceita ?tipo=receita|despesa, ?status=avencer|pago|vencida, ?q=
router.get('/', async (req, res, next) => {
  try {
    const { tipo, status, q } = req.query;

    const where = {
      empresaId: req.auth.empresaId,
      ...(tipo   && { tipo }),
      ...(status && { status }),
      ...(q && {
        OR: [
          { descricao: { contains: q, mode: 'insensitive' } },
          { categoria: { contains: q, mode: 'insensitive' } },
          { parte:     { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const lancamentos = await prisma.lancamento.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
    });

    res.json({ ok: true, data: lancamentos });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/financeiro/resumo ────────────────────────────
// Totais de receitas, despesas e saldo
router.get('/resumo', async (req, res, next) => {
  try {
    const base = { empresaId: req.auth.empresaId };

    const [receitas, despesas] = await Promise.all([
      prisma.lancamento.aggregate({
        where:  { ...base, tipo: 'receita', status: 'pago' },
        _sum:   { valor: true },
      }),
      prisma.lancamento.aggregate({
        where:  { ...base, tipo: 'despesa', status: 'pago' },
        _sum:   { valor: true },
      }),
    ]);

    const totalReceitas = receitas._sum.valor ?? 0;
    const totalDespesas = despesas._sum.valor ?? 0;

    res.json({
      ok: true,
      data: {
        receitas: totalReceitas,
        despesas: totalDespesas,
        saldo:    totalReceitas - totalDespesas,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/financeiro/:id ───────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const lancamento = await prisma.lancamento.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });

    if (!lancamento) {
      return res.status(404).json({ ok: false, message: 'Lançamento não encontrado.' });
    }

    res.json({ ok: true, data: lancamento });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/financeiro ──────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const data = lancamentoSchema.parse(req.body);

    const lancamento = await prisma.lancamento.create({
      data: { ...data, empresaId: req.auth.empresaId },
    });

    res.status(201).json({ ok: true, data: lancamento });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/financeiro/:id ───────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.lancamento.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Lançamento não encontrado.' });
    }

    const data = lancamentoSchema.partial().parse(req.body);

    const lancamento = await prisma.lancamento.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ ok: true, data: lancamento });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/financeiro/:id ────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.lancamento.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Lançamento não encontrado.' });
    }

    await prisma.lancamento.delete({ where: { id: req.params.id } });

    res.json({ ok: true, message: 'Lançamento removido.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
