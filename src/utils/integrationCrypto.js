const crypto = require('crypto');

function getEncryptionKey() {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    const err = new Error('Configure INTEGRATION_ENCRYPTION_KEY no servidor com pelo menos 32 caracteres.');
    err.status = 503;
    throw err;
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptCredentials(credentials) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(value => value.toString('base64url')).join('.');
}

function decryptCredentials(value) {
  const [ivEncoded, tagEncoded, encryptedEncoded] = String(value || '').split('.');
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error('Credenciais da integracao invalidas.');

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivEncoded, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

module.exports = { encryptCredentials, decryptCredentials };
