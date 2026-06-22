const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { WebhookSignatureValidator, InvalidWebhookSignatureError } = require('mercadopago');
const { decryptCredentials } = require('../utils/integrationCrypto');
const { getPaymentProvider } = require('../services/paymentProviders');

const prisma = new PrismaClient();

router.post('/mercadopago/:integrationId', async (req, res, next) => {
  try {
    const integration = await prisma.integracaoPagamento.findFirst({
      where: { id: req.params.integrationId, provedor: 'mercadopago', ativo: true },
    });
    if (!integration?.credenciaisCriptografadas) return res.sendStatus(204);

    const credentials = decryptCredentials(integration.credenciaisCriptografadas);
    const dataId = req.query['data.id'] || req.body?.data?.id;
    if (!dataId) return res.sendStatus(204);

    WebhookSignatureValidator.validate({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId: String(dataId),
      secret: credentials.webhookSecret,
      toleranceSeconds: 300,
    });

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
        data: {
          providerResourceId: result.providerResourceId,
          providerPaymentId: result.providerPaymentId || charge.providerPaymentId,
          status,
          pagoEm: status === 'pago' ? (result.paidAt || new Date()) : charge.pagoEm,
          erro: amountMatches ? null : 'Valor confirmado pelo provedor difere da cobranca.',
        },
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
      data: {
        providerPaymentId: String(payment.id || dataId),
        status: nextStatus,
        pagoEm: nextStatus === 'pago' ? new Date(payment.date_approved || Date.now()) : charge.pagoEm,
        endToEndId: payment.transaction_details?.transaction_id || charge.endToEndId,
        erro: amountMatches ? null : 'Valor confirmado pelo provedor difere da cobranca.',
      },
    });

    res.sendStatus(200);
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) return res.sendStatus(401);
    next(err);
  }
});

module.exports = router;
