const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('produtos'));

// ── GET /api/categorias ───────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const categorias = await prisma.categoria.findMany({
      where:   { empresaId: req.auth.empresaId },
      orderBy: { nome: 'asc' },
    });
    res.json({ ok: true, data: categorias });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/categorias ──────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { nome, tipo } = z.object({
      nome: z.string().min(1),
      tipo: z.string().optional(),
    }).parse(req.body);

    // Evita duplicata por nome dentro da empresa
    const existe = await prisma.categoria.findFirst({
      where: { nome: { equals: nome, mode: 'insensitive' }, empresaId: req.auth.empresaId },
    });
    if (existe) return res.status(409).json({ ok: false, message: 'Categoria já existe.' });

    const cat = await prisma.categoria.create({
      data: { nome, tipo, empresaId: req.auth.empresaId },
    });
    res.status(201).json({ ok: true, data: cat });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/categorias/:id ───────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.categoria.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Categoria não encontrada.' });

    const { nome, tipo } = z.object({
      nome: z.string().min(1).optional(),
      tipo: z.string().optional(),
    }).parse(req.body);

    const cat = await prisma.categoria.update({
      where: { id: req.params.id },
      data:  { ...(nome && { nome }), ...(tipo && { tipo }) },
    });
    res.json({ ok: true, data: cat });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/categorias/:id ────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.categoria.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Categoria não encontrada.' });

    await prisma.categoria.delete({ where: { id: req.params.id } });
    res.json({ ok: true, message: 'Categoria removida.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
