const { PrismaClient } = require('@prisma/client');
const { loadEnv, requireDatabaseUrl } = require('./db-env');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const envName = argValue('--env', '.env.restore');
  const { env } = loadEnv(envName);
  process.env.DATABASE_URL = requireDatabaseUrl(env, envName);

  const prisma = new PrismaClient();
  const requiredTables = [
    'empresas',
    'usuarios',
    'produtos',
    'clientes',
    'vendas',
    'lancamentos',
    'caixas',
    'pix_cobrancas',
    '_prisma_migrations',
  ];

  const tables = await prisma.$queryRaw`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
  `;
  const tableNames = new Set(tables.map(row => row.table_name));
  const missing = requiredTables.filter(name => !tableNames.has(name));
  if (missing.length) throw new Error(`Tabelas ausentes: ${missing.join(', ')}`);

  const counts = {};
  for (const table of ['empresas', 'usuarios', 'produtos', 'clientes', 'vendas', 'lancamentos']) {
    const result = await prisma.$queryRawUnsafe(`select count(*)::int as count from "${table}"`);
    counts[table] = result[0].count;
  }

  console.log('[validate] Banco acessivel e tabelas essenciais presentes.');
  console.table(counts);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[validate]', err.message);
  process.exit(1);
});
