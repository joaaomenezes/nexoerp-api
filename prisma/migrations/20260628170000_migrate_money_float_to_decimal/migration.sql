ALTER TABLE "contas_bancarias"
  ALTER COLUMN "saldoInicial" TYPE DECIMAL(14,2) USING ROUND("saldoInicial"::numeric, 2),
  ALTER COLUMN "saldoInicial" SET DEFAULT 0;

ALTER TABLE "produtos"
  ALTER COLUMN "preco" TYPE DECIMAL(14,2) USING ROUND("preco"::numeric, 2),
  ALTER COLUMN "preco" SET DEFAULT 0,
  ALTER COLUMN "custo" TYPE DECIMAL(14,2) USING ROUND("custo"::numeric, 2),
  ALTER COLUMN "custo" SET DEFAULT 0,
  ALTER COLUMN "precoMin" TYPE DECIMAL(14,2) USING ROUND("precoMin"::numeric, 2);

ALTER TABLE "clientes"
  ALTER COLUMN "limite" TYPE DECIMAL(14,2) USING ROUND("limite"::numeric, 2),
  ALTER COLUMN "limite" SET DEFAULT 0;

ALTER TABLE "fornecedores"
  ALTER COLUMN "limite" TYPE DECIMAL(14,2) USING ROUND("limite"::numeric, 2),
  ALTER COLUMN "limite" SET DEFAULT 0;

ALTER TABLE "pedidos"
  ALTER COLUMN "subtotal" TYPE DECIMAL(14,2) USING ROUND("subtotal"::numeric, 2),
  ALTER COLUMN "subtotal" SET DEFAULT 0,
  ALTER COLUMN "desconto" TYPE DECIMAL(14,2) USING ROUND("desconto"::numeric, 2),
  ALTER COLUMN "desconto" SET DEFAULT 0,
  ALTER COLUMN "total" TYPE DECIMAL(14,2) USING ROUND("total"::numeric, 2),
  ALTER COLUMN "total" SET DEFAULT 0;

ALTER TABLE "vendas"
  ALTER COLUMN "subtotal" TYPE DECIMAL(14,2) USING ROUND("subtotal"::numeric, 2),
  ALTER COLUMN "subtotal" SET DEFAULT 0,
  ALTER COLUMN "desconto" TYPE DECIMAL(14,2) USING ROUND("desconto"::numeric, 2),
  ALTER COLUMN "desconto" SET DEFAULT 0,
  ALTER COLUMN "total" TYPE DECIMAL(14,2) USING ROUND("total"::numeric, 2),
  ALTER COLUMN "total" SET DEFAULT 0;

ALTER TABLE "lancamentos"
  ALTER COLUMN "valor" TYPE DECIMAL(14,2) USING ROUND("valor"::numeric, 2),
  ALTER COLUMN "valorBruto" TYPE DECIMAL(14,2) USING ROUND("valorBruto"::numeric, 2),
  ALTER COLUMN "taxaPercentual" TYPE DECIMAL(7,4) USING ROUND("taxaPercentual"::numeric, 4),
  ALTER COLUMN "valorTaxa" TYPE DECIMAL(14,2) USING ROUND("valorTaxa"::numeric, 2),
  ALTER COLUMN "valorLiquidoPrevisto" TYPE DECIMAL(14,2) USING ROUND("valorLiquidoPrevisto"::numeric, 2);

ALTER TABLE "caixas"
  ALTER COLUMN "fundo" TYPE DECIMAL(14,2) USING ROUND("fundo"::numeric, 2),
  ALTER COLUMN "fundo" SET DEFAULT 0,
  ALTER COLUMN "totalVendas" TYPE DECIMAL(14,2) USING ROUND("totalVendas"::numeric, 2),
  ALTER COLUMN "totalVendas" SET DEFAULT 0;

ALTER TABLE "custos"
  ALTER COLUMN "valor" TYPE DECIMAL(14,2) USING ROUND("valor"::numeric, 2);

ALTER TABLE "carrinhos_suspensos"
  ALTER COLUMN "total" TYPE DECIMAL(14,2) USING ROUND("total"::numeric, 2),
  ALTER COLUMN "total" SET DEFAULT 0;

ALTER TABLE "pix_cobrancas"
  ALTER COLUMN "valor" TYPE DECIMAL(14,2) USING ROUND("valor"::numeric, 2);
