// Unit tests for isGroupChat. Pins the bridge-level filter to fixtures
// matching backend/src/lib/db.ts:isGroupChat so drift surfaces as a
// failing test rather than a silent duplication.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGroupChat } from '../group-chat';

test('detects @g.us suffix', () => {
  assert.equal(isGroupChat('120363207662725526@g.us'), true);
  assert.equal(isGroupChat('foo-1234@g.us'), true);
});

test('detects bare 15-18 digit chat JIDs', () => {
  assert.equal(isGroupChat('120363207662725526'), true); // 18 digits
  assert.equal(isGroupChat('123456789012345'), true); // 15 digits
});

test('rejects normal 1:1 customer identifiers', () => {
  assert.equal(isGroupChat('923001234567@c.us'), false);
  assert.equal(isGroupChat('923001234567@lid'), false);
  assert.equal(isGroupChat('923001234567'), false); // bare customer phone
});

test('rejects LID-format dash-separated identifiers (1:1 customers)', () => {
  assert.equal(isGroupChat('966541183544-1454589702'), false);
});

test('rejects empty / nullish', () => {
  assert.equal(isGroupChat(''), false);
  assert.equal(isGroupChat(null), false);
  assert.equal(isGroupChat(undefined), false);
});

test('rejects too-short numerics (under 15 digits)', () => {
  assert.equal(isGroupChat('12345678901234'), false); // 14 digits — too short
  assert.equal(isGroupChat('12345'), false);
});

test('rejects too-long numerics (over 18 digits)', () => {
  assert.equal(isGroupChat('1234567890123456789'), false); // 19 digits — too long
});

test('rejects non-numeric chat identifiers', () => {
  assert.equal(isGroupChat('abc123'), false);
  assert.equal(isGroupChat('chat-xyz'), false);
});