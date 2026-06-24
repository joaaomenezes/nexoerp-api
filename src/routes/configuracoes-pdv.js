const router = require('express').Router();
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requirePermission } = require('../middleware/auth');

const prisma = new PrismaClient();

const DEFAULT_CONFIG = {
  pixTipoChave: 'aleatoria',
  pixChave: null,
  pixBeneficiario: null,
  pixCidade: null,
  terminalOperadora: 'demo',
  terminalId: null,
  cartaoConfig: {},
  jurosAPartirDe: 4,
  maxParcelas: 12,
  taxaJurosMensal: 0.0299,
  exigirFundo: false,
  exigirOperador: false,
  overtimeEnabled: true,
  overtimeHours: 8,
  notasRapidas: [10, 20, 50, 100, 200],
  lojaNome: null,
  lojaCnpj: null,
  lojaRodape: null,
};

const PIX_PROVIDERS = ['mercadopago', 'efi', 'asaas', 'pagbank'];

const cardConfigSchema = z.object({
  nome: z.string().max(80).optional(),
  operadora: z.string().max(50).optional(),
  contaRecebimento: z.string().max(120).optional(),
  status: z.enum(['ativo', 'inativo']).optional(),
  tiposAceitos: z.object({
    debito: z.boolean().optional(),
    creditoVista: z.boolean().optional(),
    creditoParcelado: z.boolean().optional(),
    voucher: z.boolean().optional(),
  }).optional(),
  bandeirasAceitas: z.array(z.string().max(40)).max(12).optional(),
  taxaDebito: z.number().min(0).max(100).nullable().optional(),
  prazoDebitoDias: z.number().int().min(0).max(365).nullable().optional(),
  taxaCreditoVista: z.number().min(0).max(100).nullable().optional(),
  prazoCreditoVistaDias: z.number().int().min(0).max(365).nullable().optional(),
  taxaCreditoParcelado: z.number().min(0).max(100).nullable().optional(),
  prazoPrimeiraParcelaDias: z.number().int().min(0).max(365).nullable().optional(),
  intervaloParcelasDias: z.number().int().min(1).max(365).nullable().optional(),
  nomePdv: z.string().max(80).optional(),
  exibirNoPdv: z.boolean().optional(),
  observacoes: z.string().max(1000).optional(),
  contasBancarias: z.array(z.object({
    id: z.string().max(80),
    nome: z.string().max(120),
  })).max(20).optional(),
}).passthrough();

const configSchema = z.object({
  pixModo: z.enum(['manual', 'automatico']),
  pixProvedor: z.enum(PIX_PROVIDERS).nullable(),
  pixAmbiente: z.enum(['sandbox', 'producao']),
  pixTipoChave: z.enum(['cpf', 'cnpj', 'email', 'telefone', 'aleatoria']),
  pixChave: z.string().max(100),
  pixBeneficiario: z.string().max(25),
  pixCidade: z.string().max(15),
  terminalOperadora: z.string().max(50),
  terminalId: z.string().max(100),
  cartaoConfig: cardConfigSchema.optional(),
  jurosAPartirDe: z.number().int().min(1).max(24),
  maxParcelas: z.number().int().min(1).max(24),
  taxaJurosMensal: z.number().min(0).max(1),
  exigirFundo: z.boolean(),
  exigirOperador: z.boolean(),
  overtimeEnabled: z.boolean(),
  overtimeHours: z.number().int().min(1).max(24),
  notasRapidas: z.array(z.number().int().positive()).max(10),
  lojaNome: z.string().max(100),
  lojaCnpj: z.string().max(30),
  lojaRodape: z.string().max(200),
});

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = size => {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function isValidCnpj(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calculate = base => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = [...base].reduce((total, number, index) => total + (Number(number) * weights[index]), 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(cnpj.slice(0, 12));
  const second = calculate(`${cnpj.slice(0, 12)}${first}`);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

function normalizePixKey(type, rawKey) {
  const key = rawKey.trim();
  if (!key) return null;

  if (type === 'cpf') {
    const digits = key.replace(/\D/g, '');
    if (!isValidCpf(digits)) throw httpError(400, 'Informe uma chave PIX CPF valida.');
    return digits;
  }

  if (type === 'cnpj') {
    const digits = key.replace(/\D/g, '');
    if (!isValidCnpj(digits)) throw httpError(400, 'Informe uma chave PIX CNPJ valida.');
    return digits;
  }

  if (type === 'email') {
    const email = key.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Informe uma chave PIX de e-mail valida.');
    return email;
  }

  if (type === 'telefone') {
    const phone = `+${key.replace(/\D/g, '')}`;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw httpError(400, 'Informe o telefone PIX com codigo do pais, por exemplo +5511999999999.');
    return phone;
  }

  const randomKey = key.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(randomKey)) {
    throw httpError(400, 'Informe uma chave PIX aleatoria valida.');
  }
  return randomKey;
}

function validateCardConfig(config = {}) {
  if (!config || Object.keys(config).length === 0) return {};
  const { contasBancarias: _contasBancarias, ...cardConfig } = config;
  const tipos = cardConfig.tiposAceitos || {};
  const missing = [];
  if (!String(cardConfig.nome || '').trim()) missing.push('nome da configuracao');
  if (!String(cardConfig.operadora || '').trim()) missing.push('operadora');
  if (!String(cardConfig.contaRecebimento || '').trim()) missing.push('conta de recebimento');
  if (!String(cardConfig.status || '').trim()) missing.push('status');
  if (tipos.debito && (!Number.isFinite(cardConfig.taxaDebito) || !Number.isFinite(cardConfig.prazoDebitoDias))) {
    missing.push('taxa e prazo de debito');
  }
  if (tipos.creditoVista && (!Number.isFinite(cardConfig.taxaCreditoVista) || !Number.isFinite(cardConfig.prazoCreditoVistaDias))) {
    missing.push('taxa e prazo de credito a vista');
  }
  if (tipos.creditoParcelado && (
    !Number.isFinite(cardConfig.taxaCreditoParcelado)
    || !Number.isFinite(cardConfig.prazoPrimeiraParcelaDias)
    || !Number.isFinite(cardConfig.intervaloParcelasDias)
    || cardConfig.intervaloParcelasDias <= 0
  )) {
    missing.push('taxa e prazos do credito parcelado');
  }
  if (missing.length) throw httpError(400, `Revise a configuracao de cartao: ${missing.join(', ')}.`);
  return {
    ...cardConfig,
    nome: String(cardConfig.nome || '').trim(),
    operadora: String(cardConfig.operadora || '').trim(),
    contaRecebimento: String(cardConfig.contaRecebimento || '').trim(),
    status: cardConfig.status || 'ativo',
    nomePdv: String(cardConfig.nomePdv || cardConfig.nome || '').trim(),
    observacoes: String(cardConfig.observacoes || '').trim(),
  };
}

function mapBankAccounts(accounts = []) {
  const mapped = accounts.map(account => ({
    id: account.id,
    nome: account.principal ? `${account.nome} (principal)` : account.nome,
  }));
  return mapped.length ? mapped : [{ id: 'conta-principal', nome: 'Conta principal' }];
}

function withBankAccounts(config, accounts) {
  const cartaoConfig = config?.cartaoConfig && typeof config.cartaoConfig === 'object' ? config.cartaoConfig : {};
  return {
    ...(config || DEFAULT_CONFIG),
    cartaoConfig: {
      ...cartaoConfig,
      contasBancarias: mapBankAccounts(accounts),
    },
  };
}

router.use(requireAuth);
router.use(requirePermission('pdv'));

router.get('/', async (req, res, next) => {
  try {
    const [config, integration, contasBancarias] = await Promise.all([
      prisma.configuracaoPDV.findUnique({ where: { empresaId: req.auth.empresaId } }),
      prisma.integracaoPagamento.findUnique({
        where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
      }),
      prisma.contaBancaria.findMany({
        where: { empresaId: req.auth.empresaId, status: 'ativa' },
        orderBy: [{ principal: 'desc' }, { nome: 'asc' }],
      }),
    ]);
    res.json({
      ok: true,
      data: {
        ...withBankAccounts(config, contasBancarias),
        pixModo: integration?.ativo ? 'automatico' : 'manual',
        pixProvedor: integration?.provedor || null,
        pixAmbiente: integration?.ambiente || 'sandbox',
        pixStatus: integration?.status || 'desconectado',
        pixWebhookPath: integration ? `/api/webhooks/mercadopago/${integration.id}` : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    if (!req.auth.isDono && req.auth.permissions !== null) {
      throw httpError(403, 'Apenas o dono pode alterar as configuracoes do PDV.');
    }

    const input = configSchema.parse(req.body);
    const { pixModo, pixProvedor, pixAmbiente, ...configInput } = input;
    if (pixModo === 'automatico' && !pixProvedor) {
      throw httpError(400, 'Selecione um provedor para usar o PIX automatico.');
    }

    const pixChave = normalizePixKey(configInput.pixTipoChave, configInput.pixChave);
    if (pixModo === 'manual' && pixChave && (!configInput.pixBeneficiario.trim() || !configInput.pixCidade.trim())) {
      throw httpError(400, 'Informe o nome do beneficiario e a cidade da chave PIX.');
    }

    const data = {
      ...configInput,
      pixChave,
      pixBeneficiario: configInput.pixBeneficiario.trim() || null,
      pixCidade: configInput.pixCidade.trim().toUpperCase() || null,
      terminalId: configInput.terminalId.trim() || null,
      cartaoConfig: validateCardConfig(configInput.cartaoConfig || {}),
      lojaNome: configInput.lojaNome.trim() || null,
      lojaCnpj: configInput.lojaCnpj.trim() || null,
      lojaRodape: configInput.lojaRodape.trim() || null,
    };

    const existingIntegration = await prisma.integracaoPagamento.findUnique({
      where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
    });
    const integrationChanged = !!pixProvedor && (
      existingIntegration?.provedor !== pixProvedor || existingIntegration?.ambiente !== pixAmbiente
    );

    const result = await prisma.$transaction(async tx => {
      const config = await tx.configuracaoPDV.upsert({
        where: { empresaId: req.auth.empresaId },
        update: data,
        create: { ...data, empresaId: req.auth.empresaId },
      });

      let integration = existingIntegration;
      if (pixProvedor) {
        integration = await tx.integracaoPagamento.upsert({
          where: { empresaId_tipo: { empresaId: req.auth.empresaId, tipo: 'pix' } },
          update: {
            provedor: pixProvedor,
            ambiente: pixAmbiente,
            ativo: pixModo === 'automatico',
            ...(integrationChanged ? {
              status: 'desconectado',
              credenciaisCriptografadas: null,
              webhookSecret: null,
              contaExternaId: null,
            } : {}),
          },
          create: {
            tipo: 'pix',
            provedor: pixProvedor,
            ambiente: pixAmbiente,
            ativo: pixModo === 'automatico',
            empresaId: req.auth.empresaId,
          },
        });
      } else if (existingIntegration) {
        integration = await tx.integracaoPagamento.update({
          where: { id: existingIntegration.id },
          data: { ativo: false },
        });
      }

      return { config, integration };
    });

    res.json({
      ok: true,
      data: {
        ...withBankAccounts(result.config, await prisma.contaBancaria.findMany({
          where: { empresaId: req.auth.empresaId, status: 'ativa' },
          orderBy: [{ principal: 'desc' }, { nome: 'asc' }],
        })),
        pixModo: result.integration?.ativo ? 'automatico' : 'manual',
        pixProvedor: result.integration?.provedor || null,
        pixAmbiente: result.integration?.ambiente || 'sandbox',
        pixStatus: result.integration?.status || 'desconectado',
        pixWebhookPath: result.integration ? `/api/webhooks/mercadopago/${result.integration.id}` : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
