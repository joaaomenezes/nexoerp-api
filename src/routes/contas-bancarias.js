const router = require('express').Router();
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('financeiro'));

const contaSchema = z.object({
  nome: z.string().min(1).max(120),
  banco: z.string().max(80).optional().nullable(),
  agencia: z.string().max(30).optional().nullable(),
  conta: z.string().max(40).optional().nullable(),
  tipo: z.enum(['corrente', 'poupanca', 'pagamento', 'caixa', 'outro']).optional(),
  chavePix: z.string().max(120).optional().nullable(),
  saldoInicial: z.number().optional(),
  principal: z.boolean().optional(),
  status: z.enum(['ativa', 'inativa']).optional(),
  observacoes: z.string().max(1000).optional().nullable(),
});

function cleanText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeConta(input) {
  return {
    nome: input.nome.trim(),
    banco: cleanText(input.banco),
    agencia: cleanText(input.agencia),
    conta: cleanText(input.conta),
    tipo: input.tipo || 'corrente',
    chavePix: cleanText(input.chavePix),
    saldoInicial: Number(input.saldoInicial || 0),
    principal: Boolean(input.principal),
    status: input.status || 'ativa',
    observacoes: cleanText(input.observacoes),
  };
}

async function unsetPrincipalIfNeeded(tx, empresaId, principal, ignoreId = null) {
  if (!principal) return;
  await tx.contaBancaria.updateMany({
    where: {
      empresaId,
      principal: true,
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    data: { principal: false },
  });
}

router.get('/', async (req, res, next) => {
  try {
    const { status = 'ativa', q } = req.query;
    const where = {
      empresaId: req.auth.empresaId,
      ...(status !== 'todas' && { status }),
      ...(q && {
        OR: [
          { nome: { contains: q, mode: 'insensitive' } },
          { banco: { contains: q, mode: 'insensitive' } },
          { agencia: { contains: q, mode: 'insensitive' } },
          { conta: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const result = await findManyPaginated(prisma.contaBancaria, req.query, {
      where,
      orderBy: [{ principal: 'desc' }, { nome: 'asc' }],
    });

    sendList(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = normalizeConta(contaSchema.parse(req.body));
    const conta = await prisma.$transaction(async tx => {
      await unsetPrincipalIfNeeded(tx, req.auth.empresaId, data.principal);
      return tx.contaBancaria.create({
        data: { ...data, empresaId: req.auth.empresaId },
      });
    });

    res.status(201).json({ ok: true, data: conta });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = normalizeConta(contaSchema.parse(req.body));
    const conta = await prisma.$transaction(async tx => {
      const existing = await tx.contaBancaria.findFirst({
        where: { id: req.params.id, empresaId: req.auth.empresaId },
      });
      if (!existing) {
        const err = new Error('Conta bancaria nao encontrada.');
        err.status = 404;
        throw err;
      }

      await unsetPrincipalIfNeeded(tx, req.auth.empresaId, data.principal, req.params.id);
      return tx.contaBancaria.update({
        where: { id: req.params.id },
        data,
      });
    });

    res.json({ ok: true, data: conta });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await prisma.contaBancaria.updateMany({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
      data: { status: 'inativa', principal: false },
    });
    if (!result.count) return res.status(404).json({ ok: false, message: 'Conta bancaria nao encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
