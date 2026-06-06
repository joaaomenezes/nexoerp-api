const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { z }   = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

function signToken(user, empresaId, rememberMe = false) {
  return jwt.sign(
    { userId: user.id, empresaId, isDono: user.isDono, permissions: user.permissions },
    process.env.JWT_SECRET,
    { expiresIn: rememberMe ? '30d' : '8h' }
  );
}

// ── POST /api/auth/register ───────────────────────────────
// Cria a empresa + o usuário Dono em uma transação.
const registerSchema = z.object({
  nome:        z.string().min(2),
  username:    z.string().min(3),
  email:       z.string().email(),
  password:    z.string().min(6),
  company:     z.string().min(2),
  segmento:    z.string().optional(),
  telefone:    z.string().optional(),
  cidade:      z.string().optional(),
  funcionarios: z.string().optional(),
});

router.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);

    const emailTaken = await prisma.usuario.findFirst({
      where: { email: data.email.toLowerCase() },
    });
    if (emailTaken) {
      return res.status(409).json({ ok: false, message: 'E-mail já cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.create({
        data: {
          nome:        data.company,
          segmento:    data.segmento,
          telefone:    data.telefone,
          cidade:      data.cidade,
          funcionarios: data.funcionarios,
        },
      });

      const usuario = await tx.usuario.create({
        data: {
          nome:         data.nome,
          username:     data.username.toLowerCase(),
          email:        data.email.toLowerCase(),
          passwordHash,
          isDono:       true,
          permissions:  null,
          empresaId:    empresa.id,
        },
      });

      return { empresa, usuario };
    });

    const token = signToken(result.usuario, result.empresa.id, true);

    res.status(201).json({
      ok: true,
      token,
      user: {
        id:          result.usuario.id,
        nome:        result.usuario.nome,
        username:    result.usuario.username,
        email:       result.usuario.email,
        isDono:      result.usuario.isDono,
        permissions: result.usuario.permissions,
        empresaId:   result.empresa.id,
        company:     result.empresa.nome,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ──────────────────────────────────
const loginSchema = z.object({
  identifier: z.string().min(1),
  password:   z.string().min(1),
  rememberMe: z.boolean().optional(),
});

router.post('/login', async (req, res, next) => {
  try {
    const { identifier, password, rememberMe } = loginSchema.parse(req.body);

    const needle = identifier.toLowerCase();
    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [{ email: needle }, { username: needle }],
      },
      include: { empresa: true },
    });

    if (!usuario) {
      return res.status(401).json({ ok: false, message: 'Usuário ou senha incorretos.' });
    }

    const valid = await bcrypt.compare(password, usuario.passwordHash);
    if (!valid) {
      return res.status(401).json({ ok: false, message: 'Usuário ou senha incorretos.' });
    }

    const token = signToken(usuario, usuario.empresaId, rememberMe);

    res.json({
      ok: true,
      token,
      user: {
        id:          usuario.id,
        nome:        usuario.nome,
        username:    usuario.username,
        email:       usuario.email,
        isDono:      usuario.isDono,
        permissions: usuario.permissions,
        empresaId:   usuario.empresaId,
        company:     usuario.empresa.nome,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/auth/me ───────────────────────────────────
// Qualquer usuário autenticado pode atualizar seu próprio perfil
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      nome:     z.string().min(2).optional(),
      username: z.string().min(3).optional(),
      email:    z.string().email().optional(),
      password: z.string().min(4).optional(),
    });
    const data = schema.parse(req.body);

    if (data.username || data.email) {
      const conflito = await prisma.usuario.findFirst({
        where: {
          empresaId: req.auth.empresaId,
          NOT: { id: req.auth.userId },
          OR: [
            ...(data.email    ? [{ email:    data.email.toLowerCase()    }] : []),
            ...(data.username ? [{ username: data.username.toLowerCase() }] : []),
          ],
        },
      });
      if (conflito) {
        return res.status(409).json({ ok: false, message: 'E-mail ou login já está em uso por outro usuário.' });
      }
    }

    const updateData = {
      ...(data.nome     && { nome:     data.nome }),
      ...(data.username && { username: data.username.toLowerCase() }),
      ...(data.email    && { email:    data.email.toLowerCase() }),
    };
    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.auth.userId },
      data:  updateData,
      select: {
        id: true, nome: true, username: true,
        email: true, isDono: true, permissions: true,
      },
    });

    res.json({ ok: true, data: usuario });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.auth.userId },
      include: { empresa: true },
    });

    if (!usuario) {
      return res.status(404).json({ ok: false, message: 'Usuário não encontrado.' });
    }

    res.json({
      ok: true,
      user: {
        id:          usuario.id,
        nome:        usuario.nome,
        username:    usuario.username,
        email:       usuario.email,
        isDono:      usuario.isDono,
        permissions: usuario.permissions,
        empresaId:   usuario.empresaId,
        company:     usuario.empresa.nome,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
