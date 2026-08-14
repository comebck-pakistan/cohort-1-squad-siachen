// Unit tests for VoiceNoteRateLimit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceNoteRateLimit } from '../rate-limit';

test('first N calls for a phone are allowed; N+1th is rejected', () => {
  const rl = new VoiceNoteRateLimit({ windowMs: 60_000, cap: 3 });
  const phone = '+923001234567';

  assert.equal(rl.allow(phone), true);
  assert.equal(rl.allow(phone), true);
  assert.equal(rl.allow(phone), true);
  assert.equal(rl.allow(phone), false);
  assert.equal(rl.allow(phone), false);
});

test('different phones are tracked separately', () => {
  const rl = new VoiceNoteRateLimit({ windowMs: 60_000, cap: 2 });
  assert.equal(rl.allow('+923001234567'), true);
  assert.equal(rl.allow('+923001234567'), true);
  assert.equal(rl.allow('+923001234567'), false);
  // Different phone — fresh quota.
  assert.equal(rl.allow('+923009876543'), true);
  assert.equal(rl.allow('+923009876543'), true);
  assert.equal(rl.allow('+923009876543'), false);
});

test('rejected calls do not consume quota', () => {
  const rl = new VoiceNoteRateLimit({ windowMs: 60_000, cap: 2 });
  const phone = '+923001234567';
  rl.allow(phone);
  rl.allow(phone);
  // Rejected — quota should NOT increment.
  rl.allow(phone);
  rl.allow(phone);
  rl.allow(phone);
  // count() reflects only accepted entries.
  assert.equal(rl.count(phone), 2);
});

test('count() returns current window count', () => {
  const rl = new VoiceNoteRateLimit({ windowMs: 60_000, cap: 5 });
  const phone = '+923001234567';
  assert.equal(rl.count(phone), 0);
  rl.allow(phone);
  assert.equal(rl.count(phone), 1);
  rl.allow(phone);
  assert.equal(rl.count(phone), 2);
});

test('clear() resets all state', () => {
  const rl = new VoiceNoteRateLimit({ windowMs: 60_000, cap: 2 });
  const phone = '+923001234567';
  rl.allow(phone);
  rl.allow(phone);
  assert.equal(rl.allow(phone), false);
  rl.clear();
  assert.equal(rl.allow(phone), true);
});

test('window pruning: expired timestamps are dropped on next allow()', () => {
  // Tight 50ms window so the test runs fast.
  const rl = new VoiceNoteRateLimit({ windowMs: 50, cap: 2 });
  const phone = '+923001234567';

  assert.equal(rl.allow(phone), true);
  assert.equal(rl.allow(phone), true);
  assert.equal(rl.allow(phone), false); // at cap

  // Wait past the window.
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      // Old entries should have been pruned; quota is fresh.
      assert.equal(rl.allow(phone), true);
      assert.equal(rl.allow(phone), true);
      assert.equal(rl.allow(phone), false);
      resolve();
    }, 80);
  });
});