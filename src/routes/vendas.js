const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('vendas'));

// ── Validação ─────────────────────────────────────────────
const vendaSchema = z.object({
  id:            z.string().optional(),
  cliente:       z.string().optional(),
  clienteId:     z.string().optional(),
  operador:      z.string().optional(),
  operadorId:    z.string().optional(),
  metodo:        z.string().optional(),
  itens:         z.array(z.any()).optional(),
  subtotal:      z.number().min(0).optional(),
  desconto:      z.number().min(0).optional(),
  total:         z.number().min(0).optional(),
  status:        z.enum(['concluida', 'cancelada', 'estornada']).optional(),
  tipo:          z.enum(['pdv', 'pedido']).optional(),
  estornoMotivo: z.string().optional(),
  dataStr:       z.string().optional(),
  horaStr:       z.string().optional(),
});

// ── GET /api/vendas ───────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { status, tipo, q, operadorId } = req.query;

    const where = {
      empresaId: req.auth.empresaId,
      ...(status     && { status }),
      ...(tipo       && { tipo }),
      ...(operadorId && { operadorId }),
      ...(q && {
        OR: [
          { id:      { contains: q, mode: 'insensitive' } },
          { cliente: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const vendas = await prisma.venda.findMany({
      where,
      orderBy: { dataISO: 'desc' },
    });

    res.json({ ok: true, data: vendas });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/vendas/:id ───────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const venda = await prisma.venda.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });

    if (!venda) {
      return res.status(404).json({ ok: false, message: 'Venda não encontrada.' });
    }

    res.json({ ok: true, data: venda });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/vendas ──────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const data = vendaSchema.parse(req.body);

    const id   = data.id   || `VDA-${Date.now().toString(36).toUpperCase()}`;
    const tipo = data.tipo ?? 'pdv';

    const venda = await prisma.$transaction(async (tx) => {
      // 1. Decrementa estoque e incrementa vendas + cria movimentação por item
      if (data.itens && data.itens.length > 0) {
        for (const item of data.itens) {
          if (!item.id) continue;

          const prod = await tx.produto.findFirst({
            where: { id: item.id, empresaId: req.auth.empresaId },
          });

          if (prod) {
            if (prod.controlEstoque !== false) {
              await tx.produto.update({
                where: { id: item.id },
                data: {
                  estoque: Math.max(0, prod.estoque - (item.qty || 1)),
                  vendas:  prod.vendas + (item.qty || 1),
                },
              });
            }

            // Movimentação de saída de estoque
            await tx.movimentacao.create({
              data: {
                tipo:      'saida',
                prodId:    item.id,
                produto:   item.nome || prod.nome,
                qty:       item.qty  || 1,
                motivo:    tipo === 'pdv' ? 'Venda PDV' : 'Venda por pedido',
                operador:  data.operador,
                empresaId: req.auth.empresaId,
              },
            });
          }
        }
      }

      // 2. Cria a venda
      const novaVenda = await tx.venda.create({
        data: {
          ...data,
          id,
          itens:     data.itens ?? [],
          status:    data.status ?? 'concluida',
          tipo,
          empresaId: req.auth.empresaId,
        },
      });

      // 3. Cria lançamento de receita no financeiro vinculado à venda
      const hoje = new Date().toISOString().slice(0, 10);
      await tx.lancamento.create({
        data: {
          tipo:           'receita',
          descricao:      tipo === 'pdv' ? `Venda PDV ${id}` : `Venda pedido ${id}`,
          valor:          data.total ?? 0,
          categoria:      'Vendas',
          parte:          data.cliente || null,
          status:         'pago',
          vencimento:     hoje,
          pagoEm:         hoje,
          formaPagamento: data.metodo || null,
          vendaId:        id,
          empresaId:      req.auth.empresaId,
        },
      });

      return novaVenda;
    });

    res.status(201).json({ ok: true, data: venda });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/vendas/:id ───────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.venda.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Venda não encontrada.' });
    }

    const data = vendaSchema.partial().parse(req.body);

    // Estorno: devolve estoque + marca lançamento original como estornado
    if (data.status === 'estornada' && existe.status === 'concluida') {
      await prisma.$transaction(async (tx) => {
        const itens = existe.itens || [];

        // 1. Devolve estoque e cria movimentação de entrada por item
        for (const item of itens) {
          if (!item.id) continue;

          await tx.produto.updateMany({
            where: { id: item.id, empresaId: req.auth.empresaId },
            data:  { estoque: { increment: item.qty || 1 } },
          });

          await tx.movimentacao.create({
            data: {
              tipo:      'entrada',
              prodId:    item.id,
              produto:   item.nome || item.id,
              qty:       item.qty  || 1,
              motivo:    `Estorno venda ${existe.id}`,
              empresaId: req.auth.empresaId,
            },
          });
        }

        // 2. Marca o lançamento original como estornado (sem criar novo registro)
        await tx.lancamento.updateMany({
          where: { vendaId: existe.id, empresaId: req.auth.empresaId },
          data:  { status: 'estornado', obs: data.estornoMotivo || null },
        });

        await tx.venda.update({
          where: { id: req.params.id },
          data,
        });
      });

      const venda = await prisma.venda.findUnique({ where: { id: req.params.id } });
      return res.json({ ok: true, data: venda });
    }

    const venda = await prisma.venda.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ ok: true, data: venda });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
