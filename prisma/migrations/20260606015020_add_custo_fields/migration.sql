-- AlterTable
ALTER TABLE "custos" ADD COLUMN     "fornecedor" TEXT,
ADD COLUMN     "obs" TEXT,
ADD COLUMN     "recorrenciaId" TEXT,
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'custo';
