const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('financeiro'));

const custoSchema = z.object({
  descricao:     z.string().min(1),
  categoria:     z.string().optional(),
  valor:         z.number().min(0),
  data:          z.string().optional(),
  tipo:          z.enum(['custo', 'despesa']).optional(),
  fornecedor:    z.string().optional(),
  obs:           z.string().optional(),
  recorrenciaId: z.string().optional(),
});

// ── GET /api/custos ───────────────────────────────────────
// ?tipo=custo|despesa, ?categoria=, ?dataInicio=YYYY-MM-DD, ?dataFim=YYYY-MM-DD
router.get('/', async (req, res, next) => {
  try {
    const { tipo, categoria, dataInicio, dataFim } = req.query;
    const where = {
      empresaId: req.auth.empresaId,
      ...(tipo      && { tipo }),
      ...(categoria && { categoria }),
      ...((dataInicio || dataFim) && {
        criadoEm: {
          ...(dataInicio && { gte: new Date(`${dataInicio}T00:00:00`) }),
          ...(dataFim    && { lte: new Date(`${dataFim}T23:59:59`) }),
        },
      }),
    };
    const result = await findManyPaginated(prisma.custo, req.query, { where, orderBy: { criadoEm: 'desc' } });
    sendList(res, result);
  } catch (err) { next(err); }
});

// ── POST /api/custos ──────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const data = custoSchema.parse(req.body);
    const custo = await prisma.custo.create({
      data: { ...data, tipo: data.tipo || 'custo', empresaId: req.auth.empresaId },
    });
    res.status(201).json({ ok: true, data: custo });
  } catch (err) { next(err); }
});

// ── PUT /api/custos/:id ───────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.custo.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Custo não encontrado.' });

    const data = custoSchema.partial().parse(req.body);
    const custo = await prisma.custo.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, data: custo });
  } catch (err) { next(err); }
});

// ── DELETE /api/custos/:id ────────────────────────────────
// Deleta um único custo. Com ?serie=1, deleta todos da mesma recorrenciaId.
router.delete('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.custo.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Custo não encontrado.' });

    if (req.query.serie === '1' && existe.recorrenciaId) {
      const { count } = await prisma.custo.deleteMany({
        where: { recorrenciaId: existe.recorrenciaId, empresaId: req.auth.empresaId },
      });
      return res.json({ ok: true, message: `${count} lançamentos da série removidos.`, count });
    }

    await prisma.custo.delete({ where: { id: req.params.id } });
    res.json({ ok: true, message: 'Custo removido.' });
  } catch (err) { next(err); }
});

module.exports = router;
