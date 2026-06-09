-- Add a direct reference from pedido-originated sales to the source pedido.
ALTER TABLE "vendas" ADD COLUMN "pedidoId" TEXT;

UPDATE "vendas" AS v
SET "pedidoId" = l."pedidoId"
FROM "lancamentos" AS l
WHERE l."vendaId" = v."id"
  AND l."pedidoId" IS NOT NULL
  AND v."pedidoId" IS NULL;

-- Keep historical pedido sales aligned with the pedido final state.
UPDATE "vendas" AS v
SET "status" = 'cancelada'
FROM "pedidos" AS p
WHERE v."pedidoId" = p."id"
  AND v."tipo" = 'pedido'
  AND p."status" = 'cancelado'
  AND v."status" = 'estornada';

UPDATE "vendas" AS v
SET "status" = 'estornada'
FROM "pedidos" AS p
WHERE v."pedidoId" = p."id"
  AND v."tipo" = 'pedido'
  AND p."status" = 'estornado'
  AND v."status" = 'cancelada';
