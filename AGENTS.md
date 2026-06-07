# NexoERP — API (nexoerp-api)

## O que é este projeto
Backend do NexoERP: API REST em Node.js + Express + Prisma + PostgreSQL. Multi-tenant (cada empresa vê só seus dados via JWT). O frontend fica em outro repositório: `sistemy`.

## Como rodar
```bash
cd nexoerp-api
npm install          # só na primeira vez
npx prisma migrate deploy  # só na primeira vez (ou após git pull com novas migrations)
npx prisma generate        # só na primeira vez
npm run dev          # uso diário
```
API sobe em `http://localhost:3333`. Banco no Neon (nuvem) — não precisa instalar PostgreSQL local.

## .env necessário (nunca vai pro GitHub)
```env
DATABASE_URL="postgresql://neondb_owner:...@ep-icy-heart-actqoiqw.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
JWT_SECRET="..."
PORT=3333
```
Pegar os valores com o dono do projeto (João). Os valores são os mesmos em todas as máquinas — mesmo banco Neon compartilhado.

## Stack
- **Runtime:** Node.js 24
- **Framework:** Express
- **ORM:** Prisma
- **Banco:** PostgreSQL na nuvem (Neon, região sa-east-1 São Paulo)
- **Auth:** JWT (jsonwebtoken) + bcryptjs
- **Segurança:** helmet + cors

## Estrutura
```
server.js                  ← entry point
prisma/
  schema.prisma            ← schema completo (fonte da verdade)
  migrations/              ← histórico de migrations versionado
src/
  app.js                   ← Express config (cors, helmet, rotas)
  routes/
    index.js               ← registra todas as rotas em /api
    auth.js                ← /api/auth/login, /register, /me
    produtos.js            ← CRUD produtos + categorias
    clientes.js            ← CRUD clientes e fornecedores
    vendedores.js          ← CRUD vendedores
    pedidos.js             ← fluxo orçamento→concluído com transação de faturamento
    vendas.js              ← histórico PDV+pedidos, estorno
    financeiro.js          ← lançamentos (receitas/despesas)
    custos.js              ← custos operacionais (Centro de Custo)
    estoque.js             ← movimentações, posição, depósitos
    caixas.js              ← abertura/fechamento/sangria/suprimento de caixa
    relatorios.js          ← histórico de relatórios gerados (HistoricoRelatorio)
    usuarios.js            ← CRUD sub-usuários com permissões
    categorias.js          ← CRUD categorias de produtos
  middleware/
    auth.js                ← requireAuth, requirePermission
    errorHandler.js        ← tratamento global de erros
```

## Padrão de rota
```js
// req.auth = { userId, empresaId, isDono, permissions }
// Toda query filtra por empresaId — multi-tenant obrigatório

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const items = await prisma.modelo.findMany({
      where: { empresaId: req.auth.empresaId },
    });
    res.json({ ok: true, data: items });
  } catch (err) {
    next(err);
  }
});
```

## IDs
- Todos os modelos usam CUID gerado pelo Prisma (`@default(cuid())`)
- Exceção: Pedido usa ID customizado `PED-XXXXXX` gerado no POST

## Migrations
Ao mudar o `schema.prisma`:
```bash
npm run db:migrate   # cria nova migration (pede nome)
```
Após `git pull` com novas migrations:
```bash
npx prisma migrate deploy
```

## Modelos principais do schema
- `Empresa` — tenant raiz
- `Usuario` — isDono + permissions (JSON com módulos permitidos)
- `Produto` — estoque, preço, categoria, SKU
- `Categoria` — categorias de produtos
- `Cliente` — clientes e fornecedores (tipo: cliente|fornecedor)
- `Pedido` — ID: PED-XXXXXX, status: orcamento→pendente→aprovado→faturado→concluido→cancelado
- `Venda` — vendas PDV (tipo: pdv) e de pedido (tipo: pedido)
- `Lancamento` — financeiro: receitas e despesas
- `Custo` — Centro de Custo (custos operacionais)
- `Movimentacao` — entradas/saídas/ajustes de estoque
- `Deposito` — depósitos físicos de estoque
- `Caixa` — turno de caixa com sangrias/suprimentos (JSON)
- `HistoricoRelatorio` — log de relatórios gerados pelo módulo de relatórios
- `Vendedor` — vendedores vinculados à empresa

## Regras de negócio críticas
- Faturar pedido (`status → faturado`) dispara transação: decrementa estoque + cria Venda + cria Lancamento
- Cancelar pedido faturado/concluído reverte estoque + estorna lançamento
- Estorno de venda PDV reverte estoque + cancela lançamento
- `qty` de movimentação sempre positivo — direção determinada por `tipo` (entrada/saida/ajuste)
- Caixa: campo `sangrias` é JSON que armazena todos os movimentos do turno

## Credenciais de desenvolvimento
- **E-mail:** `admin@loja.com` / **Senha:** `123456`
- **Empresa:** NexoERP Dev (empresaId: `cmq2pj5le0000q8m4dqunpu9i`)
- Banco Neon: mesmo em todas as máquinas

## Bug pendente
- **Lucro Líquido no Dashboard:** `custos` (tabela Custo) não é carregado no `initDashboard` do frontend. Aguardando contador definir regra antes de implementar.

## Próximos passos de backend
- Paginação nos endpoints de listagem (cursor-based ou offset)
- Endpoint de reset de senha (envio de e-mail)
- Parcelamento de lançamentos (1 → N lançamentos)
- Deploy: Railway conectado a este repositório GitHub
