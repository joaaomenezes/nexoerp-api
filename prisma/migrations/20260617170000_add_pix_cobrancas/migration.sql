CREATE TABLE "pix_cobrancas" (
    "id" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "referencia" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'criando',
    "valor" DOUBLE PRECISION NOT NULL,
    "qrCode" TEXT,
    "ticketUrl" TEXT,
    "expiraEm" TIMESTAMP(3),
    "pagoEm" TIMESTAMP(3),
    "endToEndId" TEXT,
    "vendaId" TEXT,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "pix_cobrancas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pix_cobrancas_empresaId_referencia_key"
ON "pix_cobrancas"("empresaId", "referencia");

CREATE UNIQUE INDEX "pix_cobrancas_provedor_providerPaymentId_key"
ON "pix_cobrancas"("provedor", "providerPaymentId");

CREATE INDEX "pix_cobrancas_empresaId_status_idx"
ON "pix_cobrancas"("empresaId", "status");

ALTER TABLE "pix_cobrancas"
ADD CONSTRAINT "pix_cobrancas_empresaId_fkey"
FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
