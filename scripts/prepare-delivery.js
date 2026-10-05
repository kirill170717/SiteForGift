import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { validateEmailContent } from '../email-template.js';
import { digestToken, validatePdf } from '../server/delivery-store.js';

try {
  const pdfPath = path.resolve(process.argv[2] || '.private/gift.pdf');
  const pdf = validatePdf(await readFile(pdfPath));
  const email = validateEmailContent(JSON.parse(await readFile('.private/email.json', 'utf8')));
  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('base64url');
  const directory = path.join('.private/deliveries', id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'gift.pdf'), pdf, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ version: 1, tokenHash: digestToken(token), email }, null, 2), { flag: 'wx', mode: 0o600 });
  await writeFile(`.private/delivery-link-${id}.txt`, `https://kirill170717.github.io/SiteForGift/#delivery=${id}&token=${token}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`PDF подготовлен в ${directory}.`);
  console.log(`Личная ссылка: .private/delivery-link-${id}.txt`);
  console.log('Загрузите папку доставки на приватный сервер. В GitHub её не добавлять.');
} catch {
  console.error('Не удалось подготовить подарок. Нужны PDF до 10 МБ и .private/email.json по образцу examples/email.example.json.');
  process.exitCode = 1;
}
