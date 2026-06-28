const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findPostgresCommand, loadEnv, parseEnvFile, requireDatabaseUrl, root } = require('./db-env');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  console.error(`[restore] ${message}`);
  process.exit(1);
}

const envName = argValue('--env', '.env.restore');
const file = argValue('--file');
if (!file) fail('Informe o arquivo com --file backups/nexoerp-....dump');

const backupFile = path.resolve(root, file);
if (!fs.existsSync(backupFile)) fail(`Backup nao encontrado: ${backupFile}`);

const { envPath, env } = loadEnv(envName);
const targetUrl = requireDatabaseUrl(env, envName);
const mainUrl = parseEnvFile(path.join(root, '.env')).DATABASE_URL;
const testUrl = parseEnvFile(path.join(root, '.env.test')).DATABASE_URL;

if (mainUrl && targetUrl === mainUrl) {
  fail('DATABASE_URL de restore e igual ao .env principal. Recusando restaurar.');
}
if (testUrl && targetUrl === testUrl) {
  fail('DATABASE_URL de restore e igual ao .env.test. Use um branch/banco restore separado.');
}

const pgRestore = findPostgresCommand('pg_restore');
if (!pgRestore) fail('pg_restore nao encontrado. Instale PostgreSQL client tools antes de executar backup/restore.');

const result = spawnSync(pgRestore, [
  '--clean',
  '--if-exists',
  '--no-owner',
  '--no-privileges',
  '--dbname',
  targetUrl,
  backupFile,
], { stdio: 'inherit' });

if (result.status !== 0) fail(`pg_restore falhou usando ${path.basename(envPath)}.`);
console.log(`[restore] Restaurado em ${path.basename(envPath)} a partir de ${backupFile}`);
