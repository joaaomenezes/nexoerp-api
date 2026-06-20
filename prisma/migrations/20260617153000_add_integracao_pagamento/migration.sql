CREATE TABLE "integracoes_pagamento" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'pix',
    "provedor" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'desconectado',
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "credenciaisCriptografadas" TEXT,
    "webhookSecret" TEXT,
    "contaExternaId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "integracoes_pagamento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integracoes_pagamento_empresaId_tipo_key"
ON "integracoes_pagamento"("empresaId", "tipo");

ALTER TABLE "integracoes_pagamento"
ADD CONSTRAINT "integracoes_pagamento_empresaId_fkey"
FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
