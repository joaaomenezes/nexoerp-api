const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envTestPath = path.join(root, '.env.test');
const envPath = path.join(root, '.env');

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

function fail(message) {
  console.error(`[test-env] ${message}`);
  process.exit(1);
}

const testEnv = parseEnvFile(envTestPath);
const mainEnv = parseEnvFile(envPath);

if (!testEnv.DATABASE_URL || testEnv.DATABASE_URL.includes('COLE_A_CONNECTION_STRING')) {
  fail('Configure DATABASE_URL no .env.test antes de rodar testes.');
}

if (mainEnv.DATABASE_URL && mainEnv.DATABASE_URL === testEnv.DATABASE_URL) {
  fail('DATABASE_URL do .env.test e igual ao .env principal. Recusando rodar.');
}

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] = value;
}

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.EMAIL_VERIFICATION_REQUIRED = process.env.EMAIL_VERIFICATION_REQUIRED || 'false';
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX || '1000';
process.env.LOGIN_RATE_LIMIT_MAX = process.env.LOGIN_RATE_LIMIT_MAX || '1000';
process.env.REGISTER_RATE_LIMIT_MAX = process.env.REGISTER_RATE_LIMIT_MAX || '1000';

const command = process.argv.slice(2).join(' ');
if (!command) fail('Informe o comando a executar.');

const child = spawn(command, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', code => process.exit(code ?? 1));
child.on('error', err => fail(err.message));
