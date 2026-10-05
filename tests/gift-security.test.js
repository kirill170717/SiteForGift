import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { encryptGift, decryptGift, parseGiftLink, validateEnvelope, encodeBase64, decodeBase64, escapeMarkup } from '../gift-crypto.js';
import { getGiftAccess, loadPrivateGift } from '../gift-vault.js';
import { readProgress, writeProgress } from '../quest.js';

const card = { amount: '7 777', cardNumber: 'SECURITY-TEST-1234', pin: '8765', demo: true };

test('only the private link decrypts the complete card', async () => {
  const { envelope, fragment } = await encryptGift(card);
  const access = parseGiftLink(fragment);
  assert.deepEqual(await decryptGift(envelope, access), card);
  const publicData = JSON.stringify(envelope);
  assert.equal(publicData.includes(card.cardNumber), false);
  assert.equal(publicData.includes(access.key), false);
  assert.equal(decodeBase64(access.key).length, 32);
});

test('missing, wrong and shortened keys never reveal the card', async () => {
  const { envelope, fragment } = await encryptGift(card);
  const access = parseGiftLink(fragment);
  const wrong = encodeBase64(crypto.getRandomValues(new Uint8Array(32)));
  await assert.rejects(decryptGift(envelope, null));
  await assert.rejects(decryptGift(envelope, { ...access, key: wrong }));
  await assert.rejects(decryptGift(envelope, { ...access, key: access.key.slice(1) }));
  assert.equal(getGiftAccess(`#gift=${access.id}`).mode, 'invalid');
  assert.equal(getGiftAccess(`${fragment}&key=${access.key}`).mode, 'invalid');
});

test('modified ciphertext, IV and substituted gift ID fail authentication', async () => {
  const { envelope, fragment } = await encryptGift(card);
  const access = parseGiftLink(fragment);
  const bytes = decodeBase64(envelope.ciphertext);
  bytes[0] ^= 1;
  await assert.rejects(decryptGift({ ...envelope, ciphertext: encodeBase64(bytes) }, access));
  const iv = decodeBase64(envelope.iv);
  iv[0] ^= 1;
  await assert.rejects(decryptGift({ ...envelope, iv: encodeBase64(iv) }, access));
  const otherId = 'f'.repeat(32);
  await assert.rejects(decryptGift({ ...envelope, id: otherId }, { ...access, id: otherId }));
});

test('every preparation gets a fresh ID, key and IV', async () => {
  const first = await encryptGift(card);
  const second = await encryptGift(card);
  assert.notEqual(first.envelope.id, second.envelope.id);
  assert.notEqual(first.envelope.iv, second.envelope.iv);
  assert.notEqual(parseGiftLink(first.fragment).key, parseGiftLink(second.fragment).key);
});

test('envelopes with accidental plaintext fields are rejected', async () => {
  const { envelope } = await encryptGift(card);
  assert.throws(() => validateEnvelope({ ...envelope, cardNumber: card.cardNumber }));
  assert.throws(() => validateEnvelope({ ...envelope, key: 'secret' }));
  assert.throws(() => validateEnvelope({ ...envelope, version: 2 }));
});

test('requests never contain the key; a failed request never falls back to demo', async () => {
  const { envelope, fragment } = await encryptGift(card);
  const access = parseGiftLink(fragment);
  const result = await loadPrivateGift(access, async (url, options) => {
    assert.equal(url.href.includes(access.key), false);
    assert.equal(url.hash, '');
    assert.equal(url.search, '');
    assert.equal(url.pathname.endsWith(`/gifts/${access.id}.json`), true);
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.credentials, 'omit');
    return { ok: true, json: async () => envelope };
  });
  assert.deepEqual(result, card);
  await assert.rejects(loadPrivateGift(access, async () => ({ ok: false })));
  await assert.rejects(loadPrivateGift(null, () => { throw new Error('Must not fetch'); }));
});

test('private gifts have independent progress; storage contains no card or key', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  writeProgress(6, storage, 'gift:first');
  assert.equal(readProgress(storage, 'gift:second'), -1);
  assert.deepEqual([...values.values()], ['6']);
});

test('card text is escaped for HTML and SVG output', () => {
  assert.equal(escapeMarkup('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
});

test('build publishes ciphertext, excludes private input and cleans old output', async t => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gift-vault-test-'));
  t.after(async () => {
    if (path.dirname(tempRoot) !== path.resolve(os.tmpdir()) || !path.basename(tempRoot).startsWith('gift-vault-test-')) throw new Error('Unsafe test cleanup');
    await rm(tempRoot, { recursive: true, force: true });
  });
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  for (const dir of ['assets', 'gifts', '.private', 'dist']) await mkdir(path.join(tempRoot, dir));
  for (const file of ['index.html', 'styles.css', 'app.js', 'quest.js', 'gift-crypto.js', 'gift-vault.js', '.nojekyll', 'assets/favicon.svg']) await copyFile(path.join(sourceRoot, file), path.join(tempRoot, file));
  await writeFile(path.join(tempRoot, '.private/card.json'), JSON.stringify(card));
  await writeFile(path.join(tempRoot, 'dist/old-secret.txt'), 'old output');
  const { envelope, fragment } = await encryptGift(card);
  await writeFile(path.join(tempRoot, `gifts/${envelope.id}.json`), JSON.stringify(envelope));
  const build = path.join(sourceRoot, 'scripts/build.js');
  execFileSync(process.execPath, [build], { cwd: tempRoot });
  assert.equal((await readdir(path.join(tempRoot, 'dist'))).includes('.private'), false);
  assert.equal((await readdir(path.join(tempRoot, 'dist'))).includes('old-secret.txt'), false);
  const published = await readFile(path.join(tempRoot, `dist/gifts/${envelope.id}.json`), 'utf8');
  assert.equal(published.includes(card.cardNumber), false);
  assert.equal(published.includes(parseGiftLink(fragment).key), false);
  await writeFile(path.join(tempRoot, 'gifts/card.json'), JSON.stringify(card));
  assert.throws(() => execFileSync(process.execPath, [build], { cwd: tempRoot, stdio: 'pipe' }));
});
