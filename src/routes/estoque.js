const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('estoque'));

// ── Validação ─────────────────────────────────────────────
const movimentacaoSchema = z.object({
  tipo:     z.enum(['entrada', 'saida', 'ajuste', 'transferencia']),
  prodId:   z.string().optional(),
  produto:  z.string().min(1),
  qty:      z.number(),
  deposito: z.string().optional(),
  destino:  z.string().optional(), // usado em transferencias
  motivo:   z.string().optional(),
  operador: z.string().optional(),
  data:     z.string().optional(),
});

// ── GET /api/estoque/movimentacoes ────────────────────────
// Lista movimentações com filtros
router.get('/movimentacoes', async (req, res, next) => {
  try {
    const { tipo, prodId, deposito, q } = req.query;

    const where = {
      empresaId: req.auth.empresaId,
      ...(tipo     && { tipo }),
      ...(prodId   && { prodId }),
      ...(deposito && { deposito }),
      ...(q && {
        OR: [
          { produto: { contains: q, mode: 'insensitive' } },
          { motivo:  { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const movimentacoes = await prisma.movimentacao.findMany({
      where,
      orderBy: { dataISO: 'desc' },
    });

    res.json({ ok: true, data: movimentacoes });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/estoque/posicao ──────────────────────────────
// Posição atual do estoque (todos os produtos com estoque e alertas)
router.get('/posicao', async (req, res, next) => {
  try {
    const { deposito, q } = req.query;

    const where = {
      empresaId: req.auth.empresaId,
      status: 'ativo',
      ...(deposito && { deposito }),
      ...(q && {
        OR: [
          { nome: { contains: q, mode: 'insensitive' } },
          { sku:  { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const produtos = await prisma.produto.findMany({
      where,
      select: {
        id: true, sku: true, nome: true, estoque: true,
        estoqueMin: true, estoqueMax: true, deposito: true,
        unidade: true, cor: true, emoji: true,
      },
      orderBy: { nome: 'asc' },
    });

    // Adiciona flag de alerta
    const data = produtos.map(p => ({
      ...p,
      alerta: p.estoqueMin > 0 && p.estoque <= p.estoqueMin,
    }));

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/estoque/movimentacoes ───────────────────────
// Registra movimentação e ajusta estoque do produto
router.post('/movimentacoes', async (req, res, next) => {
  try {
    const data = movimentacaoSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      // Atualiza estoque do produto se prodId informado
      if (data.prodId) {
        const prod = await tx.produto.findFirst({
          where: { id: data.prodId, empresaId: req.auth.empresaId },
        });

        if (prod) {
          let novoEstoque = prod.estoque;

          if (data.tipo === 'entrada') {
            novoEstoque += data.qty;
          } else if (data.tipo === 'saida') {
            novoEstoque = Math.max(0, novoEstoque - data.qty);
          } else if (data.tipo === 'ajuste') {
            novoEstoque = data.qty; // qty = valor absoluto no ajuste
          }
          // transferencia não altera o total, só muda depósito

          await tx.produto.update({
            where: { id: data.prodId },
            data:  { estoque: novoEstoque },
          });
        }
      }

      return tx.movimentacao.create({
        data: { ...data, empresaId: req.auth.empresaId },
      });
    });

    res.status(201).json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/estoque/depositos ────────────────────────────
router.get('/depositos', async (req, res, next) => {
  try {
    const depositos = await prisma.deposito.findMany({
      where:   { empresaId: req.auth.empresaId, ativo: true },
      orderBy: { nome: 'asc' },
    });
    res.json({ ok: true, data: depositos });
  } catch (err) {
    next(err);
  }
});

const depositoSchema = z.object({
  nome:     z.string().min(1),
  tipo:     z.string().optional(),
  endereco: z.string().optional(),
  icone:    z.string().optional(),
  cor:      z.string().optional(),
});

// ── POST /api/estoque/depositos ───────────────────────────
router.post('/depositos', async (req, res, next) => {
  try {
    const data = depositoSchema.parse(req.body);
    const deposito = await prisma.deposito.create({
      data: { ...data, empresaId: req.auth.empresaId },
    });
    res.status(201).json({ ok: true, data: deposito });
  } catch (err) { next(err); }
});

// ── PUT /api/estoque/depositos/:id ────────────────────────
router.put('/depositos/:id', async (req, res, next) => {
  try {
    const existe = await prisma.deposito.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Depósito não encontrado.' });

    const data = depositoSchema.partial().parse(req.body);
    const deposito = await prisma.deposito.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, data: deposito });
  } catch (err) { next(err); }
});

// ── DELETE /api/estoque/depositos/:id ─────────────────────
router.delete('/depositos/:id', async (req, res, next) => {
  try {
    const existe = await prisma.deposito.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Depósito não encontrado.' });

    await prisma.deposito.delete({ where: { id: req.params.id } });
    res.json({ ok: true, message: 'Depósito excluído.' });
  } catch (err) { next(err); }
});

module.exports = router;
