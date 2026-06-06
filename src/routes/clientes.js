const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('clientes'));

// ── Validação ─────────────────────────────────────────────
const clienteSchema = z.object({
  nome:        z.string().min(1),
  tipo:        z.enum(['pf', 'pj', 'mei']).optional(),
  secao:       z.enum(['clientes', 'fornecedores']).optional(),
  doc:         z.string().optional(),
  rg:          z.string().optional(),
  nascimento:  z.string().optional(),
  genero:      z.string().optional(),
  tel:         z.string().optional(),
  tel2:        z.string().optional(),
  email:       z.string().email().optional().or(z.literal('')),
  site:        z.string().optional(),
  cep:         z.string().optional(),
  logradouro:  z.string().optional(),
  numero:      z.string().optional(),
  complemento: z.string().optional(),
  bairro:      z.string().optional(),
  cidade:      z.string().optional(),
  estado:      z.string().optional(),
  pais:        z.string().optional(),
  status:      z.enum(['ativo', 'inativo', 'bloq']).optional(),
  limite:      z.number().min(0).optional(),
  desconto:    z.string().optional(),
  condicao:    z.string().optional(),
  vendedor:    z.string().optional(),
  vendedorId:  z.string().optional(),
  grupo:       z.string().optional(),
  origem:      z.string().optional(),
  tags:        z.string().optional(),
  obs:         z.string().optional(),
  cadastro:    z.string().optional(),
});

// ── GET /api/clientes ─────────────────────────────────────
// Aceita ?secao=clientes|fornecedores, ?q=busca, ?status=ativo|inativo
router.get('/', async (req, res, next) => {
  try {
    const { q, status, secao } = req.query;

    const where = {
      empresaId: req.auth.empresaId,
      ...(status && { status }),
      ...(secao  && { secao }),
      ...(q && {
        OR: [
          { nome:  { contains: q, mode: 'insensitive' } },
          { doc:   { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { tel:   { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const clientes = await prisma.cliente.findMany({
      where,
      orderBy: { nome: 'asc' },
    });

    res.json({ ok: true, data: clientes });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/clientes/:id ─────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });

    if (!cliente) {
      return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });
    }

    res.json({ ok: true, data: cliente });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/clientes ────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const data = clienteSchema.parse(req.body);

    const cliente = await prisma.cliente.create({
      data: { ...data, empresaId: req.auth.empresaId },
    });

    res.status(201).json({ ok: true, data: cliente });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/clientes/:id ─────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });
    }

    const data = clienteSchema.partial().parse(req.body);

    const cliente = await prisma.cliente.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ ok: true, data: cliente });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/clientes/:id ──────────────────────────────
// Desativa — nunca apaga para preservar histórico de pedidos
router.delete('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });
    }

    await prisma.cliente.update({
      where: { id: req.params.id },
      data: { status: 'inativo' },
    });

    res.json({ ok: true, message: 'Cliente desativado.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
