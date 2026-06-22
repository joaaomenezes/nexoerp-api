const router = require('express').Router();
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { encryptCredentials, decryptCredentials } = require('../utils/integrationCrypto');
const { getPaymentProvider } = require('../services/paymentProviders');

const prisma = new PrismaClient();

const mercadoPagoSchema = z.object({
  accessToken: z.string().trim().min(20).max(300).optional(),
  webhookSecret: z.string().trim().max(300).optional().default(''),
  ambiente: z.enum(['sandbox', 'producao']),
});

const mercadoPagoQrSchema = z.object({
  storeName: z.string().trim().min(2).max(60),
  posName: z.string().trim().min(2).max(60),
  streetName: z.string().trim().min(2).max(100),
  streetNumber: z.string().trim().min(1).max(20),
  cityName: z.string().trim().min(2).max(60),
  stateName: z.string().trim().min(2).max(60),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  reference: z.string().trim().max(100).optional().default(''),
});

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireOwner(req, _res, next) {
  if (!req.auth.isDono && req.auth.permissions !== null) {
    return next(httpError(403, 'Apenas o dono pode conectar provedores de pagamento.'));
  }
  next();
}

function publicIntegration(integration, credentials = {}) {
  if (!integration) return null;
  return {
    provedor: integration.provedor,
    ambiente: integration.ambiente,
    status: integration.status,
    ativo: integration.ativo,
    contaExternaId: integration.contaExternaId,
    qrConfigured: Boolean(credentials.externalPosId),
    webhookPath: `/api/webhooks/mercadopago/${integration.id}`,
    atualizadoEm: integration.atualizadoEm,
  };
}

router.use(requireAuth);
router.use(requirePermission('pdv'));

router.get('/', async (req, res, next) => {
  try {
    const integration = await prisma.integracaoPagamento.findUnique({
      where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
    });
    const credentials = integration?.credenciaisCriptografadas
      ? decryptCredentials(integration.credenciaisCriptografadas)
      : {};
    res.json({ ok: true, data: publicIntegration(integration, credentials) });
  } catch (err) {
    next(err);
  }
});

router.put('/mercadopago', requireOwner, async (req, res, next) => {
  try {
    const input = mercadoPagoSchema.parse(req.body);
    const existing = await prisma.integracaoPagamento.findUnique({
      where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
    });
    const currentCredentials = existing?.credenciaisCriptografadas
      ? decryptCredentials(existing.credenciaisCriptografadas)
      : {};
    const accessToken = input.accessToken || currentCredentials.accessToken;
    const webhookSecret = input.webhookSecret || currentCredentials.webhookSecret || '';
    if (!accessToken) throw httpError(400, 'Informe o Access Token do Mercado Pago.');

    const provider = getPaymentProvider('mercadopago');
    let account;
    try {
      account = await provider.testConnection(accessToken);
    } catch (_) {
      throw httpError(400, 'Nao foi possivel autenticar no Mercado Pago. Confira o Access Token e o ambiente.');
    }

    const encrypted = encryptCredentials({
      ...currentCredentials,
      accessToken,
      webhookSecret,
    });
    const integrationStatus = currentCredentials.externalPosId
      ? (webhookSecret ? 'conectado' : 'aguardando_webhook')
      : 'configuracao_pendente';
    const integration = await prisma.integracaoPagamento.upsert({
      where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
      update: {
        provedor: 'mercadopago',
        ambiente: input.ambiente,
        status: integrationStatus,
        ativo: true,
        credenciaisCriptografadas: encrypted,
        webhookSecret: null,
        contaExternaId: account.id,
      },
      create: {
        tipo: 'pix',
        provedor: 'mercadopago',
        ambiente: input.ambiente,
        status: integrationStatus,
        ativo: true,
        credenciaisCriptografadas: encrypted,
        contaExternaId: account.id,
        empresaId: req.auth.empresaId,
      },
    });

    res.json({ ok: true, data: { ...publicIntegration(integration, currentCredentials), account } });
  } catch (err) {
    next(err);
  }
});

router.put('/mercadopago/qr', requireOwner, async (req, res, next) => {
  try {
    const input = mercadoPagoQrSchema.parse(req.body);
    const integration = await prisma.integracaoPagamento.findUnique({
      where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
    });
    if (!integration?.credenciaisCriptografadas || integration.provedor !== 'mercadopago') {
      throw httpError(409, 'Conecte a conta Mercado Pago antes de configurar a loja.');
    }

    const credentials = decryptCredentials(integration.credenciaisCriptografadas);
    if (credentials.externalPosId) {
      return res.json({ ok: true, data: publicIntegration(integration, credentials) });
    }

    const suffix = req.auth.empresaId.replace(/[^a-zA-Z0-9]/g, '').slice(-16).toUpperCase();
    const externalStoreId = `NEXO${suffix}`.slice(0, 40);
    const externalPosId = `${externalStoreId}POS1`.slice(0, 40);
    const provider = getPaymentProvider('mercadopago');
    let pointOfSale;
    try {
      pointOfSale = await provider.configurePointOfSale(
        credentials.accessToken,
        integration.contaExternaId,
        { ...input, externalStoreId, externalPosId, storeId: credentials.storeId }
      );
    } catch (err) {
      if (err.partialConfig) {
        await prisma.integracaoPagamento.update({
          where: { id: integration.id },
          data: {
            credenciaisCriptografadas: encryptCredentials({ ...credentials, ...err.partialConfig }),
          },
        });
      }
      throw err;
    }
    const nextCredentials = { ...credentials, ...pointOfSale };
    const status = credentials.webhookSecret ? 'conectado' : 'aguardando_webhook';
    const updated = await prisma.integracaoPagamento.update({
      where: { id: integration.id },
      data: {
        status,
        credenciaisCriptografadas: encryptCredentials(nextCredentials),
      },
    });

    res.json({ ok: true, data: publicIntegration(updated, nextCredentials) });
  } catch (err) {
    next(err);
  }
});

router.post('/mercadopago/testar', requireOwner, async (req, res, next) => {
  try {
    const integration = await prisma.integracaoPagamento.findUnique({
      where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
    });
    if (!integration?.credenciaisCriptografadas || integration.provedor !== 'mercadopago') {
      throw httpError(404, 'Mercado Pago nao conectado.');
    }

    const credentials = decryptCredentials(integration.credenciaisCriptografadas);
    const provider = getPaymentProvider('mercadopago');
    const account = await provider.testConnection(credentials.accessToken);
    res.json({
      ok: true,
      data: { status: integration.status, qrConfigured: Boolean(credentials.externalPosId), account },
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/', requireOwner, async (req, res, next) => {
  try {
    const integration = await prisma.integracaoPagamento.findUnique({
      where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
    });
    if (!integration) return res.json({ ok: true, data: null });

    await prisma.integracaoPagamento.update({
      where: { id: integration.id },
      data: {
        ativo: false,
        status: 'desconectado',
        credenciaisCriptografadas: null,
        webhookSecret: null,
        contaExternaId: null,
      },
    });
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
