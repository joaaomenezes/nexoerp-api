const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');

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
  status:         z.enum(['avencer', 'pago', 'vencida', 'recebido', 'conciliado', 'cancelado', 'estornado']).optional(),
  obs:            z.string().optional(),
  pagoEm:         z.string().optional(),
  formaPagamento: z.string().optional(),
  clienteId:      z.string().optional(),
  contaBancariaId: z.string().optional(),
  caixaId:        z.string().optional(),
  operadorId:     z.string().optional(),
  bandeiraCartao: z.string().optional(),
  adquirenteCartao: z.string().optional(),
  terminalId:     z.string().optional(),
  parcelasCartao: z.number().int().positive().optional(),
  parcelaNumero:  z.number().int().positive().optional(),
  valorBruto:     z.number().min(0).optional(),
  taxaPercentual: z.number().min(0).optional(),
  valorTaxa:      z.number().min(0).optional(),
  valorLiquidoPrevisto: z.number().min(0).optional(),
  recebidoEm:     z.string().optional(),
  conciliadoEm:   z.string().optional(),
});

// ── GET /api/financeiro ───────────────────────────────────
// Aceita ?tipo=receita|despesa, ?status=avencer|pago|vencida, ?q=
// ?criadoInicio=YYYY-MM-DD, ?criadoFim=YYYY-MM-DD
// ?clienteId=, ?formaPagamento=, ?pagoInicio=YYYY-MM-DD, ?pagoFim=YYYY-MM-DD
router.get('/', async (req, res, next) => {
  try {
    const { tipo, status, statusIn, q, criadoInicio, criadoFim, clienteId, formaPagamento, pagoInicio, pagoFim, sortBy, excludeStatus } = req.query;
    const excludedStatuses = String(excludeStatus || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const includedStatuses = String(statusIn || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const where = {
      empresaId: req.auth.empresaId,
      ...(tipo   && { tipo }),
      ...(status ? { status } : (includedStatuses.length ? { status: { in: includedStatuses } } : {})),
      ...(!status && !includedStatuses.length && excludedStatuses.length && { status: { notIn: excludedStatuses } }),
      ...(clienteId      && { clienteId }),
      ...(formaPagamento && { formaPagamento: { contains: formaPagamento, mode: 'insensitive' } }),
      ...(q && {
        OR: [
          { descricao: { contains: q, mode: 'insensitive' } },
          { categoria: { contains: q, mode: 'insensitive' } },
          { parte:     { contains: q, mode: 'insensitive' } },
          { vendaId:   { contains: q, mode: 'insensitive' } },
        ],
      }),
      ...((criadoInicio || criadoFim) && {
        criadoEm: {
          ...(criadoInicio && { gte: new Date(`${criadoInicio}T00:00:00`) }),
          ...(criadoFim    && { lte: new Date(`${criadoFim}T23:59:59`) }),
        },
      }),
      ...((pagoInicio || pagoFim) && {
        pagoEm: {
          ...(pagoInicio && { gte: pagoInicio }),
          ...(pagoFim    && { lte: pagoFim }),
        },
      }),
    };

    const orderBy = sortBy === 'pagoEm' ? { pagoEm: 'desc' } : { criadoEm: 'desc' };

    const result = await findManyPaginated(prisma.lancamento, req.query, {
      where,
      orderBy,
    });

    sendList(res, result);
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
        where:  { ...base, tipo: 'receita', status: { in: ['pago', 'recebido', 'conciliado'] } },
        _sum:   { valor: true },
      }),
      prisma.lancamento.aggregate({
        where:  { ...base, tipo: 'despesa', status: { in: ['pago', 'recebido', 'conciliado'] } },
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

// ── GET /api/financeiro/resumo-recebimentos ───────────────
// KPIs da aba Recebimentos: recebido hoje, mês, período e ticket médio
router.get('/resumo-recebimentos', async (req, res, next) => {
  try {
    const { pagoInicio, pagoFim, clienteId } = req.query;
    const hoje     = new Date().toISOString().slice(0, 10);
    const mesInicio = hoje.slice(0, 7) + '-01';
    const base = {
      empresaId: req.auth.empresaId,
      tipo:   'receita',
      status: { in: ['pago', 'recebido', 'conciliado'] },
      ...(clienteId && { clienteId }),
    };

    const periodoWhere = (pagoInicio || pagoFim)
      ? { ...base, pagoEm: { ...(pagoInicio && { gte: pagoInicio }), ...(pagoFim && { lte: pagoFim }) } }
      : base;

    const [aggHoje, aggMes, aggPeriodo] = await Promise.all([
      prisma.lancamento.aggregate({
        where: { ...base, pagoEm: { gte: hoje, lte: hoje } },
        _sum: { valor: true }, _count: { id: true },
      }),
      prisma.lancamento.aggregate({
        where: { ...base, pagoEm: { gte: mesInicio, lte: hoje } },
        _sum: { valor: true },
      }),
      prisma.lancamento.aggregate({
        where: periodoWhere,
        _sum: { valor: true }, _count: { id: true },
      }),
    ]);

    const totalPeriodo = aggPeriodo._sum.valor ?? 0;
    const countPeriodo = aggPeriodo._count.id  ?? 0;

    res.json({
      ok: true,
      data: {
        recebidoHoje: aggHoje._sum.valor ?? 0,
        recebidoMes:  aggMes._sum.valor  ?? 0,
        totalPeriodo,
        ticketMedio:  countPeriodo > 0 ? totalPeriodo / countPeriodo : 0,
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
