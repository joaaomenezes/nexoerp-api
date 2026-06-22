const { MercadoPagoConfig, Payment, PaymentRefund, User } = require('mercadopago');

const API_BASE = 'https://api.mercadopago.com';

function createClient(accessToken) {
  return new MercadoPagoConfig({
    accessToken,
    options: { timeout: 10000 },
  });
}

function providerError(response, data) {
  const message = data?.message || data?.error || `Mercado Pago respondeu HTTP ${response.status}.`;
  const error = new Error(message);
  error.status = response.status >= 500 ? 502 : 400;
  error.providerStatus = response.status;
  error.providerData = data;
  return error;
}

async function apiRequest(accessToken, path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text }; }
  if (!response.ok) throw providerError(response, data);
  return data;
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

async function configurePointOfSale(accessToken, userId, input) {
  let storeId = input.storeId || null;
  if (!storeId) {
    let store;
    try {
      store = await apiRequest(accessToken, `/users/${userId}/stores`, {
        method: 'POST',
        body: {
          name: input.storeName,
          external_id: input.externalStoreId,
          location: {
            street_number: input.streetNumber,
            street_name: input.streetName,
            city_name: input.cityName,
            state_name: input.stateName,
            latitude: input.latitude,
            longitude: input.longitude,
            reference: input.reference || undefined,
          },
        },
      });
    } catch (err) {
      if (err.providerStatus === 400 && /already assigned/i.test(err.message)) {
        const search = await apiRequest(accessToken, `/users/${userId}/stores/search?external_id=${encodeURIComponent(input.externalStoreId)}`);
        const existing = search.results?.[0] || search.data?.[0] || search[0];
        if (!existing) throw err;
        store = existing;
      } else {
        throw err;
      }
    }
    storeId = String(store.id);
  }

  let pos;
  try {
    pos = await apiRequest(accessToken, '/pos', {
      method: 'POST',
      body: {
        name: input.posName,
        fixed_amount: true,
        store_id: Number(storeId),
        external_store_id: input.externalStoreId,
        external_id: input.externalPosId,
      },
    });
  } catch (error) {
    if (error.providerStatus === 400 && /already assigned/i.test(error.message)) {
      const search = await apiRequest(accessToken, `/pos/search?external_id=${encodeURIComponent(input.externalPosId)}`);
      const existing = search.results?.[0] || search.data?.[0] || search[0];
      if (existing) {
        pos = existing;
      } else {
        error.partialConfig = { storeId, externalStoreId: input.externalStoreId };
        throw error;
      }
    } else {
      error.partialConfig = { storeId, externalStoreId: input.externalStoreId };
      throw error;
    }
  }

  return {
    storeId,
    externalStoreId: input.externalStoreId,
    posId: String(pos.id),
    externalPosId: input.externalPosId,
  };
}

function mapOrderStatus(order) {
  const refundStatus = order.transactions?.refunds?.[0]?.status;
  if (['refunded', 'approved'].includes(refundStatus)) return 'estornado';
  if (refundStatus === 'processing') return 'reembolso_processando';
  if (order.status_detail === 'refunded' || order.status === 'refunded') return 'estornado';
  if (order.status_detail === 'expired' || order.status === 'expired') return 'expirado';
  if (order.status_detail === 'canceled' || order.status === 'canceled') return 'cancelado';
  if (order.status === 'processed' && order.status_detail === 'accredited') return 'pago';
  if (order.status === 'failed') return 'recusado';
  return 'pendente';
}

function normalizeOrder(order) {
  const payment = order.transactions?.payments?.[0] || null;
  return {
    providerResourceId: order.id ? String(order.id) : null,
    providerPaymentId: payment?.id ? String(payment.id) : null,
    externalReference: order.external_reference || null,
    status: mapOrderStatus(order),
    amount: Number(order.total_amount || payment?.amount || 0),
    qrCode: order.type_response?.qr_data || null,
    paidAt: order.status === 'processed' ? new Date(order.last_updated_date || Date.now()) : null,
    raw: order,
  };
}

async function createCharge(credentials, input) {
  if (!credentials.externalPosId) {
    const error = new Error('Configure a loja e o caixa do Mercado Pago antes de gerar o QR Code.');
    error.status = 409;
    throw error;
  }
  const order = await apiRequest(credentials.accessToken, '/v1/orders', {
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: {
      type: 'qr',
      total_amount: input.amount.toFixed(2),
      description: input.description,
      external_reference: input.externalReference,
      expiration_time: 'PT5M',
      config: {
        qr: {
          external_pos_id: credentials.externalPosId,
          mode: 'dynamic',
        },
      },
      transactions: { payments: [{ amount: input.amount.toFixed(2) }] },
      items: input.items?.length ? input.items : undefined,
    },
  });
  return normalizeOrder(order);
}

async function getCharge(credentials, resourceId) {
  return normalizeOrder(await apiRequest(credentials.accessToken, `/v1/orders/${resourceId}`));
}

async function cancelCharge(credentials, resourceId) {
  const order = await apiRequest(credentials.accessToken, `/v1/orders/${resourceId}`, {
    method: 'PUT',
    body: { status: 'canceled' },
  });
  return normalizeOrder(order);
}

async function refundCharge(credentials, resourceId, idempotencyKey) {
  const order = await apiRequest(credentials.accessToken, `/v1/orders/${resourceId}/refunds`, {
    method: 'POST',
    idempotencyKey,
  });
  return normalizeOrder(order);
}

// Compatibilidade com cobrancas emitidas antes da migracao para Orders API.
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

module.exports = {
  name: 'mercadopago',
  capabilities: { dynamicQr: true, storePos: true, refund: true },
  testConnection,
  configurePointOfSale,
  createCharge,
  getCharge,
  cancelCharge,
  refundCharge,
  createPixCharge,
  getPayment,
  cancelPayment,
  refundPayment,
};
