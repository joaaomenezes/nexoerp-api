const assert = require('assert/strict');
const { describe, it, before, after } = require('node:test');
const { PrismaClient } = require('@prisma/client');

process.env.NODE_ENV = 'test';
process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.LOGIN_RATE_LIMIT_MAX = '1000';
process.env.REGISTER_RATE_LIMIT_MAX = '1000';
process.env.INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'test-encryption-key-32-characters-long';

const app = require('../../src/app');
const prisma = new PrismaClient();
const { encryptCredentials } = require('../../src/utils/integrationCrypto');
const webhookRoutes = require('../../src/routes/webhooks');

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

async function request(ctx, method, path, { token, body, headers = {} } = {}) {
  const response = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_err) { json = text; }
  return { status: response.status, body: json };
}

async function createTenant(ctx, suffix) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}`;
  const username = `dono_${unique}`.replace(/[^a-z0-9_]/gi, '').slice(0, 30);
  const register = await request(ctx, 'POST', '/api/auth/register', {
    body: {
      nome: 'Dono Teste',
      username,
      email: `auditoria-${unique}@teste.local`,
      password: '123456',
      company: `Empresa Teste ${unique}`,
    },
  });

  assert.equal(register.status, 201);
  assert.equal(register.body.ok, true);
  return {
    token: register.body.token,
    empresaId: register.body.user.empresaId,
  };
}

async function openCash(ctx, token, fundo = 0) {
  const response = await request(ctx, 'POST', '/api/caixas', {
    token,
    body: { operador: 'Dono Teste', fundo },
  });
  assert.equal(response.status, 201);
  return response.body.data;
}

async function createProduct(empresaId, data = {}) {
  return prisma.produto.create({
    data: {
      sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      nome: data.nome || 'Produto Teste',
      preco: data.preco ?? 40,
      custo: data.custo ?? 10,
      estoque: data.estoque ?? 10,
      estoqueMin: 0,
      empresaId,
      ...data,
    },
  });
}

describe('PDV dinheiro e fechamento de caixa', () => {
  let ctx;
  let empresaId;
  let token;

  before(async () => {
    ctx = await listen();
    const tenant = await createTenant(ctx, 'dinheiro');
    empresaId = tenant.empresaId;
    token = tenant.token;
  });

  after(async () => {
    if (empresaId) await prisma.empresa.deleteMany({ where: { id: empresaId } });
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  it('registra venda em dinheiro, compoe resumo oficial e fecha caixa com total do backend', async () => {
    const caixa = await openCash(ctx, token, 20);
    const produto = await createProduct(empresaId, { preco: 40, estoque: 10 });

    const venda = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: {
        caixaId: caixa.id,
        metodo: 'dinheiro',
        pagamentos: [{ metodo: 'dinheiro', valor: 80, status: 'confirmado' }],
        itens: [{ id: produto.id, nome: produto.nome, preco: 40, qty: 2, subtotal: 80 }],
        subtotal: 80,
        total: 80,
      },
    });

    assert.equal(venda.status, 201);
    assert.equal(venda.body.ok, true);

    const produtoAtualizado = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(produtoAtualizado.estoque, 8);
    assert.equal(produtoAtualizado.vendas, 2);

    const lancamento = await prisma.lancamento.findFirst({
      where: { empresaId, vendaId: venda.body.data.id, tipo: 'receita' },
    });
    assert.equal(lancamento.status, 'pago');
    assert.equal(money(lancamento.valor), 80);
    assert.equal(lancamento.formaPagamento, 'dinheiro');
    assert.equal(lancamento.caixaId, caixa.id);

    const resumo = await request(ctx, 'GET', `/api/caixas/${caixa.id}/resumo`, { token });
    assert.equal(resumo.status, 200);
    assert.equal(resumo.body.data.vendas.count, 1);
    assert.equal(resumo.body.data.totalVendido, 80);
    assert.equal(resumo.body.data.formas.dinheiro.total, 80);
    assert.equal(resumo.body.data.financeiro.recebido, 80);
    assert.equal(resumo.body.data.dinheiroEsperado, 100);

    const fechamento = await request(ctx, 'PUT', `/api/caixas/${caixa.id}`, {
      token,
      body: { aberto: false },
    });
    assert.equal(fechamento.status, 200);
    assert.equal(fechamento.body.data.aberto, false);
    assert.equal(fechamento.body.data.totalVendas, 80);
    assert.equal(fechamento.body.data.resumo.totalVendido, 80);
  });
});

describe('PDV estorno', () => {
  let ctx;
  let empresaId;
  let token;

  before(async () => {
    ctx = await listen();
    const tenant = await createTenant(ctx, 'estorno');
    empresaId = tenant.empresaId;
    token = tenant.token;
  });

  after(async () => {
    if (empresaId) await prisma.empresa.deleteMany({ where: { id: empresaId } });
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  it('devolve estoque e marca lancamento como estornado', async () => {
    const caixa = await openCash(ctx, token);
    const produto = await createProduct(empresaId, { preco: 30, estoque: 5 });

    const venda = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: {
        caixaId: caixa.id,
        metodo: 'dinheiro',
        pagamentos: [{ metodo: 'dinheiro', valor: 60, status: 'confirmado' }],
        itens: [{ id: produto.id, nome: produto.nome, preco: 30, qty: 2, subtotal: 60 }],
        subtotal: 60,
        total: 60,
      },
    });
    assert.equal(venda.status, 201);

    let produtoAtualizado = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(produtoAtualizado.estoque, 3);

    const estorno = await request(ctx, 'PUT', `/api/vendas/${venda.body.data.id}`, {
      token,
      body: { status: 'estornada', estornoMotivo: 'Teste automatizado' },
    });
    assert.equal(estorno.status, 200);
    assert.equal(estorno.body.data.status, 'estornada');

    produtoAtualizado = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(produtoAtualizado.estoque, 5);

    const lancamento = await prisma.lancamento.findFirst({
      where: { empresaId, vendaId: venda.body.data.id, tipo: 'receita' },
    });
    assert.equal(lancamento.status, 'estornado');
    assert.equal(lancamento.obs, 'Teste automatizado');

    const entradaEstorno = await prisma.movimentacao.findFirst({
      where: { empresaId, prodId: produto.id, tipo: 'entrada', motivo: { contains: venda.body.data.id } },
    });
    assert.ok(entradaEstorno);
    assert.equal(entradaEstorno.qty, 2);
  });
});

describe('PDV estoque insuficiente', () => {
  let ctx;
  let empresaId;
  let token;

  before(async () => {
    ctx = await listen();
    const tenant = await createTenant(ctx, 'estoque');
    empresaId = tenant.empresaId;
    token = tenant.token;
  });

  after(async () => {
    if (empresaId) await prisma.empresa.deleteMany({ where: { id: empresaId } });
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  it('bloqueia venda quando produto controlado nao tem estoque suficiente', async () => {
    const caixa = await openCash(ctx, token);
    const produto = await createProduct(empresaId, { preco: 25, estoque: 1 });

    const venda = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: {
        caixaId: caixa.id,
        metodo: 'dinheiro',
        pagamentos: [{ metodo: 'dinheiro', valor: 50, status: 'confirmado' }],
        itens: [{ id: produto.id, nome: produto.nome, preco: 25, qty: 2, subtotal: 50 }],
        subtotal: 50,
        total: 50,
      },
    });

    assert.equal(venda.status, 400);
    assert.match(venda.body.message, /Estoque insuficiente/i);

    const produtoAtualizado = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(produtoAtualizado.estoque, 1);
    assert.equal(produtoAtualizado.vendas, 0);

    const vendas = await prisma.venda.count({ where: { empresaId } });
    const lancamentos = await prisma.lancamento.count({ where: { empresaId } });
    const movimentacoes = await prisma.movimentacao.count({ where: { empresaId } });
    assert.equal(vendas, 0);
    assert.equal(lancamentos, 0);
    assert.equal(movimentacoes, 0);
  });
});

describe('PDV cartao', () => {
  let ctx;
  let empresaId;
  let token;

  before(async () => {
    ctx = await listen();
    const tenant = await createTenant(ctx, 'cartao');
    empresaId = tenant.empresaId;
    token = tenant.token;
  });

  after(async () => {
    if (empresaId) await prisma.empresa.deleteMany({ where: { id: empresaId } });
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  it('gera recebiveis de credito parcelado com taxa e liquido previsto', async () => {
    const caixa = await openCash(ctx, token);

    const venda = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: {
        caixaId: caixa.id,
        metodo: 'credito',
        pagamentos: [{
          metodo: 'credito',
          valor: 100,
          status: 'confirmado',
          parcelas: 2,
          taxaPercentual: 4,
          prazoPrimeiraParcelaDias: 1,
          intervaloParcelasDias: 30,
          bandeira: 'visa',
          adquirente: 'testepay',
        }],
        itens: [],
        subtotal: 100,
        total: 100,
      },
    });

    assert.equal(venda.status, 201);

    const lancamentos = await prisma.lancamento.findMany({
      where: { empresaId, vendaId: venda.body.data.id, formaPagamento: 'cartao_credito' },
      orderBy: { parcelaNumero: 'asc' },
    });
    assert.equal(lancamentos.length, 2);

    for (const [index, lancamento] of lancamentos.entries()) {
      assert.equal(lancamento.status, 'avencer');
      assert.equal(lancamento.parcelasCartao, 2);
      assert.equal(lancamento.parcelaNumero, index + 1);
      assert.equal(money(lancamento.valor), 50);
      assert.equal(money(lancamento.valorBruto), 50);
      assert.equal(money(lancamento.taxaPercentual), 4);
      assert.equal(money(lancamento.valorTaxa), 2);
      assert.equal(money(lancamento.valorLiquidoPrevisto), 48);
      assert.equal(lancamento.caixaId, caixa.id);
    }
  });

  it('permite receber e conciliar recebivel de cartao no financeiro', async () => {
    const caixa = await openCash(ctx, token);

    const venda = await request(ctx, 'POST', '/api/vendas', {
      token,
      body: {
        caixaId: caixa.id,
        metodo: 'debito',
        pagamentos: [{
          metodo: 'debito',
          valor: 80,
          status: 'confirmado',
          taxaPercentual: 2.5,
          prazoPrimeiraParcelaDias: 1,
        }],
        itens: [],
        subtotal: 80,
        total: 80,
      },
    });
    assert.equal(venda.status, 201);

    const lancamento = await prisma.lancamento.findFirst({
      where: { empresaId, vendaId: venda.body.data.id, formaPagamento: 'cartao_debito' },
    });
    assert.equal(lancamento.status, 'avencer');
    assert.equal(money(lancamento.valorBruto), 80);
    assert.equal(money(lancamento.valorTaxa), 2);
    assert.equal(money(lancamento.valorLiquidoPrevisto), 78);

    const hoje = new Date().toISOString().slice(0, 10);
    const recebido = await request(ctx, 'PUT', `/api/financeiro/${lancamento.id}`, {
      token,
      body: { status: 'recebido', recebidoEm: hoje, pagoEm: hoje },
    });
    assert.equal(recebido.status, 200);
    assert.equal(recebido.body.data.status, 'recebido');

    const conciliado = await request(ctx, 'PUT', `/api/financeiro/${lancamento.id}`, {
      token,
      body: { status: 'conciliado', conciliadoEm: hoje },
    });
    assert.equal(conciliado.status, 200);
    assert.equal(conciliado.body.data.status, 'conciliado');
    assert.equal(conciliado.body.data.conciliadoEm, hoje);
  });
});

describe('PDV Pix', () => {
  let ctx;
  let empresaId;
  let token;

  before(async () => {
    ctx = await listen();
    const tenant = await createTenant(ctx, 'pix');
    empresaId = tenant.empresaId;
    token = tenant.token;

    await prisma.integracaoPagamento.create({
      data: {
        tipo: 'pix',
        provedor: 'mercadopago',
        ambiente: 'sandbox',
        status: 'conectado',
        ativo: true,
        empresaId,
      },
    });
  });

  after(async () => {
    if (empresaId) await prisma.empresa.deleteMany({ where: { id: empresaId } });
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  async function createPixCharge(status, valor = 45) {
    return prisma.pixCobranca.create({
      data: {
        provedor: 'mercadopago',
        referencia: `PIX-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        providerResourceId: `ORD-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status,
        valor,
        empresaId,
      },
    });
  }

  async function sellWithCharge(charge, valor = 45) {
    const caixa = await openCash(ctx, token);
    return request(ctx, 'POST', '/api/vendas', {
      token,
      body: {
        caixaId: caixa.id,
        metodo: 'pix',
        pagamentos: [{
          metodo: 'pix',
          valor,
          status: 'confirmado',
          cobrancaId: charge.id,
        }],
        itens: [],
        subtotal: valor,
        total: valor,
      },
    });
  }

  it('aceita venda Pix somente com cobranca confirmada e vincula a cobranca', async () => {
    const charge = await createPixCharge('pago');
    const venda = await sellWithCharge(charge);

    assert.equal(venda.status, 201);
    const atualizada = await prisma.pixCobranca.findUnique({ where: { id: charge.id } });
    assert.equal(atualizada.vendaId, venda.body.data.id);
  });

  it('bloqueia venda Pix com cobranca pendente', async () => {
    const charge = await createPixCharge('pendente');
    const venda = await sellWithCharge(charge);

    assert.equal(venda.status, 409);
    assert.match(venda.body.message, /PIX ainda nao foi confirmada/i);
  });

  it('bloqueia venda Pix com cobranca expirada', async () => {
    const charge = await createPixCharge('expirado');
    const venda = await sellWithCharge(charge);

    assert.equal(venda.status, 409);
    assert.match(venda.body.message, /PIX ainda nao foi confirmada/i);
  });
});

describe('Dashboard e resumos financeiros', () => {
  let ctx;
  let empresaId;
  let token;

  before(async () => {
    ctx = await listen();
    const tenant = await createTenant(ctx, 'resumos');
    empresaId = tenant.empresaId;
    token = tenant.token;
  });

  after(async () => {
    if (empresaId) await prisma.empresa.deleteMany({ where: { id: empresaId } });
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  it('considera pago, recebido e conciliado como realizados no resumo financeiro', async () => {
    await prisma.lancamento.createMany({
      data: [
        { tipo: 'receita', descricao: 'Pago', valor: 100, status: 'pago', empresaId },
        { tipo: 'receita', descricao: 'Recebido', valor: 80, status: 'recebido', empresaId },
        { tipo: 'receita', descricao: 'Conciliado', valor: 70, status: 'conciliado', empresaId },
        { tipo: 'receita', descricao: 'Aberto', valor: 999, status: 'avencer', empresaId },
        { tipo: 'despesa', descricao: 'Despesa paga', valor: 40, status: 'pago', empresaId },
        { tipo: 'despesa', descricao: 'Despesa aberta', valor: 999, status: 'avencer', empresaId },
      ],
    });

    const resumo = await request(ctx, 'GET', '/api/financeiro/resumo', { token });
    assert.equal(resumo.status, 200);
    assert.equal(resumo.body.data.receitas, 250);
    assert.equal(resumo.body.data.despesas, 40);
    assert.equal(resumo.body.data.saldo, 210);
  });
});

describe('Pedidos faturado e cancelado', () => {
  let ctx;
  let empresaId;
  let token;

  before(async () => {
    ctx = await listen();
    const tenant = await createTenant(ctx, 'pedidos');
    empresaId = tenant.empresaId;
    token = tenant.token;
  });

  after(async () => {
    if (empresaId) await prisma.empresa.deleteMany({ where: { id: empresaId } });
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  it('fatura pedido, baixa estoque, cria venda/lancamento e cancela revertendo tudo', async () => {
    const produto = await createProduct(empresaId, { preco: 35, estoque: 4 });
    const pedidoCriado = await request(ctx, 'POST', '/api/pedidos', {
      token,
      body: {
        cliente: 'Cliente Pedido',
        itens: [{ id: produto.id, nome: produto.nome, preco: 35, qty: 2, subtotal: 70 }],
        subtotal: 70,
        total: 70,
        forma: 'boleto',
        condicao: 'prazo',
      },
    });
    assert.equal(pedidoCriado.status, 201);

    const faturado = await request(ctx, 'PUT', `/api/pedidos/${pedidoCriado.body.data.id}`, {
      token,
      body: { status: 'faturado' },
    });
    assert.equal(faturado.status, 200);
    assert.equal(faturado.body.data.status, 'faturado');

    let produtoAtualizado = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(produtoAtualizado.estoque, 2);
    assert.equal(produtoAtualizado.vendas, 2);

    const venda = await prisma.venda.findFirst({ where: { empresaId, pedidoId: pedidoCriado.body.data.id } });
    assert.ok(venda);
    assert.equal(venda.status, 'faturada');

    let lancamento = await prisma.lancamento.findFirst({ where: { empresaId, pedidoId: pedidoCriado.body.data.id } });
    assert.equal(lancamento.status, 'avencer');
    assert.equal(money(lancamento.valor), 70);

    const cancelado = await request(ctx, 'DELETE', `/api/pedidos/${pedidoCriado.body.data.id}`, { token });
    assert.equal(cancelado.status, 200);

    const pedidoFinal = await prisma.pedido.findUnique({ where: { id: pedidoCriado.body.data.id } });
    assert.equal(pedidoFinal.status, 'cancelado');

    produtoAtualizado = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(produtoAtualizado.estoque, 4);
    assert.equal(produtoAtualizado.vendas, 0);

    const vendaFinal = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaFinal.status, 'cancelada');

    lancamento = await prisma.lancamento.findUnique({ where: { id: lancamento.id } });
    assert.equal(lancamento.status, 'estornado');
  });
});

describe('Permissoes por usuario', () => {
  let ctx;
  let empresaId;
  let donoToken;
  let subToken;

  before(async () => {
    ctx = await listen();
    const tenant = await createTenant(ctx, 'permissoes');
    empresaId = tenant.empresaId;
    donoToken = tenant.token;

    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sub = await request(ctx, 'POST', '/api/usuarios', {
      token: donoToken,
      body: {
        nome: 'Sub Usuario',
        username: `sub_${unique}`.replace(/[^a-z0-9_]/gi, '').slice(0, 30),
        email: `sub-${unique}@teste.local`,
        password: '123456',
        permissions: { produtos: true, financeiro: false },
      },
    });
    assert.equal(sub.status, 201);

    const login = await request(ctx, 'POST', '/api/auth/login', {
      body: { identifier: sub.body.data.email, password: '123456' },
    });
    assert.equal(login.status, 200);
    subToken = login.body.token;
  });

  after(async () => {
    if (empresaId) await prisma.empresa.deleteMany({ where: { id: empresaId } });
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  it('bloqueia modulo sem permissao e permite modulo liberado', async () => {
    const financeiro = await request(ctx, 'GET', '/api/financeiro', { token: subToken });
    assert.equal(financeiro.status, 403);

    const produtos = await request(ctx, 'GET', '/api/produtos', { token: subToken });
    assert.equal(produtos.status, 200);
  });
});

describe('Webhook Mercado Pago', () => {
  let ctx;
  let empresaId;

  before(async () => {
    ctx = await listen();
    empresaId = (await prisma.empresa.create({ data: { nome: `Empresa Webhook ${Date.now()}` } })).id;
  });

  after(async () => {
    if (empresaId) await prisma.empresa.deleteMany({ where: { id: empresaId } });
    await prisma.$disconnect();
    if (ctx?.server) await close(ctx.server);
  });

  it('recusa evento sem assinatura quando integracao ativa possui webhook secret', async () => {
    const integration = await prisma.integracaoPagamento.create({
      data: {
        tipo: 'pix',
        provedor: 'mercadopago',
        ambiente: 'sandbox',
        status: 'conectado',
        ativo: true,
        credenciaisCriptografadas: encryptCredentials({
          accessToken: 'fake-access-token',
          webhookSecret: 'secret-webhook-test',
        }),
        empresaId,
      },
    });

    const response = await request(ctx, 'POST', `/api/webhooks/mercadopago/${integration.id}?data.id=123456`, {
      body: { type: 'payment', data: { id: '123456' } },
    });

    assert.equal(response.status, 401);
  });

  it('nao rebaixa status consolidado em evento atrasado ou repetido', () => {
    const pago = { status: 'pago', pagoEm: new Date('2026-06-28T12:00:00Z') };
    const atrasado = webhookRoutes._test.nextChargeData(pago, 'pendente', {
      providerPaymentId: 'pay-old',
      pagoEm: null,
      erro: null,
    });

    assert.equal(atrasado.status, 'pago');
    assert.equal(atrasado.pagoEm, pago.pagoEm);

    const repetido = webhookRoutes._test.nextChargeData(pago, 'pago', {
      providerPaymentId: 'pay-repeat',
      pagoEm: new Date('2026-06-28T12:05:00Z'),
      erro: null,
    });
    assert.equal(repetido.status, 'pago');
    assert.equal(repetido.pagoEm, pago.pagoEm);

    assert.equal(webhookRoutes._test.shouldApplyStatus('pendente', 'pago'), true);
    assert.equal(webhookRoutes._test.shouldApplyStatus('pago', 'pendente'), false);
  });
});
