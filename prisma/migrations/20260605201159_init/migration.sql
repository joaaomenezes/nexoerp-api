-- CreateTable
CREATE TABLE "empresas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "segmento" TEXT,
    "plano" TEXT NOT NULL DEFAULT 'free',
    "telefone" TEXT,
    "cidade" TEXT,
    "funcionarios" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isDono" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cat" TEXT,
    "marca" TEXT,
    "unidade" TEXT NOT NULL DEFAULT 'un',
    "descricao" TEXT,
    "preco" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "custo" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estoque" INTEGER NOT NULL DEFAULT 0,
    "estoqueMin" INTEGER NOT NULL DEFAULT 0,
    "estoqueMax" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "emoji" TEXT NOT NULL DEFAULT '📦',
    "cor" TEXT NOT NULL DEFAULT '#00c896',
    "vendas" INTEGER NOT NULL DEFAULT 0,
    "destaque" BOOLEAN NOT NULL DEFAULT false,
    "exibirPdv" BOOLEAN NOT NULL DEFAULT true,
    "controlEstoque" BOOLEAN NOT NULL DEFAULT true,
    "deposito" TEXT,
    "fornecedor" TEXT,
    "ean" TEXT,
    "ncm" TEXT,
    "cfop" TEXT,
    "cst" TEXT,
    "imagem" TEXT,
    "ultimaEntrada" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'pf',
    "secao" TEXT NOT NULL DEFAULT 'clientes',
    "cpfCnpj" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "compras" INTEGER NOT NULL DEFAULT 0,
    "pedidos" INTEGER NOT NULL DEFAULT 0,
    "limite" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "desconto" TEXT,
    "condicao" TEXT,
    "obs" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'orcamento',
    "cliente" TEXT,
    "clienteId" TEXT,
    "vendedor" TEXT,
    "vendedorId" TEXT,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "desconto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "forma" TEXT,
    "condicao" TEXT,
    "obs" TEXT,
    "dataISO" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataStr" TEXT,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendas" (
    "id" TEXT NOT NULL,
    "cliente" TEXT,
    "clienteId" TEXT,
    "operador" TEXT,
    "operadorId" TEXT,
    "metodo" TEXT,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "desconto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'concluida',
    "tipo" TEXT NOT NULL DEFAULT 'pdv',
    "estornoMotivo" TEXT,
    "dataISO" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataStr" TEXT,
    "horaStr" TEXT,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "vendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamentos" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "vencimento" TEXT,
    "categoria" TEXT,
    "parte" TEXT,
    "status" TEXT NOT NULL DEFAULT 'avencer',
    "obs" TEXT,
    "pagoEm" TEXT,
    "formaPagamento" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "prodId" TEXT,
    "produto" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "deposito" TEXT,
    "destino" TEXT,
    "motivo" TEXT,
    "operador" TEXT,
    "dataISO" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "movimentacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depositos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT,
    "endereco" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "depositos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caixas" (
    "id" TEXT NOT NULL,
    "aberto" BOOLEAN NOT NULL DEFAULT false,
    "operador" TEXT,
    "operadorId" TEXT,
    "fundo" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "abertura" TIMESTAMP(3),
    "aberturaStr" TEXT,
    "fechamento" TIMESTAMP(3),
    "totalVendas" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sangrias" JSONB,
    "suprimentos" JSONB,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "caixas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custos" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria" TEXT,
    "valor" DOUBLE PRECISION NOT NULL,
    "data" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "custos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_empresaId_key" ON "usuarios"("email", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_empresaId_key" ON "usuarios"("username", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "produtos_sku_empresaId_key" ON "produtos"("sku", "empresaId");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depositos" ADD CONSTRAINT "depositos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custos" ADD CONSTRAINT "custos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
