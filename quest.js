// Demo values are intentionally public. Never put real gift credentials here.
export const CONFIG = Object.freeze({
  accessCode: '0418',
  amount: '5 000',
  cardNumber: 'DEMO-0000-0000-2026',
  pin: '0000',
});

export const STEP_NAMES = ['Это точно ты?', 'Капча настроения', 'Искусство радоваться', 'Уровень сияния', 'Секретное хранилище'];
export const STORAGE_KEY = 'gift-bureau-demo-v1';

export function normalizeCode(value) {
  return value.trim();
}

export function readProgress(storage) {
  try {
    storage ??= globalThis.localStorage;
    const value = storage.getItem(STORAGE_KEY);
    if (value === null || !/^(?:-1|[0-6])$/.test(value)) return -1;
    const step = Number(value);
    return Number.isInteger(step) && step >= -1 && step <= 6 ? step : -1;
  } catch {
    return -1;
  }
}

export function writeProgress(step, storage) {
  try {
    storage ??= globalThis.localStorage;
    storage.setItem(STORAGE_KEY, String(step));
    return true;
  } catch {
    return false;
  }
}
