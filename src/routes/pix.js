const router = require('express').Router();
const crypto = require('crypto');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { decryptCredentials } = require('../utils/integrationCrypto');
const mercadoPago = require('../services/paymentProviders/mercadoPago');

const prisma = new PrismaClient();

const chargeSchema = z.object({
  valor: z.number().positive().max(999999.99),
  descricao: z.string().trim().min(1).max(120).optional(),
  payerEmail: z.string().trim().email().max(150),
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
    providerPaymentId: charge.providerPaymentId,
    status: charge.status,
    valor: charge.valor,
    qrCode: charge.qrCode,
    ticketUrl: charge.ticketUrl,
    expiraEm: charge.expiraEm,
    pagoEm: charge.pagoEm,
  };
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
    if (!integration?.ativo || integration.status !== 'conectado' || integration.provedor !== 'mercadopago') {
      throw httpError(409, 'Conecte uma conta Mercado Pago antes de criar a cobranca PIX.');
    }
    if (!integration.credenciaisCriptografadas) throw httpError(409, 'Credenciais do Mercado Pago ausentes.');

    const credentials = decryptCredentials(integration.credenciaisCriptografadas);
    const reference = `NEXO-${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    charge = await prisma.pixCobranca.create({
      data: {
        provedor: 'mercadopago',
        referencia: reference,
        valor: Math.round(input.valor * 100) / 100,
        expiraEm: expiresAt,
        empresaId: req.auth.empresaId,
      },
    });

    const apiBase = String(process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const payment = await mercadoPago.createPixCharge(credentials.accessToken, {
      amount: charge.valor,
      description: input.descricao || `Venda PDV ${charge.id}`,
      payerEmail: input.payerEmail,
      externalReference: reference,
      notificationUrl: `${apiBase}/api/webhooks/mercadopago/${integration.id}`,
      expiresAt,
      empresaId: req.auth.empresaId,
      chargeId: charge.id,
      idempotencyKey: reference,
    });

    const transaction = payment.point_of_interaction?.transaction_data;
    if (!payment.id || !transaction?.qr_code) throw httpError(502, 'Mercado Pago nao retornou o QR Code da cobranca.');

    charge = await prisma.pixCobranca.update({
      where: { id: charge.id },
      data: {
        providerPaymentId: String(payment.id),
        status: payment.status === 'approved' ? 'pago' : 'pendente',
        qrCode: transaction.qr_code,
        ticketUrl: transaction.ticket_url || null,
        expiraEm: payment.date_of_expiration ? new Date(payment.date_of_expiration) : expiresAt,
        pagoEm: payment.status === 'approved' ? new Date(payment.date_approved || Date.now()) : null,
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
    const charge = await prisma.pixCobranca.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!charge) throw httpError(404, 'Cobranca PIX nao encontrada.');
    res.json({ ok: true, data: publicCharge(charge) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
