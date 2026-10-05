export function parseDeliveryLink(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('delivery') && !params.has('token')) {
    // Previous private links must not accidentally fall back to a public demo.
    return params.has('gift') || params.has('key') ? { mode: 'invalid', access: null } : { mode: 'demo', access: null };
  }
  const id = params.get('delivery');
  const token = params.get('token');
  if (params.getAll('delivery').length !== 1 || params.getAll('token').length !== 1 || !/^[a-f0-9]{32}$/.test(id ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(token ?? '')) return { mode: 'invalid', access: null };
  return { mode: 'private', access: { id, token } };
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new Error('Invalid email');
  const email = value.trim();
  // Single conventional address only, never a header or recipient list.
  if (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(email)) throw new Error('Invalid email');
  const [local, domain] = email.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.includes('..') || domain.split('.').some(label => label.length > 63 || label.startsWith('-') || label.endsWith('-'))) throw new Error('Invalid email');
  return local + '@' + domain.toLowerCase();
}

export async function createDeliveryClient(access, fetcher = fetch) {
  if (!access || parseDeliveryLink(`#delivery=${access.id}&token=${access.token}`).mode !== 'private') throw new Error('INVALID_LINK');
  const response = await fetcher(new URL('delivery-config.json', import.meta.url), { cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('NOT_CONFIGURED');
  const config = await response.json();
  if (config.googleScriptUrl) return { handoffUrl: googleDeliveryUrl(config.googleScriptUrl, access) };
  if (!config.apiUrl) throw new Error('NOT_CONFIGURED');
  const base = new URL(config.apiUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('NOT_CONFIGURED');
  async function request(method, data) {
    const result = await fetcher(new URL(`/api/delivery/${access.id}`, base), {
      method, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { Authorization: `Bearer ${access.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(65000),
    });
    const payload = await result.json();
    if (!result.ok) throw new Error(payload.code || 'UNAVAILABLE');
    return payload;
  }
  return { status: () => request('GET'), send: (email, confirmEmail) => request('POST', { email: normalizeEmail(email), confirmEmail: normalizeEmail(confirmEmail) }) };
}

export function googleDeliveryUrl(address, access) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) throw new Error('NOT_CONFIGURED');
  if (parseDeliveryLink(`#delivery=${access?.id}&token=${access?.token}`).mode !== 'private') throw new Error('INVALID_LINK');
  url.hash = new URLSearchParams({ delivery: access.id, token: access.token }).toString();
  return url.href;
}
