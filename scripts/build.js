import { mkdir, copyFile, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { validateEnvelope } from '../gift-crypto.js';
import { renderGiftEmail } from '../email-template.js';
import { writeFile } from 'node:fs/promises';

// Publish only the website, never repository metadata or developer files.
const outputDir = path.resolve('dist');
if (path.dirname(outputDir) !== process.cwd() || path.basename(outputDir) !== 'dist') throw new Error('Unsafe build directory');
await rm(outputDir, { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
await mkdir('dist/gifts', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'quest.js', 'gift-crypto.js', 'gift-vault.js', 'email-template.js', 'delivery-client.js']) {
  await copyFile(file, `dist/${file}`);
}
await copyFile('assets/favicon.svg', 'dist/assets/favicon.svg');
await copyFile('.nojekyll', 'dist/.nojekyll');
const apiUrl = process.env.GIFT_DELIVERY_API_URL || '';
if (apiUrl && new URL(apiUrl).protocol !== 'https:') throw new Error('Delivery API must use HTTPS');
await writeFile('dist/delivery-config.json', JSON.stringify({ apiUrl }));
await writeFile('dist/email-preview.html', renderGiftEmail().html);
for (const file of await readdir('gifts')) {
  if (file === '.gitkeep') continue;
  if (!/^[a-f0-9]{32}\.json$/.test(file)) throw new Error('Only encrypted gift JSON files are allowed in gifts/');
  const envelope = validateEnvelope(JSON.parse(await readFile(`gifts/${file}`, 'utf8')));
  if (file !== `${envelope.id}.json`) throw new Error('Gift filename does not match its ID');
  await copyFile(`gifts/${file}`, `dist/gifts/${file}`);
}
console.log('Static site built in dist/');
