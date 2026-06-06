const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('clientes'));

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
    const { status } = req.query;
    const vendedores = await prisma.vendedor.findMany({
      where: { empresaId: req.auth.empresaId, ...(status && { status }) },
      orderBy: { nome: 'asc' },
    });
    res.json({ ok: true, data: vendedores });
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
