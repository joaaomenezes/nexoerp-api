const router = require('express').Router();
const { z }  = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth, requirePermission } = require('../middleware/auth');

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

// ── GET /api/produtos ─────────────────────────────────────
// Lista todos os produtos da empresa com suporte a busca e filtros
router.get('/', async (req, res, next) => {
  try {
    const { q, status, cat, deposito } = req.query;

    const where = {
      empresaId: req.auth.empresaId,
      ...(status  && { status }),
      ...(cat     && { cat }),
      ...(deposito && { deposito }),
      ...(q && {
        OR: [
          { nome:  { contains: q, mode: 'insensitive' } },
          { sku:   { contains: q, mode: 'insensitive' } },
          { marca: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };

    const produtos = await prisma.produto.findMany({
      where,
      orderBy: { nome: 'asc' },
    });

    res.json({ ok: true, data: produtos });
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
