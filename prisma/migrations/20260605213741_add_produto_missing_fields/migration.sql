-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "cest" TEXT,
ADD COLUMN     "dataFabricacao" TEXT,
ADD COLUMN     "dataVencimento" TEXT,
ADD COLUMN     "descMax" DOUBLE PRECISION,
ADD COLUMN     "icms" TEXT,
ADD COLUMN     "lote" TEXT,
ADD COLUMN     "perecivel" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pis" TEXT,
ADD COLUMN     "posicao" TEXT,
ADD COLUMN     "prazo" INTEGER,
ADD COLUMN     "precoMin" DOUBLE PRECISION,
ADD COLUMN     "tabela" TEXT,
ADD COLUMN     "vendaSemEstoque" BOOLEAN NOT NULL DEFAULT false;
