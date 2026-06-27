const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');
const {
  FINANCEIRO_STATUS_INATIVOS,
  isStatusFinanceiroRealizado,
} = require('../utils/financeiroStatus');

const prisma = new PrismaClient();

router.use(requireAuth);

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function paymentBucket(formaPagamento) {
  const forma = normalizeText(formaPagamento);
  if (forma === 'dinheiro') return 'dinheiro';
  if (forma === 'pix') return 'pix';
  if (forma === 'fiado') return 'fiado';
  if (forma === 'debito' || forma === 'cartao_debito') return 'debito';
  if (forma === 'credito' || forma === 'cartao_credito') return 'credito';
  if (forma === 'voucher') return 'voucher';
  if (forma === 'vale' || forma === 'vale_refeicao' || forma === 'vale-alimentacao') return 'vale';
  return 'outros';
}

function sumMovimentos(movimentos, tipo) {
  return movimentos
    .filter(mov => normalizeText(mov.tipo) === normalizeText(tipo))
    .reduce((sum, mov) => roundMoney(sum + Number(mov.valor || 0)), 0);
}

async function buildCaixaResumo(db, empresaId, caixa) {
  const movimentos = Array.isArray(caixa.sangrias) ? caixa.sangrias : [];
  const totalSangrias = sumMovimentos(movimentos, 'Sangria');
  const totalSuprimentos = sumMovimentos(movimentos, 'Suprimento');

  const [vendas, estornos, lancamentos] = await Promise.all([
    db.venda.findMany({
      where: {
        empresaId,
        caixaId: caixa.id,
        status: { in: ['concluida', 'faturada'] },
      },
      select: { id: true, total: true },
    }),
    db.venda.findMany({
      where: {
        empresaId,
        caixaId: caixa.id,
        status: 'estornada',
      },
      select: { id: true, total: true },
    }),
    db.lancamento.findMany({
      where: {
        empresaId,
        caixaId: caixa.id,
        tipo: 'receita',
        status: { notIn: FINANCEIRO_STATUS_INATIVOS },
      },
      select: {
        id: true,
        valor: true,
        status: true,
        formaPagamento: true,
        valorBruto: true,
        valorTaxa: true,
        valorLiquidoPrevisto: true,
      },
    }),
  ]);

  const formas = {
    dinheiro: { count: 0, total: 0 },
    pix:      { count: 0, total: 0 },
    debito:   { count: 0, total: 0 },
    credito:  { count: 0, total: 0 },
    voucher:  { count: 0, total: 0 },
    vale:     { count: 0, total: 0 },
    fiado:    { count: 0, total: 0 },
    outros:   { count: 0, total: 0 },
  };

  let totalRecebido = 0;
  let totalAReceber = 0;
  let taxasCartao = 0;
  let liquidoCartaoPrevisto = 0;

  lancamentos.forEach((lancamento) => {
    const bucket = paymentBucket(lancamento.formaPagamento);
    const valor = roundMoney(
      bucket === 'debito' || bucket === 'credito'
        ? (lancamento.valorBruto ?? lancamento.valor)
        : lancamento.valor,
    );

    formas[bucket].count += 1;
    formas[bucket].total = roundMoney(formas[bucket].total + valor);

    if (isStatusFinanceiroRealizado(lancamento.status)) {
      totalRecebido = roundMoney(totalRecebido + valor);
    } else {
      totalAReceber = roundMoney(totalAReceber + valor);
    }

    if (bucket === 'debito' || bucket === 'credito') {
      taxasCartao = roundMoney(taxasCartao + Number(lancamento.valorTaxa || 0));
      liquidoCartaoPrevisto = roundMoney(
        liquidoCartaoPrevisto + Number(lancamento.valorLiquidoPrevisto ?? valor),
      );
    }
  });

  const totalVendido = roundMoney(vendas.reduce((sum, venda) => sum + Number(venda.total || 0), 0));
  const totalEstornado = roundMoney(estornos.reduce((sum, venda) => sum + Number(venda.total || 0), 0));
  const dinheiroEsperado = roundMoney(Number(caixa.fundo || 0) + totalSuprimentos - totalSangrias + formas.dinheiro.total);

  return {
    caixaId: caixa.id,
    aberto: caixa.aberto,
    operador: caixa.operador,
    operadorId: caixa.operadorId,
    abertura: caixa.abertura,
    aberturaStr: caixa.aberturaStr,
    fechamento: caixa.fechamento,
    fundo: roundMoney(caixa.fundo),
    movimentos,
    movimentacoes: {
      sangrias: totalSangrias,
      suprimentos: totalSuprimentos,
    },
    vendas: {
      count: vendas.length,
      total: totalVendido,
      ticketMedio: vendas.length ? roundMoney(totalVendido / vendas.length) : 0,
      estornos: {
        count: estornos.length,
        total: totalEstornado,
      },
    },
    formas,
    cartao: {
      debito: formas.debito.total,
      credito: formas.credito.total,
      taxasPrevistas: taxasCartao,
      liquidoPrevisto: liquidoCartaoPrevisto,
    },
    financeiro: {
      recebido: totalRecebido,
      aReceber: totalAReceber,
    },
    dinheiroEsperado,
    totalVendido,
  };
}

// GET /api/caixas/aberto — caixa aberto do operador atual
router.get('/aberto', async (req, res, next) => {
  try {
    const caixa = await prisma.caixa.findFirst({
      where: { empresaId: req.auth.empresaId, operadorId: req.auth.userId, aberto: true },
      orderBy: { abertura: 'desc' },
    });

    if (!caixa) {
      return res.status(404).json({ ok: false, message: 'Sem caixa aberto.' });
    }

    res.json({ ok: true, data: { ...caixa, movimentos: caixa.sangrias || [] } });
  } catch (err) {
    next(err);
  }
});

// GET /api/caixas — histórico de caixas
router.get('/', async (req, res, next) => {
  try {
    const result = await findManyPaginated(prisma.caixa, req.query, {
      where: { empresaId: req.auth.empresaId },
      orderBy: { abertura: 'desc' },
      take: 50,
    });

    sendList(res, result);
  } catch (err) {
    next(err);
  }
});

// GET /api/caixas/:id/resumo - resumo oficial calculado no backend
router.get('/:id/resumo', async (req, res, next) => {
  try {
    const caixa = await prisma.caixa.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });

    if (!caixa) {
      return res.status(404).json({ ok: false, message: 'Caixa nao encontrado.' });
    }

    const resumo = await buildCaixaResumo(prisma, req.auth.empresaId, caixa);
    res.json({ ok: true, data: resumo });
  } catch (err) {
    next(err);
  }
});

// POST /api/caixas — abre novo caixa
router.post('/', async (req, res, next) => {
  try {
    const { operador, fundo, obs, aberturaStr } = req.body;

    // Fecha caixa anterior do mesmo operador (re-abertura no mesmo terminal)
    await prisma.caixa.updateMany({
      where: { empresaId: req.auth.empresaId, operadorId: req.auth.userId, aberto: true },
      data:  { aberto: false, fechamento: new Date() },
    });

    const agora = new Date();
    const caixa = await prisma.caixa.create({
      data: {
        aberto:      true,
        operador:    operador    || 'Operador',
        operadorId:  req.auth.userId,
        fundo:       fundo       || 0,
        abertura:    agora,
        aberturaStr: aberturaStr || agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        sangrias:    [],
        empresaId:   req.auth.empresaId,
      },
    });

    res.status(201).json({ ok: true, data: { ...caixa, movimentos: [] } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/caixas/:id — adiciona movimento ou fecha caixa
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.caixa.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId, operadorId: req.auth.userId },
    });

    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Caixa não encontrado.' });
    }

    const { movimento, aberto, fechamento } = req.body;
    const data = {};
    let resumo = null;

    if (movimento) {
      const movimentos = Array.isArray(existe.sangrias) ? existe.sangrias : [];
      movimentos.push(movimento);
      data.sangrias = movimentos;
    }

    if (aberto === false) {
      data.aberto     = false;
      data.fechamento = fechamento ? new Date(fechamento) : new Date();
      resumo = await buildCaixaResumo(prisma, req.auth.empresaId, { ...existe, ...data });
      data.totalVendas = resumo.totalVendido;
    }

    const caixa = await prisma.caixa.update({
      where: { id: req.params.id },
      data,
    });

    if (!resumo) resumo = await buildCaixaResumo(prisma, req.auth.empresaId, caixa);

    res.json({ ok: true, data: { ...caixa, movimentos: caixa.sangrias || [], resumo } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
