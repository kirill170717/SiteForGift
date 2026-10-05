import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, STORAGE_KEY, readProgress, writeProgress, normalizeCode } from '../quest.js';

function storage(value = null) {
  return { getItem: () => value, setItem: (key, next) => { assert.equal(key, STORAGE_KEY); value = next; } };
}

test('new and corrupt sessions start at the introduction', () => {
  for (const value of [null, '', ' ', 'NaN', '100', '-2', '1.5', '{}']) assert.equal(readProgress(storage(value)), -1);
});
test('every valid stage survives a page reload, including the finale', () => {
  for (let step = -1; step <= 6; step += 1) {
    const saved = storage();
    assert.equal(writeProgress(step, saved), true);
    assert.equal(readProgress(saved), step);
  }
});
test('blocked browser storage does not prevent playing', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readProgress(blocked), -1);
  assert.equal(writeProgress(2, blocked), false);
});
test('access code keeps its leading zero and gift credentials are explicitly fake', () => {
  assert.equal(normalizeCode(' 0418 '), CONFIG.accessCode);
  assert.notEqual(normalizeCode('418'), CONFIG.accessCode);
  assert.match(CONFIG.cardNumber, /^DEMO-/);
});
