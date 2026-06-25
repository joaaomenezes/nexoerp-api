ALTER TABLE "integracoes_pagamento"
ADD COLUMN "contaBancariaId" TEXT;

ALTER TABLE "lancamentos"
ADD COLUMN "contaBancariaId" TEXT;
