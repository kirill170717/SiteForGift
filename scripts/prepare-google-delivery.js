import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderGiftEmail } from '../email-template.js';
import { normalizeEmail } from '../delivery-client.js';
import { digestToken } from '../server/delivery-store.js';

export const CONFIGURE_GIFT_ENTRY = `function configureGift() {\n  const active = Session.getActiveUser().getEmail();\n  const effective = Session.getEffectiveUser().getEmail();\n  if (!active || active !== effective) throw new Error('Настройка доступна только владельцу в редакторе.');\n  configureGift_();\n}\n\n`;

export function createGoogleGift(pdfId, email) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(pdfId || '')) throw new Error('Invalid Drive file ID');
  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('base64url');
  const rendered = renderGiftEmail(email);
  const manifest = { tokenHash: digestToken(token), pdfId, subject: rendered.subject, text: rendered.text };
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > 8500) throw new Error('Email too large for Script Properties');
  const setup = `function configureGift_() {\n  const properties = PropertiesService.getScriptProperties();\n  const key = ${JSON.stringify('gift:' + id)};\n  if (properties.getProperty(key) || properties.getProperty(${JSON.stringify('state:' + id)})) throw new Error('Gift already configured; never reset delivery state');\n  properties.setProperty(key, ${JSON.stringify(JSON.stringify(manifest))});\n}\n`;
  return { id, token, setup: CONFIGURE_GIFT_ENTRY + setup, html: rendered.html };
}

export async function buildGoogleCode() {
  const source = await readFile(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');
  return source.replace('/* EMAIL_NORMALIZER */', normalizeEmail.toString().replace('function normalizeEmail(', 'function normalizeEmail_('));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const gift = createGoogleGift(process.argv[2], JSON.parse(await readFile('.private/email.json', 'utf8')));
    const directory = `.private/google-${gift.id}`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(`${directory}/Code.gs`, await buildGoogleCode(), { flag: 'wx', mode: 0o600 });
    await writeFile(`${directory}/Setup.gs`, gift.setup, { flag: 'wx', mode: 0o600 });
    await writeFile(`${directory}/Email_${gift.id}.html`, gift.html, { flag: 'wx', mode: 0o600 });
    for (const file of ['Form.html', 'appsscript.json']) await copyFile(`google-apps-script/${file}`, `${directory}/${file}`);
    await writeFile(`.private/delivery-link-${gift.id}.txt`, `https://kirill170717.github.io/SiteForGift/#delivery=${gift.id}&token=${gift.token}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`Файлы Google Apps Script: ${directory}`);
    console.log(`Личная ссылка: .private/delivery-link-${gift.id}.txt`);
    console.log('Загрузите файлы проекта в Apps Script своего Gmail. Не добавляйте приватную папку в GitHub.');
  } catch {
    console.error('Нужны ID приватного PDF из Google Drive и .private/email.json. Файлы не подготовлены.');
    process.exitCode = 1;
  }
}
