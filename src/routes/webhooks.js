const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { WebhookSignatureValidator, InvalidWebhookSignatureError } = require('mercadopago');
const { decryptCredentials } = require('../utils/integrationCrypto');
const { getPaymentProvider } = require('../services/paymentProviders');

const prisma = new PrismaClient();

const STATUS_PRIORITY = {
  criando: 0,
  pendente: 10,
  recusado: 20,
  cancelado: 30,
  expirado: 30,
  reembolso_processando: 55,
  pago: 60,
  estornado: 80,
  contestado: 80,
  divergente: 90,
};

function webhookAuthError(message) {
  const err = new Error(message || 'Assinatura invalida.');
  err.status = 401;
  return err;
}

function firstHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function warnWebhook(message, details = {}) {
  console.warn('[webhook:mercadopago]', message, details);
}

function validateMercadoPagoSignature(req, dataId, secret) {
  if (!secret) throw webhookAuthError('Webhook secret nao configurado.');

  const xSignature = firstHeader(req, 'x-signature');
  const xRequestId = firstHeader(req, 'x-request-id');
  if (!xSignature || !xRequestId) throw webhookAuthError('Cabecalhos de assinatura ausentes.');

  WebhookSignatureValidator.validate({
    xSignature,
    xRequestId,
    dataId: String(dataId),
    secret,
    toleranceSeconds: 300,
  });
}

function priorityOf(status) {
  return STATUS_PRIORITY[status] ?? 0;
}

function shouldApplyStatus(currentStatus, nextStatus) {
  if (!currentStatus) return true;
  if (currentStatus === nextStatus) return true;
  return priorityOf(nextStatus) >= priorityOf(currentStatus);
}

function nextChargeData(charge, nextStatus, data) {
  const applyStatus = shouldApplyStatus(charge.status, nextStatus);
  return {
    ...data,
    status: applyStatus ? nextStatus : charge.status,
    pagoEm: nextStatus === 'pago'
      ? (charge.pagoEm || data.pagoEm || new Date())
      : charge.pagoEm,
  };
}

router.post('/mercadopago/:integrationId', async (req, res, next) => {
  try {
    const integration = await prisma.integracaoPagamento.findFirst({
      where: { id: req.params.integrationId, provedor: 'mercadopago', ativo: true },
    });
    if (!integration?.credenciaisCriptografadas) {
      warnWebhook('integracao ausente ou inativa', { integrationId: req.params.integrationId });
      return res.sendStatus(204);
    }

    const credentials = decryptCredentials(integration.credenciaisCriptografadas);
    const dataId = req.query['data.id'] || req.body?.data?.id;
    if (!dataId) {
      warnWebhook('evento sem data.id', { integrationId: integration.id });
      return res.sendStatus(204);
    }

    validateMercadoPagoSignature(req, dataId, credentials.webhookSecret);

    const provider = getPaymentProvider(integration.provedor);
    const isOrder = String(dataId).startsWith('ORD') || String(req.body?.action || '').startsWith('order.');
    if (isOrder) {
      const result = await provider.getCharge(credentials, String(dataId));
      const charge = await prisma.pixCobranca.findFirst({
        where: {
          empresaId: integration.empresaId,
          provedor: integration.provedor,
          OR: [
            { providerResourceId: String(dataId) },
            ...(result.externalReference ? [{ referencia: result.externalReference }] : []),
          ],
        },
      });
      if (!charge) return res.sendStatus(204);

      const amountMatches = Math.abs(result.amount - charge.valor) < 0.01;
      const status = amountMatches ? result.status : 'divergente';
      await prisma.pixCobranca.update({
        where: { id: charge.id },
        data: nextChargeData(charge, status, {
          providerResourceId: result.providerResourceId,
          providerPaymentId: result.providerPaymentId || charge.providerPaymentId,
          pagoEm: status === 'pago' ? (result.paidAt || new Date()) : charge.pagoEm,
          erro: amountMatches ? null : 'Valor confirmado pelo provedor difere da cobranca.',
        }),
      });
      return res.sendStatus(200);
    }

    const payment = await provider.getPayment(credentials.accessToken, String(dataId));
    const charge = await prisma.pixCobranca.findFirst({
      where: {
        empresaId: integration.empresaId,
        provedor: 'mercadopago',
        OR: [
          { providerPaymentId: String(dataId) },
          ...(payment.external_reference ? [{ referencia: payment.external_reference }] : []),
        ],
      },
    });
    if (!charge) return res.sendStatus(204);

    const amountMatches = Math.abs(Number(payment.transaction_amount || 0) - charge.valor) < 0.01;
    const statusMap = {
      approved: 'pago',
      pending: 'pendente',
      in_process: 'pendente',
      rejected: 'recusado',
      cancelled: 'cancelado',
      refunded: 'estornado',
      charged_back: 'contestado',
    };
    const nextStatus = amountMatches ? (statusMap[payment.status] || 'pendente') : 'divergente';

    await prisma.pixCobranca.update({
      where: { id: charge.id },
      data: nextChargeData(charge, nextStatus, {
        providerPaymentId: String(payment.id || dataId),
        pagoEm: nextStatus === 'pago' ? new Date(payment.date_approved || Date.now()) : charge.pagoEm,
        endToEndId: payment.transaction_details?.transaction_id || charge.endToEndId,
        erro: amountMatches ? null : 'Valor confirmado pelo provedor difere da cobranca.',
      }),
    });

    res.sendStatus(200);
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError || err.status === 401) {
      warnWebhook('assinatura invalida', { integrationId: req.params.integrationId });
      return res.sendStatus(401);
    }
    next(err);
  }
});

router._test = {
  nextChargeData,
  priorityOf,
  shouldApplyStatus,
};

module.exports = router;
