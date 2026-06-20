const router = require('express').Router();
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { encryptCredentials, decryptCredentials } = require('../utils/integrationCrypto');
const mercadoPago = require('../services/paymentProviders/mercadoPago');

const prisma = new PrismaClient();

const mercadoPagoSchema = z.object({
  accessToken: z.string().trim().min(20).max(300).optional(),
  webhookSecret: z.string().trim().max(300).optional().default(''),
  ambiente: z.enum(['sandbox', 'producao']),
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

function publicIntegration(integration) {
  if (!integration) return null;
  return {
    provedor: integration.provedor,
    ambiente: integration.ambiente,
    status: integration.status,
    ativo: integration.ativo,
    contaExternaId: integration.contaExternaId,
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
    res.json({ ok: true, data: publicIntegration(integration) });
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

    let account;
    try {
      account = await mercadoPago.testConnection(accessToken);
    } catch (_) {
      throw httpError(400, 'Nao foi possivel autenticar no Mercado Pago. Confira o Access Token e o ambiente.');
    }

    const encrypted = encryptCredentials({
      accessToken,
      webhookSecret,
    });
    const integrationStatus = webhookSecret ? 'conectado' : 'aguardando_webhook';
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

    res.json({ ok: true, data: { ...publicIntegration(integration), account } });
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
    const account = await mercadoPago.testConnection(credentials.accessToken);
    res.json({ ok: true, data: { status: 'conectado', account } });
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
