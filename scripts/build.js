import { mkdir, copyFile } from 'node:fs/promises';

// Publish only the website, never repository metadata or developer files.
await mkdir('dist/assets', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'quest.js']) {
  await copyFile(file, `dist/${file}`);
}
await copyFile('assets/favicon.svg', 'dist/assets/favicon.svg');
await copyFile('.nojekyll', 'dist/.nojekyll');
console.log('Static site built in dist/');
