import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { createGoogleGift, buildGoogleCode } from '../scripts/prepare-google-delivery.js';
import { DEFAULT_EMAIL } from '../email-template.js';
import { googleDeliveryUrl, createDeliveryClient } from '../delivery-client.js';

const source = await buildGoogleCode();
const pdf = Buffer.from('%PDF-1.4\nTEST CERTIFICATE\n%%EOF');
const address = 'recipient@example.com';

function fixture(options = {}) {
  const gift = createGoogleGift('TEST_private_drive_pdf_id', DEFAULT_EMAIL);
  const values = new Map();
  const properties = { getProperty: key => values.get(key) ?? null, setProperty: (key, value) => values.set(key, value) };
  let locked = false;
  const calls = [];
  const blob = { getBytes: () => [...(options.pdf ?? pdf)], setName(name) { this.name = name; return this; } };
  const scope = createContext({ PropertiesService: { getScriptProperties: () => properties },
    Session: { getActiveUser: () => ({ getEmail: () => options.activeEmail ?? 'owner@example.com' }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_, value) => [...createHash('sha256').update(value).digest()] },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    DriveApp: { Access: { PRIVATE: 'private' }, getFileById: id => { assert.equal(id, 'TEST_private_drive_pdf_id'); return {
      getSharingAccess: () => options.publicPdf ? 'anyone' : 'private', getViewers: () => options.sharedPdf ? ['another person'] : [], getEditors: () => [], getBlob: () => blob }; } },
    HtmlService: { createHtmlOutputFromFile: name => { assert.equal(name, 'Email_' + gift.id); return { getContent: () => gift.html }; } },
    MailApp: { getRemainingDailyQuota: () => options.noQuota ? 0 : 100, sendEmail: mail => {
      calls.push(mail); options.onSend?.(scope); if (options.fail) throw new Error('PRIVATE PROVIDER DIAGNOSTIC');
    } },
  });
  runInContext(source + '\n' + gift.setup, scope);
  if (!options.skipSetup) scope.configureGift();
  return { scope, values, calls, blob, gift, access: { id: gift.id, token: gift.token } };
}

test('Google delivery requires the exact token; revoked gifts expose no status', () => {
  const f = fixture();
  for (const access of [null, { id: f.gift.id, token: 'X'.repeat(43) }]) {
    assert.throws(() => f.scope.getGiftStatus(access), /Подарок недоступен/);
    assert.throws(() => f.scope.sendGift(access, address, address), /Подарок недоступен/);
  }
  const key = 'gift:' + f.gift.id;
  f.values.set(key, JSON.stringify({ ...JSON.parse(f.values.get(key)), revoked: true }));
  assert.throws(() => f.scope.getGiftStatus(f.access), /Подарок недоступен/);
  assert.equal(f.calls.length, 0);
});

test('runnable Google setup rejects anonymous and other users before writing properties', () => {
  for (const activeEmail of ['', 'visitor@example.com']) {
    const f = fixture({ skipSetup: true, activeEmail });
    assert.throws(() => f.scope.configureGift(), /только владельцу/);
    assert.equal(f.values.size, 0);
  }
});

test('Google delivery attaches original private PDF once, including after script restart', () => {
  const f = fixture();
  assert.equal(f.scope.getGiftStatus(f.access).status, 'ready');
  assert.equal(f.scope.sendGift(f.access, address, address).status, 'sent');
  assert.deepEqual(Buffer.from(f.calls[0].attachments[0].getBytes()), pdf);
  assert.equal(f.blob.name, 'podarochnaya-karta.pdf');
  assert.equal(f.calls[0].to, address);
  assert.equal(f.calls[0].htmlBody, f.gift.html);
  runInContext(source, f.scope);
  assert.equal(f.scope.sendGift(f.access, address, address).status, 'sent');
  assert.equal(f.calls.length, 1);
  assert.throws(() => f.scope.sendGift(f.access, 'different@example.com', 'different@example.com'), /другим адресом/);
  assert.throws(() => f.scope.configureGift_(), /never reset/);
});

test('Google script lock rejects a competing send before MailApp is called again', () => {
  let f;
  f = fixture({ onSend: scope => assert.throws(() => scope.sendGift(f.access, address, address), /уже выполняется/) });
  f.scope.sendGift(f.access, address, address);
  assert.equal(f.calls.length, 1);
});

test('Google uncertain result persists and cannot be retried; provider error stays private', () => {
  const f = fixture({ fail: true });
  assert.throws(() => f.scope.sendGift(f.access, address, address), /Не удалось подтвердить/);
  runInContext(source, f.scope);
  assert.equal(f.scope.getGiftStatus(f.access).status, 'uncertain');
  assert.throws(() => f.scope.sendGift(f.access, address, address), /уже начата/);
  assert.equal(f.calls.length, 1);
});

test('Google rejects header injection, mismatched addresses, shared PDF and exhausted quota', () => {
  const f = fixture();
  for (const email of ['one@example.com,two@example.com', 'a@example.com\r\nBcc: x@example.com']) {
    assert.throws(() => f.scope.sendGift(f.access, email, email));
  }
  assert.throws(() => f.scope.sendGift(f.access, address, 'typo@example.com'), /не совпадают/);
  for (const options of [{ publicPdf: true }, { sharedPdf: true }, { noQuota: true }, { pdf: Buffer.from('not a PDF') }]) {
    const item = fixture(options);
    assert.throws(() => item.scope.sendGift(item.access, address, address));
    assert.equal(item.calls.length, 0);
    assert.equal(item.scope.getGiftStatus(item.access).status, 'ready');
  }
  assert.equal(f.calls.length, 0);
});

test('Google setup has no raw key; links allow only official deployed Google web apps', async () => {
  const f = fixture();
  assert.ok(!f.gift.setup.includes(f.gift.token));
  const url = googleDeliveryUrl('https://script.google.com/macros/s/TEST_deployment/exec', f.access);
  assert.equal(new URL(url).search, '');
  assert.ok(new URL(url).hash.includes(f.gift.token));
  for (const base of ['https://evil.example/macros/s/TEST/exec', 'https://script.google.com.evil.example/macros/s/TEST/exec', 'https://script.google.com/macros/s/TEST/dev', 'https://script.google.com/macros/s/TEST/exec?token=oops']) {
    assert.throws(() => googleDeliveryUrl(base, f.access));
  }
  const client = await createDeliveryClient(f.access, async () => ({ ok: true, json: async () => ({ googleScriptUrl: 'https://script.google.com/macros/s/TEST_deployment/exec' }) }));
  assert.equal(client.handoffUrl, url);
});
