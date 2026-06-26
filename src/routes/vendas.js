const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');
const { decryptCredentials } = require('../utils/integrationCrypto');
const { getPaymentProvider } = require('../services/paymentProviders');

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

const pagamentoSchema = z.object({
  metodo:         z.enum(['dinheiro', 'pix', 'credito', 'debito', 'voucher', 'vale', 'fiado']),
  valor:          z.number().positive(),
  status:         z.enum(['pendente', 'aguardando', 'confirmado', 'recusado']).optional(),
  valorRecebido:  z.number().min(0).optional(),
  troco:          z.number().min(0).optional(),
  bandeira:       z.string().nullable().optional(),
  parcelas:       z.number().int().positive().optional(),
  valorOriginal:  z.number().min(0).optional(),
  acrescimo:      z.number().min(0).optional(),
  vencimento:     z.string().nullable().optional(),
  cobrancaId:     z.string().nullable().optional(),
  providerPaymentId: z.string().nullable().optional(),
  provedor:       z.string().nullable().optional(),
  adquirente:     z.string().nullable().optional(),
  terminalId:     z.string().nullable().optional(),
  contaRecebimento: z.string().nullable().optional(),
  contaBancariaId: z.string().nullable().optional(),
  maquininhaNome: z.string().nullable().optional(),
  taxaPercentual: z.number().min(0).optional(),
  prazoPrimeiraParcelaDias: z.number().int().min(0).optional(),
  intervaloParcelasDias: z.number().int().min(1).optional(),
}).passthrough();

const vendaSchema = z.object({
  id:              z.string().optional(),
  cliente:         z.string().optional(),
  clienteId:       z.string().optional(),
  operador:        z.string().optional(),
  operadorId:      z.string().optional(),
  caixaId:         z.string().optional(),
  metodo:          z.string().optional(),
  pagamentos:      z.array(pagamentoSchema).max(10).optional(),
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

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDatePlusDays(baseISODate, days) {
  const date = new Date(`${baseISODate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizePaymentMethod(method) {
  return String(method || 'dinheiro')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function cardTaxPercent(payment) {
  if (Number.isFinite(payment.taxaPercentual)) return Number(payment.taxaPercentual);
  return payment.metodo === 'debito' ? 1.5 : 3;
}

function cardFirstDueDays(payment) {
  if (Number.isFinite(payment.prazoPrimeiraParcelaDias)) return Number(payment.prazoPrimeiraParcelaDias);
  return payment.metodo === 'debito' ? 1 : 30;
}

function cardInstallmentIntervalDays(payment) {
  if (Number.isFinite(payment.intervaloParcelasDias)) return Number(payment.intervaloParcelasDias);
  return 30;
}

function buildLancamentosVenda({ data, id, tipo, pagamentos, metodoVenda, isFiado, vencFiado, cidFiado, hoje, empresaId }) {
  const lancamentos = [];
  const base = {
    tipo: 'receita',
    categoria: 'Vendas',
    parte: data.cliente || null,
    vendaId: id,
    caixaId: data.caixaId || null,
    operadorId: data.operadorId || null,
    empresaId,
  };

  pagamentos.forEach((rawPayment) => {
    const payment = { ...rawPayment, metodo: normalizePaymentMethod(rawPayment.metodo) };
    const valor = roundMoney(payment.valor);
    if (valor <= 0) return;

    if (payment.metodo === 'credito' || payment.metodo === 'debito') {
      const parcelas = payment.metodo === 'debito' ? 1 : Math.max(1, Number(payment.parcelas || 1));
      const taxaPercentual = cardTaxPercent(payment);
      const formaPagamento = payment.metodo === 'debito' ? 'cartao_debito' : 'cartao_credito';
      const adquirente = payment.adquirente || payment.provedor || null;
      const firstDueDays = cardFirstDueDays(payment);
      const intervalDays = cardInstallmentIntervalDays(payment);
      let valorParcelado = 0;

      for (let parcela = 1; parcela <= parcelas; parcela += 1) {
        const valorBruto = parcela === parcelas
          ? roundMoney(valor - valorParcelado)
          : roundMoney(valor / parcelas);
        valorParcelado = roundMoney(valorParcelado + valorBruto);
        const valorTaxa = roundMoney(valorBruto * (taxaPercentual / 100));
        const valorLiquido = roundMoney(valorBruto - valorTaxa);
        const vencimento = isoDatePlusDays(hoje, firstDueDays + (intervalDays * (parcela - 1)));

        lancamentos.push({
          ...base,
          descricao: parcelas > 1
            ? `Venda PDV ${id} - cartao credito ${parcela}/${parcelas}`
            : `Venda PDV ${id} - ${formaPagamento}`,
          valor: valorBruto,
          status: 'avencer',
          vencimento,
          pagoEm: null,
          formaPagamento,
          bandeiraCartao: payment.bandeira || null,
          adquirenteCartao: adquirente,
          terminalId: payment.terminalId || null,
          contaBancariaId: payment.contaBancariaId || payment.contaRecebimento || null,
          parcelasCartao: parcelas,
          parcelaNumero: parcela,
          valorBruto,
          taxaPercentual,
          valorTaxa,
          valorLiquidoPrevisto: valorLiquido,
          clienteId: null,
          obs: [
            `Taxa prevista: ${taxaPercentual.toFixed(2)}%. Liquido previsto: R$ ${valorLiquido.toFixed(2)}`,
            payment.maquininhaNome ? `Maquininha: ${payment.maquininhaNome}` : null,
            payment.contaRecebimento ? `Conta recebimento: ${payment.contaRecebimento}` : null,
          ].filter(Boolean).join(' | '),
        });
      }
      return;
    }

    const fiadoPayment = payment.metodo === 'fiado';
    lancamentos.push({
      ...base,
      descricao: tipo === 'pdv'
        ? `Venda PDV ${id}${pagamentos.length > 1 ? ` - ${payment.metodo}` : ''}`
        : `Venda pedido ${id}${pagamentos.length > 1 ? ` - ${payment.metodo}` : ''}`,
      valor,
      status: fiadoPayment ? 'avencer' : 'pago',
      vencimento: fiadoPayment ? (payment.vencimento || vencFiado || hoje) : hoje,
      pagoEm: fiadoPayment ? null : hoje,
      formaPagamento: payment.metodo || metodoVenda || null,
      obs: null,
      contaBancariaId: payment.contaBancariaId || payment.contaRecebimento || null,
      clienteId: fiadoPayment ? (cidFiado || null) : null,
    });
  });

  return lancamentos;
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

    const metodo   = String(data.metodo || 'dinheiro').toLowerCase();
    const isFiado  = metodo === 'fiado' || data.pagamentos?.some(payment => payment.metodo === 'fiado');
    const cidFiado = data.clienteId || data.fiado?.clienteId;
    const vencFiado = data.vencimentoFiado || data.fiado?.vencimento;
    const pagamentos = data.pagamentos?.length
      ? data.pagamentos
      : [{
          metodo,
          valor: data.total ?? 0,
          status: isFiado ? 'pendente' : 'confirmado',
        }];
    const metodoVenda = pagamentos.length > 1 ? 'multiplo' : metodo;

    if (tipo === 'pdv' && !data.caixaId) {
      return next(httpError(409, 'Abra o caixa antes de registrar uma venda no PDV.'));
    }

    if (isFiado) {
      if (!cidFiado) {
        return next(httpError(400, 'Para venda fiado, selecione ou cadastre um cliente e informe o vencimento.'));
      }
      if (!vencFiado) {
        return next(httpError(400, 'Informe o vencimento do fiado.'));
      }
    }

    const pixPayments = pagamentos.filter(payment => payment.metodo === 'pix');
    const pixIntegration = pixPayments.length
      ? await prisma.integracaoPagamento.findUnique({
          where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
        })
      : null;
    if (pixIntegration?.ativo && pixIntegration.status === 'conectado') {
      if (pixPayments.some(payment => !payment.cobrancaId)) {
        throw httpError(409, 'A venda PIX automatica precisa de uma cobranca confirmada.');
      }
    }

    const confirmedPixCharges = [];
    for (const payment of pixPayments.filter(item => item.cobrancaId)) {
      const charge = await prisma.pixCobranca.findFirst({
        where: { id: payment.cobrancaId, empresaId: req.auth.empresaId },
      });
      if (!charge || charge.status !== 'pago') throw httpError(409, 'A cobranca PIX ainda nao foi confirmada.');
      if (charge.vendaId) throw httpError(409, 'Esta cobranca PIX ja foi utilizada em outra venda.');
      if (Math.abs(charge.valor - payment.valor) >= 0.01) throw httpError(409, 'O valor da cobranca PIX difere da venda.');
      confirmedPixCharges.push(charge);
    }

    const venda = await prisma.$transaction(async (tx) => {
      if (tipo === 'pdv') {
        const caixaAberto = await tx.caixa.findFirst({
          where: {
            id: data.caixaId,
            empresaId: req.auth.empresaId,
            operadorId: req.auth.userId,
            aberto: true,
          },
        });

        if (!caixaAberto) {
          throw httpError(409, 'Caixa fechado ou nao pertence ao operador atual. Abra um caixa para continuar.');
        }

        data.operadorId = req.auth.userId;
        data.operador = data.operador || caixaAberto.operador || req.auth.nome || 'Operador';
      }
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
          metodo:    metodoVenda,
          pagamentos,
          itens:     vendaFields.itens ?? [],
          status:    vendaFields.status ?? 'concluida',
          tipo,
          empresaId: req.auth.empresaId,
        },
      });

      for (const charge of confirmedPixCharges) {
        const linked = await tx.pixCobranca.updateMany({
          where: { id: charge.id, empresaId: req.auth.empresaId, vendaId: null, status: 'pago' },
          data: { vendaId: id },
        });
        if (linked.count !== 1) throw httpError(409, 'A cobranca PIX ja foi vinculada a outra venda.');
      }

      // 3. Incrementa contador de compras do cliente (PDV)
      const clienteIdVenda = data.clienteId || data.fiado?.clienteId;
      if (clienteIdVenda) {
        await tx.cliente.updateMany({
          where: { id: clienteIdVenda, empresaId: req.auth.empresaId },
          data:  { compras: { increment: 1 } },
        });
      }

      // 4. Cria lançamentos financeiros por forma de pagamento.
      const hoje = new Date().toISOString().slice(0, 10);
      const lancamentos = buildLancamentosVenda({
        data,
        id,
        tipo,
        pagamentos,
        metodoVenda,
        isFiado,
        vencFiado,
        cidFiado,
        hoje,
        empresaId: req.auth.empresaId,
      });
      if (lancamentos.length) await tx.lancamento.createMany({ data: lancamentos });

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
      const pixCharges = await prisma.pixCobranca.findMany({
        where: {
          empresaId: req.auth.empresaId,
          vendaId: existe.id,
          status: { in: ['pago', 'reembolso_processando', 'estornado'] },
        },
      });
      if (pixCharges.length) {
        const integration = await prisma.integracaoPagamento.findUnique({
          where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
        });
        if (!integration?.credenciaisCriptografadas || !integration.provedor) {
          throw httpError(409, 'Nao foi possivel localizar a integracao usada no pagamento PIX.');
        }
        const credentials = decryptCredentials(integration.credenciaisCriptografadas);
        const provider = getPaymentProvider(integration.provedor);
        for (const charge of pixCharges) {
          if (charge.status === 'estornado') continue;
          if (!charge.providerResourceId && !charge.providerPaymentId) {
            throw httpError(409, 'Cobranca PIX sem identificador do provedor.');
          }

          if (charge.status === 'reembolso_processando' && charge.providerResourceId) {
            const current = await provider.getCharge(credentials, charge.providerResourceId);
            if (current.status !== 'estornado') {
              throw httpError(409, 'O reembolso PIX ainda esta sendo processado. Tente novamente em instantes.');
            }
            await prisma.pixCobranca.update({
              where: { id: charge.id },
              data: { status: 'estornado', erro: null },
            });
            continue;
          }

          await prisma.pixCobranca.update({
            where: { id: charge.id },
            data: { status: 'reembolso_processando', erro: null },
          });
          try {
            const result = charge.providerResourceId
              ? await provider.refundCharge(credentials, charge.providerResourceId, `refund-${charge.id}`)
              : await provider.refundPayment(credentials.accessToken, charge.providerPaymentId, `refund-${charge.id}`);
            if (charge.providerResourceId && result.status !== 'estornado') {
              throw httpError(409, 'Reembolso solicitado e ainda em processamento. Tente concluir o estorno em instantes.');
            }
            await prisma.pixCobranca.update({
              where: { id: charge.id },
              data: { status: 'estornado', erro: null },
            });
          } catch (err) {
            const processing = err.status === 409 && /processamento|processado/i.test(err.message || '');
            await prisma.pixCobranca.update({
              where: { id: charge.id },
              data: {
                status: processing ? 'reembolso_processando' : 'pago',
                erro: String(err.message || 'Falha no reembolso').slice(0, 500),
              },
            });
            if (processing) throw err;
            throw httpError(502, 'O Mercado Pago nao confirmou o reembolso. A venda nao foi estornada.');
          }
        }
      }

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
