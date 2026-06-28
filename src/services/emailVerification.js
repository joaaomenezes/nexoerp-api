const crypto = require('crypto');

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function emailVerificationRequired() {
  return boolEnv('EMAIL_VERIFICATION_REQUIRED', process.env.NODE_ENV === 'production');
}

function tokenHours() {
  const n = Number(process.env.EMAIL_VERIFICATION_TOKEN_HOURS || 24);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

function createVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashVerificationToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function verificationExpiresAt() {
  return new Date(Date.now() + tokenHours() * 60 * 60 * 1000);
}

function publicAppUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.CORS_ORIGIN || 'http://127.0.0.1:5500')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');
}

function buildVerificationUrl(token) {
  return `${publicAppUrl()}/confirmar-email.html?token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail({ to, name, verificationUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return { sent: false, provider: 'console', reason: 'RESEND_API_KEY ou EMAIL_FROM ausente.' };
  }

  const subject = 'Confirme seu e-mail no AzzysERP';
  const safeName = name || 'usuario';
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2>Confirme seu e-mail</h2>
      <p>Olá, ${safeName}.</p>
      <p>Para ativar sua conta no AzzysERP, clique no botão abaixo:</p>
      <p>
        <a href="${verificationUrl}" style="display:inline-block;background:#00c896;color:#021c14;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">
          Confirmar e-mail
        </a>
      </p>
      <p>Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="word-break:break-all;color:#374151">${verificationUrl}</p>
      <p>Se você não criou esta conta, ignore este e-mail.</p>
    </div>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`Falha ao enviar e-mail de confirmação: ${response.status} ${text}`.slice(0, 500));
    err.status = 502;
    throw err;
  }

  return { sent: true, provider: 'resend' };
}

module.exports = {
  buildVerificationUrl,
  createVerificationToken,
  emailVerificationRequired,
  hashVerificationToken,
  sendVerificationEmail,
  verificationExpiresAt,
};
