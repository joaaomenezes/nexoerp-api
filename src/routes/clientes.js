const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');

const prisma = new PrismaClient();

router.use(requireAuth);
router.use(requirePermission('clientes'));

const SORT_FIELDS = new Set(['nome', 'tipo', 'cidade', 'status', 'cadastro', 'compras', 'pedidos', 'criadoEm', 'atualizadoEm']);

function buildClienteWhere(req) {
  const { q, status, secao, tipo } = req.query;
  const search = typeof q === 'string' ? q.trim() : '';

  const where = {
    empresaId: req.auth.empresaId,
  };

  if (status === 'ativo' || status === 'inativo' || status === 'bloq') where.status = status;
  if (secao === 'clientes' || secao === 'fornecedores') where.secao = secao;
  if (tipo === 'pf' || tipo === 'pj' || tipo === 'mei') where.tipo = tipo;
  if (search) {
    where.OR = [
      { nome:  { contains: search, mode: 'insensitive' } },
      { doc:   { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { tel:   { contains: search, mode: 'insensitive' } },
      { cidade:{ contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}

function buildClienteOrderBy(query) {
  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : '';
  const sortDir = query.sortDir === 'desc' ? 'desc' : 'asc';

  if (!SORT_FIELDS.has(sortBy)) return { nome: 'asc' };
  return { [sortBy]: sortDir };
}

// ── Validação ─────────────────────────────────────────────
const clienteSchema = z.object({
  nome:        z.string().min(1),
  tipo:        z.enum(['pf', 'pj', 'mei']).optional(),
  secao:       z.enum(['clientes', 'fornecedores']).optional(),
  doc:         z.string().optional(),
  rg:          z.string().optional(),
  nascimento:  z.string().optional(),
  genero:      z.string().optional(),
  tel:         z.string().optional(),
  tel2:        z.string().optional(),
  email:       z.string().email().optional().or(z.literal('')),
  site:        z.string().optional(),
  cep:         z.string().optional(),
  logradouro:  z.string().optional(),
  numero:      z.string().optional(),
  complemento: z.string().optional(),
  bairro:      z.string().optional(),
  cidade:      z.string().optional(),
  estado:      z.string().optional(),
  pais:        z.string().optional(),
  status:      z.enum(['ativo', 'inativo', 'bloq']).optional(),
  limite:      z.number().min(0).optional(),
  desconto:    z.string().optional(),
  condicao:    z.string().optional(),
  vendedor:    z.string().optional(),
  vendedorId:  z.string().optional(),
  grupo:       z.string().optional(),
  origem:      z.string().optional(),
  tags:        z.string().optional(),
  obs:         z.string().optional(),
  cadastro:    z.string().optional(),
});

// ── GET /api/clientes ─────────────────────────────────────
// Aceita ?secao=clientes|fornecedores, ?q=busca, ?status=ativo|inativo
router.get('/', async (req, res, next) => {
  try {
    const result = await findManyPaginated(prisma.cliente, req.query, {
      where: buildClienteWhere(req),
      orderBy: buildClienteOrderBy(req.query),
    });

    sendList(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/resumo', async (req, res, next) => {
  try {
    const { secao } = req.query;
    const where = {
      empresaId: req.auth.empresaId,
      ...(secao === 'clientes' || secao === 'fornecedores' ? { secao } : {}),
    };

    const itens = await prisma.cliente.findMany({
      where,
      select: { status: true, cadastro: true },
    });

    const now = new Date();
    const mes = String(now.getMonth() + 1).padStart(2, '0');
    const ano = String(now.getFullYear());
    const resumo = itens.reduce((acc, item) => {
      acc.total += 1;
      if (item.status === 'ativo') acc.ativos += 1;
      if (item.status === 'inativo' || item.status === 'bloq') acc.inativos += 1;
      const p = (item.cadastro || '').split('/');
      if (p[1] === mes && p[2] === ano) acc.mes += 1;
      return acc;
    }, { total: 0, ativos: 0, inativos: 0, mes: 0 });

    res.json({ ok: true, data: resumo });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/clientes/:id ─────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });

    if (!cliente) {
      return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });
    }

    res.json({ ok: true, data: cliente });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/clientes ────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const data = clienteSchema.parse(req.body);

    const cliente = await prisma.cliente.create({
      data: { ...data, empresaId: req.auth.empresaId },
    });

    res.status(201).json({ ok: true, data: cliente });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/clientes/:id ─────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });
    }

    const data = clienteSchema.partial().parse(req.body);

    const cliente = await prisma.cliente.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ ok: true, data: cliente });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/clientes/:id ──────────────────────────────
// Desativa — nunca apaga para preservar histórico de pedidos
router.delete('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Cliente não encontrado.' });
    }

    await prisma.cliente.update({
      where: { id: req.params.id },
      data: { status: 'inativo' },
    });

    res.json({ ok: true, message: 'Cliente desativado.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
