import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicFiles = new Set(['/index.html', '/styles.css', '/app.js', '/quest.js', '/gift-crypto.js', '/gift-vault.js', '/assets/favicon.svg']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const publicPath = pathname === '/' ? '/index.html' : pathname;
    if (!publicFiles.has(publicPath) && !/^\/gifts\/[a-f0-9]{32}\.json$/.test(publicPath)) {
      response.writeHead(404).end('Not found');
      return;
    }
    const file = path.resolve(root, `.${publicPath}`);
    if (!file.startsWith(root + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
server.listen(4173, '127.0.0.1', () => console.log('Gift Bureau: http://127.0.0.1:4173'));
