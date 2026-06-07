const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('pedidos'));

// ── Validação ─────────────────────────────────────────────
const pedidoSchema = z.object({
  id:         z.string().optional(),
  status:     z.enum(['pendente', 'faturado', 'concluido', 'cancelado']).optional(),
  cliente:    z.string().optional(),
  clienteId:  z.string().optional(),
  vendedor:   z.string().optional(),
  vendedorId: z.string().optional(),
  itens:      z.array(z.any()).optional(),
  subtotal:   z.number().min(0).optional(),
  desconto:   z.number().min(0).optional(),
  total:      z.number().min(0).optional(),
  forma:      z.string().optional(),
  condicao:   z.string().optional(),
  obs:        z.string().optional(),
  criadoPor:  z.string().optional(),
  temBoleto:  z.boolean().optional(),
  dataStr:    z.string().optional(),
  validade:   z.string().optional(),
  entrega:    z.string().optional(),
  obsCliente: z.string().optional(),
  obsInterna: z.string().optional(),
  ref:        z.string().optional(),
  parcelas:   z.array(z.any()).optional(),
});

// ── GET /api/pedidos ──────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { status, clienteId, q } = req.query;

    const where = {
      empresaId: req.auth.empresaId,
      ...(status    && { status }),
      ...(clienteId && { clienteId }),
      ...(q && {
        OR: [
          { id:      { contains: q, mode: 'insensitive' } },
          { cliente: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const pedidos = await prisma.pedido.findMany({ where, orderBy: { dataISO: 'desc' } });
    res.json({ ok: true, data: pedidos });
  } catch (err) { next(err); }
});

// ── GET /api/pedidos/:id ──────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const pedido = await prisma.pedido.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!pedido) return res.status(404).json({ ok: false, message: 'Pedido não encontrado.' });
    res.json({ ok: true, data: pedido });
  } catch (err) { next(err); }
});

// ── POST /api/pedidos ─────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const data = pedidoSchema.parse(req.body);
    const id = data.id || `PED-${Date.now().toString(36).toUpperCase()}`;
    const pedido = await prisma.pedido.create({
      data: { ...data, id, itens: data.itens ?? [], empresaId: req.auth.empresaId, criadoPor: data.criadoPor || req.auth.nome || null },
    });
    res.status(201).json({ ok: true, data: pedido });
  } catch (err) { next(err); }
});

// ── PUT /api/pedidos/:id ──────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.pedido.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Pedido não encontrado.' });

    const data = pedidoSchema.partial().parse(req.body);

    // Quando faturado pela primeira vez: estoque + venda + lancamento
    if (data.status === 'faturado' && existe.status !== 'faturado') {
      await prisma.$transaction(async (tx) => {
        // 1. Decrementa estoque + cria movimentações
        const itens = existe.itens || [];
        for (const item of itens) {
          if (!item.id) continue;
          const prod = await tx.produto.findFirst({
            where: { id: item.id, empresaId: req.auth.empresaId },
          });
          if (prod && prod.controlEstoque !== false) {
            await tx.produto.update({
              where: { id: item.id },
              data: {
                estoque: Math.max(0, prod.estoque - (item.qty || 1)),
                vendas:  prod.vendas + (item.qty || 1),
              },
            });
          }
          await tx.movimentacao.create({
            data: {
              tipo:      'saida',
              prodId:    item.id,
              produto:   item.nome || item.id,
              qty:       item.qty  || 1,
              motivo:    `Faturamento pedido ${existe.id}`,
              empresaId: req.auth.empresaId,
            },
          });
        }

        // 2. Gera venda vinculada ao pedido
        await tx.venda.create({
          data: {
            id:        `VDA-${Date.now().toString(36).toUpperCase()}`,
            tipo:      'pedido',
            cliente:   existe.cliente   || null,
            clienteId: existe.clienteId || null,
            itens:     existe.itens     ?? [],
            subtotal:  existe.subtotal  ?? 0,
            desconto:  existe.desconto  ?? 0,
            total:     existe.total     ?? 0,
            metodo:    existe.forma     || null,
            status:    'concluida',
            empresaId: req.auth.empresaId,
          },
        });

        // 3. Cria lançamento de receita (a vencer)
        await tx.lancamento.create({
          data: {
            tipo:      'receita',
            descricao: `Pedido ${existe.id} — ${existe.cliente || 'sem cliente'}`,
            valor:     existe.total ?? 0,
            categoria: 'Vendas',
            parte:     existe.cliente || null,
            status:    'avencer',
            pedidoId:  existe.id,
            empresaId: req.auth.empresaId,
          },
        });

        // 4. Incrementa contador de pedidos do cliente
        if (existe.clienteId) {
          await tx.cliente.updateMany({
            where: { id: existe.clienteId, empresaId: req.auth.empresaId },
            data:  { pedidos: { increment: 1 } },
          });
        }

        await tx.pedido.update({ where: { id: req.params.id }, data });
      });

      const pedido = await prisma.pedido.findUnique({ where: { id: req.params.id } });
      return res.json({ ok: true, data: pedido });
    }

    // Quando concluído (sem NF-e): mesma lógica do faturado
    if (data.status === 'concluido' && existe.status !== 'concluido') {
      await prisma.$transaction(async (tx) => {
        const itens = existe.itens || [];
        for (const item of itens) {
          if (!item.id) continue;
          const prod = await tx.produto.findFirst({
            where: { id: item.id, empresaId: req.auth.empresaId },
          });
          if (prod && prod.controlEstoque !== false) {
            await tx.produto.update({
              where: { id: item.id },
              data: {
                estoque: Math.max(0, prod.estoque - (item.qty || 1)),
                vendas:  prod.vendas + (item.qty || 1),
              },
            });
          }
          await tx.movimentacao.create({
            data: {
              tipo:      'saida',
              prodId:    item.id,
              produto:   item.nome || item.id,
              qty:       item.qty  || 1,
              motivo:    `Conclusão pedido ${existe.id}`,
              empresaId: req.auth.empresaId,
            },
          });
        }

        await tx.venda.create({
          data: {
            id:        `VDA-${Date.now().toString(36).toUpperCase()}`,
            tipo:      'pedido',
            cliente:   existe.cliente   || null,
            clienteId: existe.clienteId || null,
            itens:     existe.itens     ?? [],
            subtotal:  existe.subtotal  ?? 0,
            desconto:  existe.desconto  ?? 0,
            total:     existe.total     ?? 0,
            metodo:    existe.forma     || null,
            status:    'concluida',
            empresaId: req.auth.empresaId,
          },
        });

        await tx.lancamento.create({
          data: {
            tipo:      'receita',
            descricao: `Pedido ${existe.id} — ${existe.cliente || 'sem cliente'}`,
            valor:     existe.total ?? 0,
            categoria: 'Vendas',
            parte:     existe.cliente || null,
            status:    'avencer',
            pedidoId:  existe.id,
            empresaId: req.auth.empresaId,
          },
        });

        if (existe.clienteId) {
          await tx.cliente.updateMany({
            where: { id: existe.clienteId, empresaId: req.auth.empresaId },
            data:  { pedidos: { increment: 1 } },
          });
        }

        await tx.pedido.update({ where: { id: req.params.id }, data });
      });

      const pedido = await prisma.pedido.findUnique({ where: { id: req.params.id } });
      return res.json({ ok: true, data: pedido });
    }

    const pedido = await prisma.pedido.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, data: pedido });
  } catch (err) { next(err); }
});

// ── DELETE /api/pedidos/:id ───────────────────────────────
// Pendente → exclui permanentemente. Faturado/concluído → cancela e reverte estoque.
router.delete('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.pedido.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Pedido não encontrado.' });
    if (existe.status === 'cancelado') return res.json({ ok: true, message: 'Pedido já cancelado.' });

    // Pedido pendente: exclusão permanente
    if (existe.status === 'pendente') {
      await prisma.pedido.delete({ where: { id: req.params.id } });
      return res.json({ ok: true, deleted: true, message: 'Pedido excluído.' });
    }

    const eraFaturado = ['faturado', 'concluido'].includes(existe.status);

    await prisma.$transaction(async (tx) => {
      if (eraFaturado) {
        // Reverte estoque
        const itens = existe.itens || [];
        for (const item of itens) {
          if (!item.id) continue;
          const prod = await tx.produto.findFirst({
            where: { id: item.id, empresaId: req.auth.empresaId },
          });
          if (prod && prod.controlEstoque !== false) {
            await tx.produto.update({
              where: { id: item.id },
              data: { estoque: prod.estoque + (item.qty || 1) },
            });
          }
          await tx.movimentacao.create({
            data: {
              tipo:      'entrada',
              prodId:    item.id,
              produto:   item.nome || item.id,
              qty:       item.qty  || 1,
              motivo:    `Cancelamento pedido ${existe.id}`,
              empresaId: req.auth.empresaId,
            },
          });
        }

        // Estorna lançamento financeiro
        await tx.lancamento.updateMany({
          where: { pedidoId: req.params.id, empresaId: req.auth.empresaId },
          data:  { status: 'estornado' },
        });
      }

      await tx.pedido.update({ where: { id: req.params.id }, data: { status: 'cancelado' } });
    });

    res.json({ ok: true, message: 'Pedido cancelado.' });
  } catch (err) { next(err); }
});

module.exports = router;
