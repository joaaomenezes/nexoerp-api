const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { z }   = require('zod');
const { PrismaClient } = require('@prisma/client');

const { requireAuth } = require('../middleware/auth');
const {
  authIpRateLimit,
  loginCredentialRateLimit,
  registerRateLimit,
  passwordResetEmailRateLimit,
} = require('../middleware/rateLimit');
const {
  buildVerificationUrl,
  createVerificationToken,
  emailVerificationRequired,
  hashVerificationToken,
  sendVerificationEmail,
  verificationExpiresAt,
} = require('../services/emailVerification');
const {
  buildPasswordResetUrl,
  createPasswordResetToken,
  hashPasswordResetToken,
  passwordResetExpiresAt,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} = require('../services/passwordReset');

const prisma = new PrismaClient();

function signToken(user, empresaId, rememberMe = false) {
  return jwt.sign(
    { userId: user.id, empresaId, isDono: user.isDono, permissions: user.permissions, nome: user.nome },
    process.env.JWT_SECRET,
    { expiresIn: rememberMe ? '30d' : '8h' }
  );
}

function authUserPayload(usuario, empresa) {
  return {
    id:          usuario.id,
    nome:        usuario.nome,
    username:    usuario.username,
    email:       usuario.email,
    isDono:      usuario.isDono,
    permissions: usuario.permissions,
    empresaId:   usuario.empresaId || empresa?.id,
    company:     empresa?.nome || '',
    emailVerificado: usuario.emailVerificado,
  };
}

async function prepareEmailVerification(tx, usuarioId) {
  const token = createVerificationToken();
  const tokenHash = hashVerificationToken(token);
  const expiresAt = verificationExpiresAt();

  await tx.usuario.update({
    where: { id: usuarioId },
    data: {
      emailVerificado: false,
      emailVerificadoEm: null,
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
    },
  });

  return { token, tokenHash, expiresAt };
}

function verificationResponseMeta(emailResult, verificationUrl) {
  const includeDevLink = process.env.NODE_ENV !== 'production' || process.env.EMAIL_VERIFICATION_EXPOSE_DEV_LINK === 'true';
  return {
    emailSent: !!emailResult?.sent,
    emailProvider: emailResult?.provider || null,
    ...(includeDevLink ? { verificationUrl } : {}),
  };
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

router.post('/register', registerRateLimit, async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const requireEmailVerification = emailVerificationRequired();

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
          emailVerificado: !requireEmailVerification,
          emailVerificadoEm: requireEmailVerification ? null : new Date(),
          empresaId:    empresa.id,
        },
      });

      let verification = null;
      if (requireEmailVerification) {
        verification = await prepareEmailVerification(tx, usuario.id);
      }

      return { empresa, usuario: { ...usuario, emailVerificado: !requireEmailVerification }, verification };
    });

    let emailMeta = null;
    if (result.verification) {
      const verificationUrl = buildVerificationUrl(result.verification.token);
      let emailResult;
      try {
        emailResult = await sendVerificationEmail({
          to: result.usuario.email,
          name: result.usuario.nome,
          verificationUrl,
        });
      } catch (err) {
        console.error('[auth] email verification send failed:', err.message);
        emailResult = { sent: false, provider: 'resend', reason: err.message };
      }
      emailMeta = verificationResponseMeta(emailResult, verificationUrl);
    }

    if (requireEmailVerification) {
      return res.status(201).json({
        ok: true,
        requiresEmailVerification: true,
        message: emailMeta?.emailSent
          ? 'Conta criada. Confirme seu e-mail para acessar o sistema.'
          : 'Conta criada. Configure o envio de e-mail ou use o link de confirmação em ambiente de desenvolvimento.',
        email: result.usuario.email,
        verification: emailMeta,
      });
    }

    const token = signToken(result.usuario, result.empresa.id, true);

    res.status(201).json({
      ok: true,
      token,
      user: authUserPayload(result.usuario, result.empresa),
      ...(emailMeta ? { verification: emailMeta } : {}),
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

router.post('/login', authIpRateLimit, loginCredentialRateLimit, async (req, res, next) => {
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

    if (emailVerificationRequired() && usuario.emailVerificado === false) {
      return res.status(403).json({
        ok: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Confirme seu e-mail antes de acessar o sistema.',
        email: usuario.email,
      });
    }

    const token = signToken(usuario, usuario.empresaId, rememberMe);

    res.json({
      ok: true,
      token,
      user: authUserPayload(usuario, usuario.empresa),
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/auth/me ───────────────────────────────────
// Qualquer usuário autenticado pode atualizar seu próprio perfil
const verifyEmailSchema = z.object({
  token: z.string().min(32),
});

router.post('/verify-email', authIpRateLimit, async (req, res, next) => {
  try {
    const { token } = verifyEmailSchema.parse(req.body);
    const tokenHash = hashVerificationToken(token);

    const usuario = await prisma.usuario.findFirst({
      where: { emailVerificationTokenHash: tokenHash },
      include: { empresa: true },
    });

    if (!usuario) {
      return res.status(400).json({ ok: false, message: 'Link de confirmação inválido.' });
    }

    if (usuario.emailVerificationExpiresAt && usuario.emailVerificationExpiresAt < new Date()) {
      return res.status(400).json({ ok: false, message: 'Link de confirmação expirado. Solicite um novo e-mail.' });
    }

    const atualizado = await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        emailVerificado: true,
        emailVerificadoEm: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
      include: { empresa: true },
    });

    const authToken = signToken(atualizado, atualizado.empresaId, true);
    res.json({
      ok: true,
      message: 'E-mail confirmado com sucesso.',
      token: authToken,
      user: authUserPayload(atualizado, atualizado.empresa),
    });
  } catch (err) {
    next(err);
  }
});

const resendVerificationSchema = z.object({
  identifier: z.string().min(1),
});

router.post('/resend-verification', authIpRateLimit, async (req, res, next) => {
  try {
    const { identifier } = resendVerificationSchema.parse(req.body);
    const needle = identifier.toLowerCase();
    const usuario = await prisma.usuario.findFirst({
      where: { OR: [{ email: needle }, { username: needle }] },
    });

    if (!usuario) {
      return res.json({ ok: true, message: 'Se a conta existir, enviaremos um novo e-mail de confirmação.' });
    }

    if (usuario.emailVerificado) {
      return res.json({ ok: true, message: 'Este e-mail já está confirmado.' });
    }

    const verification = await prepareEmailVerification(prisma, usuario.id);
    const verificationUrl = buildVerificationUrl(verification.token);
    let emailResult;
    try {
      emailResult = await sendVerificationEmail({
        to: usuario.email,
        name: usuario.nome,
        verificationUrl,
      });
    } catch (err) {
      console.error('[auth] resend verification failed:', err.message);
      emailResult = { sent: false, provider: 'resend', reason: err.message };
    }

    res.json({
      ok: true,
      message: emailResult.sent
        ? 'Novo e-mail de confirmação enviado.'
        : 'Novo link de confirmação gerado. Configure o envio de e-mail ou use o link em ambiente de desenvolvimento.',
      verification: verificationResponseMeta(emailResult, verificationUrl),
    });
  } catch (err) {
    next(err);
  }
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(32),
  password: z.string()
    .min(8, 'A senha deve ter no mínimo 8 caracteres.')
    .regex(/[A-Za-z]/, 'A senha deve conter pelo menos uma letra.')
    .regex(/[0-9]/, 'A senha deve conter pelo menos um número.'),
  confirmPassword: z.string().min(1),
}).refine(data => data.password === data.confirmPassword, {
  path: ['confirmPassword'],
  message: 'As senhas não conferem.',
});

const PASSWORD_RESET_GENERIC_MESSAGE = 'Se este e-mail estiver cadastrado, enviaremos um link para redefinir sua senha.';

router.post('/forgot-password', authIpRateLimit, passwordResetEmailRateLimit, async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase();
    const usuarios = await prisma.usuario.findMany({ where: { email: normalizedEmail } });

    if (!usuarios.length) {
      console.info('[auth] password reset requested for non-existing email');
      return res.json({ ok: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const userAgent = req.get('user-agent') || null;

    for (const usuario of usuarios) {
      const token = createPasswordResetToken();
      const tokenHash = hashPasswordResetToken(token);
      const expiresAt = passwordResetExpiresAt();
      const resetUrl = buildPasswordResetUrl(token);

      await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: { userId: usuario.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            userId: usuario.id,
            tokenHash,
            expiresAt,
            ip: ip ? String(ip).slice(0, 120) : null,
            userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
          },
        });
      });

      try {
        await sendPasswordResetEmail({
          to: usuario.email,
          name: usuario.nome,
          resetUrl,
        });
      } catch (err) {
        console.error('[auth] password reset email failed:', err.message);
      }
    }

    console.info('[auth] password reset requested');
    return res.json({ ok: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', authIpRateLimit, async (req, res, next) => {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);
    const tokenHash = hashPasswordResetToken(token);

    const resetToken = await prisma.passwordResetToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!resetToken || resetToken.usedAt) {
      return res.status(400).json({ ok: false, message: 'Link de redefinição inválido ou já utilizado.' });
    }

    if (resetToken.expiresAt < new Date()) {
      await prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });
      return res.status(400).json({ ok: false, message: 'Link de redefinição expirado. Solicite um novo link.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          usedAt: null,
          NOT: { id: resetToken.id },
        },
        data: { usedAt: new Date() },
      });
    });

    try {
      await sendPasswordChangedEmail({
        to: resetToken.user.email,
        name: resetToken.user.nome,
      });
    } catch (err) {
      console.error('[auth] password changed email failed:', err.message);
    }

    res.json({ ok: true, message: 'Senha alterada com sucesso. Acesse sua conta com a nova senha.' });
  } catch (err) {
    next(err);
  }
});

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
    if (data.email && emailVerificationRequired()) {
      updateData.emailVerificado = false;
      updateData.emailVerificadoEm = null;
      updateData.emailVerificationTokenHash = null;
      updateData.emailVerificationExpiresAt = null;
    }
    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    const usuario = await prisma.usuario.update({
      where: { id: req.auth.userId },
      data:  updateData,
      select: {
        id: true, nome: true, username: true,
        email: true, isDono: true, permissions: true, emailVerificado: true,
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

    res.json({ ok: true, user: authUserPayload(usuario, usuario.empresa) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
