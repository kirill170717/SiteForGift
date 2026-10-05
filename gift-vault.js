import { decryptGift, parseGiftLink } from './gift-crypto.js';

export function getGiftAccess(hash = location.hash) {
  try {
    const access = parseGiftLink(hash);
    return { mode: access ? 'private' : 'demo', access };
  } catch {
    return { mode: 'invalid', access: null };
  }
}

export async function loadPrivateGift(access, fetcher = fetch) {
  if (!access) throw new Error('Missing private link');
  parseGiftLink(`#gift=${access.id}&key=${access.key}`);
  const url = new URL(`gifts/${access.id}.json`, import.meta.url);
  const response = await fetcher(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!response.ok) throw new Error('Gift unavailable');
  // Keys travel only in the URL fragment, never in the request URL or headers.
  return decryptGift(await response.json(), access);
}
