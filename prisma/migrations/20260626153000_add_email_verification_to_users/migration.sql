ALTER TABLE "usuarios"
ADD COLUMN "emailVerificado" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "emailVerificadoEm" TIMESTAMP(3),
ADD COLUMN "emailVerificationTokenHash" TEXT,
ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3);

CREATE INDEX "usuarios_emailVerificationTokenHash_idx"
ON "usuarios"("emailVerificationTokenHash");
