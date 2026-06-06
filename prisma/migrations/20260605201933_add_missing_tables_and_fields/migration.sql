/*
  Warnings:

  - You are about to drop the column `cpfCnpj` on the `clientes` table. All the data in the column will be lost.
  - You are about to drop the column `telefone` on the `clientes` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "clientes" DROP COLUMN "cpfCnpj",
DROP COLUMN "telefone",
ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cadastro" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "doc" TEXT,
ADD COLUMN     "genero" TEXT,
ADD COLUMN     "grupo" TEXT,
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "nascimento" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "origem" TEXT,
ADD COLUMN     "pais" TEXT DEFAULT 'Brasil',
ADD COLUMN     "rg" TEXT,
ADD COLUMN     "site" TEXT,
ADD COLUMN     "tags" TEXT,
ADD COLUMN     "tel" TEXT,
ADD COLUMN     "tel2" TEXT,
ADD COLUMN     "vendedor" TEXT,
ADD COLUMN     "vendedorId" TEXT;

-- CreateTable
CREATE TABLE "vendedores" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'pf',
    "doc" TEXT,
    "tel" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "cadastro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "vendedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias_financeiras" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "categorias_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrinhos_suspensos" (
    "id" TEXT NOT NULL,
    "nome" TEXT,
    "itens" JSONB NOT NULL DEFAULT '[]',
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "carrinhos_suspensos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_relatorios" (
    "id" TEXT NOT NULL,
    "relatorioId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "periodo" TEXT,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "historico_relatorios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes" (
    "id" TEXT NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "configuracoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes_pdv" (
    "id" TEXT NOT NULL,
    "pixTipoChave" TEXT NOT NULL DEFAULT 'aleatoria',
    "pixChave" TEXT,
    "pixBeneficiario" TEXT,
    "pixCidade" TEXT,
    "terminalOperadora" TEXT NOT NULL DEFAULT 'demo',
    "terminalId" TEXT,
    "jurosAPartirDe" INTEGER NOT NULL DEFAULT 4,
    "maxParcelas" INTEGER NOT NULL DEFAULT 12,
    "taxaJurosMensal" DOUBLE PRECISION NOT NULL DEFAULT 0.0299,
    "exigirFundo" BOOLEAN NOT NULL DEFAULT false,
    "exigirOperador" BOOLEAN NOT NULL DEFAULT false,
    "overtimeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "overtimeHours" INTEGER NOT NULL DEFAULT 8,
    "notasRapidas" JSONB NOT NULL DEFAULT '[10,20,50,100,200]',
    "lojaNome" TEXT,
    "lojaCnpj" TEXT,
    "lojaRodape" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "configuracoes_pdv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogo_config" (
    "id" TEXT NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "catalogo_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_empresaId_key" ON "configuracoes"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_pdv_empresaId_key" ON "configuracoes_pdv"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "catalogo_config_empresaId_key" ON "catalogo_config"("empresaId");

-- AddForeignKey
ALTER TABLE "vendedores" ADD CONSTRAINT "vendedores_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_financeiras" ADD CONSTRAINT "categorias_financeiras_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrinhos_suspensos" ADD CONSTRAINT "carrinhos_suspensos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_relatorios" ADD CONSTRAINT "historico_relatorios_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes" ADD CONSTRAINT "configuracoes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_pdv" ADD CONSTRAINT "configuracoes_pdv_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogo_config" ADD CONSTRAINT "catalogo_config_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
