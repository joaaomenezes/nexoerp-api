const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('clientes'));

const SORT_FIELDS = new Set(['nome', 'tipo', 'status', 'cadastro', 'criadoEm', 'atualizadoEm']);

function buildVendedorWhere(req) {
  const { q, status, tipo } = req.query;
  const search = typeof q === 'string' ? q.trim() : '';

  const where = {
    empresaId: req.auth.empresaId,
  };

  if (status === 'ativo' || status === 'inativo') where.status = status;
  if (tipo === 'pf' || tipo === 'pj') where.tipo = tipo;
  if (search) {
    where.OR = [
      { nome:  { contains: search, mode: 'insensitive' } },
      { doc:   { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { tel:   { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}

function buildVendedorOrderBy(query) {
  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : '';
  const sortDir = query.sortDir === 'desc' ? 'desc' : 'asc';

  if (!SORT_FIELDS.has(sortBy)) return { nome: 'asc' };
  return { [sortBy]: sortDir };
}

const vendedorSchema = z.object({
  nome:     z.string().min(1),
  tipo:     z.enum(['pf', 'pj']).optional(),
  doc:      z.string().optional(),
  tel:      z.string().optional(),
  email:    z.string().email().optional().or(z.literal('')),
  status:   z.enum(['ativo', 'inativo']).optional(),
  cadastro: z.string().optional(),
});

// ── GET /api/vendedores ───────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const result = await findManyPaginated(prisma.vendedor, req.query, {
      where: buildVendedorWhere(req),
      orderBy: buildVendedorOrderBy(req.query),
    });
    sendList(res, result);
  } catch (err) { next(err); }
});

router.get('/resumo', async (req, res, next) => {
  try {
    const itens = await prisma.vendedor.findMany({
      where: { empresaId: req.auth.empresaId },
      select: { status: true, cadastro: true },
    });

    const now = new Date();
    const mes = String(now.getMonth() + 1).padStart(2, '0');
    const ano = String(now.getFullYear());
    const resumo = itens.reduce((acc, item) => {
      acc.total += 1;
      if (item.status === 'ativo') acc.ativos += 1;
      if (item.status === 'inativo') acc.inativos += 1;
      const p = (item.cadastro || '').split('/');
      if (p[1] === mes && p[2] === ano) acc.mes += 1;
      return acc;
    }, { total: 0, ativos: 0, inativos: 0, mes: 0 });

    res.json({ ok: true, data: resumo });
  } catch (err) { next(err); }
});

// ── GET /api/vendedores/:id ───────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const v = await prisma.vendedor.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!v) return res.status(404).json({ ok: false, message: 'Vendedor não encontrado.' });
    res.json({ ok: true, data: v });
  } catch (err) { next(err); }
});

// ── POST /api/vendedores ──────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const data = vendedorSchema.parse(req.body);
    const v = await prisma.vendedor.create({ data: { ...data, empresaId: req.auth.empresaId } });
    res.status(201).json({ ok: true, data: v });
  } catch (err) { next(err); }
});

// ── PUT /api/vendedores/:id ───────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.vendedor.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Vendedor não encontrado.' });
    const data = vendedorSchema.partial().parse(req.body);
    const v = await prisma.vendedor.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, data: v });
  } catch (err) { next(err); }
});

// ── DELETE /api/vendedores/:id ────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.vendedor.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Vendedor não encontrado.' });
    await prisma.vendedor.delete({ where: { id: req.params.id } });
    res.json({ ok: true, message: 'Vendedor removido.' });
  } catch (err) { next(err); }
});

module.exports = router;
