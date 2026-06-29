const crypto = require('crypto');

function publicAppUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.CORS_ORIGIN || 'http://127.0.0.1:5500')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');
}

function tokenMinutes() {
  const n = Number(process.env.PASSWORD_RESET_TOKEN_MINUTES || 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function createPasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function passwordResetExpiresAt() {
  return new Date(Date.now() + tokenMinutes() * 60 * 1000);
}

function buildPasswordResetUrl(token) {
  return `${publicAppUrl()}/resetar-senha.html?token=${encodeURIComponent(token)}`;
}

async function sendResendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return { sent: false, provider: 'console', reason: 'RESEND_API_KEY ou EMAIL_FROM ausente.' };
  }

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
    const err = new Error(`Falha ao enviar e-mail: ${response.status} ${text}`.slice(0, 500));
    err.status = 502;
    throw err;
  }

  return { sent: true, provider: 'resend' };
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const safeName = name || 'usuario';
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2>Redefinicao de senha</h2>
      <p>Ola, ${safeName}.</p>
      <p>Recebemos uma solicitacao para redefinir sua senha no AzzysERP.</p>
      <p>
        <a href="${resetUrl}" style="display:inline-block;background:#00c896;color:#021c14;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">
          Criar nova senha
        </a>
      </p>
      <p>Este link expira em ${tokenMinutes()} minutos e so pode ser usado uma vez.</p>
      <p>Se o botao nao funcionar, copie e cole este link no navegador:</p>
      <p style="word-break:break-all;color:#374151">${resetUrl}</p>
      <p>Se voce nao solicitou isso, ignore este e-mail.</p>
    </div>`;

  return sendResendEmail({ to, subject: 'Redefinicao de senha', html });
}

async function sendPasswordChangedEmail({ to, name }) {
  const safeName = name || 'usuario';
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2>Senha alterada</h2>
      <p>Ola, ${safeName}.</p>
      <p>Sua senha do AzzysERP foi alterada com sucesso.</p>
      <p>Se voce nao fez essa alteracao, entre em contato com o administrador imediatamente.</p>
    </div>`;

  return sendResendEmail({ to, subject: 'Sua senha foi alterada', html });
}

module.exports = {
  buildPasswordResetUrl,
  createPasswordResetToken,
  hashPasswordResetToken,
  passwordResetExpiresAt,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
};
