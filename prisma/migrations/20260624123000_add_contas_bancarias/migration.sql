CREATE TABLE "contas_bancarias" (
  "id" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "banco" TEXT,
  "agencia" TEXT,
  "conta" TEXT,
  "tipo" TEXT NOT NULL DEFAULT 'corrente',
  "chavePix" TEXT,
  "saldoInicial" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "principal" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ativa',
  "observacoes" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  "empresaId" TEXT NOT NULL,

  CONSTRAINT "contas_bancarias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contas_bancarias_empresaId_status_idx" ON "contas_bancarias"("empresaId", "status");

ALTER TABLE "contas_bancarias"
ADD CONSTRAINT "contas_bancarias_empresaId_fkey"
FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
