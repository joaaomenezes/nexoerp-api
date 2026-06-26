ALTER TABLE "vendas"
ADD COLUMN "caixaId" TEXT;

CREATE INDEX "vendas_empresaId_caixaId_idx"
ON "vendas"("empresaId", "caixaId");

ALTER TABLE "vendas"
ADD CONSTRAINT "vendas_caixaId_fkey"
FOREIGN KEY ("caixaId") REFERENCES "caixas"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
