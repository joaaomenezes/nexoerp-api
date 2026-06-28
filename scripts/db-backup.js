const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findPostgresCommand, loadEnv, requireDatabaseUrl, root, safeTimestamp } = require('./db-env');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  console.error(`[backup] ${message}`);
  process.exit(1);
}

const envName = argValue('--env', '.env.backup');
const outDir = path.resolve(root, argValue('--out', 'backups'));
const { envPath, env } = loadEnv(envName);
const databaseUrl = requireDatabaseUrl(env, envName);
const pgDump = findPostgresCommand('pg_dump');
if (!pgDump) fail('pg_dump nao encontrado. Instale PostgreSQL client tools antes de executar backup/restore.');

fs.mkdirSync(outDir, { recursive: true });

const output = path.join(outDir, `nexoerp-${safeTimestamp()}.dump`);
const result = spawnSync(pgDump, [
  '--format=custom',
  '--no-owner',
  '--no-privileges',
  '--file',
  output,
  databaseUrl,
], { stdio: 'inherit' });

if (result.status !== 0) fail(`pg_dump falhou usando ${path.basename(envPath)}.`);
console.log(`[backup] Gerado: ${output}`);
