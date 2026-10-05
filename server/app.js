import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DeliveryStore, DeliveryError } from './delivery-store.js';
import { createGmailSender } from './gmail.js';

export function createDeliveryServer({ root, origin, sender }) {
  const store = new DeliveryStore(root, sender);
  return http.createServer(async (request, response) => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    const reply = (status, body) => { response.writeHead(status, headers).end(JSON.stringify(body)); };
    if (request.headers.origin !== origin) { reply(403, { code: 'ORIGIN_DENIED' }); return; }
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    const match = new URL(request.url, 'http://localhost').pathname.match(/^\/api\/delivery\/([a-f0-9]{32})$/);
    if (!match) { reply(404, { code: 'NOT_FOUND' }); return; }
    if (request.method === 'OPTIONS') { response.writeHead(204, headers).end(); return; }
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    try {
      if (request.method === 'GET') reply(200, await store.status(match[1], token));
      else if (request.method === 'POST') {
        // Authenticate before consuming input. No public PDF or upload route exists.
        await store.authorize(match[1], token);
        if (request.headers['content-type'] !== 'application/json') throw new DeliveryError('INVALID_REQUEST', 415);
        let chunks = [], size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 2048) throw new DeliveryError('REQUEST_TOO_LARGE', 413);
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new DeliveryError('INVALID_REQUEST'); }
        reply(200, await store.send(match[1], token, body));
      } else reply(405, { code: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      // Never return provider diagnostics, SMTP credentials, card data or tokens.
      reply(error instanceof DeliveryError ? error.status : 503, { code: error instanceof DeliveryError ? error.code : 'UNAVAILABLE' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = createDeliveryServer({ root: process.env.GIFT_DATA_DIR || '.private/deliveries', origin: process.env.GIFT_ALLOWED_ORIGIN || 'https://kirill170717.github.io', sender: await createGmailSender() });
  const port = Number(process.env.GIFT_SERVER_PORT || 8787);
  server.requestTimeout = 70000;
  server.headersTimeout = 10000;
  server.listen(port, process.env.GIFT_SERVER_HOST || '127.0.0.1', () => console.log('Gift delivery server started.'));
}
