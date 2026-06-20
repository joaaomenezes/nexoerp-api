const { MercadoPagoConfig, Payment, PaymentRefund, User } = require('mercadopago');

function createClient(accessToken) {
  return new MercadoPagoConfig({
    accessToken,
    options: { timeout: 10000 },
  });
}

async function testConnection(accessToken) {
  const user = await new User(createClient(accessToken)).get();
  return {
    id: user.id ? String(user.id) : null,
    nickname: user.nickname || null,
    email: user.email || null,
    siteId: user.site_id || null,
  };
}

async function createPixCharge(accessToken, input) {
  const payment = new Payment(createClient(accessToken));
  return payment.create({
    body: {
      transaction_amount: input.amount,
      description: input.description,
      payment_method_id: 'pix',
      payer: { email: input.payerEmail },
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      date_of_expiration: input.expiresAt.toISOString(),
      metadata: { empresa_id: input.empresaId, pix_cobranca_id: input.chargeId },
    },
    requestOptions: { idempotencyKey: input.idempotencyKey },
  });
}

async function getPayment(accessToken, paymentId) {
  return new Payment(createClient(accessToken)).get({ id: paymentId });
}

async function cancelPayment(accessToken, paymentId, idempotencyKey) {
  return new Payment(createClient(accessToken)).cancel({
    id: paymentId,
    requestOptions: { idempotencyKey },
  });
}

async function refundPayment(accessToken, paymentId, idempotencyKey) {
  return new PaymentRefund(createClient(accessToken)).total({
    payment_id: paymentId,
    requestOptions: { idempotencyKey },
  });
}

module.exports = { createClient, testConnection, createPixCharge, getPayment, cancelPayment, refundPayment };
