-- CreateTable
CREATE TABLE "fornecedores" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'pj',
    "doc" TEXT,
    "rg" TEXT,
    "nascimento" TEXT,
    "genero" TEXT,
    "tel" TEXT,
    "tel2" TEXT,
    "email" TEXT,
    "site" TEXT,
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "pais" TEXT DEFAULT 'Brasil',
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "pedidos" INTEGER NOT NULL DEFAULT 0,
    "limite" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "desconto" TEXT,
    "condicao" TEXT,
    "grupo" TEXT,
    "origem" TEXT,
    "tags" TEXT,
    "obs" TEXT,
    "cadastro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
