const router = require('express').Router();
const crypto = require('crypto');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { decryptCredentials } = require('../utils/integrationCrypto');
const { getPaymentProvider } = require('../services/paymentProviders');

const prisma = new PrismaClient();

const chargeSchema = z.object({
  valor: z.number().positive().max(999999.99),
  descricao: z.string().trim().min(1).max(120).optional(),
});

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function publicCharge(charge) {
  return {
    id: charge.id,
    provedor: charge.provedor,
    providerResourceId: charge.providerResourceId,
    providerPaymentId: charge.providerPaymentId,
    status: charge.status,
    valor: charge.valor,
    qrCode: charge.qrCode,
    ticketUrl: charge.ticketUrl,
    expiraEm: charge.expiraEm,
    pagoEm: charge.pagoEm,
    vinculada: Boolean(charge.vendaId),
  };
}

async function getProviderContext(empresaId) {
  const integration = await prisma.integracaoPagamento.findUnique({
    where: { empresaId_tipo: { empresaId, tipo: 'pix' } },
  });
  if (!integration?.credenciaisCriptografadas || !integration.provedor) {
    throw httpError(409, 'Provedor PIX nao conectado.');
  }
  return {
    integration,
    credentials: decryptCredentials(integration.credenciaisCriptografadas),
    provider: getPaymentProvider(integration.provedor),
  };
}

function mapProviderStatus(status) {
  return {
    approved: 'pago',
    pending: 'pendente',
    in_process: 'pendente',
    rejected: 'recusado',
    cancelled: 'cancelado',
    refunded: 'estornado',
    charged_back: 'contestado',
  }[status] || 'pendente';
}

async function syncChargeStatus(charge) {
  if (!['criando', 'pendente', 'reembolso_processando'].includes(charge.status)) return charge;
  const { credentials, provider } = await getProviderContext(charge.empresaId);
  if (charge.providerResourceId) {
    const result = await provider.getCharge(credentials, charge.providerResourceId);
    const amountMatches = Math.abs(result.amount - charge.valor) < 0.01;
    const status = amountMatches ? result.status : 'divergente';
    return prisma.pixCobranca.update({
      where: { id: charge.id },
      data: {
        providerPaymentId: result.providerPaymentId || charge.providerPaymentId,
        status,
        pagoEm: status === 'pago' ? (result.paidAt || new Date()) : charge.pagoEm,
        erro: amountMatches ? null : 'Valor confirmado pelo provedor difere da cobranca.',
      },
    });
  }
  if (!charge.providerPaymentId) return charge;
  const payment = await provider.getPayment(credentials.accessToken, charge.providerPaymentId);
  const amountMatches = Math.abs(Number(payment.transaction_amount || 0) - charge.valor) < 0.01;
  const status = amountMatches ? mapProviderStatus(payment.status) : 'divergente';
  return prisma.pixCobranca.update({
    where: { id: charge.id },
    data: {
      status,
      pagoEm: status === 'pago' ? new Date(payment.date_approved || Date.now()) : charge.pagoEm,
      endToEndId: payment.transaction_details?.transaction_id || charge.endToEndId,
      erro: amountMatches ? null : 'Valor confirmado pelo provedor difere da cobranca.',
    },
  });
}

router.use(requireAuth);
router.use(requirePermission('pdv'));

router.post('/cobrancas', async (req, res, next) => {
  let charge;
  try {
    const input = chargeSchema.parse(req.body);
    const integration = await prisma.integracaoPagamento.findUnique({
      where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
    });
    if (!integration?.ativo || integration.status !== 'conectado' || !integration.provedor) {
      throw httpError(409, 'Conecte e configure um provedor PIX antes de criar a cobranca.');
    }
    if (!integration.credenciaisCriptografadas) throw httpError(409, 'Credenciais do Mercado Pago ausentes.');

    const credentials = decryptCredentials(integration.credenciaisCriptografadas);
    const provider = getPaymentProvider(integration.provedor);
    const reference = `NEXO-${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    charge = await prisma.pixCobranca.create({
      data: {
        provedor: integration.provedor,
        referencia: reference,
        valor: Math.round(input.valor * 100) / 100,
        expiraEm: expiresAt,
        empresaId: req.auth.empresaId,
      },
    });

    const result = await provider.createCharge(credentials, {
      amount: charge.valor,
      description: input.descricao || `Venda PDV ${charge.id}`,
      externalReference: reference,
      expiresAt,
      empresaId: req.auth.empresaId,
      chargeId: charge.id,
      idempotencyKey: reference,
    });

    if (!result.providerResourceId || !result.qrCode) {
      throw httpError(502, 'O provedor nao retornou o QR Code da cobranca.');
    }

    charge = await prisma.pixCobranca.update({
      where: { id: charge.id },
      data: {
        providerResourceId: result.providerResourceId,
        providerPaymentId: result.providerPaymentId,
        status: result.status,
        qrCode: result.qrCode,
        ticketUrl: null,
        expiraEm: expiresAt,
        pagoEm: result.status === 'pago' ? (result.paidAt || new Date()) : null,
      },
    });

    res.status(201).json({ ok: true, data: publicCharge(charge) });
  } catch (err) {
    if (charge?.id) {
      await prisma.pixCobranca.updateMany({
        where: { id: charge.id, status: 'criando' },
        data: { status: 'erro', erro: String(err.message || 'Erro no provedor').slice(0, 500) },
      }).catch(() => {});
    }
    next(err);
  }
});

router.get('/cobrancas/:id', async (req, res, next) => {
  try {
    let charge = await prisma.pixCobranca.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!charge) throw httpError(404, 'Cobranca PIX nao encontrada.');
    if (charge.status === 'pendente') {
      charge = await syncChargeStatus(charge);
    }
    if (charge.status === 'pendente' && charge.expiraEm && charge.expiraEm <= new Date()) {
      const { credentials, provider } = await getProviderContext(req.auth.empresaId);
      let cancellationAccepted = !charge.providerResourceId && !charge.providerPaymentId;
      if (charge.providerResourceId) {
        try {
          await provider.cancelCharge(credentials, charge.providerResourceId, `cancel-${charge.id}`);
          cancellationAccepted = true;
        } catch (_) {
          cancellationAccepted = false;
        }
      } else if (charge.providerPaymentId) {
        try {
          await provider.cancelPayment(credentials.accessToken, charge.providerPaymentId, `cancel-${charge.id}`);
          cancellationAccepted = true;
        } catch (_) {
          cancellationAccepted = false;
        }
      }
      charge = await syncChargeStatus(charge);
      if (charge.status === 'pendente' && cancellationAccepted) {
        charge = await prisma.pixCobranca.update({
          where: { id: charge.id },
          data: { status: 'expirado' },
        });
      }
    }
    res.json({ ok: true, data: publicCharge(charge) });
  } catch (err) {
    next(err);
  }
});

router.delete('/cobrancas/:id', async (req, res, next) => {
  try {
    let charge = await prisma.pixCobranca.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!charge) throw httpError(404, 'Cobranca PIX nao encontrada.');
    if (charge.vendaId) throw httpError(409, 'A cobranca ja esta vinculada a uma venda.');
    if (charge.status === 'pago') throw httpError(409, 'A cobranca ja foi paga e nao pode ser cancelada.');
    if (['cancelado', 'expirado', 'recusado', 'erro'].includes(charge.status)) {
      return res.json({ ok: true, data: publicCharge(charge) });
    }

    if (charge.providerResourceId || charge.providerPaymentId) {
      const { credentials, provider } = await getProviderContext(req.auth.empresaId);
      if (charge.providerResourceId) {
        await provider.cancelCharge(credentials, charge.providerResourceId, `cancel-${charge.id}`);
      } else {
        await provider.cancelPayment(credentials.accessToken, charge.providerPaymentId, `cancel-${charge.id}`);
      }
    }
    charge = await prisma.pixCobranca.update({
      where: { id: charge.id },
      data: { status: 'cancelado' },
    });
    res.json({ ok: true, data: publicCharge(charge) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
