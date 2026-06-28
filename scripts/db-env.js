const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const output = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }

  return output;
}

function resolveEnvPath(name) {
  if (!name) return path.join(root, '.env');
  return path.resolve(root, name);
}

function loadEnv(name) {
  const envPath = resolveEnvPath(name);
  const env = parseEnvFile(envPath);
  return { envPath, env };
}

function requireDatabaseUrl(env, label) {
  if (!env.DATABASE_URL || /COLE_A_CONNECTION_STRING|USER:PASSWORD|HOST\/DATABASE/.test(env.DATABASE_URL)) {
    throw new Error(`Configure DATABASE_URL em ${label}.`);
  }
  return env.DATABASE_URL;
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function commandLookupProgram() {
  return process.platform === 'win32' ? 'where' : 'which';
}

function commandExists(command) {
  const result = spawnSync(commandLookupProgram(), [command], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || command;
}

function findPostgresCommand(command) {
  const fromPath = commandExists(command);
  if (fromPath) return fromPath;

  if (process.platform !== 'win32') return null;

  const roots = [
    'C:\\Program Files\\PostgreSQL',
    'C:\\Program Files (x86)\\PostgreSQL',
  ];
  const candidates = [];

  for (const pgRoot of roots) {
    if (!fs.existsSync(pgRoot)) continue;
    for (const entry of fs.readdirSync(pgRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(pgRoot, entry.name, 'bin', `${command}.exe`));
      candidates.push(path.join(pgRoot, entry.name, 'pgAdmin 4', 'runtime', `${command}.exe`));
    }
  }

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

module.exports = {
  findPostgresCommand,
  loadEnv,
  parseEnvFile,
  requireDatabaseUrl,
  root,
  safeTimestamp,
};
