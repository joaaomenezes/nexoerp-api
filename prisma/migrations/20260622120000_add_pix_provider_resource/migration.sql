ALTER TABLE "pix_cobrancas"
ADD COLUMN "providerResourceId" TEXT;

CREATE UNIQUE INDEX "pix_cobrancas_provedor_providerResourceId_key"
ON "pix_cobrancas"("provedor", "providerResourceId");
