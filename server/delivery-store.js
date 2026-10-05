import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizeEmail } from '../delivery-client.js';
import { renderGiftEmail } from '../email-template.js';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const digestToken = token => createHash('sha256').update(token).digest('hex');
export class DeliveryError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function validatePdf(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString() !== '%PDF-') throw new DeliveryError('INVALID_PDF');
  return bytes;
}

export class DeliveryStore {
  constructor(root, sender) {
    this.root = path.resolve(root);
    this.sender = sender;
  }
  directory(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new DeliveryError('UNAUTHORIZED', 401);
    return path.join(this.root, id);
  }
  async authorize(id, token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DeliveryError('UNAUTHORIZED', 401);
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(this.directory(id), 'manifest.json'), 'utf8')); }
    catch { throw new DeliveryError('UNAUTHORIZED', 401); }
    const expected = Buffer.from(manifest.tokenHash ?? '', 'hex');
    const actual = Buffer.from(digestToken(token), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new DeliveryError('UNAUTHORIZED', 401);
    if (manifest.revoked === true) throw new DeliveryError('REVOKED', 410);
    return manifest;
  }
  async state(directory) {
    try { return JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new DeliveryError('UNAVAILABLE', 503); }
  }
  async saveState(directory, state) {
    const temporary = path.join(directory, 'state.next.json');
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, path.join(directory, 'state.json'));
  }
  async status(id, token) {
    const manifest = await this.authorize(id, token);
    const state = await this.state(this.directory(id));
    return { status: state?.status ?? (this.sender ? 'ready' : 'not_configured'), recipient: state ? maskEmail(state.email) : null, preview: renderGiftEmail(manifest.email) };
  }
  async send(id, token, input) {
    const manifest = await this.authorize(id, token);
    let email, confirmEmail;
    try { email = normalizeEmail(input?.email); confirmEmail = normalizeEmail(input?.confirmEmail); }
    catch { throw new DeliveryError('INVALID_EMAIL'); }
    if (email !== confirmEmail) throw new DeliveryError('EMAIL_MISMATCH');
    const directory = this.directory(id);
    let lock;
    try { lock = await open(path.join(directory, 'send.lock'), 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new DeliveryError('IN_PROGRESS', 409); throw new DeliveryError('UNAVAILABLE', 503); }
    try {
      const previous = await this.state(directory);
      if (previous) {
        if (previous.email !== email) throw new DeliveryError('RECIPIENT_LOCKED', 409);
        if (previous.status === 'sent') return { status: 'sent', recipient: maskEmail(email) };
        // SMTP has no dependable idempotency API. Never retry uncertain sends automatically.
        throw new DeliveryError('DELIVERY_UNCERTAIN', 409);
      }
      const pdf = validatePdf(await readFile(path.join(directory, 'gift.pdf')));
      const emailContent = renderGiftEmail(manifest.email);
      if (!this.sender) throw new DeliveryError('NOT_CONFIGURED', 503);
      await this.saveState(directory, { status: 'sending', email, startedAt: new Date().toISOString() });
      try {
        const result = await this.sender({ ...emailContent, to: email, pdf, messageId: `<gift-${id}@gift-bureau.local>` });
        if (!result?.accepted) throw new Error('Not accepted');
      } catch {
        await this.saveState(directory, { status: 'uncertain', email });
        throw new DeliveryError('DELIVERY_UNCERTAIN', 502);
      }
      await this.saveState(directory, { status: 'sent', email, sentAt: new Date().toISOString() });
      return { status: 'sent', recipient: maskEmail(email) };
    } finally {
      await lock.close();
      await unlink(path.join(directory, 'send.lock'));
    }
  }
}
