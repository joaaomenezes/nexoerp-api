-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "entrega" TEXT,
ADD COLUMN     "obsCliente" TEXT,
ADD COLUMN     "obsInterna" TEXT,
ADD COLUMN     "parcelas" JSONB,
ADD COLUMN     "ref" TEXT,
ADD COLUMN     "validade" TEXT;
