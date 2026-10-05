import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encryptGift } from '../gift-crypto.js';

const privateDir = path.resolve('.private');
const inputFile = path.join(privateDir, 'card.json');
const baseUrl = new URL('https://kirill170717.github.io/SiteForGift/');

try {
  const card = JSON.parse(await readFile(inputFile, 'utf8'));
  const { envelope, fragment } = await encryptGift(card);
  await mkdir('gifts', { recursive: true });
  await writeFile(`gifts/${envelope.id}.json`, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx' });
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const linkFile = path.join(privateDir, `recipient-${envelope.id}.txt`);
  await writeFile(linkFile, baseUrl.href + fragment + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Карта зашифрована: gifts/${envelope.id}.json`);
  console.log(`Личная ссылка сохранена в .private/recipient-${envelope.id}.txt`);
  console.log('Опубликуйте только зашифрованный JSON. Файл ссылки и card.json не добавляйте в Git.');
} catch {
  // Never print card data, a key, JSON parser context, or a private link to logs.
  console.error('Не удалось подготовить карту. Проверьте .private/card.json по образцу examples/card.example.json.');
  process.exitCode = 1;
}
