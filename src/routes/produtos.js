const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');

const prisma = new PrismaClient();

// Todas as rotas exigem token válido + permissão no módulo "produtos"
router.use(requireAuth);
router.use(requirePermission('produtos'));

// ── Validação de campos ───────────────────────────────────
const produtoSchema = z.object({
  sku:             z.string().min(1),
  nome:            z.string().min(1),
  cat:             z.string().optional(),
  marca:           z.string().optional(),
  unidade:         z.string().optional(),
  descricao:       z.string().optional(),
  preco:           z.number().min(0).optional(),
  custo:           z.number().min(0).optional(),
  precoMin:        z.number().min(0).optional(),
  descMax:         z.number().min(0).optional(),
  tabela:          z.string().optional(),
  estoque:         z.number().int().optional(),
  estoqueMin:      z.number().int().optional(),
  estoqueMax:      z.number().int().optional(),
  status:          z.enum(['ativo', 'inativo']).optional(),
  emoji:           z.string().optional(),
  cor:             z.string().optional(),
  destaque:        z.boolean().optional(),
  exibirPdv:       z.boolean().optional(),
  controlEstoque:  z.boolean().optional(),
  vendaSemEstoque: z.boolean().optional(),
  deposito:        z.string().optional(),
  posicao:         z.string().optional(),
  fornecedor:      z.string().optional(),
  prazo:           z.number().int().optional(),
  ean:             z.string().optional(),
  ncm:             z.string().optional(),
  cest:            z.string().optional(),
  cfop:            z.string().optional(),
  cst:             z.string().optional(),
  icms:            z.string().optional(),
  pis:             z.string().optional(),
  perecivel:       z.boolean().optional(),
  lote:            z.string().optional(),
  dataFabricacao:  z.string().optional(),
  dataVencimento:  z.string().optional(),
  imagem:          z.string().nullish(),
});

const SORT_FIELDS = new Set(['nome', 'sku', 'cat', 'preco', 'estoque', 'criadoEm', 'atualizadoEm']);

function buildProdutoWhere(req) {
  const { q, status, cat, deposito, estoqueStatus, stock } = req.query;
  const search = typeof q === 'string' ? q.trim() : '';
  const stockFilter = estoqueStatus || stock;

  const where = {
    empresaId: req.auth.empresaId,
  };

  if (status === 'ativo' || status === 'inativo') where.status = status;
  if (cat) where.cat = String(cat);
  if (deposito) where.deposito = String(deposito);
  if (stockFilter === 'baixo') where.estoque = { gt: 0, lte: prisma.produto.fields.estoqueMin };
  if (stockFilter === 'zerado') where.estoque = 0;
  if (search) {
    where.OR = [
      { nome:  { contains: search, mode: 'insensitive' } },
      { sku:   { contains: search, mode: 'insensitive' } },
      { ean:   { contains: search, mode: 'insensitive' } },
      { cat:   { contains: search, mode: 'insensitive' } },
      { marca: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}

function buildProdutoOrderBy(query) {
  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : '';
  const sortDir = query.sortDir === 'desc' ? 'desc' : 'asc';

  if (!SORT_FIELDS.has(sortBy)) return { nome: 'asc' };
  return { [sortBy]: sortDir };
}

// ── GET /api/produtos ─────────────────────────────────────
// Lista todos os produtos da empresa com suporte a busca e filtros
router.get('/', async (req, res, next) => {
  try {
    const result = await findManyPaginated(prisma.produto, req.query, {
      where: buildProdutoWhere(req),
      orderBy: buildProdutoOrderBy(req.query),
    });

    sendList(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/resumo', async (req, res, next) => {
  try {
    const produtos = await prisma.produto.findMany({
      where: { empresaId: req.auth.empresaId },
      select: { status: true, estoque: true, estoqueMin: true, custo: true },
    });

    const resumo = produtos.reduce((acc, p) => {
      acc.total += 1;
      if (p.status === 'ativo') acc.ativos += 1;
      if (p.estoque > 0 && p.estoque <= p.estoqueMin) acc.baixo += 1;
      if (p.estoque === 0) acc.zerado += 1;
      acc.valorEstoque += p.estoque * (p.custo || 0);
      return acc;
    }, { total: 0, ativos: 0, baixo: 0, zerado: 0, valorEstoque: 0 });

    res.json({ ok: true, data: resumo });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/produtos/:id ─────────────────────────────────
// Busca um único produto pelo ID
router.get('/:id', async (req, res, next) => {
  try {
    const produto = await prisma.produto.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });

    if (!produto) {
      return res.status(404).json({ ok: false, message: 'Produto não encontrado.' });
    }

    res.json({ ok: true, data: produto });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/produtos ────────────────────────────────────
// Cria um novo produto
router.post('/', async (req, res, next) => {
  try {
    const data = produtoSchema.parse(req.body);

    const skuExistente = await prisma.produto.findFirst({
      where: { sku: data.sku, empresaId: req.auth.empresaId },
    });
    if (skuExistente) {
      return res.status(409).json({ ok: false, message: 'SKU já cadastrado.' });
    }

    const produto = await prisma.produto.create({
      data: { ...data, empresaId: req.auth.empresaId },
    });

    res.status(201).json({ ok: true, data: produto });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/produtos/:id ─────────────────────────────────
// Atualiza um produto existente
router.put('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.produto.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Produto não encontrado.' });
    }

    const data = produtoSchema.partial().parse(req.body);

    // Se o SKU mudou, verifica se o novo SKU já existe em outro produto
    if (data.sku && data.sku !== existe.sku) {
      const skuExistente = await prisma.produto.findFirst({
        where: { sku: data.sku, empresaId: req.auth.empresaId, NOT: { id: req.params.id } },
      });
      if (skuExistente) {
        return res.status(409).json({ ok: false, message: 'SKU já cadastrado em outro produto.' });
      }
    }

    const produto = await prisma.produto.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ ok: true, data: produto });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/produtos/:id ──────────────────────────────
// Desativa o produto (nunca apaga — mantém histórico de vendas)
router.delete('/:id', async (req, res, next) => {
  try {
    const existe = await prisma.produto.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) {
      return res.status(404).json({ ok: false, message: 'Produto não encontrado.' });
    }

    await prisma.produto.update({
      where: { id: req.params.id },
      data: { status: 'inativo' },
    });

    res.json({ ok: true, message: 'Produto desativado.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
