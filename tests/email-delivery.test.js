import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { DeliveryStore, digestToken } from '../server/delivery-store.js';
import { createDeliveryServer } from '../server/app.js';
import { DEFAULT_EMAIL, renderGiftEmail } from '../email-template.js';
import { normalizeEmail, parseDeliveryLink } from '../delivery-client.js';
import nodemailer from 'nodemailer';

const pdf = Buffer.from('%PDF-1.4\nTEST CERTIFICATE\n%%EOF');
const recipient = 'recipient@example.com';

async function fixture(t, sender) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gift-mail-test-'));
  t.after(async () => {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('gift-mail-test-')) throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  });
  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('base64url');
  const directory = path.join(root, id);
  await mkdir(directory);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ tokenHash: digestToken(token), email: DEFAULT_EMAIL }));
  await writeFile(path.join(directory, 'gift.pdf'), pdf);
  return { root, directory, id, token, store: new DeliveryStore(root, sender) };
}

test('missing or wrong token never triggers an email or exposes metadata', async t => {
  let calls = 0;
  const { store, id, token } = await fixture(t, async () => { calls++; return { accepted: true }; });
  for (const value of [null, 'bad', randomBytes(32).toString('base64url')]) {
    await assert.rejects(store.status(id, value), { code: 'UNAUTHORIZED' });
    await assert.rejects(store.send(id, value, { email: recipient, confirmEmail: recipient }), { code: 'UNAUTHORIZED' });
  }
  assert.equal(calls, 0);
  assert.equal((await store.status(id, token)).status, 'ready');
});

test('PDF is attached unchanged; repeated and concurrent requests send only once', async t => {
  let calls = 0;
  const { store, id, token } = await fixture(t, async mail => {
    calls++;
    assert.equal(mail.to, recipient);
    assert.deepEqual(mail.pdf, pdf);
    assert.equal(mail.subject, DEFAULT_EMAIL.subject);
    await new Promise(resolve => setTimeout(resolve, 15));
    return { accepted: true };
  });
  const input = { email: recipient, confirmEmail: recipient, subject: 'Injected subject', pdf: 'Injected PDF' };
  const results = await Promise.allSettled([store.send(id, token, input), store.send(id, token, input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await store.send(id, token, input)).status, 'sent');
  await assert.rejects(store.send(id, token, { email: 'other@example.com', confirmEmail: 'other@example.com' }), { code: 'RECIPIENT_LOCKED' });
  assert.equal(calls, 1);
  assert.equal((await store.status(id, token)).recipient, 'r***@example.com');
});

test('uncertain SMTP outcome stays locked across restart and never auto-retries', async t => {
  let calls = 0;
  const { store, root, id, token } = await fixture(t, async () => { calls++; throw new Error('Timeout with private provider details'); });
  const input = { email: recipient, confirmEmail: recipient };
  await assert.rejects(store.send(id, token, input), { code: 'DELIVERY_UNCERTAIN' });
  const restarted = new DeliveryStore(root, async () => { calls++; return { accepted: true }; });
  await assert.rejects(restarted.send(id, token, input), { code: 'DELIVERY_UNCERTAIN' });
  assert.equal((await restarted.status(id, token)).status, 'uncertain');
  assert.equal(calls, 1);
});

test('invalid or mismatched addresses do not consume a gift', async t => {
  let calls = 0;
  const { store, id, token } = await fixture(t, async () => { calls++; return { accepted: true }; });
  for (const email of ['bad', 'a@example.com\r\nBcc: victim@example.com', 'a@example.com,b@example.com', 'a..b@example.com', 'a@x..com']) {
    await assert.rejects(store.send(id, token, { email, confirmEmail: email }), { code: 'INVALID_EMAIL' });
  }
  await assert.rejects(store.send(id, token, { email: recipient, confirmEmail: 'typo@example.com' }), { code: 'EMAIL_MISMATCH' });
  assert.equal(calls, 0);
  assert.equal((await store.status(id, token)).status, 'ready');
});

test('missing Gmail configuration and non-PDF file never consume a gift', async t => {
  const { store, directory, id, token } = await fixture(t, null);
  assert.equal((await store.status(id, token)).status, 'not_configured');
  await assert.rejects(store.send(id, token, { email: recipient, confirmEmail: recipient }), { code: 'NOT_CONFIGURED' });
  await assert.rejects(readFile(path.join(directory, 'state.json')), { code: 'ENOENT' });
  await writeFile(path.join(directory, 'gift.pdf'), 'NOT A PDF');
  await assert.rejects(store.send(id, token, { email: recipient, confirmEmail: recipient }), { code: 'INVALID_PDF' });
});

test('API blocks wrong origin, no auth, raw PDF, large input and returns safe errors', async t => {
  const { root, id, token } = await fixture(t, null);
  const origin = 'https://kirill170717.github.io';
  const server = createDeliveryServer({ root, origin, sender: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/delivery/${id}`;
  const headers = { Origin: origin, Authorization: `Bearer ${token}` };
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, { headers: { Origin: origin } })).status, 401);
  assert.equal((await fetch(url + '/gift.pdf', { headers })).status, 404);
  assert.equal((await fetch(url, { method: 'OPTIONS', headers })).status, 204);
  const large = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(3000) }) });
  assert.equal(large.status, 413);
  const response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: recipient, confirmEmail: recipient }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'NOT_CONFIGURED' });
});

test('email template escapes private text and contains HTML and plain text versions', () => {
  const rendered = renderGiftEmail({ ...DEFAULT_EMAIL, message: '<script>alert(1)</script>' });
  assert.equal(rendered.html.includes('<script>'), false);
  assert.equal(rendered.html.includes('&lt;script&gt;'), true);
  assert.match(rendered.text, /PDF/);
  assert.throws(() => renderGiftEmail({ ...DEFAULT_EMAIL, subject: 'Subject\r\nBcc: x@example.com' }));
});

test('MIME email compiles offline with the original PDF attachment', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const result = await transport.sendMail({ from: 'kirill170717@gmail.com', to: recipient, ...renderGiftEmail(), attachments: [{ filename: 'podarochnaya-karta.pdf', content: pdf, contentType: 'application/pdf' }] });
  const raw = result.message.toString();
  assert.match(raw, /Content-Type: application\/pdf/);
  assert.match(raw, /podarochnaya-karta.pdf/);
  assert.equal(raw.replaceAll('\r\n', '').includes(pdf.toString('base64')), true);
});

test('private delivery link parsing does not turn old or damaged links into demo', () => {
  assert.equal(parseDeliveryLink('').mode, 'demo');
  assert.equal(parseDeliveryLink('#gift=old&key=old').mode, 'invalid');
  assert.equal(parseDeliveryLink('#delivery=' + 'a'.repeat(32)).mode, 'invalid');
  assert.equal(normalizeEmail(' recipient@EXAMPLE.COM '), recipient);
});
