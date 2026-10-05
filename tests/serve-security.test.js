import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('local server never exposes source card, recipient links or Git metadata', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn(process.execPath, ['scripts/serve.js'], { cwd: root, env: { ...process.env, GIFT_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server timeout')), 5000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/gift-crypto.js')).status, 200);
  for (const pathname of ['/.private/card.json', '/.private/recipient-test.txt', '/.git/config', '/scripts/prepare-gift.js', '/examples/card.example.json', '/gifts/card.json']) {
    assert.equal((await fetch(base + pathname)).status, 404, pathname);
  }
});
