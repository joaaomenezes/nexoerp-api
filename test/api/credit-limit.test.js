const assert = require('assert/strict');
const { describe, it, before, after } = require('node:test');
const { PrismaClient } = require('@prisma/client');

process.env.NODE_ENV = 'test';
process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.LOGIN_RATE_LIMIT_MAX = '1000';
process.env.REGISTER_RATE_LIMIT_MAX = '1000';

const app = require('../../src/app');
const prisma = new PrismaClient();

function money(value) {
  return value == null ? value : Number(value);
}

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

async function request(ctx, method, path, { token, body } = {}) {
  const response = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, body: json };
}

describe('PDV fiado - limite de credito com PIN supervisor', () => {
  let ctx;
  let token;
  let empresaId;
  let cliente;
  let caixa;
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  before(async () => {
    ctx = await listen();

    const register = await request(ctx, 'POST', '/api/auth/register', {
      body: {
        nome: 'Dono Teste',
        username: `dono_${unique}`.replace(/[^a-z0-9_]/gi, '').slice(0, 30),
        email: `auditoria-${unique}@teste.local`,
        password: '123456',
        company: `Empresa Teste ${unique}`,
      },
    });

    assert.equal(register.status, 201);
    assert.equal(register.body.ok, true);
    token = register.body.token;
    empresaId = register.body.user.empresaId;

    const pin = await request(ctx, 'PUT', '/api/configuracoes-pdv/supervisor-pin', {
      token,
      body: { pin: '1234' },
    });
    assert.equal(pin.status, 200);
    assert.equal(pin.body.data.supervisorPinConfigured, true);

    cliente = await prisma.cliente.create({
      data: {
        nome: 'Cliente Fiado Teste',
        secao: 'clientes',
        limite: 100,
        empresaId,
      },
    });

    const caixaResponse = await request(ctx, 'POST', '/api/caixas', {
      token,
      body: { operador: 'Dono Teste', fundo: 0 },
    });
    assert.equal(caixaResponse.status, 201);
    caixa = caixaResponse.body.data;
  });

  after(async () => {
    if (empresaId) {
      await prisma.empresa.deleteMany({ where: { id: empresaId } });
    }
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  function fiadoBody(valor, extra = {}) {
    return {
      caixaId: caixa.id,
      cliente: cliente.nome,
      clienteId: cliente.id,
      metodo: 'fiado',
      pagamentos: [{ metodo: 'fiado', valor, status: 'pendente', vencimento: '2026-07-10' }],
      subtotal: valor,
      total: valor,
      vencimentoFiado: '2026-07-10',
      itens: [],
      ...extra,
    };
  }

  it('bloqueia venda PDV quando o caixa nao esta aberto para o operador', async () => {
    const response = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: {
        caixaId: 'caixa-inexistente',
        metodo: 'dinheiro',
        pagamentos: [{ metodo: 'dinheiro', valor: 10, status: 'confirmado' }],
        subtotal: 10,
        total: 10,
        itens: [],
      },
    });

    assert.equal(response.status, 409);
    assert.match(response.body.message, /Caixa fechado|Abra um caixa/i);
  });

  it('permite fiado dentro do limite do cliente', async () => {
    const response = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: fiadoBody(50),
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);

    const aberto = await prisma.lancamento.aggregate({
      _sum: { valor: true },
      where: { empresaId, clienteId: cliente.id, status: { in: ['avencer', 'vencida', 'pendente'] } },
    });
    assert.equal(money(aberto._sum.valor), 50);
  });

  it('exige liberacao quando total em aberto mais nova venda passa do limite', async () => {
    const response = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: fiadoBody(60),
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'CREDIT_LIMIT_EXCEEDED');
    assert.equal(response.body.data.limiteCredito, 100);
    assert.equal(response.body.data.totalEmAberto, 50);
    assert.equal(response.body.data.novaVendaFiado, 60);
  });

  it('recusa PIN supervisor incorreto', async () => {
    const response = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: fiadoBody(60, { supervisorPin: '9999' }),
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'INVALID_SUPERVISOR_PIN');
  });

  it('libera venda acima do limite com PIN supervisor correto', async () => {
    const response = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: fiadoBody(60, { supervisorPin: '1234' }),
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);

    const vendas = await prisma.venda.count({ where: { empresaId, clienteId: cliente.id } });
    assert.equal(vendas, 2);
  });

  it('permite receber lancamentos de fiado do cliente', async () => {
    const lancamentos = await prisma.lancamento.findMany({
      where: { empresaId, clienteId: cliente.id, formaPagamento: 'fiado', status: 'avencer' },
      orderBy: { criadoEm: 'asc' },
    });
    assert.equal(lancamentos.length, 2);

    const hoje = new Date().toISOString().slice(0, 10);
    for (const lancamento of lancamentos) {
      const response = await request(ctx, 'PUT', `/api/financeiro/${lancamento.id}`, {
        token,
        body: { status: 'recebido', recebidoEm: hoje, pagoEm: hoje },
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.data.status, 'recebido');
    }

    const aberto = await prisma.lancamento.aggregate({
      _sum: { valor: true },
      where: { empresaId, clienteId: cliente.id, status: { in: ['avencer', 'vencida', 'pendente'] } },
    });
    assert.equal(aberto._sum.valor, null);
  });
});
