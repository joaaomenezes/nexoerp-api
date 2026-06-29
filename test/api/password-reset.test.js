const assert = require('assert/strict');
const { describe, it, before, after } = require('node:test');
const { PrismaClient } = require('@prisma/client');

process.env.NODE_ENV = 'test';
process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.LOGIN_RATE_LIMIT_MAX = '1000';
process.env.REGISTER_RATE_LIMIT_MAX = '1000';
process.env.PASSWORD_RESET_RATE_LIMIT_MAX = '1000';
process.env.RESEND_API_KEY = '';
process.env.EMAIL_FROM = '';

const app = require('../../src/app');
const {
  createPasswordResetToken,
  hashPasswordResetToken,
  passwordResetExpiresAt,
} = require('../../src/services/passwordReset');
const prisma = new PrismaClient();

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function request(ctx, method, path, { body } = {}) {
  const response = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, body: json };
}

describe('Recuperacao de senha', () => {
  let ctx;
  let empresaId;
  let usuarioId;
  let email;
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  before(async () => {
    ctx = await listen();
    email = `reset-${unique}@teste.local`;

    const register = await request(ctx, 'POST', '/api/auth/register', {
      body: {
        nome: 'Dono Reset',
        username: `reset_${unique}`.replace(/[^a-z0-9_]/gi, '').slice(0, 30),
        email,
        password: 'SenhaAntiga1',
        company: `Empresa Reset ${unique}`,
      },
    });

    assert.equal(register.status, 201);
    assert.equal(register.body.ok, true);
    empresaId = register.body.user.empresaId;

    const usuario = await prisma.usuario.findFirst({ where: { email } });
    assert.ok(usuario);
    usuarioId = usuario.id;
  });

  after(async () => {
    if (empresaId) {
      await prisma.empresa.deleteMany({ where: { id: empresaId } });
    }
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  it('sempre retorna mensagem generica e cria token hash para email existente', async () => {
    const missing = await request(ctx, 'POST', '/api/auth/forgot-password', {
      body: { email: `nao-existe-${unique}@teste.local` },
    });
    assert.equal(missing.status, 200);
    assert.equal(missing.body.ok, true);

    const existing = await request(ctx, 'POST', '/api/auth/forgot-password', {
      body: { email },
    });
    assert.equal(existing.status, 200);
    assert.equal(existing.body.ok, true);
    assert.equal(existing.body.message, missing.body.message);

    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: usuarioId, usedAt: null },
    });
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].tokenHash.length, 64);
    assert.ok(tokens[0].expiresAt > new Date());
  });

  it('redefine senha uma unica vez e invalida tokens pendentes', async () => {
    const token = createPasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    const outroToken = createPasswordResetToken();

    const valido = await prisma.passwordResetToken.create({
      data: {
        userId: usuarioId,
        tokenHash,
        expiresAt: passwordResetExpiresAt(),
      },
    });
    const pendente = await prisma.passwordResetToken.create({
      data: {
        userId: usuarioId,
        tokenHash: hashPasswordResetToken(outroToken),
        expiresAt: passwordResetExpiresAt(),
      },
    });

    const reset = await request(ctx, 'POST', '/api/auth/reset-password', {
      body: {
        token,
        password: 'SenhaNova1',
        confirmPassword: 'SenhaNova1',
      },
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.ok, true);

    const tokenUsado = await prisma.passwordResetToken.findUnique({ where: { id: valido.id } });
    const tokenInvalidado = await prisma.passwordResetToken.findUnique({ where: { id: pendente.id } });
    assert.ok(tokenUsado.usedAt);
    assert.ok(tokenInvalidado.usedAt);

    const repetir = await request(ctx, 'POST', '/api/auth/reset-password', {
      body: {
        token,
        password: 'SenhaNova2',
        confirmPassword: 'SenhaNova2',
      },
    });
    assert.equal(repetir.status, 400);

    const loginAntigo = await request(ctx, 'POST', '/api/auth/login', {
      body: { identifier: email, password: 'SenhaAntiga1' },
    });
    assert.equal(loginAntigo.status, 401);

    const loginNovo = await request(ctx, 'POST', '/api/auth/login', {
      body: { identifier: email, password: 'SenhaNova1' },
    });
    assert.equal(loginNovo.status, 200);
    assert.equal(loginNovo.body.ok, true);
  });
});
