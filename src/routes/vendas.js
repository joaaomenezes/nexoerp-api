const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('vendas'));

// ── Validação ─────────────────────────────────────────────
const vendaItemSchema = z.object({
  id:       z.string().optional(),
  nome:     z.string().optional(),
  emoji:    z.string().optional(),
  preco:    z.number().min(0).optional(),
  qty:      z.number().positive().optional(),
  subtotal: z.number().min(0).optional(),
}).passthrough();

const vendaSchema = z.object({
  id:              z.string().optional(),
  cliente:         z.string().optional(),
  clienteId:       z.string().optional(),
  operador:        z.string().optional(),
  operadorId:      z.string().optional(),
  metodo:          z.string().optional(),
  itens:           z.array(vendaItemSchema).optional(),
  subtotal:        z.number().min(0).optional(),
  desconto:        z.number().min(0).optional(),
  total:           z.number().min(0).optional(),
  status:          z.enum(['concluida', 'faturada', 'cancelada', 'estornada']).optional(),
  tipo:            z.enum(['pdv', 'pedido']).optional(),
  pedidoId:        z.string().optional(),
  estornoMotivo:   z.string().optional(),
  dataStr:         z.string().optional(),
  horaStr:         z.string().optional(),
  vencimentoFiado: z.string().optional(),
  fiado:           z.object({
    clienteId:  z.string().optional(),
    vencimento: z.string().optional(),
  }).passthrough().optional(),
});

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function buildVendaWhere(req) {
  const { status, tipo, q, operadorId, metodo, dataInicio, dataFim, clienteId } = req.query;
  const where = {
    empresaId: req.auth.empresaId,
    ...(status && status !== 'todos' && { status }),
    ...(tipo && { tipo }),
    ...(operadorId && { operadorId }),
    ...(clienteId && { clienteId }),
  };

  if (q) {
    where.OR = [
      { id:      { contains: q, mode: 'insensitive' } },
      { pedidoId: { contains: q, mode: 'insensitive' } },
      { cliente: { contains: q, mode: 'insensitive' } },
    ];
  }

  if (metodo) {
    const metodoBusca = String(metodo).toLowerCase();
    if (['dinheiro', 'pix', 'credito', 'debito', 'multiplo'].includes(metodoBusca)) {
      where.metodo = { equals: metodoBusca, mode: 'insensitive' };
    } else {
      const aliases = {
        boleto: ['boleto'],
        duplicata: ['duplicata'],
        transferencia: ['transfer', 'pix'],
        cheque: ['cheque'],
      }[metodoBusca] || [metodoBusca];

      const metodoOr = aliases.map(alias => ({ metodo: { contains: alias, mode: 'insensitive' } }));
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: metodoOr }];
        delete where.OR;
      } else {
        where.OR = metodoOr;
      }
    }
  }

  if (dataInicio || dataFim) {
    where.dataISO = {};
    if (dataInicio) where.dataISO.gte = new Date(`${dataInicio}T00:00:00`);
    if (dataFim) where.dataISO.lte = new Date(`${dataFim}T23:59:59`);
  }

  return where;
}

function buildVendaOrderBy(query) {
  const sortMap = {
    id: 'id',
    pedidoId: 'pedidoId',
    cliente: 'cliente',
    total: 'total',
    data: 'dataISO',
    dataISO: 'dataISO',
  };
  const sortBy = sortMap[query.sortBy] || 'dataISO';
  const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';
  return { [sortBy]: sortDir };
}

// ── GET /api/vendas ───────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const result = await findManyPaginated(prisma.venda, req.query, {
      where: buildVendaWhere(req),
      orderBy: buildVendaOrderBy(req.query),
    });

    sendList(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/resumo', async (req, res, next) => {
  try {
    const vendas = await prisma.venda.findMany({
      where: buildVendaWhere(req),
      select: { status: true, total: true },
    });

    const resumo = vendas.reduce((acc, venda) => {
      if (venda.status === 'concluida' || venda.status === 'faturada') {
        acc.concluidas += 1;
        acc.faturamento += venda.total || 0;
      }
      if (venda.status === 'estornada') acc.estornos += 1;
      return acc;
    }, { concluidas: 0, faturamento: 0, estornos: 0 });

    resumo.ticketMedio = resumo.concluidas ? resumo.faturamento / resumo.concluidas : 0;
    res.json({ ok: true, data: resumo });
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

    const metodo   = String(data.metodo || '').toLowerCase();
    const isFiado  = metodo === 'fiado';
    const cidFiado = data.clienteId || data.fiado?.clienteId;
    const vencFiado = data.vencimentoFiado || data.fiado?.vencimento;

    if (isFiado) {
      if (!cidFiado) {
        return next(httpError(400, 'Para venda fiado, selecione ou cadastre um cliente e informe o vencimento.'));
      }
      if (!vencFiado) {
        return next(httpError(400, 'Informe o vencimento do fiado.'));
      }
    }

    const venda = await prisma.$transaction(async (tx) => {
      // 1. Decrementa estoque e incrementa vendas + cria movimentação por item
      if (data.itens && data.itens.length > 0) {
        for (const item of data.itens) {
          if (!item.id) continue;

          const prod = await tx.produto.findFirst({
            where: { id: item.id, empresaId: req.auth.empresaId },
          });

          if (prod) {
            const qty = Number(item.qty || 1);
            if (qty <= 0) throw httpError(400, 'Quantidade inválida na venda.');
            if (prod.controlEstoque !== false && !prod.vendaSemEstoque && prod.estoque < qty) {
              throw httpError(400, `Estoque insuficiente para "${prod.nome}". Disponível: ${prod.estoque}.`);
            }

            if (prod.controlEstoque !== false) {
              await tx.produto.update({
                where: { id: item.id },
                data: {
                  estoque: Math.max(0, prod.estoque - qty),
                  vendas:  prod.vendas + qty,
                },
              });
            }

            // Movimentação de saída de estoque
            await tx.movimentacao.create({
              data: {
                tipo:      'saida',
                prodId:    item.id,
                produto:   item.nome || prod.nome,
                qty,
                motivo:    tipo === 'pdv' ? 'Venda PDV' : 'Venda por pedido',
                operador:  data.operador,
                empresaId: req.auth.empresaId,
              },
            });
          }
        }
      }

      // 2. Cria a venda (exclui campos do fiado que não pertencem ao modelo Venda)
      const { vencimentoFiado: _vf, fiado: _fi, ...vendaFields } = data;
      const novaVenda = await tx.venda.create({
        data: {
          ...vendaFields,
          id,
          itens:     vendaFields.itens ?? [],
          status:    vendaFields.status ?? 'concluida',
          tipo,
          empresaId: req.auth.empresaId,
        },
      });

      // 3. Incrementa contador de compras do cliente (PDV)
      const clienteIdVenda = data.clienteId || data.fiado?.clienteId;
      if (clienteIdVenda) {
        await tx.cliente.updateMany({
          where: { id: clienteIdVenda, empresaId: req.auth.empresaId },
          data:  { compras: { increment: 1 } },
        });
      }

      // 4. Cria lançamento de receita no financeiro vinculado à venda
      const hoje = new Date().toISOString().slice(0, 10);
      await tx.lancamento.create({
        data: {
          tipo:           'receita',
          descricao:      tipo === 'pdv' ? `Venda PDV ${id}` : `Venda pedido ${id}`,
          valor:          data.total ?? 0,
          categoria:      'Vendas',
          parte:          data.cliente || null,
          status:         isFiado ? 'avencer' : 'pago',
          vencimento:     isFiado ? (vencFiado || hoje) : hoje,
          pagoEm:         isFiado ? null : hoje,
          formaPagamento: data.metodo || null,
          obs:            null,
          vendaId:        id,
          clienteId:      cidFiado || null,
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
    if (data.status === 'estornada' && (existe.status === 'concluida' || existe.status === 'faturada')) {
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
