// Public code, private keys. AES-GCM authenticates the ciphertext and its gift ID.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ID_PATTERN = /^[a-f0-9]{32}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_CIPHERTEXT = 8192;

export function encodeBase64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
  if (encodeBase64(bytes) !== value) throw new Error('Invalid encoding');
  return bytes;
}

export function validateCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('Invalid card');
  const fields = ['amount', 'cardNumber', 'pin', 'demo'];
  if (Object.keys(card).some(key => !fields.includes(key)) || typeof card.demo !== 'boolean') throw new Error('Invalid card fields');
  for (const name of ['amount', 'cardNumber', 'pin']) {
    if (typeof card[name] !== 'string' || !card[name].trim() || card[name].length > 100 || /[\x00-\x1f\x7f]/.test(card[name])) throw new Error(`Invalid ${name}`);
  }
  if (!/^[0-9][0-9 .,]{0,24}$/.test(card.amount)) throw new Error('Invalid amount');
  return { amount: card.amount, cardNumber: card.cardNumber, pin: card.pin, demo: card.demo };
}

export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Invalid encrypted gift');
  const fields = ['version', 'algorithm', 'id', 'iv', 'ciphertext'];
  if (Object.keys(envelope).length !== fields.length || Object.keys(envelope).some(key => !fields.includes(key))) throw new Error('Encrypted gift contains unexpected fields');
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM' || !ID_PATTERN.test(envelope.id)) throw new Error('Invalid encrypted gift');
  if (typeof envelope.iv !== 'string' || envelope.iv.length !== 16 || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > MAX_CIPHERTEXT * 2) throw new Error('Invalid encrypted gift size');
  if (decodeBase64(envelope.iv).length !== 12) throw new Error('Invalid IV');
  const bytes = decodeBase64(envelope.ciphertext);
  if (bytes.length < 17 || bytes.length > MAX_CIPHERTEXT) throw new Error('Invalid ciphertext');
  return envelope;
}

export function parseGiftLink(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('gift') && !params.has('key')) return null;
  const id = params.get('gift');
  const key = params.get('key');
  if (params.getAll('gift').length !== 1 || params.getAll('key').length !== 1 || !ID_PATTERN.test(id ?? '') || !KEY_PATTERN.test(key ?? '')) throw new Error('Invalid private link');
  if (decodeBase64(key).length !== 32) throw new Error('Invalid private key');
  return { id, key };
}

export async function encryptGift(input) {
  const card = validateCard(input);
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: encoder.encode(`gift-bureau:1:${id}`) }, key, encoder.encode(JSON.stringify(card)));
  return {
    envelope: { version: 1, algorithm: 'AES-256-GCM', id, iv: encodeBase64(iv), ciphertext: encodeBase64(new Uint8Array(ciphertext)) },
    fragment: `#gift=${id}&key=${encodeBase64(rawKey)}`,
  };
}

export async function decryptGift(input, access) {
  const envelope = validateEnvelope(input);
  if (!access || access.id !== envelope.id || !KEY_PATTERN.test(access.key ?? '')) throw new Error('Invalid private link');
  const rawKey = decodeBase64(access.key);
  if (rawKey.length !== 32) throw new Error('Invalid private key');
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(envelope.iv), tagLength: 128, additionalData: encoder.encode(`gift-bureau:1:${access.id}`) }, key, decodeBase64(envelope.ciphertext));
  return validateCard(JSON.parse(decoder.decode(plaintext)));
}

export function escapeMarkup(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
