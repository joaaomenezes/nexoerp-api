ALTER TABLE "lancamentos"
ADD COLUMN "caixaId" TEXT,
ADD COLUMN "operadorId" TEXT,
ADD COLUMN "bandeiraCartao" TEXT,
ADD COLUMN "adquirenteCartao" TEXT,
ADD COLUMN "terminalId" TEXT,
ADD COLUMN "parcelasCartao" INTEGER,
ADD COLUMN "parcelaNumero" INTEGER,
ADD COLUMN "valorBruto" DOUBLE PRECISION,
ADD COLUMN "taxaPercentual" DOUBLE PRECISION,
ADD COLUMN "valorTaxa" DOUBLE PRECISION,
ADD COLUMN "valorLiquidoPrevisto" DOUBLE PRECISION,
ADD COLUMN "recebidoEm" TEXT,
ADD COLUMN "conciliadoEm" TEXT;
