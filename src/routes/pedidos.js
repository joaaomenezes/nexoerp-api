const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('pedidos'));

// ── Validação ─────────────────────────────────────────────
const pedidoItemSchema = z.object({
  id:       z.string().optional(),
  nome:     z.string().optional(),
  sku:      z.string().optional(),
  unidade:  z.string().optional(),
  emoji:    z.string().optional(),
  preco:    z.number().min(0).optional(),
  qty:      z.number().positive().optional(),
  descItem: z.number().min(0).optional(),
  subtotal: z.number().min(0).optional(),
}).passthrough();

const pedidoSchema = z.object({
  id:         z.string().optional(),
  status:     z.enum(['pendente', 'faturado', 'concluido', 'cancelado']).optional(),
  cliente:    z.string().optional(),
  clienteId:  z.string().optional(),
  vendedor:   z.string().optional(),
  vendedorId: z.string().optional(),
  itens:      z.array(pedidoItemSchema).optional(),
  subtotal:   z.number().min(0).optional(),
  desconto:   z.number().min(0).optional(),
  total:      z.number().min(0).optional(),
  forma:      z.string().optional(),
  condicao:   z.string().optional(),
  obs:        z.string().optional(),
  criadoPor:  z.string().optional(),
  temBoleto:  z.boolean().optional(),
  historico:  z.array(z.any()).optional(),
  dataStr:    z.string().optional(),
  validade:   z.string().optional(),
  entrega:    z.string().optional(),
  obsCliente: z.string().optional(),
  obsInterna: z.string().optional(),
  ref:        z.string().optional(),
  parcelas:   z.array(z.any()).optional(),
});

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isPedidoRecebido(status, condicao) {
  const c = String(condicao || '').trim().toLowerCase();
  return status === 'concluido' || ['avista', 'à vista', 'a vista', 'pago', 'recebido'].includes(c);
}

function firstVencimento(pedido) {
  const parcelas = Array.isArray(pedido.parcelas) ? pedido.parcelas : [];
  const primeira = parcelas.find(p => p && (p.dataISO || p.data));
  return primeira?.dataISO || primeira?.data || todayISO();
}

function isFormaBoleto(forma) {
  return String(forma || '').trim().toLowerCase().includes('boleto');
}

function buildLancamentoPedido(pedido, statusDestino) {
  const recebido = isPedidoRecebido(statusDestino, pedido.condicao);
  const data = todayISO();
  return {
    status: recebido ? 'pago' : 'avencer',
    vencimento: recebido ? data : firstVencimento(pedido),
    pagoEm: recebido ? data : null,
  };
}

function historicoAtual(pedido) {
  return Array.isArray(pedido.historico) ? pedido.historico : [];
}

function novoEvento(tipo, titulo, req) {
  return {
    tipo,
    titulo,
    dataISO: new Date().toISOString(),
    usuario: req.auth.nome || 'Sistema',
    userId: req.auth.userId || null,
  };
}

function appendEvento(pedido, evento) {
  return [...historicoAtual(pedido), evento];
}

function itemProdutoId(item) {
  return item?.id || item?.produtoId || item?.prodId || null;
}

function itemQty(item) {
  const qty = Number(item?.qty || item?.quantidade || 1);
  return qty > 0 ? qty : 1;
}

async function assertEstoqueDisponivel(tx, itens, empresaId) {
  for (const item of itens) {
    const prodId = itemProdutoId(item);
    if (!prodId) continue;
    const qty = itemQty(item);
    if (qty <= 0) throw httpError(400, 'Quantidade inválida no pedido.');

    const prod = await tx.produto.findFirst({
      where: { id: prodId, empresaId },
    });
    if (!prod || prod.controlEstoque === false || prod.vendaSemEstoque) continue;
    if (prod.estoque < qty) {
      throw httpError(400, `Estoque insuficiente para "${prod.nome}". Disponível: ${prod.estoque}.`);
    }
  }
}

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
      data: {
        ...data,
        id,
        itens: data.itens ?? [],
        empresaId: req.auth.empresaId,
        criadoPor: data.criadoPor || req.auth.nome || null,
        vendedor: data.vendedor || req.auth.nome || null,
        historico: [
          novoEvento('pedido_criado', 'Pedido criado', req),
        ],
      },
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
    const statusDestino = data.status;

    if (data.temBoleto === true && !existe.temBoleto) {
      if (!['faturado', 'concluido'].includes(existe.status)) {
        return res.status(400).json({ ok: false, message: 'Fature ou conclua o pedido antes de gerar boleto.' });
      }
      if (!isFormaBoleto(existe.forma)) {
        return res.status(400).json({ ok: false, message: 'Boleto só pode ser gerado quando a forma de pagamento for boleto.' });
      }
      data.historico = appendEvento(existe, novoEvento('boleto_gerado', 'Boleto gerado', req));
    }

    if (['faturado', 'concluido'].includes(statusDestino) && ['faturado', 'concluido'].includes(existe.status)) {
      await prisma.$transaction(async (tx) => {
        const updateData = { ...data };

        if (statusDestino === 'concluido' && existe.status !== 'concluido') {
          updateData.historico = appendEvento(existe, novoEvento('pedido_concluido', 'Venda concluída', req));
          const hoje = todayISO();
          await tx.lancamento.updateMany({
            where: { pedidoId: req.params.id, empresaId: req.auth.empresaId },
            data: {
              status: 'pago',
              vencimento: hoje,
              pagoEm: hoje,
              formaPagamento: existe.forma || null,
            },
          });
        }
        await tx.pedido.update({ where: { id: req.params.id }, data: updateData });
      });

      const pedido = await prisma.pedido.findUnique({ where: { id: req.params.id } });
      return res.json({ ok: true, data: pedido });
    }

    // Quando faturado pela primeira vez: estoque + venda + lancamento
    if (data.status === 'faturado' && existe.status !== 'faturado') {
      await prisma.$transaction(async (tx) => {
        // 1. Decrementa estoque + cria movimentações
        const itens = existe.itens || [];
        await assertEstoqueDisponivel(tx, itens, req.auth.empresaId);
        for (const item of itens) {
          const prodId = itemProdutoId(item);
          if (!prodId) continue;
          const qty = itemQty(item);
          const prod = await tx.produto.findFirst({
            where: { id: prodId, empresaId: req.auth.empresaId },
          });
          if (prod && prod.controlEstoque !== false) {
            await tx.produto.update({
              where: { id: prodId },
              data: {
                estoque: Math.max(0, prod.estoque - qty),
                vendas:  prod.vendas + qty,
              },
            });
          }
          await tx.movimentacao.create({
            data: {
              tipo:      'saida',
              prodId,
              produto:   item.nome || prodId,
              qty,
              motivo:    `Faturamento pedido ${existe.id}`,
              empresaId: req.auth.empresaId,
            },
          });
        }

        // 2. Gera venda vinculada ao pedido
        const vendaId = `VDA-${Date.now().toString(36).toUpperCase()}`;
        const agora = new Date();
        await tx.venda.create({
          data: {
            id:        vendaId,
            tipo:      'pedido',
            cliente:   existe.cliente   || null,
            clienteId: existe.clienteId || null,
            operador:  existe.vendedor || existe.criadoPor || req.auth.nome || null,
            operadorId: existe.vendedorId || req.auth.userId || null,
            itens:     existe.itens     ?? [],
            subtotal:  existe.subtotal  ?? 0,
            desconto:  existe.desconto  ?? 0,
            total:     existe.total     ?? 0,
            metodo:    existe.forma     || null,
            status:    'concluida',
            dataStr:   agora.toLocaleDateString('pt-BR'),
            horaStr:   agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            empresaId: req.auth.empresaId,
          },
        });

        // 3. Cria lançamento de receita (a vencer)
        const financeiro = buildLancamentoPedido(existe, data.status);
        await tx.lancamento.create({
          data: {
            tipo:      'receita',
            descricao: `Pedido ${existe.id} — ${existe.cliente || 'sem cliente'}`,
            valor:     existe.total ?? 0,
            categoria: 'Pedido de Venda',
            parte:     existe.cliente || null,
            status:    financeiro.status,
            vencimento: financeiro.vencimento,
            pagoEm:    financeiro.pagoEm,
            formaPagamento: existe.forma || null,
            vendaId,
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

        await tx.pedido.update({
          where: { id: req.params.id },
          data: {
            ...data,
            historico: appendEvento(existe, novoEvento('nfe_emitida', 'NF-e emitida - Pedido faturado', req)),
          },
        });
      });

      const pedido = await prisma.pedido.findUnique({ where: { id: req.params.id } });
      return res.json({ ok: true, data: pedido });
    }

    // Quando concluído (sem NF-e): mesma lógica do faturado
    if (data.status === 'concluido' && existe.status !== 'concluido') {
      await prisma.$transaction(async (tx) => {
        const itens = existe.itens || [];
        await assertEstoqueDisponivel(tx, itens, req.auth.empresaId);
        for (const item of itens) {
          const prodId = itemProdutoId(item);
          if (!prodId) continue;
          const qty = itemQty(item);
          const prod = await tx.produto.findFirst({
            where: { id: prodId, empresaId: req.auth.empresaId },
          });
          if (prod && prod.controlEstoque !== false) {
            await tx.produto.update({
              where: { id: prodId },
              data: {
                estoque: Math.max(0, prod.estoque - qty),
                vendas:  prod.vendas + qty,
              },
            });
          }
          await tx.movimentacao.create({
            data: {
              tipo:      'saida',
              prodId,
              produto:   item.nome || prodId,
              qty,
              motivo:    `Conclusão pedido ${existe.id}`,
              empresaId: req.auth.empresaId,
            },
          });
        }

        const vendaId = `VDA-${Date.now().toString(36).toUpperCase()}`;
        const agora = new Date();
        await tx.venda.create({
          data: {
            id:        vendaId,
            tipo:      'pedido',
            cliente:   existe.cliente   || null,
            clienteId: existe.clienteId || null,
            operador:  existe.vendedor || existe.criadoPor || req.auth.nome || null,
            operadorId: existe.vendedorId || req.auth.userId || null,
            itens:     existe.itens     ?? [],
            subtotal:  existe.subtotal  ?? 0,
            desconto:  existe.desconto  ?? 0,
            total:     existe.total     ?? 0,
            metodo:    existe.forma     || null,
            status:    'concluida',
            dataStr:   agora.toLocaleDateString('pt-BR'),
            horaStr:   agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            empresaId: req.auth.empresaId,
          },
        });

        const financeiro = buildLancamentoPedido(existe, data.status);
        await tx.lancamento.create({
          data: {
            tipo:      'receita',
            descricao: `Pedido ${existe.id} — ${existe.cliente || 'sem cliente'}`,
            valor:     existe.total ?? 0,
            categoria: 'Pedido de Venda',
            parte:     existe.cliente || null,
            status:    financeiro.status,
            vencimento: financeiro.vencimento,
            pagoEm:    financeiro.pagoEm,
            formaPagamento: existe.forma || null,
            vendaId,
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

        await tx.pedido.update({
          where: { id: req.params.id },
          data: {
            ...data,
            historico: appendEvento(existe, novoEvento('pedido_concluido', 'Venda concluída', req)),
          },
        });
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
          const prodId = itemProdutoId(item);
          if (!prodId) continue;
          const qty = itemQty(item);
          const prod = await tx.produto.findFirst({
            where: { id: prodId, empresaId: req.auth.empresaId },
          });
          if (prod && prod.controlEstoque !== false) {
            await tx.produto.updateMany({
              where: { id: prodId, empresaId: req.auth.empresaId },
              data: {
                estoque: { increment: qty },
                vendas:  Math.max(0, prod.vendas - qty),
              },
            });
          }
          await tx.movimentacao.create({
            data: {
              tipo:      'entrada',
              prodId,
              produto:   item.nome || prodId,
              qty,
              motivo:    `Cancelamento pedido ${existe.id}`,
              empresaId: req.auth.empresaId,
            },
          });
        }

        // Estorna lançamento financeiro
        const lancamentos = await tx.lancamento.findMany({
          where: { pedidoId: req.params.id, empresaId: req.auth.empresaId },
          select: { vendaId: true },
        });
        const vendaIds = lancamentos.map(l => l.vendaId).filter(Boolean);

        if (vendaIds.length) {
          await tx.venda.updateMany({
            where: { id: { in: vendaIds }, empresaId: req.auth.empresaId },
            data: { status: 'estornada', estornoMotivo: `Cancelamento pedido ${existe.id}` },
          });
        }

        await tx.lancamento.updateMany({
          where: { pedidoId: req.params.id, empresaId: req.auth.empresaId },
          data:  { status: 'estornado' },
        });
      }

      await tx.pedido.update({
        where: { id: req.params.id },
        data: {
          status: 'cancelado',
          historico: appendEvento(existe, novoEvento('pedido_cancelado', 'Pedido cancelado', req)),
        },
      });
    });

    res.json({ ok: true, message: 'Pedido cancelado.' });
  } catch (err) { next(err); }
});

module.exports = router;
