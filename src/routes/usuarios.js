const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { z }   = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth } = require('../middleware/auth');
const { findManyPaginated, sendList } = require('../utils/pagination');

const prisma = new PrismaClient();

router.use(requireAuth);

// Apenas o Dono pode gerenciar sub-usuários
function requireDono(req, res, next) {
  if (!req.auth.isDono) {
    return res.status(403).json({ ok: false, message: 'Apenas o Dono pode gerenciar usuários.' });
  }
  next();
}

const ALL_MODULES = [
  'dashboard','pdv','pedidos','vendas','clientes',
  'produtos','estoque','financeiro','relatorios','configuracoes'
];

// ── GET /api/usuarios ─────────────────────────────────────
// Lista todos os usuários da empresa (sem passwordHash)
router.get('/', async (req, res, next) => {
  try {
    const result = await findManyPaginated(prisma.usuario, req.query, {
      where:   { empresaId: req.auth.empresaId },
      orderBy: { criadoEm: 'asc' },
      select: {
        id:          true,
        nome:        true,
        username:    true,
        email:       true,
        isDono:      true,
        permissions: true,
        criadoEm:    true,
      },
    });

    sendList(res, result);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/usuarios ────────────────────────────────────
// Cria sub-usuário (somente Dono)
router.post('/', requireDono, async (req, res, next) => {
  try {
    const schema = z.object({
      nome:        z.string().min(2),
      username:    z.string().min(3),
      email:       z.string().email(),
      password:    z.string().min(4),
      permissions: z.record(z.boolean()).optional(),
    });

    const data = schema.parse(req.body);

    // Verifica duplicidade dentro da empresa
    const duplicado = await prisma.usuario.findFirst({
      where: {
        empresaId: req.auth.empresaId,
        OR: [
          { email:    data.email.toLowerCase() },
          { username: data.username.toLowerCase() },
        ],
      },
    });
    if (duplicado) {
      return res.status(409).json({ ok: false, message: 'E-mail ou login já cadastrado.' });
    }

    // Garante que permissions só contém módulos válidos
    const perms = {};
    ALL_MODULES.forEach(m => { perms[m] = !!(data.permissions && data.permissions[m]); });

    const passwordHash = await bcrypt.hash(data.password, 10);

    const usuario = await prisma.usuario.create({
      data: {
        nome:         data.nome,
        username:     data.username.toLowerCase(),
        email:        data.email.toLowerCase(),
        passwordHash,
        isDono:       false,
        permissions:  perms,
        empresaId:    req.auth.empresaId,
      },
      select: {
        id: true, nome: true, username: true,
        email: true, isDono: true, permissions: true, criadoEm: true,
      },
    });

    res.status(201).json({ ok: true, data: usuario });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/usuarios/:id ─────────────────────────────────
// Atualiza sub-usuário (somente Dono, não pode editar o próprio Dono)
router.put('/:id', requireDono, async (req, res, next) => {
  try {
    const existe = await prisma.usuario.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Usuário não encontrado.' });
    if (existe.isDono) return res.status(403).json({ ok: false, message: 'O Dono não pode ser editado por esta rota.' });

    const schema = z.object({
      nome:        z.string().min(2).optional(),
      username:    z.string().min(3).optional(),
      email:       z.string().email().optional(),
      password:    z.string().min(4).optional(),
      permissions: z.record(z.boolean()).optional(),
    });

    const data = schema.parse(req.body);

    // Verifica conflito de username/email em outro usuário
    if (data.username || data.email) {
      const conflito = await prisma.usuario.findFirst({
        where: {
          empresaId: req.auth.empresaId,
          NOT: { id: req.params.id },
          OR: [
            ...(data.email    ? [{ email:    data.email.toLowerCase() }]    : []),
            ...(data.username ? [{ username: data.username.toLowerCase() }] : []),
          ],
        },
      });
      if (conflito) return res.status(409).json({ ok: false, message: 'E-mail ou login já está em uso por outro usuário.' });
    }

    const updateData = {
      ...(data.nome     && { nome:     data.nome }),
      ...(data.username && { username: data.username.toLowerCase() }),
      ...(data.email    && { email:    data.email.toLowerCase() }),
    };

    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    if (data.permissions) {
      const perms = {};
      ALL_MODULES.forEach(m => { perms[m] = !!(data.permissions[m]); });
      updateData.permissions = perms;
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.params.id },
      data:  updateData,
      select: {
        id: true, nome: true, username: true,
        email: true, isDono: true, permissions: true, criadoEm: true,
      },
    });

    res.json({ ok: true, data: usuario });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/usuarios/:id ──────────────────────────────
// Remove sub-usuário (somente Dono, não pode remover a si mesmo)
router.delete('/:id', requireDono, async (req, res, next) => {
  try {
    if (req.params.id === req.auth.userId) {
      return res.status(403).json({ ok: false, message: 'Você não pode remover sua própria conta.' });
    }

    const existe = await prisma.usuario.findFirst({
      where: { id: req.params.id, empresaId: req.auth.empresaId },
    });
    if (!existe) return res.status(404).json({ ok: false, message: 'Usuário não encontrado.' });
    if (existe.isDono) return res.status(403).json({ ok: false, message: 'O Dono não pode ser removido.' });

    await prisma.usuario.delete({ where: { id: req.params.id } });

    res.json({ ok: true, message: 'Usuário removido.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
